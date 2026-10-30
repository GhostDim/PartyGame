const fs = require('fs');
const path = require('path');

const TRACK = 50;
const TURN_MS = 60000;

const MODES = [
  null,
  {
    id: 'explain',
    title: 'Объясни словами',
    hint: 'Нельзя произносить само слово и однокоренные.',
  },
  {
    id: 'reverse',
    title: 'Наоборот',
    hint: 'Прочитайте слово задом наперёд. Вслух — перевёрнутая запись.',
  },
  {
    id: 'draw',
    title: 'Нарисуй',
    hint: 'Рисуйте на бумаге. Без букв и без подсказок голосом.',
  },
  {
    id: 'sculpt',
    title: 'Слепи',
    hint: 'Слепите из пластилина. Без слов.',
  },
  {
    id: 'yesno',
    title: 'Да или нет',
    hint: 'Назовите тему вслух. Дальше отвечайте только «да» или «нет».',
  },
  {
    id: 'packs',
    title: 'Скажи где',
    hint: 'Объясните словами все пять слов. Очки, если отгадали весь набор.',
  },
];

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

function cleanWord(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function usableWord(value) {
  const word = cleanWord(value);
  return word.length >= 2 && word.length <= 40;
}

function wordList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const list = [];
  raw.forEach((item) => {
    const word = cleanWord(item);
    const key = word.toLocaleLowerCase('ru');
    if (!usableWord(word) || seen.has(key)) return;
    seen.add(key);
    list.push(word);
  });
  return list;
}

function pairList(raw, read) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const list = [];
  raw.forEach((item) => {
    const row = read(item);
    if (!row) return;
    const key = row.key;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(row.value);
  });
  return list;
}

function reversed(word) {
  return Array.from(word).reverse().join('');
}

function sameCard(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a.word && a.word === b.word && a.theme === b.theme) return true;
  if (a.theme && a.words && b.words && a.theme === b.theme && a.words.join('|') === b.words.join('|')) return true;
  return false;
}

function readBank() {
  if (bankCache) return bankCache;
  try {
    const file = path.join(__dirname, '..', 'content', 'ekivoki.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const explain = wordList(raw.explain);
    const reverse = wordList(raw.reverse);
    const draw = wordList(raw.draw);
    const sculpt = wordList(raw.sculpt);
    const yesno = pairList(raw.yesno, (item) => {
      if (!item) return null;
      const word = cleanWord(item.word);
      const theme = cleanWord(item.theme);
      if (!usableWord(word) || !usableWord(theme)) return null;
      return {
        key: word.toLocaleLowerCase('ru') + '|' + theme.toLocaleLowerCase('ru'),
        value: { word, theme },
      };
    });
    const packs = pairList(raw.packs, (item) => {
      if (!item) return null;
      const theme = cleanWord(item.theme);
      const words = wordList(item.words);
      if (!usableWord(theme) || words.length !== 5) return null;
      return {
        key: theme.toLocaleLowerCase('ru') + '|' + words.join('|').toLocaleLowerCase('ru'),
        value: { theme, words },
      };
    });
    if (explain.length < 8 || reverse.length < 8 || draw.length < 8 || sculpt.length < 8) return null;
    if (yesno.length < 8 || packs.length < 4) return null;
    bankCache = { explain, reverse, draw, sculpt, yesno, packs };
    return bankCache;
  } catch (err) {
    return null;
  }
}

class Ekivoki {
  constructor(io, state, hooks) {
    this.io = io;
    this.state = state;
    this.hooks = hooks || {};
    this.dead = false;
    this.problem = '';
    this.phase = 'roll';
    this.roster = [];
    this.cells = new Map();
    this.turnId = null;
    this.turnNo = 0;
    this.face = 0;
    this.card = null;
    this.clock = null;
    this.endsAt = 0;
    this.limit = 0;
    this.token = 0;
    this.timer = null;
    this.banks = null;
    this.decks = null;
    this.last = new Map();
  }

  init() {
    const bank = readBank();
    if (!bank) {
      this.problem = 'Не удалось прочитать колоду экивоки';
      return false;
    }
    this.banks = bank;
    this.decks = {
      explain: shuffle(bank.explain.slice()),
      reverse: shuffle(bank.reverse.slice()),
      draw: shuffle(bank.draw.slice()),
      sculpt: shuffle(bank.sculpt.slice()),
      yesno: shuffle(bank.yesno.slice()),
      packs: shuffle(bank.packs.slice()),
    };
    this.roster = [];
    this.cells = new Map();
    for (const player of this.state.players.values()) {
      if (!player.isOnline) continue;
      this.roster.push(player.id);
      this.cells.set(player.id, 1);
      player.score = 1;
    }
    if (this.roster.length < 2) {
      this.problem = 'Для «Экивоки» нужны минимум 2 игрока в сети';
      return false;
    }
    this.turnId = this.roster[0];
    this.turnNo = 0;
    console.log('Экивоки: ' + this.roster.length + ' игроков, финиш на ' + TRACK);
    this.openRoll(true);
    return true;
  }

  onPlayerJoin(playerId) {
    if (this.dead) return;
    if (this.phase === 'over') {
      this.emit(false);
      return;
    }
    if (!playerId || !this.roster.includes(playerId)) {
      this.emit(false);
      return;
    }
    const player = this.state.players.get(playerId);
    if (playerId === this.turnId && player && this.phase !== 'play') {
      if (player.isOnline && this.clock === 'away') this.resumeTurn();
      else if (!player.isOnline && this.clock !== 'away') this.markAway();
    }
    this.emit(false);
  }

  onPlayerLeave(playerId) {
    if (this.dead || !this.roster.includes(playerId)) return;
    const index = this.roster.indexOf(playerId);
    const wasTurn = this.turnId === playerId;
    const nextId = this.roster[(index + 1) % this.roster.length];
    this.roster.splice(index, 1);
    this.cells.delete(playerId);
    if (!this.roster.length) {
      if (this.hooks.onAbort) this.hooks.onAbort('Все игроки вышли из экивоки');
      return;
    }
    if (this.phase === 'over') {
      this.emit(false);
      return;
    }
    if (wasTurn) {
      this.turnId = this.roster.includes(nextId) ? nextId : this.roster[0];
      this.openRoll(false);
      return;
    }
    if (!this.roster.includes(this.turnId)) this.turnId = this.roster[0];
    this.emit(false);
  }

  onAction(playerId, data) {
    if (this.dead || !data) return;
    const player = this.state.players.get(playerId);
    if (!player || !player.isOnline) return;
    if (player.isHost && data.type === 'cells') {
      this.applyCells(data.cells);
      return;
    }
    if (player.isHost && data.type === 'skip') {
      this.resolve(false);
      return;
    }
    if (playerId !== this.turnId || !this.roster.includes(playerId)) return;
    if (data.type === 'roll') this.roll();
    else if (data.type === 'start') this.startTurn();
    else if (data.type === 'claim') this.resolve(true);
    else if (data.type === 'fail') this.resolve(false);
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.bump();
    this.io.emit('ekivoki_state', null);
  }

  roll() {
    if (this.phase !== 'roll') return;
    const face = 1 + Math.floor(Math.random() * 6);
    const card = this.deal(face);
    if (!card) return;
    this.face = face;
    this.card = card;
    this.phase = 'read';
    this.clearTimer();
    const player = this.state.players.get(this.turnId);
    if (player && !player.isOnline) this.markAway();
    this.emit(false);
  }

  startTurn() {
    if (this.phase !== 'read' || !this.card) return;
    this.phase = 'play';
    this.clock = 'play';
    this.arm(TURN_MS, () => this.resolve(false));
    this.emit(false);
  }

  resolve(success) {
    if (this.dead || this.phase === 'over') return;
    const face = this.face;
    if (success) {
      if (this.phase !== 'play') return;
      if (!this.endsAt || Date.now() >= this.endsAt) return;
      if (face < 1 || face > 6) return;
    } else if (this.phase !== 'play' && this.phase !== 'roll' && this.phase !== 'read') {
      return;
    }
    const id = this.turnId;
    this.clearTimer();
    this.card = null;
    if (success) {
      const cell = Math.min(TRACK, (this.cells.get(id) || 1) + face);
      this.cells.set(id, cell);
      this.syncScore(id);
      if (this.reachedFinish()) {
        this.finish();
        return;
      }
    }
    this.advance(success);
  }

  applyCells(list) {
    if (this.phase === 'over' || !Array.isArray(list)) return;
    const seen = new Set();
    let changed = false;
    list.slice(0, this.roster.length).forEach((row) => {
      if (!row || seen.has(row.id) || !this.roster.includes(row.id)) return;
      seen.add(row.id);
      let cell = Math.round(Number(row.cell));
      if (!Number.isFinite(cell)) return;
      cell = Math.max(1, Math.min(TRACK, cell));
      if (this.cells.get(row.id) === cell) return;
      this.cells.set(row.id, cell);
      this.syncScore(row.id);
      changed = true;
    });
    if (!changed) return;
    if (this.reachedFinish()) this.finish();
    else this.emit(true);
  }

  advance(scored) {
    if (this.dead || !this.roster.length) return;
    const index = this.roster.indexOf(this.turnId);
    const next = index < 0 ? 0 : (index + 1) % this.roster.length;
    this.turnId = this.roster[next];
    this.openRoll(!!scored);
  }

  openRoll(scored) {
    this.turnNo += 1;
    this.phase = 'roll';
    this.face = 0;
    this.card = null;
    this.clearTimer();
    const player = this.state.players.get(this.turnId);
    if (player && !player.isOnline) this.markAway();
    this.emit(!!scored);
  }

  finish() {
    if (this.dead || this.phase === 'over') return;
    this.clearTimer();
    this.phase = 'over';
    this.face = 0;
    this.card = null;
    this.state.awardPlaces('ekivoki', this.ranked());
    this.emit(true);
  }

  deal(face) {
    const mode = MODES[face];
    if (!mode) return null;
    if (mode.id === 'packs') {
      const pack = this.pull('packs');
      if (!pack) return null;
      return { theme: pack.theme, words: pack.words.slice() };
    }
    if (mode.id === 'yesno') {
      const row = this.pull('yesno');
      if (!row) return null;
      return { word: row.word, theme: row.theme };
    }
    const word = this.pull(mode.id);
    if (!word) return null;
    return { word };
  }

  pull(key) {
    let deck = this.decks[key];
    if (!deck.length) {
      deck = shuffle(this.banks[key].slice());
      const last = this.last.get(key);
      if (last != null && deck.length > 1 && sameCard(deck[deck.length - 1], last)) {
        deck.unshift(deck.pop());
      }
      this.decks[key] = deck;
    }
    const card = deck.pop();
    this.last.set(key, card);
    return card;
  }

  reachedFinish() {
    for (const cell of this.cells.values()) {
      if (cell >= TRACK) return true;
    }
    return false;
  }

  syncScore(id) {
    const player = this.state.players.get(id);
    if (player) player.score = this.cells.get(id) || 1;
  }

  ranked() {
    const rows = this.roster.map((id) => {
      const player = this.state.players.get(id);
      return {
        id,
        cell: this.cells.get(id) || 1,
        nickname: player ? player.nickname : 'Игрок',
        avatar: player ? player.avatar : '❔',
        online: !!(player && player.isOnline),
      };
    });
    rows.sort((a, b) => b.cell - a.cell || a.nickname.localeCompare(b.nickname, 'ru'));
    let place = 0;
    let prev = null;
    return rows.map((row, index) => {
      if (prev == null || row.cell !== prev) {
        place = index + 1;
        prev = row.cell;
      }
      const player = this.state.players.get(row.id);
      return {
        id: row.id,
        cell: row.cell,
        nickname: row.nickname,
        avatar: row.avatar,
        online: row.online,
        place,
        cups: this.state.cupsPublic(player),
      };
    });
  }

  rosterView() {
    return this.roster.map((id) => {
      const player = this.state.players.get(id);
      return {
        id,
        nickname: player ? player.nickname : 'Игрок',
        avatar: player ? player.avatar : '❔',
        cell: this.cells.get(id) || 1,
        online: !!(player && player.isOnline),
        cups: this.state.cupsPublic(player),
      };
    });
  }

  bump() {
    this.token += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return this.token;
  }

  clearTimer() {
    this.bump();
    this.endsAt = 0;
    this.limit = 0;
    this.clock = null;
  }

  markAway() {
    if (this.clock === 'away' || this.phase === 'over' || this.phase === 'play') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.token += 1;
    this.endsAt = 0;
    this.limit = 0;
    this.clock = 'away';
  }

  resumeTurn() {
    if (this.clock !== 'away') return;
    this.clock = null;
  }

  arm(ms, fn) {
    const token = this.bump();
    this.endsAt = Date.now() + ms;
    this.limit = ms;
    this.timer = setTimeout(() => {
      if (this.dead || token !== this.token) return;
      this.endsAt = 0;
      this.limit = 0;
      this.clock = null;
      fn();
    }, ms);
    if (this.timer.unref) this.timer.unref();
  }

  emit(withScores) {
    if (this.dead) return;
    this.io.emit('ekivoki_state', this.view());
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
      if (socket) socket.emit('ekivoki_mine', this.mine(id));
    }
  }

  mine(playerId) {
    const open = playerId === this.turnId && this.card && (this.phase === 'read' || this.phase === 'play');
    if (!open) return { secret: false, turnNo: this.turnNo };
    const mode = MODES[this.face];
    const card = this.card;
    return {
      secret: true,
      turnNo: this.turnNo,
      hint: mode ? mode.hint : '',
      word: card.word || '',
      say: mode && mode.id === 'reverse' ? reversed(card.word) : '',
      theme: card.theme || '',
      words: card.words || null,
    };
  }

  view() {
    const mode = MODES[this.face];
    return {
      phase: this.phase,
      track: TRACK,
      turnId: this.turnId,
      turnNo: this.turnNo,
      face: this.face || 0,
      mode: mode ? { title: mode.title } : null,
      clock: this.clock,
      left: this.endsAt ? Math.max(0, this.endsAt - Date.now()) : null,
      limit: this.limit || null,
      roster: this.rosterView(),
      podium: this.phase === 'over' ? this.ranked() : null,
    };
  }
}

module.exports = { Ekivoki };
