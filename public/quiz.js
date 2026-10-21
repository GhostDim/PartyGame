const QUIZ_LETTERS = ['А', 'Б', 'В', 'Г'];
const quizClocks = { player: null, tv: null };

function quizSigned(delta) {
  if (!delta) return '';
  return (delta > 0 ? '+' : '−') + Math.abs(delta);
}

function quizPersonal(view, me) {
  if (!me || !view || !view.results) return '';
  if (view.phase !== 'reveal' && view.phase !== 'final_reveal' && view.phase !== 'mini_flash') return '';
  const row = view.results.find((item) => item.id === me.id);
  if (!row) return '';
  if (view.phase === 'mini_flash') return row.ok ? 'Верно ' + quizSigned(row.delta) : 'Мимо';
  if (!row.ok) {
    if (row.delta < 0) return 'Мимо, ' + quizSigned(row.delta);
    if (row.option == null) return 'Не успели';
    return 'Мимо';
  }
  if (view.phase === 'final_reveal') return row.delta > 0 ? 'Верно ' + quizSigned(row.delta) : 'Верно';
  if (row.place === 1) return 'Первый! ' + quizSigned(row.delta);
  if (row.place === 2) return 'Второй! ' + quizSigned(row.delta);
  return 'Верно ' + quizSigned(row.delta);
}

function quizReadyText(view) {
  if (!view || !view.roster) return '';
  const online = view.roster.filter((seat) => seat.online).length;
  if (!online) return '';
  const done = (view.ready || []).length;
  if (view.phase === 'ask' || view.phase === 'final') return 'Ответили ' + done + ' из ' + online;
  if (view.phase === 'mini') return 'Свайпнули ' + done + ' из ' + online;
  if (view.phase === 'bet') return 'Ставки ' + done + ' из ' + online;
  return '';
}

function quizStatus(view, tvMode) {
  if (!tvMode) return 'Игра идёт на телефонах';
  if (!view || view.phase === 'count') return 'Приготовьтесь';
  if (view.phase === 'ask' || view.phase === 'final') return 'Время отвечать';
  if (view.phase === 'reveal' || view.phase === 'final_reveal') return 'Разбор';
  if (view.phase === 'mini_intro' || view.phase === 'mini' || view.phase === 'mini_flash') return 'Свайп на телефонах';
  if (view.phase === 'bet') return 'Ставки';
  if (view.phase === 'over') return 'Итог';
  return 'Викторина';
}

function setQuizText(id, value) {
  const node = document.getElementById(id);
  if (!node || node.textContent === value) return;
  node.textContent = value;
}

function optionKey(view, mine) {
  const texts = (view.options || []).join('|');
  const mineOpt = mine && mine.option != null ? String(mine.option) : '';
  const resultKey = (view.results || []).map((row) => row.id + ':' + row.option + ':' + row.delta).join(',');
  return view.phase + '#' + texts + '#' + view.correct + '#' + mineOpt + '#' + resultKey;
}

function paintOptions(container, view, mine, tv) {
  if (!container) return;
  if (!view || !view.options) {
    container.hidden = true;
    container.dataset.key = '';
    return;
  }
  container.hidden = false;
  const key = optionKey(view, tv ? null : mine);
  if (container.dataset.key !== key) {
    container.dataset.key = key;
    clearNode(container);
    view.options.forEach((text, index) => {
      const button = make('button', 'quiz-opt is-' + index);
      button.type = 'button';
      button.dataset.option = String(index);
      button.append(
        make('span', 'quiz-letter', QUIZ_LETTERS[index] || ''),
        make('span', 'quiz-label', text),
        make('span', 'quiz-picks')
      );
      container.appendChild(button);
    });
  }
  const reveal = view.correct != null && (view.phase === 'reveal' || view.phase === 'final_reveal');
  const locked = !!(mine && mine.option != null);
  const open = view.phase === 'ask' || view.phase === 'final';
  Array.from(container.children).forEach((button, index) => {
    button.disabled = tv ? false : (!open || locked);
    button.classList.toggle('is-right', reveal && index === view.correct);
    button.classList.toggle('is-dim', reveal && index !== view.correct);
    button.classList.toggle('is-mine', !tv && locked && mine.option === index);
    const picks = button.querySelector('.quiz-picks');
    if (!picks) return;
    const people = reveal ? (view.results || []).filter((row) => row.option === index) : [];
    const pickKey = people.map((row) => row.id + ':' + row.delta).join(',');
    if (picks.dataset.key === pickKey) return;
    picks.dataset.key = pickKey;
    clearNode(picks);
    people.forEach((row) => {
      const seat = (view.roster || []).find((item) => item.id === row.id);
      if (!seat) return;
      const chip = make('span', null, seat.avatar);
      chip.title = seat.nickname + (row.delta ? ' ' + quizSigned(row.delta) : '');
      picks.appendChild(chip);
    });
  });
}

function paintPodium(container, podium) {
  if (!container) return;
  if (!podium || !podium.length) {
    container.hidden = true;
    container.dataset.key = '';
    return;
  }
  container.hidden = false;
  const key = podium.map((seat) => seat.id + ':' + seat.score + ':' + cupsKey(seat.cups)).join(',');
  if (container.dataset.key === key && container.childElementCount) return;
  container.dataset.key = key;
  clearNode(container);
  podium.forEach((seat, index) => {
    const card = make('div', 'bomb-winner' + (index === 0 ? ' is-first' : ''));
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

function paintRoster(container, view) {
  if (!container) return;
  const roster = (view && view.roster) || [];
  const hidden = !view || view.phase === 'over';
  container.hidden = hidden;
  if (hidden) return;
  const key = roster.map((seat) => seat.id + ':' + seat.score + ':' + (seat.online ? 1 : 0) + ':' + cupsKey(seat.cups)).join('|')
    + '#' + (view.ready || []).join(',')
    + '#' + (view.results || []).map((row) => row.id + ':' + row.delta).join(',');
  if (container.dataset.key === key && container.childElementCount) return;
  container.dataset.key = key;
  clearNode(container);
  const ready = new Set(view.ready || []);
  const gains = new Map((view.results || []).map((row) => [row.id, row.delta]));
  roster.forEach((seat) => {
    const item = make('div', 'quiz-seat' + (seat.online ? '' : ' is-off') + (ready.has(seat.id) ? ' is-done' : ''));
    const face = make('span', 'quiz-face');
    paintFace(face, seat.avatar, seat.cups);
    item.append(
      face,
      make('strong', null, seat.nickname),
      make('span', null, String(seat.score))
    );
    const delta = gains.get(seat.id) || 0;
    if (delta) item.append(make('span', 'quiz-delta' + (delta < 0 ? ' is-bad' : ''), quizSigned(delta)));
    container.appendChild(item);
  });
}

function paintBets(container, view) {
  if (!container) return;
  if (!view || !view.bets) {
    container.hidden = true;
    container.dataset.key = '';
    return;
  }
  container.hidden = false;
  const key = view.phase + '#' + view.bets.map((row) => row.id + ':' + row.amount + ':' + (row.locked ? 1 : 0)).join(',');
  if (container.dataset.key === key) return;
  container.dataset.key = key;
  clearNode(container);
  view.bets.forEach((row) => {
    const seat = (view.roster || []).find((item) => item.id === row.id);
    if (!seat) return;
    const showAmount = view.phase !== 'bet' || row.locked;
    const text = showAmount ? seat.nickname + ' · ' + row.amount : seat.nickname;
    container.appendChild(make('span', 'quiz-chip' + (row.locked || view.phase !== 'bet' ? '' : ' is-wait'), text));
  });
}

function paintSwipe(view, mine) {
  const box = document.getElementById('quiz-swipe');
  const card = document.getElementById('quiz-card');
  const up = document.getElementById('quiz-up');
  const down = document.getElementById('quiz-down');
  if (!box || !card || !up || !down) return;
  const phase = view && view.phase;
  const on = phase === 'mini' || phase === 'mini_flash';
  box.hidden = !on;
  if (!on) return;
  card.textContent = view.text || '';
  card.classList.toggle('is-up', phase === 'mini_flash' && view.cardYes === true);
  card.classList.toggle('is-down', phase === 'mini_flash' && view.cardYes === false);
  const locked = phase !== 'mini' || (mine && mine.up != null);
  up.textContent = '↑ ' + (view.up || '');
  down.textContent = '↓ ' + (view.down || '');
  up.disabled = locked;
  down.disabled = locked;
}

function paintBet(view, me, mine) {
  const box = document.getElementById('quiz-bet');
  if (!box) return;
  const on = !!(view && view.phase === 'bet');
  box.hidden = !on;
  if (!on) return;
  const seat = me && (view.roster || []).find((item) => item.id === me.id);
  const purse = seat ? seat.purse : 0;
  const have = document.getElementById('quiz-bet-have');
  if (have) {
    have.textContent = purse > 0
      ? 'Можно поставить ' + pointsLabel(purse)
      : 'В этой викторине пока нечего ставить';
  }
  const slider = document.getElementById('quiz-bet-range');
  const value = document.getElementById('quiz-bet-value');
  const lock = document.getElementById('quiz-bet-lock');
  const locked = !!(mine && mine.betLocked);
  if (slider) {
    slider.max = String(Math.max(0, purse));
    slider.disabled = locked || purse <= 0;
    const picked = mine && mine.bet != null ? mine.bet : 0;
    if (document.activeElement !== slider) slider.value = String(Math.max(0, Math.min(purse, picked)));
  }
  if (value && slider) value.textContent = pointsLabel(Number(slider.value) || 0);
  if (lock) {
    lock.disabled = locked || purse <= 0;
    lock.textContent = locked ? 'Ставка принята' : 'Поставить';
  }
  box.querySelectorAll('[data-bet]').forEach((button) => {
    button.disabled = locked || purse <= 0;
  });
}

function paintQuizFace(view, me, mine, ids) {
  const live = view && view.phase ? view : null;
  setQuizText(ids.kicker, live ? live.kicker : 'Приготовьтесь');
  const count = document.getElementById(ids.count);
  const counting = !!(live && live.phase === 'count');
  if (count) {
    count.hidden = !counting;
    if (counting) showCount(count, live.count);
    else {
      count.textContent = '';
      count.classList.remove('is-go');
    }
  }
  const text = document.getElementById(ids.text);
  const cardPhase = !!(live && (live.phase === 'mini' || live.phase === 'mini_flash'));
  if (text) {
    const hasText = !!(live && live.text) && !cardPhase;
    text.hidden = !hasText;
    if (text.textContent !== (hasText ? live.text : '')) text.textContent = hasText ? live.text : '';
  }
  return { live, cardPhase };
}

function paintQuizPlayer(view, me, mine) {
  const box = document.getElementById('play-quiz');
  if (!box) return;
  const face = paintQuizFace(view, me, mine, {
    kicker: 'quiz-kicker',
    count: 'quiz-count',
    text: 'quiz-text',
  });
  setQuizText('quiz-score', me ? String(me.score) : '');
  paintOptions(document.getElementById('quiz-options'), face.live || {}, mine, false);
  paintSwipe(face.live, mine);
  paintBet(face.live, me, mine);
  const note = document.getElementById('quiz-note');
  const personal = quizPersonal(face.live, me);
  if (note) {
    note.textContent = personal || (face.live && face.live.hint) || '';
    note.classList.toggle('is-hint', !personal);
    note.hidden = !note.textContent;
  }
  const ready = document.getElementById('quiz-ready');
  if (ready) {
    ready.textContent = quizReadyText(face.live);
    ready.hidden = !ready.textContent;
  }
  paintPodium(document.getElementById('quiz-podium'), face.live && face.live.phase === 'over' ? face.live.podium : null);
}

function paintQuizTv(view) {
  const face = paintQuizFace(view, null, null, {
    kicker: 'tv-quiz-kicker',
    count: 'tv-quiz-count',
    text: 'tv-quiz-text',
  });
  paintOptions(document.getElementById('tv-quiz-options'), face.live || {}, null, true);
  const card = document.getElementById('tv-quiz-card');
  if (card) {
    card.hidden = !face.cardPhase;
    card.textContent = face.cardPhase && face.live && face.live.text ? face.live.text : '';
    card.classList.toggle('is-up', !!(face.live && face.live.phase === 'mini_flash' && face.live.cardYes === true));
    card.classList.toggle('is-down', !!(face.live && face.live.phase === 'mini_flash' && face.live.cardYes === false));
  }
  const hint = document.getElementById('tv-quiz-hint');
  if (hint) {
    hint.textContent = face.live && face.live.hint ? face.live.hint : '';
    hint.hidden = !hint.textContent;
  }
  paintBets(document.getElementById('tv-quiz-bets'), face.live || {});
  paintRoster(document.getElementById('tv-quiz-roster'), face.live || { roster: [] });
  paintPodium(document.getElementById('tv-quiz-podium'), face.live && face.live.phase === 'over' ? face.live.podium : null);
}

function syncQuizClock(kind, view) {
  if (quizClocks[kind]) {
    clearInterval(quizClocks[kind]);
    quizClocks[kind] = null;
  }
  const clock = document.getElementById(kind === 'tv' ? 'tv-quiz-clock' : 'quiz-clock');
  const bar = document.getElementById(kind === 'tv' ? 'tv-quiz-bar' : 'quiz-bar');
  const fill = bar ? bar.querySelector('span') : null;
  if (!clock || !view || view.left == null || !view.limit) {
    if (clock) clock.hidden = true;
    if (bar) bar.hidden = true;
    return;
  }
  const draw = () => {
    const left = Math.max(0, view.left - (Date.now() - (view.at || Date.now())));
    clock.hidden = false;
    clock.textContent = String(Math.ceil(left / 1000));
    if (bar && fill) {
      bar.hidden = false;
      fill.style.width = Math.max(0, Math.min(100, (left / view.limit) * 100)) + '%';
    }
  };
  draw();
  quizClocks[kind] = setInterval(draw, 200);
}

function applyQuizScores(roomState, view) {
  if (!roomState || !view || !view.roster || !roomState.players) return;
  view.roster.forEach((seat) => {
    const player = roomState.players.find((item) => item.id === seat.id);
    if (player) {
      player.score = seat.score;
      if (seat.cups) player.cups = seat.cups;
    }
  });
}

function reactQuiz(prev, next, me, buzz) {
  if (!next || typeof buzz !== 'function') return;
  if (next.phase === 'count' && (!prev || prev.count !== next.count)) buzz(35);
  if (next.phase === 'mini' && (!prev || prev.text !== next.text || prev.kicker !== next.kicker)) buzz(25);
  if (prev && prev.phase === next.phase) return;
  if (next.phase === 'ask' || next.phase === 'final') buzz([30, 20, 40]);
  if (next.phase === 'mini_intro' || next.phase === 'bet') buzz([20, 30, 20]);
  if (next.phase === 'reveal' || next.phase === 'final_reveal' || next.phase === 'mini_flash') {
    const row = me && (next.results || []).find((item) => item.id === me.id);
    if (row && row.ok && row.delta > 0) buzz([40, 30, 40, 30, 90]);
    else if (row && row.ok) buzz([40, 30, 40]);
    else buzz([18, 36, 18]);
  }
  if (next.phase === 'over') buzz([60, 40, 60, 40, 120]);
}
