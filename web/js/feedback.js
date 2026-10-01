// Audible feedback so points registered from the watch can be confirmed without looking at the phone.

let ctx = null;

// Must be called from a user gesture (autoplay policy).
export function unlockAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  ctx ??= new AudioCtx();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function tone(freq, start, duration, gain = 0.25) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  const t0 = ctx.currentTime + start;
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

const PATTERNS = {
  a: [[880, 0, 0.14]], // one high beep: point for the left team
  b: [[660, 0, 0.1], [660, 0.16, 0.1]], // two beeps: point for the right team
  undo: [[520, 0, 0.12], [390, 0.14, 0.18]],
  game: [[660, 0, 0.1], [880, 0.12, 0.1], [1100, 0.24, 0.16]],
  set: [[660, 0, 0.12], [880, 0.14, 0.12], [1320, 0.28, 0.3]],
};

export function beep(pattern) {
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  for (const [freq, start, duration] of PATTERNS[pattern] ?? []) tone(freq, start, duration);
}

export function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-ES';
  utterance.rate = 1.05;
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('es'));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

export async function notifyScore(title, body) {
  if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  reg.showNotification(title, { body, tag: 'padel-score', renotify: true, silent: true });
}

export async function requestNotifications() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}
