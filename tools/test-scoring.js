'use strict';
// Run: node tools/test-scoring.js
const assert = require('assert');
const M = require('../src/modes');

const A = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
const B = [11, 11, 11, 11, 11, 11, 11, 11, 11, 1];
const teams = [{ id: 't1', name: 'One' }, { id: 't2', name: 'Two' }, { id: 't3', name: 'Three' }];
const run = (mode, entries, extra = {}) => M.scoreRound({ round: { mode, params: extra.params || {}, multiplier: extra.mult || 1, primesOnly: extra.primesOnly }, entries, teams, soldiers: 100, prev: extra.prev || {}, secret: extra.secret || {} });
const pair = (a, b) => [{ playerId: 'a', name: 'A', teamId: 't1', alloc: a }, { playerId: 'b', name: 'B', teamId: 't2', alloc: b }];
let n = 0; const ok = (name, f) => { f(); n++; console.log('  ✓', name); };

ok('rules.md example: B wins 45–10', () => {
  const r = run('classic', pair(A, B));
  assert.strictEqual(r.players.a.score, 10); assert.strictEqual(r.players.b.score, 45);
  assert.strictEqual(r.teamScores.t1, 10); assert.strictEqual(r.teamScores.t2, 45);
});
ok('teammates do not play each other; team score is best member', () => {
  const e = [
    { playerId: 'a1', name: 'a1', teamId: 't1', alloc: A }, { playerId: 'a2', name: 'a2', teamId: 't1', alloc: B },
    { playerId: 'c', name: 'c', teamId: 't2', alloc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 100] },
  ];
  const r = run('classic', e);
  // a1 vs c: a1 wins 1..9 = 45; a2 vs c: 45. c wins castle 10 against each of them: 10, 10 -> average 10
  assert.strictEqual(r.players.a1.score, 45); assert.strictEqual(r.players.a2.score, 45);
  assert.strictEqual(r.players.c.score, 10); assert.strictEqual(r.players.a1.opponents, 1);
  assert.strictEqual(r.teamScores.t1, 45); assert.strictEqual(r.teamScores.t3, 0);
});
ok('round score is the average over all opponents', () => {
  const e = [
    { playerId: 'a', name: 'A', teamId: 't1', alloc: B },
    { playerId: 'b', name: 'B', teamId: 't2', alloc: A }, { playerId: 'c', name: 'C', teamId: 't3', alloc: B },
  ];
  const r = run('classic', e); // a vs b: 45, a vs c: tie 0 -> average 22.5
  assert.strictEqual(r.players.a.score, 22.5); assert.strictEqual(r.players.a.opponents, 2);
});
ok('ties score nobody', () => { const r = run('classic', pair(A, A)); assert.strictEqual(r.players.a.score, 0); assert.strictEqual(r.players.a.drawn, 1); });
ok('multiplier', () => { const r = run('classic', pair(A, B), { mult: 2 }); assert.strictEqual(r.teamScores.t2, 90); });
ok('blackjack busts above 21', () => { const r = run('blackjack', pair(A, B)); assert.strictEqual(r.players.b.score, 0); assert.strictEqual(r.players.a.score, 10); });
ok('blackjack: a bust zeroes only that matchup, the round score is the average', () => {
  const zeros = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const e = [
    { playerId: 'a', name: 'A', teamId: 't1', alloc: A },
    { playerId: 'b', name: 'B', teamId: 't2', alloc: zeros }, { playerId: 'c', name: 'C', teamId: 't3', alloc: B },
  ];
  const r = run('blackjack', e);
  // a vs zeros: 55 -> bust 0. a vs B: 10. Average 5. Never above the limit.
  assert.strictEqual(r.players.a.score, 5);
  assert.strictEqual(run('blackjack', e, { params: { cap: 55 } }).players.a.score, 32.5);
  for (const pl of Object.values(r.players)) assert.ok(pl.score <= 21);
});
ok('neighbours: lone castle 10 scores 0', () => { const r = run('neighbours', pair(A, B)); assert.strictEqual(r.players.a.score, 0); assert.strictEqual(r.players.b.score, 45); });
ok('doubling: B gets 2,4,6,8 doubled', () => { const r = run('doubling', pair(A, B)); assert.strictEqual(r.players.b.score, 45 + 2 + 4 + 6 + 8); assert.strictEqual(r.players.a.score, 10); });
ok('primes validation', () => {
  const rd = { mode: 'primes' };
  assert.ok(M.validate(A, rd, 100)); // 10 not prime
  assert.strictEqual(M.validate([97, 3, 0, 0, 0, 0, 0, 0, 0, 0], rd, 100), null);
  assert.ok(M.validate([1, 99, 0, 0, 0, 0, 0, 0, 0, 0], rd, 100));
  assert.ok(M.validate(A, { mode: 'blackjack', primesOnly: true }, 100));
  for (let i = 0; i < 200; i++) assert.strictEqual(M.validate(M.randomAlloc(rd, 100), rd, 100), null);
});
ok('budget validation', () => {
  assert.ok(M.validate([10, 10, 10, 10, 10, 10, 10, 10, 10, 9], { mode: 'classic' }, 100));
  assert.strictEqual(M.validate([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { mode: 'warchest' }, 100), null);
  assert.ok(M.validate([0, 0, 0, 0, 0, 0, 0, 0, 0, 101], { mode: 'warchest' }, 100));
  for (const id of Object.keys(M.MODES)) for (let i = 0; i < 50; i++) { const rd = { mode: id }; assert.strictEqual(M.validate(M.randomAlloc(rd, 100), rd, 100), null, id); }
});
ok('attrition carries survivors', () => {
  // A: 30 on castle 1 vs B: 0 -> A carries 30 through empty castles while B stacks 100 on 10
  const a = [30, 0, 0, 0, 0, 0, 0, 0, 0, 70], b = [0, 0, 0, 0, 0, 0, 0, 0, 0, 100];
  const r = run('attrition', pair(a, b));
  // A wins castles 1..9 (carry 30), castle 10: 70+30=100 vs 100 tie
  assert.strictEqual(r.players.a.score, 45); assert.strictEqual(r.players.b.score, 0);
});
ok('beauty contest values by popularity', () => {
  const a = [0, 0, 0, 0, 0, 0, 0, 0, 0, 100], b = [0, 0, 0, 0, 0, 0, 0, 0, 50, 50];
  const r = run('beauty', pair(a, b));
  assert.strictEqual(r.values[9], 1); assert.strictEqual(r.values[8], 2); assert.strictEqual(r.values[0], 3); assert.strictEqual(r.values[7], 10);
  assert.strictEqual(r.players.a.score, 1); assert.strictEqual(r.players.b.score, 2);
});
ok('shuffled uses secret permutation', () => {
  const perm = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const r = run('shuffled', pair(A, B), { secret: { perm } });
  assert.strictEqual(r.players.a.score, 1); assert.strictEqual(r.players.b.score, 54);
});
ok('war chest pays for unused soldiers', () => {
  const a = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], b = [0, 0, 0, 0, 0, 0, 0, 0, 0, 60];
  const r = run('warchest', pair(a, b));
  assert.strictEqual(r.players.a.score, 25); assert.strictEqual(r.players.b.score, 20);
});
ok('garrison adds half of last round', () => {
  const prev = { a: [0, 0, 0, 0, 0, 0, 0, 0, 0, 21] };
  const r = run('garrison', pair(A, B), { prev });
  assert.deepStrictEqual(r.players.a.army.slice(-1), [20]);
  assert.strictEqual(r.players.a.score, 10);
  const r2 = run('garrison', pair([10, 10, 10, 10, 10, 10, 10, 10, 10, 10], [11, 11, 11, 11, 11, 11, 11, 11, 11, 1]), { prev: { a: [4, 4, 4, 4, 4, 4, 4, 4, 4, 64] } });
  assert.strictEqual(r2.players.a.score, 55);
});
ok('alliance averages over every opposing player', () => {
  const e = [
    { playerId: 'a1', name: 'a1', teamId: 't1', alloc: A }, { playerId: 'a2', name: 'a2', teamId: 't1', alloc: A },
    { playerId: 'b1', name: 'b1', teamId: 't2', alloc: B }, { playerId: 'b2', name: 'b2', teamId: 't2', alloc: B }, { playerId: 'b3', name: 'b3', teamId: 't2', alloc: B },
  ];
  const r = run('alliance', e);
  assert.strictEqual(r.teamScores.t1, 10); assert.strictEqual(r.teamScores.t2, 45);
  assert.strictEqual(r.players.b2.score, 45);
});
ok('decisive needs more than double', () => {
  const a = [20, 21, 0, 0, 0, 0, 0, 0, 0, 59], b = [10, 10, 0, 0, 0, 0, 0, 0, 0, 80];
  const r = run('decisive', pair(a, b));
  assert.strictEqual(r.players.a.score, 2); assert.strictEqual(r.players.b.score, 0);
});
ok('winner takes all', () => { const r = run('winnerall', pair(A, B)); assert.strictEqual(r.players.b.score, 55); assert.strictEqual(r.players.a.score, 0); });
ok('catalog has 13 modes with blurbs', () => { const c = M.catalog(); assert.strictEqual(c.length, 13); c.forEach((m) => assert.ok(m.blurb.length > 20)); });
ok('every mode has a worked example', () => { for (const m of M.catalog()) assert.ok(m.example.length > 40, m.id); });
console.log(`\n${n} scoring tests passed.`);
