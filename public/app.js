// Castle Clash — player app (phones)
(() => {
  const { $, esc, fmt, api, live, toast, skyline, clock, remaining, shield } = CC;
  const app = $('#app'), dock = $('#dock'), dockInner = $('#dockInner');
  const N = 10;
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  const isPrime = (n) => { if (n < 2) return false; for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; };
  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
  const castleIcon = () => '<img class="waiting-castle" src="/static/logo.svg" alt="">';

  let token = ls.get('cc.token');
  let S = null, tab = 'play', key = '', draft = null, boardSel = 'overall', rulesOpen = true, sending = false, conn = null;

  function connect() {
    conn && conn.stop();
    conn = live(`/api/events?role=player&token=${encodeURIComponent(token || '')}`,
      () => api('/api/state', { headers: token ? { 'x-player-token': token } : {} }), onState);
  }
  function onState(s) {
    if (!s) return;
    S = s;
    if (token && !s.me) {
      // The server forgot everyone (e.g. a free host restarted): wait for the host to restore the game.
      if (s.fresh) { key = 'restoring'; dock.classList.add('hidden'); app.innerHTML = `<div class="join-hero"><img class="waiting-castle" src="/static/logo.svg" alt=""><h1 style="margin-top:14px">Reconnecting</h1><p class="muted" style="margin-top:8px">The game server restarted. Hold on while the host brings the game back. This page updates by itself.</p></div>`; return; }
      token = null; ls.set('cc.token', null); key = '';
    }
    render();
  }

  // ---------- render ----------
  function render() {
    if (!S) return;
    if (!S.me) { if (key !== 'join') { key = 'join'; renderJoin(); } dock.classList.add('hidden'); return; }
    const open = S.status === 'active' || S.status === 'paused';
    if (tab === 'board') { key = 'board'; renderBoard(); }
    else if (open) {
      const k = `play|${S.round.id}`;
      if (key !== k) { key = k; buildPlay(); } else patchPlay();
    } else { key = S.status; renderOther(); }
    renderDock();
    tick();
  }

  function topbar() {
    const open = S.status === 'active' || S.status === 'paused';
    const roundLine = open || S.status === 'closed'
      ? `Round ${S.playedCount + (S.status === 'closed' ? 0 : 1)} of ${S.totalRounds}`
      : S.playedCount ? `${S.playedCount} of ${S.totalRounds} rounds played` : 'Waiting to start';
    return `<header class="topbar"><div class="spread">
      <div class="who">${shield(S.me.color)}<span class="name">${esc(S.me.teamName)}</span><span class="muted name">${esc(S.me.name)}</span></div>
      ${open ? '<div class="timer" data-timer></div>' : ''}</div>
      <div class="round-line">${roundLine}</div></header>`;
  }

  function renderDock() {
    const playBtn = tab === 'play' && (S.status === 'active' || S.status === 'paused');
    dock.classList.remove('hidden');
    dockInner.innerHTML = `${playBtn ? '<button class="btn block big" id="submitBtn" type="button">Submit army</button>' : ''}
      <nav class="navbar" aria-label="Sections">
        <button class="tab" type="button" data-tab="play" aria-selected="${tab === 'play'}">Play</button>
        <button class="tab" type="button" data-tab="board" aria-selected="${tab === 'board'}">Standings</button>
      </nav>`;
    if (playBtn) updateDerived();
  }
  dock.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; key = ''; render(); window.scrollTo(0, 0); return; }
    if (e.target.closest('#submitBtn')) submit();
  });

  // ---------- join ----------
  function renderJoin() {
    const pre = new URLSearchParams(location.search).get('code') || '';
    app.innerHTML = `<div class="join-hero">${castleIcon()}<h1 style="margin-top:14px">${esc(S.title || 'Castle Clash')}</h1>
      <p class="muted" style="margin-top:8px">Enter the code on your table card, then your name.</p></div>
      <form class="panel stack" id="joinForm" autocomplete="off">
        <label class="field"><span>Table code</span><input type="text" class="code-input" id="code" inputmode="numeric" pattern="[0-9]*" maxlength="4" value="${esc(pre)}" aria-describedby="joinErr"></label>
        <label class="field"><span>Your name</span><input type="text" id="name" maxlength="24" autocomplete="nickname" autocapitalize="words" enterkeyhint="go"></label>
        <button class="btn block big" type="submit">Join table</button>
        <p id="joinErr" class="small" role="alert" style="color:var(--gules);min-height:1.2em"></p>
      </form>
      <p class="tiny muted" style="text-align:center;margin-top:16px">Switched phones? Join again with the same code and name to pick up where you left off.</p>`;
    const code = $('#code'), name = $('#name');
    code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 4); if (code.value.length === 4) name.focus(); });
    $('#joinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#joinErr'); err.textContent = '';
      if (!/^\d{4}$/.test(code.value)) { err.textContent = 'The table code has 4 digits.'; code.focus(); return; }
      if (!name.value.trim()) { err.textContent = 'Enter your name.'; name.focus(); return; }
      try {
        const r = await api('/api/join', { method: 'POST', body: { code: code.value, name: name.value } });
        token = r.token; ls.set('cc.token', token); key = ''; tab = 'play';
        if (r.rejoined) toast('Welcome back');
        history.replaceState(null, '', '/');
        connect();
      } catch (ex) { err.textContent = ex.message; }
    });
  }

  // ---------- play ----------
  function valueLabel(i) {
    const r = S.round;
    if (r.hiddenValues) return '<span class="token" title="Value hidden">?</span>';
    return `<span class="token" title="${i + 1} point${i ? 's' : ''}">${i + 1}</span>`;
  }
  function hint(i) {
    const r = S.round, n = i + 1;
    if (r.mode === 'doubling' && n % 2 === 0) return `×2 with castle ${n / 2}`;
    if (r.mode === 'beauty') return 'value set by the room';
    if (r.mode === 'shuffled') return 'value hidden';
    return '';
  }
  function ensureDraft() {
    const r = S.round;
    if (draft && draft.roundId === r.id) return;
    let saved = null;
    try { saved = JSON.parse(ls.get('cc.draft.' + r.id) || 'null'); } catch { saved = null; }
    const base = S.mySubmission || (Array.isArray(saved) && saved.length === N ? saved : new Array(N).fill(0));
    draft = { roundId: r.id, alloc: base.map((x) => Math.max(0, Math.floor(Number(x) || 0))) };
  }
  function buildPlay() {
    ensureDraft();
    const r = S.round;
    const g = S.garrison;
    app.innerHTML = `${topbar()}
      <div class="stack-lg">
        <div id="pausedNote"></div>
        <section class="rules" aria-labelledby="rt">
          <div class="spread"><h2 id="rt">${esc(r.title)}</h2><button class="linkbtn small" id="rulesToggle" type="button" aria-expanded="${rulesOpen}">${rulesOpen ? 'Hide rules' : 'Show rules'}</button></div>
          <div id="rulesBody" class="${rulesOpen ? '' : 'hidden'}">
            ${r.title !== r.modeName ? `<p><strong>${esc(r.modeName)}</strong></p>` : ''}
            <p>${esc(r.blurb)}</p>
            ${r.multiplier !== 1 ? `<p><span class="chip gold">This round is worth ×${fmt(r.multiplier)}</span></p>` : ''}
            ${r.usesHistory ? `<p class="small">${g && g.some((x) => x > 0) ? 'Your stationed soldiers are shown on each castle.' : 'You have no soldiers stationed from last round.'}</p>` : ''}
          </div>
        </section>
        <section class="panel" aria-label="Your army">
          <div class="spread" style="align-items:flex-end">
            <div><div class="left-count num" id="leftCount">0</div><div class="small muted" id="leftLabel"></div></div>
            <button class="btn ghost small" id="clearBtn" type="button">Clear</button>
          </div>
          <div id="sky" style="margin-top:12px"></div>
        </section>
        <section class="castles" id="castles" aria-label="Castles">
          ${Array.from({ length: N }, (_, i) => `
            <div class="crow" data-i="${i}">
              <div><div class="cname row-flex" style="gap:8px">${valueLabel(i)}<span>Castle ${i + 1}</span></div>
                ${hint(i) || (g && g[i]) ? `<div class="cmeta">${hint(i) ? `<span>${hint(i)}</span>` : ''}${g && g[i] ? `<span>+${g[i]} stationed</span>` : ''}</div>` : ''}</div>
              <div class="stepper">
                <button type="button" data-step="-1" aria-label="Fewer soldiers on castle ${i + 1}">−</button>
                <input type="text" inputmode="numeric" pattern="[0-9]*" value="${draft.alloc[i]}" data-i="${i}" aria-label="Soldiers on castle ${i + 1}">
                <button type="button" data-step="1" aria-label="More soldiers on castle ${i + 1}">+</button>
              </div>
            </div>`).join('')}
        </section>
        <p class="small muted" style="text-align:center">You can change your army until the timer runs out.</p>
        <section class="panel stack" id="mates"></section>
      </div>`;
    $('#rulesToggle').addEventListener('click', () => {
      rulesOpen = !rulesOpen;
      $('#rulesBody').classList.toggle('hidden', !rulesOpen);
      $('#rulesToggle').textContent = rulesOpen ? 'Hide rules' : 'Show rules';
      $('#rulesToggle').setAttribute('aria-expanded', rulesOpen);
    });
    $('#clearBtn').addEventListener('click', () => { draft.alloc.fill(0); syncInputs(); updateDerived(); });
    const box = $('#castles');
    box.addEventListener('input', (e) => {
      const inp = e.target.closest('input'); if (!inp) return;
      const digits = inp.value.replace(/\D/g, '').slice(0, 4);
      if (digits !== inp.value) inp.value = digits;
      draft.alloc[+inp.dataset.i] = digits ? parseInt(digits, 10) : 0;
      updateDerived();
    });
    box.addEventListener('focusin', (e) => { const inp = e.target.closest('input'); if (inp) setTimeout(() => inp.select(), 0); });
    box.addEventListener('focusout', (e) => { const inp = e.target.closest('input'); if (inp) inp.value = draft.alloc[+inp.dataset.i]; });
    // press-and-hold steppers
    let holdT = null, repT = null;
    const stop = () => { clearTimeout(holdT); clearInterval(repT); holdT = repT = null; };
    box.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button[data-step]'); if (!b) return;
      e.preventDefault();
      const i = +b.closest('.crow').dataset.i, d = +b.dataset.step;
      step(i, d);
      holdT = setTimeout(() => { repT = setInterval(() => step(i, d), 70); }, 380);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => box.addEventListener(ev, stop));
    box.addEventListener('keydown', (e) => {
      const b = e.target.closest('button[data-step]');
      if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); step(+b.closest('.crow').dataset.i, +b.dataset.step); }
    });
    patchPlay();
  }
  function step(i, d) {
    const v = draft.alloc[i];
    let n;
    if (S.round.primesOnly) {
      if (d > 0) { n = v + 1; while (!isPrime(n)) n++; }
      else { n = v - 1; while (n > 0 && !isPrime(n)) n--; n = Math.max(0, n); }
    } else n = Math.max(0, v + d);
    draft.alloc[i] = n;
    const inp = $(`#castles input[data-i="${i}"]`); if (inp) inp.value = n;
    updateDerived();
  }
  function syncInputs() { $('#castles') && draft.alloc.forEach((v, i) => { const inp = $(`#castles input[data-i="${i}"]`); if (inp && document.activeElement !== inp) inp.value = v; }); }

  function validation() {
    const r = S.round, sold = S.soldiers, tot = draft.alloc.reduce((a, b) => a + b, 0);
    const bad = r.primesOnly ? draft.alloc.map((x, i) => (x !== 0 && !isPrime(x) ? i : -1)).filter((i) => i >= 0) : [];
    let msg = null;
    if (tot > sold) msg = `Remove ${tot - sold} soldier${tot - sold === 1 ? '' : 's'}`;
    else if (r.budget === 'exact' && tot < sold) msg = `Place ${sold - tot} more`;
    else if (bad.length) msg = `Castle ${bad[0] + 1} needs a prime number`;
    return { tot, bad, msg };
  }
  function updateDerived() {
    if (!draft || !S.round) return;
    const r = S.round, sold = S.soldiers, v = validation();
    const lc = $('#leftCount'), ll = $('#leftLabel');
    if (lc) {
      const left = sold - v.tot;
      lc.className = 'left-count num' + (left < 0 ? ' over' : left === 0 && r.budget === 'exact' ? ' done' : '');
      if (left < 0) { lc.textContent = -left; ll.textContent = 'too many soldiers'; }
      else if (r.budget === 'atMost') { lc.textContent = left; ll.textContent = `kept home, earning ${fmt(r.params.rate)} each per matchup`; }
      else if (left === 0) { lc.textContent = sold; ll.textContent = 'all soldiers placed'; }
      else { lc.textContent = left; ll.textContent = `of ${sold} soldiers left to place`; }
    }
    const g = S.garrison;
    const army = draft.alloc.map((x, i) => x + (g ? g[i] : 0));
    const sky = $('#sky'); if (sky) sky.innerHTML = skyline({ alloc: army, color: S.me.color, max: Math.max(30, ...army), height: 100 });
    document.querySelectorAll('#castles .crow').forEach((row, i) => row.classList.toggle('bad', v.bad.includes(i)));
    try { ls.set('cc.draft.' + r.id, JSON.stringify(draft.alloc)); } catch { /* ignore */ }
    const btn = $('#submitBtn');
    if (btn) {
      const submitted = S.mySubmission, isSame = same(submitted, draft.alloc);
      btn.className = 'btn block big' + (isSame ? ' ok' : '');
      if (v.msg) { btn.disabled = true; btn.textContent = v.msg; }
      else if (isSame) { btn.disabled = true; btn.textContent = 'Army submitted ✓'; }
      else { btn.disabled = sending; btn.textContent = submitted ? 'Update army' : 'Submit army'; }
    }
  }
  async function submit() {
    if (sending || validation().msg) return;
    sending = true; updateDerived();
    const had = !!S.mySubmission;
    try {
      await api('/api/submit', { method: 'POST', body: { alloc: draft.alloc }, headers: { 'x-player-token': token } });
      S.mySubmission = draft.alloc.slice();
      toast(had ? 'Army updated' : 'Army submitted');
      if (navigator.vibrate) navigator.vibrate(30);
    } catch (e) { toast(e.message, true); }
    sending = false; updateDerived();
  }

  function patchPlay() {
    const pn = $('#pausedNote');
    if (pn) pn.innerHTML = S.status === 'paused' ? '<div class="tile" style="text-align:center;font-weight:700">The host paused the timer. You can still edit your army.</div>' : '';
    const mates = $('#mates');
    if (mates) {
      const totalIn = Object.values(S.submissions).reduce((a, t) => a + t.done, 0);
      const totalAll = Object.values(S.submissions).reduce((a, t) => a + t.total, 0);
      let html = `<div class="spread"><h3>Your table</h3><span class="small muted num">${totalIn} of ${totalAll} armies in</span></div>`;
      if (!S.teammates.length) html += '<p class="small muted">No teammates have joined yet.</p>';
      html += S.teammates.map((m) => `<div class="mate"><div><strong>${esc(m.name)}</strong></div>
        <span class="chip ${m.submitted ? 'ok' : ''}">${m.submitted ? 'Submitted' : 'Thinking'}</span>
        ${m.alloc ? `<div style="grid-column:1/-1">${skyline({ alloc: m.alloc, color: S.me.color, height: 80, max: Math.max(30, ...m.alloc) })}</div>` : ''}</div>`).join('');
      if (S.round.teamLevel) {
        const armies = [...S.teammates.filter((m) => m.alloc).map((m) => m.alloc), ...(S.mySubmission ? [S.mySubmission] : [])];
        if (armies.length) {
          const avg = Array.from({ length: N }, (_, i) => Math.round(armies.reduce((a, x) => a + x[i], 0) / armies.length * 10) / 10);
          html += `<div><h3 style="margin-top:6px">Alliance army so far</h3><p class="tiny muted">Average of ${armies.length} submitted ${armies.length === 1 ? 'army' : 'armies'}.</p>${skyline({ alloc: avg, color: S.me.color, height: 100 })}</div>`;
        }
      }
      mates.innerHTML = html;
    }
    if (draft && S.round && draft.roundId === S.round.id) updateDerived();
  }

  // ---------- lobby / closed / results ----------
  function renderOther() {
    const st = S.status;
    let body = '';
    if (st === 'lobby') {
      body = `<section class="panel stack" style="text-align:center">${castleIcon(S.me.color)}
        <h1>You’re in, ${esc(S.me.name)}</h1>
        <p class="muted">You’re playing for <strong style="color:var(--ink)">${esc(S.me.teamName)}</strong>. The first round starts when the host is ready.</p></section>
        ${matesList()}
        ${rulesPrimer()}`;
    } else if (st === 'closed') {
      body = `<section class="panel stack" style="text-align:center">${castleIcon(S.me.color)}<h1>Time’s up</h1>
        <p class="muted">Scores are in. Results appear here when the host reveals them.</p></section>
        ${S.mySubmission ? `<section class="panel"><h3>Your army</h3>${skyline({ alloc: S.mySubmission, color: S.me.color })}</section>` : '<section class="tile small" style="text-align:center">You didn’t submit an army this round.</section>'}`;
    } else {
      body = resultsView();
    }
    CC.setHTML(app, topbar() + `<div class="stack-lg">${body}</div>`);
  }
  function matesList() {
    return `<section class="panel stack"><h3>Your table</h3>${S.teammates.length
      ? S.teammates.map((m) => `<div class="row-flex">${shield(S.me.color)}<span>${esc(m.name)}</span></div>`).join('')
      : '<p class="small muted">Nobody else has joined your table yet.</p>'}</section>`;
  }
  function rulesPrimer() {
    return `<section class="rules"><h2>How it works</h2>
      <p>Each round you get ${S.soldiers} soldiers to share across 10 castles. Castle i is usually worth i points.</p>
      <p>Your army fights every player at the other tables. Whoever has more soldiers at a castle takes its points.</p>
      <p>Your table’s score for a round is its best player’s score. Each round may bend the rules, so read them when it starts.</p></section>`;
  }
  function resultsView() {
    const rounds = S.board.rounds;
    const last = rounds[rounds.length - 1];
    const mine = S.myResults.find((x) => last && x.roundId === last.roundId);
    if (!last) return `<section class="panel">${castleIcon(S.me.color)}<p class="muted" style="text-align:center">Waiting for the next round.</p></section>`;
    const teamRow = last.teams.find((t) => t.teamId === S.me.teamId);
    const overall = S.board.overall.find((t) => t.teamId === S.me.teamId);
    const hidden = last.mode === 'beauty' || last.mode === 'shuffled';
    let html = `<section class="panel stack" style="text-align:center">
      <p class="round-line">${esc(last.title)} results</p>`;
    if (mine && mine.me) {
      html += `<div class="big-score num">${fmt(mine.me.score)}</div><p class="muted">your points this round</p>
        <div class="row-flex" style="margin-top:12px">
          <div class="stat"><b class="num">${mine.me.won}</b><span class="tiny muted">won</span></div>
          <div class="stat"><b class="num">${mine.me.lost}</b><span class="tiny muted">lost</span></div>
          <div class="stat"><b class="num">${mine.me.drawn}</b><span class="tiny muted">drawn</span></div>
        </div>
        <p class="tiny muted">${last.mode === 'alliance' ? 'Your table fought as one army.' : `Out of ${mine.me.opponents} opponents.`}</p>`;
    } else {
      html += '<h2>You sat this one out</h2><p class="muted small">Submit an army next round to score.</p>';
    }
    html += '</section>';
    if (mine && mine.me) {
      html += `<section class="panel stack"><h3>Your army against the room</h3>
        <div class="legend"><span><i style="background:${esc(S.me.color)}"></i>You</span><span><i style="background:var(--room)"></i>Room average</span></div>
        ${skyline({ alloc: mine.me.army, ghost: last.avgAlloc, color: S.me.color, values: hidden ? last.values : null })}
        ${hidden ? '<p class="tiny muted">Gold numbers are the castle values that were revealed.</p>' : ''}</section>`;
    }
    if (teamRow) {
      const alliance = last.mode === 'alliance';
      html += `<section class="panel stack"><div class="spread"><div class="row-flex">${shield(S.me.color)}<h3>${esc(S.me.teamName)}</h3></div><span class="chip">${ordinal(teamRow.rank)} this round</span></div>
        <div class="spread"><span class="muted">Table score</span><strong class="num" style="font-size:1.4rem">${fmt(teamRow.score)}</strong></div>
        ${overall ? `<div class="spread"><span class="muted">Overall</span><strong>${ordinal(overall.rank)} with ${fmt(overall.total)}</strong></div>` : ''}
        <div>${teamRow.members.map((m, i) => `<div class="member"${m.playerId === S.me.id ? ' style="background:var(--azure-soft);margin:0 -8px;padding:8px;border-radius:12px;border-top-color:transparent"' : ''}>
          <span><strong>${esc(m.name)}</strong>${m.playerId === S.me.id ? ' <span class="tiny muted">you</span>' : ''}${!alliance && i === 0 ? ' <span class="counted tiny">counted</span>' : ''}</span>
          <span class="num small"><strong>${fmt(m.score)}</strong> <span class="muted tiny">${m.won}W ${m.lost}L ${m.drawn}D</span></span>
          <div class="sky">${skyline({ alloc: m.army, color: S.me.color, height: 80, max: Math.max(30, ...m.army) })}</div></div>`).join('')}</div>
        ${alliance ? '<p class="tiny muted">Grand Alliance: everyone shares the table score.</p>' : ''}</section>`;
    }
    html += `<section class="panel stack"><h3>Every table’s best strategy</h3><p class="tiny muted">Tap a table to see all of its players.</p>${CC.teamCards(last, S.me.teamId, { height: 84 })}</section>`;
    html += S.finished
      ? `<section class="rules" style="text-align:center"><h2>That was the last round</h2><p>${overall ? `${esc(S.me.teamName)} finished ${ordinal(overall.rank)}.` : ''} Check Standings for the final table.</p></section>`
      : '<p class="small muted" style="text-align:center">The next round starts when the host is ready.</p>';
    return html;
  }

  // ---------- standings ----------
  function renderBoard() {
    const rounds = S.board.rounds;
    if (boardSel !== 'overall' && !rounds.find((r) => r.roundId === boardSel)) boardSel = 'overall';
    const sel = rounds.find((r) => r.roundId === boardSel);
    CC.setHTML(app, topbar() + `<div class="stack-lg">
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" data-sel="overall" aria-selected="${boardSel === 'overall'}">Overall</button>
        ${rounds.map((r) => `<button class="tab" role="tab" data-sel="${r.roundId}" aria-selected="${boardSel === r.roundId}">Round ${r.n}</button>`).join('')}
      </div>
      <section class="panel">${sel ? CC.roundDetail(sel, S.me.teamId) : `<h3 style="margin-bottom:6px">Overall standings</h3>${rounds.length ? '' : '<p class="small muted" style="margin-bottom:8px">Scores appear here after the first round.</p>'}${CC.overallTable(S.board, S.me.teamId, { members: true, totalFirst: true })}`}</section>
      <p style="text-align:center"><button class="linkbtn small" id="leaveBtn" type="button">Leave ${esc(S.me.teamName)}</button></p>
    </div>`);
    app.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-sel]'); if (b) { boardSel = b.dataset.sel; renderBoard(); } });
    $('#leaveBtn').addEventListener('click', async () => {
      if (!confirm('Leave your table? You can join again with a code.')) return;
      try { await api('/api/leave', { method: 'POST', headers: { 'x-player-token': token } }); } catch { /* ignore */ }
      token = null; ls.set('cc.token', null); key = ''; tab = 'play'; connect();
    });
  }

  // ---------- timer ----------
  function tick() {
    if (!S) return;
    const ms = remaining(S);
    document.querySelectorAll('[data-timer]').forEach((el) => {
      el.textContent = S.status === 'paused' ? `${clock(ms)} paused` : clock(ms);
      el.classList.toggle('low', S.status === 'active' && ms <= 10000);
      el.classList.toggle('paused', S.status === 'paused');
    });
  }
  setInterval(tick, 250);
  connect();
})();
