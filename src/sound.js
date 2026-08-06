import turnUrl from './assets/page-turn.m4a';

/**
 * Page-turn audio.
 *
 * Plays a recorded paper-turn sample. The sample has plenty of headroom, so
 * it is attenuated hard on the way out: the aim is something you notice
 * without it competing with the page. If the file fails to load or decode,
 * playback falls back to a synthesised turn so the book is never silent.
 */

const STORAGE_KEY = 'flipbook:muted';

/** Output level per turn type. Raise these if the turn is too quiet. */
const LEVEL = { page: 0.32, hard: 0.45 };

export class FlipSound {
  constructor() {
    this.ctx = null;
    this.bus = null;
    this.sample = null;
    this.noise = null;
    this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    this.lastPlay = 0;
  }

  get enabled() {
    return !this.muted;
  }

  toggle() {
    this.muted = !this.muted;
    localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    if (!this.muted) this.unlock();
    return !this.muted;
  }

  /** Browsers only allow audio to start from a user gesture. */
  unlock() {
    if (this.muted) return;
    if (!this.ctx) this.#build();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  #build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    this.bus = this.ctx.createGain();
    this.bus.gain.value = 0.9;
    this.bus.connect(this.ctx.destination);

    this.#loadSample();
  }

  async #loadSample() {
    try {
      const res = await fetch(turnUrl);
      const bytes = await res.arrayBuffer();
      this.sample = await this.ctx.decodeAudioData(bytes);
    } catch {
      this.sample = null; // synthesised fallback takes over
    }
  }

  /**
   * @param {'page'|'hard'} kind  A soft sheet or a stiff cover board.
   */
  play(kind = 'page') {
    if (this.muted) return;
    if (!this.ctx) this.#build();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    // Guard against double-triggering from overlapping flip events.
    const now = this.ctx.currentTime;
    if (now - this.lastPlay < 0.12) return;
    this.lastPlay = now;

    if (this.sample) this.#playSample(kind, now);
    else this.#playSynth(kind, now);
  }

  #playSample(kind, now) {
    const heavy = kind === 'hard';

    const src = this.ctx.createBufferSource();
    src.buffer = this.sample;
    // Covers are stiffer board, so they read slower and deeper. The jitter
    // keeps consecutive turns from sounding like a looped clip.
    src.playbackRate.value = heavy
      ? 0.84 + Math.random() * 0.06
      : 0.95 + Math.random() * 0.14;

    // Shave the very top so the turn stays soft alongside the artwork.
    const soften = this.ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = heavy ? 3600 : 5200;
    soften.Q.value = 0.7;

    // Tiny ramp in to avoid a click on the leading edge; the sample decays
    // naturally so it needs no fade out.
    const env = this.ctx.createGain();
    const level = LEVEL[kind] ?? LEVEL.page;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(level, now + 0.015);

    src.connect(soften).connect(env).connect(this.bus);
    src.start(now);
  }

  /* ---- Fallback: synthesised turn, used only if the sample is missing ---- */

  #noiseBuffer() {
    if (this.noise) return this.noise;
    const frames = Math.floor(this.ctx.sampleRate * 2);
    this.noise = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const channel = this.noise.getChannelData(0);
    for (let i = 0; i < frames; i++) channel[i] = Math.random() * 2 - 1;
    return this.noise;
  }

  #playSynth(kind, now) {
    const heavy = kind === 'hard';
    const dur = heavy ? 0.5 : 0.38 + Math.random() * 0.08;
    const detune = 0.88 + Math.random() * 0.26;

    const src = this.ctx.createBufferSource();
    src.buffer = this.#noiseBuffer();
    src.loop = true;
    src.playbackRate.value = detune;
    const offset = Math.random() * 1.4;

    // Sweep peak stays out of 2-5 kHz, where broadband noise turns sibilant.
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = heavy ? 0.5 : 0.65;
    band.frequency.setValueAtTime((heavy ? 260 : 420) * detune, now);
    band.frequency.exponentialRampToValueAtTime(
      (heavy ? 900 : 1500) * detune,
      now + dur * 0.42
    );
    band.frequency.exponentialRampToValueAtTime(
      (heavy ? 220 : 620) * detune,
      now + dur
    );

    const cut = this.ctx.createBiquadFilter();
    cut.type = 'highpass';
    cut.frequency.value = heavy ? 110 : 180;

    const soften = this.ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = heavy ? 1500 : 2400;
    soften.Q.value = 0.7;

    const env = this.ctx.createGain();
    const peak = heavy ? 0.22 : 0.16;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + dur * 0.22);
    env.gain.exponentialRampToValueAtTime(peak * 0.3, now + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(cut).connect(band).connect(soften).connect(env).connect(this.bus);
    src.start(now, offset, dur + 0.05);
    src.stop(now + dur + 0.05);

    if (heavy) this.#thud(now + dur * 0.72);
  }

  /** Low body knock for the covers opening and closing. */
  #thud(at) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, at);
    osc.frequency.exponentialRampToValueAtTime(48, at + 0.16);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(0.12, at + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);

    osc.connect(env).connect(this.bus);
    osc.start(at);
    osc.stop(at + 0.22);
  }
}
