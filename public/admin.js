// Castle Strategy — admin dashboard
(() => {
  const { $, esc, fmt, api, live, toast, clock, remaining, shield, qr } = CC;
  const root = $('#root');
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
  let key = ls.get('cc.admin');
  let S = null, sect = ls.get('cc.adminSect') || 'game', conn = null, pending = false;
  let roundsDraft = null, roundsDirty = false, settingsDraft = null, loadTeams = false;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const SOURCES = { rules: 'From the rules', host: 'Host ideas', claude: 'New ideas' };

  // ---------- auth & connection ----------
  function A(action, body) {
    return api('/api/admin/' + action, { method: 'POST', body: body || {}, headers: { 'x-admin-key': key } });
  }
  async function act(action, body, msg) {
    try { await A(action, body); if (msg) toast(msg); return true; }
    catch (e) { toast(e.message, true); if (e.status === 401) logout(); return false; }
  }
  function logout() { key = null; ls.set('cc.admin', null); conn && conn.stop(); S = null; renderLogin(); }
  function renderLogin(msg = '') {
    root.innerHTML = `<form class="panel stack login" id="login">
      <div class="row-flex"><img src="/static/logo.svg" width="36" height="36" alt=""><h1>Castle Strategy admin</h1></div>
      <p class="muted small">The password is printed in the terminal where you started the server.</p>
      <label class="field"><span>Admin password</span><input type="password" id="pw" autocomplete="current-password" autofocus></label>
      <button class="btn block" type="submit">Open dashboard</button>
      <p class="small" style="color:var(--gules)" role="alert">${esc(msg)}</p></form>`;
    $('#login').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/admin/login', { method: 'POST', body: { password: $('#pw').value } }); key = $('#pw').value; ls.set('cc.admin', key); connect(); }
      catch (ex) { renderLogin(ex.message); }
    });
  }
  function connect() {
    conn && conn.stop();
    root.innerHTML = '<div class="shell"><header class="head" id="head"></header><main id="main"></main></div>';
    conn = live(`/api/events?role=admin&key=${encodeURIComponent(key)}`,
      () => api('/api/admin/state', { headers: { 'x-admin-key': key } }),
      (s, err) => { if (!s) { if (err && err.status === 401) logout(); return; } onState(s); });
  }
  function onState(s) {
    S = s;
    if (!roundsDirty) roundsDraft = clone(S.rounds);
    if (!settingsDraft) settingsDraft = clone(S.settings);
    renderHead();
    if (editing()) pending = true; else renderMain();
    if (!S.fresh) scheduleBackup();
  }

  // ---------- automatic backup in this browser ----------
  // Free hosts can restart and forget the game. The dashboard keeps the latest copy here.
  let backupTimer = null, lastBackup = 0;
  function readBackup() { try { return JSON.parse(ls.get('cc.backup') || 'null'); } catch { return null; } }
  function scheduleBackup() {
    if (backupTimer) return;
    backupTimer = setTimeout(async () => {
      backupTimer = null; lastBackup = Date.now();
      try {
        const b = await api('/api/admin/backup', { headers: { 'x-admin-key': key } });
        if (b && b.state && (b.state.teams.length || b.state.history.length)) ls.set('cc.backup', JSON.stringify(b));
      } catch { /* storage full or offline: try again on the next change */ }
    }, Math.max(1500, 10000 - (Date.now() - lastBackup)));
  }
  function restoreBanner() {
    const b = readBackup();
    if (!S.fresh || !b || !b.state || !b.state.teams.length) return '';
    return `<section class="panel row-flex wrap" style="margin-top:12px;background:var(--or-soft)"><div class="grow"><strong>The server has no game, but this browser has a backup.</strong>
      <div class="small muted">Saved ${new Date(b.savedAt).toLocaleString()}: ${b.state.teams.length} teams, ${b.state.players.length} players, ${b.state.history.length} round${b.state.history.length === 1 ? '' : 's'} played. Players’ phones reconnect by themselves after you restore it.</div></div>
      <button class="btn" id="restoreLocal">Restore the game</button></section>`;
  }
  const editing = () => { const a = document.activeElement; return a && $('#main') && $('#main').contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.type !== 'button' && a.type !== 'checkbox'; };
  document.addEventListener('focusout', () => setTimeout(() => { if (pending && !editing()) { pending = false; renderMain(); } }, 0));

  // ---------- header ----------
  const statusLabel = { lobby: 'Lobby', briefing: 'Rules showing', active: 'Round running', paused: 'Paused', closed: 'Scored, not revealed', revealed: 'Results showing' };
  function renderHead() {
    const st = S.status, r = S.round, next = S.nextUnplayed >= 0 ? S.rounds[S.nextUnplayed] : null;
    let ctl = '';
    if (st === 'briefing') ctl = '<button class="btn" data-act="game/begin">Start now</button><button class="btn soft small" data-act="game/extend">+30 s</button><button class="btn danger small" data-act="game/cancel" data-confirm="Cancel this round? It goes back to unplayed.">Cancel</button>';
    else if (st === 'active') ctl = '<button class="btn soft small" data-act="game/pause">Pause</button><button class="btn soft small" data-act="game/extend">+30 s</button><button class="btn danger small" data-act="game/end" data-confirm="End the round now and score it?">End now</button>';
    else if (st === 'paused') ctl = '<button class="btn small" data-act="game/resume">Resume</button><button class="btn soft small" data-act="game/extend">+30 s</button><button class="btn danger small" data-act="game/end" data-confirm="End the round now and score it?">End now</button>';
    else if (st === 'closed') ctl = '<button class="btn gold" data-act="game/reveal">Reveal results</button>';
    else if (next) ctl = `<button class="btn" data-act="game/start">Start round ${S.playedCount + 1}: ${esc(next.displayTitle)}</button>`;
    else ctl = '<span class="chip ok">All rounds played</span>';
    $('#head').innerHTML = `<div class="head-in">
      <div class="brand"><img src="/static/logo.svg" alt="">${esc(S.title)}</div>
      <div class="status">
        <span class="chip ${st === 'active' ? 'ok' : st === 'closed' ? 'gold' : ''}">${statusLabel[st] || st}</span>
        ${r && (st === 'briefing' || st === 'active' || st === 'paused' || st === 'closed') ? `<span class="small"><strong>${esc(r.title)}</strong></span>` : ''}
        ${st === 'briefing' ? '<span class="small muted">Starts in</span>' : ''}${st === 'active' || st === 'paused' || st === 'briefing' ? '<span class="timer-s num" data-timer></span>' : ''}
        ${ctl}
        <a class="btn ghost small" href="/board" target="_blank" rel="noopener">Open board</a>
      </div></div>
      <nav class="sect tabs" aria-label="Sections">${[['game', 'Game'], ['teams', `Teams (${S.adminTeams.length})`], ['rounds', `Rounds (${S.rounds.length})`], ['settings', 'Settings and configs']]
        .map(([k, l]) => `<button class="tab" data-sect="${k}" aria-selected="${sect === k}">${l}</button>`).join('')}</nav>${restoreBanner()}`;
    tick();
  }
  document.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-sect]');
    if (s) { sect = s.dataset.sect; ls.set('cc.adminSect', sect); renderHead(); renderMain(); return; }
    const b = e.target.closest('[data-act]');
    if (b) {
      if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
      const body = b.dataset.body ? JSON.parse(b.dataset.body) : {};
      b.disabled = true;
      await act(b.dataset.act, body, b.dataset.msg);
      b.disabled = false;
    }
  });

  // ---------- main ----------
  function renderMain() {
    const m = $('#main'); if (!m || !S) return;
    const y = window.scrollY;
    if (sect === 'teams') CC.setHTML(m, teamsView());
    else if (sect === 'rounds') CC.setHTML(m, roundsView());
    else if (sect === 'settings') CC.setHTML(m, settingsView());
    else CC.setHTML(m, gameView());
    window.scrollTo(0, y);
    tick();
  }

  // ----- game -----
  function gameView() {
    const st = S.status, r = S.round, open = st === 'active' || st === 'paused';
    let now = '';
    if (st === 'briefing') {
      now = `<section class="panel stack"><div class="spread"><h2>${esc(r.title)}</h2><span class="chip">${esc(r.modeName)}</span></div>
        <p class="small">${esc(r.blurb)}</p>
        <p class="small muted">Players are reading the rules. The round starts by itself when the countdown ends, or press Start now.</p></section>`;
    } else if (open) {
      const sub = new Set(S.submittedIds);
      now = `<section class="panel stack"><div class="spread"><h2>${esc(r.title)}</h2><span class="chip">${esc(r.modeName)}</span></div>
        <p class="small">${esc(r.blurb)}</p>
        <div class="stack">${S.adminTeams.map((t) => { const s = S.submissions[t.id] || { done: 0, total: 0 }; return `<div><div class="spread"><span class="row-flex">${shield(t.color)}<strong>${esc(t.name)}</strong></span><span class="small num muted">${s.done}/${s.total} in</span></div>
          <div class="players" style="margin-top:6px">${t.players.map((p) => `<span class="pchip" style="padding-right:10px;${sub.has(p.id) ? 'background:var(--vert-soft);color:var(--vert)' : ''}">${esc(p.name)}${sub.has(p.id) ? ' ✓' : ''}</span>`).join('') || '<span class="small muted">No players</span>'}</div></div>`; }).join('')}</div>
        <div class="control"><button class="btn ghost small" data-act="game/restart" data-confirm="Restart this round? All armies submitted so far are cleared and the timer starts again.">Restart round</button>
        <button class="btn ghost small" data-act="game/cancel" data-confirm="Cancel this round? Submissions are thrown away and the round goes back to unplayed.">Cancel round</button></div></section>`;
    } else if (st === 'closed' && S.pendingResult) {
      now = `<section class="panel stack"><div class="spread"><h2>Ready to reveal</h2><button class="btn gold" data-act="game/reveal">Reveal results</button></div><p class="small muted">Only you can see this. Players see results once you reveal them.</p>${CC.roundDetail(S.pendingResult)}</section>`;
    } else {
      const last = S.board.rounds[S.board.rounds.length - 1];
      now = last
        ? `<section class="panel">${CC.roundDetail(last)}</section>`
        : `<section class="panel stack"><h2>Lobby</h2><p class="muted">${S.adminTeams.length ? `${S.adminTeams.reduce((a, t) => a + t.players.length, 0)} players have joined ${S.adminTeams.length} teams.` : 'Add teams first, then hand out the table codes.'}</p>
          ${S.adminTeams.length ? '' : '<button class="btn" data-sect="teams">Set up teams</button>'}</section>`;
    }
    const plan = `<section class="panel"><div class="spread" style="margin-bottom:6px"><h2>Round plan</h2><button class="linkbtn" data-sect="rounds">Edit rounds</button></div>
      ${S.rounds.map((x, i) => `<div class="plan-row"><div class="plan-n">${i + 1}</div>
        <div class="grow"><strong>${esc(x.displayTitle)}</strong><div class="small muted">${esc(modeName(x.mode))}, ${clock(x.duration * 1000)}${x.multiplier !== 1 ? `, ×${fmt(x.multiplier)}` : ''}${x.primesOnly ? ', primes only' : ''}</div></div>
        <div class="row-flex">${x.current && (open || st === 'briefing') ? '<span class="chip ok">Running</span>'
          : x.played ? `<span class="chip">Played${x.playOrder ? ` as round ${x.playOrder}` : ''}</span><button class="linkbtn small" data-act="game/discard" data-body='${JSON.stringify({ roundId: x.id })}' data-confirm="Discard this round's results? Its scores are removed from the leaderboard and it can be played again.">Discard</button>`
          : `<button class="btn soft small" data-act="game/start" data-body='${JSON.stringify({ index: i })}' ${open || st === 'closed' ? 'disabled' : ''}>Start</button>`}</div></div>`).join('')}</section>`;
    const side = `<section class="panel"><h2 style="margin-bottom:6px">Overall</h2>${CC.overallTable(S.board, null, { members: true })}${S.board.rounds.some((r2) => !r2.revealed) ? '<p class="tiny muted" style="margin-top:6px">Includes scores not yet revealed to players.</p>' : ''}</section>
      ${joinPanel()}`;
    return `<div class="grid2"><div class="stack-lg">${now}${plan}</div><div class="stack-lg">${side}</div></div>`;
  }
  function joinPanel() {
    return `<section class="panel stack"><h2>Players join at</h2>
      <div class="spread"><div><span class="small muted">Room code (changes on every reset)</span><div class="num" style="font-size:2.2rem;font-weight:850;letter-spacing:.1em;color:var(--azure)">${esc(S.roomCode)}</div></div>
        <button class="btn ghost small" data-act="room/new" data-confirm="Make a new room code? Players already in stay in; anyone joining needs the new code." data-msg="New room code">New code</button></div>
      <div class="row-flex" style="align-items:flex-start"><div style="width:110px;background:#fff;padding:6px;border-radius:12px;flex:none">${qr(S.joinUrl)}</div>
      <div class="stack grow"><strong style="word-break:break-all">${esc(S.joinUrl)}</strong>
      ${S.lanUrls.length > 1 ? `<p class="tiny muted">Other addresses for this laptop: ${S.lanUrls.slice(1).map(esc).join(', ')}</p>` : ''}
      <p class="tiny muted">${/^https:/.test(S.joinUrl) ? 'This is a public link: students can join on mobile data or any Wi-Fi.' : 'Phones must be on the same Wi-Fi as this laptop. To let students join on mobile data, host online or start the server with --tunnel (see the README).'}</p>
      <div class="control"><button class="btn soft small" id="printCards">Print table cards</button><a class="btn ghost small" href="/board" target="_blank" rel="noopener">Open board</a></div></div></div></section>`;
  }
  const modeName = (id) => (S.modes.find((m) => m.id === id) || { name: id }).name;

  // ----- teams -----
  function teamsView() {
    const total = S.adminTeams.reduce((a, t) => a + t.players.length, 0);
    const bots = S.adminTeams.reduce((a, t) => a + t.players.filter((p) => p.bot).length, 0);
    return `<div class="stack-lg">
      <section class="panel stack"><div class="spread wrap"><h2>Teams</h2><span class="muted small">${total} players${bots ? `, ${bots} test bots` : ''}</span></div>
        <form class="row-flex wrap" id="addTeam"><input type="text" id="teamName" placeholder="Team name, e.g. Table 1" maxlength="30" style="max-width:320px"><button class="btn" type="submit">Add team</button>
        <button class="btn ghost" type="button" id="bulk">Add 4 tables</button>
        <button class="btn soft" type="button" id="printCards">Print table cards</button></form>
        <label class="check"><input type="checkbox" id="allowJoin" ${S.settings.allowJoin ? 'checked' : ''}><span>Let new players join<br><span class="small muted">Turn off once everyone is in. Players who already joined can always reconnect.</span></span></label>
      </section>
      ${S.adminTeams.length ? '' : '<p class="muted">No teams yet. Add one team per table. Each team gets its own 4-digit code.</p>'}
      <div class="mode-lib">${S.adminTeams.map((t) => `<section class="panel teamcard" data-team="${t.id}">
        <div class="row-flex"><input type="color" value="${esc(t.color)}" data-tf="color" aria-label="Team colour"><input type="text" value="${esc(t.name)}" data-tf="name" maxlength="30" aria-label="Team name"></div>
        <div class="spread"><div><div class="small muted">Join code</div><div class="code-big num">${esc(t.code)}</div></div>
          <div class="stack" style="text-align:right"><button class="linkbtn small" data-act="team/regen" data-body='${JSON.stringify({ id: t.id })}' data-confirm="Make a new code for ${esc(t.name)}? The old code stops working for new joins.">New code</button>
          <button class="linkbtn small" data-setcode="${t.id}">Set code</button></div></div>
        <div><div class="small muted" style="margin-bottom:6px">${t.players.length} player${t.players.length === 1 ? '' : 's'}</div>
          <div class="players">${t.players.map((p) => `<span class="pchip">${esc(p.name)}
            <select data-move="${p.id}" aria-label="Move ${esc(p.name)}">${S.adminTeams.map((o) => `<option value="${o.id}" ${o.id === t.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
            <button data-act="player/kick" data-body='${JSON.stringify({ id: p.id })}' data-confirm="Remove ${esc(p.name)} from the game?" aria-label="Remove ${esc(p.name)}">✕</button></span>`).join('')}</div></div>
        <button class="linkbtn small" style="justify-self:start;color:var(--gules)" data-act="team/delete" data-body='${JSON.stringify({ id: t.id })}' data-confirm="Delete ${esc(t.name)} and remove its players?">Delete team</button>
      </section>`).join('')}</div>
      <section class="panel stack"><h2>Rehearse with test bots</h2><p class="small muted">Bots join every team and submit a random valid army as soon as a round starts. Use them to try the game before the event, then remove them.</p>
        <div class="control"><button class="btn soft small" data-act="bots/add" data-body='{"perTeam":2}' data-msg="Bots added">Add 2 bots per team</button><button class="btn ghost small" data-act="bots/remove" data-msg="Bots removed">Remove all bots</button></div></section>
    </div>`;
  }

  // ----- rounds -----
  function modeOptions(sel) {
    const groups = {};
    for (const m of S.modes) (groups[m.source] = groups[m.source] || []).push(m);
    return Object.entries(groups).map(([src, ms]) => `<optgroup label="${SOURCES[src] || src}">${ms.map((m) => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)} (${esc(m.style)})</option>`).join('')}</optgroup>`).join('');
  }
  function roundsView() {
    const rd = roundsDraft;
    return `<div class="stack-lg">
      <section class="panel stack"><h2>Rounds</h2><p class="small muted">Rounds are played top to bottom with “Start next round”, or start any of them from the Game tab. Played rounds are locked.</p></section>
      <div class="stack" id="roundsEd">${rd.map((r, i) => {
        const m = S.modes.find((x) => x.id === r.mode) || S.modes[0];
        const locked = r.played || (r.current && (S.status === 'active' || S.status === 'paused' || S.status === 'briefing'));
        return `<section class="panel round-ed" data-i="${i}"><div class="plan-n" style="font-size:1.3rem">${i + 1}</div>
          <fieldset class="stack" style="border:0;padding:0;margin:0;min-width:0" ${locked ? 'disabled' : ''}>
            <div class="spread wrap"><strong>${esc(r.title || m.name)}</strong>
              <div class="row-flex">${locked ? `<span class="chip">${r.played ? 'Played' : 'Running'}</span>` : ''}
                <button type="button" class="btn ghost small" data-rmove="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
                <button type="button" class="btn ghost small" data-rmove="1" ${i === rd.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
                <button type="button" class="btn ghost small" data-rdup>Duplicate</button>
                <button type="button" class="btn ghost small" data-rdel style="color:var(--gules)">Delete</button></div></div>
            <div class="fields">
              <label class="field" style="grid-column:span 2"><span>Mode</span><select data-f="mode">${modeOptions(r.mode)}</select></label>
              <label class="field"><span>Title (optional)</span><input type="text" data-f="title" value="${esc(r.title)}" placeholder="${esc(m.name)}" maxlength="60"></label>
              <label class="field"><span>Time limit (seconds)</span><input type="number" data-f="duration" value="${r.duration}" min="10" max="3600" step="10"></label>
              <label class="field"><span>Points multiplier</span><input type="number" data-f="multiplier" value="${r.multiplier}" min="0" max="100" step="0.5"></label>
              ${m.params.map((p) => `<label class="field"><span>${esc(p.label)}</span><input type="number" data-p="${p.key}" value="${r.params && r.params[p.key] !== undefined ? r.params[p.key] : p.default}" min="${p.min}" max="${p.max}" step="${p.step}"></label>`).join('')}
            </div>
            ${m.primesOnly ? '' : `<label class="check"><input type="checkbox" data-f="primesOnly" ${r.primesOnly ? 'checked' : ''}><span>Add the primes-only twist (every castle needs a prime number of soldiers, or none)</span></label>`}
            <p class="small muted">${esc(m.blurb)}</p>
          </fieldset></section>`;
      }).join('')}</div>
      <div class="control"><button class="btn soft" id="addRound" type="button">Add round</button></div>
      ${roundsDirty ? '<div class="savebar"><span class="small grow">You have unsaved changes to the rounds.</span><button class="btn ghost small" id="discardRounds" type="button">Discard</button><button class="btn" id="saveRounds" type="button">Save rounds</button></div>' : ''}
      <section class="panel stack"><h2>Mode library</h2><div class="mode-lib">${S.modes.map((m) => `<div class="tile stack"><div class="spread"><strong>${esc(m.name)}</strong><span class="src">${SOURCES[m.source]}</span></div><div class="small muted">${esc(m.style)}</div><p class="small">${esc(m.blurb)}</p></div>`).join('')}</div></section>
    </div>`;
  }
  function markDirty() { roundsDirty = true; const bar = $('.savebar'); if (!bar) { pending = false; const y = window.scrollY; renderMainKeepFocus(); window.scrollTo(0, y); } }
  function renderMainKeepFocus() {
    const a = document.activeElement, sel = a && a.closest && a.closest('[data-i]');
    const i = sel && sel.dataset.i, f = a && (a.dataset.f || a.dataset.p), isP = a && a.dataset.p;
    renderMain();
    if (i !== undefined && f) { const el = $(`#roundsEd [data-i="${i}"] [data-${isP ? 'p' : 'f'}="${f}"]`); if (el) { el.focus(); if (el.setSelectionRange && el.type === 'text') el.setSelectionRange(el.value.length, el.value.length); } }
  }

  // ----- settings -----
  function settingsView() {
    const s = settingsDraft;
    return `<div class="grid2"><div class="stack-lg">
      <section class="panel stack"><h2>Game settings</h2>
        <form class="stack" id="settingsForm">
          <label class="field"><span>Game title</span><input type="text" name="title" value="${esc(s.title)}" maxlength="40"></label>
          <label class="field"><span>Soldiers per player each round</span><input type="number" name="soldiers" value="${s.soldiers}" min="10" max="1000" ${S.status === 'active' || S.status === 'paused' || S.status === 'briefing' ? 'disabled' : ''}></label>
          <label class="field"><span>Rules countdown before each round (seconds, 0 = start at once)</span><input type="number" name="briefingSeconds" value="${s.briefingSeconds ?? 30}" min="0" max="300"></label>
          <label class="field"><span>Players who don’t submit</span><select name="nonSubmit">
            <option value="exclude" ${s.nonSubmit === 'exclude' ? 'selected' : ''}>Sit the round out (recommended)</option>
            <option value="zero" ${s.nonSubmit === 'zero' ? 'selected' : ''}>Play with an empty army (gives everyone free points)</option></select></label>
          <label class="check"><input type="checkbox" name="autoReveal" ${s.autoReveal ? 'checked' : ''}><span>Show results as soon as time runs out<br><span class="small muted">Turn off to reveal each round yourself, for suspense.</span></span></label>
          <label class="check"><input type="checkbox" name="allowJoin" ${s.allowJoin ? 'checked' : ''}><span>Let new players join</span></label>
          <label class="check"><input type="checkbox" name="showTeammates" ${s.showTeammates ? 'checked' : ''}><span>Players can see their teammates’ submitted armies</span></label>
          <label class="field"><span>Join address shown to players (optional)</span><input type="url" name="publicUrl" value="${esc(s.publicUrl)}" placeholder="${esc(S.lanUrls[0] || 'http://192.168.1.10:3000')}">
            <span class="tiny muted" style="display:block;margin-top:4px">Leave empty to use this laptop’s Wi-Fi address. Fill it in if you use a tunnel or a different network.</span></label>
          <div class="control"><button class="btn" type="submit">Save settings</button></div>
        </form></section>
      <section class="panel stack"><h2>Start over</h2><p class="small muted">Clear all scores and submissions. Teams, table codes and rounds stay as they are. The room code changes, so old links can’t be used to join.</p>
        <div class="control"><button class="btn ghost small" data-act="game/reset" data-confirm="Clear all scores and submissions? Players stay at their tables. A new room code is made." data-msg="Scores cleared">Clear scores, keep players</button>
        <button class="btn danger small" data-act="game/reset" data-body='{"removePlayers":true}' data-confirm="Clear all scores AND remove every player? Teams and table codes stay. A new room code is made, so everyone must join again with it." data-msg="Game reset">Clear scores and players</button></div></section>
    </div><div class="stack-lg">
      <section class="panel stack"><h2>Saved configs</h2><p class="small muted">A config stores the rounds, the settings and (optionally) the teams with their codes, so you can reuse them at the next event.</p>
        <form class="row-flex wrap" id="savePreset"><input type="text" id="presetName" placeholder="Config name, e.g. Math Club night" maxlength="60" style="flex:1;min-width:180px"><button class="btn" type="submit">Save current</button></form>
        <label class="check"><input type="checkbox" id="presetTeams" checked><span>Include teams and their codes</span></label>
        <div>${S.presets.length ? S.presets.map((p) => `<div class="plan-row" style="grid-template-columns:1fr auto"><div><strong>${esc(p.name)}</strong><div class="tiny muted">${p.rounds} rounds, ${p.teams} teams${p.savedAt ? `, saved ${new Date(p.savedAt).toLocaleString()}` : ''}</div></div>
          <div class="row-flex"><button class="btn soft small" data-loadp="${esc(p.file)}">Load</button><button class="linkbtn small" data-dlp="${esc(p.file)}">Download</button><button class="linkbtn small" style="color:var(--gules)" data-act="presets/delete" data-body='${JSON.stringify({ file: p.file })}' data-confirm="Delete the config “${esc(p.name)}”?">Delete</button></div></div>`).join('') : '<p class="small muted">No saved configs yet.</p>'}</div>
        <label class="check"><input type="checkbox" id="loadTeams" ${loadTeams ? 'checked' : ''}><span>When loading, also replace teams and codes<br><span class="small muted">Players on teams that no longer exist are removed.</span></span></label>
        <div class="control"><button class="btn ghost small" id="exportCur">Download current config</button><label class="btn ghost small" style="cursor:pointer">Import config file<input type="file" id="importFile" accept="application/json,.json" class="hidden"></label></div>
      </section>
      <section class="panel stack"><h2>Backup</h2><p class="small muted">A full copy of the game: teams, codes, players, every round and score, and saved configs. This dashboard also keeps the latest copy in this browser automatically, so if the server restarts you can bring the game back with one click.</p>
        <div class="control"><button class="btn ghost small" id="dlBackup">Download backup</button><label class="btn ghost small" style="cursor:pointer">Restore from file<input type="file" id="restoreFile" accept="application/json,.json" class="hidden"></label></div></section>
      <section class="panel stack"><h2>About this server</h2><div class="kv"><span class="muted">Players join at</span><strong>${esc(S.joinUrl)}</strong><span class="muted">Board</span><span>${esc(location.origin)}/board</span>
        <span class="muted">Sent since start</span><span>${(S.traffic.bytes / 1048576).toFixed(1)} MB in ${S.traffic.requests.toLocaleString()} requests</span></div>
        <p class="tiny muted">For ngrok’s free plan (1 GB and 20,000 requests a month), open the admin page and the board on this laptop at localhost so they don’t count. Only phones go through ngrok.</p>
        <button class="linkbtn small" style="justify-self:start" id="logout">Sign out of admin</button></section>
    </div></div>`;
  }

  // ---------- events inside main ----------
  document.addEventListener('submit', async (e) => {
    if (e.target.id === 'addTeam') { e.preventDefault(); const n = $('#teamName').value; if (await act('team/add', { name: n }, 'Team added')) $('#teamName').value = ''; }
    if (e.target.id === 'settingsForm') {
      e.preventDefault();
      const f = new FormData(e.target);
      const s = { title: f.get('title'), nonSubmit: f.get('nonSubmit'), publicUrl: f.get('publicUrl'), autoReveal: f.has('autoReveal'), allowJoin: f.has('allowJoin'), showTeammates: f.has('showTeammates') };
      if (f.get('soldiers') !== null) s.soldiers = Number(f.get('soldiers'));
      if (f.get('briefingSeconds') !== null) s.briefingSeconds = Number(f.get('briefingSeconds'));
      if (await act('settings/set', { settings: s }, 'Settings saved')) { settingsDraft = null; }
    }
    if (e.target.id === 'savePreset') {
      e.preventDefault();
      const name = $('#presetName').value.trim() || S.title;
      if (await act('presets/save', { name, includeTeams: $('#presetTeams').checked }, `Saved “${name}”`)) $('#presetName').value = '';
    }
  });
  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'allowJoin') return act('settings/set', { settings: { allowJoin: t.checked } }, t.checked ? 'Joining is open' : 'Joining is closed');
    if (t.id === 'loadTeams') { loadTeams = t.checked; return; }
    const tc = t.closest('[data-team]');
    if (tc && t.dataset.tf) return act('team/update', { id: tc.dataset.team, [t.dataset.tf]: t.value });
    if (t.dataset.move) return act('player/move', { id: t.dataset.move, teamId: t.value }, 'Player moved');
    if (t.id === 'restoreFile' && t.files[0]) {
      try {
        const backup = JSON.parse(await t.files[0].text());
        if (confirm('Replace the current game with this backup?') && await act('restore', { backup }, 'Game restored')) { roundsDirty = false; settingsDraft = null; }
      } catch { toast('That file isn’t valid JSON.', true); }
      t.value = '';
    }
    if (t.id === 'importFile' && t.files[0]) {
      try {
        const preset = JSON.parse(await t.files[0].text());
        if (await act('presets/import', { preset, includeTeams: loadTeams }, 'Config imported')) { roundsDirty = false; settingsDraft = null; }
      } catch { toast('That file isn’t valid JSON.', true); }
      t.value = '';
    }
    const ed = t.closest('#roundsEd [data-i]');
    if (ed && t.dataset.f === 'mode') {
      const r = roundsDraft[+ed.dataset.i];
      r.mode = t.value; r.params = {};
      if (S.modes.find((m) => m.id === r.mode).primesOnly) r.primesOnly = false;
      roundsDirty = true; pending = false; renderMain();
    } else if (ed && t.dataset.f === 'primesOnly') { roundsDraft[+ed.dataset.i].primesOnly = t.checked; markDirty(); }
  });
  document.addEventListener('input', (e) => {
    const t = e.target, ed = t.closest && t.closest('#roundsEd [data-i]');
    if (!ed) return;
    const r = roundsDraft[+ed.dataset.i];
    if (t.dataset.f === 'title') r.title = t.value;
    else if (t.dataset.f === 'duration') r.duration = Number(t.value);
    else if (t.dataset.f === 'multiplier') r.multiplier = Number(t.value);
    else if (t.dataset.p) { r.params = r.params || {}; r.params[t.dataset.p] = Number(t.value); }
    else return;
    markDirty();
  });
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const ed = t.closest('#roundsEd [data-i]');
    if (ed) {
      const i = +ed.dataset.i;
      if (t.closest('[data-rmove]')) { const d = +t.closest('[data-rmove]').dataset.rmove; [roundsDraft[i], roundsDraft[i + d]] = [roundsDraft[i + d], roundsDraft[i]]; roundsDirty = true; renderMain(); }
      else if (t.closest('[data-rdup]')) { const c = clone(roundsDraft[i]); delete c.id; c.played = false; c.current = false; roundsDraft.splice(i + 1, 0, c); roundsDirty = true; renderMain(); }
      else if (t.closest('[data-rdel]')) { roundsDraft.splice(i, 1); roundsDirty = true; renderMain(); }
      return;
    }
    if (t.id === 'addRound') { roundsDraft.push({ mode: 'classic', title: '', duration: 120, multiplier: 1, primesOnly: false, params: {} }); roundsDirty = true; renderMain(); }
    if (t.id === 'discardRounds') { roundsDirty = false; roundsDraft = clone(S.rounds); renderMain(); }
    if (t.id === 'saveRounds') {
      const rounds = roundsDraft.map(({ id, mode, title, duration, multiplier, primesOnly, params }) => ({ id, mode, title, duration, multiplier, primesOnly, params }));
      if (await act('rounds/set', { rounds }, 'Rounds saved')) { roundsDirty = false; }
    }
    if (t.id === 'bulk') { await act('team/bulk', { count: 4 }, 'Added 4 tables'); }
    if (t.id === 'printCards') printCards();
    if (t.id === 'logout') logout();
    if (t.id === 'restoreLocal') { if (await act('restore', { backup: readBackup() }, 'Game restored')) { roundsDirty = false; settingsDraft = null; } }
    if (t.id === 'dlBackup') download(`castle-strategy-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`, await api('/api/admin/backup', { headers: { 'x-admin-key': key } }));
    if (t.id === 'exportCur') download(`castle-strategy-config.json`, await api('/api/admin/export?teams=1', { headers: { 'x-admin-key': key } }));
    if (t.dataset.dlp) download(`${t.dataset.dlp}.json`, await api('/api/admin/preset?file=' + encodeURIComponent(t.dataset.dlp), { headers: { 'x-admin-key': key } }));
    if (t.dataset.loadp) {
      if (roundsDirty && !confirm('Loading replaces your unsaved round changes. Continue?')) return;
      if (!confirm(loadTeams ? 'Load this config, including its teams and codes?' : 'Load this config’s rounds and settings? Played rounds are kept.')) return;
      if (await act('presets/load', { file: t.dataset.loadp, includeTeams: loadTeams }, 'Config loaded')) { roundsDirty = false; settingsDraft = null; }
    }
    if (t.dataset.setcode) {
      const c = prompt('New 4-digit code for this team:');
      if (c !== null) act('team/update', { id: t.dataset.setcode, code: c.trim() }, 'Code updated');
    }
  });
  function download(name, obj) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- printable table cards ----------
  function printCards() {
    if (!S.adminTeams.length) { toast('Add teams first.', true); return; }
    const base = S.joinUrl.replace(/\/$/, '');
    const cards = S.adminTeams.map((t) => `<div class="card"><div class="bar" style="background:${esc(t.color)}"></div>
      <div class="team">${esc(t.name)}</div><div class="code">${esc(t.code)}</div>
      <div class="qr">${qr(`${base}/?code=${t.code}`)}</div>
      <p>Scan, or open <b>${esc(base)}</b><br>and enter the room code from the big screen,<br>table code <b>${esc(t.code)}</b> and your name.</p></div>`).join('');
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print the cards.', true); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Table cards</title><style>
      body{font-family:ui-rounded,"SF Pro Rounded",system-ui,sans-serif;margin:0;padding:16px;color:#1C2434}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .card{border:2px solid #D3DAE4;border-radius:18px;padding:18px;text-align:center;break-inside:avoid;page-break-inside:avoid}
      .bar{height:10px;border-radius:6px;margin-bottom:12px}.team{font-size:24px;font-weight:800}
      .code{font-size:64px;font-weight:900;letter-spacing:.15em;margin:4px 0}
      .qr{width:150px;margin:0 auto}p{font-size:13px;color:#5B6578;margin:10px 0 0}
      @media print{body{padding:0}.noprint{display:none}}</style></head><body>
      <p class="noprint" style="text-align:center"><button onclick="print()" style="font-size:16px;padding:8px 18px">Print</button></p>
      <div class="grid">${cards}</div></body></html>`);
    w.document.close();
  }

  // ---------- timer ----------
  function tick() {
    if (!S) return;
    const ms = remaining(S);
    document.querySelectorAll('[data-timer]').forEach((el) => {
      el.textContent = clock(ms) + (S.status === 'paused' ? ' paused' : '');
      el.classList.toggle('low', S.status === 'active' && ms <= 10000);
    });
  }
  setInterval(tick, 250);
  if (key) connect(); else renderLogin();
})();
