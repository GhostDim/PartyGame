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
let chosen = null;
let avatarsDrawn = false;
let hostAuthed = !isHost;
let syncing = false;
let gamesReady = false;

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

function buzz(pattern) {
  if (!vibrationEnabled() || !navigator.vibrate) return;
  navigator.vibrate(pattern);
}

function showJoinError(message) {
  const node = document.getElementById('join-error');
  node.hidden = !message;
  node.textContent = message || '';
}

function paintAvatars(box, current, onPick) {
  clearNode(box);
  if (!room || !room.avatars) return;
  room.avatars.forEach((avatar) => {
    const button = make('button', 'avatar-option', avatar);
    button.type = 'button';
    button.setAttribute('aria-pressed', avatar === current ? 'true' : 'false');
    button.addEventListener('click', () => {
      box.querySelectorAll('.avatar-option').forEach((item) => {
        item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
      });
      onPick(avatar);
    });
    box.appendChild(button);
  });
}

function drawJoinAvatars() {
  if (avatarsDrawn || !room || !room.avatars || !room.avatars.length) return;
  const box = document.getElementById('avatars');
  if (!box) return;
  chosen = room.avatars[0];
  paintAvatars(box, chosen, (avatar) => {
    chosen = avatar;
  });
  avatarsDrawn = true;
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

function render() {
  if (!me || !room) return;
  const fresh = room.players.find((player) => player.id === me.id);
  if (fresh) me = fresh;

  document.getElementById('me-avatar').textContent = me.avatar;
  document.getElementById('me-name').textContent = me.nickname;
  document.getElementById('me-score').textContent = pointsLabel(me.score);
  renderRank();

  if (room.roundStatus === 'playing') {
    document.getElementById('play-title').textContent = gameTitle(room, room.activeGame);
    document.getElementById('play-note').textContent = room.tvMode
      ? 'Следите за общим экраном. Кнопки раунда появятся здесь.'
      : 'Игра идёт на телефонах. Кнопки раунда появятся здесь.';
    show('play');
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
  if (room.roundStatus === 'playing') {
    hint.textContent = 'Идёт: ' + gameTitle(room, room.activeGame);
    startButton.disabled = true;
    return;
  }
  if (!room.pendingGame) {
    hint.textContent = 'Выберите игру или дождитесь голосов';
    startButton.disabled = true;
    return;
  }
  hint.textContent = 'Запустится: ' + gameTitle(room, room.pendingGame);
  startButton.disabled = false;
}

function openSettings() {
  const toggle = document.getElementById('vibrate-toggle');
  toggle.checked = vibrationEnabled();
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
  showJoinError('');
  socket.emit('player_register', { nickname, avatar: chosen });
});

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

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  buzz(20);
});

document.getElementById('leave-btn').addEventListener('click', () => {
  if (!window.confirm('Вы уверены?')) return;
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
  drawJoinAvatars();
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
  me = player;
  if (!isHost) localStorage.setItem(PLAYER_KEY, player.id);
  render();
  if (!room || room.roundStatus !== 'playing') show('lobby');
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

socket.on('game_start', () => {
  buzz([40, 40, 40]);
});

if (isHost) {
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
    const error = document.getElementById('login-error');
    error.hidden = !message;
    error.textContent = message || '';
    show('login');
  });

  socket.on('admin_denied', () => {
    localStorage.removeItem(TOKEN_KEY);
    hostAuthed = false;
    if (hostDialog && hostDialog.open) hostDialog.close();
    show('login');
    const error = document.getElementById('login-error');
    error.hidden = false;
    error.textContent = 'Нужно войти снова';
  });

  socket.on('admin_notice', ({ message }) => {
    const hint = document.getElementById('start-hint');
    if (hint) hint.textContent = message;
  });
}
