/** Dev-only visual check: drives the viewer and saves screenshots to .shots/ */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TARGET = process.env.URL ?? 'http://localhost:5173/';
const OUT = fileURLToPath(new URL('../.shots/', import.meta.url));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await fs.mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1'],
});

const errors = [];

async function shoot(name, width, height, steps = async () => {}) {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));

  await page.setViewport({ width, height });
  await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(2500);
  await steps(page);
  await page.screenshot({ path: `${OUT}${name}.png` });
  await page.close();
}

await shoot('01-cover', 1600, 1000);

await shoot('02-spread', 1600, 1000, async (page) => {
  await page.click('#btnNext');
  await wait(1600);
  await page.click('#btnNext');
  await wait(1600);
});

await shoot('03-midflip', 1600, 1000, async (page) => {
  await page.click('#btnNext');
  await wait(1600);
  await page.click('#btnNext');
  await wait(340); // caught partway through the turn
});

await shoot('04-thumbs', 1600, 1000, async (page) => {
  await page.click('#btnThumbs');
  await wait(900);
});

await shoot('05-zoom', 1600, 1000, async (page) => {
  await page.click('#btnNext');
  await wait(1600);
  await page.click('#btnZoomIn');
  await page.click('#btnZoomIn');
  await wait(700);
});

await shoot('06-mobile', 430, 900);

await shoot('07-back', 1600, 1000, async (page) => {
  await page.click('#btnLast');
  await wait(2200);
});

await browser.close();

if (errors.length) {
  console.log('CONSOLE ERRORS:');
  errors.forEach((e) => console.log(' ', e));
} else {
  console.log('No console errors.');
}
