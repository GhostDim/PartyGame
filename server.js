const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const { GameStateManager } = require('./lib/gameState');

const PORT = 3000;
const ADMIN_PASSWORD = 'admin';
const LOGIN_LIMIT = 8;
const LOGIN_LOCK_MS = 15000;

const state = new GameStateManager();
const loginGuard = new Map();

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

function votesUpdated() {
  const snap = state.snapshot();
  io.emit('votes_updated', {
    votes: snap.votes,
    games: snap.games,
  });
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
    socket.data.isAdmin = true;
    const token = state.createAdminToken();
    socket.emit('admin_ok', { token });
    socket.emit('room_state', state.snapshot());
  });

  socket.on('admin_resume', (payload) => {
    const token = payload && payload.token;
    if (!state.isAdminToken(token)) {
      socket.emit('admin_fail', { message: 'Сессия истекла, войдите снова' });
      return;
    }
    socket.data.isAdmin = true;
    socket.emit('admin_ok', { token });
    socket.emit('room_state', state.snapshot());
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
    const result = state.start();
    if (!result.ok) {
      socket.emit('admin_notice', { message: result.error });
      return;
    }
    io.emit('game_start', {
      gameId: result.game.id,
      title: result.game.title,
    });
    broadcast();
  });

  socket.on('tv_hello', () => {
    socket.data.role = 'tv';
    socket.emit('room_state', state.snapshot());
  });

  socket.on('player_register', (payload) => {
    if (socket.data.playerId && state.players.has(socket.data.playerId)) {
      const current = state.attach(socket.data.playerId, socket.id);
      socket.emit('player_ready', { player: current });
      broadcast();
      return;
    }
    const result = state.register(payload || {});
    if (!result.ok) {
      socket.emit('player_rejected', { message: result.error });
      return;
    }
    socket.data.playerId = result.player.id;
    const player = state.attach(result.player.id, socket.id);
    socket.emit('player_ready', { player });
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
    broadcast();
  });

  socket.on('player_update', (payload) => {
    const result = state.updateProfile(socket.data.playerId, payload || {});
    if (!result.ok) {
      socket.emit('player_rejected', { message: result.error });
      return;
    }
    socket.emit('player_ready', { player: result.player });
    broadcast();
  });

  socket.on('player_leave', () => {
    const playerId = socket.data.playerId;
    if (!playerId) return;
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
    const result = state.remove(playerId);
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

  socket.on('disconnect', () => {
    loginGuard.delete(socket.id);
    const player = state.detachBySocket(socket.id);
    if (player) broadcast();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`PartyBox слушает порт ${PORT}`);
  console.log('Игрок:  http://localhost:3000/');
  console.log('ТВ:     http://localhost:3000/tv');
  console.log('Админ:  http://localhost:3000/admin');
});
