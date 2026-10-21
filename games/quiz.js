const fs = require('fs');
const path = require('path');

const COUNT_MS = 1000;
const REVEAL_MS = 5000;
const MINI_INTRO_MS = 4000;
const MINI_CARD_MS = 3200;
const MINI_FLASH_MS = 900;
const BET_MS = 15000;
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
    if (!this.guardOnline()) return;
    this.emit(false);
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
    if (this.phase !== 'mini' || this.swipes.has(playerId)) return;
    if (typeof up !== 'boolean') return;
    this.swipes.set(playerId, up);
    this.emit(false);
    this.maybeCloseEarly();
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
    } else if (this.phase === 'mini' && this.everyone((id) => this.swipes.has(id))) {
      this.closeSoon(() => this.closeCard());
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
    if (step.type === 'question') this.startCount(() => this.openAsk());
    else if (step.type === 'mini') this.openMini();
    else this.startCount(() => this.openBet());
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
    this.arm(MINI_INTRO_MS, () => this.openCard());
    this.emit(false);
  }

  openCard() {
    if (this.dead || !this.guardOnline()) return;
    const step = this.step();
    const cards = step && step.theme ? step.theme.cards : [];
    if (this.cardIndex >= cards.length) {
      this.advance();
      return;
    }
    this.phase = 'mini';
    this.swipes.clear();
    this.revealRows = null;
    this.soon = false;
    this.arm(MINI_CARD_MS, () => this.closeCard());
    this.emit(false);
  }

  closeCard() {
    if (this.phase !== 'mini') return;
    this.soon = false;
    this.scoreCard();
    this.phase = 'mini_flash';
    this.endsAt = 0;
    this.limit = 0;
    this.emit(true);
    this.arm(MINI_FLASH_MS, () => {
      this.cardIndex += 1;
      this.openCard();
    });
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
    this.arm(readOnly ? MINI_INTRO_MS : BET_MS, () => this.closeBet());
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
    this.openFinal();
  }

  openFinal() {
    if (this.dead || !this.guardOnline()) return;
    const step = this.step();
    this.phase = 'final';
    this.answers.clear();
    this.revealRows = null;
    this.soon = false;
    const seconds = step && step.question ? step.question.seconds : 20;
    this.arm(seconds * 1000, () => this.closeAsk());
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
        place: finalRound ? 0 : index + 1,
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

  scoreCard() {
    const card = this.currentCard();
    const yes = !!(card && card.yes);
    this.revealRows = this.roster.map((id) => {
      const picked = this.swipes.has(id) ? this.swipes.get(id) : null;
      const ok = picked !== null && picked === yes;
      return {
        id,
        option: null,
        delta: ok ? this.grant(id, SWIPE_POINTS) : 0,
        ok,
        place: 0,
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

  currentCard() {
    const step = this.step();
    if (!step || step.type !== 'mini') return null;
    return step.theme.cards[this.cardIndex] || null;
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

  closeSoon(fn) {
    if (this.soon || this.dead) return;
    this.soon = true;
    const token = this.freshToken();
    this.timer = setTimeout(() => {
      this.soon = false;
      if (this.dead || token !== this.token) return;
      fn();
    }, CLOSE_GAP);
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
    return {
      option: answer ? answer.option : null,
      up: this.swipes.has(playerId) ? this.swipes.get(playerId) : null,
      bet: this.betAmount.has(playerId) ? this.betAmount.get(playerId) : null,
      betLocked: this.betLocked.has(playerId),
    };
  }

  kicker() {
    const step = this.step();
    if (this.phase === 'over') return 'Итог';
    if (!step) return 'Викторина';
    if (step.type === 'mini') {
      if (this.phase === 'mini_intro') return 'Свайп';
      return 'Свайп ' + (this.cardIndex + 1) + ' из ' + step.theme.cards.length;
    }
    if (step.type === 'final') return 'Финал';
    return 'Вопрос ' + step.number + ' из ' + QUESTION_COUNT;
  }

  hint() {
    const step = this.step();
    if (this.phase === 'count') return 'Приготовьтесь';
    if (this.phase === 'ask') return 'Верный ответ: 300 первому, 200 второму, 100 остальным';
    if (this.phase === 'reveal' || this.phase === 'final_reveal') return 'Верный ответ подсвечен';
    if (this.phase === 'mini_intro' && step && step.theme) return step.theme.hint;
    if (this.phase === 'mini' && step && step.theme) {
      return 'Вверх — ' + step.theme.up + '. Вниз — ' + step.theme.down + '.';
    }
    if (this.phase === 'mini_flash' && step && step.theme) {
      const card = this.currentCard();
      if (!card) return '';
      return card.yes ? '↑ ' + step.theme.up : '↓ ' + step.theme.down;
    }
    if (this.phase === 'bet') return 'Поставьте очки этой викторины. Потом появятся варианты.';
    if (this.phase === 'final') return 'Выберите ответ';
    if (this.phase === 'over') return 'Кубки за места уже у аватаров. Ведущий вернёт всех в лобби';
    return '';
  }

  showingResults() {
    return this.phase === 'reveal' || this.phase === 'final_reveal' || this.phase === 'mini_flash';
  }

  readyIds() {
    if (this.phase === 'ask' || this.phase === 'final') return [...this.answers.keys()];
    if (this.phase === 'bet') return [...this.betLocked];
    if (this.phase === 'mini') return [...this.swipes.keys()];
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
      };
    });
  }

  betView() {
    if (this.phase !== 'bet' && this.phase !== 'final' && this.phase !== 'final_reveal') return null;
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
    const card = this.currentCard();
    let text = null;
    if (this.phase !== 'count' && this.phase !== 'over' && step) {
      if (step.type === 'mini') text = this.phase === 'mini_intro' ? step.theme.title : (card ? card.text : null);
      else if (question) text = question.text;
    }
    return {
      phase: this.phase,
      kicker: this.kicker(),
      hint: this.hint(),
      count: this.phase === 'count' ? this.count : null,
      text,
      options: showOptions ? question.options.slice() : null,
      correct: showCorrect && question ? question.correct : null,
      ready: this.readyIds(),
      results: this.showingResults() ? this.revealRows : null,
      limit: this.endsAt ? this.limit : null,
      left: this.endsAt ? Math.max(0, this.endsAt - Date.now()) : null,
      roster: this.rosterView(),
      up: step && step.type === 'mini' ? step.theme.up : null,
      down: step && step.type === 'mini' ? step.theme.down : null,
      cardYes: this.phase === 'mini_flash' && card ? card.yes : null,
      bets: this.betView(),
      podium: this.podium(),
    };
  }
}

module.exports = { Quiz };
