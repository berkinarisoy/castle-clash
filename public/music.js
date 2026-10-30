// Number Siege — countdown music for the board, made with the Web Audio API (no sound files).
// A steady march while players build their armies, faster and higher in the last 10 seconds,
// faster again in the last 5, and a gong when time runs out. Silent while paused.
const CountdownMusic = (() => {
  let ctx = null, master = null, on = false, wasActive = false, nextBeat = 0, beat = 0;
  const BASS = [45, 45, 48, 52, 45, 45, 50, 52]; // A2 A2 C3 E3 A2 A2 D3 E3 (MIDI notes)
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function tone(t, f, dur, { type = 'sine', vol = 0.2, attack = 0.005, slideTo = null } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  const drum = (t, vol) => tone(t, 160, 0.2, { vol, slideTo: 45 });
  const tick = (t, vol, f) => tone(t, f, 0.035, { type: 'triangle', vol });
  function gong(t) {
    [110, 165.5, 221, 278, 333].forEach((f, i) => tone(t, f, 3.6 - i * 0.45, { vol: 0.3 / (i + 1), attack: 0.01 }));
  }

  // Schedule eighth notes a little ahead of time so the beat stays steady.
  function schedule(ms) {
    const urgent = ms <= 10000, final = ms <= 5000;
    const step = 60 / (final ? 200 : urgent ? 160 : 112) / 2;
    while (nextBeat < ctx.currentTime + 0.15) {
      const b = beat % 8;
      if (b % 2 === 0) {
        drum(nextBeat, urgent ? 0.55 : 0.35);
        tone(nextBeat, hz(BASS[Math.floor(beat / 2) % 8] + (urgent ? 12 : 0)), step * 1.8, { type: 'triangle', vol: 0.16 });
      }
      tick(nextBeat, b % 2 ? 0.06 : 0.03, urgent ? 2600 : 2000);
      nextBeat += step; beat++;
    }
  }

  // Call often (every ~50 ms) with the board state and the time left on the round timer.
  function update(state, ms) {
    const active = !!state && state.status === 'active' && ms > 0;
    if (on && ctx) {
      if (active && !wasActive) { nextBeat = ctx.currentTime + 0.05; beat = 0; }
      if (active) schedule(ms);
      else if (wasActive && state && (state.status === 'closed' || state.status === 'revealed')) gong(ctx.currentTime + 0.02);
    }
    wasActive = active;
  }

  // Browsers only allow sound after a click, so the audio starts on the first click.
  function setOn(v) {
    on = v;
    if (on && !ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { on = false; return; }
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.6; master.connect(ctx.destination);
    }
    if (ctx) ctx[on ? 'resume' : 'suspend']();
  }
  return { update, setOn, isOn: () => on, ready: () => !!ctx };
})();
