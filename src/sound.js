/**
 * Page-turn audio, synthesised with the Web Audio API.
 *
 * A paper turn is essentially a burst of broadband noise whose resonance
 * sweeps up as the sheet accelerates and back down as it settles. Generating
 * it means no audio file to download, and every turn can be slightly detuned
 * so repeated flips never sound looped.
 */

const STORAGE_KEY = 'flipbook:muted';

export class FlipSound {
  constructor() {
    this.ctx = null;
    this.noise = null;
    this.bus = null;
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
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  #build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    // Two seconds of white noise, reused as the source for every turn.
    const frames = Math.floor(this.ctx.sampleRate * 2);
    this.noise = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const channel = this.noise.getChannelData(0);
    for (let i = 0; i < frames; i++) channel[i] = Math.random() * 2 - 1;

    this.bus = this.ctx.createGain();
    this.bus.gain.value = 0.75;
    this.bus.connect(this.ctx.destination);
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

    const heavy = kind === 'hard';
    const dur = heavy ? 0.5 : 0.38 + Math.random() * 0.08;
    const detune = 0.88 + Math.random() * 0.26;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = detune;
    // Start at a random offset so the noise grain differs each time.
    const offset = Math.random() * 1.4;

    // Resonant sweep: the "whoosh" of the sheet passing through the air.
    // The peak stays out of the 2-5 kHz band, which is where broadband noise
    // starts to sound sibilant and harsh.
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = heavy ? 0.5 : 0.65;
    const f0 = (heavy ? 260 : 420) * detune;
    const fPeak = (heavy ? 900 : 1500) * detune;
    const f1 = (heavy ? 220 : 620) * detune;
    band.frequency.setValueAtTime(f0, now);
    band.frequency.exponentialRampToValueAtTime(fPeak, now + dur * 0.42);
    band.frequency.exponentialRampToValueAtTime(f1, now + dur);

    // Trim the low rumble, but leave enough body that it reads as paper
    // rather than a thin hiss.
    const cut = this.ctx.createBiquadFilter();
    cut.type = 'highpass';
    cut.frequency.value = heavy ? 110 : 180;

    // Gentle roll-off across the top so nothing sharp survives the mix.
    const soften = this.ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = heavy ? 1500 : 2400;
    soften.Q.value = 0.7;

    // Amplitude envelope: eased in rather than snapped, so there is no click
    // on the leading edge, then a long ragged decay.
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
