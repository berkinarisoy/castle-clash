'use strict';
// End-to-end check of the server API: node tools/test-e2e.js
// Starts a server on a spare port with a throwaway data folder, plays every mode.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const M = require('../src/modes');

const PORT = 3977;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
const PW = 'test-pw';
const base = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: DATA, ADMIN_PASSWORD: PW }, stdio: 'pipe' });
srv.stderr.on('data', (d) => process.stderr.write(d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(p, { method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}
const admin = (a, body = {}) => call('/api/admin/' + a, { method: 'POST', body, headers: { 'x-admin-key': PW } });
const astate = () => call('/api/admin/state', { headers: { 'x-admin-key': PW } });

(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/state'); break; } catch { await sleep(100); } }
  try {
    assert.strictEqual((await call('/api/admin/state')).status, 401, 'admin needs password');
    for (const n of ['Red', 'Blue', 'Green']) assert.strictEqual((await admin('team/add', { name: n })).ok, true);
    let st = await astate();
    const teams = st.adminTeams;
    assert.ok(teams.every((t) => /^\d{4}$/.test(t.code)));
    assert.strictEqual(new Set(teams.map((t) => t.code)).size, 3);

    // board must not leak codes
    const pub = JSON.stringify(await call('/api/state'));
    for (const t of teams) assert.ok(!pub.includes(`"code":"${t.code}"`), 'codes hidden from public');

    // room code: 3 digits, admin-only, needed to join
    const room = st.roomCode;
    assert.ok(/^\d{3}$/.test(room), 'room code has 3 digits');
    assert.ok(!('roomCode' in (await call('/api/state'))), 'room code hidden from public state');
    assert.strictEqual((await call('/api/admin/room')).status, 401, 'room code needs the admin key');
    assert.strictEqual((await call('/api/admin/room', { headers: { 'x-admin-key': PW } })).roomCode, room);
    const wrongRoom = room === '999' ? '998' : String(Number(room) + 1);
    assert.strictEqual((await call('/api/join', { method: 'POST', body: { room: wrongRoom, code: teams[0].code, name: 'X' } })).status, 400, 'wrong room code');
    assert.strictEqual((await call('/api/join', { method: 'POST', body: { code: teams[0].code, name: 'X' } })).status, 400, 'missing room code');

    // joining
    assert.strictEqual((await call('/api/join', { method: 'POST', body: { room, code: '0000', name: 'X' } })).status, 400);
    const players = [];
    for (const t of teams) for (const n of ['Ann', 'Ben', 'Cat']) {
      const r = await call('/api/join', { method: 'POST', body: { room, code: t.code, name: `${n} ${t.name}` } });
      assert.ok(r.token, 'join ok'); players.push({ token: r.token, team: t.id });
    }
    const again = await call('/api/join', { method: 'POST', body: { room, code: teams[0].code, name: 'ann red' } });
    assert.strictEqual(again.token, players[0].token, 'rejoin reclaims');
    const me = await call('/api/state', { headers: { 'x-player-token': players[0].token } });
    assert.strictEqual(me.me.teamName, 'Red');
    assert.ok(!JSON.stringify(me).includes(teams[1].code));

    // build a plan with all 13 modes, short durations
    const modes = Object.keys(M.MODES);
    assert.strictEqual((await admin('rounds/set', { rounds: modes.map((m) => ({ mode: m, duration: 30 })) })).ok, true);
    st = await astate();
    assert.strictEqual(st.rounds.length, modes.length);

    const sub = (p, alloc) => call('/api/submit', { method: 'POST', body: { alloc }, headers: { 'x-player-token': p.token } });
    assert.strictEqual((await sub(players[0], M.randomAlloc({ mode: 'classic' }, 100))).status, 409, 'no round yet');

    // rules countdown: the round is announced first, then starts by itself or when the host presses Start now
    assert.strictEqual(st.settings.briefingSeconds, 30, 'default 30 s of rules');
    assert.strictEqual((await admin('game/start')).ok, true);
    st = await astate();
    assert.strictEqual(st.status, 'briefing');
    assert.ok(st.briefingEndsAt - st.now > 29000 && st.briefingEndsAt - st.now <= 30000, '30 s countdown');
    assert.ok(st.round.blurb.length > 20, 'rules are visible while the countdown runs');
    assert.strictEqual((await sub(players[0], M.randomAlloc({ mode: 'classic' }, 100))).status, 409, 'cannot submit during the rules countdown');
    assert.strictEqual((await admin('game/begin')).ok, true);
    st = await astate();
    assert.strictEqual(st.status, 'active'); assert.strictEqual(st.briefingEndsAt, null);
    assert.strictEqual((await sub(players[0], M.randomAlloc({ mode: 'classic' }, 100))).ok, true, 'can submit once started');
    assert.strictEqual((await admin('game/cancel')).ok, true);
    assert.strictEqual((await admin('settings/set', { settings: { briefingSeconds: 1 } })).ok, true);
    assert.strictEqual((await admin('game/start')).ok, true);
    assert.strictEqual((await astate()).status, 'briefing');
    await sleep(1500);
    assert.strictEqual((await astate()).status, 'active', 'starts by itself when the countdown ends');
    assert.strictEqual((await admin('game/cancel')).ok, true);
    assert.strictEqual((await admin('game/start')).ok, true);
    assert.strictEqual((await admin('game/cancel')).ok, true, 'can cancel during the countdown');
    assert.strictEqual((await astate()).status, 'lobby');
    console.log('  ✓ rules countdown: 30 s default, start now, auto start, cancel');
    assert.strictEqual((await admin('settings/set', { settings: { briefingSeconds: 0 } })).ok, true);

    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i];
      assert.strictEqual((await admin('game/start')).ok, true, 'start ' + mode);
      // invalid submit
      const bad = await sub(players[0], [1, 1, 1, 1, 1, 1, 1, 1, 1, 92]);
      assert.strictEqual(bad.status, 400, 'reject more than 100 in ' + mode);
      for (const [k, p] of players.entries()) {
        if (k === 8) continue; // one player sits out
        const r = await sub(p, M.randomAlloc({ mode }, 100));
        assert.strictEqual(r.ok, true, `submit ${mode}: ${r.error}`);
      }
      if (i === 2) { await admin('game/pause'); await admin('game/extend', { seconds: 30 }); await admin('game/resume'); }
      assert.strictEqual((await admin('game/end')).ok, true);
      st = await astate();
      assert.strictEqual(st.status, 'revealed', 'auto reveal');
      const lb = st.board.rounds[st.board.rounds.length - 1];
      assert.strictEqual(lb.participants, 8);
      const res = await call('/api/admin/results', { headers: { 'x-admin-key': PW } });
      const r = res.results[res.history[res.history.length - 1]];
      // team score = max member (except alliance where all members share it)
      for (const t of teams) {
        const mem = Object.values(r.players).filter((p) => p.teamId === t.id).map((p) => p.score);
        assert.strictEqual(r.teamScores[t.id], Math.round(Math.max(0, ...mem) * 100) / 100, `team max ${mode}`);
      }
      assert.ok(lb.tip && lb.tip.length > 40 && lb.zh && lb.zh.tip, 'strategy tip for ' + mode);
      if (mode !== 'alliance') assert.ok(lb.hindsight && lb.hindsight.alloc.length === 10, 'hindsight army for ' + mode);
      console.log(`  ✓ ${mode.padEnd(13)} team scores: ${lb.teams.map((t) => `${t.name} ${t.score}`).join(', ')}`);
    }
    st = await astate();
    assert.strictEqual(st.nextUnplayed, -1);
    const fin = await call('/api/state');
    assert.strictEqual(fin.finished, true);
    const sumCheck = fin.board.overall.every((t) => Math.abs(t.total - t.perRound.reduce((a, b) => a + b, 0)) < 0.01);
    assert.ok(sumCheck, 'totals add up');
    assert.strictEqual(fin.board.topScores.length, modes.length);
    for (const t of fin.board.overall) {
      assert.strictEqual(t.members.length, 3, 'three players per team');
      t.members.forEach((m) => assert.strictEqual(m.perRound.length, modes.length));
    }
    const sat = fin.board.overall.flatMap((t) => t.members).filter((m) => m.perRound.every((v) => v === null));
    assert.strictEqual(sat.length, 1, 'the player who never submitted shows dashes');
    for (const r of fin.board.rounds) for (const t of r.teams) if (t.members.length && r.mode !== 'alliance') assert.strictEqual(t.members[0].score, t.best.score, 'best member first');
    console.log('  ✓ per-player standings and team strategies');
    console.log('  ✓ overall:', fin.board.overall.map((t) => `${t.rank}. ${t.name} ${t.total}`).join('  '));

    // presets round trip
    assert.ok((await admin('presets/save', { name: 'Test Night', includeTeams: true })).ok);
    st = await astate();
    assert.strictEqual(st.presets[0].name, 'Test Night');
    await admin('game/reset', { removePlayers: true });
    await admin('team/delete', { id: teams[0].id });
    assert.ok((await admin('presets/load', { file: st.presets[0].file, includeTeams: true })).ok);
    st = await astate();
    assert.strictEqual(st.adminTeams.length, 3);
    assert.deepStrictEqual(st.adminTeams.map((t) => t.code).sort(), teams.map((t) => t.code).sort(), 'codes restored');
    assert.strictEqual(st.rounds.length, modes.length);
    console.log('  ✓ config saved and restored with team codes');

    // manual reveal + discard + persistence across restart
    await admin('settings/set', { settings: { autoReveal: false } });
    await admin('bots/add', { perTeam: 2 });
    await admin('game/start');
    await admin('game/end');
    st = await astate();
    assert.strictEqual(st.status, 'closed');
    assert.strictEqual((await call('/api/state')).board.rounds.length, 0, 'hidden until reveal');
    assert.ok(st.pendingResult);
    await admin('game/reveal');
    assert.strictEqual((await call('/api/state')).board.rounds.length, 1);
    const rid = (await call('/api/admin/results', { headers: { 'x-admin-key': PW } })).history[0];
    await admin('game/discard', { roundId: rid });
    assert.strictEqual((await call('/api/state')).board.rounds.length, 0);
    console.log('  ✓ manual reveal, discard, bots');

    // backup and restore after a wipe
    const backup = await call('/api/admin/backup', { headers: { 'x-admin-key': PW } });
    assert.strictEqual(backup.app, 'castle-clash-backup');
    const playersBefore = backup.state.players.length;
    await admin('game/reset', { removePlayers: true });
    for (const t of (await astate()).adminTeams) await admin('team/delete', { id: t.id });
    assert.strictEqual((await call('/api/state')).fresh, true, 'empty server reports fresh');
    assert.ok((await admin('restore', { backup })).ok);
    st = await astate();
    assert.strictEqual(st.adminTeams.length, 3); assert.strictEqual(st.adminTeams.reduce((a, t) => a + t.players.length, 0), playersBefore);
    assert.strictEqual((await call('/api/state')).fresh, false);
    const back = await call('/api/state', { headers: { 'x-player-token': backup.state.players[0].token } });
    assert.ok(back.me, 'player token works again after restore');
    assert.strictEqual((await admin('restore', { backup: { nope: 1 } })).status, 400);
    assert.strictEqual((await call('/api/ping')).ok, true);
    console.log('  ✓ backup, wipe, restore (players keep their seats)');

    // every reset makes a new room code; 'keep players' keeps their seats
    const oldRoom = (await astate()).roomCode, oldVersion = (await call('/api/state')).roomVersion;
    await admin('game/reset');
    st = await astate();
    assert.notStrictEqual(st.roomCode, oldRoom, 'reset changes the room code');
    assert.ok((await call('/api/state')).roomVersion > oldVersion, 'board is told to refetch');
    const tcode = st.adminTeams[0].code;
    assert.strictEqual((await call('/api/join', { method: 'POST', body: { room: oldRoom, code: tcode, name: 'Late' } })).status, 400, 'old room code rejected');
    assert.ok((await call('/api/join', { method: 'POST', body: { room: st.roomCode, code: tcode, name: 'Late' } })).token, 'new room code works');
    assert.ok((await call('/api/state', { headers: { 'x-player-token': backup.state.players[0].token } })).me, 'kept players stay in');
    assert.ok((await admin('room/new')).ok);
    assert.notStrictEqual((await astate()).roomCode, st.roomCode, 'host can make a new code');
    console.log('  ✓ room code: private, required, changes on reset');

    // rate limit on wrong codes
    let last;
    for (let i = 0; i < 10; i++) last = await call('/api/join', { method: 'POST', body: { code: '0001', name: 'Hacker' } });
    assert.strictEqual(last.status, 429);
    console.log('  ✓ wrong-code rate limit');
    console.log('\nAll end-to-end checks passed.');
  } catch (e) {
    console.error(e); process.exitCode = 1;
  } finally {
    srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  }
})();
