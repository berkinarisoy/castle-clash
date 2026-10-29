// Castle Clash — player app (phones)
(() => {
  const { $, esc, fmt, api, live, toast, skyline, clock, remaining, shield, t, loc, titleOf, modeNameOf, wld } = CC;
  const app = $('#app'), dock = $('#dock'), dockInner = $('#dockInner');
  const N = 10;
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  const isPrime = (n) => { if (n < 2) return false; for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; };
  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return t(n + (s[(v - 20) % 10] || s[v] || s[0]), `第 ${n} 名`); };
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
  const castleIcon = () => '<img class="waiting-castle" src="/static/logo.svg" alt="">';

  // Language: remembered per phone; phones set to Chinese start in Chinese.
  CC.setLang(ls.get('cc.lang') || (/^zh/i.test(navigator.language || '') ? 'zh' : 'en'));
  const langBtn = () => `<button class="langbtn" type="button" data-lang aria-label="${t('Switch to Chinese', '切換至英文')}">${t('中文', 'EN')}</button>`;
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-lang]')) return;
    const keep = ['room', 'code', 'name'].map((id) => { const el = document.getElementById(id); return el ? el.value : null; });
    CC.setLang(CC.getLang() === 'zh' ? 'en' : 'zh'); ls.set('cc.lang', CC.getLang());
    key = ''; render();
    ['room', 'code', 'name'].forEach((id, i) => { const el = document.getElementById(id); if (el && keep[i]) el.value = keep[i]; });
  });
  // Server messages in Chinese.
  const ZH_ERR = [
    [/^Enter your name\.$/, '請輸入你的名字。'],
    [/^Wrong room code\./, '房間代碼錯誤。請輸入大螢幕上的 3 位數字。'],
    [/^That code doesn’t match any table\./, '找不到這個組別代碼。請查看你桌上的卡。'],
    [/^Too many wrong codes\./, '錯誤次數太多。請等一分鐘再試。'],
    [/^Joining is closed right now\./, '現在暫停加入。請問主持人。'],
    [/^This round is closed\.$/, '這個回合已經結束。'],
    [/^The round hasn’t started yet\./, '回合尚未開始。請先閱讀規則。'],
    [/^You’re not in the game any more\./, '你已不在遊戲中。請重新加入。'],
    [/^Place at most (\d+) soldiers \(you placed (\d+)\)\.$/, '最多只可放 $1 名士兵（你放了 $2 名）。'],
    [/^Send exactly 10 numbers\.$/, '請提交 10 個數字。'],
    [/^Use whole numbers of 0 or more\.$/, '請使用 0 或以上的整數。'],
    [/^Castle (\d+) needs a prime number of soldiers, or 0\.$/, '城堡 $1 的士兵數目必須是質數或 0。'],
  ];
  const errText = (m) => { if (CC.getLang() !== 'zh') return m; for (const [re, zh] of ZH_ERR) if (re.test(m)) return m.replace(re, zh); return m; };

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
      if (s.fresh) { key = 'restoring'; dock.classList.add('hidden'); app.innerHTML = `<div class="join-hero"><img class="waiting-castle" src="/static/logo.svg" alt=""><h1 style="margin-top:14px">${t('Reconnecting', '重新連線中')}</h1><p class="muted" style="margin-top:8px">${t('The game server restarted. Hold on while the host brings the game back. This page updates by itself.', '遊戲伺服器已重新啟動。請稍候，主持人正在恢復遊戲。此頁面會自動更新。')}</p></div>`; return; }
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
    const roundLine = open || S.status === 'closed' || S.status === 'briefing'
      ? t(`Round ${S.playedCount + (S.status === 'closed' ? 0 : 1)} of ${S.totalRounds}`, `第 ${S.playedCount + (S.status === 'closed' ? 0 : 1)} 回合（共 ${S.totalRounds} 回合）`)
      : S.playedCount ? t(`${S.playedCount} of ${S.totalRounds} rounds played`, `已完成 ${S.playedCount} / ${S.totalRounds} 回合`) : t('Waiting to start', '等待開始');
    return `<header class="topbar"><div class="spread">
      <div class="who">${shield(S.me.color)}<span class="name">${esc(S.me.teamName)}</span><span class="muted name">${esc(S.me.name)}</span></div>
      <div class="row-flex" style="gap:8px">${open ? '<div class="timer" data-timer></div>' : ''}${langBtn()}</div></div>
      <div class="round-line">${roundLine}</div></header>`;
  }

  function renderDock() {
    const playBtn = tab === 'play' && (S.status === 'active' || S.status === 'paused');
    dock.classList.remove('hidden');
    dockInner.innerHTML = `${playBtn ? `<button class="btn block big" id="submitBtn" type="button">${t('Submit army', '提交軍隊')}</button>` : ''}
      <nav class="navbar" aria-label="${t('Sections', '分頁')}">
        <button class="tab" type="button" data-tab="play" aria-selected="${tab === 'play'}">${t('Play', '遊戲')}</button>
        <button class="tab" type="button" data-tab="board" aria-selected="${tab === 'board'}">${t('Standings', '排名')}</button>
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
    app.innerHTML = `<div style="text-align:right">${langBtn()}</div><div class="join-hero">${castleIcon()}<h1 style="margin-top:14px">${esc(S.title || 'Castle Clash')}</h1>
      <p class="muted" style="margin-top:8px">${t('Enter the room code from the big screen, the code on your table card, then your name.', '輸入大螢幕上的房間代碼、你桌上卡片的組別代碼，然後輸入你的名字。')}</p></div>
      <form class="panel stack" id="joinForm" autocomplete="off">
        <label class="field"><span>${t('Room code (3 digits, on the big screen)', '房間代碼（3 位數字，在大螢幕上）')}</span><input type="text" class="code-input" id="room" inputmode="numeric" pattern="[0-9]*" maxlength="3" aria-describedby="joinErr"></label>
        <label class="field"><span>${t('Table code (4 digits, on your table card)', '組別代碼（4 位數字，在你桌上的卡片）')}</span><input type="text" class="code-input" id="code" inputmode="numeric" pattern="[0-9]*" maxlength="4" value="${esc(pre)}" aria-describedby="joinErr"></label>
        <label class="field"><span>${t('Your name', '你的名字')}</span><input type="text" id="name" maxlength="24" autocomplete="nickname" autocapitalize="words" enterkeyhint="go"></label>
        <button class="btn block big" type="submit">${t('Join table', '加入')}</button>
        <p id="joinErr" class="small" role="alert" style="color:var(--gules);min-height:1.2em"></p>
      </form>
      <p class="tiny muted" style="text-align:center;margin-top:16px">${t('Switched phones? Join again with the same codes and name to pick up where you left off.', '換了手機？用相同的代碼和名字重新加入，便可以繼續遊戲。')}</p>`;
    const room = $('#room'), code = $('#code'), name = $('#name');
    room.addEventListener('input', () => { room.value = room.value.replace(/\D/g, '').slice(0, 3); if (room.value.length === 3) (code.value.length === 4 ? name : code).focus(); });
    code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 4); if (code.value.length === 4) name.focus(); });
    $('#joinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#joinErr'); err.textContent = '';
      if (!/^\d{3}$/.test(room.value)) { err.textContent = t('The room code has 3 digits. It’s on the big screen.', '房間代碼有 3 位數字，在大螢幕上。'); room.focus(); return; }
      if (!/^\d{4}$/.test(code.value)) { err.textContent = t('The table code has 4 digits.', '組別代碼有 4 位數字。'); code.focus(); return; }
      if (!name.value.trim()) { err.textContent = t('Enter your name.', '請輸入你的名字。'); name.focus(); return; }
      try {
        const r = await api('/api/join', { method: 'POST', body: { room: room.value, code: code.value, name: name.value } });
        token = r.token; ls.set('cc.token', token); key = ''; tab = 'play';
        if (r.rejoined) toast(t('Welcome back', '歡迎回來'));
        history.replaceState(null, '', '/');
        connect();
      } catch (ex) { err.textContent = errText(ex.message); }
    });
  }

  // ---------- play ----------
  function valueLabel(i) {
    const r = S.round;
    if (r.hiddenValues) return `<span class="token" title="${t('Value hidden', '分值隱藏')}">?</span>`;
    return `<span class="token" title="${t(`${i + 1} point${i ? 's' : ''}`, `${i + 1} 分`)}">${i + 1}</span>`;
  }
  function hint(i) {
    const r = S.round, n = i + 1;
    if (r.mode === 'doubling' && n % 2 === 0) return t(`×2 with castle ${n / 2}`, `與城堡 ${n / 2} 配對 ×2`);
    if (r.mode === 'beauty') return t('value set by the room', '分值由全場決定');
    if (r.mode === 'shuffled') return t('value hidden', '分值隱藏');
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
          <div class="spread"><h2 id="rt">${esc(titleOf(r))}</h2><button class="linkbtn small" id="rulesToggle" type="button" aria-expanded="${rulesOpen}">${rulesOpen ? t('Hide rules', '隱藏規則') : t('Show rules', '顯示規則')}</button></div>
          <div id="rulesBody" class="${rulesOpen ? '' : 'hidden'}">
            ${r.title !== r.modeName ? `<p><strong>${esc(modeNameOf(r))}</strong></p>` : ''}
            <p>${esc(loc(r, 'blurb'))}</p>
            ${CC.matchPic(r.picture)}
            ${r.example ? `<p class="small muted"><strong>${t('Example.', '例子：')}</strong> ${esc(loc(r, 'example'))}</p>` : ''}
            ${r.multiplier !== 1 ? `<p><span class="chip gold">${t(`This round is worth ×${fmt(r.multiplier)}`, `本回合分數 ×${fmt(r.multiplier)}`)}</span></p>` : ''}
            ${r.usesHistory ? `<p class="small">${g && g.some((x) => x > 0) ? t('Your stationed soldiers are shown on each castle.', '每座城堡會顯示你留守的士兵。') : t('You have no soldiers stationed from last round.', '你沒有上一回合留守的士兵。')}</p>` : ''}
          </div>
        </section>
        <section class="panel" aria-label="${t('Your army', '你的軍隊')}">
          <div class="spread" style="align-items:flex-end">
            <div><div class="left-count num" id="leftCount">0</div><div class="small muted" id="leftLabel"></div></div>
            <button class="btn ghost small" id="clearBtn" type="button">${t('Clear', '清除')}</button>
          </div>
          <div id="sky" style="margin-top:12px"></div>
        </section>
        <section class="castles" id="castles" aria-label="${t('Castles', '城堡')}">
          ${Array.from({ length: N }, (_, i) => `
            <div class="crow" data-i="${i}">
              <div><div class="cname row-flex" style="gap:8px">${valueLabel(i)}<span>${t('Castle', '城堡')} ${i + 1}</span></div>
                ${hint(i) || (g && g[i]) ? `<div class="cmeta">${hint(i) ? `<span>${hint(i)}</span>` : ''}${g && g[i] ? `<span>+${g[i]} ${t('stationed', '留守')}</span>` : ''}</div>` : ''}</div>
              <div class="stepper">
                <button type="button" data-step="-1" aria-label="${t(`Fewer soldiers on castle ${i + 1}`, `減少城堡 ${i + 1} 的士兵`)}">−</button>
                <input type="text" inputmode="numeric" pattern="[0-9]*" value="${draft.alloc[i]}" data-i="${i}" aria-label="${t(`Soldiers on castle ${i + 1}`, `城堡 ${i + 1} 的士兵`)}">
                <button type="button" data-step="1" aria-label="${t(`More soldiers on castle ${i + 1}`, `增加城堡 ${i + 1} 的士兵`)}">+</button>
              </div>
            </div>`).join('')}
        </section>
        <p class="small muted" style="text-align:center">${t('You can change your army until the timer runs out.', '計時結束前你都可以修改軍隊。')}</p>
        <section class="panel stack" id="mates"></section>
      </div>`;
    $('#rulesToggle').addEventListener('click', () => {
      rulesOpen = !rulesOpen;
      $('#rulesBody').classList.toggle('hidden', !rulesOpen);
      $('#rulesToggle').textContent = rulesOpen ? t('Hide rules', '隱藏規則') : t('Show rules', '顯示規則');
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
    if (tot > sold) msg = t(`Remove ${tot - sold} soldier${tot - sold === 1 ? '' : 's'}`, `請減少 ${tot - sold} 名士兵`);
    else if (bad.length) msg = t(`Castle ${bad[0] + 1} needs a prime number`, `城堡 ${bad[0] + 1} 需要質數`);
    return { tot, bad, msg };
  }
  function updateDerived() {
    if (!draft || !S.round) return;
    const r = S.round, sold = S.soldiers, v = validation();
    const lc = $('#leftCount'), ll = $('#leftLabel');
    if (lc) {
      const left = sold - v.tot;
      lc.className = 'left-count num' + (left < 0 ? ' over' : left === 0 ? ' done' : '');
      if (left < 0) { lc.textContent = -left; ll.textContent = t('too many soldiers', '名士兵太多'); }
      else if (left === 0) { lc.textContent = sold; ll.textContent = t('all soldiers placed', '已放置所有士兵'); }
      else if (r.params.rate !== undefined) { lc.textContent = left; ll.textContent = t(`kept home, earning ${fmt(r.params.rate)} each per matchup`, `名留守，每場對戰每名賺 ${fmt(r.params.rate)} 分`); }
      else { lc.textContent = left; ll.textContent = t(`of ${sold} not placed. You can submit fewer, but unplaced soldiers don’t fight`, `名未放置（共 ${sold} 名）。你可以提交較少士兵，但未放置的士兵不會作戰`); }
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
      else if (isSame) { btn.disabled = true; btn.textContent = t('Army submitted ✓', '已提交軍隊 ✓'); }
      else { btn.disabled = sending; btn.textContent = submitted ? t('Update army', '更新軍隊') : t('Submit army', '提交軍隊'); }
    }
  }
  async function submit() {
    if (sending || validation().msg) return;
    sending = true; updateDerived();
    const had = !!S.mySubmission;
    try {
      await api('/api/submit', { method: 'POST', body: { alloc: draft.alloc }, headers: { 'x-player-token': token } });
      S.mySubmission = draft.alloc.slice();
      toast(had ? t('Army updated', '軍隊已更新') : t('Army submitted', '軍隊已提交'));
      if (navigator.vibrate) navigator.vibrate(30);
    } catch (e) { toast(errText(e.message), true); }
    sending = false; updateDerived();
  }

  function patchPlay() {
    const pn = $('#pausedNote');
    if (pn) pn.innerHTML = S.status === 'paused' ? `<div class="tile" style="text-align:center;font-weight:700">${t('The host paused the timer. You can still edit your army.', '主持人暫停了計時。你仍然可以修改軍隊。')}</div>` : '';
    const mates = $('#mates');
    if (mates) {
      const totalIn = Object.values(S.submissions).reduce((a, t) => a + t.done, 0);
      const totalAll = Object.values(S.submissions).reduce((a, t) => a + t.total, 0);
      let html = `<div class="spread"><h3>${t('Your table', '你的組')}</h3><span class="small muted num">${t(`${totalIn} of ${totalAll} armies in`, `已提交 ${totalIn} / ${totalAll} 支軍隊`)}</span></div>`;
      if (!S.teammates.length) html += `<p class="small muted">${t('No teammates have joined yet.', '尚未有組員加入。')}</p>`;
      html += S.teammates.map((m) => `<div class="mate"><div><strong>${esc(m.name)}</strong></div>
        <span class="chip ${m.submitted ? 'ok' : ''}">${m.submitted ? t('Submitted', '已提交') : t('Thinking', '思考中')}</span>
        ${m.alloc ? `<div style="grid-column:1/-1">${skyline({ alloc: m.alloc, color: S.me.color, height: 80, max: Math.max(30, ...m.alloc) })}</div>` : ''}</div>`).join('');
      if (S.round.teamLevel) {
        const armies = [...S.teammates.filter((m) => m.alloc).map((m) => m.alloc), ...(S.mySubmission ? [S.mySubmission] : [])];
        if (armies.length) {
          const avg = Array.from({ length: N }, (_, i) => Math.round(armies.reduce((a, x) => a + x[i], 0) / armies.length * 10) / 10);
          html += `<div><h3 style="margin-top:6px">${t('Alliance army so far', '目前的聯盟軍隊')}</h3><p class="tiny muted">${t(`Average of ${armies.length} submitted ${armies.length === 1 ? 'army' : 'armies'}.`, `${armies.length} 支已提交軍隊的平均。`)}</p>${skyline({ alloc: avg, color: S.me.color, height: 100 })}</div>`;
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
    if (st === 'briefing') {
      const r = S.round;
      body = `<section class="panel stack" style="text-align:center">
          ${r.multiplier !== 1 ? `<p class="round-line">×${fmt(r.multiplier)} ${t('points', '分')}</p>` : ''}
          <h1>${esc(titleOf(r))}</h1>${r.title !== r.modeName ? `<p class="muted small">${esc(modeNameOf(r))}</p>` : ''}
          <p>${esc(loc(r, 'blurb'))}</p>
          ${CC.matchPic(r.picture)}
          ${r.example ? `<p class="tile small" style="text-align:left"><strong>${t('Example.', '例子：')}</strong> ${esc(loc(r, 'example'))}</p>` : ''}
          <div class="big-score num" data-timer></div><p class="muted">${t('until the round starts. Read the rules, then get your army ready.', '後回合開始。先閱讀規則，再準備你的軍隊。')}</p></section>
        ${rulesPrimer()}`;
    } else if (st === 'lobby') {
      body = `<section class="panel stack" style="text-align:center">${castleIcon(S.me.color)}
        <h1>${t(`You’re in, ${esc(S.me.name)}`, `${esc(S.me.name)}，你已加入`)}</h1>
        <p class="muted">${t(`You’re playing for <strong style="color:var(--ink)">${esc(S.me.teamName)}</strong>. The first round starts when the host is ready.`, `你代表 <strong style="color:var(--ink)">${esc(S.me.teamName)}</strong> 出戰。主持人準備好後便會開始第一回合。`)}</p></section>
        ${matesList()}
        ${rulesPrimer()}`;
    } else if (st === 'closed') {
      body = `<section class="panel stack" style="text-align:center">${castleIcon(S.me.color)}<h1>${t('Time’s up', '時間到')}</h1>
        <p class="muted">${t('Scores are in. Results appear here when the host reveals them.', '分數已計算。主持人公布後，結果會在這裏顯示。')}</p></section>
        ${S.mySubmission ? `<section class="panel"><h3>${t('Your army', '你的軍隊')}</h3>${skyline({ alloc: S.mySubmission, color: S.me.color })}</section>` : `<section class="tile small" style="text-align:center">${t('You didn’t submit an army this round.', '你本回合沒有提交軍隊。')}</section>`}`;
    } else {
      body = resultsView();
    }
    CC.setHTML(app, topbar() + `<div class="stack-lg">${body}</div>`);
  }
  function matesList() {
    return `<section class="panel stack"><h3>${t('Your table', '你的組')}</h3>${S.teammates.length
      ? S.teammates.map((m) => `<div class="row-flex">${shield(S.me.color)}<span>${esc(m.name)}</span></div>`).join('')
      : `<p class="small muted">${t('Nobody else has joined your table yet.', '你的組還未有其他人加入。')}</p>`}</section>`;
  }
  function rulesPrimer() {
    return `<section class="rules"><h2>${t('How it works', '玩法')}</h2>
      <p>${t(`Each round you get up to ${S.soldiers} soldiers to share across 10 castles. Castle i is usually worth i points.`, `每個回合你最多有 ${S.soldiers} 名士兵，分配到 10 座城堡。城堡 i 通常值 i 分。`)}</p>
      <p>${t('Your army fights every player at the other tables. Whoever has more soldiers at a castle takes its points. Your score is your average over all those matchups.', '你的軍隊會與其他組的每一名玩家對戰。在每座城堡，士兵較多的一方奪得該城堡的分數。你的得分是所有對戰的平均分。')}</p>
      <p>${t('Your table’s score for a round is its best player’s score. Each round may bend the rules, so read them when it starts.', '你組在一個回合的得分是組內最佳玩家的得分。每個回合的規則可能不同，開始時記得細閱。')}</p>
      ${CC.matchPic(S.basicPicture)}</section>`;
  }
  function resultsView() {
    const rounds = S.board.rounds;
    const last = rounds[rounds.length - 1];
    const mine = S.myResults.find((x) => last && x.roundId === last.roundId);
    if (!last) return `<section class="panel">${castleIcon(S.me.color)}<p class="muted" style="text-align:center">${t('Waiting for the next round.', '等待下一回合。')}</p></section>`;
    const teamRow = last.teams.find((t) => t.teamId === S.me.teamId);
    const overall = S.board.overall.find((t) => t.teamId === S.me.teamId);
    const hidden = last.mode === 'beauty' || last.mode === 'shuffled';
    let html = `<section class="panel stack" style="text-align:center">
      <p class="round-line">${t(`${esc(last.title)} results`, `${esc(titleOf(last))} 結果`)}</p>`;
    if (mine && mine.me) {
      html += `<div class="big-score num">${fmt(mine.me.score)}</div><p class="muted">${t('your average score this round', '你本回合的平均分')}</p>
        <div class="row-flex" style="margin-top:12px">
          <div class="stat"><b class="num">${mine.me.won}</b><span class="tiny muted">${t('won', '勝')}</span></div>
          <div class="stat"><b class="num">${mine.me.lost}</b><span class="tiny muted">${t('lost', '負')}</span></div>
          <div class="stat"><b class="num">${mine.me.drawn}</b><span class="tiny muted">${t('drawn', '和')}</span></div>
        </div>
        <p class="tiny muted">${last.mode === 'alliance' ? t('Your table fought as one army.', '你的組作為一支軍隊作戰。') : t(`Average over ${mine.me.opponents} opponents.`, `${mine.me.opponents} 名對手的平均分。`)}</p>`;
    } else {
      html += `<h2>${t('You sat this one out', '你沒有參與這回合')}</h2><p class="muted small">${t('Submit an army next round to score.', '下回合提交軍隊便可得分。')}</p>`;
    }
    html += '</section>';
    if (mine && mine.me) {
      html += `<section class="panel stack"><h3>${t('Your army against the room', '你的軍隊與全場比較')}</h3>
        <div class="legend"><span><i style="background:${esc(S.me.color)}"></i>${t('You', '你')}</span><span><i style="background:var(--room)"></i>${t('Room average', '全場平均')}</span></div>
        ${skyline({ alloc: mine.me.army, ghost: last.avgAlloc, color: S.me.color, values: hidden ? last.values : null })}
        ${hidden ? `<p class="tiny muted">${t('Gold numbers are the castle values that were revealed.', '金色數字是揭曉的城堡分值。')}</p>` : ''}</section>`;
    }
    if (teamRow) {
      const alliance = last.mode === 'alliance';
      html += `<section class="panel stack"><div class="spread"><div class="row-flex">${shield(S.me.color)}<h3>${esc(S.me.teamName)}</h3></div><span class="chip">${t(`${ordinal(teamRow.rank)} this round`, `本回合${ordinal(teamRow.rank)}`)}</span></div>
        <div class="spread"><span class="muted">${t('Table score', '組別得分')}</span><strong class="num" style="font-size:1.4rem">${fmt(teamRow.score)}</strong></div>
        ${overall ? `<div class="spread"><span class="muted">${t('Overall', '總排名')}</span><strong>${t(`${ordinal(overall.rank)} with ${fmt(overall.total)}`, `${ordinal(overall.rank)}，${fmt(overall.total)} 分`)}</strong></div>` : ''}
        <div>${teamRow.members.map((m, i) => `<div class="member"${m.playerId === S.me.id ? ' style="background:var(--azure-soft);margin:0 -8px;padding:8px;border-radius:12px;border-top-color:transparent"' : ''}>
          <span><strong>${esc(m.name)}</strong>${m.playerId === S.me.id ? ` <span class="tiny muted">${t('you', '你')}</span>` : ''}${!alliance && i === 0 ? ` <span class="counted tiny">${t('counted', '計分')}</span>` : ''}</span>
          <span class="num small"><strong>${fmt(m.score)}</strong> <span class="muted tiny">${wld(m)}</span></span>
          <div class="sky">${skyline({ alloc: m.army, color: S.me.color, height: 80, max: Math.max(30, ...m.army) })}</div></div>`).join('')}</div>
        ${alliance ? `<p class="tiny muted">${t('Grand Alliance: everyone shares the table score.', '大聯盟：全組共享組別得分。')}</p>` : ''}</section>`;
    }
    html += `<section class="panel">${CC.strategyBox(last)}</section>`;
    html += `<section class="panel stack"><h3>${t('Every table’s best strategy', '每組的最佳策略')}</h3><p class="tiny muted">${t('Tap a table to see all of its players.', '點擊組別查看所有玩家。')}</p>${CC.teamCards(last, S.me.teamId, { height: 84 })}</section>`;
    html += S.finished
      ? `<section class="rules" style="text-align:center"><h2>${t('That was the last round', '這是最後一個回合')}</h2><p>${overall ? t(`${esc(S.me.teamName)} finished ${ordinal(overall.rank)}.`, `${esc(S.me.teamName)} 獲得${ordinal(overall.rank)}。`) : ''} ${t('Check Standings for the final table.', '在「排名」查看最終排名。')}</p></section>`
      : `<p class="small muted" style="text-align:center">${t('The next round starts when the host is ready.', '主持人準備好後便會開始下一回合。')}</p>`;
    return html;
  }

  // ---------- standings ----------
  function renderBoard() {
    const rounds = S.board.rounds;
    if (boardSel !== 'overall' && !rounds.find((r) => r.roundId === boardSel)) boardSel = 'overall';
    const sel = rounds.find((r) => r.roundId === boardSel);
    CC.setHTML(app, topbar() + `<div class="stack-lg">
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" data-sel="overall" aria-selected="${boardSel === 'overall'}">${t('Overall', '總排名')}</button>
        ${rounds.map((r) => `<button class="tab" role="tab" data-sel="${r.roundId}" aria-selected="${boardSel === r.roundId}">${t(`Round ${r.n}`, `第 ${r.n} 回合`)}</button>`).join('')}
      </div>
      <section class="panel">${sel ? CC.roundDetail(sel, S.me.teamId) : `<h3 style="margin-bottom:6px">${t('Overall standings', '總排名')}</h3>${rounds.length ? '' : `<p class="small muted" style="margin-bottom:8px">${t('Scores appear here after the first round.', '第一回合後會在這裏顯示分數。')}</p>`}${CC.overallTable(S.board, S.me.teamId, { members: true, totalFirst: true })}`}</section>
      <p style="text-align:center"><button class="linkbtn small" id="leaveBtn" type="button">${t(`Leave ${esc(S.me.teamName)}`, `離開 ${esc(S.me.teamName)}`)}</button></p>
    </div>`);
    app.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-sel]'); if (b) { boardSel = b.dataset.sel; renderBoard(); } });
    $('#leaveBtn').addEventListener('click', async () => {
      if (!confirm(t('Leave your table? You can join again with a code.', '離開你的組？之後可以用代碼重新加入。'))) return;
      try { await api('/api/leave', { method: 'POST', headers: { 'x-player-token': token } }); } catch { /* ignore */ }
      token = null; ls.set('cc.token', null); key = ''; tab = 'play'; connect();
    });
  }

  // ---------- timer ----------
  function tick() {
    if (!S) return;
    const ms = remaining(S);
    document.querySelectorAll('[data-timer]').forEach((el) => {
      el.textContent = S.status === 'paused' ? `${clock(ms)} ${t('paused', '已暫停')}` : clock(ms);
      el.classList.toggle('low', S.status === 'active' && ms <= 10000);
      el.classList.toggle('paused', S.status === 'paused');
    });
  }
  setInterval(tick, 250);
  connect();
})();
