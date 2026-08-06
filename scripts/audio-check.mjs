/**
 * Dev-only: confirms the page-turn sample decodes in the browser and reports
 * how loud it is once the viewer's gain and filtering are applied.
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TARGET = process.env.URL ?? 'http://localhost:5173/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();

let sampleUrl = null;
page.on('response', (r) => {
  if (/\.m4a(\?|$)/.test(r.url())) sampleUrl = r.url();
});

await page.goto(TARGET, { waitUntil: 'networkidle2' });
// The sample is only fetched once audio is unlocked by a gesture.
await page.click('#btnNext').catch(() => {});
await new Promise((r) => setTimeout(r, 2500));

if (!sampleUrl) {
  console.error('  FAIL: the viewer never requested the page-turn sample.');
  await browser.close();
  process.exit(1);
}

const out = await page.evaluate(async (levels, url) => {
  // Decode the exact asset the viewer itself fetched.
  const bytes = await (await fetch(url)).arrayBuffer();

  const probe = new AudioContext();
  const decoded = await probe.decodeAudioData(bytes.slice(0));
  await probe.close();

  const render = async (level, lowpass, rate) => {
    const frames = Math.ceil((decoded.duration / rate + 0.1) * 48000);
    const ctx = new OfflineAudioContext(1, frames, 48000);
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    src.playbackRate.value = rate;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lowpass;
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(level, 0.015);
    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    src.connect(lp).connect(g).connect(bus).connect(ctx.destination);
    src.start(0);
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      peak = Math.max(peak, Math.abs(d[i]));
      sum += d[i] * d[i];
    }
    return { peak: +peak.toFixed(4), rms: +Math.sqrt(sum / d.length).toFixed(5) };
  };

  return {
    duration: +decoded.duration.toFixed(3),
    channels: decoded.numberOfChannels,
    rate: decoded.sampleRate,
    page: await render(levels.page, 5200, 1.02),
    hard: await render(levels.hard, 3600, 0.87),
  };
}, { page: 0.32, hard: 0.45 }, sampleUrl);

console.log(`  sample fetched: ${sampleUrl ?? '(not observed)'}`);
console.log(
  `  decoded ok: ${out.duration}s, ${out.channels}ch @ ${out.rate} Hz\n`
);
console.log('  as played        peak     rms');
console.log(`  page turn        ${out.page.peak}   ${out.page.rms}`);
console.log(`  cover turn       ${out.hard.peak}   ${out.hard.rms}`);
console.log('\n  (softened synth was peak 0.0458 / rms 0.00722)');

await browser.close();
