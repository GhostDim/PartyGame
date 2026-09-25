const TOKEN_KEY = 'partybox_admin_token';
const socket = io();
const loginView = document.getElementById('view-login');
const panelView = document.getElementById('view-panel');
const tvModeInput = document.getElementById('tv-mode');
const gameSelect = document.getElementById('game-select');
const startButton = document.getElementById('start');

let room = null;
let authed = false;
let syncing = false;
let gamesReady = false;

function showLogin(message) {
  authed = false;
  loginView.hidden = false;
  panelView.hidden = true;
  const error = document.getElementById('login-error');
  error.hidden = !message;
  error.textContent = message || '';
}

function showPanel() {
  authed = true;
  loginView.hidden = true;
  panelView.hidden = false;
  if (room) render();
}

function ensureGames(games) {
  if (gamesReady) return;
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

function renderPlayers() {
  const list = document.getElementById('players');
  clearNode(list);
  if (!room.players.length) {
    list.appendChild(make('li', 'muted', 'Пока никого нет — гости открывают главную страницу'));
    return;
  }
  room.players.forEach((player) => {
    const item = make('li', 'player ' + (player.isOnline ? 'online' : 'offline'));
    const meta = make('div', 'meta');
    const voteName = player.votedGame ? gameTitle(room, player.votedGame) : 'ещё не голосовал';
    meta.append(
      make('strong', null, player.nickname),
      make('span', null, (player.isOnline ? 'в сети' : 'не в сети') + ' · ' + voteName + ' · ' + pointsLabel(player.score))
    );
    item.append(make('span', 'face', player.avatar), meta, make('span', 'status-dot'));
    list.appendChild(item);
  });
}

function renderVotes() {
  const box = document.getElementById('votes');
  const max = room.games.reduce((top, game) => Math.max(top, game.votes), 0);
  clearNode(box);
  room.games.forEach((game) => {
    const row = make('div');
    const bar = make('div', 'bar');
    const fill = make('span');
    fill.style.width = (max > 0 ? Math.round((game.votes / max) * 100) : 0) + '%';
    bar.appendChild(fill);
    row.append(make('strong', null, game.title + ' — ' + votesLabel(game.votes)), bar);
    box.appendChild(row);
  });
}

function render() {
  if (!authed || !room) return;
  ensureGames(room.games);
  renderPlayers();
  renderVotes();

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

document.getElementById('login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  socket.emit('admin_login', { password: document.getElementById('password').value });
});

tvModeInput.addEventListener('change', () => {
  if (syncing) return;
  socket.emit('set_tv_mode', { enabled: tvModeInput.checked });
});

gameSelect.addEventListener('change', () => {
  if (syncing) return;
  socket.emit('select_game', { gameId: gameSelect.value || null });
});

startButton.addEventListener('click', () => {
  socket.emit('start_game');
});

socket.on('connect', () => {
  document.getElementById('conn').hidden = true;
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) socket.emit('admin_resume', { token });
  else showLogin('');
});

socket.on('disconnect', () => {
  document.getElementById('conn').hidden = false;
});

socket.on('admin_ok', ({ token }) => {
  localStorage.setItem(TOKEN_KEY, token);
  document.getElementById('password').value = '';
  showPanel();
});

socket.on('admin_fail', ({ message }) => {
  localStorage.removeItem(TOKEN_KEY);
  showLogin(message);
});

socket.on('admin_denied', () => {
  localStorage.removeItem(TOKEN_KEY);
  showLogin('Нужно войти снова');
});

socket.on('admin_notice', ({ message }) => {
  document.getElementById('start-hint').textContent = message;
});

socket.on('room_state', (next) => {
  room = next;
  render();
});

socket.on('votes_updated', (data) => {
  if (!room) return;
  room.votes = data.votes;
  room.games = data.games;
  render();
});
