const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SOUNDS_DIR = path.join(__dirname, '..', 'sounds');
const DEVICE = 'plughw:CARD=MAX98357A,DEV=0';
const CUE_NAME = /^[a-z0-9_-]+$/;

class Audio {
  constructor() {
    this.proc = null;
    this.disabled = false;
  }

  start() {
    this.play('startup');
  }

  play(name) {
    if (this.disabled) return;
    if (typeof name !== 'string' || !CUE_NAME.test(name)) {
      console.log('Неизвестный звук: ' + name);
      return;
    }
    const fileName = name + '.wav';
    const file = path.join(SOUNDS_DIR, fileName);
    if (!fs.existsSync(file)) {
      console.log('Нет файла звука: sounds/' + fileName);
      return;
    }

    this.stopPlayback();
    console.log('Звук: ' + name);
    const proc = spawn('aplay', ['-q', '-D', DEVICE, file], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    this.proc = proc;
    let note = '';

    proc.stderr.on('data', (chunk) => {
      note = (note + chunk.toString()).trim().slice(-240);
    });
    proc.stderr.on('error', () => {});
    proc.on('error', (err) => {
      if (this.proc === proc) this.proc = null;
      const reason = err.code === 'ENOENT' ? 'не найден aplay' : err.message;
      this.disable(reason);
    });
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (code) this.disable(note || 'нет карты MAX98357A');
    });
  }

  stop() {
    this.stopPlayback();
  }

  stopPlayback() {
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;
    try {
      proc.kill('SIGTERM');
    } catch {
      return;
    }
  }

  disable(reason) {
    if (this.disabled) return;
    this.disabled = true;
    this.stopPlayback();
    console.log('Звук выключен: ' + reason);
  }
}

module.exports = { Audio };
