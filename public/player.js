const PLAYER_KEY = 'partybox_player_id';
const TOKEN_KEY = 'partybox_admin_token';
const VIBRATE_KEY = 'partybox_vibrate';
const isHost = document.body.classList.contains('page-admin');

const views = {};
['boot', 'login', 'join', 'lobby', 'play'].forEach((name) => {
  const node = document.getElementById('view-' + name);
  if (node) views[name] = node;
});

const socket = io();
const settingsDialog = document.getElementById('player-settings');
const rankDialog = document.getElementById('rank-sheet');
const hostDialog = document.getElementById('host-sheet');

let room = null;
let me = null;
let bomb = null;
let hostNote = '';
let chosen = null;
let seenStatus = null;
let hostAuthed = !isHost;
let syncing = false;
let lightsSync = false;
let gamesReady = false;
let lights = { enabled: true, brightness: 5, hardware: 'wait' };

function show(name) {
  Object.keys(views).forEach((key) => {
    views[key].hidden = key !== name;
  });
  const inRoom = name === 'lobby' || name === 'play';
  ['open-settings', 'open-rank', 'open-host'].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.hidden = !inRoom;
  });
}

function vibrationEnabled() {
  return localStorage.getItem(VIBRATE_KEY) !== 'off';
}

let buzzAt = 0;

function buzz(pattern, force) {
  if (!force && !vibrationEnabled()) return;
  if (typeof navigator.vibrate !== 'function') return;
  const now = Date.now();
  if (now - buzzAt < 50) return;
  buzzAt = now;
  navigator.vibrate(pattern || 50);
}

function pressControl(event) {
  const raw = event.target;
  const node = raw && raw.closest ? raw : raw && raw.parentElement;
  if (!node || !node.closest) return null;
  return node.closest('button, .toggle');
}

function onPress(event) {
  const control = pressControl(event);
  if (!control) return;
  if (control.matches('button') && control.disabled) return;
  const toggle = document.getElementById('vibrate-toggle');
  const turningOn = !!(toggle && control.contains(toggle) && !toggle.checked);
  buzz(50, turningOn);
}

function showJoinError(message) {
  const node = document.getElementById('join-error');
  node.hidden = !message;
  node.textContent = message || '';
}

function takenAvatars() {
  const taken = new Set();
  if (!room || !room.players) return taken;
  room.players.forEach((player) => {
    if (me && player.id === me.id) return;
    taken.add(player.avatar);
  });
  return taken;
}

function paintAvatars(box, current, onPick) {
  clearNode(box);
  if (!room || !room.avatars) return;
  const taken = takenAvatars();
  room.avatars.forEach((avatar) => {
    const busy = taken.has(avatar);
    const button = make('button', 'avatar-option', avatar);
    button.type = 'button';
    button.disabled = busy;
    if (busy) button.title = 'Занято';
    button.setAttribute('aria-pressed', !busy && avatar === current ? 'true' : 'false');
    button.addEventListener('click', () => {
      if (button.disabled) return;
      box.querySelectorAll('.avatar-option').forEach((item) => {
        item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
      });
      onPick(avatar);
    });
    box.appendChild(button);
  });
}

function syncJoinAvatars() {
  const box = document.getElementById('avatars');
  if (!box || !room || !room.avatars || !room.avatars.length) return;
  const taken = takenAvatars();
  if (!chosen || taken.has(chosen) || !room.avatars.includes(chosen)) {
    chosen = room.avatars.find((avatar) => !taken.has(avatar)) || null;
  }
  paintAvatars(box, chosen, (avatar) => {
    chosen = avatar;
  });
  const submit = document.querySelector('#join-form button[type="submit"]');
  if (submit) submit.disabled = !chosen;
  const onJoin = views.join && !views.join.hidden;
  const error = document.getElementById('join-error');
  if (!onJoin || !error) return;
  if (!chosen) {
    if (error.hidden || error.textContent === 'Все аватары заняты') {
      showJoinError('Все аватары заняты');
    }
    return;
  }
  if (error.textContent === 'Все аватары заняты' || error.textContent === 'Этот аватар уже занят') {
    showJoinError('');
  }
}

function resumePlayer() {
  const playerId = localStorage.getItem(PLAYER_KEY);
  if (playerId) socket.emit('player_resume', { playerId });
  else show('join');
}

function renderGames() {
  const box = document.getElementById('games');
  const max = room.games.reduce((top, game) => Math.max(top, game.votes), 0);
  clearNode(box);
  room.games.forEach((game) => {
    const card = make('article', 'game-card' + (game.id === room.pendingGame ? ' is-picked' : ''));
    const bar = make('div', 'bar');
    const fill = make('span');
    fill.style.width = (max > 0 ? Math.round((game.votes / max) * 100) : 0) + '%';
    bar.appendChild(fill);
    const row = make('div', 'row');
    row.appendChild(make('span', null, votesLabel(game.votes)));
    const button = make('button', null, me.votedGame === game.id ? 'Ваш голос' : 'Голосовать');
    button.type = 'button';
    button.disabled = room.roundStatus !== 'lobby' || me.votedGame === game.id;
    button.addEventListener('click', () => {
      socket.emit('player_vote', { gameId: game.id });
    });
    row.appendChild(button);
    card.append(make('h2', null, game.title), make('p', null, game.description), bar, row);
    box.appendChild(card);
  });
}

function setHint(text) {
  const hint = document.getElementById('start-hint');
  if (!hint) return;
  if (hostNote) {
    hint.textContent = hostNote;
    if (hostDialog && hostDialog.open) hostNote = '';
    return;
  }
  hint.textContent = text;
}

function paintPlayerBomb() {
  const box = document.getElementById('play-bomb');
  const generic = document.getElementById('play-generic');
  if (!box || !generic) return;
  const playing = !!(room && room.roundStatus === 'playing' && room.activeGame === 'hotbomb');
  if (!playing) {
    box.hidden = true;
    generic.hidden = false;
    return;
  }
  box.hidden = false;
  generic.hidden = true;
  const count = document.getElementById('bomb-count');
  const status = document.getElementById('bomb-status');
  const score = document.getElementById('bomb-score');
  const pass = document.getElementById('bomb-pass');
  const winners = document.getElementById('bomb-winners');
  if (!bomb) {
    count.hidden = true;
    score.hidden = true;
    pass.hidden = true;
    winners.hidden = true;
    status.textContent = 'Приготовьтесь';
    return;
  }
  fillBombChain(document.getElementById('bomb-chain'), bomb);
  const counting = bomb.phase === 'countdown';
  const seat = seatById(bomb, me && me.id);
  const mine = !!(me && bomb.holderId === me.id);
  const dead = !!(seat && !seat.alive);
  const showPass = bomb.phase === 'live' && mine;
  count.hidden = !counting;
  if (counting) showCount(count, bomb.count);
  else {
    count.textContent = '';
    count.classList.remove('is-go');
  }
  pass.hidden = !showPass;
  winners.hidden = bomb.phase !== 'over';
  score.hidden = !(bomb.phase === 'live' && mine);
  if (mine && !score.hidden && seat) {
    const text = pointsLabel(seat.score);
    if (score.textContent !== text) {
      score.textContent = text;
      punch(score);
    }
  }
  if (bomb.phase === 'over') {
    fillWinners(winners, bomb);
    status.textContent = winnerLine(bomb, me);
    return;
  }
  if (counting) {
    status.textContent = 'Приготовьтесь';
    return;
  }
  if (bomb.phase === 'boom') {
    const name = nameById(bomb, bomb.boomId);
    status.textContent = me && bomb.boomId === me.id ? 'Бах! Вы выбываете' : 'Бах! ' + (name || 'Игрок') + ' выбывает';
    return;
  }
  if (dead) {
    status.textContent = 'Вы выбыли. Бомба у ' + (holderName(bomb) || 'игрока');
    return;
  }
  if (showPass) {
    status.textContent = 'У вас бомба · +' + (bomb.perSec || 10) + '/сек';
    return;
  }
  status.textContent = prepareLine(bomb);
}

function reactBomb(prev, next) {
  if (!next) return;
  if (next.phase === 'countdown' && next.count === 'GO' && (!prev || prev.count !== 'GO')) buzz([40, 30, 40]);
  const gotBomb = next.phase === 'live' && me && next.holderId === me.id
    && (!prev || prev.phase !== 'live' || prev.holderId !== me.id);
  if (gotBomb) buzz([50, 30, 70]);
  const exploded = prev && next.phase === 'boom' && (prev.phase !== 'boom' || prev.boomId !== next.boomId);
  if (exploded) {
    if (me && next.boomId === me.id) buzz([90, 50, 140, 50, 220]);
    else buzz([30, 40, 30]);
    flashScreen();
  }
  if (next.phase === 'over' && (!prev || prev.phase !== 'over')) buzz([60, 40, 60, 40, 100]);
}

function render() {
  if (!me || !room) return;
  const fresh = room.players.find((player) => player.id === me.id);
  if (fresh) me = fresh;

  document.getElementById('me-avatar').textContent = me.avatar;
  document.getElementById('me-name').textContent = me.nickname;
  document.getElementById('me-score').textContent = pointsLabel(me.score);
  renderRank();

  if (seenStatus === 'playing' && room.roundStatus === 'lobby') buzz([40, 30, 40]);
  seenStatus = room.roundStatus;

  if (room.roundStatus !== 'playing') bomb = null;
  if (room.roundStatus === 'playing') {
    if (room.activeGame !== 'hotbomb') {
      document.getElementById('play-title').textContent = gameTitle(room, room.activeGame);
      document.getElementById('play-note').textContent = room.tvMode
        ? 'Следите за общим экраном. Кнопки раунда появятся здесь.'
        : 'Игра идёт на телефонах. Кнопки раунда появятся здесь.';
    }
    show('play');
    paintPlayerBomb();
  } else {
    show('lobby');
    renderGames();
  }
  renderHost();
}

function ensureGames(games) {
  const gameSelect = document.getElementById('game-select');
  if (!gameSelect || gamesReady) return;
  const auto = make('option', null, 'Как решит голосование');
  auto.value = '';
  gameSelect.appendChild(auto);
  games.forEach((game) => {
    const option = make('option', null, game.title);
    option.value = game.id;
    gameSelect.appendChild(option);
  });
  gamesReady = true;
}

function renderRank() {
  const list = document.getElementById('rank-list');
  if (!list || !room) return;
  const players = room.players.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.nickname.localeCompare(b.nickname, 'ru');
  });
  clearNode(list);
  if (!players.length) {
    list.appendChild(make('li', 'muted', 'Пока никого нет'));
    return;
  }
  players.forEach((player, index) => {
    const item = make('li', 'player');
    const meta = make('div', 'meta');
    const self = me && player.id === me.id;
    meta.append(
      make('strong', null, player.nickname + (self ? ' (вы)' : '')),
      make('span', null, pointsLabel(player.score))
    );
    item.append(make('span', 'place', String(index + 1)), make('span', 'face', player.avatar), meta);
    list.appendChild(item);
  });
}

function renderHost() {
  if (!isHost || !hostAuthed || !room || !hostDialog) return;
  ensureGames(room.games);

  const votes = document.getElementById('votes');
  const max = room.games.reduce((top, game) => Math.max(top, game.votes), 0);
  clearNode(votes);
  room.games.forEach((game) => {
    const row = make('div');
    const bar = make('div', 'bar');
    const fill = make('span');
    fill.style.width = (max > 0 ? Math.round((game.votes / max) * 100) : 0) + '%';
    bar.appendChild(fill);
    row.append(make('strong', null, game.title + ' — ' + votesLabel(game.votes)), bar);
    votes.appendChild(row);
  });

  const tvModeInput = document.getElementById('tv-mode');
  const gameSelect = document.getElementById('game-select');
  const startButton = document.getElementById('start');
  syncing = true;
  tvModeInput.checked = room.tvMode;
  document.getElementById('tv-mode-label').textContent = room.tvMode ? 'С экраном ТВ' : 'Только телефоны';
  gameSelect.value = room.selectedGame || '';
  syncing = false;

  const hint = document.getElementById('start-hint');
  const abort = document.getElementById('abort');
  const abortBox = document.getElementById('abort-confirm');
  if (room.roundStatus !== 'playing') {
    if (abort) abort.hidden = true;
    if (abortBox) abortBox.hidden = true;
  } else if (abort && abortBox && abortBox.hidden) {
    abort.hidden = false;
  }
  if (room.roundStatus === 'playing') {
    setHint('Идёт: ' + gameTitle(room, room.activeGame));
    startButton.disabled = true;
    return;
  }
  if (!room.pendingGame) {
    setHint('Выберите игру или дождитесь голосов');
    startButton.disabled = true;
    return;
  }
  setHint('Запустится: ' + gameTitle(room, room.pendingGame));
  startButton.disabled = false;
}

function resetLeaveConfirm() {
  document.getElementById('leave-btn').hidden = false;
  document.getElementById('leave-confirm').hidden = true;
}

function renderLights() {
  const toggle = document.getElementById('lights-toggle');
  const slider = document.getElementById('lights-brightness');
  const level = document.getElementById('lights-level');
  const hint = document.getElementById('lights-hint');
  if (!toggle || !slider || !level) return;
  lightsSync = true;
  toggle.checked = !!lights.enabled;
  slider.disabled = !lights.enabled;
  if (document.activeElement !== slider) {
    slider.value = String(lights.brightness);
    level.textContent = lights.brightness + '%';
  }
  if (hint) {
    hint.hidden = lights.hardware !== 'off';
    hint.textContent = 'Нет доступа к ленте. Настройка сохранится, светодиоды не горят.';
  }
  lightsSync = false;
}

function openSettings() {
  const toggle = document.getElementById('vibrate-toggle');
  const hint = document.getElementById('vibrate-hint');
  toggle.checked = vibrationEnabled();
  hint.hidden = typeof navigator.vibrate === 'function';
  hint.textContent = 'Этот браузер не разрешает вибрацию для страницы.';
  renderLights();
  resetLeaveConfirm();
  if (!settingsDialog.open) settingsDialog.showModal();
}

function closeSheets() {
  if (settingsDialog.open) settingsDialog.close();
  if (rankDialog && rankDialog.open) rankDialog.close();
  if (hostDialog && hostDialog.open) hostDialog.close();
}

document.getElementById('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const nickname = document.getElementById('nick').value.trim();
  if (nickname.length < 2) {
    showJoinError('Имя должно быть от 2 до 16 символов');
    return;
  }
  if (!chosen) {
    showJoinError('Все аватары заняты');
    return;
  }
  showJoinError('');
  socket.emit('player_register', { nickname, avatar: chosen });
});

const passButton = document.getElementById('bomb-pass');
if (passButton) {
  passButton.addEventListener('click', () => {
    socket.emit('player_action', { type: 'pass' });
  });
}

document.getElementById('open-settings').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', () => settingsDialog.close());
document.getElementById('vibrate-toggle').addEventListener('change', (event) => {
  localStorage.setItem(VIBRATE_KEY, event.target.checked ? 'on' : 'off');
});
document.getElementById('open-rank').addEventListener('click', () => {
  renderRank();
  if (!rankDialog.open) rankDialog.showModal();
});
document.getElementById('rank-close').addEventListener('click', () => rankDialog.close());

document.addEventListener('pointerdown', onPress, true);
document.addEventListener('touchstart', onPress, { capture: true, passive: true });

document.getElementById('leave-btn').addEventListener('click', () => {
  document.getElementById('leave-btn').hidden = true;
  document.getElementById('leave-confirm').hidden = false;
});
document.getElementById('leave-no').addEventListener('click', resetLeaveConfirm);
document.getElementById('leave-yes').addEventListener('click', () => {
  socket.emit('player_leave');
});

if (isHost) {
  document.getElementById('login-form').addEventListener('submit', (event) => {
    event.preventDefault();
    socket.emit('admin_login', { password: document.getElementById('password').value });
  });
  document.getElementById('open-host').addEventListener('click', () => {
    renderHost();
    if (!hostDialog.open) hostDialog.showModal();
  });
  document.getElementById('host-close').addEventListener('click', () => hostDialog.close());
  document.getElementById('tv-mode').addEventListener('change', () => {
    if (syncing) return;
    socket.emit('set_tv_mode', { enabled: document.getElementById('tv-mode').checked });
  });
  document.getElementById('game-select').addEventListener('change', () => {
    if (syncing) return;
    const value = document.getElementById('game-select').value;
    socket.emit('select_game', { gameId: value || null });
  });
  document.getElementById('start').addEventListener('click', () => {
    socket.emit('start_game');
  });
  document.getElementById('abort').addEventListener('click', () => {
    document.getElementById('abort').hidden = true;
    document.getElementById('abort-confirm').hidden = false;
  });
  document.getElementById('abort-no').addEventListener('click', () => {
    document.getElementById('abort-confirm').hidden = true;
    document.getElementById('abort').hidden = room && room.roundStatus !== 'playing';
  });
  document.getElementById('abort-yes').addEventListener('click', () => {
    document.getElementById('abort-confirm').hidden = true;
    document.getElementById('abort').hidden = true;
    socket.emit('return_to_lobby');
  });

  const lightsToggle = document.getElementById('lights-toggle');
  const lightsSlider = document.getElementById('lights-brightness');
  let lightsTimer = null;
  if (lightsToggle && lightsSlider) {
    lightsToggle.addEventListener('change', () => {
      if (lightsSync) return;
      lightsSlider.disabled = !lightsToggle.checked;
      socket.emit('set_lights', { enabled: lightsToggle.checked });
    });
    lightsSlider.addEventListener('input', () => {
      if (lightsSync) return;
      const brightness = Number(lightsSlider.value);
      document.getElementById('lights-level').textContent = brightness + '%';
      clearTimeout(lightsTimer);
      lightsTimer = setTimeout(() => {
        socket.emit('set_lights', { brightness });
      }, 80);
    });
    lightsSlider.addEventListener('change', () => {
      if (lightsSync) return;
      clearTimeout(lightsTimer);
      socket.emit('set_lights', { brightness: Number(lightsSlider.value) });
    });
  }
}

socket.on('connect', () => {
  document.getElementById('conn').hidden = true;
  if (isHost) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) socket.emit('admin_resume', { token });
    else show('login');
    return;
  }
  resumePlayer();
});

socket.on('disconnect', () => {
  document.getElementById('conn').hidden = false;
});

socket.on('room_state', (next) => {
  room = next;
  syncJoinAvatars();
  if (me || (settingsDialog && settingsDialog.open)) render();
  else renderHost();
});

socket.on('votes_updated', (data) => {
  if (!room) return;
  room.votes = data.votes;
  room.games = data.games;
  if (me) render();
  else renderHost();
});

socket.on('player_ready', ({ player }) => {
  const was = me;
  me = player;
  if (!isHost) localStorage.setItem(PLAYER_KEY, player.id);
  render();
  if (!room || room.roundStatus !== 'playing') show('lobby');
  if (!was && bomb && bomb.phase === 'live' && bomb.holderId === player.id) buzz([50, 30, 70]);
});

socket.on('player_unknown', () => {
  me = null;
  if (!isHost) localStorage.removeItem(PLAYER_KEY);
  if (!isHost || hostAuthed) show('join');
});

socket.on('player_left', () => {
  me = null;
  if (!isHost) localStorage.removeItem(PLAYER_KEY);
  closeSheets();
  showJoinError('');
  show('join');
});

socket.on('player_kicked', () => {
  me = null;
  if (!isHost) localStorage.removeItem(PLAYER_KEY);
  closeSheets();
  showJoinError('Ведущий удалил вас из комнаты');
  show('join');
});

socket.on('player_rejected', ({ message }) => {
  if (views.join && !views.join.hidden) showJoinError(message);
});

socket.on('game_start', (payload) => {
  buzz([50, 40, 50]);
  if (hostDialog && hostDialog.open) hostDialog.close();
  if (!me) return;
  seenStatus = 'playing';
  if (payload && payload.gameId === 'hotbomb') {
    if (room) {
      room.roundStatus = 'playing';
      room.activeGame = 'hotbomb';
    }
    show('play');
    paintPlayerBomb();
    return;
  }
  document.getElementById('play-title').textContent = (payload && payload.title) || 'Игра началась';
  show('play');
});

socket.on('bomb_state', (next) => {
  const prev = bomb;
  bomb = next && next.phase ? next : null;
  if (bomb) applyBombScores(room, bomb);
  reactBomb(prev, bomb);
  if (me && room && room.roundStatus === 'playing') render();
});

function hideBoard() {
  const board = document.getElementById('board');
  if (board) board.hidden = true;
}

function renderBoard(stats) {
  const board = document.getElementById('board');
  if (!board || !stats) return;
  const temp = document.getElementById('board-temp');
  const cpu = document.getElementById('board-cpu');
  const mem = document.getElementById('board-mem');
  temp.textContent = stats.tempC == null ? '—' : stats.tempC + '°C';
  temp.classList.toggle('is-hot', typeof stats.tempC === 'number' && stats.tempC >= 70);
  cpu.textContent = stats.cpu == null ? '—' : stats.cpu + '%';
  mem.textContent = stats.mem == null ? '—' : stats.mem + '%';
  board.hidden = false;
}

if (isHost) {
  socket.on('board_stats', renderBoard);
  socket.on('lights_state', (next) => {
    if (!next) return;
    lights = next;
    renderLights();
  });

  socket.on('admin_ok', ({ token, playerId }) => {
    localStorage.setItem(TOKEN_KEY, token);
    hostAuthed = true;
    const password = document.getElementById('password');
    if (password) password.value = '';
    if (playerId) return;
    if (!me) show('join');
  });

  socket.on('admin_fail', ({ message }) => {
    localStorage.removeItem(TOKEN_KEY);
    hostAuthed = false;
    hideBoard();
    const error = document.getElementById('login-error');
    error.hidden = !message;
    error.textContent = message || '';
    show('login');
  });

  socket.on('admin_denied', () => {
    localStorage.removeItem(TOKEN_KEY);
    hostAuthed = false;
    hideBoard();
    if (hostDialog && hostDialog.open) hostDialog.close();
    show('login');
    const error = document.getElementById('login-error');
    error.hidden = false;
    error.textContent = 'Нужно войти снова';
  });

  socket.on('admin_notice', ({ message }) => {
    hostNote = message || '';
    const hint = document.getElementById('start-hint');
    if (hint && hostNote) hint.textContent = hostNote;
    const abort = document.getElementById('abort');
    const abortBox = document.getElementById('abort-confirm');
    if (abort && abortBox && room && room.roundStatus === 'playing' && abortBox.hidden) {
      abort.hidden = false;
    }
  });
}
