const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const { GameStateManager } = require('./lib/gameState');
const { sampleBoard } = require('./lib/boardStats');
const { Lights } = require('./lib/lights');
const { Audio } = require('./lib/audio');
const { HotBomb } = require('./games/hotbomb');
const { Quiz } = require('./games/quiz');

const PORT = 3000;
const ADMIN_PASSWORD = 'admin';
const LOGIN_LIMIT = 8;
const LOGIN_LOCK_MS = 15000;

const state = new GameStateManager();
const lights = new Lights();
const audio = new Audio();
let game = null;
const loginGuard = new Map();
let lastBoard = sampleBoard();

const app = express();
app.disable('x-powered-by');

const publicDir = path.join(__dirname, 'public');
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.get('/tv', (req, res) => {
  res.sendFile(path.join(publicDir, 'tv.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});
app.use(express.static(publicDir));

const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 20000,
});

function broadcast() {
  io.emit('room_state', state.snapshot());
}

function stopGame() {
  if (!game) return;
  const current = game;
  game = null;
  current.destroy();
}

function abortGame(message) {
  stopGame();
  state.cancelStart();
  lights.setMode('lobby');
  broadcast();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.isAdmin) socket.emit('admin_notice', { message });
  }
}

function sendGame(socket) {
  if (!game || !socket) return;
  if (game instanceof HotBomb) socket.emit('bomb_state', game.view());
  if (game instanceof Quiz) {
    socket.emit('quiz_state', game.view());
    if (socket.data.playerId) socket.emit('quiz_mine', game.mine(socket.data.playerId));
  }
}

function onlineCount() {
  let count = 0;
  for (const player of state.players.values()) {
    if (player.isOnline) count += 1;
  }
  return count;
}

function votesUpdated() {
  const snap = state.snapshot();
  io.emit('votes_updated', {
    votes: snap.votes,
    games: snap.games,
  });
}

function bindAdmin(socket, token) {
  socket.data.isAdmin = true;
  socket.data.adminToken = token;
  const host = state.hostPlayer();
  let player = null;
  if (host) {
    state.linkAdminPlayer(token, host.id);
    socket.data.playerId = host.id;
    player = state.attach(host.id, socket.id);
  }
  socket.emit('admin_ok', { token, playerId: player ? player.id : null });
  socket.emit('board_stats', lastBoard);
  socket.emit('lights_state', lights.snapshot());
  if (player) socket.emit('player_ready', { player });
  broadcast();
}

function pushBoard() {
  lastBoard = sampleBoard();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.isAdmin) socket.emit('board_stats', lastBoard);
  }
}

function emitLights() {
  const snap = lights.snapshot();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.isAdmin) socket.emit('lights_state', snap);
  }
}

function requireAdmin(socket) {
  if (socket.data.isAdmin) return true;
  socket.emit('admin_denied');
  return false;
}

function loginLocked(socketId) {
  const row = loginGuard.get(socketId);
  return !!(row && row.until > Date.now());
}

function noteLoginFailure(socketId) {
  const row = loginGuard.get(socketId) || { count: 0, until: 0 };
  row.count += 1;
  if (row.count >= LOGIN_LIMIT) {
    row.until = Date.now() + LOGIN_LOCK_MS;
    row.count = 0;
  }
  loginGuard.set(socketId, row);
}

io.on('connection', (socket) => {
  socket.emit('room_state', state.snapshot());
  sendGame(socket);

  socket.on('admin_login', (payload) => {
    const password = payload && payload.password;
    if (loginLocked(socket.id)) {
      socket.emit('admin_fail', { message: 'Слишком много попыток, подождите' });
      return;
    }
    if (password !== ADMIN_PASSWORD) {
      noteLoginFailure(socket.id);
      socket.emit('admin_fail', { message: 'Неверный пароль' });
      return;
    }
    loginGuard.delete(socket.id);
    const token = state.createAdminToken();
    bindAdmin(socket, token);
  });

  socket.on('admin_resume', (payload) => {
    const token = payload && payload.token;
    if (!state.isAdminToken(token)) {
      socket.emit('admin_fail', { message: 'Сессия истекла, войдите снова' });
      return;
    }
    bindAdmin(socket, token);
  });

  socket.on('set_tv_mode', (payload) => {
    if (!requireAdmin(socket)) return;
    const result = state.setTvMode(payload && payload.enabled);
    if (!result.ok) {
      socket.emit('admin_notice', { message: result.error });
      return;
    }
    broadcast();
  });

  socket.on('set_lights', (payload) => {
    if (!requireAdmin(socket)) return;
    const result = lights.apply(payload);
    if (!result.ok) {
      socket.emit('admin_notice', { message: result.error });
    }
  });

  socket.on('select_game', (payload) => {
    if (!requireAdmin(socket)) return;
    const result = state.selectGame(payload && payload.gameId);
    if (!result.ok) {
      socket.emit('admin_notice', { message: result.error });
      return;
    }
    broadcast();
  });

  socket.on('start_game', () => {
    if (!requireAdmin(socket)) return;
    const gameId = state.resolveGameId();
    if (gameId === 'hotbomb' && onlineCount() < 3) {
      socket.emit('admin_notice', { message: 'Для «Горячей бомбы» нужны минимум 3 игрока в сети' });
      return;
    }
    if (gameId === 'quiz' && onlineCount() < 1) {
      socket.emit('admin_notice', { message: 'Для викторины нужен игрок в сети' });
      return;
    }
    const result = state.start();
    if (!result.ok) {
      socket.emit('admin_notice', { message: result.error });
      return;
    }
    if (result.game.id === 'hotbomb') {
      game = new HotBomb(io, state, lights, {
        onScores: broadcast,
        onAbort: abortGame,
      });
      if (!game.init()) {
        abortGame('Для «Горячей бомбы» нужны минимум 3 игрока в сети');
        return;
      }
    } else if (result.game.id === 'quiz') {
      game = new Quiz(io, state, {
        onScores: broadcast,
        onAbort: abortGame,
      });
      if (!game.init()) {
        abortGame('Не удалось начать викторину');
        return;
      }
    }
    lights.setMode('playing');
    io.emit('game_start', {
      gameId: result.game.id,
      title: result.game.title,
    });
    broadcast();
  });

  socket.on('return_to_lobby', () => {
    if (!requireAdmin(socket)) return;
    stopGame();
    const result = state.returnToLobby();
    if (!result.ok) {
      socket.emit('admin_notice', { message: result.error });
      return;
    }
    lights.setMode('lobby');
    broadcast();
  });

  socket.on('tv_hello', () => {
    socket.data.role = 'tv';
    socket.emit('room_state', state.snapshot());
    sendGame(socket);
  });

  socket.on('player_register', (payload) => {
    const data = payload || {};
    if (socket.data.isAdmin) {
      const host = state.hostPlayer();
      if (host) {
        const updated = state.updateProfile(host.id, data);
        if (!updated.ok) {
          socket.emit('player_rejected', { message: updated.error });
          return;
        }
        if (socket.data.adminToken) state.linkAdminPlayer(socket.data.adminToken, host.id);
        socket.data.playerId = host.id;
        const player = state.attach(host.id, socket.id);
        socket.emit('player_ready', { player });
        if (game) game.onPlayerJoin(player.id);
        broadcast();
        return;
      }
    }
    if (socket.data.playerId && state.players.has(socket.data.playerId)) {
      const current = state.attach(socket.data.playerId, socket.id);
      socket.emit('player_ready', { player: current });
      if (game) game.onPlayerJoin(current.id);
      broadcast();
      return;
    }
    const result = state.register(data);
    if (!result.ok) {
      socket.emit('player_rejected', { message: result.error });
      return;
    }
    socket.data.playerId = result.player.id;
    if (socket.data.isAdmin && socket.data.adminToken) {
      state.linkAdminPlayer(socket.data.adminToken, result.player.id);
    }
    const player = state.attach(result.player.id, socket.id);
    socket.emit('player_ready', { player });
    if (game) game.onPlayerJoin(player.id);
    broadcast();
  });

  socket.on('player_resume', (payload) => {
    const playerId = payload && payload.playerId;
    const player = state.attach(playerId, socket.id);
    if (!player) {
      socket.emit('player_unknown');
      return;
    }
    socket.data.playerId = player.id;
    socket.emit('player_ready', { player });
    if (game) game.onPlayerJoin(player.id);
    broadcast();
  });

  socket.on('player_update', (payload) => {
    const result = state.updateProfile(socket.data.playerId, payload || {});
    if (!result.ok) {
      socket.emit('player_rejected', { message: result.error });
      return;
    }
    socket.emit('player_ready', { player: result.player });
    if (game) game.onPlayerJoin(result.player.id);
    broadcast();
  });

  socket.on('player_leave', () => {
    const playerId = socket.data.playerId;
    if (!playerId) return;
    if (game) game.onPlayerLeave(playerId);
    state.remove(playerId);
    socket.data.playerId = null;
    socket.emit('player_left');
    votesUpdated();
    broadcast();
  });

  socket.on('admin_kick', (payload) => {
    if (!requireAdmin(socket)) return;
    const playerId = payload && payload.playerId;
    if (!playerId) return;
    if (playerId === socket.data.playerId) {
      socket.emit('admin_notice', { message: 'Себя уберите через «Выйти» в настройках' });
      return;
    }
    const target = state.players.get(playerId);
    if (!target) {
      socket.emit('admin_notice', { message: 'Игрок не найден' });
      return;
    }
    if (target.isHost) {
      socket.emit('admin_notice', { message: 'Ведущего нельзя удалить' });
      return;
    }
    if (game) game.onPlayerLeave(playerId);
    const result = state.kick(playerId);
    if (!result.ok) {
      socket.emit('admin_notice', { message: result.error });
      return;
    }
    if (result.socketId) {
      const target = io.sockets.sockets.get(result.socketId);
      if (target) {
        target.data.playerId = null;
        target.emit('player_kicked');
      }
    }
    votesUpdated();
    broadcast();
  });

  socket.on('player_vote', (payload) => {
    const result = state.vote(socket.data.playerId, payload && payload.gameId);
    if (!result.ok) {
      socket.emit('player_rejected', { message: result.error });
      return;
    }
    votesUpdated();
    broadcast();
  });

  socket.on('player_action', (payload) => {
    if (!game || !socket.data.playerId) return;
    game.onAction(socket.data.playerId, payload || {});
  });

  socket.on('disconnect', () => {
    loginGuard.delete(socket.id);
    const player = state.detachBySocket(socket.id);
    if (!player) return;
    if (game) game.onPlayerJoin(player.id);
    broadcast();
  });
});

setInterval(pushBoard, 3000).unref();

let closing = false;

function shutdown() {
  if (closing) return;
  closing = true;
  stopGame();
  audio.stop();
  lights.stop();
  setTimeout(() => process.exit(0), 300).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

lights.onChange(emitLights);
lights.start();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`PartyBox слушает порт ${PORT}`);
  console.log('Игрок:  http://localhost:3000/');
  console.log('ТВ:     http://localhost:3000/tv');
  console.log('Админ:  http://localhost:3000/admin');
  audio.start();
});
