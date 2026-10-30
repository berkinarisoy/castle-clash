// Number Siege — shared client helpers
const CC = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => { const x = Math.round((Number(n) || 0) * 100) / 100; return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0$/, ''); };

  // Language for the phone app ('en' or 'zh'). The board and admin pages stay in English.
  let lang = 'en';
  function setLang(l) { lang = l === 'zh' ? 'zh' : 'en'; document.documentElement.lang = lang === 'zh' ? 'zh-HK' : 'en'; }
  const getLang = () => lang;
  const t = (en, zh) => (lang === 'zh' ? zh : en);
  // Round and mode texts: the server sends Chinese versions under .zh.
  const loc = (r, k) => (lang === 'zh' && r && r.zh && r.zh[k]) || (r && r[k]) || '';
  const titleOf = (r) => (lang === 'zh' && r.zh && r.title === r.modeName ? r.zh.name : r.title);
  const modeNameOf = (r) => (lang === 'zh' && r.zh ? r.zh.name : r.modeName);
  const wld = (m) => t(`${m.won}W ${m.lost}L ${m.drawn}D`, `勝${m.won} 負${m.lost} 和${m.drawn}`);
  const ZH_WORDS = { You: '你', Opponent: '對手', 'Your table': '你的組', 'Other table': '其他組', tie: '平手', alone: '孤立', stalemate: '僵持' };
  const word = (w) => (lang === 'zh' ? (ZH_WORDS[w] || w.replace(/^\+(\d+) stayed$/, '+$1 留守')) : w);

  let offset = 0;
  function sync(state) { if (state && state.now) offset = state.now - Date.now(); }
  function remaining(state) {
    if (!state) return 0;
    if (state.status === 'active' && state.endsAt) return Math.max(0, state.endsAt - (Date.now() + offset));
    if (state.status === 'briefing' && state.briefingEndsAt) return Math.max(0, state.briefingEndsAt - (Date.now() + offset));
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

  // A worked matchup for the rules: both armies castle by castle, who takes each castle and
  // what it pays. pic comes from the server (pictureFor in src/modes.js). Phones get two rows
  // of five castles so the numbers stay readable.
  function matchPic(pic) {
    if (!pic) return '';
    const slot = 46, top = 18, ground = 104, H = 176;
    const C = { you: 'var(--azure)', them: 'var(--gules)' }, soft = { you: 'var(--azure-soft)', them: 'var(--gules-soft)' };
    const M = Math.max(20, ...pic.you, ...pic.them);
    const hOf = (v) => (v > 0 ? 4 + (Math.min(v, M) / M) * (ground - top - 6) : 0);
    const label = `Example matchup. ${esc(pic.labels[0])}: ${pic.you.join(', ')}. ${esc(pic.labels[1])}: ${pic.them.join(', ')}. Score ${pic.score[0]} to ${pic.score[1]}.`;
    const draw = (from, to, cls, aria) => {
    let s = `<svg class="${cls}" viewBox="0 0 ${(to - from) * slot} ${H}" ${aria ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>`;
    for (let i = from; i < to; i++) {
      const x = (i - from) * slot, cx = x + slot / 2, c = pic.cells[i] || {}, a = pic.you[i], b = pic.them[i];
      if (c.win) s += `<rect x="${x + 1}" y="2" width="${slot - 2}" height="${H - 4}" rx="7" fill="${soft[c.win]}" opacity=".7"/>`;
      const ha = hOf(a), hb = hOf(b);
      s += `<g opacity="${c.win === 'them' ? .35 : 1}">${tower(x + 6, 15, ground - ha, ha, C.you)}<text x="${x + 13.5}" y="${Math.max(11, ground - ha - 7)}" text-anchor="middle" font-size="10" font-weight="800" fill="${C.you}">${a || ''}</text></g>`;
      s += `<g opacity="${c.win === 'you' ? .35 : 1}">${tower(x + 25, 15, ground - hb, hb, C.them)}<text x="${x + 32.5}" y="${Math.max(11, ground - hb - 7)}" text-anchor="middle" font-size="10" font-weight="800" fill="${C.them}">${b || ''}</text></g>`;
      const v = pic.values[i], gold = pic.hiddenValues;
      s += `<circle cx="${cx}" cy="${ground + 15}" r="10" fill="${gold ? 'var(--or)' : 'var(--paper)'}" stroke="${gold ? 'var(--or)' : 'var(--line)'}"/>`;
      s += `<text x="${cx}" y="${ground + 19}" text-anchor="middle" font-size="11" font-weight="800" fill="${gold ? '#fff' : 'var(--ink)'}">${v}</text>`;
      s += `<text x="${cx}" y="${ground + 44}" text-anchor="middle" font-size="13" font-weight="800" fill="${c.win ? C[c.win] : 'var(--muted)'}">${c.win ? (c.pts ? `+${fmt(c.pts)}` : '0') : '–'}</text>`;
      if (c.note) s += `<text x="${cx}" y="${ground + 61}" text-anchor="middle" font-size="9" font-weight="700" fill="var(--muted)">${esc(word(c.note))}</text>`;
    }
    return s + `<line x1="0" x2="${(to - from) * slot}" y1="${ground + .5}" y2="${ground + .5}" stroke="var(--line)"/></svg>`;
    };
    const svgs = draw(0, 10, 'mp-wide', true) + `<div class="mp-narrow">${draw(0, 5, '', false)}${draw(5, 10, '', false)}</div>`;
    const lab = pic.labels.map(word), note = lang === 'zh' && pic.noteZh ? pic.noteZh : pic.note;
    const key = (k, i) => `<span class="row-flex" style="gap:6px"><i class="mp-swatch" style="background:${C[k]}"></i>${esc(lab[i])}</span>`;
    return `<figure class="matchpic">
      <div class="mp-head">${key('you', 0)}${key('them', 1)}<span class="muted">${t('Circles: castle value', '圓圈：城堡分值')}</span></div>
      ${svgs}
      <figcaption><div class="mp-score"><span style="color:${C.you}">${esc(lab[0])} ${fmt(pic.score[0])}</span><span class="muted">–</span><span style="color:${C.them}">${fmt(pic.score[1])} ${esc(lab[1])}</span></div>
        ${note ? `<p>${esc(note)}</p>` : ''}</figcaption></figure>`;
  }

  const shield = (color) => `<span class="banner-shield" style="background:${esc(color)}" aria-hidden="true"></span>`;

  // Overall standings. With members, each team gets a row per player showing every round;
  // the score that counted for the team is highlighted and the room's best of the round is starred.
  function overallTable(board, myTeamId, { members = false, totalFirst = false } = {}) {
    if (!board.overall.length) return `<p class="muted">${t('No teams yet.', '尚未有組別。')}</p>`;
    const rounds = board.rounds, showCols = members ? rounds.length > 0 : rounds.length > 1;
    const tops = board.topScores || [];
    const body = board.overall.map((team) => {
      let rows = `<tr${team.teamId === myTeamId ? ' style="background:var(--azure-soft)"' : ''}>
        <td class="rank${team.rank === 1 && team.total > 0 ? ' first' : ''}">${team.rank}</td>
        <td><div class="row-flex">${shield(team.color)}<strong>${esc(team.name)}</strong></div></td>
        ${totalFirst ? `<td class="r num tot"><strong>${fmt(team.total)}</strong></td>` : ''}
        ${showCols ? team.perRound.map((v) => `<td class="r num"><strong>${fmt(v)}</strong></td>`).join('') : ''}
        ${totalFirst ? '' : `<td class="r num"><strong>${fmt(team.total)}</strong></td>`}</tr>`;
      if (members && team.members && team.members.length) {
        const best = rounds.map((_, k) => Math.max(...team.members.map((m) => (m.perRound[k] == null ? -Infinity : m.perRound[k]))));
        rows += team.members.map((m) => `<tr class="sub"><td></td><td class="pname">${esc(m.name)}</td>${totalFirst ? `<td class="r num tot">${fmt(m.total)}</td>` : ''}
          ${showCols ? m.perRound.map((v, k) => {
            if (v == null) return '<td class="r">–</td>';
            const hi = v === best[k] && v > 0, star = v === tops[k] && v > 0;
            return `<td class="r num">${hi ? `<span class="hi" title="${t('Counted for', '計入')} ${esc(team.name)}">${fmt(v)}</span>` : fmt(v)}${star ? `<span class="star" title="${t('Best in the room', '全場最高')}">★</span>` : ''}</td>`;
          }).join('') : ''}
          ${totalFirst ? '' : `<td class="r num">${fmt(m.total)}</td>`}</tr>`).join('');
      }
      return rows;
    }).join('');
    const legend = members && rounds.length
      ? `<div class="legend" style="margin-top:8px"><span><i style="background:var(--or-soft);box-shadow:inset 0 0 0 1px var(--or)"></i>${t('Counted for the team', '計入組別得分')}</span><span>★ ${t('Best in the room that round', '該回合全場最高')}</span><span>${t('Player totals are their own scores added up', '玩家總分是自己各回合得分的總和')}</span></div>` : '';
    return `<div style="overflow-x:auto"><table class="list"><thead><tr><th></th><th>${members ? t('Team and players', '組別及玩家') : t('Team', '組別')}</th>${totalFirst ? `<th class="r tot">${t('Total', '總分')}</th>` : ''}${showCols ? rounds.map((r) => `<th class="r small" title="${esc(r.title)}">R${r.n}</th>`).join('') : ''}${totalFirst ? '' : `<th class="r">${t('Total', '總分')}</th>`}</tr></thead><tbody>${body}</tbody></table></div>${legend}`;
  }

  // One card per team: its best strategy, and (expandable) every member's army and score.
  function teamCards(r, myTeamId, { open = false, height = 90 } = {}) {
    const max = Math.max(1, ...r.teams.map((tm) => tm.score));
    const alliance = r.mode === 'alliance';
    return `<div class="team-cards">${r.teams.map((tm) => {
      const best = tm.members[0];
      const head = `<div class="spread"><span class="row-flex"><span class="rank${tm.rank === 1 && tm.score > 0 ? ' first' : ''}">${tm.rank}</span>${shield(tm.color)}<strong>${esc(tm.name)}</strong></span><strong class="num" style="font-size:1.15rem">${fmt(tm.score)}</strong></div>
        <div class="bar-track" style="margin:6px 0 8px"><div class="bar-fill" style="width:${(tm.score / max) * 100}%;background:${esc(tm.color)}"></div></div>`;
      if (!best) return `<div class="tcard" style="--team:${esc(tm.color)}">${head}<p class="tiny muted">${t('No armies from this table.', '這組沒有提交軍隊。')}</p></div>`;
      const bestArmy = alliance && tm.teamArmy ? tm.teamArmy : best.army;
      const caption = alliance ? t(`Team army, the average of ${tm.members.length}`, `組軍：${tm.members.length} 人的平均`) : t(`Best strategy: ${esc(best.name)}, ${fmt(best.score)} pts`, `最佳策略：${esc(best.name)}，${fmt(best.score)} 分`);
      const list = tm.members.map((m, i) => `<div class="member"><span><strong>${esc(m.name)}</strong>${!alliance && i === 0 ? ` <span class="counted tiny">${t('counted', '計分')}</span>` : ''}</span>
          <span class="num small"><strong>${fmt(m.score)}</strong> <span class="muted tiny">${wld(m)}</span></span>
          <div class="sky">${skyline({ alloc: m.army, color: tm.color, height: 78, max: Math.max(30, ...m.army) })}</div></div>`).join('');
      return `<details class="tcard${tm.teamId === myTeamId ? ' mine' : ''}" data-team="${tm.teamId}" style="--team:${esc(tm.color)}"${open ? ' open' : ''}>
        <summary>${head}<div class="tiny muted">${caption}</div>${skyline({ alloc: bestArmy, color: tm.color, height, max: Math.max(30, ...bestArmy) })}
          <span class="more more-closed">${t(`Show all ${tm.members.length} player${tm.members.length === 1 ? '' : 's'}`, `顯示全部 ${tm.members.length} 名玩家`)}</span><span class="more more-open">${t('Hide players', '隱藏玩家')}</span></summary>
        ${list}</details>`;
    }).join('')}</div>`;
  }

  // After a round: the mode's strategy idea and the best army in hindsight against this room.
  function strategyBox(r) {
    if (!r.tip && !r.hindsight) return '';
    const h = r.hindsight, hidden = r.mode === 'beauty' || r.mode === 'shuffled';
    return `<div class="strategy stack"><h3>${t('Strategy idea', '策略提示')}</h3>${r.tip ? `<p>${esc(loc(r, 'tip'))}</p>` : ''}
      ${h ? `<div><p class="small">${t(`<strong>Best army in hindsight:</strong> against the armies submitted this round it would have averaged
        <strong>${fmt(h.score)}</strong>${h.score > r.topScore ? ` (the best player in the room got ${fmt(r.topScore)})` : ''}.`,
        `<strong>事後最佳軍隊：</strong>對本回合提交的所有軍隊，它的平均分會是 <strong>${fmt(h.score)}</strong>${h.score > r.topScore ? `（全場最佳玩家得 ${fmt(r.topScore)} 分）` : ''}。`)}</p>
        ${skyline({ alloc: h.alloc, color: 'var(--vert)', values: hidden ? r.values : null, max: Math.max(30, ...h.alloc), height: hidden ? 120 : 100 })}</div>` : ''}</div>`;
  }

  function roundDetail(r, myTeamId) {
    const hidden = r.mode === 'beauty' || r.mode === 'shuffled';
    return `<div class="stack-lg">
      <div class="stack"><div class="spread"><h3>${esc(titleOf(r))}</h3>${r.multiplier !== 1 ? `<span class="chip gold">×${fmt(r.multiplier)} ${t('points', '分')}</span>` : ''}</div>
      <p class="small muted">${esc(loc(r, 'blurb'))}</p></div>
      ${teamCards(r, myTeamId)}
      ${strategyBox(r)}
      <div><h3 style="margin-bottom:6px">${t('How the room played', '全場部署')}</h3>
        <p class="tiny muted" style="margin-bottom:6px">${t(`Average soldiers per castle across ${r.participants} armies.`, `${r.participants} 支軍隊在每座城堡的平均士兵數。`)}${hidden ? t(' Gold numbers are the castle values that were revealed.', '金色數字是揭曉的城堡分值。') : ''}</p>
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

  return { qr, $, $$, esc, fmt, setLang, getLang, t, loc, titleOf, modeNameOf, wld, sync, remaining, clock, api, live, toast, skyline, matchPic, shield, overallTable, roundDetail, strategyBox, teamCards, setHTML };
})();
