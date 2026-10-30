'use strict';
// Castle Strategy — round modes and the scoring engine.
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

// ---------- rule pictures ----------
// Each mode can draw a worked matchup next to its rules: picture(p) returns the two armies
// and, where the mode bends the castle rules, cells[i] = {win: 'you'|'them'|null, pts, note}.
const ten = (x) => new Array(CASTLES).fill(x);
function plainCells(you, them, values = baseValues()) {
  return you.map((y, i) => (y > them[i] ? { win: 'you', pts: values[i] } : them[i] > y ? { win: 'them', pts: values[i] } : { win: null, pts: 0, note: y > 0 ? 'tie' : '' }));
}
const SPREAD = ten(10);
const MIDDLE = [0, 0, 0, 0, 20, 20, 20, 20, 20, 0];

// ---------- modes ----------
// Each mode:
//   name, style (kind of thinking), source ('rules' | 'host' | 'claude')
//   blurb(p)            -> one-paragraph rule text for players
//   example(p)          -> a short worked example shown with the rules
//   picture(p)          -> a worked matchup drawn with the rules (see pictureFor)
//   tip(p)              -> the strategy idea shown with the results
//   zh                  -> Traditional Chinese name and texts for phones (same keys as above)
//   params              -> tunable parameters [{key,label,default,min,max,step}]
//   budget              -> 'atMost' when unused soldiers are worth something (every mode allows fewer)
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
    example: () => 'You put 30 soldiers on castle 7 and your opponent puts 20. You win castle 7 and earn 7 points. If you had both put 20 there, nobody would score it.',
    picture: () => ({ you: MIDDLE, them: SPREAD, note: 'You put 20 on castles 5 to 9 and beat the opponent’s 10 there. They win castles 1 to 4 and 10.' }),
    tip: () => 'There is no single best army: any fixed army is beaten by one that puts 1 more soldier on just enough castles. Avoid round numbers (11 beats 10, 21 beats 20), give up a few castles completely, and win the rest cheaply.',
    zh: {
      name: '經典',
      blurb: () => '兵力較多的一方奪得城堡。城堡 i 值 i 分。兵力相同：雙方都不得分。',
      example: () => '你在城堡 7 放 30 名士兵，對手放 20 名。你奪得城堡 7，得 7 分。如果雙方都放 20 名，便沒有人得分。',
      note: () => '你在城堡 5 至 9 各放 20 名，勝過對手的 10 名。對手奪得城堡 1 至 4 和 10。',
      tip: () => '世上沒有單一最好的軍隊：任何固定的部署，都會被一支在剛好足夠的城堡上多放 1 名士兵的軍隊擊敗。避免整數（11 勝 10，21 勝 20），完全放棄幾座城堡，用最少兵力奪取其餘的城堡。',
    },
    blurb: () => 'The bigger army takes the castle. Castle i is worth i points. Equal armies: nobody scores it.',
    match: (A, B, c) => classic(A.army, B.army, c.values),
  },

  blackjack: {
    name: 'Blackjack', style: 'Push your luck', source: 'host',
    params: [{ key: 'cap', label: 'Bust above', default: 21, min: 1, max: 55, step: 1 }],
    example: (p) => `Win castles 8, 9 and 10 in a matchup and you have 27 points. ${27 > p.cap ? `That is more than ${p.cap}, so you bust: you get 0 for the matchup and your opponent wins it.` : `That is not more than ${p.cap}, so you keep it.`} Winning less can be safer: castles 1, 2 and 3 are only 6 points.`,
    picture: (p) => {
      const say = (who, n) => (n > p.cap ? `${who} ${n}: more than ${p.cap}, bust, so 0` : `${who} ${n}: safe`);
      return { you: [0, 0, 0, 0, 0, 0, 0, 30, 35, 35], them: [14, 14, 14, 14, 14, 15, 0, 5, 5, 5], note: `${say('You win', 27)}. ${say('Opponent wins', 21)}.` };
    },
    tip: (p) => `Only put soldiers on castles worth ${p.cap} or less in total, for example 10 + 9 + 2 or 1 + 2 + 3 + 4 + 5 + 6 = 21. Then you can never bust, and you can stack all your soldiers there to win them in almost every matchup.`,
    zh: {
      name: '二十一點',
      blurb: (p) => `計分方法與經典相同，但如果你在一場對戰中得分超過 ${p.cap}，便會「爆煲」，該場對戰得 0 分，對手勝出。你的回合得分是所有對戰的平均分。`,
      example: (p) => `在一場對戰中奪得城堡 8、9 和 10，你便有 27 分。${27 > p.cap ? `超過 ${p.cap}，所以你爆煲：該場對戰得 0 分，對手勝出。` : `沒有超過 ${p.cap}，所以你保住這些分數。`}少贏一點可能更安全：城堡 1、2 和 3 只值 6 分。`,
      note: (p) => { const say = (who, n) => (n > p.cap ? `${who} ${n} 分：超過 ${p.cap}，爆煲，得 0 分` : `${who} ${n} 分：安全`); return `${say('你贏得', 27)}。${say('對手贏得', 21)}。`; },
      tip: (p) => `只在總值不超過 ${p.cap} 分的城堡上放士兵，例如 10 + 9 + 2 或 1 + 2 + 3 + 4 + 5 + 6 = 21。這樣你永遠不會爆煲，還可以把全部士兵集中在那裏，幾乎每場對戰都能奪得這些城堡。`,
    },
    blurb: (p) => `Scored like Classic, but if you score more than ${p.cap} in a matchup you bust and get 0 for that matchup, so your opponent wins it. Your round score is the average over all your matchups.`,
    match: (A, B, c) => {
      let [a, b] = classic(A.army, B.army, c.values);
      if (a > c.params.cap) a = 0;
      if (b > c.params.cap) b = 0;
      return [a, b];
    },
  },

  neighbours: {
    name: 'Good Neighbours', style: 'Adjacency', source: 'host',
    example: () => 'You capture castles 3, 4 and 8. Castles 3 and 4 are next to each other, so they score 3 + 4 = 7 points. Castle 8 is on its own, so it scores nothing.',
    picture: () => {
      const you = [0, 0, 20, 20, 0, 0, 0, 30, 0, 30], cells = plainCells(you, SPREAD);
      cells.forEach((x, i) => { if (x.win && (cells[i - 1] || {}).win !== x.win && (cells[i + 1] || {}).win !== x.win) { x.pts = 0; x.note = 'alone'; } });
      return { you, them: SPREAD, cells, note: 'Your castles 3 and 4 sit together and score. Castles 8 and 10 are alone, so they score nothing.' };
    },
    tip: () => 'Lone castles are wasted soldiers. Win one block of neighbours, such as 8 + 9 + 10 = 27 or 7 to 10 = 34, and leave everything else empty.',
    zh: {
      name: '好鄰居',
      blurb: () => '城堡只有在你同時奪得相鄰的城堡（i−1 或 i+1）時才計分。孤立的城堡不值分。',
      example: () => '你奪得城堡 3、4 和 8。城堡 3 和 4 相鄰，所以得 3 + 4 = 7 分。城堡 8 孤立，所以不計分。',
      note: () => '你的城堡 3 和 4 相連，可以計分。城堡 8 和 10 孤立，所以不計分。',
      tip: () => '孤立的城堡等於浪費士兵。集中奪取一組相連的城堡，例如 8 + 9 + 10 = 27 或 7 至 10 = 34，其他城堡全部留空。',
    },
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
    example: () => 'You capture castles 3 and 6. Because you also hold castle 3, castle 6 is worth 6 × 2 = 12. Your total is 3 + 12 = 15 points.',
    picture: () => {
      const you = [0, 0, 25, 0, 0, 25, 0, 0, 25, 25], cells = plainCells(you, SPREAD);
      cells.forEach((x, i) => { const n = i + 1; if (x.win && n % 2 === 0 && cells[n / 2 - 1].win === x.win) { x.pts *= 2; x.note = '×2'; } });
      return { you, them: SPREAD, cells, note: 'You hold castle 3, so your castle 6 counts double. The opponent doubles castles 2, 4 and 8.' };
    },
    tip: () => 'Think in pairs: castle 10 with 5 is worth 5 + 20 = 25, and 8 with 4 is worth 4 + 16 = 20. Win both halves of a pair or the double is lost.',
    zh: {
      name: '骨肉相連',
      blurb: () => '如果你同時奪得城堡 i，城堡 2i 的分數便會加倍。即城堡 2 與 1、4 與 2、6 與 3、8 與 4、10 與 5 配對。',
      example: () => '你奪得城堡 3 和 6。因為你同時擁有城堡 3，城堡 6 值 6 × 2 = 12 分。總分是 3 + 12 = 15 分。',
      note: () => '你擁有城堡 3，所以你的城堡 6 分數加倍。對手的城堡 2、4 和 8 加倍。',
      tip: () => '以配對思考：城堡 10 加上 5 值 5 + 20 = 25 分，城堡 8 加上 4 值 4 + 16 = 20 分。配對的兩座城堡都要奪得，否則便失去加倍。',
    },
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
    example: () => 'With 100 soldiers, 2 + 3 + 5 + 7 + 11 + 13 + 17 + 19 + 23 + 0 = 100 is a valid army, because every castle has a prime number or none. 9 or 10 soldiers on a castle would not be allowed.',
    picture: () => ({ you: [2, 3, 5, 7, 11, 13, 17, 19, 23, 0], them: [3, 0, 0, 0, 0, 0, 0, 29, 31, 37], note: 'Every castle holds a prime number of soldiers (2, 3, 5, 7, 11…) or none.' }),
    tip: () => 'Beat popular primes by stepping one prime up: 11 beats 7, 13 beats 11, 17 beats 13. Small primes like 2 and 3 grab castles that others leave empty.',
    zh: {
      name: '質數守軍',
      blurb: () => '每座城堡的士兵數目必須是質數（2、3、5、7、11……）或零。計分方法與經典相同。',
      example: () => '有 100 名士兵時，2 + 3 + 5 + 7 + 11 + 13 + 17 + 19 + 23 + 0 = 100 是合規的軍隊，因為每座城堡都是質數或零。一座城堡放 9 或 10 名士兵則不合規。',
      note: () => '每座城堡的士兵數目都是質數（2、3、5、7、11……）或零。',
      tip: () => '想勝過常見的質數，就用下一個質數：11 勝 7，13 勝 11，17 勝 13。2 和 3 這類小質數可以奪取別人留空的城堡。',
    },
    blurb: () => 'Every castle must get a prime number of soldiers (2, 3, 5, 7, 11…) or none at all. Scored like Classic.',
    match: (A, B, c) => classic(A.army, B.army, c.values),
  },

  attrition: {
    name: 'Attrition March', style: 'Algorithms and sequence', source: 'claude',
    example: () => 'You put 10 soldiers on castle 1 and your opponent puts 4. You win it, your opponent’s 4 are wiped out, and your 6 survivors march on to castle 2 to fight alongside the soldiers you placed there.',
    picture: () => {
      const you = [30, 0, 0, 0, 0, 0, 0, 0, 0, 70], cells = [];
      let ca = 0, cb = 0;
      for (let i = 0; i < CASTLES; i++) {
        const fa = you[i] + ca, fb = SPREAD[i] + cb, note = ca || cb ? `${fa} v ${fb}` : '';
        if (fa > fb) { cells.push({ win: 'you', pts: i + 1, note }); ca = fa - fb; cb = 0; }
        else if (fb > fa) { cells.push({ win: 'them', pts: i + 1, note }); cb = fb - fa; ca = 0; }
        else { cells.push({ win: null, pts: 0, note: note || 'tie' }); ca = cb = 0; }
      }
      return { you, them: SPREAD, cells, note: 'Your 20 survivors from castle 1 win castle 2 too. Then the opponent’s survivors snowball and arrive at castle 10 with 70.' };
    },
    tip: () => 'Put all your soldiers on castle 1. Your army then marches through the whole line and never loses a castle: it wins every castle until the opponent has used up all their soldiers. Spreading out only lets the opponent’s survivors snowball.',
    zh: {
      name: '消耗行軍',
      blurb: () => '軍隊由城堡 1 行軍至城堡 10。在每座城堡，兵力較多的一方獲勝，倖存的士兵（勝出的差額）會繼續前進，加入下一場戰鬥。落敗一方在該城堡的兵力全軍覆沒。',
      example: () => '你在城堡 1 放 10 名士兵，對手放 4 名。你獲勝，對手的 4 名士兵全軍覆沒，你的 6 名倖存者行軍至城堡 2，與你在那裏的士兵並肩作戰。',
      note: () => '你在城堡 1 的 20 名倖存者也奪得城堡 2。之後對手的倖存者越滾越多，到達城堡 10 時已有 70 名。',
      tip: () => '把全部士兵放在城堡 1。你的軍隊會一路行軍，永遠不會失去任何城堡：在對手用盡所有士兵之前，你會贏得每一座城堡。分散兵力只會讓對手的倖存者越滾越多。',
    },
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
    example: () => 'After everyone submits, castle 4 has the most soldiers in the room, so it is worth 1 point. Castle 9 has the fewest, so it is worth 10. A castle nobody else picks can be worth a lot.',
    picture: () => {
      const values = [9, 10, 8, 7, 6, 5, 4, 3, 1, 2], you = [20, 20, 20, 20, 0, 0, 0, 0, 0, 20], them = [0, 0, 0, 0, 10, 10, 10, 20, 25, 25];
      return { you, them, values, cells: plainCells(you, them, values), note: 'Gold numbers are the values revealed after everyone submits. The room piled into castles 9 and 10, so they are worth the least.' };
    },
    tip: () => 'Go where the room doesn’t. Most people pile into castles 8 to 10, so those end up worth the least, while the castles people ignore are worth the most and are cheap to win. Look at how the room played last round.',
    zh: {
      name: '選美比賽',
      blurb: () => '所有人提交後，城堡的分值由全場決定。士兵總數最多的城堡值 1 分，防守最少的值 10 分。猜猜其他人認為哪裏最熱門。',
      example: () => '所有人提交後，城堡 4 的士兵全場最多，所以值 1 分。城堡 9 最少，所以值 10 分。沒有人選的城堡可以非常值錢。',
      note: () => '金色數字是所有人提交後揭曉的分值。全場都湧向城堡 9 和 10，所以它們最不值錢。',
      tip: () => '去別人不去的地方。大部分人都湧向城堡 8 至 10，所以它們最後最不值錢；被忽略的城堡最值錢，而且容易奪得。參考上一回合全場的部署。',
    },
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
    example: () => 'Castle 1 might turn out to be worth 10 and castle 10 worth just 1. You only find out when time runs out, so spreading your soldiers out is safer than going all in on one castle.',
    picture: () => {
      const values = [10, 3, 7, 1, 9, 2, 8, 4, 6, 5], you = [0, 0, 0, 0, 0, 0, 25, 25, 25, 25];
      return { you, them: SPREAD, values, cells: plainCells(you, SPREAD, values), note: 'Gold numbers are the values revealed when time ran out. Castle 1 was the 10, and the opponent’s spread caught it.' };
    },
    tip: () => 'Every castle is worth 5.5 points on average, so the goal is simply to win as many castles as you can. Win lots of castles by a little and give up a few, instead of winning a few big ones.',
    zh: {
      name: '洗牌旗幟',
      blurb: () => '1 至 10 分的分值會秘密地隨機分配給各城堡，時間結束後才揭曉。每座城堡成為 10 分的機會都一樣。',
      example: () => '城堡 1 可能值 10 分，而城堡 10 只值 1 分。時間結束時你才知道，所以分散兵力比孤注一擲在一座城堡更安全。',
      note: () => '金色數字是時間結束時揭曉的分值。城堡 1 原來值 10 分，對手分散的兵力正好奪得它。',
      tip: () => '每座城堡平均值 5.5 分，所以目標就是奪得盡量多的城堡。以少許兵力贏下很多城堡，放棄幾座，而不是只贏幾座大城堡。',
    },
    blurb: () => 'The values 1–10 are secretly shuffled across the castles and revealed only after time runs out. Every castle is equally likely to be the 10.',
    prepare: () => ({ perm: shuffle(baseValues()) }),
    values: (c) => c.secret.perm.slice(),
    match: (A, B, c) => classic(A.army, B.army, c.values),
  },

  warchest: {
    name: 'War Chest', style: 'Economics and opportunity cost', source: 'claude', budget: 'atMost',
    params: [{ key: 'rate', label: 'Points per unused soldier, per matchup', default: 0.25, min: 0, max: 5, step: 0.05 }],
    example: (p) => `Keep 20 soldiers at home and you earn 20 × ${r2(p.rate)} = ${r2(20 * p.rate)} points in every matchup, on top of any castles you win.`,
    picture: (p) => ({ you: [0, 0, 0, 0, 0, 20, 20, 20, 20, 0], them: SPREAD, note: `You placed 80 and kept 20 home: 30 points from castles plus 20 × ${r2(p.rate)} = ${r2(20 * p.rate)}.` }),
    tip: (p) => `Each soldier at home earns a sure ${r2(p.rate)} per matchup. Only send a soldier if it is likely to win you more than that. One or two soldiers on many castles beat anyone who stays at home.`,
    zh: {
      name: '戰爭儲備',
      blurb: (p) => `你可以派出少於全部的士兵。每名留守的士兵在每場對戰中賺取 ${p.rate} 分。你的最後一名士兵派上戰場是否更值得？`,
      example: (p) => `留 20 名士兵在家，你在每場對戰中賺取 20 × ${r2(p.rate)} = ${r2(20 * p.rate)} 分，另加你奪得的城堡分數。`,
      note: (p) => `你派出 80 名，留 20 名在家：城堡 30 分，另加 20 × ${r2(p.rate)} = ${r2(20 * p.rate)} 分。`,
      tip: (p) => `每名留守的士兵每場對戰穩賺 ${r2(p.rate)} 分。只有在士兵很可能為你贏得更多分數時，才派他上陣。在很多城堡各放一兩名士兵，就能勝過留在家的人。`,
    },
    blurb: (p) => `You may send fewer than all your soldiers. Every soldier kept home earns ${p.rate} points in each matchup. Is your last soldier worth more on the field?`,
    match: (A, B, c) => {
      const [a, b] = classic(A.army, B.army, c.values);
      return [a + (c.soldiers - sum(A.alloc)) * c.params.rate, b + (c.soldiers - sum(B.alloc)) * c.params.rate];
    },
  },

  garrison: {
    name: 'Lingering Garrison', style: 'Dynamics and memory', source: 'claude', usesHistory: true,
    params: [{ key: 'keep', label: 'Share of last round’s soldiers that stay', default: 0.5, min: 0, max: 1, step: 0.05 }],
    example: (p) => `Last round you put 20 soldiers on castle 5. ${Math.round(p.keep * 100)}% stay, so ${Math.floor(20 * p.keep)} of them are still on castle 5 this round, added to whatever you place there now.`,
    picture: (p) => {
      const st = Math.floor(20 * p.keep), you = ten(10), army = you.map((x, i) => x + (i === 8 ? st : 0)), them = [11, 11, 11, 11, 11, 11, 11, 11, 11, 1];
      const cells = plainCells(army, them);
      if (st) cells[8].note = `+${st} stayed`;
      return { you, army, them, cells, note: `Last round you had 20 on castle 9. ${Math.round(p.keep * 100)}% stay, so ${st} extra soldiers fight there now.` };
    },
    tip: () => 'Count your stationed soldiers as free. Put new soldiers where you are weak, and avoid fighting other players where their stationed soldiers make them strong.',
    zh: {
      name: '駐守留兵',
      blurb: (p) => `你上一回合放在每座城堡的士兵，有 ${Math.round(p.keep * 100)}%（向下取整）仍然留守，與本回合的軍隊一起作戰。`,
      example: (p) => `上一回合你在城堡 5 放了 20 名士兵。有 ${Math.round(p.keep * 100)}% 留守，所以本回合城堡 5 仍有 ${Math.floor(20 * p.keep)} 名，再加上你現在放的士兵。`,
      note: (p) => `上一回合你在城堡 9 有 20 名士兵。${Math.round(p.keep * 100)}% 留守，所以現在那裏多了 ${Math.floor(20 * p.keep)} 名士兵作戰。`,
      tip: () => '把留守的士兵當作免費兵力。把新士兵放在你較弱的地方，避免在別人留守兵力強的城堡與他們硬拼。',
    },
    blurb: (p) => `${Math.round(p.keep * 100)}% of the soldiers you placed on each castle last round (rounded down) are still there and fight for you, on top of this round’s army.`,
    army: (alloc, c, e) => {
      const prev = c.prev[e.playerId];
      return alloc.map((x, i) => x + (prev ? Math.floor(prev[i] * c.params.keep) : 0));
    },
    match: (A, B, c) => classic(A.army, B.army, c.values),
  },

  alliance: {
    name: 'Grand Alliance', style: 'Cooperation', source: 'claude', teamLevel: true,
    example: () => 'Three players at your table put 30, 60 and 0 soldiers on castle 5. Your table’s army on castle 5 is the average, 30, and that is what fights the other tables.',
    picture: () => ({ you: [0, 0, 0, 15, 15, 15, 15, 15, 15, 10], them: SPREAD, labels: ['Your table', 'Other table'], note: 'Each bar is the average of everyone at that table. Your table’s average army takes castles 4 to 9.' }),
    tip: () => 'Agree on one army as a table and all submit it. Your table’s army is the average, so if each player does something different, the average gets spread thin and loses.',
    zh: {
      name: '大聯盟',
      blurb: () => '整組人作為一支軍隊作戰。每座城堡的兵力是組員士兵數目的平均數，你們的組軍與其他每一組對戰。你的得分是對所有對手玩家的平均分，所以人數較多的組影響較大。一起計劃吧。',
      example: () => '你組的三名玩家在城堡 5 分別放 30、60 和 0 名士兵。你組在城堡 5 的兵力就是平均數 30，用來與其他組作戰。',
      note: () => '每條柱是該組所有人的平均兵力。你組的平均軍隊奪得城堡 4 至 9。',
      tip: () => '全組商量好同一支軍隊，大家都提交它。組的軍隊是平均數，如果每人各自為政，平均下來兵力會變得分散而落敗。',
    },
    blurb: () => 'Your table fights as one. Each castle gets the average of your teammates’ soldiers, and your team army battles every other team’s. Your score is the average over every opposing player, so bigger teams count for more. Plan together.',
    match: (A, B, c) => classic(A.army, B.army, c.values),
  },

  decisive: {
    name: 'Decisive Victory', style: 'Ratios and thresholds', source: 'claude',
    params: [{ key: 'ratio', label: 'Need more than ×', default: 2, min: 1, max: 10, step: 0.5 }],
    example: (p) => { const t = 10 * p.ratio; return `Your opponent puts 10 soldiers on a castle. You need more than ${t}: ${Math.floor(t) + 1} soldiers win it, but ${Math.floor(t)} or fewer is a stalemate and nobody scores.`; },
    picture: (p) => {
      const you = [25, 0, 0, 0, 0, 0, 0, 0, 15, 60], k = p.ratio;
      const cells = you.map((x, i) => { const y = SPREAD[i]; return x > k * y ? { win: 'you', pts: i + 1 } : y > k * x ? { win: 'them', pts: i + 1 } : { win: null, pts: 0, note: 'stalemate' }; });
      return { you, them: SPREAD, cells, note: `You need more than ${k}× the opponent’s soldiers to take a castle, and so do they.` };
    },
    tip: (p) => `Defending is cheap: 1 soldier on a castle forces the opponent to bring more than ${r2(p.ratio)}. Use a few soldiers to defend many castles, then put a big stack on a few high castles.`,
    zh: {
      name: '壓倒性勝利',
      blurb: (p) => `只有當你的士兵多於對手的 ${p.ratio} 倍時，才能奪得城堡。否則便是僵持，雙方都不得分。`,
      example: (p) => { const t = 10 * p.ratio; return `對手在一座城堡放 10 名士兵。你需要多於 ${t} 名：${Math.floor(t) + 1} 名可以奪得，但 ${Math.floor(t)} 名或更少便是僵持，沒有人得分。`; },
      note: (p) => `你需要多於對手 ${p.ratio} 倍的士兵才能奪得城堡，對手也一樣。`,
      tip: (p) => `防守很便宜：在城堡放 1 名士兵，對手便要派出多於 ${r2(p.ratio)} 名。用少量士兵守住很多城堡，再把大量士兵集中在幾座高分城堡。`,
    },
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
    example: () => 'You score 30 points in a matchup and your opponent scores 25. You take all 55 points and they get 0. Winning 28–27 pays exactly the same as winning 50–5.',
    picture: () => ({ you: MIDDLE, them: SPREAD, note: 'You win the castles 35 to 20, so you take all 55 points and the opponent gets nothing.' }),
    tip: () => 'Only winning counts, not by how much. You need just 28 of the 55 points, for example castles 10 + 9 + 8 + 1. Spend everything on one such set and ignore the rest.',
    zh: {
      name: '贏家通吃',
      blurb: () => '每場對戰按經典方法計分，但領先的一方奪得全部 55 分，落敗的一方 0 分，打和則雙方都不得分。勝出的差距並不重要。',
      example: () => '你在一場對戰得 30 分，對手得 25 分。你奪得全部 55 分，對手 0 分。以 28 比 27 獲勝，與以 50 比 5 獲勝的分數完全一樣。',
      note: () => '你以 35 比 20 贏得城堡分數，所以奪得全部 55 分，對手一無所得。',
      tip: () => '只有勝負才重要，差距不重要。你只需要 55 分中的 28 分，例如城堡 10 + 9 + 8 + 1。把所有士兵集中在一組這樣的城堡，其他不理。',
    },
    blurb: () => 'Each matchup is scored like Classic, but whoever finishes ahead takes all 55 points. The loser gets nothing, and a tied matchup pays nobody. Winning margins don’t matter.',
    match: (A, B, c) => {
      const [a, b] = classic(A.army, B.army, c.values);
      const pot = sum(c.values);
      return a > b ? [pot, 0] : b > a ? [0, pot] : [0, 0];
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
    budget: 'atMost', // players may always place fewer soldiers than they have
    primesOnly: !!(m.primesOnly || round.primesOnly),
    hiddenValues: !!m.hiddenValues,
  };
}
function exampleFor(round) {
  const m = modeOf(round.mode);
  return m.example ? m.example(paramsFor(round)) : '';
}
// The worked matchup for a round, scored with the mode's own rules.
function pictureFor(round) {
  const m = modeOf(round.mode);
  if (!m.picture) return null;
  const p = paramsFor(round), pic = m.picture(p);
  const values = pic.values || baseValues(), army = pic.army || pic.you;
  const ctx = { params: p, soldiers: 100, values, prev: {}, secret: {}, reveal: {} };
  const score = m.match({ alloc: pic.you, army }, { alloc: pic.them, army: pic.them }, ctx);
  return {
    labels: pic.labels || ['You', 'Opponent'], you: army, them: pic.them, values, hiddenValues: !!m.hiddenValues,
    cells: pic.cells || plainCells(army, pic.them, values), score: score.map(r2), note: pic.note || '',
    noteZh: m.zh && m.zh.note ? m.zh.note(p) : '',
  };
}
// Chinese texts for a round, shown on phones set to 中文.
function zhFor(round) {
  const m = modeOf(round.mode), z = m.zh, p = paramsFor(round);
  if (!z) return null;
  let blurb = z.blurb(p);
  if (round.primesOnly && !m.primesOnly) blurb += '特別規則：每座城堡的士兵數目必須是質數或零。';
  return { name: z.name, blurb, example: z.example(p), tip: z.tip(p) };
}
function tipFor(round) {
  const m = modeOf(round.mode);
  return m.tip ? m.tip(paramsFor(round)) : '';
}

// Best army in hindsight: the army that would have scored the highest average against every
// army actually submitted this round, playing as an extra player at no table. Local search
// over (10 castles + home): repeatedly re-split the soldiers of two slots in the best way.
function hindsight({ round, entries, soldiers, prev = {}, secret = {}, values, timeMs = 250 }) {
  const m = modeOf(round.mode);
  if (m.teamLevel || !entries.length) return null;
  const ctx = { params: paramsFor(round), soldiers, prev, secret, reveal: {}, values: values || baseValues() };
  const opp = entries.map((e) => ({ alloc: e.alloc, army: m.army ? m.army(e.alloc, ctx, e) : e.alloc }));
  const ok = (x) => x === 0 || !roundRules(round).primesOnly || isPrime(x);
  const score = (a) => { const al = a.slice(0, CASTLES); let t = 0; for (const o of opp) t += m.match({ alloc: al, army: al }, o, ctx)[0]; return t / opp.length; };
  const withHome = (al) => { const a = al.slice(0, CASTLES); const used = sum(a); return used > soldiers ? null : [...a, soldiers - used]; };
  // Start from simple shapes (they win ties, so answers stay easy to read) and from the
  // strongest armies the room actually played.
  const strongest = entries.map((e) => withHome(e.alloc)).filter(Boolean)
    .map((a) => ({ a, s: score(a) })).sort((x, y) => y.s - x.s).slice(0, 6).map((x) => x.a);
  const seeds = [
    [soldiers, 0, 0, 0, 0, 0, 0, 0, 0, 0], ten(Math.floor(soldiers / CASTLES)),
    baseValues().map((v) => Math.floor((soldiers * v) / 55)), ...strongest,
  ].map((a) => (a.length === CASTLES ? withHome(a) : a)).filter((a) => a && a.every((x, i) => i === CASTLES || ok(x)));
  const end = Date.now() + timeMs;
  let best = null, bestScore = -Infinity;
  for (const seed of seeds) {
    const a = seed.slice();
    let cur = score(a), improved = true;
    while (improved && Date.now() < end) {
      improved = false;
      for (let i = 0; i <= CASTLES && Date.now() < end; i++) for (let j = i + 1; j <= CASTLES; j++) {
        const t = a[i] + a[j], oi = a[i];
        let bx = oi, bs = cur;
        for (let x = 0; x <= t; x++) {
          if (x === oi || (i < CASTLES && !ok(x)) || (j < CASTLES && !ok(t - x))) continue;
          a[i] = x; a[j] = t - x;
          const s2 = score(a);
          if (s2 > bs + 1e-9) { bs = s2; bx = x; }
        }
        a[i] = bx; a[j] = t - bx;
        if (bs > cur + 1e-9) { cur = bs; improved = true; }
      }
    }
    if (cur > bestScore) { bestScore = cur; best = a.slice(0, CASTLES); }
    if (Date.now() >= end) break;
  }
  return best && { alloc: best, score: r2(bestScore) };
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
  // Bots place every soldier, except where keeping some home pays (War Chest).
  const budget = modeOf(round.mode).budget === 'atMost' ? Math.floor(soldiers * (0.6 + 0.4 * rnd())) : soldiers;
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
    for (const id of ids) rec[id].score = rec[id].opponents ? rec[id].score / rec[id].opponents : 0;
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
    // A player's round score is the average over all their matchups, not the sum.
    for (const p of P) { const pl = players[p.playerId]; pl.score = pl.opponents ? pl.score / pl.opponents : 0; }
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
    example: m.example ? m.example(Object.fromEntries((m.params || []).map((d) => [d.key, d.default]))) : '',
  }));
}

module.exports = { MODES, CASTLES, modeOf, paramsFor, roundRules, blurbFor, exampleFor, pictureFor, tipFor, zhFor, hindsight, validate, randomAlloc, scoreRound, catalog, isPrime, classic };
