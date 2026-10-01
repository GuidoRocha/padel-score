// Match history and settings, persisted in localStorage.
// Every point is saved immediately, so a match survives closing the app.

const MATCHES_KEY = 'padel.matches.v1';
const ACTIVE_KEY = 'padel.active.v1';
const SETTINGS_KEY = 'padel.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  beeps: true,
  voice: false,
  notify: false,
  wakeLock: false,
  theme: 'rosa', // 'rosa' | 'negro'
  teams: { a: 'Nosotros', b: 'Ellos' },
  config: null, // last used match format
});

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadMatches() {
  const all = read(MATCHES_KEY, []);
  return Array.isArray(all) ? all : [];
}

export function getMatch(id) {
  return loadMatches().find((m) => m.id === id) ?? null;
}

export function saveMatch(match) {
  const all = loadMatches();
  const i = all.findIndex((m) => m.id === match.id);
  match.updatedAt = Date.now();
  if (i >= 0) all[i] = match;
  else all.unshift(match);
  return write(MATCHES_KEY, all);
}

export function deleteMatch(id) {
  write(MATCHES_KEY, loadMatches().filter((m) => m.id !== id));
  if (getActiveId() === id) setActiveId(null);
}

export function getActiveId() {
  return read(ACTIVE_KEY, null);
}

export function setActiveId(id) {
  if (id === null) {
    try {
      localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* storage unavailable */
    }
    return;
  }
  write(ACTIVE_KEY, id);
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY, {}) };
}

export function saveSettings(settings) {
  write(SETTINGS_KEY, settings);
}

export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}

export function newMatch(teams, config) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
    teams,
    config,
    points: [], // { s: 'a' | 'b', t: timestamp, src: 'reloj' | 'pantalla' }
    winner: null,
    summary: '',
  };
}
