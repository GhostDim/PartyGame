const CAST_MS = 10000;
const COUNT_STEP = 1000;
const CELL_MS = 700;
const GAP_MS = 250;
const TAIL_MS = 400;
const INPUT_MS = 60000;
const BEAT_MS = 2000;
const MAX_LEN = 15;
const SIDES = ['left', 'right'];

function cleanTeamName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) return '';
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,15}$/u.test(name)) return null;
  if (name.length < 2) return null;
  return name;
}

function randomCell() {
  return Math.floor(Math.random() * 9);
}

function pickDonor(pool, avoid) {
  const list = [];
  const seen = new Set();
  pool.forEach((id) => {
    if (!id || id === avoid || seen.has(id)) return;
    seen.add(id);
    list.push(id);
  });
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function pair(leftId, leftBorrowed, rightId, rightBorrowed) {
  return {
    left: { id: leftId, borrowed: !!leftBorrowed, home: leftBorrowed ? 'right' : 'left' },
    right: { id: rightId, borrowed: !!rightBorrowed, home: rightBorrowed ? 'left' : 'right' },
  };
}

function buildDuels(leftIds, rightIds, seededLeft, seededRight) {
  const left = leftIds.slice();
  const right = rightIds.slice();
  const playedLeft = seededLeft.slice();
  const playedRight = seededRight.slice();
  const duels = [];
  while (left.length || right.length) {
    if (left.length && right.length) {
      const a = left.shift();
      const b = right.shift();
      duels.push(pair(a, false, b, false));
      playedLeft.push(a);
      playedRight.push(b);
      continue;
    }
    if (left.length) {
      const a = left[0];
      const donor = pickDonor(playedLeft, a);
      if (!donor) break;
      left.shift();
      duels.push(pair(a, false, donor, true));
      playedLeft.push(a);
      continue;
    }
    const b = right[0];
    const donor = pickDonor(playedRight, b);
    if (!donor) break;
    right.shift();
    duels.push(pair(donor, true, b, false));
    playedRight.push(b);
  }
  return duels;
}

class Echo {
  constructor(io, state, hooks) {
    this.io = io;
    this.state = state;
    this.hooks = hooks || {};
    this.dead = false;
    this.problem = '';
    this.phase = 'draft';
    this.teams = {
      left: { name: '', ids: [] },
      right: { name: '', ids: [] },
    };
    this.duels = [];
    this.duelIndex = 0;
    this.castKey = '';
    this.sequence = [];
    this.best = { left: 0, right: 0 };
    this.mark = { left: null, right: null };
    this.progress = { left: 0, right: 0 };
    this.scores = { left: 0, right: 0 };
    this.brought = new Map();
    this.done = { left: new Set(), right: new Set() };
    this.errors = new Map();
    this.scored = false;
    this.count = 0;
    this.lit = null;
    this.step = 0;
    this.note = '';
    this.endsAt = 0;
    this.token = 0;
    this.timer = null;
  }

  init() {
    let online = 0;
    for (const player of this.state.players.values()) {
      if (player.isOnline) online += 1;
    }
    if (online < 2) {
      this.problem = 'Для «Эхо» нужны минимум 2 игрока в сети';
      return false;
    }
    this.phase = 'draft';
    this.emit(false);
    return true;
  }

  onPlayerJoin(playerId) {
    if (this.dead || !playerId) return;
    if (this.phase === 'draft' || this.phase === 'over') {
      this.emit(false);
      return;
    }
    if (this.phase === 'wait' && !this.duelistOffline()) {
      this.present();
      return;
    }
    if ((this.phase === 'cast' || this.phase === 'count' || this.phase === 'show') && this.duelistOffline()) {
      this.enterWait();
      return;
    }
    this.emit(false);
  }

  onPlayerLeave(playerId) {
    if (this.dead || !playerId) return;
    if (this.phase === 'draft') {
      this.pull(playerId);
      if (!this.someoneOnline(playerId)) {
        if (this.hooks.onAbort) this.hooks.onAbort('Все игроки вышли из эхо');
        return;
      }
      this.note = '';
      this.emit(false);
      return;
    }
    if (this.phase === 'over') {
      this.pull(playerId);
      this.emit(false);
      return;
    }
    const duel = this.current();
    const inDuel = !!(duel && (duel.left.id === playerId || duel.right.id === playerId));
    this.pull(playerId);
    if (!this.teams.left.ids.length && !this.teams.right.ids.length) {
      if (this.hooks.onAbort) this.hooks.onAbort('Все игроки вышли из эхо');
      return;
    }
    if (!this.teams.left.ids.length || !this.teams.right.ids.length) {
      if (inDuel) this.settleOpen();
      this.scoreCurrent();
      this.finish();
      return;
    }
    if (inDuel) {
      this.settleOpen();
      this.scoreCurrent();
      this.rebuildTail();
      this.advance();
      return;
    }
    this.rebuildTail();
    this.emit(false);
  }

  onAction(playerId, data) {
    if (this.dead || !data) return;
    const player = this.state.players.get(playerId);
    if (!player || !player.isOnline) return;
    if (data.type === 'join') this.join(playerId, data.side);
    else if (data.type === 'name') this.rename(playerId, data.name);
    else if (data.type === 'begin') this.begin(player);
    else if (data.type === 'skip') this.skip(player);
    else if (data.type === 'tap') this.tap(playerId, data.cell);
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.bump();
    this.io.emit('echo_state', null);
  }

  join(playerId, side) {
    if (this.phase !== 'draft') return;
    if (side !== 'left' && side !== 'right') return;
    if (this.sideOf(playerId) === side) return;
    this.pull(playerId);
    this.teams[side].ids.push(playerId);
    this.errors.delete(playerId);
    this.note = '';
    this.emit(false);
  }

  rename(playerId, raw) {
    if (this.phase !== 'draft') return;
    const side = this.sideOf(playerId);
    if (!side) return;
    const name = cleanTeamName(raw);
    if (name == null) {
      this.errors.set(playerId, 'Название: 2–16 букв или цифр');
      this.emit(false);
      return;
    }
    this.errors.delete(playerId);
    this.teams[side].name = name;
    this.note = '';
    this.emit(false);
  }

  begin(player) {
    if (this.phase !== 'draft' || !player || !player.isHost) return;
    if (!this.sideOf(player.id)) {
      this.note = 'Сначала выберите сторону';
      this.emit(false);
      return;
    }
    if (!this.teams.left.ids.length || !this.teams.right.ids.length) {
      this.note = 'Нужны обе стороны';
      this.emit(false);
      return;
    }
    this.duels = buildDuels(this.teams.left.ids, this.teams.right.ids, [], []);
    if (!this.duels.length) {
      this.note = 'Не удалось собрать дуэли';
      this.emit(false);
      return;
    }
    this.duelIndex = 0;
    this.scores = { left: 0, right: 0 };
    this.brought = new Map();
    this.done = { left: new Set(), right: new Set() };
    this.note = '';
    console.log(
      'Эхо: ' + this.teamTitle('left') + ' ' + this.teams.left.ids.length
      + ', ' + this.teamTitle('right') + ' ' + this.teams.right.ids.length
      + ', дуэлей ' + this.duels.length
    );
    this.openDuel();
  }

  skip(player) {
    if (!player || !player.isHost) return;
    if (this.phase !== 'cast' && this.phase !== 'count' && this.phase !== 'show' && this.phase !== 'input' && this.phase !== 'wait') return;
    this.settleOpen();
    this.note = 'Дуэль снята. ' + this.gainNote();
    this.closeDuel();
  }

  tap(playerId, cell) {
    if (this.phase !== 'input') return;
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) return;
    const seat = this.seatOf(playerId);
    if (!seat || this.mark[seat] != null) return;
    const expect = this.sequence[this.progress[seat]];
    if (cell !== expect) {
      this.mark[seat] = false;
      this.progress[seat] += 1;
    } else {
      this.progress[seat] += 1;
      if (this.progress[seat] >= this.sequence.length) this.mark[seat] = true;
    }
    this.emit(false);
    if (this.mark.left != null && this.mark.right != null) this.finishInput();
  }

  finishInput() {
    if (this.phase !== 'input') return;
    this.phase = 'lock';
    const n = this.sequence.length;
    const okL = this.mark.left === true;
    const okR = this.mark.right === true;
    if (okL && okR) {
      this.best.left = n;
      this.best.right = n;
      if (n >= MAX_LEN) {
        this.note = 'Цепочка из ' + n + ' взята';
        this.closeDuel();
        return;
      }
      this.sequence.push(randomCell());
      this.note = 'Дальше длиннее';
      this.beginCount();
      return;
    }
    if (!okL && !okR) {
      this.note = 'Та же цепочка';
      this.beginCount();
      return;
    }
    if (okL) this.best.left = n;
    if (okR) this.best.right = n;
    this.note = this.gainNote();
    this.closeDuel();
  }

  settleOpen() {
    if (this.phase !== 'input') return;
    const n = this.sequence.length;
    if (this.mark.left === true) this.best.left = n;
    if (this.mark.right === true) this.best.right = n;
  }

  closeDuel() {
    this.scoreCurrent();
    this.phase = 'gap';
    this.lit = null;
    this.count = 0;
    this.emit(true);
    this.arm(BEAT_MS, () => this.advance());
  }

  advance() {
    if (this.dead || this.phase === 'over') return;
    if (!this.teams.left.ids.length || !this.teams.right.ids.length) {
      this.finish();
      return;
    }
    this.duelIndex += 1;
    if (this.duelIndex >= this.duels.length) {
      this.finish();
      return;
    }
    this.openDuel();
  }

  openDuel() {
    if (this.dead || this.phase === 'over') return;
    if (this.duelIndex >= this.duels.length) {
      this.finish();
      return;
    }
    const duel = this.current();
    if (!this.seatAlive(duel.left) || !this.seatAlive(duel.right)) {
      this.duels.splice(this.duelIndex, 1);
      this.openDuel();
      return;
    }
    this.scored = false;
    this.best = { left: 0, right: 0 };
    this.sequence = [randomCell()];
    this.note = '';
    this.castKey = '';
    this.present();
  }

  pairKey() {
    const duel = this.current();
    if (!duel) return '';
    return this.duelIndex + ':' + duel.left.id + ':' + duel.right.id;
  }

  present() {
    if (this.dead || this.phase === 'over') return;
    if (this.duelistOffline()) {
      this.enterWait();
      return;
    }
    if (this.castKey === this.pairKey()) {
      this.beginCount();
      return;
    }
    this.phase = 'cast';
    this.lit = null;
    this.count = 0;
    this.resetMarks();
    this.emit(false);
    this.arm(CAST_MS, () => {
      if (this.phase !== 'cast') return;
      this.castKey = this.pairKey();
      this.beginCount();
    });
  }

  beginCount() {
    if (this.dead) return;
    if (this.duelistOffline()) {
      this.enterWait();
      return;
    }
    this.phase = 'count';
    this.count = 3;
    this.lit = null;
    this.step = 0;
    this.resetMarks();
    this.emit(false);
    this.arm(COUNT_STEP, () => this.tickCount());
  }

  tickCount() {
    if (this.phase !== 'count') return;
    if (this.duelistOffline()) {
      this.enterWait();
      return;
    }
    this.count -= 1;
    if (this.count > 0) {
      this.emit(false);
      this.arm(COUNT_STEP, () => this.tickCount());
      return;
    }
    this.flashOn();
  }

  flashOn() {
    if (this.phase !== 'count' && this.phase !== 'show') return;
    if (this.duelistOffline()) {
      this.enterWait();
      return;
    }
    if (this.step >= this.sequence.length) {
      this.openInput();
      return;
    }
    this.phase = 'show';
    this.lit = this.sequence[this.step];
    this.emit(false, this.step === 0);
    this.arm(CELL_MS, () => this.flashOff());
  }

  flashOff() {
    if (this.phase !== 'show') return;
    if (this.duelistOffline()) {
      this.enterWait();
      return;
    }
    this.lit = null;
    this.step += 1;
    if (this.step >= this.sequence.length) {
      this.emit(false, false);
      this.arm(TAIL_MS, () => this.openInput());
      return;
    }
    this.emit(false, false);
    this.arm(GAP_MS, () => this.flashOn());
  }

  openInput() {
    if (this.dead) return;
    if (this.duelistOffline()) {
      this.enterWait();
      return;
    }
    this.phase = 'input';
    this.lit = null;
    this.count = 0;
    this.resetMarks();
    this.arm(INPUT_MS, () => this.finishInput());
    this.emit(false);
  }

  enterWait() {
    this.phase = 'wait';
    this.lit = null;
    this.count = 0;
    this.bump();
    this.emit(false);
  }

  finish() {
    if (this.dead || this.phase === 'over') return;
    this.bump();
    this.syncPlayerScores();
    const rows = this.placeRows();
    this.state.awardPlaces('echo', rows);
    this.phase = 'over';
    this.lit = null;
    this.count = 0;
    this.duelIndex = this.duels.length;
    console.log('Эхо: счёт ' + this.scores.left + ':' + this.scores.right);
    this.emit(true);
  }

  scoreCurrent() {
    if (this.scored) return;
    const duel = this.current();
    if (!duel) return;
    this.addPoints('left');
    this.addPoints('right');
    if (!duel.left.borrowed) this.done.left.add(duel.left.id);
    if (!duel.right.borrowed) this.done.right.add(duel.right.id);
    this.scored = true;
    this.syncPlayerScores();
  }

  addPoints(seatKey) {
    const gain = Math.max(0, this.best[seatKey] || 0);
    this.scores[seatKey] += gain;
    const duel = this.current();
    if (!duel) return;
    const id = duel[seatKey].id;
    const row = this.brought.get(id) || { left: 0, right: 0 };
    row[seatKey] += gain;
    this.brought.set(id, row);
  }

  rebuildTail() {
    const alive = (side, id) => this.teams[side].ids.includes(id);
    const rest = buildDuels(
      this.pendingIds('left'),
      this.pendingIds('right'),
      [...this.done.left].filter((id) => alive('left', id)),
      [...this.done.right].filter((id) => alive('right', id))
    );
    this.duels = this.duels.slice(0, this.duelIndex + 1).concat(rest);
  }

  pendingIds(side) {
    const skip = new Set(this.done[side]);
    const duel = this.current();
    if (duel && !this.scored && !duel[side].borrowed) skip.add(duel[side].id);
    return this.teams[side].ids.filter((id) => !skip.has(id));
  }

  resetMarks() {
    this.mark = { left: null, right: null };
    this.progress = { left: 0, right: 0 };
  }

  pull(playerId) {
    SIDES.forEach((side) => {
      const ids = this.teams[side].ids;
      const index = ids.indexOf(playerId);
      if (index < 0) return;
      ids.splice(index, 1);
      if (!ids.length && this.phase === 'draft') this.teams[side].name = '';
    });
    this.errors.delete(playerId);
  }

  sideOf(playerId) {
    if (this.teams.left.ids.includes(playerId)) return 'left';
    if (this.teams.right.ids.includes(playerId)) return 'right';
    return '';
  }

  seatOf(playerId) {
    const duel = this.current();
    if (!duel) return '';
    if (duel.left.id === playerId) return 'left';
    if (duel.right.id === playerId) return 'right';
    return '';
  }

  current() {
    return this.duels[this.duelIndex] || null;
  }

  seatAlive(seat) {
    if (!seat) return false;
    const player = this.state.players.get(seat.id);
    if (!player) return false;
    return this.teams[seat.home].ids.includes(seat.id);
  }

  duelistOffline() {
    const duel = this.current();
    if (!duel) return false;
    return [duel.left.id, duel.right.id].some((id) => {
      const player = this.state.players.get(id);
      return !player || !player.isOnline;
    });
  }

  someoneOnline(exceptId) {
    for (const player of this.state.players.values()) {
      if (player.id === exceptId) continue;
      if (player.isOnline) return true;
    }
    return false;
  }

  teamTitle(side) {
    const team = this.teams[side];
    if (team && team.name) return team.name;
    return side === 'left' ? 'Левые' : 'Правые';
  }

  gainNote() {
    return this.teamTitle('left') + ' +' + (this.best.left || 0)
      + ', ' + this.teamTitle('right') + ' +' + (this.best.right || 0);
  }

  person(id) {
    const player = this.state.players.get(id);
    return {
      id,
      nickname: player ? player.nickname : 'Игрок',
      avatar: player ? player.avatar : '❔',
      online: !!(player && player.isOnline),
      cups: this.state.cupsPublic(player),
    };
  }

  broughtOf(id, side) {
    const row = this.brought.get(id);
    return row ? row[side] || 0 : 0;
  }

  markWord(seatKey) {
    if (this.mark[seatKey] === true) return 'ok';
    if (this.mark[seatKey] === false) return 'fail';
    return 'wait';
  }

  seatPublic(seatKey) {
    const duel = this.current();
    if (!duel) return null;
    const seat = duel[seatKey];
    const base = this.person(seat.id);
    const showMark = this.phase === 'input' || this.phase === 'gap' || this.phase === 'over';
    return Object.assign(base, {
      borrowed: seat.borrowed,
      home: seat.home,
      forTitle: this.teamTitle(seatKey),
      tag: seat.borrowed ? 'играет за ' + this.teamTitle(seatKey) : '',
      mark: showMark ? this.markWord(seatKey) : '',
    });
  }

  laneOf(id, slot, state, borrowed, seatKey) {
    const base = this.person(id);
    return Object.assign(base, {
      slot,
      state,
      borrowed: !!borrowed,
      tag: borrowed ? 'за ' + this.teamTitle(seatKey) : '',
    });
  }

  lanes() {
    if (this.phase === 'draft') {
      return {
        left: this.teams.left.ids.map((id, index) => this.laneOf(id, index, 'wait', false, 'left')),
        right: this.teams.right.ids.map((id, index) => this.laneOf(id, index, 'wait', false, 'right')),
      };
    }
    const pack = { left: [], right: [] };
    this.duels.forEach((duel, index) => {
      let state = 'wait';
      if (index < this.duelIndex) state = 'done';
      else if (index === this.duelIndex) state = this.phase === 'gap' || this.phase === 'over' ? 'done' : 'now';
      else if (index === this.duelIndex + 1) state = 'next';
      SIDES.forEach((side) => {
        pack[side].push(this.laneOf(duel[side].id, index, state, duel[side].borrowed, side));
      });
    });
    return pack;
  }

  bench() {
    const taken = new Set(this.teams.left.ids.concat(this.teams.right.ids));
    const list = [];
    for (const player of this.state.players.values()) {
      if (taken.has(player.id)) continue;
      list.push(this.person(player.id));
    }
    list.sort((a, b) => a.nickname.localeCompare(b.nickname, 'ru'));
    return list;
  }

  roster() {
    const list = [];
    SIDES.forEach((side) => {
      this.teams[side].ids.forEach((id) => {
        const row = this.person(id);
        row.side = side;
        row.score = this.broughtOf(id, side);
        list.push(row);
      });
    });
    return list;
  }

  placeRows() {
    const left = this.scores.left;
    const right = this.scores.right;
    const tie = left === right;
    const rows = [];
    SIDES.forEach((side) => {
      let place = 1;
      if (!tie && this.scores[side] < Math.max(left, right)) place = 2;
      this.teams[side].ids.forEach((id) => rows.push({ id, place }));
    });
    return rows;
  }

  podium() {
    const left = this.scores.left;
    const right = this.scores.right;
    const tie = left === right;
    const teams = SIDES.map((side) => {
      let place = 1;
      if (!tie && this.scores[side] < Math.max(left, right)) place = 2;
      const players = this.teams[side].ids.map((id) => {
        const row = this.person(id);
        const home = this.broughtOf(id, side);
        const awaySide = side === 'left' ? 'right' : 'left';
        const away = this.broughtOf(id, awaySide);
        row.squares = home;
        row.extra = away
          ? 'ещё ' + away + ' за ' + this.teamTitle(awaySide)
          : '';
        return row;
      });
      return {
        side,
        place,
        title: this.teamTitle(side),
        score: this.scores[side],
        players,
      };
    });
    teams.sort((a, b) => a.place - b.place || (a.side === 'left' ? -1 : 1));
    return teams;
  }

  syncPlayerScores() {
    SIDES.forEach((side) => {
      this.teams[side].ids.forEach((id) => {
        const player = this.state.players.get(id);
        if (!player) return;
        player.score = this.broughtOf(id, side);
      });
    });
  }

  bump() {
    this.token += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.endsAt = 0;
    return this.token;
  }

  arm(ms, fn) {
    const token = this.bump();
    this.endsAt = Date.now() + ms;
    this.timer = setTimeout(() => {
      if (this.dead || token !== this.token) return;
      this.endsAt = 0;
      fn();
    }, ms);
    if (this.timer.unref) this.timer.unref();
  }

  emit(withScores, withMines) {
    if (this.dead) return;
    this.io.emit('echo_state', this.view());
    if (withMines !== false) this.sendMines();
    if (withScores && this.hooks.onScores) this.hooks.onScores();
  }

  sendMines() {
    const sockets = this.io.sockets && this.io.sockets.sockets;
    if (!sockets) return;
    for (const player of this.state.players.values()) {
      if (!player.socketId) continue;
      const socket = sockets.get(player.socketId);
      if (socket) socket.emit('echo_mine', this.mine(player.id));
    }
  }

  mine(playerId) {
    const side = this.sideOf(playerId);
    const seat = this.seatOf(playerId);
    const inDuel = !!seat && this.phase !== 'draft' && this.phase !== 'over';
    const player = this.state.players.get(playerId);
    const online = !!(player && player.isOnline);
    return {
      side: side || '',
      seat: seat || '',
      active: inDuel && (this.phase === 'count' || this.phase === 'show' || this.phase === 'input' || this.phase === 'wait'),
      canTap: this.phase === 'input' && !!seat && this.mark[seat] == null && online,
      progress: seat ? this.progress[seat] || 0 : 0,
      length: this.sequence.length,
      failed: !!(seat && this.mark[seat] === false),
      done: !!(seat && this.mark[seat] === true),
      borrowed: !!(seat && this.current() && this.current()[seat].borrowed),
      forTitle: seat ? this.teamTitle(seat) : '',
      nameError: this.errors.get(playerId) || '',
    };
  }

  view() {
    const host = this.state.hostPlayer();
    const lanes = this.lanes();
    const duel = this.phase === 'draft' ? null : {
      index: this.duelIndex,
      total: this.duels.length,
      left: this.seatPublic('left'),
      right: this.seatPublic('right'),
    };
    return {
      phase: this.phase,
      count: this.phase === 'count' ? this.count : 0,
      lit: this.phase === 'show' ? this.lit : null,
      length: this.sequence.length,
      note: this.note,
      max: MAX_LEN,
      left: {
        name: this.teams.left.name,
        title: this.teamTitle('left'),
        score: this.scores.left,
        seats: lanes.left,
      },
      right: {
        name: this.teams.right.name,
        title: this.teamTitle('right'),
        score: this.scores.right,
        seats: lanes.right,
      },
      duel,
      bench: this.phase === 'draft' ? this.bench() : [],
      hostSeated: !!(host && this.sideOf(host.id)),
      roster: this.roster(),
      podium: this.phase === 'over' ? this.podium() : null,
      leftMs: this.phase === 'input' && this.endsAt ? Math.max(0, this.endsAt - Date.now()) : null,
      limit: this.phase === 'input' ? INPUT_MS : null,
    };
  }
}

module.exports = {
  Echo,
  buildDuels,
};
