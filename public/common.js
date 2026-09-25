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

function gameTitle(state, gameId) {
  if (!state || !gameId) return '';
  const game = state.games.find((item) => item.id === gameId);
  return game ? game.title : gameId;
}

function fillBars(container, games, pendingGame, selectedGame) {
  const max = games.reduce((top, game) => Math.max(top, game.votes), 0);
  clearNode(container);
  games.forEach((game) => {
    const card = make('div', 'tv-bar' + (game.id === pendingGame ? ' is-picked' : ''));
    const title = make('h2', null, game.title);
    if (game.id === selectedGame) title.textContent += ' · выбор ведущего';
    const bar = make('div', 'bar');
    const fill = make('span');
    fill.style.width = (max > 0 ? Math.round((game.votes / max) * 100) : 0) + '%';
    bar.appendChild(fill);
    card.append(title, bar, make('p', 'muted', votesLabel(game.votes)));
    container.appendChild(card);
  });
}
