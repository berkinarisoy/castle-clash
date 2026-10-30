'use strict';
// Castle Strategy — game server. Zero dependencies: needs only Node.js 18+.
//   node server.js            (PORT=3000 by default, ADMIN_PASSWORD optional)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const M = require('./src/modes');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const PRESETS = path.join(DATA, 'presets');
const STATE_FILE = path.join(DATA, 'state.json');
const PUBLIC = path.join(ROOT, 'public');
fs.mkdirSync(PRESETS, { recursive: true });

// ---------- admin password ----------
const PW_FILE = path.join(DATA, 'admin-password.txt');
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  try { ADMIN_PASSWORD = fs.readFileSync(PW_FILE, 'utf8').trim(); } catch { /* none yet */ }
  if (!ADMIN_PASSWORD) {
    ADMIN_PASSWORD = String(crypto.randomInt(100000, 999999));
    fs.writeFileSync(PW_FILE, ADMIN_PASSWORD + '\n');
  }
}

// ---------- state ----------
// Catan-inspired: player pieces first, then the resource tiles.
const TEAM_COLORS = ['#C62E25', '#1F5FA8', '#E07B1A', '#3E7A34', '#6D4C2F', '#D9A21B', '#7FA843', '#2A8C9C', '#56606E', '#7B4A7A', '#A0522D', '#22395E'];
const uid = (n = 8) => crypto.randomBytes(n).toString('base64url').slice(0, n);
const now = () => Date.now();

const DEFAULT_ROUNDS = [
  { mode: 'classic', title: 'Warm-up', duration: 120 },
  { mode: 'blackjack', title: '', duration: 120 },
  { mode: 'beauty', title: '', duration: 150 },
  { mode: 'attrition', title: '', duration: 150 },
  { mode: 'alliance', title: 'Final: one table, one army', duration: 240, multiplier: 2 },
];
function normRound(r = {}, keepId = true) {
  const mode = M.MODES[r.mode] ? r.mode : 'classic';
  return {
    id: keepId && r.id ? String(r.id) : uid(),
    mode,
    title: String(r.title || '').slice(0, 60),
    duration: Math.max(10, Math.min(3600, Math.round(Number(r.duration) || 120))),
    multiplier: Math.max(0, Math.min(100, Number(r.multiplier) || 1)),
    primesOnly: !!r.primesOnly,
    params: M.paramsFor({ mode, params: r.params || {} }),
  };
}
function defaultSettings() {
  return {
    title: 'Castle Strategy', soldiers: 100, autoReveal: true, nonSubmit: 'exclude',
    allowJoin: true, showTeammates: true, publicUrl: '', briefingSeconds: 30,
  };
}
// The 3-digit room code players type when joining. Shown only on the board (via the admin
// key) and the admin page, and replaced on every reset so old links stop working.
function newRoomCode(old) {
  for (;;) { const c = String(crypto.randomInt(100, 1000)); if (c !== old) return c; }
}
function rotateRoomCode() { S.roomCode = newRoomCode(S.roomCode); S.roomVersion = (S.roomVersion || 0) + 1; }
function freshState() {
  return {
    roomCode: newRoomCode(), roomVersion: 1,
    settings: defaultSettings(),
    teams: [],
    players: [],
    rounds: DEFAULT_ROUNDS.map((r) => normRound(r, false)),
    current: { index: -1, roundId: null, status: 'lobby', endsAt: null, remainingMs: null, startedAt: null },
    history: [],       // round ids, in the order they were played
    submissions: {},   // roundId -> playerId -> {alloc, at}
    secrets: {},       // roundId -> secret data
    results: {},       // roundId -> scored result (+ revealed flag)
  };
}
let S;
try { S = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); S = { ...freshState(), ...S, settings: { ...defaultSettings(), ...S.settings } }; if (S.settings.title === 'Castle Clash') S.settings.title = 'Castle Strategy'; }
catch { S = freshState(); }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(S));
    fs.renameSync(tmp, STATE_FILE);
  }, 150);
}
function changed() { save(); broadcastSoon(); }

// ---------- helpers ----------
const team = (id) => S.teams.find((t) => t.id === id);
const player = (id) => S.players.find((p) => p.id === id);
const byToken = (tok) => tok && S.players.find((p) => p.token === tok);
const curRound = () => S.rounds.find((r) => r.id === S.current.roundId) || null;
const isOpen = () => S.current.status === 'active' || S.current.status === 'paused';
// A round is "in progress" from the moment it is announced (rules showing) until it is scored.
const isBriefing = () => S.current.status === 'briefing';
const inRound = () => isOpen() || isBriefing();
function newCode() {
  const used = new Set(S.teams.map((t) => t.code));
  for (;;) { const c = String(crypto.randomInt(1000, 10000)); if (!used.has(c)) return c; }
}
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) {
    if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  }
  return out;
}
// Where players should go. First match wins: the address typed in Settings, a running
// Cloudflare tunnel, the host's own public address (Render sets RENDER_EXTERNAL_URL),
// the public address the admin opened the dashboard with, then this laptop's Wi-Fi address.
let tunnelUrl = '';
let adminSeenUrl = '';
const isLocalHost = (h) => !h || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(h) || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(h);
function noteAdminHost(req) {
  const h = String(req.headers.host || '');
  if (isLocalHost(h)) return;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const u = `${proto}://${h}`;
  if (u !== adminSeenUrl) { adminSeenUrl = u; broadcastSoon(); }
}
const trimUrl = (u) => String(u || '').trim().replace(/\/$/, '');
function joinUrl() {
  return trimUrl(S.settings.publicUrl) || tunnelUrl || trimUrl(process.env.PUBLIC_URL) || trimUrl(process.env.RENDER_EXTERNAL_URL)
    || adminSeenUrl || lanUrls()[0] || `http://localhost:${PORT}`;
}
function remainingMs() {
  if (S.current.status === 'active') return Math.max(0, S.current.endsAt - now());
  if (S.current.status === 'paused') return S.current.remainingMs;
  if (S.current.status === 'briefing') return Math.max(0, S.current.briefingEndsAt - now());
  return 0;
}
function displayTitle(r, i) {
  const m = M.modeOf(r.mode);
  return r.title || m.name;
}

// ---------- round lifecycle ----------
let roundTimer = null;
function schedule() {
  clearTimeout(roundTimer);
  const wait = (t) => Math.max(0, Math.min(t - now(), 2 ** 31 - 1));
  if (S.current.status === 'active') {
    roundTimer = setTimeout(() => { if (S.current.status === 'active' && now() >= S.current.endsAt - 5) closeRound(); else schedule(); }, wait(S.current.endsAt));
  } else if (S.current.status === 'briefing') {
    roundTimer = setTimeout(() => { if (S.current.status === 'briefing' && now() >= S.current.briefingEndsAt - 5) beginRound(); else schedule(); }, wait(S.current.briefingEndsAt));
  }
}
// Announces a round: players see its rules for `briefingSeconds`, then it starts by itself
// (or sooner when the host presses Start now). Pass {briefing: false} to start straight away.
function startRound(index, { briefing = true } = {}) {
  if (inRound()) throw new Error('A round is already running.');
  if (S.current.status === 'closed') reveal();
  const r = S.rounds[index];
  if (!r) throw new Error('No such round.');
  if (S.results[r.id]) throw new Error('That round has already been played. Discard its results first to replay it.');
  const mode = M.modeOf(r.mode);
  S.submissions[r.id] = {};
  S.secrets[r.id] = mode.prepare ? mode.prepare() : {};
  const secs = Math.max(0, Number(S.settings.briefingSeconds) || 0);
  S.current = { index, roundId: r.id, status: 'briefing', startedAt: null, endsAt: null, briefingEndsAt: now() + secs * 1000, remainingMs: null };
  if (!briefing || secs === 0) return beginRound();
  schedule(); changed();
}
function beginRound() {
  const r = curRound();
  if (!r || !isBriefing()) throw new Error('No round is waiting to start.');
  S.current = { index: S.current.index, roundId: r.id, status: 'active', startedAt: now(), endsAt: now() + r.duration * 1000, briefingEndsAt: null, remainingMs: null };
  // test bots submit right away
  for (const p of S.players) if (p.bot) S.submissions[r.id][p.id] = { alloc: M.randomAlloc(r, S.settings.soldiers), at: now() };
  schedule(); changed();
}
function nextUnplayed() { return S.rounds.findIndex((r) => !S.results[r.id]); }

function prevAllocsFor(roundId) {
  const before = S.history.filter((id) => id !== roundId);
  const last = before[before.length - 1];
  const out = {};
  if (last && S.submissions[last]) for (const [pid, s] of Object.entries(S.submissions[last])) out[pid] = s.alloc;
  return out;
}
function entriesFor(r) {
  const subs = S.submissions[r.id] || {};
  const entries = [];
  for (const p of S.players) {
    const s = subs[p.id];
    if (s) entries.push({ playerId: p.id, name: p.name, teamId: p.teamId, alloc: s.alloc });
    else if (S.settings.nonSubmit === 'zero' && team(p.teamId)) entries.push({ playerId: p.id, name: p.name, teamId: p.teamId, alloc: new Array(M.CASTLES).fill(0), missed: true });
  }
  return entries.filter((e) => team(e.teamId));
}
function closeRound() {
  const r = curRound();
  if (!r) return;
  clearTimeout(roundTimer);
  const entries = entriesFor(r), prev = prevAllocsFor(r.id), secret = S.secrets[r.id] || {};
  const res = M.scoreRound({ round: r, entries, teams: S.teams, soldiers: S.settings.soldiers, prev, secret });
  const hindsight = M.hindsight({ round: r, entries, soldiers: S.settings.soldiers, prev, secret, values: res.values });
  S.results[r.id] = {
    ...res, roundId: r.id, title: displayTitle(r), mode: r.mode, modeName: M.modeOf(r.mode).name,
    blurb: M.blurbFor(r), tip: M.tipFor(r), zh: M.zhFor(r), hindsight, playedAt: now(), revealed: false,
    teamNames: Object.fromEntries(S.teams.map((t) => [t.id, { name: t.name, color: t.color }])),
  };
  if (!S.history.includes(r.id)) S.history.push(r.id);
  S.current.status = 'closed'; S.current.endsAt = null; S.current.remainingMs = null;
  if (S.settings.autoReveal) reveal();
  changed();
}
function reveal() {
  const r = curRound();
  if (r && S.results[r.id]) S.results[r.id].revealed = true;
  if (S.current.status === 'closed') S.current.status = 'revealed';
  changed();
}

// ---------- views ----------
function roundPublic(r, index) {
  if (!r) return null;
  const rules = M.roundRules(r), m = M.modeOf(r.mode);
  return {
    id: r.id, index, number: index + 1, title: displayTitle(r), modeName: m.name, mode: r.mode, style: m.style,
    blurb: M.blurbFor(r), example: M.exampleFor(r), picture: M.pictureFor(r), zh: M.zhFor(r), duration: r.duration, multiplier: r.multiplier, params: M.paramsFor(r),
    budget: rules.budget, primesOnly: rules.primesOnly, hiddenValues: rules.hiddenValues,
    teamLevel: !!m.teamLevel, usesHistory: !!m.usesHistory,
  };
}
function rankRows(rows, key) {
  rows.sort((a, b) => b[key] - a[key]);
  rows.forEach((row, i) => { row.rank = i > 0 && rows[i - 1][key] === row[key] ? rows[i - 1].rank : i + 1; });
  return rows;
}
function leaderboard(includeHidden = false) {
  if (lbCache && lbCache[includeHidden]) return lbCache[includeHidden];
  const out = computeLeaderboard(includeHidden);
  if (lbCache) lbCache[includeHidden] = out;
  return out;
}
function computeLeaderboard(includeHidden) {
  const played = S.history.map((id) => S.results[id]).filter((r) => r && (r.revealed || includeHidden));
  const r2 = (x) => Math.round(x * 100) / 100;
  const rounds = played.map((res, k) => {
    const members = {};
    for (const [pid, p] of Object.entries(res.players)) {
      (members[p.teamId] = members[p.teamId] || []).push({ playerId: pid, name: p.name, score: p.score, won: p.won, lost: p.lost, drawn: p.drawn, opponents: p.opponents, alloc: p.alloc, army: p.army });
    }
    for (const list of Object.values(members)) list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const teamArmies = (res.reveal && res.reveal.teamArmies) || {};
    const teamsRows = rankRows(S.teams.map((t) => ({
      teamId: t.id, name: t.name, color: t.color, score: res.teamScores[t.id] || 0, best: res.best[t.id] || null,
      members: members[t.id] || [], teamArmy: teamArmies[t.id] || null,
    })), 'score');
    const top = rankRows(Object.entries(res.players).map(([pid, p]) => ({ playerId: pid, name: p.name, teamId: p.teamId, score: p.score })), 'score').slice(0, 5);
    const topScore = Math.max(0, ...Object.values(res.players).map((p) => p.score));
    return {
      roundId: res.roundId, n: k + 1, title: res.title, modeName: res.modeName, mode: res.mode, blurb: res.blurb,
      multiplier: res.multiplier, values: res.values, avgAlloc: res.avgAlloc, participants: res.participants,
      reveal: { perm: res.reveal && res.reveal.perm, totals: res.reveal && res.reveal.totals }, teams: teamsRows, top, topScore, revealed: res.revealed,
      tip: res.tip || M.tipFor({ mode: res.mode, params: res.params }), hindsight: res.hindsight || null,
      zh: res.zh || M.zhFor({ mode: res.mode, params: res.params }),
    };
  });
  const overall = rankRows(S.teams.map((t) => {
    const per = played.map((res) => res.teamScores[t.id] || 0);
    // every player who played for this team in a shown round, plus current members
    const map = new Map();
    played.forEach((res, k) => {
      for (const [pid, p] of Object.entries(res.players)) {
        if (p.teamId !== t.id) continue;
        if (!map.has(pid)) map.set(pid, { playerId: pid, name: p.name, perRound: new Array(played.length).fill(null) });
        const m = map.get(pid); m.perRound[k] = p.score; m.name = p.name;
      }
    });
    for (const p of S.players) if (p.teamId === t.id && !map.has(p.id)) map.set(p.id, { playerId: p.id, name: p.name, perRound: new Array(played.length).fill(null) });
    for (const p of S.players) if (map.has(p.id)) map.get(p.id).name = p.name;
    const members = [...map.values()].map((m) => ({ ...m, total: r2(m.perRound.reduce((a, b) => a + (b || 0), 0)) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { teamId: t.id, name: t.name, color: t.color, total: r2(per.reduce((a, b) => a + b, 0)), perRound: per, players: S.players.filter((p) => p.teamId === t.id).length, members };
  }), 'total');
  return { rounds, overall, topScores: rounds.map((r) => r.topScore) };
}
function submissionStatus() {
  const r = curRound();
  const subs = (r && S.submissions[r.id]) || {};
  const out = {};
  for (const t of S.teams) {
    const ps = S.players.filter((p) => p.teamId === t.id);
    out[t.id] = { total: ps.length, done: ps.filter((p) => subs[p.id]).length };
  }
  return out;
}
function publicView() {
  const r = curRound();
  const nu = nextUnplayed();
  return {
    now: now(), title: S.settings.title, soldiers: S.settings.soldiers, joinUrl: joinUrl(),
    status: S.current.status, remainingMs: remainingMs(), endsAt: S.current.status === 'active' ? S.current.endsAt : null,
    briefingEndsAt: S.current.status === 'briefing' ? S.current.briefingEndsAt : null,
    roomVersion: S.roomVersion, // tells the board to fetch a new room code; the code itself stays private
    round: roundPublic(r, S.current.index), basicPicture: M.pictureFor({ mode: 'classic' }), playedCount: S.history.length, totalRounds: S.rounds.length,
    finished: nu === -1 && S.current.status === 'revealed', fresh: isFresh(),
    teams: S.teams.map((t) => ({ id: t.id, name: t.name, color: t.color, players: S.players.filter((p) => p.teamId === t.id).map((p) => p.name) })),
    submissions: submissionStatus(),
    board: leaderboard(false),
  };
}
function playerView(p) {
  const v = publicView();
  if (!p) return { ...v, me: null };
  const t = team(p.teamId);
  const r = curRound();
  const subs = (r && S.submissions[r.id]) || {};
  v.me = { id: p.id, name: p.name, teamId: p.teamId, teamName: t ? t.name : '?', color: t ? t.color : '#555' };
  v.mySubmission = subs[p.id] ? subs[p.id].alloc : null;
  v.teammates = S.players.filter((q) => q.teamId === p.teamId && q.id !== p.id).map((q) => ({
    name: q.name, submitted: !!subs[q.id], alloc: S.settings.showTeammates && subs[q.id] ? subs[q.id].alloc : null,
  }));
  v.garrison = null;
  if (r && inRound() && M.modeOf(r.mode).usesHistory) {
    const prev = prevAllocsFor(r.id)[p.id];
    const keep = M.paramsFor(r).keep;
    v.garrison = prev ? prev.map((x) => Math.floor(x * keep)) : new Array(M.CASTLES).fill(0);
  }
  v.myResults = S.history.map((id) => S.results[id]).filter((res) => res && res.revealed).map((res) => {
    const me = res.players[p.id];
    return {
      roundId: res.roundId, title: res.title, teamScore: res.teamScores[p.teamId] || 0,
      best: res.best[p.teamId] || null,
      me: me ? { score: me.score, won: me.won, lost: me.lost, drawn: me.drawn, opponents: me.opponents, alloc: me.alloc, army: me.army } : null,
    };
  });
  return v;
}
function presetList() {
  return fs.readdirSync(PRESETS).filter((f) => f.endsWith('.json')).map((f) => {
    try { const j = JSON.parse(fs.readFileSync(path.join(PRESETS, f), 'utf8')); return { file: f.slice(0, -5), name: j.name || f, savedAt: j.savedAt, rounds: (j.rounds || []).length, teams: (j.teams || []).length }; }
    catch { return null; }
  }).filter(Boolean).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}
function adminView() {
  const v = publicView();
  v.board = leaderboard(true);
  v.adminTeams = S.teams.map((t) => ({ ...t, players: S.players.filter((p) => p.teamId === t.id).map((p) => ({ id: p.id, name: p.name, bot: !!p.bot, joinedAt: p.joinedAt })) }));
  v.rounds = S.rounds.map((r, i) => ({ ...r, played: !!S.results[r.id], playOrder: S.history.indexOf(r.id) + 1 || null, displayTitle: displayTitle(r), current: S.current.roundId === r.id }));
  v.settings = S.settings;
  v.roomCode = S.roomCode;
  v.modes = M.catalog();
  v.presets = presetList();
  v.lanUrls = lanUrls();
  v.nextUnplayed = nextUnplayed();
  v.traffic = { ...traffic };
  const r = curRound();
  v.submittedIds = r && isOpen() ? Object.keys(S.submissions[r.id] || {}) : [];
  if (r && S.current.status === 'closed') v.pendingResult = S.results[r.id] ? leaderboard(true).rounds.find((x) => x.roundId === r.id) : null;
  return v;
}

// ---------- live updates (Server-Sent Events) ----------
// Kept small for tunnels with data caps (ngrok free: 1 GB/month): updates are batched to at
// most ~2 per second, streams are gzip-compressed, and the standings (the biggest part) are
// only re-sent to a phone when they actually changed.
const clients = new Set();
const traffic = { bytes: 0, requests: 0, since: Date.now() };
let bTimer = null, lastBroadcast = 0, lbCache = null;
function broadcastSoon() { if (!bTimer) bTimer = setTimeout(broadcast, Math.max(60, 500 - (now() - lastBroadcast))); }
function viewFor(c) { return c.role === 'admin' ? adminView() : c.role === 'player' ? playerView(byToken(c.token)) : publicView(); }
function sendState(c, v, cache) {
  const key = c.role === 'admin' ? 'admin' : 'public';
  if (!cache[key]) { const str = JSON.stringify(v.board); cache[key] = { str, hash: crypto.createHash('sha1').update(str).digest('hex') }; }
  delete v.board;
  let data = JSON.stringify(v);
  if (c.boardHash !== cache[key].hash) { data = data.slice(0, -1) + ',"board":' + cache[key].str + '}'; c.boardHash = cache[key].hash; }
  c.write(`event: state\ndata: ${data}\n\n`);
}
function broadcast() {
  bTimer = null; lastBroadcast = now();
  lbCache = {};
  const cache = {};
  try { for (const c of clients) sendState(c, viewFor(c), cache); } finally { lbCache = null; }
}
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20000);
const acceptsGzip = (req) => /\bgzip\b/.test((req && req.headers['accept-encoding']) || '');

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function send(res, code, obj) {
  let body = Buffer.from(JSON.stringify(obj));
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' };
  if (body.length > 1024 && acceptsGzip(res.req)) { body = zlib.gzipSync(body); headers['Content-Encoding'] = 'gzip'; }
  traffic.bytes += body.length;
  res.writeHead(code, headers);
  res.end(body);
}
const fileCache = new Map(); // path -> {mtime, raw, gz}
// Pages link scripts and styles as /static/x.js?v=BOOT, so phones fetch fresh copies after a
// restart instead of running cached code against a newer server.
const BOOT = Date.now().toString(36);
function serveFile(res, file, cacheSeconds = 0) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    let entry = fileCache.get(file);
    if (!entry || entry.mtime !== st.mtimeMs) {
      let raw = fs.readFileSync(file);
      if (file.endsWith('.html')) raw = Buffer.from(raw.toString().replace(/(["'])(\/static\/[\w./-]+\.(?:js|css))\1/g, `$1$2?v=${BOOT}$1`));
      entry = { mtime: st.mtimeMs, raw, gz: /\.(html|js|css|svg|json)$/.test(file) ? zlib.gzipSync(raw) : null };
      fileCache.set(file, entry);
    }
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-cache', Vary: 'Accept-Encoding' };
    let body = entry.raw;
    if (entry.gz && acceptsGzip(res.req)) { body = entry.gz; headers['Content-Encoding'] = 'gzip'; }
    traffic.bytes += body.length;
    res.writeHead(200, headers);
    res.end(body);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 2e6) { reject(new Error('Too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('Bad JSON')); } });
  });
}
const failedJoins = new Map(); // ip -> [timestamps]
function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || '').trim() || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}
let globalFails = []; // wrong codes from everyone, to slow down guessing through proxies
function isAdmin(req, url) {
  const key = req.headers['x-admin-key'] || url.searchParams.get('key');
  return key && key === ADMIN_PASSWORD;
}
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 24);

// ---------- admin actions ----------
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'preset'; }
function buildPreset(name, includeTeams) {
  return {
    name: String(name || 'Untitled').slice(0, 60), savedAt: now(), app: 'castle-clash', version: 1,
    settings: S.settings,
    rounds: S.rounds.map(({ mode, title, duration, multiplier, primesOnly, params }) => ({ mode, title, duration, multiplier, primesOnly, params })),
    teams: includeTeams ? S.teams.map(({ name, code, color }) => ({ name, code, color })) : [],
  };
}
function applyPreset(p, includeTeams) {
  if (!p || !Array.isArray(p.rounds)) throw new Error('That file is not a Castle Strategy config.');
  if (inRound()) throw new Error('Finish or cancel the running round first.');
  const keepPlayed = S.rounds.filter((r) => S.results[r.id]);
  S.rounds = [...keepPlayed, ...p.rounds.map((r) => normRound(r, false))];
  if (p.settings) S.settings = { ...defaultSettings(), ...p.settings, publicUrl: S.settings.publicUrl || p.settings.publicUrl || '' }; if (S.settings.title === 'Castle Clash') S.settings.title = 'Castle Strategy';
  if (includeTeams && Array.isArray(p.teams) && p.teams.length) {
    const used = new Set();
    const next = p.teams.map((t, i) => {
      const existing = S.teams.find((x) => x.name.toLowerCase() === String(t.name).toLowerCase());
      let code = /^\d{4}$/.test(t.code) && !used.has(t.code) ? t.code : null;
      const nt = { id: existing ? existing.id : uid(), name: String(t.name).slice(0, 30), color: t.color || TEAM_COLORS[i % TEAM_COLORS.length], code };
      if (!code) { nt.code = '0000'; }
      used.add(nt.code);
      return nt;
    });
    S.teams = next;
    for (const t of S.teams) if (t.code === '0000') t.code = newCode();
    S.players = S.players.filter((pl) => team(pl.teamId));
  }
}
const actions = {
  'team/add': (b) => {
    const name = String(b.name || '').trim().slice(0, 30) || `Table ${S.teams.length + 1}`;
    S.teams.push({ id: uid(), name, code: newCode(), color: TEAM_COLORS[S.teams.length % TEAM_COLORS.length] });
  },
  'team/bulk': (b) => {
    const n = Math.max(1, Math.min(40, Number(b.count) || 1));
    for (let i = 0; i < n; i++) actions['team/add']({ name: `Table ${S.teams.length + 1}` });
  },
  'team/update': (b) => {
    const t = team(b.id); if (!t) throw new Error('No such team.');
    if (b.name !== undefined) t.name = String(b.name).trim().slice(0, 30) || t.name;
    if (b.color) t.color = String(b.color).slice(0, 9);
    if (b.code !== undefined) {
      const c = String(b.code).trim();
      if (!/^\d{4}$/.test(c)) throw new Error('A code is exactly 4 digits.');
      if (S.teams.some((x) => x.code === c && x.id !== t.id)) throw new Error('Another team already uses that code.');
      t.code = c;
    }
  },
  'team/regen': (b) => { const t = team(b.id); if (!t) throw new Error('No such team.'); t.code = newCode(); },
  'team/delete': (b) => { S.teams = S.teams.filter((t) => t.id !== b.id); S.players = S.players.filter((p) => p.teamId !== b.id); },
  'player/kick': (b) => { S.players = S.players.filter((p) => p.id !== b.id); },
  'player/move': (b) => { const p = player(b.id); if (p && team(b.teamId)) p.teamId = b.teamId; },
  'player/rename': (b) => { const p = player(b.id); const n = cleanName(b.name); if (p && n) p.name = n; },
  'rounds/set': (b) => {
    if (!Array.isArray(b.rounds)) throw new Error('Rounds missing.');
    const incoming = b.rounds.map((r) => normRound(r, true));
    const ids = new Set(incoming.map((r) => r.id));
    for (const r of S.rounds) {
      if ((S.results[r.id] || S.current.roundId === r.id && inRound()) && !ids.has(r.id)) throw new Error('Played or running rounds can’t be removed. Discard their results first.');
    }
    // played/running rounds keep their original settings
    S.rounds = incoming.map((r) => {
      const old = S.rounds.find((x) => x.id === r.id);
      return old && (S.results[r.id] || (S.current.roundId === r.id && inRound())) ? old : r;
    });
    if (S.current.roundId) S.current.index = S.rounds.findIndex((r) => r.id === S.current.roundId);
  },
  'settings/set': (b) => {
    const s = b.settings || {};
    const cur = S.settings;
    if (s.title !== undefined) cur.title = String(s.title).slice(0, 40) || 'Castle Strategy';
    if (s.soldiers !== undefined && !inRound()) cur.soldiers = Math.max(10, Math.min(1000, Math.round(Number(s.soldiers)) || 100));
    for (const k of ['autoReveal', 'allowJoin', 'showTeammates']) if (s[k] !== undefined) cur[k] = !!s[k];
    if (s.nonSubmit !== undefined) cur.nonSubmit = s.nonSubmit === 'zero' ? 'zero' : 'exclude';
    if (s.briefingSeconds !== undefined) cur.briefingSeconds = Math.max(0, Math.min(300, Math.round(Number(s.briefingSeconds)) || 0));
    if (s.publicUrl !== undefined) cur.publicUrl = String(s.publicUrl).trim().slice(0, 200);
  },
  'game/start': (b) => { const i = b.index === undefined || b.index === null ? nextUnplayed() : Number(b.index); if (i < 0) throw new Error('Every round has been played.'); startRound(i); },
  'game/pause': () => { if (S.current.status !== 'active') throw new Error('No running round.'); S.current.remainingMs = Math.max(0, S.current.endsAt - now()); S.current.status = 'paused'; S.current.endsAt = null; clearTimeout(roundTimer); },
  'game/resume': () => { if (S.current.status !== 'paused') throw new Error('Not paused.'); S.current.endsAt = now() + S.current.remainingMs; S.current.status = 'active'; S.current.remainingMs = null; schedule(); },
  'game/extend': (b) => {
    const ms = (Number(b.seconds) || 30) * 1000;
    if (S.current.status === 'briefing') { S.current.briefingEndsAt = Math.max(now() + 1000, S.current.briefingEndsAt + ms); schedule(); }
    else if (S.current.status === 'active') { S.current.endsAt = Math.max(now() + 1000, S.current.endsAt + ms); schedule(); }
    else if (S.current.status === 'paused') S.current.remainingMs = Math.max(1000, S.current.remainingMs + ms);
    else throw new Error('No running round.');
  },
  'game/end': () => { if (!isOpen()) throw new Error('No running round.'); closeRound(); },
  'game/reveal': () => { if (S.current.status !== 'closed') throw new Error('Nothing waiting to be revealed.'); reveal(); },
  'game/begin': () => { if (!isBriefing()) throw new Error('No round is waiting to start.'); beginRound(); },
  'game/restart': () => { const r = curRound(); if (!r || !isOpen()) throw new Error('No running round.'); S.current.status = 'lobby'; startRound(S.current.index, { briefing: false }); },
  'game/cancel': () => {
    const r = curRound(); if (!r || !inRound()) throw new Error('No running round.');
    clearTimeout(roundTimer);
    delete S.submissions[r.id]; delete S.secrets[r.id];
    const last = S.history[S.history.length - 1];
    S.current = { index: last ? S.rounds.findIndex((x) => x.id === last) : -1, roundId: last || null, status: last ? 'revealed' : 'lobby', endsAt: null, remainingMs: null, startedAt: null };
  },
  'game/discard': (b) => {
    const id = b.roundId; if (!S.results[id]) throw new Error('That round has no results.');
    if (inRound()) throw new Error('Finish or cancel the running round first.');
    delete S.results[id]; delete S.submissions[id]; delete S.secrets[id];
    S.history = S.history.filter((x) => x !== id);
    const last = S.history[S.history.length - 1];
    S.current = { index: last ? S.rounds.findIndex((x) => x.id === last) : -1, roundId: last || null, status: last ? 'revealed' : 'lobby', endsAt: null, remainingMs: null, startedAt: null };
  },
  'game/reset': (b) => {
    clearTimeout(roundTimer);
    S.history = []; S.results = {}; S.submissions = {}; S.secrets = {};
    S.current = { index: -1, roundId: null, status: 'lobby', endsAt: null, remainingMs: null, startedAt: null };
    if (b.removePlayers) S.players = [];
    rotateRoomCode();
  },
  'room/new': () => rotateRoomCode(),
  'bots/add': (b) => {
    const n = Math.max(1, Math.min(10, Number(b.perTeam) || 2));
    const names = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo'];
    for (const t of S.teams) for (let i = 0; i < n; i++) {
      const name = `${names[(S.players.length + i) % names.length]} (bot ${uid(3)})`;
      S.players.push({ id: uid(), token: uid(24), name, teamId: t.id, joinedAt: now(), bot: true });
    }
    const r = curRound();
    if (r && isOpen()) for (const p of S.players) if (p.bot && !S.submissions[r.id][p.id]) S.submissions[r.id][p.id] = { alloc: M.randomAlloc(r, S.settings.soldiers), at: now() };
  },
  'bots/remove': () => { S.players = S.players.filter((p) => !p.bot); },
  'presets/save': (b) => {
    const p = buildPreset(b.name, b.includeTeams !== false);
    fs.writeFileSync(path.join(PRESETS, slug(p.name) + '.json'), JSON.stringify(p, null, 2));
  },
  'presets/load': (b) => {
    const f = path.join(PRESETS, slug(b.file) + '.json');
    applyPreset(JSON.parse(fs.readFileSync(f, 'utf8')), !!b.includeTeams);
  },
  'presets/import': (b) => applyPreset(b.preset, !!b.includeTeams),
  'presets/delete': (b) => { fs.rmSync(path.join(PRESETS, slug(b.file) + '.json'), { force: true }); },
};

// ---------- backup & restore ----------
// The admin dashboard keeps a copy of the whole game in its browser, so a free host that
// restarts (and forgets everything) can be brought back with one click.
function makeBackup() {
  const presets = fs.readdirSync(PRESETS).filter((f) => f.endsWith('.json')).map((f) => {
    try { return { file: f.slice(0, -5), data: JSON.parse(fs.readFileSync(path.join(PRESETS, f), 'utf8')) }; } catch { return null; }
  }).filter(Boolean);
  return { app: 'castle-clash-backup', version: 1, savedAt: now(), state: S, presets };
}
function recoverTimer() {
  if (S.current.status === 'active') { if (now() >= S.current.endsAt) closeRound(); else schedule(); }
  else if (S.current.status === 'briefing') { if (now() >= S.current.briefingEndsAt) beginRound(); else schedule(); }
}
function restoreBackup(b) {
  if (!b || b.app !== 'castle-clash-backup' || !b.state || !Array.isArray(b.state.teams)) throw new Error('That isn’t a Castle Strategy backup.');
  clearTimeout(roundTimer);
  S = { ...freshState(), ...b.state, settings: { ...defaultSettings(), ...b.state.settings } };
  for (const pr of b.presets || []) if (pr && pr.file && pr.data) fs.writeFileSync(path.join(PRESETS, slug(pr.file) + '.json'), JSON.stringify(pr.data, null, 2));
  recoverTimer();
}
const isFresh = () => !S.teams.length && !S.players.length && !S.history.length;

// ---------- router ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  traffic.requests++;
  try {
    // pages
    if (req.method === 'GET') {
      if (p === '/' || p === '/join') return serveFile(res, path.join(PUBLIC, 'index.html'));
      if (p === '/admin') return serveFile(res, path.join(PUBLIC, 'admin.html'));
      if (p === '/board') return serveFile(res, path.join(PUBLIC, 'board.html'));
      if (p.startsWith('/static/')) {
        const f = path.normalize(path.join(PUBLIC, p.slice(8)));
        if (!f.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
        return serveFile(res, f, 300);
      }
    }
    if (p === '/api/events' && req.method === 'GET') {
      const role = url.searchParams.get('role');
      if (role === 'admin' && !isAdmin(req, url)) return send(res, 401, { error: 'Wrong password.' });
      if (role === 'admin') noteAdminHost(req);
      const headers = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' };
      const c = { role: role === 'admin' ? 'admin' : role === 'player' ? 'player' : 'board', token: url.searchParams.get('token'), boardHash: null };
      if (acceptsGzip(req)) {
        const gz = zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH });
        res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
        gz.on('data', (d) => { traffic.bytes += d.length; });
        gz.pipe(res);
        c.write = (str) => gz.write(str);
        req.on('close', () => gz.end());
      } else {
        res.writeHead(200, headers);
        c.write = (str) => { traffic.bytes += Buffer.byteLength(str); res.write(str); };
      }
      c.write('retry: 2000\n\n');
      clients.add(c);
      sendState(c, viewFor(c), {});
      req.on('close', () => clients.delete(c));
      return;
    }
    if (p === '/api/ping') return send(res, 200, { ok: true });
    if (p === '/api/state' && req.method === 'GET') {
      const tok = req.headers['x-player-token'] || url.searchParams.get('token');
      return send(res, 200, tok ? playerView(byToken(tok)) : publicView());
    }
    if (p === '/api/join' && req.method === 'POST') {
      const ip = clientIp(req);
      const fails = (failedJoins.get(ip) || []).filter((t) => now() - t < 60000);
      globalFails = globalFails.filter((t) => now() - t < 60000);
      if (fails.length >= 8 || globalFails.length >= 40) return send(res, 429, { error: 'Too many wrong codes. Wait a minute and try again.' });
      const b = await readBody(req);
      const code = String(b.code || '').trim();
      const name = cleanName(b.name);
      if (!name) return send(res, 400, { error: 'Enter your name.' });
      const fail = (error) => { fails.push(now()); failedJoins.set(ip, fails); globalFails.push(now()); return send(res, 400, { error }); };
      if (String(b.room || '').trim() !== S.roomCode) return fail('Wrong room code. Use the 3-digit number on the big screen.');
      const t = S.teams.find((x) => x.code === code);
      if (!t) return fail('That code doesn’t match any table. Check the card on your table.');
      const existing = S.players.find((x) => x.teamId === t.id && x.name.toLowerCase() === name.toLowerCase());
      if (existing) return send(res, 200, { token: existing.token, rejoined: true });
      if (!S.settings.allowJoin) return send(res, 403, { error: 'Joining is closed right now. Ask the host.' });
      const pl = { id: uid(), token: uid(24), name, teamId: t.id, joinedAt: now() };
      S.players.push(pl); changed();
      return send(res, 200, { token: pl.token });
    }
    if (p === '/api/leave' && req.method === 'POST') {
      const pl = byToken(req.headers['x-player-token']);
      if (pl) { S.players = S.players.filter((x) => x !== pl); changed(); }
      return send(res, 200, { ok: true });
    }
    if (p === '/api/submit' && req.method === 'POST') {
      const pl = byToken(req.headers['x-player-token']);
      if (!pl) return send(res, 401, { error: 'You’re not in the game any more. Join again.' });
      const r = curRound();
      const late = S.current.status === 'active' && now() > S.current.endsAt + 1500;
      if (r && isBriefing()) return send(res, 409, { error: 'The round hasn’t started yet. Read the rules first.' });
      if (!r || !isOpen() || late) return send(res, 409, { error: 'This round is closed.' });
      const b = await readBody(req);
      const alloc = Array.isArray(b.alloc) ? b.alloc.map(Number) : null;
      const err = M.validate(alloc, r, S.settings.soldiers);
      if (err) return send(res, 400, { error: err });
      S.submissions[r.id][pl.id] = { alloc, at: now() };
      changed();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/login' && req.method === 'POST') {
      const b = await readBody(req);
      return b.password === ADMIN_PASSWORD ? send(res, 200, { ok: true }) : send(res, 401, { error: 'Wrong password.' });
    }
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req, url)) return send(res, 401, { error: 'Wrong password.' });
      noteAdminHost(req);
      const action = p.slice('/api/admin/'.length);
      if (req.method === 'GET' && action === 'backup') return send(res, 200, makeBackup());
      if (req.method === 'POST' && action === 'restore') { const b = await readBody(req); restoreBackup(b.backup); changed(); return send(res, 200, { ok: true }); }
      if (req.method === 'GET' && action === 'state') return send(res, 200, adminView());
      if (req.method === 'GET' && action === 'room') return send(res, 200, { roomCode: S.roomCode, roomVersion: S.roomVersion });
      if (req.method === 'GET' && action === 'export') return send(res, 200, buildPreset(url.searchParams.get('name') || S.settings.title, url.searchParams.get('teams') !== '0'));
      if (req.method === 'GET' && action === 'preset') {
        const f = path.join(PRESETS, slug(url.searchParams.get('file')) + '.json');
        return send(res, 200, JSON.parse(fs.readFileSync(f, 'utf8')));
      }
      if (req.method === 'GET' && action === 'results') return send(res, 200, { board: leaderboard(true), results: S.results, history: S.history, teams: S.teams, players: S.players.map(({ token, ...x }) => x) });
      if (req.method === 'POST' && actions[action]) {
        const b = await readBody(req);
        actions[action](b);
        changed();
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'Unknown action.' });
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
  } catch (e) {
    send(res, 400, { error: e.message || String(e) });
  }
});

// Recover a round that was running when the server stopped.
recoverTimer();

// Optional: `node server.js --tunnel` opens a free Cloudflare quick tunnel so phones can join
// over mobile data or any network. Needs cloudflared (brew install cloudflared).
function startTunnel() {
  const { spawn } = require('child_process');
  const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', () => console.log('\n  Couldn’t start the tunnel: cloudflared isn’t installed.\n  Install it with:  brew install cloudflared   then run  node server.js --tunnel  again.\n'));
  const onData = (d) => {
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== tunnelUrl) {
      tunnelUrl = m[0];
      console.log(`\n  Public link for players (mobile data or any Wi-Fi):  ${tunnelUrl}\n  It changes every time you start the tunnel. Print table cards after this line appears.\n`);
      broadcastSoon();
    }
  };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.on('exit', (code) => { if (tunnelUrl) { console.log('\n  The tunnel stopped. Restart the server to get a new link.\n'); tunnelUrl = ''; broadcastSoon(); } });
  const stop = () => { try { child.kill(); } catch { /* gone */ } };
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(0); });
}
if (process.argv.includes('--tunnel') || process.env.TUNNEL === '1') startTunnel();

server.listen(PORT, '0.0.0.0', () => {
  const urls = lanUrls();
  console.log('\n  Castle Strategy is running.\n');
  console.log(`  Admin dashboard:  http://localhost:${PORT}/admin`);
  console.log(`  Admin password:   ${ADMIN_PASSWORD}${process.env.ADMIN_PASSWORD ? '' : `   (stored in data/admin-password.txt)`}`);
  console.log(`  Leaderboard:      http://localhost:${PORT}/board`);
  const pub = trimUrl(process.env.PUBLIC_URL) || trimUrl(process.env.RENDER_EXTERNAL_URL);
  console.log(`  Players join at:  ${pub || (urls.length ? urls.join('  or  ') : `http://localhost:${PORT}`)}\n`);
});
