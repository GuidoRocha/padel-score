// Watch remote: the watch's music screen (via FunDo Health) sends standard media keys to the phone.
// We loop a keep-alive track so Chrome makes this page the active media session, and map:
//   previous (left)  -> point for team A
//   next (right)     -> point for team B
//   play/pause (center) -> undo

const DEBOUNCE_MS = 350;

// Chrome freezes hidden pages that are not audible (after ~1 min since Chrome 143), which stops the
// media handlers. Pure zeros count as silent, so we loop a very low 30 Hz tone (about -50 dBFS):
// inaudible in practice but above Chrome's audibility threshold (-72 dBFS). WAV, not a lossy codec,
// so the faint signal is kept intact. 10 s holds a whole number of cycles, so the loop is seamless.
function keepAliveWavUrl(seconds = 10, rate = 8000, amplitude = 0.003, freq = 30) {
  const samples = seconds * rate;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // 16-bit
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  const peak = amplitude * 32767;
  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * peak), true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

export class WatchRemote {
  constructor({ onPoint, onUndo, onStatus }) {
    this.onPoint = onPoint;
    this.onUndo = onUndo;
    this.onStatus = onStatus;
    this.audio = null;
    this.enabled = false;
    this.last = { action: null, t: 0 };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.#resume();
    });
  }

  get supported() {
    return 'mediaSession' in navigator;
  }

  get status() {
    if (!this.enabled) return 'off';
    return this.audio && !this.audio.paused ? 'on' : 'paused';
  }

  // Must be called from a user gesture.
  async start() {
    if (!this.audio) {
      this.audio = new Audio(keepAliveWavUrl());
      this.audio.loop = true;
      this.audio.addEventListener('pause', () => this.onStatus(this.status));
      this.audio.addEventListener('playing', () => this.onStatus(this.status));
    }
    this.enabled = true;
    this.#installHandlers();
    // playbackState is left to Chrome on purpose: forcing 'playing' while Android has suspended the
    // session makes the center key arrive as 'pause', which is then dropped.
    try {
      await this.audio.play();
    } catch (err) {
      console.warn('No se pudo iniciar el audio', err);
    }
    this.onStatus(this.status);
  }

  stop() {
    this.enabled = false;
    this.audio?.pause();
    for (const action of ['previoustrack', 'nexttrack', 'play', 'pause', 'seekbackward', 'seekforward', 'stop']) {
      this.#setHandler(action, null);
    }
    navigator.mediaSession.playbackState = 'none';
    this.onStatus(this.status);
  }

  setMetadata({ title, artist, album }) {
    if (!this.supported || !this.enabled || !('MediaMetadata' in window)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  }

  #installHandlers() {
    const point = (side) => () => this.#fire(side, () => this.onPoint(side));
    this.#setHandler('previoustrack', point('a'));
    this.#setHandler('nexttrack', point('b'));
    this.#setHandler('seekbackward', point('a'));
    this.#setHandler('seekforward', point('b'));
    // The watch toggles play/pause on its own, so both keys mean "undo" while we are playing.
    // If Chrome paused us (e.g. another app took the audio), 'play' only resumes.
    this.#setHandler('play', () => {
      if (this.audio?.paused) this.#resume();
      else this.#fire('undo', () => this.onUndo());
    });
    this.#setHandler('pause', () => {
      this.#fire('undo', () => this.onUndo());
      this.#resume();
    });
    this.#setHandler('stop', () => this.#resume());
  }

  #setHandler(action, handler) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* action not supported by this browser */
    }
  }

  #fire(action, fn) {
    const now = performance.now();
    if (this.last.action === action && now - this.last.t < DEBOUNCE_MS) return;
    this.last = { action, t: now };
    fn();
  }

  #resume() {
    if (!this.enabled || !this.audio) return;
    this.audio
      .play()
      .then(() => this.onStatus(this.status))
      .catch(() => this.onStatus(this.status));
  }
}
