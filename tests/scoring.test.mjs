import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeKind, computeState, describe, formatSets, pressure } from '../web/js/scoring.js';

const rep = (side, n) => Array(n).fill(side);
const game = (side) => rep(side, 4);
const games = (...sides) => sides.flatMap(game);
const deuce = () => ['a', 'b', 'a', 'b', 'a', 'b']; // 40-40
// 6-6 in games, alternating
const toSixAll = () => Array.from({ length: 12 }, (_, i) => game(i % 2 ? 'b' : 'a')).flat();
const set = (side, gamesPerSet = 6) => rep(side, 4 * gamesPerSet);

test('points are labelled 0/15/30/40', () => {
  const cfg = {};
  const s = computeState(cfg, ['a', 'b', 'a']);
  assert.deepEqual(describe(cfg, s).a, '30');
  assert.deepEqual(describe(cfg, s).b, '15');
});

test('four straight points win a game', () => {
  const s = computeState({}, game('a'));
  assert.deepEqual(s.current.games, { a: 1, b: 0 });
  assert.deepEqual(s.current.points, { a: 0, b: 0 });
});

test('golden point: first 40-40 is decisive', () => {
  const cfg = { deuce: 'golden' };
  const d = describe(cfg, computeState(cfg, deuce()));
  assert.equal(d.status, 'golden');
  assert.equal(d.decisive, true);
  const s = computeState(cfg, [...deuce(), 'b']);
  assert.deepEqual(s.current.games, { a: 0, b: 1 });
});

test('advantage mode needs two clear points', () => {
  const cfg = { deuce: 'advantage' };
  let s = computeState(cfg, [...deuce(), 'a']);
  assert.deepEqual(describe(cfg, s), { a: 'AD', b: '40', status: 'advantage', advantage: 'a', decisive: false });
  s = computeState(cfg, [...deuce(), 'a', 'b']);
  assert.equal(describe(cfg, s).status, 'deuce');
  s = computeState(cfg, [...deuce(), 'a', 'b', 'b', 'b']);
  assert.deepEqual(s.current.games, { a: 0, b: 1 });
});

test('star point: two advantages, third deuce is decisive', () => {
  const cfg = { deuce: 'star' };
  let s = computeState(cfg, deuce());
  assert.equal(describe(cfg, s).status, 'deuce');
  s = computeState(cfg, [...deuce(), 'a', 'b']); // 2nd deuce
  assert.equal(describe(cfg, s).status, 'deuce');
  s = computeState(cfg, [...deuce(), 'a', 'b', 'a']); // advantage after 2nd deuce
  assert.equal(describe(cfg, s).status, 'advantage');
  assert.deepEqual(s.current.games, { a: 0, b: 0 });
  s = computeState(cfg, [...deuce(), 'a', 'b', 'a', 'b']); // 3rd deuce
  assert.equal(describe(cfg, s).status, 'star');
  assert.equal(describe(cfg, s).decisive, true);
  s = computeState(cfg, [...deuce(), 'a', 'b', 'a', 'b', 'b']);
  assert.deepEqual(s.current.games, { a: 0, b: 1 });
});

test('set is won 6-4 and 7-5 but not 6-5', () => {
  let s = computeState({}, [...games('a', 'b', 'a', 'b', 'a', 'b', 'a', 'b'), ...games('a', 'a')]);
  assert.equal(formatSets(s), '6-4');
  const fiveAll = games('a', 'b', 'a', 'b', 'a', 'b', 'a', 'b', 'a', 'b');
  s = computeState({}, [...fiveAll, ...game('a')]);
  assert.equal(s.sets.length, 0);
  assert.deepEqual(s.current.games, { a: 6, b: 5 });
  s = computeState({}, [...fiveAll, ...games('a', 'a')]);
  assert.equal(formatSets(s), '7-5');
});

test('tie-break at 6-6 to 7, win by two', () => {
  let s = computeState({}, toSixAll());
  assert.equal(s.current.tiebreak, true);
  assert.equal(describe({}, computeState({}, [...toSixAll(), 'a'])).status, 'tiebreak');
  s = computeState({}, [...toSixAll(), ...rep('b', 7)]);
  assert.equal(formatSets(s), '6-7(0)');
  const sixAllTb = Array.from({ length: 6 }, () => ['a', 'b']).flat();
  s = computeState({}, [...toSixAll(), ...sixAllTb, 'a']);
  assert.equal(s.sets.length, 0);
  s = computeState({}, [...toSixAll(), ...sixAllTb, 'a', 'a']);
  assert.equal(formatSets(s), '7-6(6)');
});

test('deciding set is a super tie-break to 10', () => {
  const base = [...set('a'), ...set('b')];
  let s = computeState({}, base);
  assert.equal(s.current.superTiebreak, true);
  assert.equal(describe({}, s).status, 'supertb');
  const eightAll = Array.from({ length: 8 }, () => ['a', 'b']).flat();
  s = computeState({}, [...base, ...eightAll, 'a']);
  assert.equal(s.winner, null);
  s = computeState({}, [...base, ...eightAll, 'a', 'a']);
  assert.equal(s.winner, 'a');
  assert.equal(formatSets(s), '6-0 0-6 [10-8]');
  assert.equal(s.current, null);
});

test('deciding set can be a full set', () => {
  const cfg = { finalSet: 'full' };
  const s = computeState(cfg, [...set('a'), ...set('b'), ...game('a')]);
  assert.equal(s.current.superTiebreak, false);
  assert.deepEqual(s.current.games, { a: 1, b: 0 });
});

test('best of one set', () => {
  const s = computeState({ bestOf: 1 }, set('b'));
  assert.equal(s.winner, 'b');
});

test('points after the end are ignored', () => {
  const s = computeState({ bestOf: 1 }, [...set('b'), 'a', 'a']);
  assert.equal(s.applied, 24);
  assert.deepEqual(s.pointsWon, { a: 0, b: 24 });
});

test('four-game sets use a tie-break at 4-4', () => {
  const cfg = { gamesPerSet: 4 };
  const fourAll = Array.from({ length: 8 }, (_, i) => game(i % 2 ? 'b' : 'a')).flat();
  assert.equal(computeState(cfg, fourAll).current.tiebreak, true);
  assert.equal(formatSets(computeState(cfg, set('a', 4))), '4-0');
});

test('set point and match point detection', () => {
  const cfg = { bestOf: 1 };
  const fiveLove = rep('a', 20);
  assert.equal(pressure(cfg, [...fiveLove, 'a', 'a', 'a'], 'a'), 'match');
  assert.equal(pressure(cfg, [...fiveLove, 'a', 'a', 'a'], 'b'), null);
  assert.equal(pressure({}, [...rep('a', 20), 'a', 'a', 'a'], 'a'), 'set');
});

test('change kind between states', () => {
  const s0 = computeState({}, rep('a', 3));
  assert.equal(changeKind(s0, computeState({}, rep('a', 3).concat('b'))), 'point');
  assert.equal(changeKind(s0, computeState({}, rep('a', 4))), 'game');
  const s1 = computeState({}, rep('a', 23));
  assert.equal(changeKind(s1, computeState({}, rep('a', 24))), 'set');
  const s2 = computeState({ bestOf: 1 }, rep('a', 23));
  assert.equal(changeKind(s2, computeState({ bestOf: 1 }, rep('a', 24))), 'match');
});
