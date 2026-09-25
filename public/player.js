const PLAYER_KEY = 'partybox_player_id';
const views = {
  boot: document.getElementById('view-boot'),
  join: document.getElementById('view-join'),
  lobby: document.getElementById('view-lobby'),
  play: document.getElementById('view-play'),
};

const socket = io();
let room = null;
let me = null;
let chosen = null;
let avatarsDrawn = false;

function show(name) {
  Object.keys(views).forEach((key) => {
    views[key].hidden = key !== name;
  });
}

function showJoinError(message) {
  const node = document.getElementById('join-error');
  node.hidden = !message;
  node.textContent = message || '';
}

function drawAvatars(list) {
  if (avatarsDrawn || !list || !list.length) return;
  const box = document.getElementById('avatars');
  list.forEach((avatar, index) => {
    const button = make('button', 'avatar-option', avatar);
    button.type = 'button';
    button.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
    button.addEventListener('click', () => {
      chosen = avatar;
      box.querySelectorAll('.avatar-option').forEach((item) => {
        item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
      });
    });
    box.appendChild(button);
  });
  chosen = list[0];
  avatarsDrawn = true;
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
      if (navigator.vibrate) navigator.vibrate(30);
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
  document.getElementById('tv-chip').hidden = room.tvMode;

  if (room.roundStatus === 'playing') {
    document.getElementById('play-title').textContent = gameTitle(room, room.activeGame);
    document.getElementById('play-note').textContent = room.tvMode
      ? 'Следите за общим экраном. Кнопки раунда появятся здесь.'
      : 'Игра идёт на телефонах. Кнопки раунда появятся здесь.';
    show('play');
    return;
  }

  show('lobby');
  renderGames();
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

socket.on('connect', () => {
  document.getElementById('conn').hidden = true;
  const playerId = localStorage.getItem(PLAYER_KEY);
  if (playerId) socket.emit('player_resume', { playerId });
  else show('join');
});

socket.on('disconnect', () => {
  document.getElementById('conn').hidden = false;
});

socket.on('room_state', (next) => {
  room = next;
  drawAvatars(next.avatars);
  render();
});

socket.on('votes_updated', (data) => {
  if (!room) return;
  room.votes = data.votes;
  room.games = data.games;
  render();
});

socket.on('player_ready', ({ player }) => {
  me = player;
  localStorage.setItem(PLAYER_KEY, player.id);
  render();
  if (!room || room.roundStatus !== 'playing') show('lobby');
});

socket.on('player_unknown', () => {
  localStorage.removeItem(PLAYER_KEY);
  show('join');
});

socket.on('player_rejected', ({ message }) => {
  if (!views.join.hidden) showJoinError(message);
});

socket.on('game_start', () => {
  if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
});
