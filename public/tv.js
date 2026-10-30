const socket = io();
let room = null;
let bomb = null;
let quiz = null;

function seatTotal() {
  if (room && Array.isArray(room.avatars) && room.avatars.length) return room.avatars.length;
  return 12;
}

function emptySeat() {
  const item = make('li', 'guest is-empty');
  item.setAttribute('aria-hidden', 'true');
  item.append(make('span', 'seat'));
  return item;
}

function paintGuest(item, player, showScore) {
  item.classList.remove('is-empty');
  item.removeAttribute('aria-hidden');
  item.dataset.id = player.id;
  const seat = item.querySelector('.seat');
  if (seat) seat.remove();
  let face = item.querySelector('.face');
  let name = item.querySelector('.name');
  let score = item.querySelector('.score');
  if (!face) item.appendChild(face = make('span', 'face'));
  if (!name) item.appendChild(name = make('span', 'name'));
  if (!score) item.appendChild(score = make('span', 'score'));
  paintFace(face, player.avatar, player.cups);
  if (name.textContent !== player.nickname) name.textContent = player.nickname;
  score.hidden = !showScore;
  if (showScore) {
    const text = pointsLabel(player.score);
    if (score.textContent !== text) score.textContent = text;
  }
}

function vacateGuest(item) {
  item.classList.add('is-empty');
  item.setAttribute('aria-hidden', 'true');
  delete item.dataset.id;
  clearNode(item);
  item.append(make('span', 'seat'));
}

function renderGuests(players, showScore) {
  const list = document.getElementById('guests');
  const online = players.filter((player) => player.isOnline);
  const dock = document.body.classList.contains('is-lobby');
  if (!dock) {
    for (const item of [...list.children]) {
      if (item.classList.contains('is-empty')) item.remove();
    }
    const nodes = new Map();
    for (const item of list.children) nodes.set(item.dataset.id, item);
    const seen = new Set();
    online.forEach((player) => {
      seen.add(player.id);
      let item = nodes.get(player.id);
      if (!item) {
        item = make('li', 'guest');
        nodes.set(player.id, item);
        list.appendChild(item);
      }
      paintGuest(item, player, showScore);
    });
    for (const [id, item] of nodes) {
      if (!seen.has(id)) item.remove();
    }
    online.forEach((player) => {
      const item = nodes.get(player.id);
      if (item && item.isConnected) list.appendChild(item);
    });
    list.dataset.count = String(online.length);
    return;
  }
  const seats = seatTotal();
  list.style.setProperty('--seat-count', String(seats));
  while (list.children.length < seats) list.appendChild(emptySeat());
  while (list.children.length > seats) list.removeChild(list.lastChild);
  const seen = new Set();
  for (const item of list.children) {
    if (!item.dataset.id) continue;
    const player = online.find((entry) => entry.id === item.dataset.id);
    if (!player) vacateGuest(item);
    else {
      seen.add(player.id);
      paintGuest(item, player, false);
    }
  }
  for (const player of online) {
    if (seen.has(player.id)) continue;
    const slot = [...list.children].find((item) => item.classList.contains('is-empty'));
    if (!slot) break;
    paintGuest(slot, player, false);
  }
  list.dataset.count = String(online.length);
}

function paintStatus(text, waiting) {
  const status = document.getElementById('tv-status');
  const lobbyStatus = document.getElementById('tv-lobby-status');
  status.textContent = text;
  status.classList.toggle('is-waiting', !!waiting);
  if (lobbyStatus) {
    lobbyStatus.textContent = text;
    lobbyStatus.classList.toggle('is-waiting', !!waiting);
  }
}

function paintLobbyCount() {
  const node = document.getElementById('tv-lobby-count');
  if (!node || !room) return;
  const total = seatTotal();
  let online = 0;
  for (const player of room.players) if (player.isOnline) online += 1;
  node.textContent = online + ' из ' + total;
}

function paintTvBomb() {
  const count = document.getElementById('tv-count');
  const hero = document.getElementById('tv-hero');
  const heroName = document.getElementById('tv-hero-name');
  const heroScore = document.getElementById('tv-hero-score');
  const winners = document.getElementById('tv-winners');
  const line = document.getElementById('tv-bomb-line');
  if (!bomb) {
    count.hidden = true;
    hero.hidden = true;
    heroName.hidden = true;
    heroScore.hidden = true;
    winners.hidden = true;
    line.textContent = 'Приготовьтесь';
    return;
  }
  fillBombChain(document.getElementById('tv-bomb-chain'), bomb);
  const counting = bomb.phase === 'countdown';
  const live = bomb.phase === 'live';
  const boom = bomb.phase === 'boom';
  const over = bomb.phase === 'over';
  count.hidden = !counting;
  if (!counting) {
    count.textContent = '';
    count.classList.remove('is-go');
  }
  hero.hidden = counting || over;
  heroName.hidden = !live && !boom;
  heroScore.hidden = !live;
  winners.hidden = !over;
  hero.classList.toggle('is-tick', live);
  if (counting) {
    showCount(count, bomb.count);
    line.textContent = 'Приготовьтесь';
    return;
  }
  if (live) {
    const seat = seatById(bomb, bomb.holderId);
    hero.textContent = '💣';
    heroName.textContent = seat ? seat.nickname : '';
    const points = pointsLabel(seat ? seat.score : 0);
    if (heroScore.textContent !== points) {
      heroScore.textContent = points;
      punch(heroScore);
    }
    line.textContent = rateText(bomb);
    return;
  }
  if (boom) {
    const seat = seatById(bomb, bomb.boomId);
    hero.textContent = '💥';
    heroName.textContent = seat ? seat.nickname : '';
    line.textContent = (seat ? seat.nickname : 'Игрок') + ' выбывает';
    return;
  }
  fillWinners(winners, bomb);
  line.textContent = 'В круге остались двое';
}

function render(next) {
  room = next;
  if (!room) return;
  document.body.classList.toggle('is-lobby', room.roundStatus !== 'playing');
  const online = room.players.filter((player) => player.isOnline);
  const title = document.getElementById('tv-title');
  paintLobbyCount();
  const hot = room.roundStatus === 'playing' && room.activeGame === 'hotbomb';
  const quizOn = room.roundStatus === 'playing' && room.activeGame === 'quiz';
  const showBomb = hot && room.tvMode;
  const showQuiz = quizOn && room.tvMode;
  document.getElementById('phones-banner').hidden = room.tvMode;
  document.getElementById('tv-lobby').hidden = showBomb || showQuiz;
  document.getElementById('bars').hidden = hot || quizOn;
  document.getElementById('tv-bomb').hidden = !showBomb;
  const quizBox = document.getElementById('tv-quiz');
  if (quizBox) quizBox.hidden = !showQuiz;

  if (hot) {
    title.textContent = gameTitle(room, room.activeGame);
    let line = 'Бомба у ' + (holderName(bomb) || 'игрока');
    if (!room.tvMode) line = 'Игра идёт на телефонах';
    else if (!bomb || bomb.phase === 'countdown') line = 'Приготовьтесь';
    else if (bomb.phase === 'boom') line = 'Взрыв';
    else if (bomb.phase === 'over') line = 'Победители';
    paintStatus(line, false);
    if (!showBomb) renderGuests(room.players, true);
    if (showBomb) paintTvBomb();
    return;
  }

  if (quizOn) {
    title.textContent = gameTitle(room, room.activeGame);
    paintStatus(quizStatus(quiz, room.tvMode), false);
    if (showQuiz) paintQuizTv(quiz);
    else renderGuests(room.players, true);
    return;
  }

  if (room.roundStatus !== 'playing') {
    bomb = null;
    if (quiz) syncQuizClock('tv', null);
    quiz = null;
  }
  if (room.roundStatus === 'playing') {
    title.textContent = gameTitle(room, room.activeGame);
    paintStatus('Игра началась', false);
  } else if (!online.length) {
    title.textContent = 'Лобби';
    paintStatus('Ожидание гостей', true);
  } else {
    title.textContent = 'Лобби';
    paintStatus('Ожидание запуска игры ведущим...', true);
  }

  renderGuests(room.players, false);
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
  if (room.roundStatus === 'playing') return;
  fillBars(document.getElementById('bars'), room.games, room.pendingGame, room.selectedGame);
});

socket.on('game_start', (payload) => {
  const gameId = payload && payload.gameId;
  if ((gameId === 'hotbomb' || gameId === 'quiz') && room) {
    room.roundStatus = 'playing';
    room.activeGame = gameId;
    render(room);
    return;
  }
  document.getElementById('tv-title').textContent = (payload && payload.title) || 'Игра';
  paintStatus('Игра началась', false);
});

socket.on('bomb_state', (next) => {
  const prev = bomb;
  bomb = next && next.phase ? next : null;
  if (bomb) applyBombScores(room, bomb);
  if (prev && bomb && bomb.phase === 'boom' && (prev.phase !== 'boom' || prev.boomId !== bomb.boomId)) {
    flashScreen();
  }
  if (room && (room.roundStatus === 'playing' || !bomb)) render(room);
});

socket.on('quiz_state', (next) => {
  quiz = next && next.phase ? next : null;
  if (quiz) {
    quiz.at = Date.now();
    applyQuizScores(room, quiz);
  }
  syncQuizClock('tv', quiz);
  if (room && (room.roundStatus === 'playing' || !quiz)) render(room);
});

if (document.body.classList.contains('is-lobby')) {
  const list = document.getElementById('guests');
  const seats = seatTotal();
  list.style.setProperty('--seat-count', String(seats));
  while (list.children.length < seats) list.appendChild(emptySeat());
}
