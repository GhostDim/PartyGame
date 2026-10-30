const fs = require('fs');
const path = require('path');

const COUNT_MS = 1000;
const REVEAL_MS = 7000;
const OPTIONS_GAP_MS = 900;
const READ_BASE_MS = 1200;
const READ_PER_CHAR_MS = 65;
const READ_MIN_MS = 2400;
const READ_MAX_MS = 6500;
const BRIEF_BASE_MS = 3200;
const BRIEF_PER_CHAR_MS = 42;
const BRIEF_MIN_MS = 7000;
const BRIEF_MAX_MS = 10000;
const EMPTY_BET_MS = 2500;
const SWIPE_MS = 20000;
const WRONG_FREEZE_MS = 700;
const BET_MS = 10000;
const FINAL_ANSWER_MS = 60000;
const CLOSE_GAP = 450;
const SWIPE_POINTS = 50;
const QUESTION_COUNT = 9;
const QUESTIONS_IN_BLOCK = 3;
const BLOCKS = 3;
const MINI_CARDS = 8;

let bankCache = null;

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = list[i];
    list[i] = list[j];
    list[j] = swap;
  }
  return list;
}

function take(list, count) {
  const copy = list.slice();
  shuffle(copy);
  return copy.slice(0, count);
}

function pace(text, base, per, min, max) {
  const chars = Array.from(String(text || '')).length;
  return Math.max(min, Math.min(max, base + chars * per));
}

function readMs(text) {
  return pace(text, READ_BASE_MS, READ_PER_CHAR_MS, READ_MIN_MS, READ_MAX_MS);
}

function briefMs(text) {
  return pace(text, BRIEF_BASE_MS, BRIEF_PER_CHAR_MS, BRIEF_MIN_MS, BRIEF_MAX_MS);
}

function usableQuestion(row) {
  if (!row || typeof row.text !== 'string' || !row.text.trim()) return false;
  if (!Array.isArray(row.options) || row.options.length !== 4) return false;
  if (!row.options.every((item) => typeof item === 'string' && item.trim())) return false;
  if (new Set(row.options).size !== 4) return false;
  return row.options.includes(row.answer);
}

function usableSwipe(row) {
  if (!row || typeof row.title !== 'string' || typeof row.up !== 'string') return false;
  if (typeof row.down !== 'string' || typeof row.hint !== 'string') return false;
  if (!Array.isArray(row.cards) || row.cards.length < MINI_CARDS) return false;
  return row.cards.every((card) => card && typeof card.text === 'string' && card.text.trim() && typeof card.yes === 'boolean');
}

function deal(raw) {
  const options = raw.options.slice();
  shuffle(options);
  let seconds = Math.round(Number(raw.seconds));
  if (!Number.isFinite(seconds)) seconds = 15;
  seconds = Math.max(8, Math.min(40, seconds));
  return {
    text: raw.text,
    options,
    correct: options.indexOf(raw.answer),
    seconds,
  };
}

function readBank() {
  if (bankCache) return bankCache;
  try {
    const file = path.join(__dirname, '..', 'content', 'quiz.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const questions = (raw.questions || []).filter(usableQuestion);
    const finals = (raw.finals || []).filter(usableQuestion);
    const swipes = (raw.swipes || []).filter(usableSwipe);
    if (questions.length < QUESTION_COUNT || !finals.length || swipes.length < 2) return null;
    bankCache = { questions, finals, swipes };
    return bankCache;
  } catch (err) {
    return null;
  }
}

class Quiz {
  constructor(io, state, hooks) {
    this.io = io;
    this.state = state;
    this.hooks = hooks || {};
    this.dead = false;
    this.phase = 'count';
    this.steps = [];
    this.stepIndex = 0;
    this.roster = [];
    this.base = new Map();
    this.answers = new Map();
    this.answerSeq = 0;
    this.swipes = new Map();
    this.progress = new Map();
    this.holds = new Map();
    this.roundPoints = new Map();
    this.roundHits = new Map();
    this.betAmount = new Map();
    this.betLocked = new Set();
    this.revealRows = null;
    this.cardIndex = 0;
    this.count = '3';
    this.countLeft = 3;
    this.afterCount = null;
    this.endsAt = 0;
    this.limit = 0;
    this.token = 0;
    this.timer = null;
    this.later = null;
    this.soon = false;
  }

  init() {
    this.steps = this.makeSteps();
    if (!this.steps) return false;
    this.roster = [];
    this.base = new Map();
    for (const player of this.state.players.values()) {
      if (!player.isOnline) continue;
      this.roster.push(player.id);
      this.base.set(player.id, player.score);
    }
    if (!this.roster.length) return false;
    this.roster.sort((a, b) => this.nameOf(a).localeCompare(this.nameOf(b), 'ru'));
    this.stepIndex = 0;
    console.log('Викторина: ' + QUESTION_COUNT + ' вопросов, 2 свайпа, финал');
    this.openStep();
    return true;
  }

  makeSteps() {
    const data = readBank();
    if (!data) return null;
    const picked = take(data.questions, QUESTION_COUNT).map(deal);
    const finalQuestion = deal(take(data.finals, 1)[0]);
    const themes = take(data.swipes, 2).map((theme) => ({
      title: theme.title,
      up: theme.up,
      down: theme.down,
      hint: theme.hint,
      cards: take(theme.cards, MINI_CARDS).map((card) => ({ text: card.text, yes: card.yes })),
    }));
    const steps = [];
    let cursor = 0;
    for (let block = 0; block < BLOCKS; block += 1) {
      for (let index = 0; index < QUESTIONS_IN_BLOCK; index += 1) {
        steps.push({ type: 'question', number: cursor + 1, question: picked[cursor] });
        cursor += 1;
      }
      if (block < BLOCKS - 1) steps.push({ type: 'mini', theme: themes[block] });
    }
    steps.push({ type: 'final', question: finalQuestion });
    return steps;
  }

  onPlayerJoin(playerId) {
    if (this.dead || !playerId) return;
    const player = this.state.players.get(playerId);
    if (player && player.isOnline && this.phase !== 'over' && !this.roster.includes(playerId)) {
      this.roster.push(playerId);
      if (!this.base.has(playerId)) this.base.set(playerId, player.score);
    }
    if (this.phase === 'bet') this.lockEmptyBets();
    if (this.phase === 'mini') this.ensureProgress(playerId);
    if (!this.guardOnline()) return;
    this.emit(false);
    if (this.phase === 'bet') this.maybeCloseEarly();
  }

  onPlayerLeave(playerId) {
    if (this.dead || !this.roster.includes(playerId)) return;
    this.roster = this.roster.filter((id) => id !== playerId);
    this.answers.delete(playerId);
    this.swipes.delete(playerId);
    this.betAmount.delete(playerId);
    this.betLocked.delete(playerId);
    this.base.delete(playerId);
    this.clearHold(playerId);
    this.progress.delete(playerId);
    if (!this.guardOnline()) return;
    this.emit(false);
    if (this.phase === 'mini') this.maybeFinishMini();
    this.maybeCloseEarly();
  }

  onAction(playerId, data) {
    if (this.dead || !data || !this.roster.includes(playerId)) return;
    const player = this.state.players.get(playerId);
    if (!player || !player.isOnline) return;
    if (data.type === 'answer') this.answer(playerId, data.option);
    else if (data.type === 'swipe') this.swipe(playerId, data.up);
    else if (data.type === 'bet') this.bet(playerId, data.amount, data.lock);
  }

  refresh() {
    this.emit(false);
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.freshToken();
    if (this.later) clearTimeout(this.later);
    this.later = null;
    this.clearHolds();
    this.io.emit('quiz_state', null);
  }

  answer(playerId, option) {
    if (this.phase !== 'ask' && this.phase !== 'final') return;
    if (this.answers.has(playerId)) return;
    if (!Number.isInteger(option) || option < 0 || option > 3) return;
    this.answerSeq += 1;
    this.answers.set(playerId, { option, at: Date.now(), seq: this.answerSeq });
    this.emit(false);
    this.maybeCloseEarly();
  }

  swipe(playerId, up) {
    if (this.phase !== 'mini' || typeof up !== 'boolean') return;
    const prog = this.progress.get(playerId);
    const cards = this.miniCards();
    if (!prog || prog.busy || prog.index >= cards.length) return;
    const card = cards[prog.index];
    const ok = up === card.yes;
    prog.seq += 1;
    prog.lastOk = ok;
    if (ok) {
      const gained = this.grant(playerId, SWIPE_POINTS);
      this.roundPoints.set(playerId, (this.roundPoints.get(playerId) || 0) + gained);
      this.roundHits.set(playerId, (this.roundHits.get(playerId) || 0) + 1);
      prog.index += 1;
      this.emit(false);
      this.maybeFinishMini();
      return;
    }
    prog.busy = true;
    this.emit(false);
    this.hold(playerId, () => {
      const row = this.progress.get(playerId);
      if (!row) return;
      row.busy = false;
      row.lastOk = null;
      row.index += 1;
      this.emit(false);
      this.maybeFinishMini();
    });
  }

  bet(playerId, amount, lock) {
    if (this.phase !== 'bet' || this.betLocked.has(playerId)) return;
    let value = Math.round(Number(amount));
    if (!Number.isFinite(value)) value = 0;
    value = Math.max(0, Math.min(this.purse(playerId), value));
    this.betAmount.set(playerId, value);
    if (lock === true) {
      this.betLocked.add(playerId);
      this.emit(false);
      this.maybeCloseEarly();
      return;
    }
    this.laterEmit();
  }

  maybeCloseEarly() {
    if (this.soon || this.dead) return;
    if ((this.phase === 'ask' || this.phase === 'final') && this.everyone((id) => this.answers.has(id))) {
      this.closeSoon(() => this.closeAsk());
    } else if (this.phase === 'bet' && this.someoneCanBet() && this.everyone((id) => this.betLocked.has(id))) {
      this.closeSoon(() => this.closeBet());
    }
  }

  openStep() {
    if (this.dead || !this.guardOnline()) return;
    const step = this.step();
    if (!step) {
      this.finish();
      return;
    }
    this.answers.clear();
    this.revealRows = null;
    this.soon = false;
    if (step.type === 'question') this.startCount(() => this.openRead('ask'));
    else if (step.type === 'mini') this.openMini();
    else this.startCount(() => this.openFinalRules());
  }

  startCount(done) {
    this.phase = 'count';
    this.countLeft = 3;
    this.afterCount = done;
    this.endsAt = 0;
    this.limit = 0;
    this.pushCount();
  }

  pushCount() {
    if (this.dead || this.phase !== 'count') return;
    this.count = String(this.countLeft);
    this.endsAt = 0;
    this.emit(false);
    const token = this.freshToken();
    this.timer = setTimeout(() => {
      if (this.dead || token !== this.token || this.phase !== 'count') return;
      this.countLeft -= 1;
      if (this.countLeft > 0) this.pushCount();
      else if (this.afterCount) this.afterCount();
    }, COUNT_MS);
    this.timer.unref();
  }

  openRead(next) {
    if (this.dead || !this.guardOnline()) return;
    const step = this.step();
    this.phase = 'read';
    this.answers.clear();
    this.revealRows = null;
    this.soon = false;
    const text = step && step.question ? step.question.text : '';
    this.arm(readMs(text), () => {
      if (next === 'bet') this.openBet();
      else this.openGap('ask');
    });
    this.emit(false);
  }

  openGap(next) {
    if (this.dead || !this.guardOnline()) return;
    this.phase = 'gap';
    this.soon = false;
    const token = this.freshToken();
    this.limit = 0;
    this.endsAt = 0;
    this.timer = setTimeout(() => {
      if (this.dead || token !== this.token) return;
      // Варианты выходят здесь. Позже на это место встанет сигнал динамика.
      if (next === 'final') this.openFinal();
      else this.openAsk();
    }, OPTIONS_GAP_MS);
    this.timer.unref();
    this.emit(false);
  }

  openAsk() {
    if (this.dead || !this.guardOnline()) return;
    const step = this.step();
    this.phase = 'ask';
    this.answers.clear();
    this.revealRows = null;
    this.soon = false;
    const seconds = step && step.question ? step.question.seconds : 15;
    this.arm(seconds * 1000, () => this.closeAsk());
    this.emit(false);
  }

  closeAsk() {
    if (this.phase !== 'ask' && this.phase !== 'final') return;
    this.soon = false;
    this.scoreAsk();
    this.phase = this.phase === 'final' ? 'final_reveal' : 'reveal';
    this.endsAt = 0;
    this.limit = 0;
    this.emit(true);
    this.arm(REVEAL_MS, () => this.advance());
  }

  openMini() {
    if (this.dead || !this.guardOnline()) return;
    this.phase = 'mini_intro';
    this.cardIndex = 0;
    this.swipes.clear();
    this.revealRows = null;
    this.soon = false;
    const step = this.step();
    const lines = step && step.theme ? this.miniLines(step.theme) : [];
    this.arm(briefMs(this.linesText(lines)), () => this.openRun());
    this.emit(false);
  }

  openRun() {
    if (this.dead || !this.guardOnline()) return;
    this.phase = 'mini';
    this.clearHolds();
    this.progress = new Map();
    this.roundPoints = new Map();
    this.roundHits = new Map();
    for (const id of this.roster) this.ensureProgress(id);
    this.swipes.clear();
    this.revealRows = null;
    this.soon = false;
    this.arm(SWIPE_MS, () => this.finishMini());
    this.emit(false);
  }

  finishMini() {
    if (this.phase !== 'mini') return;
    this.clearHolds();
    this.phase = 'mini_board';
    const token = this.freshToken();
    this.endsAt = 0;
    this.limit = 0;
    this.timer = setTimeout(() => {
      if (this.dead || token !== this.token || this.phase !== 'mini_board') return;
      this.advance();
    }, REVEAL_MS);
    this.timer.unref();
    this.emit(true);
  }

  maybeFinishMini() {
    if (this.phase !== 'mini') return;
    const total = this.miniCards().length;
    if (!total) {
      this.finishMini();
      return;
    }
    const done = this.everyone((id) => {
      const prog = this.progress.get(id);
      return prog && !prog.busy && prog.index >= total;
    });
    if (done) this.finishMini();
  }

  ensureProgress(playerId) {
    if (!playerId || this.progress.has(playerId)) return;
    this.progress.set(playerId, { index: 0, busy: false, seq: 0, lastOk: null });
  }

  hold(playerId, fn) {
    this.clearHold(playerId);
    const timer = setTimeout(() => {
      this.holds.delete(playerId);
      if (this.dead || this.phase !== 'mini') return;
      fn();
    }, WRONG_FREEZE_MS);
    timer.unref();
    this.holds.set(playerId, timer);
  }

  clearHold(playerId) {
    const timer = this.holds.get(playerId);
    if (timer) clearTimeout(timer);
    this.holds.delete(playerId);
  }

  clearHolds() {
    for (const timer of this.holds.values()) clearTimeout(timer);
    this.holds.clear();
  }

  miniCards() {
    const step = this.step();
    if (!step || step.type !== 'mini' || !step.theme) return [];
    return step.theme.cards;
  }

  openBet() {
    if (this.dead || !this.guardOnline()) return;
    this.phase = 'bet';
    this.betAmount.clear();
    this.betLocked.clear();
    this.answers.clear();
    this.revealRows = null;
    this.soon = false;
    this.lockEmptyBets();
    const readOnly = !this.someoneCanBet();
    this.arm(readOnly ? EMPTY_BET_MS : BET_MS, () => this.closeBet());
    this.emit(false);
    if (!readOnly) this.maybeCloseEarly();
  }

  someoneCanBet() {
    return this.onlineIds().some((id) => this.purse(id) > 0);
  }

  lockEmptyBets() {
    if (this.phase !== 'bet') return;
    for (const id of this.onlineIds()) {
      if (this.purse(id) > 0 || this.betLocked.has(id)) continue;
      this.betAmount.set(id, 0);
      this.betLocked.add(id);
    }
  }

  closeBet() {
    if (this.phase !== 'bet') return;
    this.soon = false;
    this.openGap('final');
  }

  openFinalRules() {
    if (this.dead || !this.guardOnline()) return;
    this.phase = 'final_rules';
    this.answers.clear();
    this.revealRows = null;
    this.soon = false;
    this.arm(briefMs(this.linesText(this.finalLines())), () => this.openRead('bet'));
    this.emit(false);
  }

  openFinal() {
    if (this.dead || !this.guardOnline()) return;
    this.phase = 'final';
    this.answers.clear();
    this.revealRows = null;
    this.soon = false;
    this.arm(FINAL_ANSWER_MS, () => this.closeAsk());
    this.emit(false);
  }

  advance() {
    if (this.dead) return;
    this.stepIndex += 1;
    if (this.stepIndex >= this.steps.length) {
      this.finish();
      return;
    }
    this.openStep();
  }

  finish() {
    if (this.dead || this.phase === 'over') return;
    this.freshToken();
    this.endsAt = 0;
    this.limit = 0;
    this.phase = 'over';
    this.revealRows = null;
    const places = (this.podium() || []).map((seat) => seat.id);
    this.state.awardCups('quiz', places);
    this.emit(true);
  }

  scoreAsk() {
    const step = this.step();
    const correct = step && step.question ? step.question.correct : -1;
    const finalRound = this.phase === 'final';
    const winners = [];
    for (const [id, row] of this.answers) {
      if (row.option === correct && this.roster.includes(id)) winners.push({ id, at: row.at, seq: row.seq });
    }
    winners.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const awarded = new Map();
    winners.forEach((row, index) => {
      let delta = 100;
      if (finalRound) delta = this.betAmount.get(row.id) || 0;
      else if (index === 0) delta = 300;
      else if (index === 1) delta = 200;
      awarded.set(row.id, {
        delta,
        place: index + 1,
      });
    });
    this.revealRows = this.roster.map((id) => {
      const answer = this.answers.get(id);
      const hit = awarded.get(id);
      let delta = 0;
      if (hit) delta = hit.delta;
      else if (finalRound) delta = -(this.betAmount.get(id) || 0);
      return {
        id,
        option: answer ? answer.option : null,
        delta: this.grant(id, delta),
        ok: !!hit,
        place: hit ? hit.place : 0,
      };
    });
  }

  grant(id, delta) {
    const player = this.state.players.get(id);
    if (!player) return 0;
    const before = player.score;
    const floor = this.base.has(id) ? this.base.get(id) : 0;
    this.state.applyScore(id, delta, floor);
    return player.score - before;
  }

  purse(id) {
    const player = this.state.players.get(id);
    if (!player) return 0;
    const floor = this.base.has(id) ? this.base.get(id) : 0;
    return Math.max(0, player.score - floor);
  }

  step() {
    return this.steps[this.stepIndex] || null;
  }

  nameOf(id) {
    const player = this.state.players.get(id);
    return player ? player.nickname : '';
  }

  onlineIds() {
    const ids = [];
    for (const id of this.roster) {
      const player = this.state.players.get(id);
      if (player && player.isOnline) ids.push(id);
    }
    return ids;
  }

  everyone(pred) {
    const ids = this.onlineIds();
    return ids.length > 0 && ids.every(pred);
  }

  guardOnline() {
    if (this.dead || this.phase === 'over') return !this.dead;
    if (this.onlineIds().length) return true;
    if (this.hooks.onAbort) this.hooks.onAbort('Все игроки вышли из викторины');
    return false;
  }

  closeSoon(fn, wait) {
    if (this.soon || this.dead) return;
    this.soon = true;
    const token = this.freshToken();
    const gap = Number.isFinite(wait) ? wait : CLOSE_GAP;
    this.timer = setTimeout(() => {
      this.soon = false;
      if (this.dead || token !== this.token) return;
      fn();
    }, gap);
    this.timer.unref();
  }

  arm(ms, fn) {
    const token = this.freshToken();
    this.limit = ms;
    this.endsAt = Date.now() + ms;
    this.timer = setTimeout(() => {
      if (this.dead || token !== this.token) return;
      this.endsAt = 0;
      fn();
    }, ms);
    this.timer.unref();
  }

  freshToken() {
    this.token += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return this.token;
  }

  laterEmit() {
    if (this.later || this.dead) return;
    this.later = setTimeout(() => {
      this.later = null;
      if (!this.dead) this.emit(false);
    }, 180);
    this.later.unref();
  }

  emit(withScores) {
    if (this.dead) return;
    this.io.emit('quiz_state', this.view());
    this.sendMines();
    if (withScores && this.hooks.onScores) this.hooks.onScores();
  }

  sendMines() {
    const sockets = this.io.sockets && this.io.sockets.sockets;
    if (!sockets) return;
    for (const id of this.roster) {
      const player = this.state.players.get(id);
      if (!player || !player.socketId) continue;
      const socket = sockets.get(player.socketId);
      if (socket) socket.emit('quiz_mine', this.mine(id));
    }
  }

  mine(playerId) {
    const answer = this.answers.get(playerId);
    const swipe = this.phase === 'mini' || this.phase === 'mini_board';
    const cards = swipe ? this.miniCards() : [];
    const prog = this.progress.get(playerId);
    const card = this.phase === 'mini' && prog && cards[prog.index] ? cards[prog.index] : null;
    return {
      option: answer ? answer.option : null,
      up: null,
      bet: this.betAmount.has(playerId) ? this.betAmount.get(playerId) : null,
      betLocked: this.betLocked.has(playerId),
      card: card ? card.text : null,
      index: prog ? prog.index : 0,
      total: cards.length,
      hits: swipe ? (this.roundHits.get(playerId) || 0) : null,
      busy: !!(prog && prog.busy),
      seq: prog ? prog.seq : 0,
      lastOk: prog ? prog.lastOk : null,
    };
  }

  kicker() {
    const step = this.step();
    if (this.phase === 'over') return 'Итог';
    if (this.phase === 'mini_board') return 'Итог свайпа';
    if (!step) return 'Викторина';
    if (step.type === 'mini') return 'Свайп';
    if (step.type === 'final') return 'Финал';
    return 'Вопрос ' + step.number + ' из ' + QUESTION_COUNT;
  }

  hint() {
    if (this.phase === 'count') return 'Приготовьтесь';
    if (this.phase === 'read' || this.phase === 'gap') return '';
    if (this.phase === 'ask') return 'Верный ответ: 300 первому, 200 второму, 100 остальным';
    if (this.phase === 'reveal' || this.phase === 'final_reveal') return 'Верный ответ подсвечен';
    if (this.phase === 'bet') return '';
    if (this.phase === 'final') return 'Выберите ответ';
    if (this.phase === 'over') return 'Кубки за места уже у аватаров. Ведущий вернёт всех в лобби';
    return '';
  }

  showingResults() {
    return this.phase === 'reveal' || this.phase === 'final_reveal';
  }

  readyIds() {
    if (this.phase === 'ask' || this.phase === 'final') return [...this.answers.keys()];
    if (this.phase === 'bet') return [...this.betLocked];
    if (this.phase === 'mini') {
      const total = this.miniCards().length;
      return this.roster.filter((id) => {
        const prog = this.progress.get(id);
        return prog && !prog.busy && prog.index >= total;
      });
    }
    return [];
  }

  rosterView() {
    return this.roster.map((id) => {
      const player = this.state.players.get(id);
      return {
        id,
        nickname: player ? player.nickname : 'Игрок',
        avatar: player ? player.avatar : '❔',
        score: player ? player.score : 0,
        cups: this.state.cupsPublic(player),
        purse: this.purse(id),
        online: !!(player && player.isOnline),
        seen: this.phase === 'mini' && this.progress.has(id) ? this.progress.get(id).index : null,
        cards: this.phase === 'mini' ? this.miniCards().length : null,
      };
    });
  }

  betView() {
    const step = this.step();
    const showBets = this.phase === 'bet' || this.phase === 'final' || this.phase === 'final_reveal'
      || (this.phase === 'gap' && step && step.type === 'final');
    if (!showBets) return null;
    return this.roster.map((id) => ({
      id,
      amount: this.betAmount.get(id) || 0,
      locked: this.betLocked.has(id),
    }));
  }

  podium() {
    if (this.phase !== 'over') return null;
    return this.rosterView().sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, 'ru'));
  }

  miniLines(theme) {
    return [
      { text: 'Да — ' + theme.up, tone: 'up' },
      { text: 'Нет — ' + theme.down, tone: 'down' },
      { text: (SWIPE_MS / 1000) + ' секунд. Верный — сразу дальше и ' + SWIPE_POINTS + ' очков. Ошибка — короткая пауза.' },
    ];
  }

  finalLines() {
    return [
      { text: 'Ставите очки, набранные в этой викторине.' },
      { text: 'Сначала вопрос. Варианты — после ставки.' },
      { text: 'Верный ответ приносит ставку, ошибка её забирает.' },
    ];
  }

  linesText(lines) {
    return (lines || []).map((line) => line.text).join(' ');
  }

  ruleLines() {
    const step = this.step();
    if (this.phase === 'mini_intro' && step && step.theme) return this.miniLines(step.theme);
    if (this.phase === 'final_rules') return this.finalLines();
    if (this.phase === 'bet' && step && step.question) return [{ text: step.question.text }];
    return null;
  }

  boardRow(id, place, points, extra) {
    const player = this.state.players.get(id);
    const more = extra || {};
    return {
      id,
      place,
      points,
      hits: more.hits == null ? null : more.hits,
      total: more.total == null ? null : more.total,
      nickname: player ? player.nickname : 'Игрок',
      avatar: player ? player.avatar : '❔',
    };
  }

  speedBoard() {
    const rows = (this.revealRows || []).filter((row) => row.ok && row.place > 0);
    rows.sort((a, b) => a.place - b.place);
    return rows.map((row) => this.boardRow(row.id, row.place, row.delta));
  }

  miniBoard() {
    const total = this.miniCards().length;
    const rows = this.roster.map((id) => ({
      id,
      points: this.roundPoints.get(id) || 0,
      hits: this.roundHits.get(id) || 0,
    }));
    rows.sort((a, b) => b.points - a.points || b.hits - a.hits || this.nameOf(a.id).localeCompare(this.nameOf(b.id), 'ru'));
    let place = 0;
    let prev = null;
    return rows.map((row, index) => {
      if (prev == null || row.points !== prev) {
        place = index + 1;
        prev = row.points;
      }
      return this.boardRow(row.id, place, row.points, { hits: row.hits, total });
    });
  }

  boardView() {
    if (this.phase === 'reveal' || this.phase === 'final_reveal') return this.speedBoard();
    if (this.phase === 'mini' || this.phase === 'mini_board') return this.miniBoard();
    return null;
  }

  view() {
    const step = this.step();
    const question = step && step.question ? step.question : null;
    const showOptions = question && (
      this.phase === 'ask'
      || this.phase === 'reveal'
      || this.phase === 'final'
      || this.phase === 'final_reveal'
    );
    const showCorrect = this.phase === 'reveal' || this.phase === 'final_reveal';
    let text = null;
    if (this.phase === 'final_rules') text = 'Как устроен финал';
    else if (this.phase === 'mini_board') text = 'Кто как ответил';
    else if (this.phase === 'bet') text = 'Поставьте ставку';
    else if (this.phase !== 'count' && this.phase !== 'over' && step) {
      if (step.type === 'mini') text = step.theme.title;
      else if (question) text = question.text;
    }
    return {
      phase: this.phase,
      kicker: this.kicker(),
      hint: this.hint(),
      count: this.phase === 'count' ? this.count : null,
      text,
      rules: this.ruleLines(),
      options: showOptions ? question.options.slice() : null,
      correct: showCorrect && question ? question.correct : null,
      ready: this.readyIds(),
      results: this.showingResults() ? this.revealRows : null,
      board: this.boardView(),
      limit: this.endsAt ? this.limit : null,
      left: this.endsAt ? Math.max(0, this.endsAt - Date.now()) : null,
      roster: this.rosterView(),
      up: step && step.type === 'mini' ? step.theme.up : null,
      down: step && step.type === 'mini' ? step.theme.down : null,
      cardYes: null,
      bets: this.betView(),
      podium: this.podium(),
    };
  }
}

module.exports = { Quiz };
