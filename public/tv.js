const socket = io();
let room = null;
let bomb = null;
let quiz = null;

function renderGuests(players, showScore) {
  const list = document.getElementById('guests');
  const online = players.filter((player) => player.isOnline);
  clearNode(list);
  list.dataset.count = String(online.length);
  online.forEach((player) => {
    const item = make('li', 'guest');
    const face = make('span', 'face');
    paintFace(face, player.avatar, player.cups);
    item.append(face, make('span', 'name', player.nickname));
    if (showScore) item.append(make('span', 'score', pointsLabel(player.score)));
    list.appendChild(item);
  });
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
  const online = room.players.filter((player) => player.isOnline);
  const title = document.getElementById('tv-title');
  const status = document.getElementById('tv-status');
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
    status.classList.remove('is-waiting');
    if (!room.tvMode) status.textContent = 'Игра идёт на телефонах';
    else if (!bomb || bomb.phase === 'countdown') status.textContent = 'Приготовьтесь';
    else if (bomb.phase === 'boom') status.textContent = 'Взрыв';
    else if (bomb.phase === 'over') status.textContent = 'Победители';
    else status.textContent = 'Бомба у ' + (holderName(bomb) || 'игрока');
    if (!showBomb) renderGuests(room.players, true);
    if (showBomb) paintTvBomb();
    return;
  }

  if (quizOn) {
    title.textContent = gameTitle(room, room.activeGame);
    status.classList.remove('is-waiting');
    status.textContent = quizStatus(quiz, room.tvMode);
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
  const status = document.getElementById('tv-status');
  status.textContent = 'Игра началась';
  status.classList.remove('is-waiting');
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
