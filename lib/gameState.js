const crypto = require('crypto');

const MAX_PLAYERS = 16;

const GAMES = [
  {
    id: 'quiz',
    title: 'ТВ-Викторина',
    description: 'Вопрос на общем экране, четыре ответа на телефоне',
  },
  {
    id: 'auction',
    title: 'Аукцион пальцев',
    description: 'Держи палец и отпусти последним до взрыва',
  },
];

const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐧', '🐯'];

function cleanNickname(value) {
  if (typeof value !== 'string') return null;
  const nickname = value.trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,15}$/u.test(nickname)) return null;
  if (nickname.length < 2) return null;
  return nickname;
}

class GameStateManager {
  constructor() {
    this.players = new Map();
    this.tvMode = true;
    this.selectedGame = null;
    this.roundStatus = 'lobby';
    this.activeGame = null;
    this.adminTokens = new Set();
  }

  createAdminToken() {
    const token = crypto.randomBytes(24).toString('hex');
    this.adminTokens.add(token);
    return token;
  }

  isAdminToken(token) {
    return typeof token === 'string' && this.adminTokens.has(token);
  }

  toPublic(player) {
    return {
      id: player.id,
      nickname: player.nickname,
      avatar: player.avatar,
      score: player.score,
      isOnline: player.isOnline,
      votedGame: player.votedGame,
    };
  }

  voteCounts() {
    const votes = {};
    for (const game of GAMES) votes[game.id] = 0;
    for (const player of this.players.values()) {
      if (player.votedGame && Object.prototype.hasOwnProperty.call(votes, player.votedGame)) {
        votes[player.votedGame] += 1;
      }
    }
    return votes;
  }

  gamesPublic() {
    const votes = this.voteCounts();
    return GAMES.map((game) => ({
      id: game.id,
      title: game.title,
      description: game.description,
      votes: votes[game.id],
    }));
  }

  resolveGameId() {
    if (this.selectedGame && GAMES.some((game) => game.id === this.selectedGame)) {
      return this.selectedGame;
    }
    const votes = this.voteCounts();
    let best = null;
    let bestCount = 0;
    for (const game of GAMES) {
      if (votes[game.id] > bestCount) {
        best = game.id;
        bestCount = votes[game.id];
      }
    }
    return best;
  }

  snapshot() {
    const players = [...this.players.values()]
      .map((player) => this.toPublic(player))
      .sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return a.nickname.localeCompare(b.nickname, 'ru');
      });

    return {
      players,
      games: this.gamesPublic(),
      votes: this.voteCounts(),
      avatars: AVATARS,
      tvMode: this.tvMode,
      selectedGame: this.selectedGame,
      roundStatus: this.roundStatus,
      activeGame: this.activeGame,
      pendingGame: this.roundStatus === 'playing' ? this.activeGame : this.resolveGameId(),
    };
  }

  register({ nickname, avatar }) {
    const cleanName = cleanNickname(nickname);
    if (!cleanName) {
      return { ok: false, error: 'Имя: 2–16 букв или цифр' };
    }
    if (!AVATARS.includes(avatar)) {
      return { ok: false, error: 'Выберите аватар' };
    }
    if (this.players.size >= MAX_PLAYERS) {
      return { ok: false, error: 'Лобби заполнено' };
    }

    const player = {
      id: crypto.randomBytes(8).toString('hex'),
      nickname: cleanName,
      avatar,
      score: 0,
      isOnline: false,
      votedGame: null,
      socketId: null,
    };
    this.players.set(player.id, player);
    return { ok: true, player: this.toPublic(player) };
  }

  attach(playerId, socketId) {
    const player = this.players.get(playerId);
    if (!player) return null;
    player.socketId = socketId;
    player.isOnline = true;
    return this.toPublic(player);
  }

  detachBySocket(socketId) {
    for (const player of this.players.values()) {
      if (player.socketId === socketId) {
        player.socketId = null;
        player.isOnline = false;
        return this.toPublic(player);
      }
    }
    return null;
  }

  updateProfile(playerId, { nickname, avatar }) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, error: 'Сначала войдите в лобби' };
    const cleanName = cleanNickname(nickname);
    if (!cleanName) return { ok: false, error: 'Имя: 2–16 букв или цифр' };
    if (!AVATARS.includes(avatar)) return { ok: false, error: 'Выберите аватар' };
    player.nickname = cleanName;
    player.avatar = avatar;
    return { ok: true, player: this.toPublic(player) };
  }

  remove(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, error: 'Игрок не найден' };
    this.players.delete(playerId);
    return { ok: true, player: this.toPublic(player), socketId: player.socketId };
  }

  vote(playerId, gameId) {
    const player = this.players.get(playerId);
    if (!player || player.socketId == null) {
      return { ok: false, error: 'Сначала войдите в лобби' };
    }
    if (this.roundStatus !== 'lobby') {
      return { ok: false, error: 'Голосование закрыто' };
    }
    if (!GAMES.some((game) => game.id === gameId)) {
      return { ok: false, error: 'Неизвестная игра' };
    }
    player.votedGame = gameId;
    return { ok: true };
  }

  setTvMode(enabled) {
    if (typeof enabled !== 'boolean') {
      return { ok: false, error: 'Некорректный режим' };
    }
    this.tvMode = enabled;
    return { ok: true };
  }

  selectGame(gameId) {
    if (gameId == null || gameId === '') {
      this.selectedGame = null;
      return { ok: true };
    }
    if (!GAMES.some((game) => game.id === gameId)) {
      return { ok: false, error: 'Неизвестная игра' };
    }
    this.selectedGame = gameId;
    return { ok: true };
  }

  start() {
    if (this.roundStatus === 'playing') {
      return { ok: false, error: 'Игра уже запущена' };
    }
    const gameId = this.resolveGameId();
    if (!gameId) {
      return { ok: false, error: 'Никто не проголосовал и игра не выбрана' };
    }
    const game = GAMES.find((item) => item.id === gameId);
    this.roundStatus = 'playing';
    this.activeGame = gameId;
    return { ok: true, game: { id: game.id, title: game.title } };
  }
}

module.exports = {
  GameStateManager,
  GAMES,
  AVATARS,
};
