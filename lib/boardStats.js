const fs = require('fs');
const os = require('os');

const TEMP_PATH = '/sys/class/thermal/thermal_zone0/temp';

let lastCpu = null;

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function readTemp() {
  try {
    const raw = Number(fs.readFileSync(TEMP_PATH, 'utf8'));
    if (!Number.isFinite(raw)) return null;
    return Math.round(raw / 1000);
  } catch (err) {
    return null;
  }
}

function cpuSnapshot() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const times = cpu.times;
    idle += times.idle;
    for (const key of Object.keys(times)) total += times[key];
  }
  return { idle, total };
}

function readCpu() {
  const now = cpuSnapshot();
  const prev = lastCpu;
  lastCpu = now;
  if (!prev) return null;
  const idle = now.idle - prev.idle;
  const total = now.total - prev.total;
  if (total <= 0) return null;
  return percent((1 - idle / total) * 100);
}

function readMem() {
  const total = os.totalmem();
  if (!total) return null;
  return percent(((total - os.freemem()) / total) * 100);
}

function sampleBoard() {
  return {
    tempC: readTemp(),
    cpu: readCpu(),
    mem: readMem(),
  };
}

module.exports = { sampleBoard };
