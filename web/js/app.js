import { changeKind, computeState, describe, formatSets, normalizeConfig, pressure } from './scoring.js';
import * as store from './storage.js';
import { WatchRemote } from './watch.js';
import { beep, notifyScore, requestNotifications, speak, unlockAudio } from './feedback.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SIDES = ['a', 'b'];
const VIEWS = ['home', 'setup', 'match', 'history', 'detail'];
const DEUCE_LABEL = { golden: 'Punto de oro', advantage: 'Ventaja', star: 'Star point' };
const WORDS = { 0: 'cero', 15: 'quince', 30: 'treinta', 40: 'cuarenta' };

let settings = store.loadSettings();
let match = null; // match being played
let state = null; // computed state of `match`
let wakeLock = null;

const watch = new WatchRemote({
  onPoint: (side) => addPoint(side, 'reloj'),
  onUndo: () => undo(),
  onStatus: renderWatchStatus,
});

const sidesOf = (m) => m.points.map((p) => p.s);
const matchVisible = () => !$('#view-match').hidden;

// ---------- Routing ----------

function show(view) {
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  window.scrollTo(0, 0);
  applyWakeLock();
}

function route() {
  const [, path = '', id = ''] = (location.hash || '#/').match(/^#\/?([^/]*)\/?(.*)$/) ?? [];
  if (path === 'nuevo') {
    renderSetup();
    show('setup');
  } else if (path === 'partido') {
    if (!loadActive()) return void (location.hash = '#/');
    renderMatch();
    show('match');
  } else if (path === 'historial' && id) {
    renderDetail(decodeURIComponent(id));
    show('detail');
  } else if (path === 'historial') {
    renderHistory();
    show('history');
  } else {
    renderHome();
    show('home');
  }
}

// Another instance (installed PWA + Chrome tab) may have changed or deleted the match:
// re-read storage before mutating so its points are not overwritten or a deleted match revived.
function syncMatch() {
  if (!match) return false;
  const fresh = store.getActiveId() === match.id ? store.getMatch(match.id) : null;
  if (!fresh) {
    match = null;
    state = null;
    if (watch.enabled) watch.stop();
    return false;
  }
  // Strictly newer only: if our last write failed (quota), memory is ahead of storage.
  if ((fresh.updatedAt ?? 0) > (match.updatedAt ?? 0)) {
    match = fresh;
    state = computeState(match.config, sidesOf(match));
  }
  return true;
}

function loadActive() {
  const id = store.getActiveId();
  if (!id) return false;
  if (!(match?.id === id && syncMatch())) match = store.getMatch(id);
  if (!match) {
    store.setActiveId(null);
    return false;
  }
  state = computeState(match.config, sidesOf(match));
  return true;
}

// ---------- Home ----------

function renderHome() {
  const id = store.getActiveId();
  const m = id && store.getMatch(id);
  $('#btn-resume').hidden = !m;
  if (m) {
    const s = computeState(m.config, sidesOf(m));
    $('#resume-info').textContent = `${m.teams.a} vs ${m.teams.b} · ${scoreSummary(s)}`;
  }
}

// ---------- Setup ----------

function renderSetup() {
  const form = $('#setup-form');
  const cfg = normalizeConfig(settings.config ?? {});
  form.teamA.value = settings.teams.a;
  form.teamB.value = settings.teams.b;
  for (const name of ['bestOf', 'gamesPerSet', 'deuce', 'finalSet']) {
    const input = form.querySelector(`input[name="${name}"][value="${cfg[name]}"]`);
    if (input) input.checked = true;
  }
  syncFinalSetField();
}

function syncFinalSetField() {
  $('#final-set-field').hidden = $('#setup-form').bestOf.value === '1';
}

function startMatch(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const teams = { a: form.teamA.value.trim() || 'Nosotros', b: form.teamB.value.trim() || 'Ellos' };
  const config = normalizeConfig({
    bestOf: Number(form.bestOf.value),
    gamesPerSet: Number(form.gamesPerSet.value),
    deuce: form.deuce.value,
    finalSet: form.finalSet.value,
  });
  settings = { ...settings, teams, config };
  store.saveSettings(settings);
  match = store.newMatch(teams, config);
  store.saveMatch(match);
  store.setActiveId(match.id);
  store.requestPersistence();
  unlockAudio();
  location.hash = '#/partido';
}

// ---------- Match ----------

function formatLabel(cfg) {
  return `${cfg.bestOf === 1 ? '1 set' : 'Mejor de 3'} · ${cfg.gamesPerSet} juegos · ${DEUCE_LABEL[cfg.deuce]}`;
}

function scoreSummary(s) {
  const current = s.current && !s.winner ? `${s.current.games.a}-${s.current.games.b}` : '';
  return [formatSets(s), current].filter(Boolean).join(' ') || '0-0';
}

function pressureOf(cfg) {
  const sides = sidesOf(match);
  for (const side of SIDES) {
    const kind = pressure(cfg, sides, side);
    if (kind) return { side, kind };
  }
  return null;
}

function statusText(cfg, d) {
  if (state.winner) return `Ganó ${match.teams[state.winner]}`;
  const labels = {
    golden: 'PUNTO DE ORO',
    star: 'STAR POINT',
    deuce: 'Iguales',
    advantage: `Ventaja ${match.teams[d.advantage]}`,
    tiebreak: 'Tie-break',
    supertb: 'Super tie-break',
  };
  const parts = [labels[d.status]];
  const p = pressureOf(cfg);
  if (p) parts.push(`${p.kind === 'match' ? 'Punto de partido' : 'Punto de set'} ${match.teams[p.side]}`);
  return parts.filter(Boolean).join(' · ');
}

function renderMatch() {
  if (!match) return;
  const cfg = normalizeConfig(match.config);
  const d = describe(cfg, state);
  $('#match-format').textContent = formatLabel(cfg);
  for (const side of SIDES) {
    const el = $(`.side[data-side="${side}"]`);
    el.querySelector('[data-f="team"]').textContent = match.teams[side];
    el.querySelector('[data-f="points"]').textContent = state.winner ? (state.winner === side ? '🏆' : '') : d[side];
    el.querySelector('[data-f="games"]').textContent = state.current ? state.current.games[side] : '–';
    el.querySelector('[data-f="sets"]').textContent = state.setsWon[side];
  }
  $('#status-banner').textContent = statusText(cfg, d);
  const done = formatSets(state);
  $('#sets-line').textContent = done && !state.winner ? `Sets: ${done}` : '';
  $('#btn-undo').disabled = match.points.length === 0;
  renderLog();
  renderWinner();
  renderWatchStatus(watch.status);
  syncOptions();
}

function renderLog() {
  const fmt = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('#log').innerHTML = match.points
    .slice(-5)
    .reverse()
    .map(
      (p) =>
        `<li><span>${p.src === 'reloj' ? '⌚' : '👆'} Punto ${esc(match.teams[p.s])}</span><span class="src">${fmt.format(p.t)}</span></li>`,
    )
    .join('');
}

function renderWinner() {
  $('#winner').hidden = !state.winner;
  if (!state.winner) return;
  $('#winner-title').textContent = `¡Ganó ${match.teams[state.winner]}!`;
  $('#winner-score').textContent = formatSets(state);
}

function flash(side) {
  const el = $(`.side[data-side="${side}"]`);
  el.classList.add(`flash-${side}`);
  setTimeout(() => el.classList.remove(`flash-${side}`), 250);
}

function addPoint(side, src) {
  if (!syncMatch() || state.winner) return;
  const prev = state;
  match.points.push({ s: side, t: Date.now(), src });
  state = computeState(match.config, sidesOf(match));
  if (state.winner) {
    match.winner = state.winner;
    match.finishedAt = Date.now();
  }
  match.summary = formatSets(state);
  store.saveMatch(match);
  announce(changeKind(prev, state), side);
  if (matchVisible()) {
    renderMatch();
    flash(side);
  }
}

function undo() {
  if (!syncMatch() || match.points.length === 0) return;
  match.points.pop();
  state = computeState(match.config, sidesOf(match));
  match.winner = state.winner;
  if (!state.winner) match.finishedAt = null;
  match.summary = formatSets(state);
  store.saveMatch(match);
  if (settings.beeps) beep('undo');
  if (settings.voice) speak(`Deshecho. ${spokenPoint()}`);
  updateMetadata();
  if (matchVisible()) renderMatch();
}

function spokenSets(s) {
  return formatSets(s).replace(/[[\]()]/g, ' ').replaceAll('-', ' a ');
}

function spokenPoint() {
  const cfg = normalizeConfig(match.config);
  const d = describe(cfg, state);
  const texts = {
    tiebreak: `${d.a} a ${d.b}`,
    supertb: `${d.a} a ${d.b}`,
    golden: 'Punto de oro',
    star: 'Star point',
    deuce: 'Iguales',
    advantage: `Ventaja ${match.teams[d.advantage]}`,
    normal: d.a === d.b ? `${WORDS[d.a]} iguales` : `${WORDS[d.a]} ${WORDS[d.b]}`,
  };
  let text = texts[d.status] ?? '';
  const p = pressureOf(cfg);
  if (p) text += `. ${p.kind === 'match' ? 'Punto de partido' : 'Punto de set'} ${match.teams[p.side]}`;
  return text;
}

function spoken(kind, side) {
  const team = match.teams[side];
  if (kind === 'match') return `Partido para ${team}. ${spokenSets(state)}`;
  if (kind === 'set') return `Set para ${team}. Sets ${state.setsWon.a} a ${state.setsWon.b}`;
  if (kind === 'game') {
    const g = state.current.games;
    return `Juego ${team}. ${g.a} a ${g.b}${state.current.tiebreak ? '. Tie-break' : ''}`;
  }
  return spokenPoint();
}

function announce(kind, side) {
  if (settings.beeps) beep(kind === 'point' ? side : kind === 'game' ? 'game' : 'set');
  if (settings.voice) speak(spoken(kind, side));
  if (settings.notify) notifyScore(scoreTitle(), `${match.teams.a} vs ${match.teams.b} · ${scoreSummary(state)}`);
  updateMetadata();
}

function scoreTitle() {
  if (state.winner) return `Ganó ${match.teams[state.winner]}`;
  const d = describe(match.config, state);
  return `${d.a} - ${d.b}`;
}

function updateMetadata() {
  if (!match || !state) return;
  const g = state.current?.games;
  watch.setMetadata({
    title: scoreTitle(),
    artist: g ? `Juegos ${g.a}-${g.b} · Sets ${state.setsWon.a}-${state.setsWon.b}` : scoreSummary(state),
    album: `${match.teams.a} vs ${match.teams.b}`,
  });
}

function closeMatch() {
  if (!syncMatch()) return void (location.hash = '#/');
  if (!match.finishedAt) match.finishedAt = Date.now();
  store.saveMatch(match);
  store.setActiveId(null);
  const id = match.id;
  match = null;
  state = null;
  if (watch.enabled) watch.stop();
  location.hash = `#/historial/${encodeURIComponent(id)}`;
}

// ---------- Watch, options, wake lock ----------

function renderWatchStatus(status) {
  const btn = $('#btn-watch');
  btn.dataset.status = status;
  btn.textContent = { on: '⌚ Reloj activo', paused: '⌚ Reactivar reloj', off: '⌚ Activar reloj' }[status];
}

async function toggleWatch() {
  unlockAudio();
  if (watch.status === 'on') {
    watch.stop();
    return;
  }
  await watch.start();
  updateMetadata();
}

function syncOptions() {
  for (const name of ['beeps', 'voice', 'wakeLock', 'notify']) {
    $(`#options input[name="${name}"]`).checked = Boolean(settings[name]);
  }
}

async function onOptionChange(event) {
  const { name, checked } = event.target;
  if (name === 'notify' && checked && !(await requestNotifications())) {
    event.target.checked = false;
    return;
  }
  settings = { ...settings, [name]: checked };
  store.saveSettings(settings);
  if (name === 'wakeLock') applyWakeLock();
  if (name === 'voice' && checked) speak('Voz activada');
}

async function applyWakeLock() {
  const want = settings.wakeLock && matchVisible() && document.visibilityState === 'visible';
  if (want && !wakeLock && 'wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } catch {
      wakeLock = null;
    }
  } else if (!want && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

// ---------- History ----------

const dateFmt = new Intl.DateTimeFormat('es', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function renderHistory() {
  const matches = store.loadMatches();
  const activeId = store.getActiveId();
  $('#history-empty').hidden = matches.length > 0;
  $('#history-list').innerHTML = matches
    .map((m) => {
      const s = computeState(m.config, sidesOf(m));
      const badge = m.id === activeId ? 'En curso' : s.winner ? '' : 'Sin terminar';
      return `<li><button data-id="${esc(m.id)}">
        <span class="h-date">${esc(dateFmt.format(m.createdAt))}</span>
        <span class="h-score">${esc(scoreSummary(s))}</span>
        <span class="h-teams"><span class="${s.winner === 'a' ? 'won' : ''}">${esc(m.teams.a)}</span> vs <span class="${s.winner === 'b' ? 'won' : ''}">${esc(m.teams.b)}</span></span>
        ${badge ? `<span class="badge">${badge}</span>` : ''}
      </button></li>`;
    })
    .join('');
}

function formatDuration(ms) {
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

function renderDetail(id) {
  const m = store.getMatch(id);
  const el = $('#detail');
  if (!m) {
    el.innerHTML = '<p class="empty">Partido no encontrado.</p>';
    return;
  }
  const s = computeState(m.config, sidesOf(m));
  const cfg = normalizeConfig(m.config);
  const isActive = store.getActiveId() === m.id;
  const columns = s.sets.map((set, i) => ({ label: set.superTiebreak ? 'STB' : `Set ${i + 1}`, set }));
  if (s.current && s.applied > 0) {
    const cur = s.current;
    const live = cur.superTiebreak ? cur.points : cur.games;
    columns.push({ label: 'Actual', set: { a: live.a, b: live.b, winner: null, tiebreak: null } });
  }
  const cell = (set, side) => {
    const tb = set.tiebreak ? `<sup>${set.tiebreak[side]}</sup>` : '';
    return `<td class="${set.winner === side ? 'won' : ''}">${set[side]}${tb}</td>`;
  };
  const rows = SIDES.map(
    (side) =>
      `<tr><td class="${s.winner === side ? 'won' : ''}">${esc(m.teams[side])}${s.winner === side ? ' 🏆' : ''}</td>${columns
        .map((c) => cell(c.set, side))
        .join('')}</tr>`,
  ).join('');
  const first = m.points[0]?.t;
  const last = m.finishedAt ?? m.points.at(-1)?.t;
  const fromWatch = m.points.filter((p) => p.src === 'reloj').length;
  const count = (side, src) => m.points.filter((p) => p.s === side && (!src || p.src === src)).length;

  el.innerHTML = `
    <div class="card">
      <h2>${esc(m.teams.a)} vs ${esc(m.teams.b)}</h2>
      <div class="meta">${esc(dateFmt.format(m.createdAt))} · ${esc(formatLabel(cfg))}</div>
      <div class="meta">${s.winner ? `Ganó ${esc(m.teams[s.winner])}` : isActive ? 'En curso' : 'Sin terminar'}${
        first && last ? ` · ${formatDuration(last - first)}` : ''
      }</div>
    </div>
    <div class="card">
      ${
        columns.length
          ? `<table class="score-table"><thead><tr><th></th>${columns.map((c) => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`
          : '<p class="meta">Sin puntos todavía.</p>'
      }
    </div>
    <div class="card stats">
      <span></span><span>${esc(m.teams.a)}</span><span>${esc(m.teams.b)}</span>
      <span>Puntos ganados</span><span>${count('a')}</span><span>${count('b')}</span>
      <span>Juegos ganados</span><span>${s.gamesWon.a}</span><span>${s.gamesWon.b}</span>
      <span>Puntos desde el reloj</span><span>${count('a', 'reloj')}</span><span>${count('b', 'reloj')}</span>
    </div>
    <p class="meta">${m.points.length} puntos · ${fromWatch} anotados desde el reloj</p>
    <div class="actions">
      ${!s.winner ? `<button class="btn primary" data-action="resume">${isActive ? 'Volver al partido' : 'Continuar'}</button>` : ''}
      <button class="btn danger" data-action="delete">Eliminar</button>
    </div>`;

  el.querySelector('[data-action="resume"]')?.addEventListener('click', () => {
    store.setActiveId(m.id);
    match = null;
    location.hash = '#/partido';
  });
  el.querySelector('[data-action="delete"]').addEventListener('click', () => {
    if (!confirm('¿Eliminar este partido del historial?')) return;
    if (match?.id === m.id) {
      match = null;
      state = null;
      if (watch.enabled) watch.stop();
    }
    store.deleteMatch(m.id);
    location.hash = '#/historial';
  });
}

// ---------- Wiring ----------

function init() {
  $$('[data-nav]').forEach((btn) => btn.addEventListener('click', () => (location.hash = btn.dataset.nav)));
  $('#btn-new').addEventListener('click', () => (location.hash = '#/nuevo'));
  $('#btn-resume').addEventListener('click', () => (location.hash = '#/partido'));
  $('#btn-history').addEventListener('click', () => (location.hash = '#/historial'));
  $('#setup-form').addEventListener('submit', startMatch);
  $('#setup-form').addEventListener('change', syncFinalSetField);
  $$('.side').forEach((el) => el.addEventListener('click', () => addPoint(el.dataset.side, 'pantalla')));
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-watch').addEventListener('click', toggleWatch);
  $('#btn-options').addEventListener('click', () => {
    const opts = $('#options');
    opts.hidden = !opts.hidden;
    $('#btn-options').setAttribute('aria-expanded', String(!opts.hidden));
  });
  $('#options').addEventListener('change', onOptionChange);
  $('#btn-finish').addEventListener('click', () => {
    const msg = state?.winner
      ? '¿Cerrar el partido?'
      : '¿Terminar el partido sin ganador? Queda guardado en el historial.';
    if (confirm(msg)) closeMatch();
  });
  $('#btn-winner-undo').addEventListener('click', undo);
  $('#btn-winner-close').addEventListener('click', closeMatch);
  $('#history-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (btn) location.hash = `#/historial/${encodeURIComponent(btn.dataset.id)}`;
  });
  // Keyboard shortcuts (handy on a computer): arrows add points, Backspace undoes.
  document.addEventListener('keydown', (e) => {
    if (!matchVisible() || (e.target instanceof Element && e.target.closest('input'))) return;
    if (e.key === 'ArrowLeft') addPoint('a', 'pantalla');
    else if (e.key === 'ArrowRight') addPoint('b', 'pantalla');
    else if (e.key === 'Backspace') undo();
  });
  document.addEventListener('visibilitychange', applyWakeLock);
  window.addEventListener('hashchange', route);
  window.addEventListener('storage', (e) => {
    if (e.key !== null && !e.key.startsWith('padel.')) return;
    syncMatch();
    updateMetadata();
    route();
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // A new release was installed: reload now only if that can't interrupt a match (the watch
    // session needs a tap to restart); otherwise it applies on the next launch.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !watch.enabled && !matchVisible()) location.reload();
    });
  }
  route();
}

init();
