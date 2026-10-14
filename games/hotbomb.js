const STEPS = [
  { count: '3', ms: 1000 },
  { count: '2', ms: 1000 },
  { count: '1', ms: 1000 },
  { count: 'GO', ms: 800 },
];
const POINTS = 10;
const FUSE_MIN = 12000;
const FUSE_SPAN = 13001;
const BOOM_MS = 1200;
const PASS_GAP = 220;

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = list[i];
    list[i] = list[j];
    list[j] = swap;
  }
  return list;
}

class HotBomb {
  constructor(io, state, lights, hooks) {
    this.io = io;
    this.state = state;
    this.lights = lights;
    this.hooks = hooks || {};
    this.dead = false;
    this.phase = 'countdown';
    this.order = [];
    this.alive = new Set();
    this.holderId = null;
    this.boomId = null;
    this.winners = null;
    this.count = null;
    this.step = 0;
    this.fuseMs = 0;
    this.fuseFrom = 0;
    this.fuseAt = 0;
    this.heldFrom = 0;
    this.paidSteps = 0;
    this.lastPass = 0;
    this.stepTimer = null;
    this.boomTimer = null;
    this.loop = null;
  }

  init() {
    const ids = [];
    for (const player of this.state.players.values()) {
      if (player.isOnline) ids.push(player.id);
    }
    if (ids.length < 3) return false;
    shuffle(ids);
    this.order = ids;
    this.alive = new Set(ids);
    this.holderId = ids[0];
    this.phase = 'countdown';
    this.lights.setBomb(0);
    this.step = 0;
    this.pushStep();
    return true;
  }

  onPlayerJoin(playerId) {
    if (this.dead || !playerId || !this.order.includes(playerId)) return;
    this.emit(false);
  }

  onPlayerLeave(playerId) {
    if (this.dead || !this.order.includes(playerId)) return;
    if (this.phase === 'over') {
      this.order = this.order.filter((id) => id !== playerId);
      this.alive.delete(playerId);
      this.winners = (this.winners || []).filter((id) => id !== playerId);
      this.emit(false);
      return;
    }

    const wasHolder = this.holderId === playerId;
    this.order = this.order.filter((id) => id !== playerId);
    this.alive.delete(playerId);

    if (this.phase === 'countdown' && this.alive.size < 3) {
      if (this.hooks.onAbort) this.hooks.onAbort('Игрок вышел до старта. Нужны минимум 3');
      return;
    }
    if (this.alive.size <= 2) {
      this.finish([...this.alive]);
      return;
    }
    if (wasHolder && this.phase === 'live') {
      this.holderId = this.nextAfter(playerId);
      this.heldFrom = Date.now();
      this.paidSteps = 0;
      this.lights.playPass();
    }
    this.emit(false);
  }

  onAction(playerId, data) {
    if (!data || data.type !== 'pass') return;
    this.pass(playerId);
  }

  refresh() {
    this.emit(false);
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.clearTimers();
    this.lights.clearBomb();
    this.io.emit('bomb_state', null);
  }

  pushStep() {
    if (this.dead || this.phase !== 'countdown') return;
    const step = STEPS[this.step];
    this.count = step.count;
    this.emit(false);
    this.stepTimer = setTimeout(() => {
      if (this.dead || this.phase !== 'countdown') return;
      this.step += 1;
      if (this.step < STEPS.length) this.pushStep();
      else this.beginLive();
    }, step.ms);
    this.stepTimer.unref();
  }

  beginLive() {
    if (this.dead) return;
    if (this.alive.size < 3) {
      if (this.hooks.onAbort) this.hooks.onAbort('Для «Горячей бомбы» нужны минимум 3 игрока в сети');
      return;
    }
    this.phase = 'live';
    this.count = null;
    this.holderId = this.nextAfter(null);
    this.armRound();
    this.emit(false);
  }

  armRound() {
    this.fuseMs = FUSE_MIN + Math.floor(Math.random() * FUSE_SPAN);
    this.fuseFrom = Date.now();
    this.fuseAt = this.fuseFrom + this.fuseMs;
    this.heldFrom = this.fuseFrom;
    this.paidSteps = 0;
    console.log('Горячая бомба: запал ' + (this.fuseMs / 1000).toFixed(1) + ' с');
    this.clearLoop();
    this.loop = setInterval(() => this.tick(), 100);
    this.loop.unref();
    this.lights.setBomb(0);
  }

  payHold() {
    if (this.phase !== 'live' || !this.holderId || !this.alive.has(this.holderId)) return false;
    const end = Math.min(Date.now(), this.fuseAt);
    const steps = Math.floor((end - this.heldFrom) / 1000);
    if (steps <= this.paidSteps) return false;
    const gain = (steps - this.paidSteps) * POINTS;
    this.paidSteps = steps;
    return this.state.addScore(this.holderId, gain) != null;
  }

  tick() {
    if (this.dead || this.phase !== 'live') return;
    const now = Date.now();
    const scored = this.payHold();
    if (now >= this.fuseAt) {
      if (scored) this.emit(true);
      this.explode();
      return;
    }
    this.lights.setBomb((now - this.fuseFrom) / this.fuseMs);
    if (scored) this.emit(true);
  }

  pass(playerId) {
    if (this.dead || this.phase !== 'live') return;
    if (playerId !== this.holderId) return;
    const now = Date.now();
    if (now - this.lastPass < PASS_GAP) return;
    const next = this.nextAfter(this.holderId);
    if (!next || next === this.holderId) return;
    const scored = this.payHold();
    this.lastPass = now;
    this.holderId = next;
    this.heldFrom = now;
    this.paidSteps = 0;
    this.lights.playPass();
    this.emit(scored);
  }

  explode() {
    if (this.dead || this.phase !== 'live') return;
    const victim = this.holderId;
    this.phase = 'boom';
    this.boomId = victim;
    if (victim) this.alive.delete(victim);
    this.clearLoop();
    this.lights.playBoom();
    this.emit(false);
    this.boomTimer = setTimeout(() => {
      if (this.dead || this.phase !== 'boom') return;
      const left = this.order.filter((id) => this.alive.has(id));
      if (left.length <= 2) {
        this.finish(left);
        return;
      }
      this.boomId = null;
      this.holderId = this.nextAfter(victim);
      this.phase = 'live';
      this.armRound();
      this.emit(false);
    }, BOOM_MS);
    this.boomTimer.unref();
  }

  finish(ids) {
    if (this.dead || this.phase === 'over') return;
    this.clearTimers();
    this.phase = 'over';
    this.count = null;
    this.boomId = null;
    this.holderId = null;
    this.winners = ids.slice().sort((a, b) => {
      const pa = this.state.players.get(a);
      const pb = this.state.players.get(b);
      const sa = pa ? pa.score : 0;
      const sb = pb ? pb.score : 0;
      if (sb !== sa) return sb - sa;
      const na = pa ? pa.nickname : '';
      const nb = pb ? pb.nickname : '';
      return na.localeCompare(nb, 'ru');
    });
    this.lights.clearBomb();
    this.emit(false);
  }

  nextAfter(fromId) {
    const size = this.order.length;
    if (!size) return null;
    let start = fromId ? this.order.indexOf(fromId) : -1;
    if (start < 0) start = -1;
    for (let step = 1; step <= size; step += 1) {
      const id = this.order[(start + step) % size];
      if (this.alive.has(id)) return id;
    }
    return null;
  }

  emit(withScores) {
    if (this.dead) return;
    this.io.emit('bomb_state', this.view());
    if (withScores && this.hooks.onScores) this.hooks.onScores();
  }

  view() {
    const chain = [];
    for (const id of this.order) {
      const player = this.state.players.get(id);
      if (!player) continue;
      chain.push({
        id: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
        alive: this.alive.has(id),
        score: player.score,
        online: player.isOnline,
      });
    }
    return {
      phase: this.phase,
      count: this.phase === 'countdown' ? this.count : null,
      holderId: this.phase === 'over' ? null : this.holderId,
      boomId: this.phase === 'boom' ? this.boomId : null,
      winners: this.phase === 'over' ? this.winners.slice() : null,
      perSec: POINTS,
      chain,
    };
  }

  clearLoop() {
    if (!this.loop) return;
    clearInterval(this.loop);
    this.loop = null;
  }

  clearTimers() {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    if (this.boomTimer) clearTimeout(this.boomTimer);
    this.stepTimer = null;
    this.boomTimer = null;
    this.clearLoop();
  }
}

module.exports = { HotBomb };
