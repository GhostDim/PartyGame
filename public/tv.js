const socket = io();
let room = null;

function renderGuests(players) {
  const list = document.getElementById('guests');
  clearNode(list);
  players.filter((player) => player.isOnline).forEach((player) => {
    const item = make('li', 'guest');
    item.append(make('span', 'face', player.avatar), make('span', 'name', player.nickname));
    list.appendChild(item);
  });
}

function render(next) {
  room = next;
  const online = room.players.filter((player) => player.isOnline);
  const title = document.getElementById('tv-title');
  const status = document.getElementById('tv-status');
  document.getElementById('phones-banner').hidden = room.tvMode;

  if (room.roundStatus === 'playing') {
    title.textContent = gameTitle(room, room.activeGame);
    status.textContent = 'Игра началась';
    status.classList.remove('is-waiting');
  } else if (!online.length) {
    title.textContent = 'Лобби';
    status.textContent = 'Ожидание гостей';
    status.classList.add('is-waiting');
  } else {
    title.textContent = 'Лобби';
    status.textContent = 'Ожидание запуска игры ведущим...';
    status.classList.add('is-waiting');
  }

  renderGuests(room.players);
  fillBars(document.getElementById('bars'), room.games, room.pendingGame, room.selectedGame);
}

socket.on('connect', () => {
  document.getElementById('conn').hidden = true;
  socket.emit('tv_hello');
});

socket.on('disconnect', () => {
  document.getElementById('conn').hidden = false;
});

socket.on('room_state', render);

socket.on('votes_updated', (data) => {
  if (!room) return;
  room.votes = data.votes;
  room.games = data.games;
  fillBars(document.getElementById('bars'), room.games, room.pendingGame, room.selectedGame);
});

socket.on('game_start', ({ title }) => {
  document.getElementById('tv-title').textContent = title;
  const status = document.getElementById('tv-status');
  status.textContent = 'Игра началась';
  status.classList.remove('is-waiting');
});
