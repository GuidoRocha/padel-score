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
const DEUCE_RULE = {
  golden: 'Punto de oro en 40 iguales',
  advantage: 'Con ventaja en 40 iguales',
  star: 'Star point en 40 iguales',
};
const WORDS = { 0: 'cero', 15: 'quince', 30: 'treinta', 40: 'cuarenta' };
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

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
  $('#menu').hidden = true;
  $('#btn-menu').setAttribute('aria-expanded', 'false');
  window.scrollTo(0, 0);
  applyWakeLock();
}

function route() {
  const [, path = '', id = ''] = (location.hash || '#/').match(/^#\/?([^/]*)\/?(.*)$/) ?? [];
  if (path === 'nuevo') {
    renderSetup();
    show('setup');
  } else if (path === 'partido') {
    // replace(), not a new history entry: Back from a match must not land on a stale screen.
    if (!loadActive()) return void location.replace('#/');
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
  renderWatchLegend($('#view-home [data-legend]'), m ? m.teams : settings.teams);
}

// Drawing of the watch's music screen showing which button does what.
function renderWatchLegend(el, teams) {
  el.innerHTML = `
    <div class="wl-watch" aria-hidden="true">
      <span class="wl-btn wl-a">${icon('prev')}</span>
      <span class="wl-btn wl-undo">${icon('playpause')}</span>
      <span class="wl-btn wl-b">${icon('next')}</span>
    </div>
    <div class="wl-labels">
      <span class="wl-a"><b>${esc(teams.a)}</b><small>+1 punto</small></span>
      <span class="wl-undo"><b>Deshacer</b><small>el último</small></span>
      <span class="wl-b"><b>${esc(teams.b)}</b><small>+1 punto</small></span>
    </div>`;
}

// ---------- Setup ----------

function renderSetup() {
  const form = $('#setup-form');
  // Remember the last format, but every new match starts with advantage at 40-40 (user's choice).
  const cfg = normalizeConfig({ ...settings.config, deuce: 'advantage' });
  form.teamA.value = settings.teams.a;
  form.teamB.value = settings.teams.b;
  for (const name of ['bestOf', 'gamesPerSet', 'deuce', 'finalSet']) {
    const input = form.querySelector(`input[name="${name}"][value="${cfg[name]}"]`);
    if (input) input.checked = true;
  }
  $('#rules').open = false;
  syncSetup();
}

function formConfig(form) {
  return normalizeConfig({
    bestOf: Number(form.bestOf.value),
    gamesPerSet: Number(form.gamesPerSet.value),
    deuce: form.deuce.value,
    finalSet: form.finalSet.value,
  });
}

function rulesSummary(cfg) {
  const sets = cfg.bestOf === 1 ? 'Un solo set' : 'Al mejor de 3 sets';
  const parts = [`${sets} de ${cfg.gamesPerSet} juegos`, DEUCE_RULE[cfg.deuce]];
  if (cfg.bestOf > 1) parts.push(cfg.finalSet === 'supertb' ? 'Súper tie-break si quedan 1 a 1' : 'Tercer set completo');
  return parts.join(' · ');
}

function syncSetup() {
  const form = $('#setup-form');
  $('#final-set-field').hidden = form.bestOf.value === '1';
  $('#rules-summary').textContent = rulesSummary(formConfig(form));
}

function startMatch(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const teams = { a: form.teamA.value.trim() || 'Nosotros', b: form.teamB.value.trim() || 'Ellos' };
  const config = formConfig(form);
  settings = { ...settings, teams, config };
  store.saveSettings(settings);
  match = store.newMatch(teams, config);
  store.saveMatch(match);
  store.setActiveId(match.id);
  store.requestPersistence();
  unlockAudio();
  // replace() so Back from the match goes home instead of to this form (which would start a new match).
  location.replace('#/partido');
}

// ---------- Match ----------

function formatLabel(cfg) {
  const games = cfg.gamesPerSet === 6 ? '' : ` a ${cfg.gamesPerSet}`;
  return `${cfg.bestOf === 1 ? '1 set' : 'Mejor de 3'}${games} · ${DEUCE_LABEL[cfg.deuce]}`;
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
    golden: '¡Punto de oro!',
    star: '¡Star point!',
    deuce: 'Iguales',
    advantage: `Ventaja ${match.teams[d.advantage]}`,
    tiebreak: 'Tie-break',
    supertb: 'Súper tie-break a 10',
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
    el.querySelector('[data-f="games"]').textContent =
      !state.current || state.current.superTiebreak ? '–' : state.current.games[side];
    el.querySelector('[data-f="sets"]').textContent = state.setsWon[side];
  }
  $('#status-banner').textContent = statusText(cfg, d);
  const done = formatSets(state);
  const setLabel = state.current?.superTiebreak ? 'Súper tie-break' : cfg.bestOf === 1 ? '' : `Set ${state.sets.length + 1}`;
  $('#sets-line').textContent = state.winner ? '' : [setLabel, done && `Anteriores: ${done}`].filter(Boolean).join(' · ');
  $('#btn-undo').disabled = match.points.length === 0;
  renderLastPoint();
  renderWinner();
  renderWatchStatus(watch.status);
  syncOptions();
}

function renderLastPoint() {
  const last = match.points.at(-1);
  const time = last && new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(last.t);
  $('#last-point').textContent = last
    ? `Último punto: ${match.teams[last.s]} · ${last.src === 'reloj' ? 'desde el reloj' : 'desde el celu'} · ${time}`
    : watch.status === 'on'
      ? 'Reloj listo: ahora abrí la pantalla de música en el reloj'
      : 'Tocá un lado o usá el reloj para sumar el primer punto';
}

function renderWinner() {
  $('#winner').hidden = !state.winner;
  if (!state.winner) return;
  const card = $('#winner .winner-card');
  card.classList.toggle('winner-a', state.winner === 'a');
  card.classList.toggle('winner-b', state.winner === 'b');
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
  const removed = match.points.pop();
  state = computeState(match.config, sidesOf(match));
  match.winner = state.winner;
  if (!state.winner) match.finishedAt = null;
  match.summary = formatSets(state);
  store.saveMatch(match);
  if (settings.beeps) beep('undo');
  if (settings.voice) speak(`Deshecho. ${spokenPoint()}`);
  updateMetadata();
  if (matchVisible()) {
    renderMatch();
    // Otherwise the line would show the previous point, as if nothing (or a point) had happened.
    $('#last-point').textContent = `Se borró el último punto de ${match.teams[removed.s]}`;
  }
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
  if (settings.beeps) {
    // Always the team's beep first (so it's clear who scored), then a tune if it closed a game/set.
    beep(side);
    if (kind !== 'point') setTimeout(() => beep(kind === 'game' ? 'game' : 'set'), 450);
  }
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
  if (!syncMatch()) return void location.replace('#/');
  if (!match.finishedAt) match.finishedAt = Date.now();
  store.saveMatch(match);
  store.setActiveId(null);
  const id = match.id;
  match = null;
  state = null;
  if (watch.enabled) watch.stop();
  location.replace(`#/historial/${encodeURIComponent(id)}`);
}

// ---------- Watch, options, wake lock ----------

function renderWatchStatus(status) {
  const btn = $('#btn-watch');
  btn.dataset.status = status;
  btn.innerHTML = {
    on: `${icon('check')} Reloj activo`,
    paused: `${icon('watch')} Tocá para reactivar el reloj`,
    off: `${icon('watch')} Activar reloj`,
  }[status];
  // Before the first point, the hint under the board depends on the watch state.
  if (match && matchVisible() && match.points.length === 0) renderLastPoint();
}

async function toggleWatch() {
  unlockAudio();
  if (watch.status === 'on') {
    if (confirm('¿Desactivar el reloj? Los toques del reloj van a dejar de sumar puntos.')) watch.stop();
    return;
  }
  await watch.start();
  updateMetadata();
}

const THEME_COLOR = { rosa: '#7c4ddb', negro: '#0a0c0b' }; // browser / status bar color

function applyTheme(theme) {
  const name = theme === 'negro' ? 'negro' : 'rosa';
  if (name === 'negro') document.documentElement.dataset.theme = 'negro';
  else delete document.documentElement.dataset.theme;
  $('meta[name="theme-color"]').content = THEME_COLOR[name];
  for (const input of $$('[data-theme-switch] input')) input.checked = input.value === name;
}

function onThemeChange(event) {
  settings = { ...settings, theme: event.target.value };
  store.saveSettings(settings);
  applyTheme(settings.theme);
}

function syncOptions() {
  for (const name of ['beeps', 'voice', 'wakeLock', 'notify']) {
    $(`#menu input[name="${name}"]`).checked = Boolean(settings[name]);
  }
}

async function onOptionChange(event) {
  if (event.target.closest('[data-theme-switch]')) return; // handled by onThemeChange
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
      const team = (side) => `<span class="t${side}">${esc(m.teams[side])}${s.winner === side ? ' 🏆' : ''}</span>`;
      return `<li><button data-id="${esc(m.id)}">
        <span class="h-date">${esc(dateFmt.format(m.createdAt))}</span>
        <span class="h-score">${esc(scoreSummary(s))}</span>
        <span class="h-teams">${team('a')} vs ${team('b')}</span>
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
  const columns = s.sets.map((set, i) => ({ label: set.superTiebreak ? 'Súper tie-break' : `Set ${i + 1}`, set }));
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
      `<tr class="t${side}"><td>${esc(m.teams[side])}${s.winner === side ? ' 🏆' : ''}</td>${columns
        .map((c) => cell(c.set, side))
        .join('')}</tr>`,
  ).join('');
  const first = m.points[0]?.t;
  const last = m.finishedAt ?? m.points.at(-1)?.t;
  const count = (side) => m.points.filter((p) => p.s === side).length;
  const total = m.points.length;

  el.innerHTML = `
    <div class="card">
      <h2><span class="ta">${esc(m.teams.a)}</span> vs <span class="tb">${esc(m.teams.b)}</span></h2>
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
      <span></span><span class="ta">${esc(m.teams.a)}</span><span class="tb">${esc(m.teams.b)}</span>
      <span>Puntos ganados</span><span>${count('a')}</span><span>${count('b')}</span>
      <span>Juegos ganados</span><span>${s.gamesWon.a}</span><span>${s.gamesWon.b}</span>
    </div>
    <p class="meta">${total} ${total === 1 ? 'punto jugado' : 'puntos jugados'}</p>
    <div class="actions">
      ${isActive && !s.winner ? '<button class="btn btn-primary btn-xl" data-action="resume">Volver al partido</button>' : ''}
      ${!isActive ? '<button class="btn btn-primary btn-xl" data-action="home">Listo, volver al inicio</button>' : ''}
      ${!isActive && !s.winner ? '<button class="btn btn-soft btn-lg" data-action="resume">Seguir este partido</button>' : ''}
      <button class="btn btn-danger btn-lg" data-action="delete">Borrar partido</button>
    </div>`;

  el.querySelector('[data-action="home"]')?.addEventListener('click', () => (location.hash = '#/'));
  el.querySelector('[data-action="resume"]')?.addEventListener('click', () => {
    store.setActiveId(m.id);
    match = null;
    location.hash = '#/partido';
  });
  el.querySelector('[data-action="delete"]').addEventListener('click', () => {
    if (!confirm('¿Borrar este partido para siempre? No se puede recuperar.')) return;
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
  $('#btn-new').addEventListener('click', () => {
    const id = store.getActiveId();
    const m = id && store.getMatch(id);
    const unfinished = m && m.points.length > 0 && !computeState(m.config, sidesOf(m)).winner;
    const msg = 'Hay un partido sin terminar. ¿Empezar uno nuevo? El anterior queda guardado en "Partidos anteriores".';
    if (unfinished && !confirm(msg)) return;
    location.hash = '#/nuevo';
  });
  $('#btn-resume').addEventListener('click', () => (location.hash = '#/partido'));
  $('#btn-history').addEventListener('click', () => (location.hash = '#/historial'));
  $('#setup-form').addEventListener('submit', startMatch);
  $('#setup-form').addEventListener('change', syncSetup);
  // Select the whole name on tap so it's easy to replace (setTimeout: Android places the caret after focus).
  $$('#setup-form input[name^="team"]').forEach((input) =>
    input.addEventListener('focus', () => setTimeout(() => input.select(), 0)),
  );
  // A double tap or a brush on the screen must not count twice: points share one guard, undo has its own.
  const once = (fn, ms = 800) => {
    let last = 0;
    return (...args) => {
      const now = Date.now();
      if (now - last < ms) return;
      last = now;
      fn(...args);
    };
  };
  const tapPoint = once((side) => addPoint(side, 'pantalla'));
  const tapUndo = once(undo);
  $$('.side').forEach((el) => el.addEventListener('click', () => tapPoint(el.dataset.side)));
  $('#btn-undo').addEventListener('click', tapUndo);
  $('#btn-watch').addEventListener('click', toggleWatch);
  const setMenu = (open) => {
    $('#menu').hidden = !open;
    $('#btn-menu').setAttribute('aria-expanded', String(open));
  };
  // The menu gets its own history entry so the phone's Back button closes it instead of leaving the match.
  const closeMenu = () => (history.state?.menu ? history.back() : setMenu(false));
  $('#btn-menu').addEventListener('click', () => {
    setMenu(true);
    history.pushState({ menu: true }, '');
  });
  $('#btn-menu-close').addEventListener('click', closeMenu);
  $('#menu').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeMenu(); // tap outside the sheet
  });
  window.addEventListener('popstate', () => {
    if (!history.state?.menu) setMenu(false);
  });
  $('#menu').addEventListener('change', onOptionChange);
  $$('[data-theme-switch]').forEach((el) => el.addEventListener('change', onThemeChange));
  applyTheme(settings.theme);
  $('#btn-finish').addEventListener('click', () => {
    const msg = state?.winner
      ? '¿Cerrar el partido?'
      : '¿Terminar el partido sin ganador? Queda guardado en el historial.';
    if (!confirm(msg)) return;
    setMenu(false);
    closeMatch();
  });
  $('#btn-winner-undo').addEventListener('click', tapUndo);
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
    settings = store.loadSettings();
    applyTheme(settings.theme);
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
