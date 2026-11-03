const EKI_PIPS = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]],
};
const EKI_TURN = {
  1: 'rotateX(0deg) rotateY(0deg)',
  2: 'rotateX(-90deg) rotateY(0deg)',
  3: 'rotateX(0deg) rotateY(-90deg)',
  4: 'rotateX(0deg) rotateY(90deg)',
  5: 'rotateX(90deg) rotateY(0deg)',
  6: 'rotateX(0deg) rotateY(180deg)',
};
const ekiClocks = { player: null, tv: null };

const EKI_CELLS = [
  [21.29, 90.09], [43.55, 90.23], [54.93, 90.14], [65.33, 90.43], [78.76, 89.79],
  [81.05, 72.71], [80.32, 64.60], [73.68, 62.55], [71.73, 69.87], [67.58, 84.81],
  [63.18, 78.27], [64.26, 71.73], [64.31, 62.84], [57.28, 64.89], [58.11, 73.88],
  [51.90, 72.66], [50.98, 63.67], [43.85, 64.40], [43.65, 80.13], [31.79, 78.08],
  [24.07, 72.46], [21.53, 64.21], [29.49, 61.52], [32.08, 51.61], [44.63, 51.07],
  [54.35, 49.17], [62.30, 47.12], [67.82, 50.98], [81.49, 49.22], [81.69, 41.31],
  [81.74, 27.73], [71.48, 24.12], [58.69, 24.61], [50.24, 24.90], [43.85, 30.96],
  [56.59, 30.86], [70.56, 29.49], [69.82, 36.47], [61.91, 36.43], [52.59, 36.38],
  [45.41, 43.75], [32.18, 44.04], [17.97, 39.50], [21.58, 31.01], [31.35, 27.44],
  [32.37, 21.14], [44.68, 15.04], [52.93, 13.92], [68.12, 14.40], [81.15, 14.45],
];

function ekiSeat(view, id) {
  if (!view || !view.roster) return null;
  return view.roster.find((seat) => seat.id === id) || null;
}

function ekiPoint(cell) {
  const index = Math.max(0, Math.min(49, cell - 1));
  const pair = EKI_CELLS[index];
  return { x: pair[0], y: pair[1] };
}

function ensureEkiBoard(root) {
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';
  const photo = make('img', 'eki-photo');
  photo.src = '/ekivoki-board.jpg';
  photo.alt = '';
  const glows = make('div', 'eki-glows');
  for (let cell = 1; cell <= EKI_CELLS.length; cell += 1) {
    const dot = make('span', 'eki-glow');
    const point = ekiPoint(cell);
    dot.dataset.cell = String(cell);
    dot.style.left = point.x + '%';
    dot.style.top = point.y + '%';
    glows.appendChild(dot);
  }
  const tokens = make('div', 'eki-tokens');
  root.append(photo, glows, tokens);
  if (!ekiStill()) ekiGlowTimer = setInterval(wanderGlows, 2800);
  wanderGlows();
}

let ekiGlowTimer = null;

function paintGlows(hotCell) {
  const layer = document.querySelector('.eki-glows');
  if (!layer) return;
  layer.querySelectorAll('.eki-glow').forEach((dot) => {
    dot.classList.toggle('is-live', Number(dot.dataset.cell) === hotCell);
  });
}

function wanderGlows() {
  const layer = document.querySelector('.eki-glows');
  if (!layer || ekiStill()) return;
  const pool = [];
  layer.querySelectorAll('.eki-glow').forEach((dot) => {
    dot.classList.remove('is-wander');
    if (!dot.classList.contains('is-live')) pool.push(dot);
  });
  let left = 3;
  while (left && pool.length) {
    const index = Math.floor(Math.random() * pool.length);
    pool.splice(index, 1)[0].classList.add('is-wander');
    left -= 1;
  }
}

function ekiShift(groups, seat) {
  const list = groups.get(seat.cell) || [seat.id];
  const index = list.indexOf(seat.id);
  if (list.length < 2) return { x: 0, y: 0 };
  const angle = -Math.PI / 2 + (index / list.length) * Math.PI * 2;
  return {
    x: Math.round(Math.cos(angle) * 12),
    y: Math.round(Math.sin(angle) * 9),
  };
}

const ekiHops = new Map();

function placeToken(node, cell, shift, snap) {
  const point = ekiPoint(cell);
  if (snap) node.classList.add('is-snap');
  node.style.left = point.x + '%';
  node.style.top = point.y + '%';
  node.style.transform = 'translate(calc(-50% + ' + shift.x + 'px), calc(-36% + ' + shift.y + 'px))';
  node.dataset.cell = String(cell);
  if (snap) {
    void node.offsetWidth;
    node.classList.remove('is-snap');
  }
}

function stopHop(id, node) {
  const hop = ekiHops.get(id);
  if (hop) clearTimeout(hop.timer);
  ekiHops.delete(id);
  if (!node) return;
  node.classList.remove('is-hop');
  const ava = node.querySelector('.eki-ava');
  if (ava) ava.classList.remove('is-jump');
}

function startHop(node, from, to, shift) {
  const id = node.dataset.id;
  stopHop(id, node);
  let cell = from;
  const step = () => {
    const hop = ekiHops.get(id);
    if (!hop || hop.to !== to || !node.isConnected) {
      stopHop(id, node);
      return;
    }
    cell += 1;
    const ava = node.querySelector('.eki-ava');
    node.classList.add('is-hop');
    if (ava) {
      ava.classList.remove('is-jump');
      void ava.offsetWidth;
      ava.classList.add('is-jump');
    }
    const done = cell >= to;
    placeToken(node, cell, done ? hop.shift : { x: 0, y: 0 }, false);
    paintGlows(cell);
    const label = document.querySelector('.eki-q[data-id="' + id + '"] .eki-q-cell');
    if (label) label.textContent = String(cell);
    if (done) {
      ekiHops.delete(id);
      node.classList.remove('is-hop');
      return;
    }
    hop.timer = setTimeout(step, 520);
  };
  ekiHops.set(id, { to, shift, timer: setTimeout(step, 40) });
}

function paintEkiTokens(layer, view) {
  if (!layer || !view) return;
  const roster = view.roster || [];
  const groups = new Map();
  roster.forEach((seat) => {
    const list = groups.get(seat.cell) || [];
    list.push(seat.id);
    groups.set(seat.cell, list);
  });
  const seen = new Set();
  roster.forEach((seat) => {
    seen.add(seat.id);
    let node = layer.querySelector('[data-id="' + seat.id + '"]');
    if (!node) {
      node = make('div', 'eki-token');
      node.dataset.id = seat.id;
      node.append(make('span', 'eki-ava'), make('span', 'eki-nick'));
      layer.appendChild(node);
    }
    const shift = ekiShift(groups, seat);
    const hop = ekiHops.get(seat.id);
    if (hop && hop.to === seat.cell) hop.shift = shift;
    else {
      const from = Number(node.dataset.cell);
      const to = seat.cell;
      if (hop) stopHop(seat.id, node);
      if (from && to > from && to - from <= 6 && !ekiStill()) startHop(node, from, to, shift);
      else placeToken(node, to, shift, !from);
    }
    node.classList.toggle('is-hot', seat.id === view.turnId && view.phase !== 'over');
    node.classList.toggle('is-off', !seat.online);
    const ava = node.querySelector('.eki-ava');
    const nick = node.querySelector('.eki-nick');
    if (ava.textContent !== seat.avatar) ava.textContent = seat.avatar;
    if (nick.textContent !== seat.nickname) nick.textContent = seat.nickname;
  });
  for (const node of [...layer.children]) {
    if (!seen.has(node.dataset.id)) {
      stopHop(node.dataset.id, node);
      node.remove();
    }
  }
}

function paintEkiQueue(container, view) {
  if (!container) return;
  const roster = (view && view.roster) || [];
  container.hidden = !view || !roster.length;
  if (container.hidden) return;
  const seen = new Set();
  roster.forEach((seat) => {
    seen.add(seat.id);
    let item = container.querySelector('[data-id="' + seat.id + '"]');
    if (!item) {
      item = make('div', 'eki-q');
      item.dataset.id = seat.id;
      item.append(make('span', 'eki-q-face face'), make('span', 'eki-q-name'), make('span', 'eki-q-cell'));
      container.appendChild(item);
    }
    item.classList.toggle('is-hot', seat.id === view.turnId);
    item.classList.toggle('is-off', !seat.online);
    paintFace(item.querySelector('.eki-q-face'), seat.avatar, seat.cups);
    const name = item.querySelector('.eki-q-name');
    const cell = item.querySelector('.eki-q-cell');
    if (name.textContent !== seat.nickname) name.textContent = seat.nickname;
    const token = document.querySelector('.eki-token[data-id="' + seat.id + '"]');
    const text = token && token.dataset.cell ? token.dataset.cell : String(seat.cell);
    if (cell.textContent !== text) cell.textContent = text;
  });
  for (const item of [...container.children]) {
    if (!seen.has(item.dataset.id)) item.remove();
  }
  roster.forEach((seat) => {
    const item = container.querySelector('[data-id="' + seat.id + '"]');
    if (item) container.appendChild(item);
  });
}

function paintEkiPodium(container, podium) {
  if (!container) return;
  if (!podium || !podium.length) {
    container.hidden = true;
    container.dataset.key = '';
    return;
  }
  container.hidden = false;
  const key = podium.map((seat) => seat.id + ':' + seat.place + ':' + seat.cell + ':' + cupsKey(seat.cups)).join(',');
  if (container.dataset.key === key && container.childElementCount) return;
  container.dataset.key = key;
  clearNode(container);
  podium.forEach((seat) => {
    const card = make('div', 'bomb-winner is-place-' + seat.place);
    const face = make('span', 'bomb-face');
    paintFace(face, seat.avatar, seat.cups);
    const line = seat.place + ' место · клетка ' + seat.cell;
    card.append(face, make('strong', null, seat.nickname), make('span', null, line));
    container.appendChild(card);
  });
}

function ekiStatus(view, tvMode) {
  if (!tvMode) return 'Игра идёт на телефонах';
  if (!view) return 'Приготовьтесь';
  if (view.phase === 'over') return 'Финиш';
  const seat = ekiSeat(view, view.turnId);
  const name = seat ? seat.nickname : 'Игрок';
  if (view.clock === 'away') return name + ' не на связи';
  if (view.phase === 'roll') return 'Ход: ' + name;
  if (view.mode && view.mode.title) return name + ' · ' + view.mode.title;
  return 'Ход: ' + name;
}

function ekiWait(view, me) {
  if (!view || view.phase === 'over') return '';
  if (me && view.turnId === me.id) return '';
  const seat = ekiSeat(view, view.turnId);
  const name = seat ? seat.nickname : 'игрок';
  if (view.clock === 'away') return 'Ожидайте своего хода. ' + name + ' не на связи.';
  let line = 'Ожидайте своего хода. Сейчас играет ' + name + '.';
  if (view.mode && view.mode.title) line += ' Режим: ' + view.mode.title + '.';
  return line;
}

function ensureDie(die) {
  if (!die || die.dataset.built === '1') return;
  die.dataset.built = '1';
  die.setAttribute('aria-hidden', 'true');
  const cube = make('div', 'die-cube');
  for (let face = 1; face <= 6; face += 1) {
    const side = make('div', 'die-face is-' + face);
    EKI_PIPS[face].forEach((pip) => {
      const dot = make('i');
      dot.style.gridColumn = String(pip[0]);
      dot.style.gridRow = String(pip[1]);
      side.appendChild(dot);
    });
    cube.appendChild(side);
  }
  die.appendChild(cube);
}

function ekiStill() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function setDieFace(die, face) {
  const cube = die.querySelector('.die-cube');
  if (!cube) return;
  if (cube.getAnimations) cube.getAnimations().forEach((anim) => anim.cancel());
  cube.style.transform = EKI_TURN[face] || EKI_TURN[1];
}

function dieLanding(face) {
  const turns = {
    1: [720, 720],
    2: [630, 720],
    3: [720, 630],
    4: [720, 810],
    5: [810, 720],
    6: [720, 900],
  };
  const pair = turns[face] || turns[1];
  return 'rotateX(' + pair[0] + 'deg) rotateY(' + pair[1] + 'deg)';
}

function paintDie(die, view, spin) {
  if (!die) return false;
  const show = !!(view && view.face && (view.phase === 'read' || view.phase === 'play'));
  die.hidden = !show;
  if (!show) return false;
  ensureDie(die);
  const key = String(view.turnNo || 0);
  if (!spin || view.phase === 'play' || die.dataset.landed === key || ekiStill()) {
    die.dataset.landed = key;
    die.dataset.spinning = '';
    setDieFace(die, view.face);
    return false;
  }
  if (die.dataset.spinning === key) return true;
  const cube = die.querySelector('.die-cube');
  die.dataset.spinning = key;
  const from = cube.style.transform || EKI_TURN[1];
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    if (die.dataset.spinning !== key) return;
    die.dataset.landed = key;
    die.dataset.spinning = '';
    setDieFace(die, view.face);
    die.dispatchEvent(new CustomEvent('eki-landed', { bubbles: true }));
  };
  if (!cube.animate) {
    finish();
    return false;
  }
  const anim = cube.animate([
    { transform: from },
    { transform: dieLanding(view.face) },
  ], {
    duration: 1500,
    easing: 'cubic-bezier(0.12, 0.7, 0.05, 1)',
    fill: 'forwards',
  });
  anim.onfinish = finish;
  setTimeout(finish, 1700);
  return true;
}

function setEkiText(id, value) {
  const node = document.getElementById(id);
  if (!node || node.textContent === value) return;
  node.textContent = value;
}

function paintWords(list, words) {
  if (!list) return;
  if (!words || !words.length) {
    list.hidden = true;
    list.dataset.key = '';
    return;
  }
  list.hidden = false;
  const key = words.join('|');
  if (list.dataset.key === key && list.childElementCount) return;
  list.dataset.key = key;
  clearNode(list);
  words.forEach((word) => list.appendChild(make('li', null, word)));
}

function paintEkiList(list, view, me, room) {
  if (!list) return;
  const show = !!(view && room && !room.tvMode && view.phase !== 'over');
  list.hidden = !show;
  if (!show) return;
  const rows = view.roster.slice().sort((a, b) => b.cell - a.cell || a.nickname.localeCompare(b.nickname, 'ru'));
  let place = 0;
  let prev = null;
  const ranked = rows.map((row, index) => {
    if (prev == null || row.cell !== prev) {
      place = index + 1;
      prev = row.cell;
    }
    return { seat: row, place };
  });
  const key = ranked.map((row) => row.seat.id + ':' + row.place + ':' + row.seat.cell + ':' + (row.seat.online ? 1 : 0) + ':' + (row.seat.id === view.turnId ? 1 : 0)).join('|');
  if (list.dataset.key === key && list.childElementCount) return;
  list.dataset.key = key;
  clearNode(list);
  ranked.forEach((row) => {
    const seat = row.seat;
    const item = make('li', (seat.id === view.turnId ? 'is-turn' : '') + (seat.online ? '' : ' is-off'));
    let who = seat.nickname;
    if (me && seat.id === me.id) who += ' · вы';
    if (seat.id === view.turnId) who += ' · ход';
    item.append(make('span', null, row.place + '. ' + who), make('strong', null, 'клетка ' + seat.cell));
    list.appendChild(item);
  });
}

function paintEkiPlayer(view, mine, me, room) {
  const pos = document.getElementById('eki-pos');
  const wait = document.getElementById('eki-wait');
  const task = document.getElementById('eki-task');
  const face = document.getElementById('eki-face');
  if (!pos || !task) return;
  if (!view) {
    pos.textContent = 'Приготовьтесь';
    if (wait) wait.hidden = true;
    task.hidden = true;
    if (face) face.hidden = true;
    const die = document.getElementById('eki-die');
    if (die) die.hidden = true;
    ['eki-roll', 'eki-start', 'eki-judge', 'eki-list', 'eki-podium'].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.hidden = true;
    });
    syncEkiClock('player', null);
    return;
  }
  const seat = ekiSeat(view, me && me.id);
  const track = view.track || 50;
  const over = view.phase === 'over';
  pos.hidden = over;
  pos.textContent = 'Клетка ' + (seat ? seat.cell : 1) + ' из ' + track;
  const mineTurn = !!(me && view.turnId === me.id);
  const spinning = paintDie(document.getElementById('eki-die'), view, mineTurn);
  const secret = !!(mine && mine.secret && String(mine.turnNo) === String(view.turnNo));
  const showTask = secret && !spinning && (view.phase === 'read' || view.phase === 'play');
  task.hidden = !showTask;
  if (face) {
    const known = !!(view.face && (view.phase === 'read' || view.phase === 'play'));
    face.hidden = !known;
    if (spinning) face.textContent = 'Кубик крутится';
    else if (known) face.textContent = 'Выпало ' + view.face + (view.mode ? ' · ' + view.mode.title : '');
  }
  if (showTask) {
    setEkiText('eki-mode', (view.mode && view.mode.title) || '');
    setEkiText('eki-hint', mine.hint || '');
    const lead = document.getElementById('eki-lead');
    const word = document.getElementById('eki-word');
    const theme = document.getElementById('eki-theme');
    const answer = document.getElementById('eki-answer');
    const packs = !!(mine.words && mine.words.length);
    if (lead) {
      lead.hidden = !mine.say;
      lead.textContent = mine.say ? 'Читайте вслух' : '';
    }
    if (word) {
      word.hidden = packs;
      word.textContent = mine.say || mine.word || '';
    }
    if (theme) {
      theme.hidden = !mine.theme;
      if (packs) theme.textContent = 'Тема: ' + mine.theme;
      else if (mine.theme) theme.textContent = 'Назовите тему: ' + mine.theme;
      else theme.textContent = '';
    }
    paintWords(document.getElementById('eki-words'), packs ? mine.words : null);
    if (answer) {
      answer.hidden = !mine.say;
      answer.textContent = mine.say ? 'Загадали: ' + mine.word : '';
    }
  }
  const waitText = ekiWait(view, me);
  if (wait) {
    wait.hidden = !waitText;
    if (wait.textContent !== waitText) wait.textContent = waitText;
  }
  const roll = document.getElementById('eki-roll');
  const start = document.getElementById('eki-start');
  const judge = document.getElementById('eki-judge');
  if (roll) roll.hidden = !(mineTurn && view.phase === 'roll');
  if (start) start.hidden = !(mineTurn && view.phase === 'read' && !spinning);
  if (judge) judge.hidden = !(mineTurn && view.phase === 'play');
  paintEkiList(document.getElementById('eki-list'), view, me, room);
  paintEkiPodium(document.getElementById('eki-podium'), over ? view.podium : null);
  syncEkiClock('player', view);
}

function ekiAct(title, started) {
  const lines = {
    'Объясни словами': ['будет объяснять словами', 'объясняет словами'],
    'Наоборот': ['будет читать наоборот', 'читает наоборот'],
    'Нарисуй': ['будет рисовать', 'рисует'],
    'Слепи': ['будет лепить', 'лепит'],
    'Да или нет': ['будет играть в «да или нет»', 'играет в «да или нет»'],
    'Скажи где': ['будет говорить, где', 'говорит, где'],
  };
  const pair = lines[title];
  if (!pair) return '';
  return pair[started ? 1 : 0];
}

function paintEkiNow(view) {
  const who = document.getElementById('tv-eki-who');
  const line = document.getElementById('tv-eki-line');
  const spin = document.getElementById('tv-eki-waitspin');
  if (!who || !line) return;
  const seat = view ? ekiSeat(view, view.turnId) : null;
  const name = seat ? seat.nickname : '';
  const title = view && view.mode && view.mode.title;
  let whoText = name;
  let lineText = '';
  let showSpin = false;
  if (!view || view.phase === 'over') whoText = 'Финиш';
  else if (view.clock === 'away') lineText = 'не на связи';
  else if (view.phase === 'roll') lineText = 'сейчас ход';
  else if (view.phase === 'read') {
    lineText = ekiAct(title, false) || 'смотрит задание';
    showSpin = true;
  } else if (view.phase === 'play') lineText = ekiAct(title, true) || title || '';
  if (who.textContent !== whoText) who.textContent = whoText;
  if (line.textContent !== lineText) line.textContent = lineText;
  if (spin) spin.hidden = !showSpin;
}

function paintEkiTv(view) {
  const board = document.getElementById('tv-eki-board');
  if (!board) return;
  ensureEkiBoard(board);
  if (!view) {
    syncEkiClock('tv', null);
    paintEkiNow(null);
    return;
  }
  paintEkiQueue(document.getElementById('tv-eki-queue'), view);
  paintEkiTokens(board.querySelector('.eki-tokens'), view);
  const turn = ekiSeat(view, view.turnId);
  const token = turn && board.querySelector('.eki-token[data-id="' + turn.id + '"]');
  const hot = token && token.dataset.cell ? Number(token.dataset.cell) : (turn ? turn.cell : 0);
  paintGlows(hot);
  paintDie(document.getElementById('tv-eki-die'), view, false);
  paintEkiNow(view);
  paintEkiPodium(document.getElementById('tv-eki-podium'), view.phase === 'over' ? view.podium : null);
  syncEkiClock('tv', view);
}

function syncEkiClock(kind, view) {
  if (ekiClocks[kind]) {
    clearInterval(ekiClocks[kind]);
    ekiClocks[kind] = null;
  }
  const clock = document.getElementById(kind === 'tv' ? 'tv-eki-clock' : 'eki-clock');
  const bar = document.getElementById(kind === 'tv' ? 'tv-eki-bar' : 'eki-bar');
  const fill = bar ? bar.querySelector('span') : null;
  const live = !!(view && view.left != null && view.limit && view.clock === 'play');
  if (!clock || !live) {
    if (clock) {
      clock.hidden = true;
      clock.classList.remove('is-low');
    }
    if (bar) bar.hidden = true;
    return;
  }
  const draw = () => {
    const left = Math.max(0, view.left - (Date.now() - (view.at || Date.now())));
    const seconds = Math.ceil(left / 1000);
    clock.hidden = false;
    clock.textContent = String(seconds);
    clock.classList.toggle('is-low', seconds <= 10);
    if (bar && fill) {
      bar.hidden = false;
      fill.style.width = Math.max(0, Math.min(100, (left / view.limit) * 100)) + '%';
    }
  };
  draw();
  ekiClocks[kind] = setInterval(draw, 200);
}

function applyEkiScores(roomState, view) {
  if (!roomState || !view || !view.roster || !roomState.players) return;
  view.roster.forEach((seat) => {
    const player = roomState.players.find((item) => item.id === seat.id);
    if (!player) return;
    player.score = seat.cell;
    if (seat.cups) player.cups = seat.cups;
  });
}

function ekiCellOf(view, id) {
  const seat = ekiSeat(view, id);
  return seat ? seat.cell : 0;
}

function reactEki(prev, next, me, buzz) {
  if (!next || typeof buzz !== 'function') return;
  if (next.phase === 'over' && (!prev || prev.phase !== 'over')) {
    buzz([60, 40, 60, 40, 120]);
    return;
  }
  if (!me) return;
  const opened = next.turnId === me.id && next.phase === 'roll'
    && (!prev || prev.turnId !== me.id || prev.phase !== 'roll');
  if (opened) buzz([50, 30, 70]);
  const landed = next.turnId === me.id && next.phase === 'read'
    && (!prev || prev.phase !== 'read' || prev.turnNo !== next.turnNo);
  if (landed) buzz(28);
  if (!prev || prev.turnId !== me.id || prev.phase === 'over' || prev.phase === 'roll') return;
  const movedOn = next.turnId !== me.id || next.phase === 'over';
  if (!movedOn) return;
  if (ekiCellOf(next, me.id) > ekiCellOf(prev, me.id)) buzz([40, 28, 70]);
  else buzz([18, 36, 18]);
}

function paintEkiHost(view, room) {
  const box = document.getElementById('eki-host');
  if (!box) return;
  const on = !!(room && room.roundStatus === 'playing' && room.activeGame === 'ekivoki' && view && view.roster && view.phase !== 'over');
  box.hidden = !on;
  if (!on) return;
  const list = document.getElementById('eki-cells');
  if (!list) return;
  const key = view.roster.map((seat) => seat.id).join(',');
  if (list.dataset.key !== key) {
    list.dataset.key = key;
    clearNode(list);
    view.roster.forEach((seat) => {
      const row = make('label', 'eki-cell-row');
      const face = make('span', 'eki-mini', seat.avatar);
      const name = make('span', 'eki-cell-name', seat.nickname);
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = String(view.track || 50);
      input.step = '1';
      input.inputMode = 'numeric';
      input.dataset.ekiCell = seat.id;
      input.setAttribute('aria-label', 'Клетка ' + seat.nickname);
      row.append(face, name, input);
      list.appendChild(row);
    });
  }
  view.roster.forEach((seat) => {
    const input = list.querySelector('[data-eki-cell="' + seat.id + '"]');
    if (!input) return;
    const row = input.parentElement;
    if (row) row.classList.toggle('is-off', !seat.online);
    const name = row && row.querySelector('.eki-cell-name');
    const face = row && row.querySelector('.eki-mini');
    if (name && name.textContent !== seat.nickname) name.textContent = seat.nickname;
    if (face && face.textContent !== seat.avatar) face.textContent = seat.avatar;
    if (document.activeElement === input) return;
    const text = String(seat.cell);
    if (input.value !== text) input.value = text;
  });
  const turn = ekiSeat(view, view.turnId);
  const away = !!(turn && !turn.online);
  const note = document.getElementById('eki-away');
  if (note) {
    note.hidden = !away;
    note.textContent = away ? turn.nickname + ' не на связи. Ход ждёт, пока вернётся.' : '';
  }
  const ask = document.getElementById('eki-skip-ask');
  if (ask) {
    ask.textContent = away
      ? 'Пропустить игрока? Ход перейдёт следующему, без очков.'
      : 'Пропустить ход без очков? Ход перейдёт следующему.';
  }
  const confirm = document.getElementById('eki-skip-confirm');
  const skip = document.getElementById('eki-skip');
  if (box.dataset.turn !== String(view.turnNo)) {
    box.dataset.turn = String(view.turnNo);
    if (confirm) confirm.hidden = true;
    if (skip) skip.hidden = false;
  }
  if (skip && (!confirm || confirm.hidden)) {
    skip.textContent = away ? 'Пропустить игрока' : 'Пропустить ход';
  }
}
