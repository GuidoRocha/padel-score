// Padel scoring engine. The state is always recomputed from the list of points ('a' | 'b'),
// so undo is simply dropping the last point.

// Deuce number (1st, 2nd, 3rd 40-40...) that is played as a single decisive point.
export const DEUCE_MODES = {
  advantage: Infinity, // classic advantage, no decisive point
  golden: 1, // punto de oro: first 40-40 is decisive
  star: 3, // star point (FIP 2026): two advantages, the third 40-40 is decisive
};

export const DEFAULT_CONFIG = Object.freeze({
  bestOf: 3, // 1 | 3
  gamesPerSet: 6, // 6 | 4
  deuce: 'golden', // key of DEUCE_MODES
  finalSet: 'supertb', // 'supertb' | 'full': how the deciding set is played
  tiebreakTo: 7,
  superTiebreakTo: 10,
});

const POINT_NAMES = ['0', '15', '30', '40'];

export const other = (side) => (side === 'a' ? 'b' : 'a');

export function normalizeConfig(config) {
  return { ...DEFAULT_CONFIG, ...config };
}

function setsNeeded(cfg) {
  return Math.ceil(cfg.bestOf / 2);
}

function newSet(cfg, setsWon) {
  const need = setsNeeded(cfg);
  const deciding = cfg.bestOf > 1 && setsWon.a === need - 1 && setsWon.b === need - 1;
  const superTiebreak = deciding && cfg.finalSet === 'supertb';
  return { games: { a: 0, b: 0 }, points: { a: 0, b: 0 }, tiebreak: superTiebreak, superTiebreak };
}

function finishSet(state, cfg, side) {
  const cur = state.current;
  state.sets.push({
    a: cur.superTiebreak ? cur.points.a : cur.games.a,
    b: cur.superTiebreak ? cur.points.b : cur.games.b,
    tiebreak: cur.tiebreak && !cur.superTiebreak ? { ...cur.points } : null,
    superTiebreak: cur.superTiebreak,
    winner: side,
  });
  state.setsWon[side]++;
  if (state.setsWon[side] >= setsNeeded(cfg)) {
    state.winner = side;
    state.current = null;
  } else {
    state.current = newSet(cfg, state.setsWon);
  }
}

export function computeState(config, points) {
  const cfg = normalizeConfig(config);
  const decisiveDeuce = DEUCE_MODES[cfg.deuce] ?? Infinity;
  const state = {
    sets: [],
    setsWon: { a: 0, b: 0 },
    current: null,
    winner: null,
    pointsWon: { a: 0, b: 0 },
    gamesWon: { a: 0, b: 0 },
    applied: 0,
  };
  state.current = newSet(cfg, state.setsWon);

  for (const side of points) {
    if (state.winner) break; // points after the match ended are ignored
    const opp = other(side);
    const cur = state.current;
    state.applied++;
    state.pointsWon[side]++;
    cur.points[side]++;
    const p = cur.points[side];
    const q = cur.points[opp];

    if (cur.tiebreak) {
      const target = cur.superTiebreak ? cfg.superTiebreakTo : cfg.tiebreakTo;
      if (p >= target && p - q >= 2) {
        if (!cur.superTiebreak) {
          cur.games[side]++;
          state.gamesWon[side]++;
        }
        finishSet(state, cfg, side);
      }
      continue;
    }

    // Game: 4 points and 2 clear, or winning the point played at the decisive deuce.
    const gameWon = p >= 4 && (p - q >= 2 || (p > q && q >= 2 + decisiveDeuce));
    if (!gameWon) continue;
    cur.games[side]++;
    state.gamesWon[side]++;
    cur.points = { a: 0, b: 0 };
    const g = cur.games[side];
    const h = cur.games[opp];
    if (g >= cfg.gamesPerSet && g - h >= 2) finishSet(state, cfg, side);
    else if (g === cfg.gamesPerSet && h === cfg.gamesPerSet) cur.tiebreak = true;
  }
  return state;
}

// Point labels and status for the current game.
export function describe(config, state) {
  const cfg = normalizeConfig(config);
  const cur = state.current;
  if (!cur) return { a: '', b: '', status: 'final', decisive: false };
  const { a: pa, b: pb } = cur.points;
  if (cur.tiebreak) {
    return { a: String(pa), b: String(pb), status: cur.superTiebreak ? 'supertb' : 'tiebreak', decisive: false };
  }
  if (pa >= 3 && pb >= 3) {
    if (pa === pb) {
      const deuceNumber = pa - 2;
      const decisive = deuceNumber >= (DEUCE_MODES[cfg.deuce] ?? Infinity);
      return { a: '40', b: '40', status: decisive ? cfg.deuce : 'deuce', decisive };
    }
    const leader = pa > pb ? 'a' : 'b';
    return {
      a: leader === 'a' ? 'AD' : '40',
      b: leader === 'b' ? 'AD' : '40',
      status: 'advantage',
      advantage: leader,
      decisive: false,
    };
  }
  return { a: POINT_NAMES[pa], b: POINT_NAMES[pb], status: 'normal', decisive: false };
}

// 'set' or 'match' if winning the next point would close it for that side, else null.
export function pressure(config, points, side) {
  const before = computeState(config, points);
  if (before.winner) return null;
  const after = computeState(config, [...points, side]);
  if (after.winner) return 'match';
  if (after.sets.length > before.sets.length) return 'set';
  return null;
}

// What changed between two consecutive states: 'point' | 'game' | 'set' | 'match'.
export function changeKind(prev, next) {
  if (next.winner && !prev.winner) return 'match';
  if (next.sets.length > prev.sets.length) return 'set';
  if (next.gamesWon.a + next.gamesWon.b > prev.gamesWon.a + prev.gamesWon.b) return 'game';
  return 'point';
}

export function formatSets(state) {
  return state.sets
    .map((s) => {
      if (s.superTiebreak) return `[${s.a}-${s.b}]`;
      if (s.tiebreak) return `${s.a}-${s.b}(${Math.min(s.tiebreak.a, s.tiebreak.b)})`;
      return `${s.a}-${s.b}`;
    })
    .join(' ');
}
