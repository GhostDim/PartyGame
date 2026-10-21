function votesLabel(count) {
  const n = Math.abs(count);
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return count + ' голос';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return count + ' голоса';
  return count + ' голосов';
}

function pointsLabel(count) {
  const n = Math.abs(count);
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return count + ' очко';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return count + ' очка';
  return count + ' очков';
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function cupsKey(cups) {
  return (cups || []).map((cup) => (cup.game || '') + ':' + cup.place).join(',');
}

function cupLabel(cup) {
  const metal = cup.place === 1 ? 'Золото' : cup.place === 2 ? 'Серебро' : 'Бронза';
  return metal + ', ' + (cup.title || cup.game || '');
}

function fillCups(container, cups) {
  if (!container) return;
  const list = Array.isArray(cups) ? cups : [];
  const key = cupsKey(list);
  if (container.dataset.key === key) return;
  container.dataset.key = key;
  clearNode(container);
  container.hidden = !list.length;
  list.forEach((cup) => {
    const badge = make('span', 'cup is-' + cup.place, cup.mark || '');
    const label = cupLabel(cup);
    badge.title = label;
    badge.setAttribute('aria-label', label);
    container.appendChild(badge);
  });
}

function paintFace(node, avatar, cups) {
  if (!node) return;
  let glyph = node.querySelector('.glyph');
  if (!glyph) {
    clearNode(node);
    glyph = make('span', 'glyph');
    node.appendChild(glyph);
  }
  const text = avatar || '';
  if (glyph.textContent !== text) glyph.textContent = text;
  let box = node.querySelector('.cups');
  if (!box) {
    box = make('span', 'cups');
    node.appendChild(box);
  }
  fillCups(box, cups);
}

function gameTitle(state, gameId) {
  if (!state || !gameId) return '';
  const game = state.games.find((item) => item.id === gameId);
  return game ? game.title : gameId;
}

function fillBars(container, games, pendingGame, selectedGame) {
  const max = games.reduce((top, game) => Math.max(top, game.votes), 0);
  clearNode(container);
  container.dataset.count = String(games.length);
  games.forEach((game) => {
    const leading = game.id === pendingGame && game.votes > 0;
    const host = game.id === selectedGame;
    const card = make('div', 'tv-bar' + (game.id === pendingGame ? ' is-picked' : ''));
    const title = make('h2', null, game.title);
    const about = make('p', 'tv-game-desc', game.description || '');
    about.hidden = !about.textContent;
    const votes = make('p', 'tv-game-votes', votesLabel(game.votes));
    const note = make('p', 'tv-game-note', host ? 'Выбор ведущего' : (leading ? 'Лидирует' : ''));
    note.hidden = !note.textContent;
    const bar = make('div', 'bar');
    const fill = make('span');
    fill.style.height = (max > 0 ? Math.round((game.votes / max) * 100) : 0) + '%';
    bar.appendChild(fill);
    card.append(title, about, votes, note, bar);
    container.appendChild(card);
  });
}
