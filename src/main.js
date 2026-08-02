import { PageFlip } from 'page-flip';
import { FlipSound } from './sound.js';
import './styles.css';

const $ = (id) => document.getElementById(id);

const el = {
  app: $('app'),
  loader: $('loader'),
  loaderFill: $('loaderFill'),
  loaderPct: $('loaderPct'),
  stage: $('stage'),
  viewport: $('viewport'),
  bookWrap: $('bookWrap'),
  book: $('book'),
  toolbar: $('toolbar'),
  thumbs: $('thumbs'),
  thumbsGrid: $('thumbsGrid'),
  thumbsClose: $('thumbsClose'),
  pageInput: $('pageInput'),
  pageTotal: $('pageTotal'),
  zoomLevel: $('zoomLevel'),
  toast: $('toast'),
  btnThumbs: $('btnThumbs'),
  btnSound: $('btnSound'),
  btnFirst: $('btnFirst'),
  btnPrev: $('btnPrev'),
  btnNext: $('btnNext'),
  btnLast: $('btnLast'),
  btnAuto: $('btnAuto'),
  btnZoomIn: $('btnZoomIn'),
  btnZoomOut: $('btnZoomOut'),
  btnShare: $('btnShare'),
  btnDownload: $('btnDownload'),
  btnFull: $('btnFull'),
  navPrev: $('navPrev'),
  navNext: $('navNext'),
};

const FLIP_MS = 900;
const AUTOPLAY_MS = 4200;
const ZOOM_STEPS = [1, 1.35, 1.8, 2.4, 3];

const sound = new FlipSound();

const state = {
  manifest: null,
  flip: null,
  page: 0,
  zoomIdx: 0,
  pan: { x: 0, y: 0 },
  autoplay: null,
  spread: false,
  pageW: 0,
};

/* ------------------------------------------------------------------ */
/*  Boot                                                               */
/* ------------------------------------------------------------------ */

async function boot() {
  const res = await fetch('manifest.json');
  state.manifest = await res.json();

  document.title = `${state.manifest.title} · Flipbook`;
  el.pageTotal.textContent = state.manifest.pageCount;
  el.thumbsGrid.style.setProperty(
    '--thumb-ratio',
    String(1 / state.manifest.aspectRatio)
  );

  buildThumbs();
  await preloadCovers();
  build();

  const start = pageFromHash();
  if (start > 1) state.flip.turnToPage(start - 1);

  el.loader.classList.add('is-done');
  wireControls();
}

/** The first spread must be ready before the loader lifts. */
async function preloadCovers() {
  const first = state.manifest.pages.slice(0, 4);
  let done = 0;
  await Promise.all(
    first.map(
      (p) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = img.onerror = () => {
            done++;
            setProgress(done / first.length);
            resolve();
          };
          img.src = p.src;
        })
    )
  );
  // Remaining pages stream in quietly behind the opened book.
  const rest = () =>
    state.manifest.pages.slice(4).forEach((p) => {
      new Image().src = p.src;
    });
  if (window.requestIdleCallback) window.requestIdleCallback(rest);
  else setTimeout(rest, 800);
}

function setProgress(ratio) {
  const pct = Math.round(ratio * 100);
  el.loaderFill.style.width = `${pct}%`;
  el.loaderPct.textContent = `${pct}%`;
}

/* ------------------------------------------------------------------ */
/*  Book construction                                                  */
/* ------------------------------------------------------------------ */

/** Page geometry that fits the current viewport, in CSS pixels. */
function measure() {
  const pad = window.innerWidth < 860 ? 14 : 44;
  const availW = el.viewport.clientWidth - pad * 2;
  const availH = el.viewport.clientHeight - pad * 2;
  const ratio = state.manifest.aspectRatio; // height / width

  // A spread needs room for two pages side by side at a sensible size.
  const spread = availW / 2 / ratio > availH * 0.45 && window.innerWidth >= 900;
  const perPageW = spread ? availW / 2 : availW;

  const width = Math.floor(Math.min(perPageW, availH / ratio));
  return { width, height: Math.floor(width * ratio), spread };
}

function pageMarkup(page, i) {
  const isCover = i === 0 || i === state.manifest.pageCount - 1;
  const side = i % 2 === 0 ? 'right' : 'left';
  const node = document.createElement('div');
  node.className = `page page--${side}${isCover ? ' page--hard' : ''}`;
  if (isCover) node.dataset.density = 'hard';
  node.innerHTML = `
    <img class="page__img" src="${page.src}" alt="Page ${page.index}" draggable="false" />
    <span class="page__no">${page.index}</span>`;
  return node;
}

function build() {
  const { width, height, spread } = measure();
  const keep = state.page;

  if (state.flip) {
    state.flip.destroy();
    el.book.innerHTML = '';
  }

  // page-flip picks landscape vs portrait from the width of its host element,
  // so the host has to be sized before the book is created.
  const hostW = spread ? width * 2 : width;
  el.book.style.width = `${hostW}px`;
  el.book.style.height = `${height}px`;
  el.bookWrap.style.width = `${hostW}px`;
  el.bookWrap.style.height = `${height}px`;

  state.manifest.pages.forEach((p, i) => el.book.appendChild(pageMarkup(p, i)));

  state.flip = new PageFlip(el.book, {
    width,
    height,
    size: 'fixed',
    showCover: true,
    usePortrait: true,
    flippingTime: FLIP_MS,
    maxShadowOpacity: 0.5,
    drawShadow: true,
    showPageCorners: true,
    swipeDistance: 24,
    mobileScrollSupport: false,
    useMouseEvents: true,
  });

  state.flip.loadFromHTML(el.book.querySelectorAll('.page'));
  state.spread = spread;
  state.pageW = width;

  state.flip.on('flip', (e) => {
    state.page = e.data;
    applyTransform();
    syncUI();
    writeHash();
  });

  state.flip.on('changeState', (e) => {
    if (e.data === 'flipping') {
      const atCover =
        state.page <= 1 || state.page >= state.manifest.pageCount - 2;
      sound.play(atCover ? 'hard' : 'page');
    }
  });

  if (keep) state.flip.turnToPage(keep);
  state.page = state.flip.getCurrentPageIndex();
  applyZoom();
  syncUI();
}

/* ------------------------------------------------------------------ */
/*  Navigation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Index of the leaf that starts the spread containing `idx`. With a cover
 * shown, spreads pair up as (1,2), (3,4) … so odd indices open on the left.
 */
function spreadStart(idx) {
  if (idx <= 0) return 0;
  return idx % 2 === 0 ? idx - 1 : idx;
}

function nextIndex() {
  const total = state.manifest.pageCount;
  if (!state.spread) return Math.min(state.page + 1, total - 1);
  if (state.page === 0) return 1;
  return Math.min(spreadStart(state.page) + 2, total - 1);
}

function prevIndex() {
  if (!state.spread) return Math.max(state.page - 1, 0);
  return Math.max(spreadStart(state.page) - 2, 0);
}

const next = () => {
  if (!state.flip) return;
  // Recentre in step with the turn rather than snapping after it lands.
  applyTransform(nextIndex());
  state.flip.flipNext();
};

const prev = () => {
  if (!state.flip) return;
  applyTransform(prevIndex());
  state.flip.flipPrev();
};

const goTo = (n) => {
  if (!state.flip) return;
  const target = Math.min(Math.max(n, 1), state.manifest.pageCount) - 1;
  applyTransform(target);
  state.flip.flip(target);
};

function syncUI() {
  const total = state.manifest.pageCount;
  const shown = state.page + 1;

  if (document.activeElement !== el.pageInput) el.pageInput.value = shown;

  const atStart = state.page <= 0;
  const atEnd = state.page >= total - 1;
  [el.btnFirst, el.btnPrev, el.navPrev].forEach((b) => (b.disabled = atStart));
  [el.btnLast, el.btnNext, el.navNext].forEach((b) => (b.disabled = atEnd));

  el.thumbsGrid.querySelectorAll('.thumb').forEach((t, i) => {
    t.classList.toggle('is-current', i === state.page);
  });
}

function pageFromHash() {
  const n = parseInt(location.hash.replace('#page=', ''), 10);
  return Number.isFinite(n) ? n : 1;
}

function writeHash() {
  history.replaceState(null, '', `#page=${state.page + 1}`);
}

/* ------------------------------------------------------------------ */
/*  Thumbnails                                                         */
/* ------------------------------------------------------------------ */

function buildThumbs() {
  const frag = document.createDocumentFragment();
  state.manifest.pages.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'thumb';
    b.innerHTML = `<img src="${p.thumb}" loading="lazy" alt="Page ${p.index}" /><span>${p.index}</span>`;
    b.addEventListener('click', () => {
      goTo(p.index);
      if (window.innerWidth < 860) toggleThumbs(false);
    });
    frag.appendChild(b);
  });
  el.thumbsGrid.appendChild(frag);
}

function toggleThumbs(force) {
  const open = force ?? !el.thumbs.classList.contains('is-open');
  el.thumbs.classList.toggle('is-open', open);
  el.thumbs.setAttribute('aria-hidden', String(!open));
  el.btnThumbs.classList.toggle('is-active', open);
  if (open) {
    el.thumbsGrid
      .querySelector('.thumb.is-current')
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

/* ------------------------------------------------------------------ */
/*  Zoom & pan                                                         */
/* ------------------------------------------------------------------ */

/**
 * A closed book only fills half the spread, so slide it over to keep the
 * visible page in the middle of the stage.
 * @param {number} idx  Page index to centre for (defaults to the current one).
 */
function centreOffset(idx = state.page) {
  if (!state.spread) return 0;
  const half = state.pageW / 2;
  if (idx === 0) return -half; // front cover sits in the right slot
  if (idx === state.manifest.pageCount - 1) return half; // back cover, left slot
  return 0;
}

function applyTransform(forIdx) {
  const z = ZOOM_STEPS[state.zoomIdx];
  const x = centreOffset(forIdx) * z + state.pan.x;
  el.bookWrap.style.transform = `translate(${x}px, ${state.pan.y}px) scale(${z})`;
}

function applyZoom() {
  const z = ZOOM_STEPS[state.zoomIdx];
  if (z === 1) state.pan = { x: 0, y: 0 };
  clampPan();
  applyTransform();
  el.zoomLevel.textContent = `${Math.round(z * 100)}%`;
  el.btnZoomIn.disabled = state.zoomIdx >= ZOOM_STEPS.length - 1;
  el.btnZoomOut.disabled = state.zoomIdx <= 0;
  el.viewport.style.cursor = z > 1 ? 'grab' : '';
}

function zoom(dir) {
  const nextIdx = Math.min(
    Math.max(state.zoomIdx + dir, 0),
    ZOOM_STEPS.length - 1
  );
  if (nextIdx === state.zoomIdx) return;
  state.zoomIdx = nextIdx;
  applyZoom();
}

/** Keep the magnified page from being dragged off screen. */
function clampPan() {
  const z = ZOOM_STEPS[state.zoomIdx];
  const w = el.bookWrap.offsetWidth * z;
  const h = el.bookWrap.offsetHeight * z;
  const maxX = Math.max(0, (w - el.viewport.clientWidth) / 2);
  const maxY = Math.max(0, (h - el.viewport.clientHeight) / 2);
  state.pan.x = Math.min(Math.max(state.pan.x, -maxX), maxX);
  state.pan.y = Math.min(Math.max(state.pan.y, -maxY), maxY);
}

function wirePan() {
  let dragging = false;
  let origin = null;

  el.viewport.addEventListener(
    'pointerdown',
    (e) => {
      if (ZOOM_STEPS[state.zoomIdx] === 1) return;
      // While magnified the drag gesture pans instead of peeling a corner.
      e.stopPropagation();
      dragging = true;
      origin = { x: e.clientX - state.pan.x, y: e.clientY - state.pan.y };
      el.bookWrap.classList.add('is-panning');
      el.viewport.setPointerCapture(e.pointerId);
    },
    true
  );

  el.viewport.addEventListener(
    'pointermove',
    (e) => {
      if (!dragging) return;
      e.stopPropagation();
      state.pan = { x: e.clientX - origin.x, y: e.clientY - origin.y };
      clampPan();
      applyTransform();
    },
    true
  );

  const end = () => {
    if (!dragging) return;
    dragging = false;
    el.bookWrap.classList.remove('is-panning');
  };
  el.viewport.addEventListener('pointerup', end, true);
  el.viewport.addEventListener('pointercancel', end, true);

  el.viewport.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1 : -1);
    },
    { passive: false }
  );

  el.viewport.addEventListener('dblclick', () => {
    zoom(state.zoomIdx === 0 ? 1 : -state.zoomIdx);
  });
}

/* ------------------------------------------------------------------ */
/*  Autoplay, fullscreen, share                                        */
/* ------------------------------------------------------------------ */

function toggleAutoplay() {
  if (state.autoplay) {
    clearInterval(state.autoplay);
    state.autoplay = null;
    el.btnAuto.classList.remove('is-playing', 'is-active');
    return;
  }
  el.btnAuto.classList.add('is-playing', 'is-active');
  state.autoplay = setInterval(() => {
    if (state.page >= state.manifest.pageCount - 1) goTo(1);
    else next();
  }, AUTOPLAY_MS);
  next();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else el.app.requestFullscreen?.().catch(() => toast('Fullscreen blocked'));
}

async function share() {
  const url = location.href;
  const data = { title: state.manifest.title, url };
  try {
    if (navigator.share) await navigator.share(data);
    else {
      await navigator.clipboard.writeText(url);
      toast('Link copied to clipboard');
    }
  } catch {
    /* user dismissed the share sheet */
  }
}

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 2200);
}

/* ------------------------------------------------------------------ */
/*  Wiring                                                             */
/* ------------------------------------------------------------------ */

function wireControls() {
  el.btnNext.onclick = el.navNext.onclick = next;
  el.btnPrev.onclick = el.navPrev.onclick = prev;
  el.btnFirst.onclick = () => goTo(1);
  el.btnLast.onclick = () => goTo(state.manifest.pageCount);
  el.btnThumbs.onclick = () => toggleThumbs();
  el.thumbsClose.onclick = () => toggleThumbs(false);
  el.btnZoomIn.onclick = () => zoom(1);
  el.btnZoomOut.onclick = () => zoom(-1);
  el.btnAuto.onclick = toggleAutoplay;
  el.btnFull.onclick = toggleFullscreen;
  el.btnShare.onclick = share;

  el.btnSound.onclick = () => {
    const on = sound.toggle();
    el.btnSound.classList.toggle('is-muted', !on);
    toast(on ? 'Sound on' : 'Sound off');
    if (on) sound.play('page');
  };
  el.btnSound.classList.toggle('is-muted', !sound.enabled);

  el.pageInput.addEventListener('change', () => {
    const n = parseInt(el.pageInput.value, 10);
    if (Number.isFinite(n)) goTo(n);
    else syncUI();
    el.pageInput.blur();
  });
  el.pageInput.addEventListener('focus', () => el.pageInput.select());

  document.addEventListener('fullscreenchange', () => {
    el.btnFull.classList.toggle('is-full', !!document.fullscreenElement);
    setTimeout(build, 120);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target === el.pageInput) return;
    const keys = {
      ArrowRight: next,
      ArrowDown: next,
      PageDown: next,
      ' ': next,
      ArrowLeft: prev,
      ArrowUp: prev,
      PageUp: prev,
      Home: () => goTo(1),
      End: () => goTo(state.manifest.pageCount),
      f: toggleFullscreen,
      F: toggleFullscreen,
      '+': () => zoom(1),
      '=': () => zoom(1),
      '-': () => zoom(-1),
      t: () => toggleThumbs(),
      Escape: () => toggleThumbs(false),
    };
    const fn = keys[e.key];
    if (!fn) return;
    e.preventDefault();
    fn();
  });

  // Any first gesture satisfies the browser's autoplay policy.
  ['pointerdown', 'keydown'].forEach((evt) =>
    window.addEventListener(evt, () => sound.unlock(), { once: true })
  );

  wirePan();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 180);
  });
}

boot();
