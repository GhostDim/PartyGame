const echoClocks = { player: null, tv: null };
let echoPress = -1;
let echoTapMark = '';

function squaresLabel(count) {
  const n = Math.abs(count);
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return count + ' квадрат';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return count + ' квадрата';
  return count + ' квадратов';
}

function echoTeam(view, side) {
  if (!view) return null;
  return side === 'right' ? view.right : view.left;
}

function echoPair(view) {
  if (!view || !view.duel || !view.duel.left || !view.duel.right) return '';
  const left = view.duel.left;
  const right = view.duel.right;
  const leftName = left.nickname + (left.tag ? ' (' + left.tag + ')' : '');
  const rightName = right.nickname + (right.tag ? ' (' + right.tag + ')' : '');
  return leftName + ' и ' + rightName;
}

function echoAwayName(view) {
  if (!view || !view.duel) return '';
  const seats = [view.duel.left, view.duel.right].filter((seat) => seat && !seat.online);
  if (!seats.length) return '';
  return seats.map((seat) => seat.nickname).join(' и ');
}

function echoNextLine(view) {
  if (!view || view.phase === 'draft' || view.phase === 'over') return '';
  const now = echoPair(view);
  const left = (view.left && view.left.seats || []).find((seat) => seat.state === 'next');
  const right = (view.right && view.right.seats || []).find((seat) => seat.state === 'next');
  const parts = [];
  if (now) parts.push('Сейчас ' + now);
  if (left && right) parts.push('Дальше ' + left.nickname + ' и ' + right.nickname);
  return parts.join('. ');
}

function echoStatus(view, mine, tvMode) {
  if (!view) return 'Эхо собирается';
  if (view.phase === 'draft') {
    if (mine && mine.side) return 'Вы в стороне «' + echoTeam(view, mine.side).title + '»';
    return 'Выберите сторону';
  }
  if (view.phase === 'cast') return '';
  if (view.phase === 'wait') {
    const who = echoAwayName(view);
    return who ? who + ' не на связи. Дуэль ждёт.' : 'Дуэль ждёт игрока';
  }
  if (view.phase === 'count' || view.phase === 'show') {
    const look = tvMode ? 'Смотри на телевизор' : 'Запоминай порядок';
    const next = echoNextLine(view);
    return next ? look + '. ' + next : look;
  }
  if (view.phase === 'input') {
    if (mine && mine.failed) return 'Мимо. Ждём соперника';
    if (mine && mine.done) return 'Верно. Ждём соперника';
    if (mine && mine.canTap) {
      const step = (mine.progress || 0) + 1;
      return 'Клетка ' + step + ' из ' + view.length;
    }
    const pair = echoPair(view);
    return pair ? 'Повторяют ' + pair : 'Повтор';
  }
  if (view.phase === 'gap') return view.note || 'Следующая пара';
  if (view.phase === 'over') return 'Итог сторон';
  return view.note || '';
}

function echoTvLine(view) {
  if (!view) return 'Эхо';
  if (view.phase === 'draft') return 'Набор сторон';
  if (view.phase === 'over') return 'Победители';
  if (view.phase === 'cast') return 'Сейчас играют';
  if (view.phase === 'wait') return echoAwayName(view) ? 'Ждём возвращения' : 'Пауза';
  if (view.phase === 'count' || view.phase === 'show') return 'Запоминайте порядок';
  if (view.phase === 'input') return 'Повтор на телефонах';
  if (view.phase === 'gap') return view.note || 'Счёт дуэли';
  return 'Эхо';
}

function paintEchoScores(view) {
  const left = document.getElementById('echo-left-score');
  const right = document.getElementById('echo-right-score');
  if (!left || !right || !view) return;
  left.textContent = view.left.title + ' · ' + view.left.score;
  right.textContent = view.right.title + ' · ' + view.right.score;
}

function paintSideButton(button, team, mine, side) {
  if (!button || !team) return;
  button.classList.toggle('is-mine', !!(mine && mine.side === side));
  const title = button.querySelector('.echo-side-title');
  const people = button.querySelector('.echo-side-people');
  if (title && title.textContent !== team.title) title.textContent = team.title;
  const text = team.seats.length
    ? team.seats.map((seat) => seat.avatar + ' ' + seat.nickname).join(', ')
    : 'Свободно';
  if (people && people.textContent !== text) people.textContent = text;
}

function paintEchoName(view, mine) {
  const form = document.getElementById('echo-name-form');
  const input = document.getElementById('echo-name');
  const error = document.getElementById('echo-name-error');
  const open = !!(view && view.phase === 'draft' && mine && mine.side);
  if (form) form.hidden = !open;
  if (!input || !open) {
    if (error) error.hidden = true;
    return;
  }
  const team = echoTeam(view, mine.side);
  input.placeholder = team ? team.title : '';
  if (document.activeElement !== input && team) {
    const next = team.name || '';
    if (input.dataset.side !== mine.side || input.dataset.sync !== next) {
      input.dataset.side = mine.side;
      input.dataset.sync = next;
      input.value = next;
    }
  }
  if (error) {
    const message = mine.nameError || '';
    error.hidden = !message;
    error.textContent = message;
  }
}

function paintEchoCast(container, view) {
  if (!container || !view || !view.duel || !view.duel.left || !view.duel.right) return;
  const seats = [view.duel.left, view.duel.right];
  const key = seats.map((seat) => [
    seat.id,
    seat.nickname,
    seat.avatar,
    seat.tag || '',
    cupsKey(seat.cups),
  ].join(':')).join('|');
  if (container.dataset.key === key) return;
  container.dataset.key = key;
  clearNode(container);
  container.appendChild(make('p', 'echo-cast-kicker', 'Сейчас играют'));
  const pair = make('div', 'echo-cast-pair');
  seats.forEach((seat, index) => {
    const card = make('div', 'echo-cast-card is-' + (index === 0 ? 'left' : 'right'));
    const face = make('span', 'face');
    paintFace(face, seat.avatar, seat.cups);
    card.appendChild(face);
    card.appendChild(make('p', 'echo-cast-name', seat.nickname));
    const side = index === 0 ? view.left.title : view.right.title;
    if (side) card.appendChild(make('p', 'echo-cast-side', side));
    if (seat.tag) card.appendChild(make('p', 'echo-cast-tag', seat.tag));
    pair.appendChild(card);
  });
  container.appendChild(pair);
}

function paintEchoRail(node, seats) {
  if (!node) return;
  const list = seats || [];
  const key = list.map((seat) => [
    seat.slot,
    seat.id,
    seat.state,
    seat.borrowed ? 1 : 0,
    seat.online ? 1 : 0,
    seat.nickname,
    seat.avatar,
    seat.tag || '',
  ].join(':')).join('|');
  if (node.dataset.key === key) return;
  node.dataset.key = key;
  clearNode(node);
  list.forEach((seat) => {
    const item = make('li', 'echo-q is-' + (seat.state || 'wait') + (seat.online ? '' : ' is-off'));
    const face = make('span', 'echo-q-face', seat.avatar);
    const meta = make('span', 'echo-q-meta');
    meta.appendChild(make('span', 'echo-q-name', seat.nickname));
    if (seat.tag) meta.appendChild(make('span', 'echo-q-tag', seat.tag));
    item.append(face, meta);
    node.appendChild(item);
  });
}

function syncEchoPress(view) {
  const mark = !view ? '' : view.phase + ':' + view.length + ':' + (view.duel ? view.duel.index : 0);
  if (mark === echoTapMark) return;
  echoTapMark = mark;
  echoPress = -1;
}

function paintEchoGrid(box, view, interactive, mine) {
  if (!box) return;
  if (box.childElementCount !== 9) {
    clearNode(box);
    for (let i = 0; i < 9; i += 1) {
      const cell = make(interactive ? 'button' : 'div', 'echo-cell');
      if (interactive) {
        cell.type = 'button';
        cell.addEventListener('click', () => {
          if (cell.disabled) return;
          echoPress = i;
          cell.classList.add('is-mine');
          socket.emit('player_action', { type: 'tap', cell: i });
        });
      }
      cell.setAttribute('aria-label', 'Клетка ' + (i + 1));
      box.appendChild(cell);
    }
  }
  const lit = view && view.phase === 'show' ? view.lit : null;
  const can = !!(interactive && mine && mine.canTap);
  box.classList.toggle('is-left', !!(mine && mine.seat === 'left'));
  box.classList.toggle('is-right', !!(mine && mine.seat === 'right'));
  Array.from(box.children).forEach((cell, index) => {
    cell.classList.toggle('is-lit', lit === index);
    if (interactive) cell.disabled = !can;
    cell.classList.toggle('is-mine', can && echoPress === index);
    cell.classList.toggle('is-bad', !!(mine && mine.failed && echoPress === index));
  });
}

function paintEchoPodium(container, podium) {
  if (!container) return;
  if (!podium || !podium.length) {
    container.hidden = true;
    if (container.dataset.key) {
      container.dataset.key = '';
      clearNode(container);
    }
    return;
  }
  container.hidden = false;
  const key = podium.map((team) => team.side + ':' + team.place + ':' + team.score + ':' + team.players.map((seat) => {
    return seat.id + ':' + seat.squares + ':' + cupsKey(seat.cups);
  }).join(',')).join('|');
  if (container.dataset.key === key) return;
  container.dataset.key = key;
  clearNode(container);
  podium.forEach((team) => {
    const card = make('section', 'echo-place is-' + team.side + ' is-place-' + team.place);
    const metal = team.place === 1 ? 'Золото' : 'Серебро';
    card.appendChild(make('p', 'echo-place-metal', metal));
    card.appendChild(make('h2', null, team.title));
    card.appendChild(make('p', 'echo-place-score', squaresLabel(team.score)));
    const list = make('ul', 'echo-place-list');
    team.players.forEach((seat) => {
      const item = make('li', seat.online ? '' : 'is-off');
      const face = make('span', 'face');
      paintFace(face, seat.avatar, seat.cups);
      const meta = make('span', 'echo-place-meta');
      meta.appendChild(make('strong', null, seat.nickname));
      const line = squaresLabel(seat.squares || 0) + (seat.extra ? '. ' + seat.extra : '');
      meta.appendChild(make('span', null, line));
      item.append(face, meta);
      list.appendChild(item);
    });
    card.appendChild(list);
    container.appendChild(card);
  });
}

function paintEchoPlayer(view, mine, me, room) {
  const box = document.getElementById('play-echo');
  const generic = document.getElementById('play-generic');
  if (!box) return;
  const playing = !!(room && room.roundStatus === 'playing' && room.activeGame === 'echo');
  if (!playing) {
    box.hidden = true;
    return;
  }
  if (generic) generic.hidden = true;
  box.hidden = false;
  if (!view) {
    const status = document.getElementById('echo-status');
    if (status) status.textContent = 'Эхо собирается';
    return;
  }
  syncEchoPress(view);
  const tvMode = !!room.tvMode;
  const draft = view.phase === 'draft';
  const cast = view.phase === 'cast';
  const memorise = view.phase === 'count' || view.phase === 'show';
  const input = view.phase === 'input';
  const over = view.phase === 'over';
  paintEchoScores(view);

  const count = document.getElementById('echo-count');
  if (count) {
    const showCount = view.phase === 'count' && view.count > 0;
    count.hidden = !showCount;
    if (showCount) count.textContent = String(view.count);
  }

  const status = document.getElementById('echo-status');
  if (status) {
    const text = tvMode && memorise ? (echoNextLine(view) || '') : echoStatus(view, mine, tvMode);
    if (status.textContent !== text) status.textContent = text;
    status.hidden = over || !text;
  }

  const draftBox = document.getElementById('echo-draft');
  if (draftBox) draftBox.hidden = !draft;
  if (draft) {
    paintSideButton(document.getElementById('echo-join-left'), view.left, mine, 'left');
    paintSideButton(document.getElementById('echo-join-right'), view.right, mine, 'right');
    paintEchoName(view, mine);
  }

  const watch = document.getElementById('echo-watch');
  if (watch) {
    watch.hidden = !(tvMode && (memorise || cast));
    watch.textContent = 'Смотри на телевизор';
  }

  const castBox = document.getElementById('echo-cast');
  if (castBox) {
    const showCast = cast && !tvMode;
    castBox.hidden = !showCast;
    if (showCast) paintEchoCast(castBox, view);
  }

  const gridOn = !over && !draft && !cast && view.phase !== 'gap' && view.phase !== 'wait' && (input || (memorise && !tvMode));
  const grid = document.getElementById('echo-grid');
  if (grid) {
    grid.hidden = !gridOn;
    if (gridOn) paintEchoGrid(grid, view, true, mine);
  }

  const lanes = document.getElementById('echo-lanes');
  const lanesOn = !tvMode && !draft && !over && !cast && !memorise && !(input && mine && (mine.canTap || mine.failed || mine.done));
  if (lanes) {
    lanes.hidden = !lanesOn;
    if (lanesOn) {
      paintEchoRail(document.getElementById('echo-lane-left'), view.left.seats);
      paintEchoRail(document.getElementById('echo-lane-right'), view.right.seats);
    }
  }

  const begin = document.getElementById('echo-begin');
  if (begin) {
    const showBegin = !!(draft && me && me.isHost);
    begin.hidden = !showBegin;
    if (showBegin) {
      begin.disabled = !view.hostSeated || !view.left.seats.length || !view.right.seats.length;
    }
  }

  paintEchoPodium(document.getElementById('echo-podium'), over ? view.podium : null);
  syncEchoClock('player', input ? view : null);
}

function paintEchoTv(view) {
  const grid = document.getElementById('tv-echo-grid');
  const count = document.getElementById('tv-echo-count');
  const note = document.getElementById('tv-echo-note');
  const bench = document.getElementById('tv-echo-bench');
  if (!view) return;
  const leftTitle = document.getElementById('tv-echo-left-title');
  const rightTitle = document.getElementById('tv-echo-right-title');
  const leftScore = document.getElementById('tv-echo-left-score');
  const rightScore = document.getElementById('tv-echo-right-score');
  if (leftTitle) leftTitle.textContent = view.left.title;
  if (rightTitle) rightTitle.textContent = view.right.title;
  if (leftScore) leftScore.textContent = squaresLabel(view.left.score);
  if (rightScore) rightScore.textContent = squaresLabel(view.right.score);
  paintEchoRail(document.getElementById('tv-echo-left'), view.left.seats);
  paintEchoRail(document.getElementById('tv-echo-right'), view.right.seats);

  const draft = view.phase === 'draft';
  const cast = view.phase === 'cast';
  const memorise = view.phase === 'count' || view.phase === 'show';
  const input = view.phase === 'input';
  const over = view.phase === 'over';
  const castBox = document.getElementById('tv-echo-cast');
  if (castBox) {
    castBox.hidden = !cast;
    if (cast) paintEchoCast(castBox, view);
  }
  if (count) {
    const showCount = view.phase === 'count' && view.count > 0;
    count.hidden = !showCount;
    if (showCount) count.textContent = String(view.count);
  }
  if (grid) {
    const gridOn = !cast && (memorise || input);
    grid.hidden = !gridOn;
    if (gridOn) paintEchoGrid(grid, view, false, null);
  }
  if (note) {
    let text = '';
    if (draft) text = 'Садитесь слева или справа';
    else if (view.phase === 'gap') text = view.note || '';
    else if (view.phase === 'wait') text = echoStatus(view, null, true);
    else if (input) text = echoNextLine(view);
    else if (memorise && view.note) text = view.note;
    note.hidden = !text;
    note.textContent = text;
  }
  if (bench) {
    const names = draft && view.bench && view.bench.length
      ? 'Без стороны: ' + view.bench.map((seat) => seat.nickname).join(', ')
      : '';
    bench.hidden = !names;
    bench.textContent = names;
  }
  paintEchoPodium(document.getElementById('tv-echo-podium'), over ? view.podium : null);
  syncEchoClock('tv', input ? view : null);
}

function paintEchoHost(view, room) {
  const box = document.getElementById('echo-host');
  if (!box) return;
  const on = !!(room && room.roundStatus === 'playing' && room.activeGame === 'echo' && view);
  box.hidden = !on;
  if (!on || !view) return;
  const note = document.getElementById('echo-host-note');
  const begin = document.getElementById('echo-host-begin');
  const skip = document.getElementById('echo-host-skip');
  const confirm = document.getElementById('echo-host-skip-confirm');
  const draft = view.phase === 'draft';
  const live = view.phase === 'cast' || view.phase === 'count' || view.phase === 'show' || view.phase === 'input' || view.phase === 'wait';
  if (begin) {
    begin.hidden = !draft;
    begin.disabled = !view.hostSeated || !view.left.seats.length || !view.right.seats.length;
  }
  if (note) {
    let text = '';
    if (draft && !view.hostSeated) text = 'Сначала выберите сторону на телефоне';
    else if (draft && (!view.left.seats.length || !view.right.seats.length)) text = 'Нужны обе стороны';
    else if (draft && view.bench.length) text = 'Без стороны: ' + view.bench.map((seat) => seat.nickname).join(', ');
    else if (draft) text = 'Обе стороны на месте';
    else if (view.phase === 'cast') text = echoPair(view) ? 'Сейчас ' + echoPair(view) : 'Сейчас играют';
    else if (view.phase === 'wait') text = echoStatus(view, null, true);
    else if (live) text = 'Пропуск закрывает дуэль на последней взятой длине';
    note.hidden = !text;
    note.textContent = text;
  }
  const turnKey = view.phase + ':' + (view.duel ? view.duel.index : 'd') + ':' + view.length;
  if (box.dataset.turn !== turnKey) {
    box.dataset.turn = turnKey;
    if (confirm) confirm.hidden = true;
    if (skip) skip.hidden = !live;
  }
  if (skip && (!confirm || confirm.hidden)) skip.hidden = !live;
}

function syncEchoClock(kind, view) {
  if (echoClocks[kind]) {
    clearInterval(echoClocks[kind]);
    echoClocks[kind] = null;
  }
  const clock = document.getElementById(kind === 'tv' ? 'tv-echo-clock' : 'echo-clock');
  const bar = document.getElementById(kind === 'tv' ? 'tv-echo-bar' : 'echo-bar');
  const fill = bar ? bar.querySelector('span') : null;
  const live = !!(view && view.leftMs != null && view.limit && view.phase === 'input');
  if (!clock || !live) {
    if (clock) {
      clock.hidden = true;
      clock.classList.remove('is-low');
    }
    if (bar) bar.hidden = true;
    return;
  }
  const draw = () => {
    const left = Math.max(0, view.leftMs - (Date.now() - (view.at || Date.now())));
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
  echoClocks[kind] = setInterval(draw, 200);
}

function applyEchoScores(roomState, view) {
  if (!roomState || !view || !view.roster || !roomState.players) return;
  view.roster.forEach((seat) => {
    const player = roomState.players.find((item) => item.id === seat.id);
    if (!player) return;
    player.score = seat.score;
    if (seat.cups) player.cups = seat.cups;
  });
}

function reactEcho(prev, next, me, buzz) {
  if (!next || typeof buzz !== 'function') return;
  if (next.phase === 'over' && (!prev || prev.phase !== 'over')) {
    buzz([60, 40, 60, 40, 120]);
    return;
  }
  if (!me || !next.duel) return;
  const playing = (view) => {
    if (!view || !view.duel || !view.duel.left || !view.duel.right) return false;
    return view.duel.left.id === me.id || view.duel.right.id === me.id;
  };
  const sameDuel = !!(prev && prev.duel && prev.duel.index === next.duel.index);
  if (playing(next) && !sameDuel && next.phase !== 'gap' && next.phase !== 'over') buzz([50, 30, 70]);
  const opened = next.phase === 'input' && playing(next)
    && (!prev || prev.phase !== 'input' || !playing(prev) || !prev.duel || prev.duel.index !== next.duel.index || prev.length !== next.length);
  if (opened) buzz([46, 30, 46]);
  const replay = playing(next) && next.phase === 'count' && next.note === 'Та же цепочка'
    && prev && prev.phase === 'input' && prev.length === next.length;
  if (replay) buzz([28, 40, 28]);
}
