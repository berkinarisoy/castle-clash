// Castle Clash — shared client helpers
const CC = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => { const x = Math.round((Number(n) || 0) * 100) / 100; return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0$/, ''); };

  let offset = 0;
  function sync(state) { if (state && state.now) offset = state.now - Date.now(); }
  function remaining(state) {
    if (!state) return 0;
    if (state.status === 'active' && state.endsAt) return Math.max(0, state.endsAt - (Date.now() + offset));
    if (state.status === 'paused') return state.remainingMs || 0;
    return 0;
  }
  const clock = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  async function api(path, { method = 'GET', body, headers = {} } = {}) {
    const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
    return data;
  }

  // Live state: Server-Sent Events, with polling as a fallback.
  // Cloudflare quick tunnels don't carry Server-Sent Events, so there we poll every 2 s.
  const POLL_ONLY = /\.trycloudflare\.com$/i.test(location.hostname);
  function live(sseUrl, pollFn, onState) {
    let es = null, alive = false, stopped = false, lastBoard = null;
    // The server leaves out the standings when they haven't changed, to save data.
    const handle = (s) => {
      if (s && typeof s === 'object') { if ('board' in s) lastBoard = s.board; else s.board = lastBoard || { rounds: [], overall: [], topScores: [] }; }
      sync(s); onState(s);
    };
    const poll = async () => { try { handle(await pollFn()); } catch (e) { if (e.status === 401) onState(null, e); } };
    if (!POLL_ONLY && typeof EventSource === 'function') {
      es = new EventSource(sseUrl);
      es.addEventListener('state', (ev) => { alive = true; handle(JSON.parse(ev.data)); });
      es.onerror = () => { alive = false; };
    } else poll();
    const pollTimer = setInterval(() => { if (!alive && !stopped) poll(); }, POLL_ONLY ? 2000 : 4000);
    // Render's free plan sleeps when it gets no requests; a tiny request every 4 minutes keeps the game awake.
    const pingTimer = /\.onrender\.com$/i.test(location.hostname) ? setInterval(() => { fetch('/api/ping').catch(() => {}); }, 240000) : null;
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !stopped) poll(); });
    return { stop() { stopped = true; es && es.close(); clearInterval(pollTimer); clearInterval(pingTimer); }, poll };
  }

  let toastTimer;
  function toast(msg, bad = false) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.toggle('bad', bad); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // One tower with battlements and a square door.
  function tower(x, w, y, h, color) {
    if (h <= 0) return `<rect x="${x}" y="${y - 2}" width="${w}" height="2" fill="var(--line)"/>`;
    const mw = w / 5, ground = y + h;
    let s = `<g class="tower" fill="${color}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
    for (const k of [0, 2, 4]) s += `<rect x="${x + k * mw}" y="${y - mw}" width="${mw}" height="${mw + .5}"/>`;
    const d = Math.max(3, w * .3);
    if (h > d + 5) s += `<rect x="${x + (w - d) / 2}" y="${ground - d}" width="${d}" height="${d}" fill="var(--paper)" opacity=".85"/>`;
    return s + '</g>';
  }

  // A row of ten castles. Height = soldiers.
  // With `ghost` (e.g. the room's average), each castle shows two towers side by side.
  function skyline({ alloc = [], ghost = null, color = 'var(--azure)', ghostColor = 'var(--room)', max = null, counts = true, values = null, height = 130 } = {}) {
    const n = 10, slot = 30, top = 16, ground = height - (values ? 30 : 16);
    const all = [...alloc, ...(ghost || [])].map(Number).filter(Number.isFinite);
    const M = max || Math.max(20, ...all);
    const hOf = (v) => (v > 0 ? 4 + (Math.min(v, M) / M) * (ground - top - 8) : 0);
    const label = (cx, y, v, size, fill) => `<text x="${cx}" y="${Math.max(10, y - 6)}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${fill}">${v > 0 ? fmt(Math.round(v * 10) / 10) : ''}</text>`;
    let s = `<svg class="skyline" viewBox="0 0 ${n * slot} ${height}" role="img" aria-label="Soldiers per castle: ${alloc.map((v) => fmt(v)).join(', ')}">`;
    s += `<line x1="0" x2="${n * slot}" y1="${ground + .5}" y2="${ground + .5}" stroke="var(--line)" stroke-width="1"/>`;
    for (let i = 0; i < n; i++) {
      const v = Number(alloc[i]) || 0, h = hOf(v), cx = i * slot + slot / 2;
      if (ghost) {
        const g = Number(ghost[i]) || 0, gh = hOf(g), w = 11.5;
        s += tower(i * slot + 3, w, ground - h, h, color);
        s += tower(i * slot + 15.5, w, ground - gh, gh, ghostColor);
        if (counts) s += label(i * slot + 3 + w / 2, ground - h, v, 8, 'var(--ink)') + label(i * slot + 15.5 + w / 2, ground - gh, Math.round(g), 8, 'var(--muted)');
      } else {
        s += tower(i * slot + 5, 20, ground - h, h, color);
        if (counts) s += label(cx, ground - h - 1, v, 10, 'var(--ink)');
      }
      s += `<text x="${cx}" y="${ground + 12}" text-anchor="middle" font-size="9" fill="var(--muted)">${i + 1}</text>`;
      if (values) s += `<text x="${cx}" y="${ground + 25}" text-anchor="middle" font-size="9" font-weight="800" fill="var(--or)">${esc(values[i])}</text>`;
    }
    return s + '</svg>';
  }

  const shield = (color) => `<span class="banner-shield" style="background:${esc(color)}" aria-hidden="true"></span>`;

  // Overall standings. With members, each team gets a row per player showing every round;
  // the score that counted for the team is highlighted and the room's best of the round is starred.
  function overallTable(board, myTeamId, { members = false, totalFirst = false } = {}) {
    if (!board.overall.length) return '<p class="muted">No teams yet.</p>';
    const rounds = board.rounds, showCols = members ? rounds.length > 0 : rounds.length > 1;
    const tops = board.topScores || [];
    const body = board.overall.map((t) => {
      let rows = `<tr${t.teamId === myTeamId ? ' style="background:var(--azure-soft)"' : ''}>
        <td class="rank${t.rank === 1 && t.total > 0 ? ' first' : ''}">${t.rank}</td>
        <td><div class="row-flex">${shield(t.color)}<strong>${esc(t.name)}</strong></div></td>
        ${totalFirst ? `<td class="r num tot"><strong>${fmt(t.total)}</strong></td>` : ''}
        ${showCols ? t.perRound.map((v) => `<td class="r num"><strong>${fmt(v)}</strong></td>`).join('') : ''}
        ${totalFirst ? '' : `<td class="r num"><strong>${fmt(t.total)}</strong></td>`}</tr>`;
      if (members && t.members && t.members.length) {
        const best = rounds.map((_, k) => Math.max(...t.members.map((m) => (m.perRound[k] == null ? -Infinity : m.perRound[k]))));
        rows += t.members.map((m) => `<tr class="sub"><td></td><td class="pname">${esc(m.name)}</td>${totalFirst ? `<td class="r num tot">${fmt(m.total)}</td>` : ''}
          ${showCols ? m.perRound.map((v, k) => {
            if (v == null) return '<td class="r">–</td>';
            const hi = v === best[k] && v > 0, star = v === tops[k] && v > 0;
            return `<td class="r num">${hi ? `<span class="hi" title="Counted for ${esc(t.name)}">${fmt(v)}</span>` : fmt(v)}${star ? '<span class="star" title="Best in the room">★</span>' : ''}</td>`;
          }).join('') : ''}
          ${totalFirst ? '' : `<td class="r num">${fmt(m.total)}</td>`}</tr>`).join('');
      }
      return rows;
    }).join('');
    const legend = members && rounds.length
      ? '<div class="legend" style="margin-top:8px"><span><i style="background:var(--or-soft);box-shadow:inset 0 0 0 1px var(--or)"></i>Counted for the team</span><span>★ Best in the room that round</span><span>Player totals are their own scores added up</span></div>' : '';
    return `<div style="overflow-x:auto"><table class="list"><thead><tr><th></th><th>${members ? 'Team and players' : 'Team'}</th>${totalFirst ? '<th class="r tot">Total</th>' : ''}${showCols ? rounds.map((r) => `<th class="r small" title="${esc(r.title)}">R${r.n}</th>`).join('') : ''}${totalFirst ? '' : '<th class="r">Total</th>'}</tr></thead><tbody>${body}</tbody></table></div>${legend}`;
  }

  // One card per team: its best strategy, and (expandable) every member's army and score.
  function teamCards(r, myTeamId, { open = false, height = 90 } = {}) {
    const max = Math.max(1, ...r.teams.map((t) => t.score));
    const alliance = r.mode === 'alliance';
    return `<div class="team-cards">${r.teams.map((t) => {
      const best = t.members[0];
      const head = `<div class="spread"><span class="row-flex"><span class="rank${t.rank === 1 && t.score > 0 ? ' first' : ''}">${t.rank}</span>${shield(t.color)}<strong>${esc(t.name)}</strong></span><strong class="num" style="font-size:1.15rem">${fmt(t.score)}</strong></div>
        <div class="bar-track" style="margin:6px 0 8px"><div class="bar-fill" style="width:${(t.score / max) * 100}%;background:${esc(t.color)}"></div></div>`;
      if (!best) return `<div class="tcard" style="--team:${esc(t.color)}">${head}<p class="tiny muted">No armies from this table.</p></div>`;
      const bestArmy = alliance && t.teamArmy ? t.teamArmy : best.army;
      const caption = alliance ? `Team army, the average of ${t.members.length}` : `Best strategy: ${esc(best.name)}, ${fmt(best.score)} pts`;
      const list = t.members.map((m, i) => `<div class="member"><span><strong>${esc(m.name)}</strong>${!alliance && i === 0 ? ' <span class="counted tiny">counted</span>' : ''}</span>
          <span class="num small"><strong>${fmt(m.score)}</strong> <span class="muted tiny">${m.won}W ${m.lost}L ${m.drawn}D</span></span>
          <div class="sky">${skyline({ alloc: m.army, color: t.color, height: 78, max: Math.max(30, ...m.army) })}</div></div>`).join('');
      return `<details class="tcard${t.teamId === myTeamId ? ' mine' : ''}" data-team="${t.teamId}" style="--team:${esc(t.color)}"${open ? ' open' : ''}>
        <summary>${head}<div class="tiny muted">${caption}</div>${skyline({ alloc: bestArmy, color: t.color, height, max: Math.max(30, ...bestArmy) })}
          <span class="more more-closed">Show all ${t.members.length} player${t.members.length === 1 ? '' : 's'}</span><span class="more more-open">Hide players</span></summary>
        ${list}</details>`;
    }).join('')}</div>`;
  }

  function roundDetail(r, myTeamId) {
    const hidden = r.mode === 'beauty' || r.mode === 'shuffled';
    return `<div class="stack-lg">
      <div class="stack"><div class="spread"><h3>${esc(r.title)}</h3>${r.multiplier !== 1 ? `<span class="chip gold">×${fmt(r.multiplier)} points</span>` : ''}</div>
      <p class="small muted">${esc(r.blurb)}</p></div>
      ${teamCards(r, myTeamId)}
      <div><h3 style="margin-bottom:6px">How the room played</h3>
        <p class="tiny muted" style="margin-bottom:6px">Average soldiers per castle across ${r.participants} armies.${hidden ? ' Gold numbers are the castle values that were revealed.' : ''}</p>
        <div style="max-width:560px">${skyline({ alloc: r.avgAlloc, color: 'var(--room)', values: hidden ? r.values : null })}</div></div>
    </div>`;
  }

  // Replace an element's HTML but keep expanded team cards expanded.
  function setHTML(el, html) {
    const open = [...el.querySelectorAll('details[data-team][open]')].map((d) => d.dataset.team);
    el.innerHTML = html;
    open.forEach((id) => { const d = el.querySelector(`details[data-team="${id}"]`); if (d) d.open = true; });
  }

  // QR code as an SVG string (needs /static/vendor/qrcode.js on the page).
  function qr(text) {
    if (typeof qrcode !== 'function') return '';
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'QR code for ' + text });
  }

  return { qr, $, $$, esc, fmt, sync, remaining, clock, api, live, toast, skyline, shield, overallTable, roundDetail, teamCards, setHTML };
})();
