// Small synthesized sound effects (Web Audio, no files). Browsers only allow audio after a user gesture,
// so the context is created on the first tap/click. sound.set({ on, vol }) comes from the settings.
let ctx = null, master = null, on = true, vol = 0.5;
const unlock = () => {
  if (ctx || typeof window === 'undefined') return;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  try { ctx = new AC(); master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination); } catch (e) { ctx = null; }
};
if (typeof window !== 'undefined') { window.addEventListener('pointerdown', unlock, { capture: true }); window.addEventListener('keydown', unlock, { capture: true }); }

function tone(freq, t0, dur, { type = 'sine', gain = 0.3, slide = 0, attack = 0.005 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(t0, dur, { gain = 0.25, lp = 1200 } = {}) {
  const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'lowpass'; f.frequency.value = lp; g.gain.value = gain;
  s.buffer = buf; s.connect(f); f.connect(g); g.connect(master); s.start(t0);
}

const FX = {
  buy: (t) => { tone(660, t, 0.09, { type: 'triangle', gain: 0.25 }); tone(990, t + 0.07, 0.12, { type: 'triangle', gain: 0.22 }); },
  sell: (t) => { tone(880, t, 0.09, { type: 'triangle', gain: 0.25 }); tone(587, t + 0.07, 0.14, { type: 'triangle', gain: 0.22 }); },
  fill: (t) => { tone(1318, t, 0.08, { gain: 0.18 }); tone(1760, t + 0.06, 0.16, { gain: 0.16 }); },
  news: (t) => { tone(523, t, 0.12, { type: 'square', gain: 0.08 }); tone(784, t + 0.12, 0.2, { type: 'square', gain: 0.08 }); },
  major: (t) => { for (let i = 0; i < 3; i++) tone(988, t + i * 0.16, 0.12, { type: 'square', gain: 0.09 }); tone(659, t + 0.5, 0.35, { type: 'square', gain: 0.08 }); },
  alert: (t) => { tone(740, t, 0.1, { type: 'sawtooth', gain: 0.07 }); tone(1109, t + 0.1, 0.18, { type: 'sawtooth', gain: 0.07 }); },
  bell: (t) => { tone(1046, t, 1.2, { gain: 0.2, attack: 0.002 }); tone(2093, t, 0.6, { gain: 0.06, attack: 0.002 }); },
  warn: (t) => { tone(220, t, 0.25, { type: 'sawtooth', gain: 0.09, slide: 0.7 }); tone(196, t + 0.22, 0.35, { type: 'sawtooth', gain: 0.09, slide: 0.7 }); },
  // forge
  forgeTry: (t) => { noise(t, 0.35, { gain: 0.12, lp: 2500 }); tone(300, t, 0.35, { type: 'triangle', gain: 0.08, slide: 2.2 }); },
  forgeOk: (t) => { [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.07, 0.22, { type: 'triangle', gain: 0.2 })); tone(2093, t + 0.3, 0.5, { gain: 0.08 }); },
  forgeBig: (t) => { [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tone(f, t + i * 0.08, 0.3, { type: 'triangle', gain: 0.2 })); tone(2093, t + 0.5, 0.9, { gain: 0.1 }); },
  forgeFail: (t) => { tone(196, t, 0.25, { type: 'triangle', gain: 0.22, slide: 0.8 }); },
  forgeDrop: (t) => { [494, 392, 311].forEach((f, i) => tone(f, t + i * 0.09, 0.18, { type: 'triangle', gain: 0.2 })); },
  forgeBreak: (t) => { noise(t, 0.7, { gain: 0.35, lp: 900 }); tone(140, t, 0.6, { type: 'sawtooth', gain: 0.15, slide: 0.4 }); },
  coin: (t) => { tone(1568, t, 0.07, { type: 'square', gain: 0.07 }); tone(2093, t + 0.07, 0.2, { type: 'square', gain: 0.07 }); },
};
const last = {};
export const sound = {
  set({ on: o, vol: v }) { if (o !== undefined) on = !!o; if (v !== undefined) { vol = v; if (master) master.gain.value = v; } },
  play(name) {
    if (!on || !ctx || !FX[name]) return;
    const now = performance.now(); if (last[name] && now - last[name] < 120) return; // no machine-gun repeats
    last[name] = now;
    try { if (ctx.state === 'suspended') ctx.resume(); FX[name](ctx.currentTime + 0.01); } catch (e) { /* audio unavailable */ }
  },
};
