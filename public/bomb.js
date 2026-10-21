function seatById(view, id) {
  if (!view || !id || !view.chain) return null;
  for (let i = 0; i < view.chain.length; i += 1) {
    if (view.chain[i].id === id) return view.chain[i];
  }
  return null;
}

function holderName(view) {
  const seat = seatById(view, view && view.holderId);
  return seat ? seat.nickname : '';
}

function nameById(view, id) {
  const seat = seatById(view, id);
  return seat ? seat.nickname : '';
}

function prepareLine(view) {
  return 'Бомба у ' + (holderName(view) || 'игрока') + ', приготовься!';
}

function rateText(view) {
  const n = view && Number(view.perSec);
  const value = Number.isFinite(n) ? n : 10;
  return '+' + value + ' очков каждую секунду';
}

function winnerLine(view, me) {
  const names = [];
  (view.winners || []).forEach((id) => {
    const name = nameById(view, id);
    if (name) names.push(name);
  });
  const joined = names.join(' и ');
  const mine = !!(me && view.winners && view.winners.indexOf(me.id) !== -1);
  if (mine) return joined ? 'Победа: ' + joined : 'Победа';
  return joined ? 'Победители: ' + joined : 'Игра окончена';
}

function punch(node) {
  if (!node) return;
  node.classList.remove('is-pop');
  void node.offsetWidth;
  node.classList.add('is-pop');
}

function showCount(node, value) {
  if (!node) return;
  const label = value || '';
  node.classList.toggle('is-go', label === 'GO');
  if (node.textContent === label) return;
  node.textContent = label;
  punch(node);
}

function faceGlyph(seat, view) {
  if (view.phase === 'boom' && seat.id === view.boomId) return seat.avatar;
  if (!seat.alive) return '💀';
  return seat.avatar;
}

function markGlyph(seat, view) {
  if (view.phase === 'boom' && seat.id === view.boomId) return '💥';
  if (!seat.alive) return '';
  if (seat.id === view.holderId && (view.phase === 'live' || view.phase === 'countdown')) return '💣';
  return '';
}

function seatClass(seat, view) {
  const names = ['bomb-seat'];
  if (view.phase === 'boom' && seat.id === view.boomId) names.push('is-boom');
  else if (!seat.alive) names.push('is-dead');
  if (seat.alive && seat.id === view.holderId && view.phase !== 'over') names.push('is-hot');
  if (view.phase === 'over' && (view.winners || []).indexOf(seat.id) !== -1) names.push('is-winner');
  if (!seat.online) names.push('is-off');
  return names.join(' ');
}

function fillBombChain(container, view) {
  if (!container || !view) return;
  const chain = view.chain || [];
  const reusable = container.children.length === chain.length
    && chain.every((seat, index) => container.children[index].dataset.id === seat.id);
  if (!reusable) {
    clearNode(container);
    chain.forEach((seat) => {
      const item = make('div', 'bomb-seat');
      item.dataset.id = seat.id;
      item.append(
        make('span', 'bomb-face', ''),
        make('span', 'bomb-mark', ''),
        make('span', 'bomb-name', ''),
        make('span', 'bomb-score', '')
      );
      container.appendChild(item);
    });
  }

  let holderChanged = false;
  chain.forEach((seat, index) => {
    const item = container.children[index];
    const nextClass = seatClass(seat, view);
    if (item.className !== nextClass) {
      if (nextClass.indexOf('is-hot') !== -1 && item.className.indexOf('is-hot') === -1) holderChanged = true;
      item.className = nextClass;
    }
    const face = item.querySelector('.bomb-face');
    const mark = item.querySelector('.bomb-mark');
    const name = item.querySelector('.bomb-name');
    const score = item.querySelector('.bomb-score');
    const glyph = faceGlyph(seat, view);
    const badge = markGlyph(seat, view);
    paintFace(face, glyph, seat.cups);
    if (mark.textContent !== badge) mark.textContent = badge;
    if (name.textContent !== seat.nickname) name.textContent = seat.nickname;
    const points = String(seat.score);
    if (score.textContent !== points) score.textContent = points;
  });

  if (holderChanged && container.classList.contains('bomb-chain')) {
    const hot = container.querySelector('.is-hot');
    if (!hot) return;
    const left = hot.offsetLeft - (container.clientWidth - hot.offsetWidth) / 2;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.scrollTo({ left: Math.max(0, left), behavior: reduce ? 'auto' : 'smooth' });
  }
}

function fillWinners(container, view) {
  if (!container) return;
  const key = (view.winners || []).map((id) => {
    const seat = seatById(view, id);
    return id + ':' + (seat ? seat.score : 0) + ':' + cupsKey(seat && seat.cups);
  }).join(',');
  if (container.dataset.key === key && container.childElementCount) return;
  container.dataset.key = key;
  clearNode(container);
  (view.winners || []).forEach((id) => {
    const seat = seatById(view, id);
    if (!seat) return;
    const card = make('div', 'bomb-winner');
    const face = make('span', 'bomb-face');
    paintFace(face, seat.avatar, seat.cups);
    card.append(
      face,
      make('strong', null, seat.nickname),
      make('span', null, pointsLabel(seat.score))
    );
    container.appendChild(card);
  });
}

function applyBombScores(room, view) {
  if (!room || !view || !view.chain || !room.players) return;
  view.chain.forEach((seat) => {
    const player = room.players.find((item) => item.id === seat.id);
    if (player) {
      player.score = seat.score;
      if (seat.cups) player.cups = seat.cups;
    }
  });
}

function flashScreen() {
  const node = document.createElement('div');
  node.className = 'bomb-flash';
  document.body.appendChild(node);
  setTimeout(() => {
    if (node.parentNode) node.parentNode.removeChild(node);
  }, 520);
}
