'use strict';
// Castle Clash — round modes and the scoring engine.
// Every mode decides how a single matchup (or team-vs-team battle) is scored.

const CASTLES = 10;

// ---------- helpers ----------
const PRIME = (() => {
  const max = 2000, s = new Array(max + 1).fill(true);
  s[0] = s[1] = false;
  for (let i = 2; i * i <= max; i++) if (s[i]) for (let j = i * i; j <= max; j += i) s[j] = false;
  return s;
})();
const isPrime = (n) => Number.isInteger(n) && n >= 0 && n < PRIME.length && PRIME[n];
const sum = (a) => a.reduce((x, y) => x + y, 0);
const r2 = (x) => Math.round(x * 100) / 100;
const baseValues = () => Array.from({ length: CASTLES }, (_, i) => i + 1);

function captures(a, b) {
  const wa = [], wb = [];
  for (let i = 0; i < CASTLES; i++) { wa.push(a[i] > b[i]); wb.push(b[i] > a[i]); }
  return [wa, wb];
}
function classic(a, b, values) {
  let sa = 0, sb = 0;
  for (let i = 0; i < CASTLES; i++) {
    if (a[i] > b[i]) sa += values[i];
    else if (b[i] > a[i]) sb += values[i];
  }
  return [sa, sb];
}
function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- modes ----------
// Each mode:
//   name, style (kind of thinking), source ('rules' | 'host' | 'claude')
//   blurb(p)            -> one-paragraph rule text for players
//   params              -> tunable parameters [{key,label,default,min,max,step}]
//   budget              -> 'exact' (must place all) | 'atMost'
//   primesOnly          -> forces prime/zero garrisons
//   hiddenValues        -> castle values unknown until reveal
//   usesHistory         -> needs previous round's allocations
//   teamLevel           -> team armies fight instead of players
//   prepare(ctx)        -> secret data drawn at round start
//   values(ctx, entries)-> castle values for the round
//   army(alloc, ctx, entry) -> effective army
//   match(A, B, ctx)    -> [scoreA, scoreB]; A/B = {alloc, army}
const MODES = {
  classic: {
    name: 'Classic', style: 'The original', source: 'rules',
    blurb: () => 'The bigger army takes the castle. Castle i is worth i points. Equal armies: nobody scores it.',
    match: (A, B, c) => classic(A.army, B.army, c.values),
  },

  blackjack: {
    name: 'Blackjack', style: 'Push your luck', source: 'host',
    params: [{ key: 'cap', label: 'Bust above', default: 21, min: 1, max: 55, step: 1 }],
    blurb: (p) => `Scored like Classic, but if you score more than ${p.cap} in a matchup you bust and get 0 for it.`,
    match: (A, B, c) => {
      let [a, b] = classic(A.army, B.army, c.values);
      if (a > c.params.cap) a = 0;
      if (b > c.params.cap) b = 0;
      return [a, b];
    },
  },

  neighbours: {
    name: 'Good Neighbours', style: 'Adjacency', source: 'host',
    blurb: () => 'A castle only scores if you also capture a castle right next to it (i−1 or i+1). Lone castles are worth nothing.',
    match: (A, B, c) => {
      const [wa, wb] = captures(A.army, B.army);
      let a = 0, b = 0;
      for (let i = 0; i < CASTLES; i++) {
        if (wa[i] && (wa[i - 1] || wa[i + 1])) a += c.values[i];
        if (wb[i] && (wb[i - 1] || wb[i + 1])) b += c.values[i];
      }
      return [a, b];
    },
  },

  doubling: {
    name: 'Family Ties', style: 'Divisibility', source: 'host',
    blurb: () => 'Castle 2i is worth double if you also capture castle i. So castle 2 doubles with 1, 4 with 2, 6 with 3, 8 with 4 and 10 with 5.',
    match: (A, B, c) => {
      const [wa, wb] = captures(A.army, B.army);
      let a = 0, b = 0;
      for (let i = 0; i < CASTLES; i++) {
        const n = i + 1, half = n % 2 === 0 ? n / 2 - 1 : -1;
        if (wa[i]) a += c.values[i] * (half >= 0 && wa[half] ? 2 : 1);
        if (wb[i]) b += c.values[i] * (half >= 0 && wb[half] ? 2 : 1);
      }
      return [a, b];
    },
  },

  primes: {
    name: 'Prime Garrisons', style: 'Number theory', source: 'host', primesOnly: true,
    blurb: () => 'Every castle must get a prime number of soldiers (2, 3, 5, 7, 11…) or none at all. Scored like Classic.',
    match: (A, B, c) => classic(A.army, B.army, c.values),
  },

  attrition: {
    name: 'Attrition March', style: 'Algorithms and sequence', source: 'claude',
    blurb: () => 'Armies march from castle 1 to 10. At each castle the bigger force wins, and its survivors (the winning margin) march on and join the next fight. The loser’s force there is wiped out.',
    match: (A, B, c) => {
      let ca = 0, cb = 0, a = 0, b = 0;
      for (let i = 0; i < CASTLES; i++) {
        const fa = A.army[i] + ca, fb = B.army[i] + cb;
        if (fa > fb) { a += c.values[i]; ca = fa - fb; cb = 0; }
        else if (fb > fa) { b += c.values[i]; cb = fb - fa; ca = 0; }
        else { ca = 0; cb = 0; }
      }
      return [a, b];
    },
  },

  beauty: {
    name: 'Beauty Contest', style: 'Reflexive game theory', source: 'claude', hiddenValues: true,
    blurb: () => 'Castle values are set by the whole room after everyone submits. The castle with the most soldiers in total is worth 1, the least defended is worth 10. Guess what everyone else thinks is popular.',
    values: (c, entries) => {
      const totals = new Array(CASTLES).fill(0);
      for (const e of entries) for (let i = 0; i < CASTLES; i++) totals[i] += e.alloc[i];
      const order = baseValues().map((_, i) => i).sort((x, y) => totals[y] - totals[x] || x - y);
      const v = new Array(CASTLES);
      order.forEach((castle, rank) => { v[castle] = rank + 1; });
      c.reveal.totals = totals;
      return v;
    },
    match: (A, B, c) => classic(A.army, B.army, c.values),
  },

  shuffled: {
    name: 'Shuffled Banners', style: 'Probability and symmetry', source: 'claude', hiddenValues: true,
    blurb: () => 'The values 1–10 are secretly shuffled across the castles and revealed only after time runs out. Every castle is equally likely to be the 10.',
    prepare: () => ({ perm: shuffle(baseValues()) }),
    values: (c) => c.secret.perm.slice(),
    match: (A, B, c) => classic(A.army, B.army, c.values),
  },

  warchest: {
    name: 'War Chest', style: 'Economics and opportunity cost', source: 'claude', budget: 'atMost',
    params: [{ key: 'rate', label: 'Points per unused soldier, per matchup', default: 0.25, min: 0, max: 5, step: 0.05 }],
    blurb: (p) => `You may send fewer than all your soldiers. Every soldier kept home earns ${p.rate} points in each matchup. Is your last soldier worth more on the field?`,
    match: (A, B, c) => {
      const [a, b] = classic(A.army, B.army, c.values);
      return [a + (c.soldiers - sum(A.alloc)) * c.params.rate, b + (c.soldiers - sum(B.alloc)) * c.params.rate];
    },
  },

  garrison: {
    name: 'Lingering Garrison', style: 'Dynamics and memory', source: 'claude', usesHistory: true,
    params: [{ key: 'keep', label: 'Share of last round’s soldiers that stay', default: 0.5, min: 0, max: 1, step: 0.05 }],
    blurb: (p) => `${Math.round(p.keep * 100)}% of the soldiers you placed on each castle last round (rounded down) are still there and fight for you, on top of this round’s army.`,
    army: (alloc, c, e) => {
      const prev = c.prev[e.playerId];
      return alloc.map((x, i) => x + (prev ? Math.floor(prev[i] * c.params.keep) : 0));
    },
    match: (A, B, c) => classic(A.army, B.army, c.values),
  },

  alliance: {
    name: 'Grand Alliance', style: 'Cooperation', source: 'claude', teamLevel: true,
    blurb: () => 'Your table fights as one. Each castle gets the average of your teammates’ soldiers, and your team army battles every other team’s. Points from each battle are multiplied by the other team’s size. Plan together.',
    match: (A, B, c) => classic(A.army, B.army, c.values),
  },

  decisive: {
    name: 'Decisive Victory', style: 'Ratios and thresholds', source: 'claude',
    params: [{ key: 'ratio', label: 'Need more than ×', default: 2, min: 1, max: 10, step: 0.5 }],
    blurb: (p) => `You only capture a castle with more than ${p.ratio} times your opponent’s soldiers there. Anything less is a stalemate and nobody scores it.`,
    match: (A, B, c) => {
      let a = 0, b = 0;
      const k = c.params.ratio;
      for (let i = 0; i < CASTLES; i++) {
        const x = A.army[i], y = B.army[i];
        if (x > k * y) a += c.values[i];
        else if (y > k * x) b += c.values[i];
      }
      return [a, b];
    },
  },

  winnerall: {
    name: 'Winner Takes All', style: 'Aggregation and risk', source: 'claude',
    blurb: () => 'Each matchup is scored like Classic, but whoever finishes ahead takes all 55 points. The loser gets nothing, and a tied matchup pays nobody. Winning margins don’t matter.',
    match: (A, B, c) => {
      const [a, b] = classic(A.army, B.army, c.values);
      const pot = sum(c.values);
      return a > b ? [pot, 0] : b > a ? [0, pot] : [0, 0];
    },
  },

  mirror: {
    name: 'Mirror Match', style: 'Geometry and linear algebra', source: 'claude',
    params: [{ key: 'angle', label: 'Void if angle below (degrees)', default: 10, min: 0, max: 90, step: 1 }],
    blurb: (p) => `Think of each army as a vector in ℝ¹⁰. If the angle between yours and your opponent’s is under ${p.angle}°, the matchup is void (0–0). Otherwise it’s scored like Classic. Don’t follow the crowd.`,
    match: (A, B, c) => {
      const a = A.army, b = B.army;
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < CASTLES; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      if (na > 0 && nb > 0) {
        const ang = Math.acos(Math.min(1, dot / Math.sqrt(na * nb))) * 180 / Math.PI;
        if (ang < c.params.angle) return [0, 0];
      }
      return classic(a, b, c.values);
    },
  },

  proportional: {
    name: 'Proportional Spoils', style: 'Calculus and optimisation', source: 'claude',
    blurb: () => 'Castles are shared, not captured. With a soldiers against b, you get value × a ÷ (a + b) of each castle. One extra soldier no longer flips a whole castle.',
    match: (A, B, c) => {
      let a = 0, b = 0;
      for (let i = 0; i < CASTLES; i++) {
        const x = A.army[i], y = B.army[i];
        if (x + y > 0) { a += c.values[i] * x / (x + y); b += c.values[i] * y / (x + y); }
      }
      return [a, b];
    },
  },
};

function modeOf(id) { return MODES[id] || MODES.classic; }
function paramsFor(round) {
  const m = modeOf(round.mode), p = {};
  for (const d of m.params || []) {
    const v = Number(round.params && round.params[d.key]);
    p[d.key] = Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v)) : d.default;
  }
  return p;
}
function roundRules(round) {
  const m = modeOf(round.mode);
  return {
    budget: m.budget || 'exact',
    primesOnly: !!(m.primesOnly || round.primesOnly),
    hiddenValues: !!m.hiddenValues,
  };
}
function blurbFor(round) {
  const m = modeOf(round.mode);
  let t = m.blurb(paramsFor(round));
  if (round.primesOnly && !m.primesOnly) t += ' Twist: every castle needs a prime number of soldiers, or none.';
  return t;
}

function validate(alloc, round, soldiers) {
  if (!Array.isArray(alloc) || alloc.length !== CASTLES) return 'Send exactly 10 numbers.';
  for (const x of alloc) if (!Number.isInteger(x) || x < 0) return 'Use whole numbers of 0 or more.';
  const r = roundRules(round), total = sum(alloc);
  if (r.budget === 'exact' && total !== soldiers) return `Place exactly ${soldiers} soldiers (you placed ${total}).`;
  if (r.budget === 'atMost' && total > soldiers) return `Place at most ${soldiers} soldiers (you placed ${total}).`;
  if (r.primesOnly) {
    const bad = alloc.findIndex((x) => x !== 0 && !isPrime(x));
    if (bad >= 0) return `Castle ${bad + 1} needs a prime number of soldiers, or 0.`;
  }
  return null;
}

// Random valid army (used by test bots).
function randomAlloc(round, soldiers, rnd = Math.random) {
  const r = roundRules(round);
  if (r.primesOnly) {
    const primes = []; for (let p = 2; p <= soldiers; p++) if (isPrime(p)) primes.push(p);
    for (let t = 0; t < 5000; t++) {
      const a = new Array(CASTLES).fill(0);
      let left = soldiers;
      const order = shuffle(baseValues().map((_, i) => i), rnd);
      for (let k = 0; k < CASTLES - 1 && left > 0; k++) {
        if (rnd() < 0.25) continue;
        const opts = primes.filter((p) => p <= Math.min(left, 40));
        if (!opts.length) break;
        const p = opts[Math.floor(rnd() * opts.length)];
        a[order[k]] = p; left -= p;
      }
      const lastIdx = order[CASTLES - 1];
      if (left === 0 || isPrime(left)) { a[lastIdx] = left; return a; }
    }
    return [0, 0, 0, 0, 0, 0, 0, 0, 3, soldiers - 3].map((x) => (isPrime(x) || x === 0 ? x : 0));
  }
  const budget = r.budget === 'atMost' ? Math.floor(soldiers * (0.6 + 0.4 * rnd())) : soldiers;
  const w = baseValues().map((v) => Math.pow(rnd(), 1.5) * (0.5 + v / 10));
  const W = sum(w);
  const a = w.map((x) => Math.floor((x / W) * budget));
  let left = budget - sum(a);
  while (left-- > 0) a[Math.floor(rnd() * CASTLES)]++;
  return a;
}

// ---------- scoring ----------
// entries: [{playerId, name, teamId, alloc}]  (only players who take part)
// teams:   [{id, name}]
function scoreRound({ round, entries, teams, soldiers, prev = {}, secret = {} }) {
  const m = modeOf(round.mode);
  const ctx = { params: paramsFor(round), soldiers, prev, secret, reveal: {}, values: baseValues() };
  if (m.values) ctx.values = m.values(ctx, entries);
  if (m.hiddenValues && secret.perm) ctx.reveal.perm = secret.perm;

  const P = entries.map((e) => ({ ...e, army: m.army ? m.army(e.alloc, ctx, e) : e.alloc.slice() }));
  const players = {};
  for (const p of P) players[p.playerId] = { name: p.name, teamId: p.teamId, alloc: p.alloc, army: p.army, score: 0, won: 0, lost: 0, drawn: 0, opponents: 0 };
  const teamScore = {};
  const best = {};
  for (const t of teams) teamScore[t.id] = 0;

  if (m.teamLevel) {
    const groups = {};
    for (const p of P) (groups[p.teamId] = groups[p.teamId] || []).push(p);
    const ids = Object.keys(groups);
    const tArmy = {};
    for (const id of ids) {
      const g = groups[id];
      tArmy[id] = Array.from({ length: CASTLES }, (_, i) => sum(g.map((p) => p.army[i])) / g.length);
    }
    const rec = {};
    for (const id of ids) rec[id] = { won: 0, lost: 0, drawn: 0, opponents: 0, score: 0 };
    for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
      const X = ids[x], Y = ids[y];
      const [sx, sy] = m.match({ alloc: tArmy[X], army: tArmy[X] }, { alloc: tArmy[Y], army: tArmy[Y] }, ctx);
      rec[X].score += sx * groups[Y].length; rec[Y].score += sy * groups[X].length;
      rec[X].opponents += groups[Y].length; rec[Y].opponents += groups[X].length;
      if (sx > sy) { rec[X].won += groups[Y].length; rec[Y].lost += groups[X].length; }
      else if (sy > sx) { rec[Y].won += groups[X].length; rec[X].lost += groups[Y].length; }
      else { rec[X].drawn += groups[Y].length; rec[Y].drawn += groups[X].length; }
    }
    for (const p of P) Object.assign(players[p.playerId], rec[p.teamId], { score: rec[p.teamId].score });
    for (const id of ids) teamScore[id] = rec[id].score;
    ctx.reveal.teamArmies = Object.fromEntries(ids.map((id) => [id, tArmy[id].map(r2)]));
  } else {
    for (let x = 0; x < P.length; x++) for (let y = x + 1; y < P.length; y++) {
      const A = P[x], B = P[y];
      if (A.teamId === B.teamId) continue;
      const [sa, sb] = m.match(A, B, ctx);
      const ra = players[A.playerId], rb = players[B.playerId];
      ra.score += sa; rb.score += sb; ra.opponents++; rb.opponents++;
      if (sa > sb) { ra.won++; rb.lost++; } else if (sb > sa) { rb.won++; ra.lost++; } else { ra.drawn++; rb.drawn++; }
    }
    // Team score = best individual score in the team.
    for (const p of P) teamScore[p.teamId] = Math.max(teamScore[p.teamId] || 0, players[p.playerId].score);
  }
  // best member per team
  for (const p of P) {
    const s = players[p.playerId].score, b = best[p.teamId];
    if (!b || s > b.score) best[p.teamId] = { playerId: p.playerId, name: p.name, score: r2(s) };
  }
  const mult = Number(round.multiplier) > 0 ? Number(round.multiplier) : 1;
  const teamScores = {};
  for (const id of Object.keys(teamScore)) teamScores[id] = r2(teamScore[id] * mult);
  for (const id of Object.keys(players)) players[id].score = r2(players[id].score);

  const avgAlloc = Array.from({ length: CASTLES }, (_, i) => (P.length ? r2(sum(P.map((p) => p.alloc[i])) / P.length) : 0));
  return {
    values: ctx.values, multiplier: mult, teamScores, best, players, avgAlloc,
    participants: P.length, reveal: ctx.reveal, params: ctx.params,
  };
}

function catalog() {
  return Object.entries(MODES).map(([id, m]) => ({
    id, name: m.name, style: m.style, source: m.source,
    params: m.params || [], budget: m.budget || 'exact', primesOnly: !!m.primesOnly,
    hiddenValues: !!m.hiddenValues, usesHistory: !!m.usesHistory, teamLevel: !!m.teamLevel,
    blurb: m.blurb(Object.fromEntries((m.params || []).map((d) => [d.key, d.default]))),
  }));
}

module.exports = { MODES, CASTLES, modeOf, paramsFor, roundRules, blurbFor, validate, randomAlloc, scoreRound, catalog, isPrime, classic };
