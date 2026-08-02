/** Dev-only: dumps element geometry so layout bugs can be diagnosed. */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });
await wait(2500);

const dump = async (label) => {
  const info = await page.evaluate(() => {
    const box = (sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.x),
        y: Math.round(r.y),
      };
    };
    const img = document.querySelector('.page__img');
    return {
      viewport: box('#viewport'),
      bookWrap: box('#bookWrap'),
      book: box('#book'),
      stfParent: box('.stf__parent'),
      stfBlock: box('.stf__block'),
      firstPage: box('.page'),
      firstImg: box('.page__img'),
      imgNatural: img ? `${img.naturalWidth}x${img.naturalHeight}` : null,
      pageCss: (() => {
        const n = document.querySelector('.page');
        if (!n) return null;
        const s = getComputedStyle(n);
        return { w: s.width, h: s.height, pos: s.position };
      })(),
    };
  });
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(info, null, 2));
};

await dump('cover');
await page.click('#btnNext');
await wait(1800);
await dump('spread');

await browser.close();
