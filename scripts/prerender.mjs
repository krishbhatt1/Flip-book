/**
 * Rasterises the source PDF into WebP page images + thumbnails and writes a
 * manifest the viewer reads at boot.
 *
 * Usage: node scripts/prerender.mjs [pathToPdf]
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createCanvas, DOMMatrix, Path2D, ImageData } from '@napi-rs/canvas';
import sharp from 'sharp';

// pdf.js expects a handful of browser globals to exist before it is imported.
globalThis.DOMMatrix ??= DOMMatrix;
globalThis.Path2D ??= Path2D;
globalThis.ImageData ??= ImageData;

const require = createRequire(import.meta.url);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PDF_SRC = process.argv[2] ?? path.join(ROOT, 'public', 'catalogue.pdf');
const OUT_DIR = path.join(ROOT, 'public', 'pages');
const PAGE_WIDTH = 1600; // long edge of a full-resolution page render
const THUMB_WIDTH = 220;
const QUALITY = 82;

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width || 1, height || 1);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(target, width, height) {
    target.canvas.width = width;
    target.canvas.height = height;
  }
  destroy(target) {
    target.canvas.width = 0;
    target.canvas.height = 0;
    target.canvas = null;
    target.context = null;
  }
}

const pad = (n) => String(n).padStart(3, '0');

/**
 * Builds the 1200x630 card that WhatsApp, iMessage and social sites show when
 * the link is shared. Without it they render a bare, untrustworthy-looking URL.
 */
async function writeSocialCard() {
  const cover = await sharp(path.join(OUT_DIR, 'page-001.webp'))
    .resize({ width: 980, height: 520, fit: 'inside' })
    .toBuffer();

  await sharp({
    create: {
      width: 1200,
      height: 630,
      channels: 3,
      background: { r: 20, g: 17, b: 15 },
    },
  })
    .composite([{ input: cover, gravity: 'centre' }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(path.join(ROOT, 'public', 'og-image.jpg'));
}

async function main() {
  const data = new Uint8Array(await fs.readFile(PDF_SRC));

  const doc = await pdfjs.getDocument({
    data,
    canvasFactory: new NodeCanvasFactory(),
    standardFontDataUrl: path.join(
      path.dirname(require.resolve('pdfjs-dist/package.json')),
      'standard_fonts/'
    ),
    useSystemFonts: true,
  }).promise;

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(path.join(OUT_DIR, 'thumbs'), { recursive: true });

  const pages = [];
  let aspect = 1.414;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = PAGE_WIDTH / base.width;
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(
      Math.round(viewport.width),
      Math.round(viewport.height)
    );
    const context = canvas.getContext('2d');
    // Pages with transparent backgrounds would otherwise render black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: context,
      viewport,
      canvasFactory: new NodeCanvasFactory(),
    }).promise;

    const png = canvas.toBuffer('image/png');
    const name = `page-${pad(i)}.webp`;

    await sharp(png).webp({ quality: QUALITY }).toFile(path.join(OUT_DIR, name));
    await sharp(png)
      .resize({ width: THUMB_WIDTH })
      .webp({ quality: 70 })
      .toFile(path.join(OUT_DIR, 'thumbs', name));

    if (i === 1) aspect = base.height / base.width;

    pages.push({ index: i, src: `pages/${name}`, thumb: `pages/thumbs/${name}` });
    page.cleanup();
    process.stdout.write(`\r  rendered ${i}/${doc.numPages} pages`);
  }

  await writeSocialCard();

  const meta = await doc.getMetadata().catch(() => null);
  const manifest = {
    title: meta?.info?.Title?.trim() || 'Setu Product Catalogue',
    pdf: 'catalogue.pdf',
    pageCount: doc.numPages,
    aspectRatio: Number(aspect.toFixed(4)),
    pages,
  };

  await fs.writeFile(
    path.join(ROOT, 'public', 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  process.stdout.write(`\n  manifest written (${doc.numPages} pages)\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
