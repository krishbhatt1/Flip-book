/**
 * Dev-only: renders the old and new page-turn synthesis offline and reports
 * loudness plus how much energy sits in the harsh 2 kHz+ region.
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async () => {
  const SR = 48000;

  // Deterministic settings (no random detune) so the two are comparable.
  const PRESETS = {
    old: {
      busGain: 0.9,
      peak: 0.34,
      dur: 0.42,
      hp: 300,
      q: 0.85,
      f0: 620,
      fPeak: 3000,
      f1: 760,
      lowpass: null,
      attackFrac: 0.05 / 0.42,
    },
    new: {
      busGain: 0.75,
      peak: 0.16,
      dur: 0.42,
      hp: 180,
      q: 0.65,
      f0: 420,
      fPeak: 1500,
      f1: 620,
      lowpass: 2400,
      attackFrac: 0.22,
    },
  };

  function render(p, hpAnalysis) {
    const dur = p.dur;
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * (dur + 0.1)), SR);

    const frames = SR * 2;
    const noise = ctx.createBuffer(1, frames, SR);
    const ch = noise.getChannelData(0);
    // Fixed seed so both presets see identical noise.
    let seed = 12345;
    for (let i = 0; i < frames; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      ch[i] = (seed / 0x3fffffff) - 1;
    }

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;

    const cut = ctx.createBiquadFilter();
    cut.type = 'highpass';
    cut.frequency.value = p.hp;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = p.q;
    band.frequency.setValueAtTime(p.f0, 0);
    band.frequency.exponentialRampToValueAtTime(p.fPeak, dur * 0.42);
    band.frequency.exponentialRampToValueAtTime(p.f1, dur);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, 0);
    env.gain.exponentialRampToValueAtTime(p.peak, dur * p.attackFrac);
    env.gain.exponentialRampToValueAtTime(p.peak * 0.3, dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, dur);

    const bus = ctx.createGain();
    bus.gain.value = p.busGain;

    let node = src.connect(cut).connect(band);
    if (p.lowpass) {
      const soften = ctx.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = p.lowpass;
      soften.Q.value = 0.7;
      node = node.connect(soften);
    }
    node = node.connect(env).connect(bus);

    if (hpAnalysis) {
      const probe = ctx.createBiquadFilter();
      probe.type = 'highpass';
      probe.frequency.value = 2000;
      probe.Q.value = 0.7;
      node = node.connect(probe);
    }
    node.connect(ctx.destination);

    src.start(0);
    return ctx.startRendering();
  }

  const stats = async (name, p) => {
    const full = await render(p, false);
    const high = await render(p, true);
    const d = full.getChannelData(0);
    const h = high.getChannelData(0);

    let peak = 0;
    let sum = 0;
    let sumH = 0;
    for (let i = 0; i < d.length; i++) {
      peak = Math.max(peak, Math.abs(d[i]));
      sum += d[i] * d[i];
      sumH += h[i] * h[i];
    }
    const rms = Math.sqrt(sum / d.length);
    const rmsH = Math.sqrt(sumH / h.length);
    return {
      name,
      peak: +peak.toFixed(4),
      rms: +rms.toFixed(5),
      highShare: +(rmsH / (rms || 1)).toFixed(3),
    };
  };

  return [await stats('old', PRESETS.old), await stats('new', PRESETS.new)];
});

const [o, n] = result;
const db = (a, b) => (20 * Math.log10(b / a)).toFixed(1);

console.log('              peak     rms      energy>2kHz');
for (const r of result) {
  console.log(
    `  ${r.name.padEnd(4)}  ${String(r.peak).padEnd(8)} ${String(r.rms).padEnd(
      8
    )} ${(r.highShare * 100).toFixed(1)}%`
  );
}
console.log(`\n  peak change: ${db(o.peak, n.peak)} dB`);
console.log(`  rms change:  ${db(o.rms, n.rms)} dB`);
console.log(
  `  harsh (>2kHz) content: ${(o.highShare * 100).toFixed(1)}% -> ${(
    n.highShare * 100
  ).toFixed(1)}%`
);

await browser.close();
