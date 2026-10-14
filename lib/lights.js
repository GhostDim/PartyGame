const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const LED_COUNT = 16;
const STRIP_COUNT = 4;
const LEDS_PER_STRIP = 4;
const FRAME_MS = 50;
const WAVE_MS = 3600;
const BRIGHTNESS_MIN = 5;
const BRIGHTNESS_MAX = 100;
const DEFAULT_BRIGHTNESS = 5;

const LOBBY = { from: [255, 255, 255], to: [255, 200, 0] };
const PLAYING = { from: [255, 200, 0], to: [255, 0, 0] };
const BOMB_GREEN = [20, 160, 40];
const BOMB_YELLOW = [255, 170, 0];
const BOMB_RED = [255, 0, 0];
const BOMB_DIM = [36, 0, 0];
const PASS_MS = 480;
const BOOM_MS = 1600;
const FLASH_MS = 500;

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'lights.json');
const DRIVER = path.join(__dirname, '..', 'hardware', 'ws2812_spi.py');

function wrap(value) {
  return value - Math.floor(value);
}

function scale(rgb, gain) {
  return rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel * gain))));
}

function mix(from, to, t) {
  return from.map((channel, index) => Math.round(channel + (to[index] - channel) * t));
}

function bombRgb(tension, now) {
  const level = Math.max(0, Math.min(1, tension));
  if (level < 0.4) return mix(BOMB_GREEN, BOMB_YELLOW, level / 0.4);
  if (level < 0.7) return mix(BOMB_YELLOW, BOMB_RED, (level - 0.4) / 0.3);
  const hot = (level - 0.7) / 0.3;
  const half = Math.round(200 - hot * 120);
  const on = Math.floor(now / half) % 2 === 0;
  return on ? BOMB_RED : BOMB_DIM;
}

function alarmPixels(now, tension, gain) {
  const base = bombRgb(tension, now);
  const blinking = tension >= 0.7;
  const travel = (now % 800) / 800;
  const pixels = new Array(LED_COUNT);
  for (let i = 0; i < LED_COUNT; i += 1) {
    let level = 1;
    if (!blinking) {
      const along = i / (LED_COUNT - 1);
      const wave = wrap(along - travel);
      level = 0.45 + 0.55 * (0.5 - 0.5 * Math.cos(wave * Math.PI * 2));
    }
    pixels[i] = scale(base, gain * level);
  }
  return pixels;
}

function passPixels(now, effect, gain) {
  const head = ((now - effect.started) / effect.ms) * (LED_COUNT + 3);
  const pixels = new Array(LED_COUNT);
  for (let i = 0; i < LED_COUNT; i += 1) {
    const hot = Math.max(0, 1 - Math.abs(i - head) / 3);
    pixels[i] = scale([255, 230, 140], gain * (0.12 + 0.88 * hot));
  }
  return pixels;
}

function boomPixels(now, effect, gain) {
  const rgb = now - effect.started < FLASH_MS ? [255, 255, 255] : BOMB_RED;
  const pixels = new Array(LED_COUNT);
  for (let i = 0; i < LED_COUNT; i += 1) pixels[i] = scale(rgb, gain);
  return pixels;
}

function buildFrame(now, mode, brightness, enabled, extra) {
  const gain = enabled ? brightness / 100 : 0;
  if (gain > 0 && extra && extra.effect) {
    if (extra.effect.type === 'pass') return passPixels(now, extra.effect, gain);
    if (extra.effect.type === 'boom') return boomPixels(now, extra.effect, gain);
  }
  if (extra && extra.scene === 'bomb') return alarmPixels(now, extra.tension || 0, gain);
  const palette = mode === 'playing' ? PLAYING : LOBBY;
  const travel = (now % WAVE_MS) / WAVE_MS;
  const pixels = new Array(LED_COUNT);

  for (let strip = 0; strip < STRIP_COUNT; strip += 1) {
    for (let i = 0; i < LEDS_PER_STRIP; i += 1) {
      const along = i / (LEDS_PER_STRIP - 1);
      const wave = wrap(along * 0.72 + strip * 0.16 - travel);
      const blend = 0.5 - 0.5 * Math.cos(wave * Math.PI * 2);
      const index = strip * LEDS_PER_STRIP + i;
      pixels[index] = palette.from.map((from, channel) => {
        const to = palette.to[channel];
        return Math.round((from + (to - from) * blend) * gain);
      });
    }
  }

  return pixels;
}

class Lights {
  constructor() {
    this.enabled = true;
    this.brightness = DEFAULT_BRIGHTNESS;
    this.mode = 'lobby';
    this.scene = 'ambient';
    this.tension = 0;
    this.effect = null;
    this.ready = false;
    this.failed = false;
    this.stopping = false;
    this.proc = null;
    this.timer = null;
    this.frameMs = 0;
    this.saveTimer = null;
    this.listener = null;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      if (typeof raw.enabled === 'boolean') this.enabled = raw.enabled;
      const brightness = Math.round(Number(raw.brightness));
      if (brightness >= BRIGHTNESS_MIN && brightness <= BRIGHTNESS_MAX) {
        this.brightness = brightness;
      }
    } catch (err) {
      this.enabled = true;
      this.brightness = DEFAULT_BRIGHTNESS;
    }
  }

  snapshot() {
    let hardware = 'wait';
    if (this.ready) hardware = 'ok';
    else if (this.failed) hardware = 'off';
    return {
      enabled: this.enabled,
      brightness: this.brightness,
      hardware,
    };
  }

  onChange(listener) {
    this.listener = listener;
  }

  notify() {
    if (this.listener) this.listener(this.snapshot());
  }

  setMode(roundStatus) {
    this.mode = roundStatus === 'playing' ? 'playing' : 'lobby';
  }

  setBomb(tension) {
    const value = Number(tension);
    this.scene = 'bomb';
    this.tension = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    if (this.effect && this.effect.type === 'boom') this.effect = null;
    this.arm();
  }

  clearBomb() {
    this.scene = 'ambient';
    this.tension = 0;
    this.effect = null;
    this.arm();
  }

  playPass() {
    this.effect = { type: 'pass', started: Date.now(), ms: PASS_MS };
    this.arm();
    this.pushFrame();
  }

  playBoom() {
    this.scene = 'bomb';
    this.effect = { type: 'boom', started: Date.now(), ms: BOOM_MS };
    this.arm();
    this.pushFrame();
  }

  frameInterval() {
    if (!this.enabled) return 200;
    if (this.scene === 'bomb' || this.effect) return 40;
    return FRAME_MS;
  }

  apply(payload) {
    const data = payload && typeof payload === 'object' ? payload : {};
    let enabled = this.enabled;
    let brightness = this.brightness;

    if (Object.prototype.hasOwnProperty.call(data, 'enabled')) {
      if (typeof data.enabled !== 'boolean') {
        return { ok: false, error: 'Некорректное состояние подсветки' };
      }
      enabled = data.enabled;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'brightness')) {
      const value = Math.round(Number(data.brightness));
      if (!Number.isFinite(value) || value < BRIGHTNESS_MIN || value > BRIGHTNESS_MAX) {
        return { ok: false, error: 'Яркость от 5 до 100' };
      }
      brightness = value;
    }

    const turnedOn = !this.enabled && enabled;
    const turnedOff = this.enabled && !enabled;
    this.enabled = enabled;
    this.brightness = brightness;
    this.persistSoon();

    if (this.ready && (turnedOn || turnedOff || this.enabled)) {
      if (turnedOff) this.burst(4);
      this.arm();
    }

    this.notify();
    return { ok: true };
  }

  start() {
    if (this.proc || this.stopping) return;
    const proc = spawn('python3', ['-u', DRIVER], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    let note = '';

    proc.stdin.on('error', () => {});
    proc.stdout.on('error', () => {});
    proc.stderr.on('data', (chunk) => {
      note = (note + chunk.toString()).trim().slice(-300);
    });
    proc.stdout.on('data', (chunk) => {
      if (this.ready || this.proc !== proc || this.stopping) return;
      if (!chunk.toString().includes('ready')) return;
      this.ready = true;
      this.failed = false;
      this.arm();
      console.log('Подсветка: 16 светодиодов, GPIO 10 (SPI)');
      this.notify();
    });
    proc.on('error', (err) => {
      if (this.proc === proc) this.proc = null;
      if (this.stopping) return;
      const reason = err.code === 'ENOENT' ? 'не найден python3' : err.message;
      this.fail(reason);
    });
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null;
      this.ready = false;
      this.disarm();
      if (this.stopping) return;
      setImmediate(() => {
        if (this.stopping || this.failed) return;
        this.fail(note || 'драйвер ленты остановился');
      });
    });
  }

  stop() {
    this.stopping = true;
    this.disarm();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.save();
    }
    const proc = this.proc;
    this.proc = null;
    this.ready = false;
    if (!proc) return;
    const pixels = buildFrame(0, 'lobby', 0, false);
    const line = JSON.stringify({ pixels }) + '\n';
    try {
      if (proc.stdin.writable) {
        proc.stdin.write(line + line + line + line);
        proc.stdin.end();
      }
    } catch (err) {
      proc.kill();
    }
  }

  arm() {
    if (!this.ready) return;
    const ms = this.frameInterval();
    if (this.timer && this.frameMs === ms) return;
    this.disarm();
    this.frameMs = ms;
    this.timer = setInterval(() => this.pushFrame(), ms);
    this.timer.unref();
    this.pushFrame();
  }

  burst(count) {
    for (let i = 0; i < count; i += 1) this.pushFrame();
  }

  disarm() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  pushFrame() {
    const proc = this.proc;
    if (!proc || !proc.stdin.writable || this.stopping) return;
    const now = Date.now();
    if (this.effect && now - this.effect.started >= this.effect.ms) this.effect = null;
    const pixels = buildFrame(now, this.mode, this.brightness, this.enabled, {
      scene: this.scene,
      tension: this.tension,
      effect: this.effect,
    });
    try {
      proc.stdin.write(JSON.stringify({ pixels }) + '\n');
    } catch (err) {
      this.fail(err.message);
    }
  }

  fail(reason) {
    if (this.failed || this.stopping) return;
    this.failed = true;
    this.ready = false;
    this.disarm();
    console.log('Подсветка выключена: ' + reason);
    this.notify();
  }

  persistSoon() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 400);
    this.saveTimer.unref();
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
      const tmp = SETTINGS_PATH + '.tmp';
      const body = JSON.stringify({
        enabled: this.enabled,
        brightness: this.brightness,
      });
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, SETTINGS_PATH);
    } catch (err) {
      console.log('Не сохранилась яркость ленты: ' + err.message);
    }
  }
}

module.exports = {
  Lights,
  buildFrame,
  LED_COUNT,
  BRIGHTNESS_MIN,
  BRIGHTNESS_MAX,
};
