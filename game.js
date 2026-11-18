'use strict';
/* ==========================================================================
   FC SOCCER BROS - game.js
   Part 1: engine (11v11 physics, AI, camera, rendering, audio, netcode snapshots)
   Part 2: loading screen, menus & game modes
   ========================================================================== */

const $ = s => document.querySelector(s);
const canvas = $('#game'), ctx = canvas.getContext('2d');
const uiEl = $('#ui');
const W = 960, H = 540;                 // canvas size
const PW = 1600, PD = 300;              // pitch length (x) and depth (y) in world units
const GY0 = 112, GY1 = 188, GYC = 150;  // goal mouth (y range) and centre
const CROSS = 62;                       // crossbar height
const STEP = 1 / 60;
const GAME_SPEED = 0.68;               // whole game runs slower so you have time to think
const DEPTH_K = 0.62;                   // squash of depth velocity so shots feel 2.5D
const CAM = { x: PW / 2 };              // camera follows the ball along the pitch
const HCOL = ['#ffd23f', '#4cc9f0', '#ef476f', '#06d6a0', '#ff9f1c', '#b388eb', '#f72585', '#90e0ef'];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// World -> screen projection (broadcast camera tilted down: far side is slightly smaller)
function proj(x, y, z) {
  const sc = 0.82 + 0.18 * (y / PD);
  return { x: 480 + (x - CAM.x) * sc, y: 212 + y * 1.02 - (z || 0) * sc, sc };
}

/* ============================== AUDIO ================================== */
const Snd = (() => {
  let ac = null, out = null;
  function init() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); out = ac.createGain(); out.gain.value = 0.55; out.connect(ac.destination); }
      catch (e) { ac = null; }
    }
    if (ac && ac.state === 'suspended') ac.resume();
  }
  function tone(f, dur, type, vol, f2, delay) {
    if (!ac) return;
    const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, ftype, f1, f2, delay, attack) {
    if (!ac) return;
    const t = ac.currentTime + (delay || 0), n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = ac.createBufferSource(); s.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = ftype; f.frequency.setValueAtTime(f1, t);
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + (attack || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t);
  }
  return {
    init,
    kick(p) { p = p || 0.5; tone(120 + 90 * p, 0.12, 'sine', 0.7, 45); noise(0.06, 0.25 + 0.3 * p, 'lowpass', 1400); },
    thud() { tone(90, 0.1, 'sine', 0.5, 40); },
    swish() { noise(0.55, 0.5, 'bandpass', 3200, 800); },
    whistle() { tone(2900, 0.3, 'square', 0.1); tone(3150, 0.3, 'square', 0.08, null, 0.03); },
    roar() { noise(2.4, 0.38, 'bandpass', 650, 1300, 0, 0.9); },
    chime() { [660, 880, 1320, 1760].forEach((f, i) => tone(f, 0.55, 'triangle', 0.2, null, i * 0.09)); },
    save() { noise(0.14, 0.4, 'highpass', 1600); tone(230, 0.1, 'square', 0.15, 120); },
    post() { tone(950, 0.28, 'triangle', 0.4, 650); },
    tick() { tone(700, 0.05, 'square', 0.08); },
    coin() { tone(988, 0.08, 'square', 0.12); tone(1319, 0.2, 'square', 0.12, null, 0.08); },
    blip() { tone(520, 0.06, 'square', 0.07, 780); },
  };
})();

/* ============================== INPUT ================================== */
const keys = {};
const typing = () => document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
addEventListener('keydown', e => {
  if (typing()) return;
  keys[e.code] = true;
  if (/^(Arrow|Space|Tab)/.test(e.code)) e.preventDefault();
  Snd.init();
  if ((e.code === 'Escape' || e.code === 'KeyP') && cur && !cur.net) togglePause();
}, { passive: false });
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// Space = shoot / pass / slide.  Tap Space with the ball = PASS (hold an arrow Up/Down/Left/Right to pick who).
// Hold Space = charge a SHOT.  Space without the ball = slide tackle (or header / bicycle kick in the air).
const SCHEMES = {
  solo: { up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], shoot: ['Space', 'Enter'], jump: ['KeyC', 'KeyE'], sprint: ['ShiftLeft', 'ShiftRight'], sw: ['KeyX', 'KeyQ'] },
  p1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], shoot: ['Space'], jump: ['KeyE'], sprint: ['ShiftLeft'], sw: ['KeyQ'] },
  p2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], shoot: ['Enter'], jump: ['Period'], sprint: ['ShiftRight'], sw: ['Slash'] },
};
function mkCtl(kind, scheme) { return { kind, scheme, held: {}, prev: {}, edge: {}, ev: {}, net: null }; }
function pollCtl(c) {
  let h;
  if (c.kind === 'keys') {
    const s = SCHEMES[c.scheme], any = a => a.some(k => keys[k]);
    h = { mx: (any(s.right) ? 1 : 0) - (any(s.left) ? 1 : 0), my: (any(s.down) ? 1 : 0) - (any(s.up) ? 1 : 0), shoot: any(s.shoot), jump: any(s.jump), sprint: any(s.sprint), sw: any(s.sw) };
  } else h = c.net || { mx: 0, my: 0, shoot: false, jump: false, sprint: false, sw: false };
  c.edge = { shootP: h.shoot && !c.prev.shoot, shootR: !h.shoot && !!c.prev.shoot, jumpP: h.jump && !c.prev.jump, swP: h.sw && !c.prev.sw };
  if (c.ev) {
    if (c.ev.sp) c.edge.shootP = true; if (c.ev.sr) c.edge.shootR = true; if (c.ev.jp) c.edge.jumpP = true; if (c.ev.sw) c.edge.swP = true;
    c.ev = {};
  }
  c.prev = { shoot: h.shoot, jump: h.jump, sw: h.sw };
  c.held = h;
  return h;
}

/* ============================== KITS =================================== */
function hexRGB(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
function colorDist(a, b) { const x = hexRGB(a), y = hexRGB(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }
function kitFor(teamId, vs) {
  const T = TEAMS[teamId] || TEAMS.OTH; let c1 = T.c1, c2 = T.c2;
  if (vs && colorDist(c1, vs.c1) < 120) { [c1, c2] = [c2, c1]; if (colorDist(c1, vs.c1) < 120) c1 = '#222222'; }
  return { c1, c2, style: T.style || 'solid', sh: c2 };
}

/* ============================== MATCH ================================== */
// 10 outfield formation spots (slots 1-10 of SLOT_POS): LB CB CB RB CM CM CAM LW ST RW. x is the fraction of PW from own goal.
const FORM = [[0.20, 48], [0.15, 118], [0.15, 182], [0.20, 252], [0.31, 92], [0.31, 208], [0.38, 150], [0.44, 50], [0.47, 150], [0.44, 250]];

function mkPlayer(pd, t, i, kit) {
  const f = FORM[i], hx = t === 0 ? PW * f[0] : PW * (1 - f[0]);
  return { pd, st: pd.stats, team: t, idx: i, isKeeper: false, x: hx, y: f[1], z: 0, vx: 0, vy: 0, vz: 0, fx: t === 0 ? 1 : -1, fy: 0, home: { x: hx, y: f[1] }, stamina: 1, exhausted: false, charging: false, charge: 0, chargeT: 0, aimAng: 0, aiCharge: 0.8, slideT: 0, slideCd: 0, sfx: 1, sfy: 0, slideHit: false, cd: 0, poke: 0, kickAnim: 0, runPhase: Math.random() * 6, aiT: rnd(0, 0.5), kit, num: [3, 5, 4, 2, 8, 6, 10, 11, 9, 7][i] + (hashStr(pd.name) % 3 === 0 ? 10 : 0), beard: pd.beard !== undefined ? pd.beard : hashStr(pd.name) % 5 === 0, human: null, locked: false, spin: 0 };
}
function mkKeeper(pd, t, kit) {
  return { pd, st: pd.stats, team: t, idx: -1, isKeeper: true, x: t === 0 ? 12 : PW - 12, y: GYC, z: 0, vx: 0, vy: 0, vz: 0, fx: t === 0 ? 1 : -1, fy: 0, hold: 0, dive: 0, saveCd: 0, runPhase: 0, kit, num: 1, beard: false, slideT: 0, kickAnim: 0 };
}

// cfg: { sides:[{team,label,slots[11]}, {...}], humans:[{ctl,team,lock,name,id}], lvls:[l0,l1], halfLen, golden, startScore, net, onEnd, onQuit }
//   lock = outfield index (0-9) the human is locked to, or null for FIFA-style auto-switch to the nearest player.
function createMatch(cfg) {
  const m = {
    cfg, time: cfg.halfLen || 120, half: 1, score: (cfg.startScore || [0, 0]).slice(), state: 'kickoff', stateT: 2.2,
    players: [], keepers: [], tm: [], humans: [], ball: { x: PW / 2, y: PD / 2, z: 0, vx: 0, vy: 0, vz: 0, turn: 0, turnT: 0, owner: null, last: null, fire: false, spin: 0 },
    parts: [], popups: [], shake: 0, hitstop: 0, ended: false, golden: false, goldT: 0, pens: false, netRip: [0, 0], kickTeam: 0, clock: 0,
    net: cfg.net || null, out: [], snapN: 0,
  };
  const kit0 = kitFor(cfg.sides[0].team, null), kit1 = kitFor(cfg.sides[1].team, kit0), kits = [kit0, kit1];
  for (let t = 0; t < 2; t++) {
    const side = cfg.sides[t], tm = { t, players: [], kit: kits[t], lvl: cfg.lvls ? cfg.lvls[t] : 0.85, c1: null, c2: null };
    for (let i = 0; i < 10; i++) { const p = mkPlayer(side.slots[i + 1], t, i, kits[t]); tm.players.push(p); m.players.push(p); }
    const gkKit = { c1: t === 0 ? '#2fe05a' : '#ff4fa0', c2: '#111111', style: 'solid', sh: '#111111' };
    m.keepers.push(mkKeeper(side.slots[0], t, gkKit));
    m.tm.push(tm);
  }
  (cfg.humans || []).forEach((h, i) => {
    const hh = { ctl: h.ctl || null, team: h.team, lock: h.lock === undefined ? null : h.lock, name: h.name, id: h.id, ctrl: h.lock != null ? h.lock : (h.start != null ? h.start : 8), color: HCOL[i % HCOL.length], label: (h.name || ('P' + (i + 1))).slice(0, 7).toUpperCase(), inp: null };
    if (hh.lock != null) m.tm[hh.team].players[hh.lock].locked = true;
    m.humans.push(hh);
  });
  resetKickoff(m, 0);
  CAM.x = PW / 2;
  return m;
}

function resetKickoff(m, kickTeam) {
  m.kickTeam = kickTeam;
  for (const tm of m.tm) tm.players.forEach(p => { p.x = p.home.x; p.y = p.home.y; p.z = 0; p.vx = p.vy = p.vz = 0; p.charging = false; p.charge = 0; p.slideT = 0; p.fx = p.team === 0 ? 1 : -1; p.fy = 0; p.cd = 0; });
  m.keepers.forEach(k => { k.x = k.team === 0 ? 12 : PW - 12; k.y = GYC; k.hold = 0; });
  const b = m.ball; b.x = PW / 2; b.y = PD / 2; b.z = 0; b.vx = b.vy = b.vz = 0; b.turn = 0; b.turnT = 0; b.fire = false; b.owner = null;
  const kp = m.tm[kickTeam].players[8]; kp.x = PW / 2 + (kickTeam === 0 ? -14 : 14); kp.y = PD / 2; b.owner = kp; b.last = kp;
  m.humans.forEach(h => { if (h.lock == null && h.team === kickTeam) h.ctrl = 8; });
  m.state = 'kickoff'; m.stateT = 1.8;
}

/* ---------- events (sound/particles/banner), mirrored to online guests ---------- */
function emit(m, type, d) { d = d || {}; handleEvent(m, type, d); if (m.net && m.net.role === 'host') m.out.push([type, d]); }
let bannerTimer = 0;
function showBanner(text, ms) { const el = $('#banner'); el.textContent = text; el.classList.add('show'); clearTimeout(bannerTimer); bannerTimer = setTimeout(() => el.classList.remove('show'), ms || 1700); }
function popup(m, text, x, y) { m.popups.push({ text, x, y, t: 1.2 }); }
function burst(m, x, y, z, n, colors, spd, life, grav) {
  for (let i = 0; i < n; i++) m.parts.push({ x, y, z, vx: rnd(-spd, spd), vy: rnd(-spd, spd) * 0.5, vz: rnd(spd * 0.2, spd), life: rnd(life * 0.6, life), max: life, c: Array.isArray(colors) ? pick(colors) : colors, s: rnd(1.5, 3.5), g: grav === undefined ? 500 : grav });
}
function handleEvent(m, type, d) {
  switch (type) {
    case 'kick': Snd.kick(d.p); break;
    case 'power': Snd.kick(1); Snd.thud(); popup(m, 'POWER SHOT!', d.x, d.y); m.shake = Math.max(m.shake, 6); burst(m, d.x, d.y, 4, 14, ['#ffb703', '#fb5607', '#ffd166'], 130, 0.5, 100); break;
    case 'goal': Snd.swish(); Snd.roar(); Snd.whistle(); showBanner('GOAL!', 2400); m.shake = 10; burst(m, d.x, d.y, 20, 60, ['#ffd23f', '#ef476f', '#06d6a0', '#4cc9f0', '#fff'], 220, 1.8, 260); break;
    case 'save': Snd.save(); popup(m, 'SAVE!', d.x, d.y); break;
    case 'post': Snd.post(); popup(m, 'OFF THE WOODWORK!', d.x, d.y); m.shake = Math.max(m.shake, 3); break;
    case 'tackle': Snd.thud(); burst(m, d.x, d.y, 2, 10, ['#7a5230', '#4b8f35', '#9c7a4d'], 100, 0.5, 400); m.shake = Math.max(m.shake, 2); break;
    case 'dirt': burst(m, d.x, d.y, 1, 2, ['#7a5230', '#4b8f35'], 40, 0.4, 300); break;
    case 'trivela': popup(m, 'TRIVELA!', d.x, d.y); break;
    case 'whistle': Snd.whistle(); break;
    case 'banner': showBanner(d.t, d.ms); break;
    case 'end': Snd.whistle(); Snd.whistle(); break;
  }
}

/* ---------- ball helpers ---------- */
function kickBall(m, p, dx, dy, speed, loft, turn, turnT, fire) {
  const b = m.ball, l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  b.owner = null; b.vx = dx * speed; b.vy = dy * speed * DEPTH_K; b.vz = speed * loft; b.turn = turn || 0; b.turnT = turnT || 0; b.last = p; b.fire = !!fire;
  b.x = p.x + dx * 9; b.y = p.y + dy * 4; b.z = Math.max(2, p.z);
  p.cd = 0.3; p.kickAnim = 0.22; p.charging = false; p.charge = 0; p.chargeT = 0;
  emit(m, 'kick', { p: clamp(speed / 650, 0.2, 1) });
}
function goalAngle(p) { const gx = p.team === 0 ? PW : 0; return Math.atan2((GYC - p.y) / DEPTH_K, gx - p.x); }
function powerFactor(c) { return c < 0.88 ? 0.3 + 0.7 * (c / 0.88) : Math.max(0.55, 1 - (c - 0.88) * 2.4); }

function fireShot(m, p, volley) {
  const st = p.st, c = p.charge, atk = p.team === 0 ? 1 : -1;
  const ang = goalAngle(p) + p.aimAng * atk;
  const sweet = !volley && c >= 0.78 && c <= 0.88;
  const speed = (210 + st.shot * 3.2) * powerFactor(volley ? 0.7 : c) * (sweet ? 1.28 : 1) * (volley ? 0.92 : 1);
  const loft = volley ? 0.26 : (sweet ? 0.12 : 0.16);
  const turn = -Math.sign(p.aimAng) * Math.min(Math.abs(p.aimAng), 0.5) * (st.shot / 99) * 1.2;
  kickBall(m, p, Math.cos(ang), Math.sin(ang), speed, loft, turn, 0.9, sweet);
  p.kickAnim = 0.28;
  if (sweet) { m.hitstop = 0.08; emit(m, 'power', { x: m.ball.x, y: m.ball.y }); }
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
function bestPassTarget(m, p, dir) {
  const mates = m.tm[p.team].players, opps = m.tm[1 - p.team].players;
  let best = null, bs = -1e9;
  for (const q of mates) {
    if (q === p) continue;
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
    if (d < 40) continue;
    const dot = (dx * dir.x + dy * dir.y) / d;
    if (dot < 0.2) continue;
    let open = 200; for (const o of opps) open = Math.min(open, segDist(o.x, o.y, p.x, p.y, q.x, q.y));
    const s = dot * 120 - Math.abs(d - 220) * 0.07 + open * 0.15;
    if (s > bs) { bs = s; best = q; }
  }
  return best;
}
// Tap-Space pass: goes to the teammate in the direction you are holding (Up / Down / forward / back).
function doPass(m, p, it) {
  const atk = p.team === 0 ? 1 : -1;
  let dir;
  if (it.mx || it.my) { const l = Math.hypot(it.mx, it.my * 0.8) || 1; dir = { x: it.mx / l, y: it.my * 0.8 / l }; }
  else dir = { x: atk, y: 0 };
  const q = bestPassTarget(m, p, dir);
  if (!q) { kickBall(m, p, dir.x, dir.y, 260, 0, 0, 0, false); return; }
  const tx = q.x + q.vx * 0.35, ty = q.y + q.vy * 0.35;
  const dx = tx - p.x, dy = (ty - p.y) / DEPTH_K, d = Math.hypot(dx, dy);
  let open = 200; for (const o of m.tm[1 - p.team].players) open = Math.min(open, segDist(o.x, o.y, p.x, p.y, q.x, q.y));
  let speed = clamp(200 + p.st.pass * 1.3 + d * 0.3, 240, 600), loft = 0.03, turn = 0, turnT = 0, ang = Math.atan2(dy, dx);
  if (d > 170 && open < 26) { speed = clamp(d * 1.05 + 130, 280, 560); loft = clamp(260 * d / (speed * speed), 0.12, 1.0); }   // auto-lob over a blocked lane
  else if (p.st.pass >= 95) {
    // TRIVELA: outside-of-the-boot curl around the nearest defender
    let nd = 1e9, no = null;
    for (const o of m.tm[1 - p.team].players) { const sd = segDist(o.x, o.y, p.x, p.y, q.x, q.y); if (sd < nd) { nd = sd; no = o; } }
    if (no && nd < 80) {
      const cr = Math.cos(ang) * ((no.y - p.y) / DEPTH_K) - Math.sin(ang) * (no.x - p.x), s = cr >= 0 ? 1 : -1, delta = 0.32, T = d / speed;
      ang -= s * delta; turn = s * 2 * delta / T; turnT = T;
      emit(m, 'trivela', { x: p.x, y: p.y });
    }
  }
  kickBall(m, p, Math.cos(ang), Math.sin(ang), speed, loft, turn, turnT, false);
  const h = m.humans.find(x => x.team === p.team && x.lock == null); if (h) h.ctrl = q.idx;
}

function startSlide(m, p) { p.slideT = 0.38; p.slideCd = 0.9; p.sfx = p.fx || (p.team === 0 ? 1 : -1); p.sfy = p.fy || 0; p.slideHit = false; p.charging = false; }

function applyIntent(m, p, it, dt) {
  const b = m.ball, st = p.st, has = b.owner === p;
  p.prot = Math.max(0, (p.prot || 0) - dt); p.cd = Math.max(0, p.cd - dt); p.poke = Math.max(0, p.poke - dt); p.slideCd = Math.max(0, p.slideCd - dt); p.kickAnim = Math.max(0, p.kickAnim - dt);

  // ---- sliding ----
  if (p.slideT > 0) {
    p.slideT -= dt; const k = p.slideT / 0.38, sp = 120 + 260 * k;
    p.vx = p.sfx * sp; p.vy = p.sfy * sp * 0.72;
    p.x = clamp(p.x + p.vx * dt, 6, PW - 6); p.y = clamp(p.y + p.vy * dt, 6, PD - 6);
    if (Math.random() < 0.5) emit(m, 'dirt', { x: p.x, y: p.y });
    const reach = 14 + st.def * 0.13, o = b.owner;
    if (!p.slideHit) {
      if (o && o.team !== p.team && !o.isKeeper && !(o.prot > 0) && Math.hypot(o.x - p.x, o.y - p.y) < reach && o.z < 14) {
        p.slideHit = true; o.cd = 0.6; o.charging = false; o.charge = 0;
        b.owner = null; b.vx = p.sfx * 170 + rnd(-30, 30); b.vy = p.sfy * 170 * DEPTH_K + rnd(-30, 30); b.vz = 40; b.last = p; b.turn = 0;
        emit(m, 'tackle', { x: p.x, y: p.y });
      } else if (!o && Math.hypot(b.x - p.x, b.y - p.y) < reach + 4 && b.z < 20) {
        p.slideHit = true; b.vx = p.sfx * 250; b.vy = p.sfy * 250 * DEPTH_K; b.vz = 30; b.last = p; b.turn = 0;
        emit(m, 'tackle', { x: p.x, y: p.y });
      }
    }
    return;
  }

  // ---- stamina ----
  const canSprint = it.sprint && p.stamina > (p.exhausted ? 0.25 : 0.02) && (it.mx || it.my);

  // ---- Space with the ball: tap = pass, hold = charged shot ----
  if (has && it.shootP && p.z < 4 && !p.charging) { p.charging = true; p.charge = 0; p.chargeT = 0; p.aimAng = it.aimSet !== undefined ? it.aimSet : 0; }
  else if (has && it.shootP && p.z >= 4) { p.charge = 0.7; fireShot(m, p, true); }
  if (p.charging) {
    if (!has) { p.charging = false; p.charge = 0; p.chargeT = 0; }
    else if (it.shoot) {
      p.chargeT += dt;
      if (p.chargeT > 0.18) {
        p.charge += dt / 0.95;
        if (it.aimSet === undefined) p.aimAng = clamp(p.aimAng + (it.aimDir || 0) * dt * 1.4, -0.65, 0.65);
        p.fx = p.team === 0 ? 1 : -1; p.fy = 0;
        if (p.charge >= 1.1) fireShot(m, p, false);
      }
    } else {
      if (it.human && p.chargeT <= 0.18) { p.charging = false; p.charge = 0; p.chargeT = 0; doPass(m, p, it); }
      else fireShot(m, p, false);
    }
  } else if (!has && it.shootP) {
    if (p.z > 4) {
      const dist = Math.hypot(b.x - p.x, b.y - p.y);
      if (!b.owner && dist < 38 && Math.abs(b.z - (p.z + 14)) < 44) {
        const bike = b.z > p.z + 26, ang = goalAngle(p);
        kickBall(m, p, Math.cos(ang), Math.sin(ang), (240 + st.shot * 2.4) * (bike ? 1.15 : 1), bike ? 0.1 : 0.06, 0, 0, bike);
        if (bike) { p.spin = 0.4; popup(m, 'BICYCLE!', p.x, p.y); }
      } else { p.vx += p.fx * 130; }
    } else if (!b.owner && b.z > 20 && Math.hypot(b.x - p.x, b.y - p.y) < 60) {
      p.vz = 200 + st.jump * 1.4; p.hdr = 0.7;                       // jump for the header
    } else if (p.slideCd <= 0) { startSlide(m, p); return; }
  }
  if (has && it.passP && !p.charging) doPass(m, p, it);   // AI pass

  // ---- jump ----
  if (it.jumpP && p.z === 0 && !p.charging) p.vz = 200 + st.jump * 1.4;

  // ---- movement ----
  let sp = 120 + st.pace * 1.15;
  if (has) sp *= 0.94; if (p.charging && p.chargeT > 0.18) sp *= 0.3; if (p.kickAnim > 0.14) sp *= 0.8;
  if (canSprint) { sp *= 1.32; p.stamina -= dt * 0.45; if (p.stamina <= 0) { p.stamina = 0; p.exhausted = true; } }
  else { p.stamina = Math.min(1, p.stamina + dt * 0.28); if (p.stamina > 0.3) p.exhausted = false; }
  let mx = it.mx, my = it.my; const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  const acc = p.z > 0 ? 3 : 12;
  p.vx += (mx * sp - p.vx) * Math.min(1, acc * dt); p.vy += (my * sp * 0.72 - p.vy) * Math.min(1, acc * dt);
  if (len > 0.1 && !(p.charging && p.chargeT > 0.18)) { const fl = Math.hypot(mx, my * 0.8) || 1; p.fx = mx / fl; p.fy = my * 0.8 / fl; }
  p.x = clamp(p.x + p.vx * dt, 6, PW - 6); p.y = clamp(p.y + p.vy * dt, 6, PD - 6);
  if (p.hdr > 0) {
    p.hdr -= dt;
    if (!b.owner && p.z > 6 && Math.hypot(b.x - p.x, b.y - p.y) < 36 && Math.abs(b.z - (p.z + 16)) < 40) {
      const ang = goalAngle(p); kickBall(m, p, Math.cos(ang), Math.sin(ang), 200 + st.shot * 1.8, 0.05, 0, 0, false); p.hdr = 0;
    }
  }
  if (p.z > 0 || p.vz > 0) { p.vz -= 900 * dt; p.z += p.vz * dt; if (p.z <= 0) { p.z = 0; p.vz = 0; } }
  if (p.spin > 0) p.spin -= dt;
  p.runPhase += Math.hypot(p.vx, p.vy) * dt * 0.09;
}

/* ---------- AI (10 outfielders per side, positional play) ---------- */
function computeChasers(m) {
  const b = m.ball;
  for (const tm of m.tm) {
    const list = tm.players.filter(q => !q.human).map(q => ({ q, d: Math.hypot(q.x - b.x, (q.y - b.y) * 1.4) })).sort((a, c) => a.d - c.d);
    tm.c1 = list[0] ? list[0].q : null; tm.c2 = list[1] ? list[1].q : null;
  }
}
function aiIntent(m, p, tm, dt) {
  const b = m.ball, it = { mx: 0, my: 0, sprint: false, shoot: false, shootP: false, shootR: false, jumpP: false, passP: false, aimDir: 0 };
  const atk = p.team === 0 ? 1 : -1, goalX = p.team === 0 ? PW : 0, L = tm.lvl;
  const opps = m.tm[1 - p.team].players, has = b.owner === p;
  const teamHas = b.owner && b.owner.team === p.team, oppHas = b.owner && b.owner.team !== p.team;
  p.aiT -= dt;
  const moveTo = (tx, ty, spr) => { const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy); if (d > 6) { it.mx = dx / d; it.my = dy / d; } it.sprint = !!spr && d > 60; };
  const speedMul = 0.74 + 0.14 * L;
  if (p.charging) { it.shoot = true; if (p.charge >= p.aiCharge) { it.shoot = false; it.shootR = true; } it.aimSet = p.aimAng; return it; }

  if (has) {
    const dg = Math.abs(goalX - p.x), keeper = m.keepers[1 - p.team];
    let no = null, nd = 1e9; for (const o of opps) { const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < nd) { nd = d; no = o; } }
    const lane = no && Math.abs(no.y - p.y) < 40 && Math.abs(no.x - goalX) < Math.abs(p.x - goalX) && nd < 120;
    if (p.aiT <= 0 && ((dg < 300 && !lane && Math.random() < dt * 1.6) || (dg < 140 && Math.random() < dt * 4))) {
      const ty = (keeper.y > GYC ? GYC - 26 : GYC + 26) + rnd(-12, 12) * (1.5 - L);
      const ang = Math.atan2((ty - p.y) / DEPTH_K, goalX - p.x), a0 = goalAngle(p);
      it.shootP = true; it.shoot = true; it.aimSet = clamp((ang - a0) * atk, -0.65, 0.65);
      p.aiCharge = Math.random() < 0.3 * L ? rnd(0.79, 0.87) : rnd(0.6, 0.78); p.aiT = 0.8;
      return it;
    }
    if (nd < 55 && p.aiT <= 0) {
      let q = bestPassTarget(m, p, { x: atk, y: 0 });
      if (!q) q = bestPassTarget(m, p, { x: 0, y: p.y > GYC ? -1 : 1 });
      if (q) { const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1; it.mx = dx / d; it.my = dy / d; it.passP = true; p.aiT = 1.0; return it; }
    }
    if (p.aiT <= 0 && dg > 350 && Math.random() < dt * 0.5) {   // look for a forward pass now and then
      const q = bestPassTarget(m, p, { x: atk, y: 0 });
      if (q && Math.abs(goalX - q.x) < Math.abs(goalX - p.x) - 80) { const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1; it.mx = dx / d; it.my = dy / d; it.passP = true; p.aiT = 1.2; return it; }
    }
    let ty = p.y + (GYC - p.y) * 0.4; if (no && nd < 100) ty += (p.y >= no.y ? 1 : -1) * 70;
    moveTo(goalX - atk * 30, clamp(ty, 30, PD - 30), nd < 100);
    it.mx *= speedMul * 0.92; it.my *= speedMul * 0.92; return it;
  }
  const chasing = (p === tm.c1 && !teamHas) || (p === tm.c2 && oppHas && Math.hypot(p.x - b.x, p.y - b.y) < 240) || (p === tm.c2 && !b.owner && Math.hypot(p.x - b.x, p.y - b.y) < 160);
  if (chasing) {
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    // jockey: do not run straight into the carrier - close down, then contest
    if (oppHas && d < 70) moveTo(b.x - atk * 26 + b.vx * 0.2, b.y, false); else moveTo(b.x + b.vx * 0.25, b.y + b.vy * 0.25, d > 120);
    if (oppHas && d < 26 && p.slideCd <= 0 && !(b.owner && b.owner.prot > 0) && Math.random() < dt * 0.9 * L) it.shootP = true;
    if (!oppHas && b.z > 22 && b.z < 72 && d < 42 && p.z === 0 && p.aiT <= 0) { it.jumpP = true; p.aiT = 0.6; }
    if (p.z > 5 && d < 36 && b.z > 14) it.shootP = true;
    it.mx *= speedMul; it.my *= speedMul; return it;
  }
  if (oppHas && p.idx <= 6) {   // mark the most dangerous nearby attacker, staying goal-side
    let mk = null, md = 190; for (const o of opps) { if (o === b.owner) continue; const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < md) { md = d; mk = o; } }
    if (mk) { moveTo(mk.x - atk * 24, mk.y, md > 120); it.mx *= speedMul; it.my *= speedMul; return it; }
  }
  // hold formation: shift with the ball; forwards run beyond the carrier when we attack
  const shift = teamHas ? 0.7 : 0.5;
  let tx = p.home.x + (b.x - PW / 2) * shift, ty = p.home.y + (b.y - GYC) * 0.25;
  if (teamHas && p.idx >= 6) tx = (atk > 0) ? Math.max(tx, b.owner.x + 90) : Math.min(tx, b.owner.x - 90);
  if (p.idx <= 3 && teamHas) tx = p.team === 0 ? Math.min(tx, Math.max(b.x - 150, p.home.x)) : Math.max(tx, Math.min(b.x + 150, p.home.x));
  moveTo(clamp(tx, 40, PW - 40), clamp(ty, 25, PD - 25), false);
  it.mx *= speedMul; it.my *= speedMul; return it;
}

function updateHumans(m) {
  for (const p of m.players) p.human = null;
  const b = m.ball;
  for (const h of m.humans) {
    if (!h.ctl) continue;
    const inp = pollCtl(h.ctl), tm = m.tm[h.team]; h.inp = inp;
    if (h.lock != null) h.ctrl = h.lock;
    else {
      const cur = tm.players[h.ctrl], e = h.ctl.edge, used = new Set(m.humans.filter(x => x !== h && x.team === h.team).map(x => x.ctrl)), free = q => !q.locked && !used.has(q.idx);
      if (b.owner && b.owner.team === h.team && !b.owner.isKeeper && free(b.owner)) h.ctrl = b.owner.idx;
      else if (e.swP) {
        let best = h.ctrl, bd = 1e9;
        tm.players.forEach((q, i) => { const d = Math.hypot(q.x - b.x, q.y - b.y); if (i !== h.ctrl && free(q) && d < bd) { bd = d; best = i; } });
        h.ctrl = best;
      } else if (!cur.charging && cur.slideT <= 0) {
        let best = h.ctrl, bd = Math.hypot(cur.x - b.x, cur.y - b.y) - 40;
        tm.players.forEach((q, i) => { const d = Math.hypot(q.x - b.x, q.y - b.y); if (free(q) && d < bd) { bd = d; best = i; } });
        h.ctrl = best;
      }
    }
    tm.players[h.ctrl].human = h;
  }
}

/* ---------- ball update, keepers, goals ---------- */
function updateBall(m, dt) {
  const b = m.ball;
  if (b.owner) {
    const o = b.owner;
    if (o.isKeeper) { b.x = o.x + o.fx * 8; b.y = o.y; b.z = 18; b.vx = b.vy = b.vz = 0; }
    else { b.x = o.x + o.fx * 11; b.y = o.y + o.fy * 5; b.z = o.z + 3; b.vx = o.vx; b.vy = o.vy; b.vz = 0; }
    b.fire = false; b.turn = 0; b.turnT = 0;
    if (!o.isKeeper) {   // opponents poking the ball away
      for (const q of m.tm[1 - o.team].players) {
        if (!(o.prot > 0) && q.poke <= 0 && q.slideT <= 0 && q.z < 6 && Math.abs(q.x - o.x) < 16 && Math.hypot(q.x - o.x, q.y - o.y) < 14) {
          q.poke = 1.0;
          const ch = clamp(0.05 + (q.st.def - o.st.pace) / 500, 0.02, 0.15) * (o.charging ? 1.4 : 1);
          if (Math.random() < ch) {
            o.cd = 0.5; o.charging = false; o.charge = 0; o.chargeT = 0; b.owner = q; b.last = q; q.prot = 0.8;
            const h = m.humans.find(x => x.team === q.team && x.lock == null); if (h && !q.locked) h.ctrl = q.idx;
            emit(m, 'tackle', { x: q.x, y: q.y }); break;
          }
        }
      }
    }
    return;
  }
  if (b.turnT > 0) {
    b.turnT -= dt; const a = b.turn * dt, c = Math.cos(a), s = Math.sin(a), nx = b.vx * c - b.vy * s, ny = b.vx * s + b.vy * c; b.vx = nx; b.vy = ny;
    if (b.turnT <= 0) b.turn = 0;
  }
  b.vz -= 520 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (b.z <= 0) { b.z = 0; if (b.vz < -60) b.vz = -b.vz * 0.55; else b.vz = 0; }
  const f = Math.pow(b.z <= 0.5 ? 0.42 : 0.85, dt); b.vx *= f; b.vy *= f;
  if (b.y < 4) { b.y = 4; b.vy = Math.abs(b.vy) * 0.7; } if (b.y > PD - 4) { b.y = PD - 4; b.vy = -Math.abs(b.vy) * 0.7; }
  b.spin += Math.hypot(b.vx, b.vy) * dt * 0.06;
  if (b.x < 0 || b.x > PW) { endLine(m); if (m.state !== 'play') return; }
  if (b.fire) { if (Math.hypot(b.vx, b.vy) < 170) b.fire = false; else if (Math.random() < 0.8) burst(m, b.x, b.y, b.z, 1, ['#ffb703', '#fb5607', '#ffe066'], 25, 0.35, 0); }
  for (const p of m.players) {   // capture
    if (p.cd > 0 || p.slideT > 0 || Math.abs(p.x - b.x) > 16) continue;
    if (Math.hypot(p.x - b.x, p.y - b.y) < 15 && b.z < 24 && Math.abs(b.z - p.z) < 22) {
      b.owner = p; b.last = p; p.charging = false; p.charge = 0; p.chargeT = 0; b.fire = false; p.prot = p.human ? 1.6 : 0.8;
      const h = m.humans.find(x => x.team === p.team && x.lock == null); if (h && !p.locked) h.ctrl = p.idx;
      break;
    }
  }
}
function endLine(m) {
  const b = m.ball, left = b.x < 0, inMouth = b.y > GY0 + 3 && b.y < GY1 - 3;
  if (inMouth && b.z < CROSS) { scoreGoal(m, left ? 1 : 0); return; }
  if (inMouth || (b.y > GY0 - 7 && b.y < GY1 + 7)) { if (Math.hypot(b.vx, b.vy) > 160) emit(m, 'post', { x: b.x < 0 ? 4 : PW - 4, y: b.y }); }
  b.x = left ? 1 : PW - 1; b.vx = -b.vx * 0.55; b.vy *= 0.8; b.fire = false;
}
function scoreGoal(m, team) {
  const b = m.ball;
  m.score[team]++; m.state = 'goal'; m.stateT = 2.8; m.kickTeam = 1 - team;
  m.netRip[team === 0 ? 1 : 0] = 1.3;
  b.x = team === 0 ? PW + 6 : -6; b.vx = b.vy = b.vz = 0; b.z = 0; b.fire = false; b.owner = null;
  emit(m, 'goal', { team, x: clamp(b.x, 10, PW - 10), y: b.y });
}

function updateKeeper(m, k, dt) {
  const b = m.ball, t = k.team, gx = t === 0 ? 0 : PW, into = t === 0 ? 1 : -1, st = k.st;
  k.saveCd = Math.max(0, k.saveCd - dt); k.dive = Math.max(0, k.dive - dt); k.kickAnim = Math.max(0, k.kickAnim - dt);
  if (b.owner === k) {
    k.hold -= dt; if (k.hold <= 0) {
      const mates = m.tm[t].players; let tgt = null, bd = 1e9;
      for (const q of mates) { const d = Math.abs(q.x - PW * 0.4) + (q.idx <= 3 ? 400 : 0); if (d < bd) { bd = d; tgt = q; } }
      const tx = tgt ? tgt.x : PW / 2, ty = tgt ? tgt.y : GYC;
      const dx = tx - k.x, dy = (ty - k.y) / DEPTH_K, d = Math.hypot(dx, dy), speed = clamp(d * 0.9 + 140, 280, 520);
      kickBall(m, k, dx, dy, speed, clamp(260 * d / (speed * speed), 0.15, 0.9), 0, 0, false);
      k.saveCd = 0.6;
    }
    return;
  }
  const towards = !b.owner && (t === 0 ? b.vx < -40 : b.vx > 40);
  let tx = gx + into * 12, ty = clamp(b.y, GY0 - 6, GY1 + 6) * 0.6 + GYC * 0.4;
  if (towards) {
    const tt = Math.abs((gx - b.x) / b.vx);
    if (tt < 1.5) ty = clamp(b.y + b.vy * tt, GY0 - 3, GY1 + 3);
  } else if (b.owner && b.owner.team !== t) {
    const d = Math.abs(b.owner.x - gx);
    if (d < 170) tx = gx + into * clamp((170 - d) * 0.22, 0, 30);
    ty = clamp(b.owner.y * 0.7 + GYC * 0.3, GY0 - 8, GY1 + 8);
  }
  const sp = 105 + st.pace * 0.9 + (towards ? 90 : 0);
  k.vx = clamp(tx - k.x, -sp * dt, sp * dt) / dt; k.vy = clamp(ty - k.y, -sp * dt, sp * dt) / dt;
  k.x += k.vx * dt; k.y += k.vy * dt; k.runPhase += Math.hypot(k.vx, k.vy) * dt * 0.08;
  k.fy = 0;
  if (!b.owner && k.saveCd <= 0) {
    const reach = 17 + st.def * 0.14, v = Math.hypot(b.vx, b.vy);
    if (Math.hypot(b.x - k.x, b.y - k.y) < reach && b.z < 30 + st.jump * 0.55 && (towards || (v < 130 && Math.abs(b.x - gx) < 70))) {
      k.saveCd = 0.3; k.dive = 0.45;
      const diff = v / (380 + st.def * 2.6), chance = clamp(0.95 - diff * 0.62, 0.22, 0.95);
      if (Math.random() < chance) {
        if (v < 330) { b.owner = k; k.hold = 0.9; b.last = k; emit(m, 'save', { x: k.x, y: k.y }); }
        else { b.vx = -b.vx * 0.35 + into * 90; b.vy = (b.y >= k.y ? 1 : -1) * rnd(80, 190); b.vz = rnd(60, 150); b.last = k; b.fire = false; b.turn = 0; b.turnT = 0; emit(m, 'save', { x: k.x, y: k.y }); }
      }
    }
  }
}

/* ---------- camera ---------- */
function updateCamera(m, dt) {
  const b = m.ball, target = clamp(b.x + b.vx * 0.2, 500, PW - 500);
  CAM.x += (target - CAM.x) * Math.min(1, 4 * dt);
}

/* ---------- main step ---------- */
function startHalfTime(m) { m.state = 'half'; m.stateT = 2.8; emit(m, 'whistle'); emit(m, 'banner', { t: 'HALF TIME', ms: 2400 }); }
function beginEnd(m, pens) { m.state = 'end'; m.stateT = 2.4; m.pens = !!pens; emit(m, 'end'); emit(m, 'banner', { t: pens ? 'FULL TIME - PENALTIES!' : 'FULL TIME', ms: 2300 }); }
function teamStrength(m, t) { return m.tm[t].players.reduce((a, p) => a + p.pd.ovr, 0) / m.tm[t].players.length; }

function stepMatch(m, dt) {
  m.clock += dt;
  updateCamera(m, dt);
  if (m.hitstop > 0) { m.hitstop -= dt; return; }
  m.shake = Math.max(0, m.shake - dt * 14);
  for (let i = 0; i < 2; i++) m.netRip[i] = Math.max(0, m.netRip[i] - dt);
  updateParts(m, dt);
  for (const q of m.popups) q.t -= dt; m.popups = m.popups.filter(q => q.t > 0);
  if (m.state === 'kickoff') { m.stateT -= dt; if (m.stateT <= 0) { m.state = 'play'; emit(m, 'whistle'); } return; }
  if (m.state === 'goal') {
    m.stateT -= dt;
    if (m.stateT <= 0) { if (m.golden) beginEnd(m, false); else { m.state = 'kickoff'; resetKickoff(m, m.kickTeam); } }
    return;
  }
  if (m.state === 'half') { m.stateT -= dt; if (m.stateT <= 0) { m.half = 2; m.time = m.cfg.halfLen || 120; resetKickoff(m, 1); } return; }
  if (m.state === 'end') { m.stateT -= dt; if (m.stateT <= 0) m.ended = true; return; }

  if (!m.golden) {
    m.time -= dt / GAME_SPEED;
    if (m.time <= 0) {
      m.time = 0;
      if (m.half === 1) { startHalfTime(m); return; }
      if (m.score[0] === m.score[1] && m.cfg.golden) { m.golden = true; m.goldT = 0; emit(m, 'banner', { t: 'GOLDEN GOAL!', ms: 2200 }); }
      else { beginEnd(m, false); return; }
    }
  } else {
    m.goldT += dt / GAME_SPEED;
    if (m.goldT > 75) {
      const s0 = teamStrength(m, 0), s1 = teamStrength(m, 1);
      m.penWinner = Math.random() < 0.5 + (s0 - s1) / 60 ? 0 : 1; beginEnd(m, true); return;
    }
  }
  updateHumans(m); computeChasers(m);
  for (const tm of m.tm) for (const p of tm.players) {
    let it;
    if (p.human) {
      const h = p.human, inp = h.inp, e = h.ctl.edge;
      it = { mx: inp.mx, my: inp.my, sprint: inp.sprint, shoot: inp.shoot, shootP: e.shootP, shootR: e.shootR, jumpP: e.jumpP, aimDir: inp.my, human: true };
    } else it = aiIntent(m, p, tm, dt);
    applyIntent(m, p, it, dt);
  }
  // soft player separation
  const P = m.players;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const a = P[i], c = P[j]; if (Math.abs(a.x - c.x) > 14 || a.z > 8 || c.z > 8 || a.slideT > 0 || c.slideT > 0) continue;
    const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy);
    if (d > 0.01 && d < 13) { const push = (13 - d) * 0.5; a.x -= dx / d * push; a.y -= dy / d * push; c.x += dx / d * push; c.y += dy / d * push; }
  }
  updateBall(m, dt);
  if (m.state !== 'play') return;
  for (const k of m.keepers) updateKeeper(m, k, dt);
}

function updateParts(m, dt) {
  for (const q of m.parts) { q.life -= dt; q.vz -= q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; if (q.z < 0) { q.z = 0; q.vz *= -0.3; q.vx *= 0.6; } }
  m.parts = m.parts.filter(q => q.life > 0);
  if (m.parts.length > 400) m.parts.splice(0, m.parts.length - 400);
}
function matchResult(m) {
  let winner = m.score[0] > m.score[1] ? 0 : m.score[1] > m.score[0] ? 1 : -1;
  if (m.pens && m.penWinner !== undefined) winner = m.penWinner;
  return { h: m.score[0], a: m.score[1], winner, pens: m.pens };
}

/* ============================== NETCODE SNAPSHOTS ====================== */
const r1 = v => Math.round(v * 10) / 10;
function makeSnap(m) {
  const b = m.ball; let ow = -1;
  if (b.owner) ow = b.owner.isKeeper ? -2 - b.owner.team : m.players.indexOf(b.owner);
  const ev = m.out; m.out = [];
  return {
    t: 's', time: r1(m.time), half: m.half, score: m.score, state: m.state, golden: m.golden, gt: r1(m.goldT), hc: m.humans.map(h => h.ctrl), rip: m.netRip.map(r1),
    b: [r1(b.x), r1(b.y), r1(b.z), b.fire ? 1 : 0, r1(b.spin), ow],
    p: m.players.map(p => [r1(p.x), r1(p.y), r1(p.z), r1(p.fx), r1(p.fy), r1(p.charge), r1(p.stamina), r1(p.slideT), r1(p.runPhase), r1(p.aimAng), p.charging ? 1 : 0, r1(p.kickAnim), r1(p.vx), r1(p.vy)]),
    k: m.keepers.map(k => [r1(k.x), r1(k.y), r1(k.dive), r1(k.vx), r1(k.vy)]),
    ev,
  };
}
function applySnap(m, s) {
  m.time = s.time; m.half = s.half; m.score = s.score; m.state = s.state; m.golden = s.golden; m.goldT = s.gt; m.netRip = s.rip;
  s.hc.forEach((c, i) => { if (m.humans[i]) m.humans[i].ctrl = c; });
  const b = m.ball; b.tx = s.b[0]; b.ty = s.b[1]; b.tz = s.b[2]; b.fire = !!s.b[3]; b.spin = s.b[4];
  b.owner = s.b[5] >= 0 ? m.players[s.b[5]] : (s.b[5] <= -2 ? m.keepers[-2 - s.b[5]] : null);
  if (!m.gotSnap) { b.x = b.tx; b.y = b.ty; b.z = b.tz; m.gotSnap = true; }
  s.p.forEach((a, i) => { const p = m.players[i]; p.tx = a[0]; p.ty = a[1]; if (!m.gotSnap || p.x === undefined) { p.x = a[0]; p.y = a[1]; } p.z = a[2]; p.fx = a[3]; p.fy = a[4]; p.charge = a[5]; p.stamina = a[6]; p.slideT = a[7]; p.runPhase = a[8]; p.aimAng = a[9]; p.charging = !!a[10]; p.kickAnim = a[11]; p.vx = a[12]; p.vy = a[13]; });
  s.k.forEach((a, i) => { const k = m.keepers[i]; k.tx = a[0]; k.ty = a[1]; k.dive = a[2]; k.vx = a[3]; k.vy = a[4]; });
  for (const e of s.ev) handleEvent(m, e[0], e[1]);
}
function guestSmooth(m, dt) {
  const f = Math.min(1, 22 * dt), ents = m.players.concat(m.keepers, [m.ball]);
  for (const e of ents) { if (e.tx !== undefined) { e.x += (e.tx - e.x) * f; e.y += (e.ty - e.y) * f; } }
  m.ball.z += (m.ball.tz - m.ball.z) * f;
  updateCamera(m, dt); updateParts(m, dt); m.popups.forEach(q => q.t -= dt); m.popups = m.popups.filter(q => q.t > 0);
  m.clock += dt; m.shake = Math.max(0, m.shake - dt * 14);
}

/* ============================== RENDERING ============================== */
let STANDS = null;   // pre-rendered 960px-wide crowd tile (scrolls with parallax)
function buildStands() {
  STANDS = document.createElement('canvas'); STANDS.width = 960; STANDS.height = 212; const g = STANDS.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 212); gr.addColorStop(0, '#141a3a'); gr.addColorStop(1, '#2b3566'); g.fillStyle = gr; g.fillRect(0, 0, 960, 212);
  const cols = ['#e63946', '#f1c453', '#4cc9f0', '#f8f9fa', '#8ac926', '#ff9f1c', '#b388eb'];
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let row = 0; row < 8; row++) for (let i = 0; i < 80; i++) {
    g.fillStyle = cols[Math.floor(r() * cols.length)]; g.globalAlpha = 0.5 + r() * 0.4;
    const x = i * 12 + (row % 2) * 6, y = 18 + row * 20 + r() * 3;
    g.beginPath(); g.arc(x, y + 6, 4.5, 0, 7); g.fill(); g.fillRect(x - 4, y + 10, 8, 7);
  }
  g.globalAlpha = 1;
  const ads = ['FC BROS', 'SOCCER BROS', 'ULTIMATE TEAM', 'HYPER-LINK', 'ICON PACKS', 'ROAD TO GLORY'];
  g.font = 'bold 12px Trebuchet MS'; g.textAlign = 'center';
  for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#d62828' : '#003049'; g.fillRect(i * 160, 190, 160, 22); g.fillStyle = '#fff'; g.fillText(ads[i], i * 160 + 80, 205); }
}
function drawPitch() {
  if (!STANDS) buildStands();
  const ox = -((CAM.x * 0.25) % 960);
  ctx.drawImage(STANDS, ox, 0); ctx.drawImage(STANDS, ox + 960, 0); if (ox > -0.5) ctx.drawImage(STANDS, ox - 960, 0);
  ctx.fillStyle = '#1b6a2e'; ctx.fillRect(0, 212, W, H - 212);
  const poly = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill(); };
  const s0 = Math.floor((CAM.x - 700) / 100);
  for (let i = s0; i < s0 + 15; i++) {
    const x0 = i * 100, x1 = x0 + 100; if (x1 < -40 || x0 > PW + 40) continue;
    poly([proj(Math.max(x0, -40), -12, 0), proj(Math.min(x1, PW + 40), -12, 0), proj(Math.min(x1, PW + 40), PD + 14, 0), proj(Math.max(x0, -40), PD + 14, 0)], (i & 1) ? '#2e9644' : '#36a44c');
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
  const line = (pts, close) => { ctx.beginPath(); pts.forEach((p, i) => { const q = proj(p[0], p[1], 0); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); if (close) ctx.closePath(); ctx.stroke(); };
  line([[0, 0], [PW, 0], [PW, PD], [0, PD]], true);
  line([[PW / 2, 0], [PW / 2, PD]]);
  const circ = []; for (let a = 0; a < 6.3; a += 0.2) circ.push([PW / 2 + 70 * Math.cos(a), PD / 2 + 46 * Math.sin(a)]); line(circ, true);
  line([[0, 55], [160, 55], [160, 245], [0, 245]]); line([[PW, 55], [PW - 160, 55], [PW - 160, 245], [PW, 245]]);
  line([[0, 92], [60, 92], [60, 208], [0, 208]]); line([[PW, 92], [PW - 60, 92], [PW - 60, 208], [PW, 208]]);
  const cs = proj(PW / 2, PD / 2, 0); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(cs.x, cs.y, 3, 2, 0, 0, 7); ctx.fill();
}

function drawGoal(m, side) {
  const sgn = side === 0 ? -1 : 1, gx = side === 0 ? 0 : PW, depth = 24, rip = m ? m.netRip[side] : 0;
  const sx = proj(gx, GYC, 0).x; if (sx < -120 || sx > W + 120) return;
  const P = (x, y, z) => proj(x, y, z), wob = k => rip > 0 ? Math.sin(m.clock * 40 + k) * rip * 4 : 0;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.beginPath();
  let a = P(gx, GY0, 0), b = P(gx + sgn * depth, GY0, CROSS - 6), c = P(gx + sgn * depth, GY1, CROSS - 6), d = P(gx, GY1, 0);
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
  for (let y = GY0; y <= GY1; y += 8) { const q0 = P(gx, y, CROSS), q1 = P(gx + sgn * depth, y, CROSS - 6), q2 = P(gx + sgn * depth, y, 0); ctx.beginPath(); ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x + wob(y), q1.y); ctx.lineTo(q2.x + wob(y), q2.y); ctx.stroke(); }
  for (let z = 0; z <= CROSS; z += 10) { const q0 = P(gx + sgn * depth, GY0, Math.max(0, z - 6)), q1 = P(gx + sgn * depth, GY1, Math.max(0, z - 6)); ctx.beginPath(); ctx.moveTo(q0.x + wob(z), q0.y); ctx.lineTo(q1.x + wob(z + 3), q1.y); ctx.stroke(); }
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.2;
  const t0 = P(gx, GY0, 0), t1 = P(gx, GY0, CROSS), t2 = P(gx, GY1, CROSS), t3 = P(gx, GY1, 0);
  ctx.beginPath(); ctx.moveTo(t0.x, t0.y); ctx.lineTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.lineTo(t3.x, t3.y); ctx.stroke();
  const bt1 = P(gx + sgn * depth, GY0, CROSS - 6), bt2 = P(gx + sgn * depth, GY1, CROSS - 6);
  ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.lineTo(bt1.x, bt1.y); ctx.moveTo(t2.x, t2.y); ctx.lineTo(bt2.x, bt2.y); ctx.moveTo(bt1.x, bt1.y); ctx.lineTo(bt2.x, bt2.y); ctx.stroke();
  ctx.restore();
}

function drawHair(e, headY) {
  const hs = e.pd.hairStyle, hc = e.pd.hairColor; ctx.fillStyle = hc; ctx.strokeStyle = hc;
  const cap = r => { ctx.beginPath(); ctx.arc(0, headY - 1, r, Math.PI * 1.04, Math.PI * 1.96); ctx.closePath(); ctx.fill(); };
  switch (hs) {
    case 'short': cap(11.6); ctx.fillRect(-11, headY - 4, 3, 6); break;
    case 'buzz': ctx.globalAlpha = 0.65; cap(11.2); ctx.globalAlpha = 1; break;
    case 'curly': for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(i * 4.6, headY - 9 + Math.abs(i) * 1.6, 4.4, 0, 7); ctx.fill(); } break;
    case 'long': cap(11.8); ctx.fillRect(-12, headY - 6, 5, 18); ctx.fillRect(7.5, headY - 5, 3, 8); break;
    case 'afro': ctx.beginPath(); ctx.arc(0, headY - 3, 14.5, 0, 7); ctx.fill(); break;
    case 'slick': cap(11.5); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-6, headY - 11, 10, 2); break;
    case 'mohawk': ctx.beginPath(); ctx.moveTo(-8, headY - 8); ctx.lineTo(-4, headY - 18); ctx.lineTo(0, headY - 10); ctx.lineTo(4, headY - 18); ctx.lineTo(8, headY - 8); ctx.closePath(); ctx.fill(); break;
    default: break;
  }
}

function drawChibi(m, e, mark) {
  const P = proj(e.x, e.y, 0), sc = P.sc, k = sc * 1.34, zz = e.z * sc, dir = e.fx >= 0 ? 1 : -1;
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(P.x, P.y, (15 - Math.min(e.z, 50) * 0.1) * k, 5.2 * k, 0, 0, 7); ctx.fill();
  const kit = e.kit, moving = Math.hypot(e.vx || 0, e.vy || 0) > 18, run = moving ? Math.sin(e.runPhase) : 0;
  ctx.save(); ctx.translate(P.x, P.y - zz); ctx.scale(k, k);
  if (e.slideT > 0) { ctx.rotate(dir * 1.2); ctx.translate(0, 6); }
  else if (e.spin > 0) { ctx.translate(0, -16); ctx.rotate(dir * (1 - e.spin / 0.4) * 6.28); ctx.translate(0, 16); }
  ctx.scale(dir, 1);
  if (e.isKeeper && e.dive > 0) ctx.rotate(0.54 * (e.y > GYC ? 1 : -1));
  ctx.lineJoin = 'round'; ctx.lineWidth = 1.8; ctx.strokeStyle = '#10131c';
  const rr = (x, y, w, h, r, fill) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); ctx.fillStyle = fill; ctx.fill(); ctx.stroke(); };
  const skin = e.pd.skinTone, shirt = e.isKeeper ? kit.c1 : kit.c1;
  let l = run * 5; if (e.kickAnim > 0.05) l = 8;
  // legs, socks, boots
  rr(-6.5 - l * 0.4, -11, 5, 11, 2, skin); rr(1.5 + l, -11, 5, 11, 2, skin);
  rr(-6.5 - l * 0.4, -6.5, 5, 5.5, 1.5, e.isKeeper ? '#222' : kit.c1); rr(1.5 + l, -6.5, 5, 5.5, 1.5, e.isKeeper ? '#222' : kit.c1);
  rr(-8.5 - l * 0.4, -3, 8.5, 4.2, 2, '#161922'); rr(1 + l, -3, 9.5, 4.2, 2, '#161922');
  // shorts
  rr(-8.5, -16.5, 17, 8.5, 3, kit.sh);
  // arms
  const sw = run * 4;
  rr(-13, -28 + sw * 0.3, 4.8, 10.5, 2.3, skin); rr(8.2, -28 - sw * 0.3, 4.8, 10.5, 2.3, skin);
  rr(-13, -28 + sw * 0.3, 4.8, 5.5, 2, e.isKeeper ? '#fff' : shirt); rr(8.2, -28 - sw * 0.3, 4.8, 5.5, 2, e.isKeeper ? '#fff' : shirt);
  // torso + kit pattern
  rr(-9.5, -30, 19, 15.5, 4.5, shirt);
  ctx.save(); ctx.beginPath(); ctx.rect(-9.5, -30, 19, 15.5); ctx.clip(); ctx.fillStyle = kit.c2;
  if (kit.style === 'stripes') { for (let i = -2; i <= 2; i += 2) ctx.fillRect(i * 3.6 - 1.8, -30, 3.6, 16); }
  else if (kit.style === 'hoops') { for (let i = 0; i < 4; i += 2) ctx.fillRect(-10, -30 + i * 3.9, 20, 3.9); }
  else if (kit.style === 'sash') { ctx.beginPath(); ctx.moveTo(-10, -30); ctx.lineTo(-3, -30); ctx.lineTo(10, -14); ctx.lineTo(3, -14); ctx.closePath(); ctx.fill(); }
  else if (kit.style === 'checks') { for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) ctx.fillRect(-9.5 + i * 3.8, -30 + j * 3.9, 3.8, 3.9); }
  ctx.restore();
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(-9.5, -30, 19, 15.5, 4.5); else ctx.rect(-9.5, -30, 19, 15.5); ctx.stroke();
  ctx.save(); ctx.scale(dir, 1); ctx.fillStyle = (kit.style === 'solid' || kit.style === 'sash') ? (colorDist(kit.c1, '#ffffff') < 140 ? '#222' : '#fff') : '#111'; ctx.font = 'bold 8px Arial'; ctx.textAlign = 'center'; ctx.fillText(e.num, 0, -19.5); ctx.restore();
  // big round head (Soccer Bros style)
  ctx.save(); ctx.translate(1.5, -41); ctx.scale(1.12, 1.12);
  if (e.pd.hairStyle === 'afro') drawHair(e, 0);
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); ctx.fillStyle = skin; ctx.fill(); ctx.stroke();
  if (e.pd.hairStyle !== 'afro') drawHair(e, 0);
  if (e.beard) { ctx.strokeStyle = e.pd.hairColor; ctx.lineWidth = 3.2; ctx.beginPath(); ctx.arc(0, 0, 8.6, 0.22 * Math.PI, 0.82 * Math.PI); ctx.stroke(); ctx.strokeStyle = '#10131c'; ctx.lineWidth = 1.8; }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(2.8, -0.5, 2.9, 3.5, 0, 0, 7); ctx.ellipse(8, -0.5, 2.6, 3.3, 0, 0, 7); ctx.fill(); ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#10131c'; ctx.beginPath(); ctx.arc(3.8, 0, 1.6, 0, 7); ctx.arc(8.7, 0, 1.5, 0, 7); ctx.fill();
  ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(6.2, 4.2, 2.3, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.restore();
  if (e.isKeeper) { rr(-14.5, -20, 6.5, 6.5, 3, '#ffeb3b'); rr(8, -20, 6.5, 6.5, 3, '#ffeb3b'); }
  ctx.restore();
  if (!e.isKeeper || true) {
    const nm = shortName(e.pd).toUpperCase(), fs = Math.max(9, 10.5 * sc);
    ctx.font = `800 ${fs}px "Segoe UI", Arial, sans-serif`; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(5,10,20,0.9)';
    const ny = P.y + 12 * sc + (e.slideT > 0 ? 6 : 0); ctx.strokeText(nm, P.x, ny); ctx.fillStyle = mark ? mark.c : '#ffffff'; ctx.fillText(nm, P.x, ny);
  }
  if (mark) {
    const bob = Math.sin(m.clock * 8) * 2;
    ctx.save(); ctx.translate(P.x, P.y - zz - 74 * k / 1.34 * 1.15 + bob); ctx.fillStyle = mark.c; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.lineTo(0, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeText(mark.l, 0, -4); ctx.fillText(mark.l, 0, -4); ctx.restore();
    if (e.stamina !== undefined && e.stamina < 0.98 && !e.isKeeper) {
      ctx.strokeStyle = e.exhausted ? '#ef476f' : '#19e3ff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(P.x, P.y, 18 * k / 1.34, 6.5 * k / 1.34, 0, 0, Math.PI * 2 * e.stamina); ctx.stroke();
    }
  }
}

let BALLSPR = null;
function ballSprite() {
  if (BALLSPR) return BALLSPR;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), cx = 64, cy = 64, R = 58;
  const gr = g.createRadialGradient(cx - 18, cy - 22, 6, cx, cy, R); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.65, '#f1f4f9'); gr.addColorStop(1, '#aeb7c6');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
  g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
  const pent = (x, y, r, rot) => { g.beginPath(); for (let i = 0; i < 5; i++) { const a = rot + i * 1.2566; i ? g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); g.fill(); };
  g.fillStyle = '#141824'; g.strokeStyle = '#2a3142'; g.lineWidth = 2.5;
  pent(cx, cy, 19, -1.5708);
  for (let i = 0; i < 5; i++) {
    const a = -1.5708 + i * 1.2566, vx = cx + Math.cos(a) * 19, vy = cy + Math.sin(a) * 19, ox = cx + Math.cos(a) * 52, oy = cy + Math.sin(a) * 52;
    g.beginPath(); g.moveTo(vx, vy); g.lineTo(cx + Math.cos(a) * 36, cy + Math.sin(a) * 36); g.stroke();
    pent(ox, oy, 17, a + 3.1416);
    const a2 = a + 0.6283; g.beginPath(); g.moveTo(cx + Math.cos(a2) * 36, cy + Math.sin(a2) * 36); g.lineTo(cx + Math.cos(a2) * 62, cy + Math.sin(a2) * 62); g.stroke();
  }
  g.restore();
  g.strokeStyle = '#10131c'; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
  return BALLSPR = c;
}
function drawBall(m) {
  const b = m.ball, P = proj(b.x, b.y, b.z), G = proj(b.x, b.y, 0), k = P.sc, r = 8.5 * k, spd = Math.hypot(b.vx, b.vy);
  ctx.fillStyle = 'rgba(0,0,0,0.34)'; ctx.beginPath(); ctx.ellipse(G.x, G.y, Math.max(3, r * (1 - Math.min(b.z, 80) / 220)), r * 0.4, 0, 0, 7); ctx.fill();
  if (spd > 190 && !b.owner) {   // motion trail
    const n = Math.min(5, Math.floor(spd / 110)), ux = b.vx / spd, uy = b.vy / spd;
    for (let i = n; i >= 1; i--) { ctx.globalAlpha = 0.07 * (n - i + 1) + 0.04; ctx.fillStyle = b.fire ? '#ff9f1c' : '#dfe9ff'; ctx.beginPath(); ctx.arc(P.x - ux * i * 6 * k, P.y - uy * i * 6 * k * 0.7, r * (1 - i * 0.08), 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  if (b.fire) { const gr = ctx.createRadialGradient(P.x, P.y, r * 0.5, P.x, P.y, r * 3.2); gr.addColorStop(0, 'rgba(255,170,0,0.75)'); gr.addColorStop(1, 'rgba(255,80,0,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(P.x, P.y, r * 3.2, 0, 7); ctx.fill(); }
  ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(b.spin); ctx.drawImage(ballSprite(), -r, -r, r * 2, r * 2); ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(P.x - r * 0.32, P.y - r * 0.4, r * 0.28, r * 0.17, -0.5, 0, 7); ctx.fill();
}

function predictPath(p) {
  const atk = p.team === 0 ? 1 : -1, ang = goalAngle(p) + p.aimAng * atk, st = p.st;
  const speed = (210 + st.shot * 3.2) * powerFactor(0.83);
  const turn = -Math.sign(p.aimAng) * Math.min(Math.abs(p.aimAng), 0.5) * (st.shot / 99) * 1.2;
  let x = p.x + Math.cos(ang) * 11, y = p.y, z = 3, vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed * DEPTH_K, vz = speed * 0.16; const pts = [];
  for (let i = 0; i < 15; i++) {
    for (let s = 0; s < 4; s++) { const dt = 0.0175, a = i * 0.07 < 0.9 ? turn * dt : 0, c = Math.cos(a), sn = Math.sin(a), nx = vx * c - vy * sn, ny = vx * sn + vy * c; vx = nx; vy = ny; vz -= 520 * dt; x += vx * dt; y += vy * dt; z = Math.max(0, z + vz * dt); if (z === 0 && vz < 0) vz = -vz * 0.55; }
    pts.push([x, y, z]);
  }
  return pts;
}
// Subtle laser aim arrow + curved power bar hugging the player's feet
function drawShotUI(m, p) {
  const pts = predictPath(p);
  pts.forEach((q, i) => { const s = proj(clamp(q[0], -20, PW + 20), clamp(q[1], 0, PD), q[2]); ctx.fillStyle = `rgba(${255 - i * 10},${240 - i * 4},255,${0.85 - i * 0.05})`; ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(1.2, 3 - i * 0.12), 0, 7); ctx.fill(); });
  const P = proj(p.x, p.y, 0), R = 25 * P.sc, c0 = Math.PI * 0.12, span = Math.PI * 0.76, cx = P.x, cy = P.y - 2;
  const seg = [[0, 0.55, '#35e08a'], [0.55, 0.78, '#ffd23f'], [0.78, 0.88, '#ffb703'], [0.88, 1, '#ef476f']];
  ctx.lineCap = 'round';
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.5, 0, c0 - 0.04, c0 + span + 0.04); ctx.stroke();
  const prog = clamp(p.charge, 0, 1);
  for (const s of seg) {
    ctx.lineWidth = 4.5; ctx.globalAlpha = 0.28; ctx.strokeStyle = s[2]; ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.5, 0, c0 + span * s[0], c0 + span * s[1]); ctx.stroke();
    if (prog > s[0]) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.5, 0, c0 + span * s[0], c0 + span * Math.min(prog, s[1])); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
  const ma = c0 + span * prog, mx = cx + Math.cos(ma) * R, my = cy + Math.sin(ma) * R * 0.5;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(mx, my, 3.4, 0, 7); ctx.fill(); ctx.stroke();
  if (p.charge >= 0.78 && p.charge <= 0.88) { ctx.fillStyle = '#ffb703'; ctx.font = 'bold 11px Trebuchet MS'; ctx.textAlign = 'center'; ctx.fillText('SWEET!', cx, cy + R * 0.5 + 14); }
  ctx.lineCap = 'butt';
}

function render(m) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (m && m.shake > 0.2) ctx.translate(rnd(-m.shake, m.shake), rnd(-m.shake, m.shake));
  drawPitch();
  drawGoal(m, 0); drawGoal(m, 1);
  if (m) {
    const ents = m.players.concat(m.keepers, [m.ball]).sort((a, b) => a.y - b.y);
    const marks = new Map();
    m.humans.forEach(h => { const p = m.tm[h.team].players[h.ctrl]; if (p) marks.set(p, { c: h.color, l: h.label }); });
    for (const e of ents) {
      if (e === m.ball) { drawBall(m); continue; }
      const sx = proj(e.x, e.y, 0).x; if (sx < -50 || sx > W + 50) continue;
      drawChibi(m, e, marks.get(e));
    }
    marks.forEach((mk, p) => { if (p.charging && p.charge > 0.01) drawShotUI(m, p); });
    for (const q of m.parts) { const P = proj(q.x, q.y, q.z); ctx.globalAlpha = clamp(q.life / q.max, 0, 1); ctx.fillStyle = q.c; ctx.fillRect(P.x, P.y, q.s, q.s); }
    ctx.globalAlpha = 1; ctx.textAlign = 'center';
    for (const q of m.popups) { const P = proj(clamp(q.x, 30, PW - 30), q.y, 40 + (1.2 - q.t) * 40); ctx.globalAlpha = clamp(q.t * 2, 0, 1); ctx.font = 'bold 20px Trebuchet MS'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(q.text, P.x, P.y); ctx.fillStyle = '#ffd23f'; ctx.fillText(q.text, P.x, P.y); }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/* ---------- HUD ---------- */
let hudCache = '';
function updateHud(m) {
  const s = m.cfg.sides, n0 = s[0].label || (TEAMS[s[0].team] || {}).name || 'HOME', n1 = s[1].label || (TEAMS[s[1].team] || {}).name || 'AWAY';
  const tm = m.golden ? 'GOLDEN GOAL' : (Math.floor(m.time / 60) + ':' + String(Math.floor(m.time % 60)).padStart(2, '0') + (m.half === 1 ? ' 1H' : ' 2H'));
  const key = n0 + n1 + m.score + tm; if (key === hudCache) return; hudCache = key;
  $('#hudHome').textContent = n0.toUpperCase(); $('#hudAway').textContent = n1.toUpperCase();
  const k0 = kitFor(s[0].team, null), k1 = kitFor(s[1].team, k0); $('#hudHome').style.borderBottomColor = k0.c1; $('#hudAway').style.borderBottomColor = k1.c1;
  $('#hudScore').textContent = m.score[0] + ' - ' + m.score[1]; $('#hudTime').textContent = tm;
}

/* ============================== MATCH RUNNER =========================== */
let cur = null, rafId = 0, lastT = 0, acc = 0, paused = false, guestSend = 0, guestEv = {};

function startMatch(cfg) {
  Snd.init(); cur = createMatch(cfg); paused = false; acc = 0; lastT = performance.now(); hudCache = '';
  uiEl.innerHTML = ''; $('#hud').classList.remove('hidden'); $('#banner').classList.remove('show');
  const L = $('#loader'); if (L) L.classList.add('hidden');
  if (cfg.net && cfg.net.role === 'guest') cur.guestCtl = mkCtl('keys', 'solo');
  if (!rafId) rafId = requestAnimationFrame(frame);
}
function stopMatch() { cur = null; $('#hud').classList.add('hidden'); $('#banner').classList.remove('show'); const L = $('#loader'); if (L) L.classList.remove('hidden'); }

function frame(t) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  const m = cur;
  if (!m) { pixelFrame(t); return; }
  if (!paused) {
    if (m.net && m.net.role === 'guest') {
      guestSmooth(m, dt);
      const ctl = m.guestCtl, h = pollCtl(ctl), e = ctl.edge;
      if (e.shootP) guestEv.sp = 1; if (e.shootR) guestEv.sr = 1; if (e.jumpP) guestEv.jp = 1; if (e.swP) guestEv.sw = 1;
      guestSend += dt;
      if (guestSend > 1 / 30) { guestSend = 0; Net.send({ t: 'in', h, ev: guestEv }); guestEv = {}; }
    } else {
      acc += dt * GAME_SPEED;
      while (acc >= STEP) { stepMatch(m, STEP); acc -= STEP; }
      if (m.net && m.net.role === 'host') { m.snapN++; if (m.snapN % (Net.guestIds().length > 3 ? 3 : 2) === 0) Net.broadcast(makeSnap(m)); }
    }
    updateHud(m);
    if (m.ended && !(m.net && m.net.role === 'guest')) {
      const res = matchResult(m), cfg = m.cfg;
      if (m.net) Net.broadcast({ t: 'end', res });
      stopMatch(); if (cfg.onEnd) cfg.onEnd(res);
    }
  }
  render(cur);
}

function togglePause() {
  if (!cur) return; paused = !paused;
  if (paused) go(`<h2>Paused</h2><div class="menu"><button class="btn big" data-act="resume">Resume</button><button class="btn big dim" data-act="quit">Quit Match</button></div>`, { resume: togglePause, quit: () => { const c = cur.cfg; paused = false; stopMatch(); (c.onQuit || showMain)(); } });
  else uiEl.innerHTML = '';
}

/* ==========================================================================
   PART 2 - loading screen, home menu, modes
   ========================================================================== */
TEAMS.BROS = { id: 'BROS', name: 'Bros FC', c1: '#ffd23f', c2: '#c1121f', style: 'stripes', kind: 'club', str: 70 };
TEAMS.LOC = { id: 'LOC', name: 'Sunday Lads', c1: '#ff9f1c', c2: '#222222', style: 'hoops', kind: 'club', str: 62 };
TEAMS.UTME = { id: 'UTME', name: 'FC Bros UT', c1: '#7b2cbf', c2: '#ffd23f', style: 'sash', kind: 'club' };

let screenHandlers = {};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function go(html, handlers) {
  uiEl.innerHTML = `<div class="screen">${html}</div>`;
  screenHandlers = handlers || {};
  uiEl.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => { Snd.init(); Snd.blip(); const h = screenHandlers[el.dataset.act]; if (h) h(el.dataset.v, el); }));
  uiEl.querySelectorAll('[data-chg]').forEach(el => el.addEventListener('change', () => { const h = screenHandlers[el.dataset.chg]; if (h) h(el.value, el); }));
}
function clearFillers(team) { Object.keys(PLAYERS).forEach(k => { if (k.startsWith('gf_' + team + '_')) delete PLAYERS[k]; }); }
const teamName = id => (TEAMS[id] || {}).name || id;

/* ---------- card + stat helpers ---------- */
const STAT_LBL = [['pace', 'PAC'], ['shot', 'SHO'], ['pass', 'PAS'], ['def', 'DEF'], ['jump', 'JMP']];
function statBars(p) { if (!p) return ''; return STAT_LBL.map(([k, l]) => `<div><span style="width:34px">${l}</span><span class="bar"><i style="width:${p.stats[k]}%"></i></span><b>${p.stats[k]}</b></div>`).join(''); }
function shortName(p) { const n = p.name.replace(' (Prime)', ''); return n.length <= 13 ? n : n.split(' ').pop(); }
const FACES = {};
function shade(hex, f) { const c = hexRGB(hex); return `rgb(${Math.round(c[0] * f)},${Math.round(c[1] * f)},${Math.round(c[2] * f)})`; }
function faceURL(p) {
  const key = p.id + '|' + p.skinTone + p.hairStyle + p.hairColor + p.beard; if (FACES[key]) return FACES[key];
  const c = document.createElement('canvas'); c.width = c.height = 20; const g = c.getContext('2d');
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const skin = p.skinTone, sk2 = shade(skin, 0.82), sk3 = shade(skin, 0.68), hc = p.hairColor, hd = shade(hc, 0.72), hl = shade(hc, 1.35);
  const T = TEAMS[p.club] && p.club !== 'OTH' && p.club !== 'ICN' ? TEAMS[p.club] : (TEAMS[p.nation] || TEAMS.OTH), shirt = T.c1, trim = T.c2;
  const beard = p.beard !== undefined ? p.beard : hashStr(p.name) % 5 === 0;
  // shoulders + neck
  R(2, 16, 16, 4, shirt); R(1, 18, 18, 2, shirt); R(8, 16, 4, 1, trim); R(8, 15, 4, 1, sk2); R(9, 14, 2, 2, sk2);
  // back hair for long / afro
  if (p.hairStyle === 'afro') { R(2, 2, 16, 8, hc); R(3, 1, 14, 1, hc); R(1, 5, 1, 4, hc); R(18, 5, 1, 4, hc); }
  if (p.hairStyle === 'long') { R(3, 4, 14, 11, hc); R(3, 12, 2, 4, hd); R(15, 12, 2, 4, hd); }
  // head
  R(5, 4, 10, 11, skin); R(6, 3, 8, 1, skin); R(6, 15, 8, 1, skin); R(14, 5, 1, 10, sk2); R(5, 9, 1, 3, sk2); R(4, 8, 1, 4, skin); R(15, 8, 1, 4, sk2);
  // hair on top
  switch (p.hairStyle) {
    case 'short': R(5, 2, 10, 3, hc); R(4, 4, 1, 4, hc); R(15, 4, 1, 4, hc); R(6, 5, 3, 1, hc); R(11, 5, 3, 1, hc); R(6, 1, 8, 1, hd); break;
    case 'buzz': R(5, 3, 10, 2, hd); R(4, 5, 1, 3, hd); R(15, 5, 1, 3, hd); R(6, 2, 8, 1, hd); break;
    case 'curly': R(4, 1, 12, 4, hc); R(3, 3, 2, 5, hc); R(15, 3, 2, 5, hc); R(5, 0, 3, 1, hc); R(9, 0, 3, 1, hc); R(13, 1, 2, 1, hc); R(6, 5, 2, 1, hc); R(12, 5, 2, 1, hc); R(7, 2, 1, 1, hl); R(12, 2, 1, 1, hl); break;
    case 'long': R(4, 2, 12, 3, hc); R(5, 5, 4, 1, hc); R(11, 5, 4, 1, hc); R(7, 2, 3, 1, hl); break;
    case 'afro': R(4, 3, 12, 3, hc); R(5, 6, 3, 1, hc); R(12, 6, 3, 1, hc); break;
    case 'slick': R(5, 2, 10, 3, hc); R(4, 4, 1, 4, hc); R(15, 4, 1, 4, hc); R(6, 3, 7, 1, hl); R(5, 5, 2, 1, hd); break;
    case 'mohawk': R(9, 0, 3, 5, hc); R(8, 4, 5, 1, hc); R(5, 4, 1, 2, hd); R(14, 4, 1, 2, hd); R(10, 0, 1, 2, hl); break;
    case 'bald': R(7, 3, 3, 1, shade(skin, 1.12)); break;
  }
  // face
  R(6, 8, 3, 1, hd); R(11, 8, 3, 1, hd);                    // brows
  R(6, 9, 3, 2, '#ffffff'); R(11, 9, 3, 2, '#ffffff');       // eyes
  R(7, 9, 2, 2, '#15171f'); R(12, 9, 2, 2, '#15171f'); R(8, 9, 1, 1, '#ffffff'); R(13, 9, 1, 1, '#ffffff');
  R(9, 11, 2, 2, sk3);                                       // nose
  if (beard) { R(5, 11, 1, 4, hc); R(14, 11, 1, 4, hc); R(6, 13, 8, 3, hc); R(7, 12, 6, 1, hd); R(8, 14, 4, 1, '#7a3a34'); R(5, 15, 10, 1, hd); }
  else R(8, 14, 4, 1, '#9b4a42');
  R(4, 9, 1, 2, sk2); R(15, 9, 1, 2, sk3);                   // ears
  return FACES[key] = c.toDataURL();
}
function cardHTML(p, o) {
  o = o || {}; const tier = p.tier === 'Prime Icon' ? 'PrimeIcon' : p.tier, cl = TEAMS[p.club] || {}, flag = (TEAMS[p.nation] || {}).flag || '🏳️';
  return `<div class="card ${tier} ${o.sel ? 'sel' : ''}" ${o.act ? `data-act="${o.act}" data-v="${p.id}"` : ''}>
    <div class="ovr">${p.ovr}</div><div class="pos">${p.pos}</div><div class="flag">${flag}</div>
    <img class="face" src="${faceURL(p)}" alt="">
    <div class="nm">${esc(shortName(p))}</div><div class="club">${esc(cl.name || '')}</div>
    <div class="st">${STAT_LBL.map(([k, l]) => `<span>${l} <b>${p.stats[k]}</b></span>`).join('')}</div>
    <div class="tag">${p.tier === 'Prime Icon' ? 'PRIME ICON' : p.tier.toUpperCase()}</div></div>`;
}
function teamOptions(sel) {
  let h = `<optgroup label="Special"><option value="ICONS" ${sel === 'ICONS' ? 'selected' : ''}>⭐ Classic Icons XI</option></optgroup>`;
  LEAGUES.forEach(l => { h += `<optgroup label="${l}">` + CLUBS.filter(c => c.league === l).map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.name}</option>`).join('') + '</optgroup>'; });
  h += `<optgroup label="National Teams">` + NATIONS.map(n => `<option value="${n.id}" ${n.id === sel ? 'selected' : ''}>${n.flag} ${n.name}</option>`).join('') + '</optgroup>';
  return h;
}
function nationOptions(sel) { return NATIONS.map(n => `<option value="${n.id}" ${n.id === sel ? 'selected' : ''}>${n.flag} ${n.name}</option>`).join(''); }
function playerOptions(team, sel) { return squadFor(team).slice(0, 45).map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} · ${p.pos} ${p.ovr}</option>`).join(''); }
function resultScreen(title, res, n0, n1, btns, extra) {
  const w = res.winner, hnd = {};
  btns.forEach(b => hnd[b.act] = b.fn);
  go(`<h2>${title}</h2><div class="codebox" style="font-size:38px;letter-spacing:2px">${esc(n0)} ${res.h} - ${res.a} ${esc(n1)}</div><p class="sub">${w < 0 ? 'Draw!' : (w === 0 ? n0 : n1) + ' win' + (res.pens ? ' on penalties' : '') + '!'}</p>${extra || ''}<div class="menu">${btns.map(b => `<button class="btn ${b.cls || ''}" data-act="${b.act}">${b.t}</button>`).join('')}</div>`, hnd);
}

/* ============================== FUTURISTIC LOADING SCREEN ============= */
const lc = $('#lc'), lg = lc.getContext('2d'); lc.width = 960; lc.height = 540;
const FPART = Array.from({ length: 70 }, () => ({ x: Math.random() * 960, y: Math.random() * 540, v: 8 + Math.random() * 26, r: 0.6 + Math.random() * 1.8, a: 0.2 + Math.random() * 0.6, c: Math.random() < 0.7 ? '120,220,255' : '170,130,255' }));
function futureScene(t) {
  const g = lg, W = 960, H = 540, ts = t / 1000;
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#03050c'); bg.addColorStop(0.5, '#08102a'); bg.addColorStop(1, '#06182b'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  let rg = g.createRadialGradient(760, 130, 0, 760, 130, 420); rg.addColorStop(0, 'rgba(70,110,255,0.30)'); rg.addColorStop(1, 'rgba(70,110,255,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H);
  rg = g.createRadialGradient(140, 430, 0, 140, 430, 380); rg.addColorStop(0, 'rgba(0,229,255,0.20)'); rg.addColorStop(1, 'rgba(0,229,255,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H);
  // stadium light beams
  g.globalCompositeOperation = 'lighter';
  [[130, 0.8], [480, 1.7], [830, 2.6]].forEach(([x, ph], i) => {
    const a = 0.05 + 0.025 * Math.sin(ts * 0.8 + ph), gr = g.createLinearGradient(x, 0, x, H); gr.addColorStop(0, `rgba(150,200,255,${a * 2})`); gr.addColorStop(1, 'rgba(150,200,255,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(x - 6, -10); g.lineTo(x + 6, -10); g.lineTo(x + 200 * (i - 1) + 130, H); g.lineTo(x + 200 * (i - 1) - 130, H); g.closePath(); g.fill();
  });
  // perspective pitch
  const Y0 = 215, DY = 330, hw = v => 150 + v * 640, X = (u, v) => 480 + u * hw(v), Yv = v => Y0 + v * DY;
  g.globalCompositeOperation = 'source-over';
  const fl = g.createLinearGradient(0, Y0, 0, Y0 + DY); fl.addColorStop(0, 'rgba(0,70,110,0.05)'); fl.addColorStop(1, 'rgba(0,120,170,0.28)');
  g.fillStyle = fl; g.beginPath(); g.moveTo(X(-1, 0), Yv(0)); g.lineTo(X(1, 0), Yv(0)); g.lineTo(X(1, 1), Yv(1)); g.lineTo(X(-1, 1), Yv(1)); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,229,255,0.07)'; g.lineWidth = 1;
  for (let i = 1; i < 12; i++) { const v = i / 12; g.beginPath(); g.moveTo(X(-1, v), Yv(v)); g.lineTo(X(1, v), Yv(v)); g.stroke(); }
  for (let i = -5; i <= 5; i++) { g.beginPath(); g.moveTo(X(i / 5, 0), Yv(0)); g.lineTo(X(i / 5, 1), Yv(1)); g.stroke(); }
  g.shadowColor = '#19e3ff'; g.shadowBlur = 14; g.strokeStyle = 'rgba(80,235,255,0.85)'; g.lineWidth = 2;
  const poly = pts => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p[0], p[1]), Yv(p[1])) : g.moveTo(X(p[0], p[1]), Yv(p[1]))); g.stroke(); };
  poly([[-1, 0], [1, 0], [1, 1], [-1, 1], [-1, 0]]); poly([[-1, 0.5], [1, 0.5]]);
  poly([[-0.5, 0], [-0.5, 0.16], [0.5, 0.16], [0.5, 0]]); poly([[-0.5, 1], [-0.5, 0.84], [0.5, 0.84], [0.5, 1]]);
  poly([[-0.22, 0], [-0.22, 0.06], [0.22, 0.06], [0.22, 0]]); poly([[-0.22, 1], [-0.22, 0.94], [0.22, 0.94], [0.22, 1]]);
  const ring = []; for (let a = 0; a <= 6.4; a += 0.2) ring.push([0.24 * Math.cos(a), 0.5 + 0.13 * Math.sin(a)]); poly(ring);
  g.shadowBlur = 0;
  // sweeping scan line
  const sv = (ts / 2.6) % 1, sg = g.createLinearGradient(0, Yv(sv) - 18, 0, Yv(sv) + 4); sg.addColorStop(0, 'rgba(25,227,255,0)'); sg.addColorStop(1, 'rgba(25,227,255,0.35)');
  g.fillStyle = sg; g.beginPath(); g.moveTo(X(-1, sv), Yv(sv) - 18); g.lineTo(X(1, sv), Yv(sv) - 18); g.lineTo(X(1, sv), Yv(sv) + 4); g.lineTo(X(-1, sv), Yv(sv) + 4); g.closePath(); g.fill();
  // drifting particles
  g.globalCompositeOperation = 'lighter';
  FPART.forEach(p => { p.y -= p.v * 0.016; if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; } g.fillStyle = `rgba(${p.c},${p.a * (0.6 + 0.4 * Math.sin(ts * 2 + p.x))})`; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); });
  // glowing ball hovering over the centre spot
  const bx = X(0, 0.5), by = Yv(0.5) - 34 - Math.sin(ts * 2) * 8;
  const bgl = g.createRadialGradient(bx, by, 2, bx, by, 60); bgl.addColorStop(0, 'rgba(255,255,255,0.9)'); bgl.addColorStop(0.25, 'rgba(120,230,255,0.45)'); bgl.addColorStop(1, 'rgba(120,230,255,0)');
  g.fillStyle = bgl; g.beginPath(); g.arc(bx, by, 60, 0, 7); g.fill();
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#f4fbff'; g.beginPath(); g.arc(bx, by, 11, 0, 7); g.fill(); g.fillStyle = '#10243a'; for (let i = 0; i < 3; i++) { const a = ts * 1.2 + i * 2.09; g.beginPath(); g.arc(bx + Math.cos(a) * 5.5, by + Math.sin(a) * 5.5, 3, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(25,227,255,0.25)'; g.beginPath(); g.ellipse(bx, Yv(0.5) + 4, 18 - Math.sin(ts * 2) * 3, 4, 0, 0, 7); g.fill();
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.7)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
}
const NAV = [
  { k: 'quick', t: 'Kick Off', big: 'KICK OFF', sub: 'Quick Match · pick your stars' },
  { k: 'online', t: 'Online Lobby', big: 'ONLINE', sub: 'Up to 8 players · Lobby Code' },
  { k: 'ut', t: 'Ultimate Team', big: 'ULTIMATE TEAM', sub: 'Packs · Chemistry · Glory' },
  { k: 'wc', t: 'World Cup', big: 'WORLD CUP', sub: '48 nations · one trophy' },
  { k: 'story', t: 'Road To Glory', big: 'ROAD TO GLORY', sub: 'Create your Bro · 6 chapters' },
  { k: 'how', t: 'Learn To Play', big: 'LEARN TO PLAY', sub: 'Controls & tips' },
];
let phase = 'loading', phT0 = performance.now(), navSel = 0, homeKey = '';
function setHome(html, key) { if (homeKey !== key) { homeKey = key; $('#home').innerHTML = html; } }
const TITLE = `<div class="ftitle"><span class="fc">FC</span>SOCCER BROS</div><div class="fsub">ULTIMATE EDITION <b>27</b></div>`;
function pixelFrame(t) {
  futureScene(t);
  const home = $('#home'); home.classList.remove('hidden');
  const open = uiEl.innerHTML !== '';
  if (phase === 'loading') {
    const p = Math.min(1, (t - phT0) / 2800);
    setHome(`<div class="center">${TITLE}<div id="lbar"><i></i></div><div id="ltxt">INITIALISING <span id="lpct">0</span>%</div></div>`, 'load');
    const b = $('#lbar i'); if (b) b.style.width = (p * 100) + '%'; const pc = $('#lpct'); if (pc) pc.textContent = Math.round(p * 100);
    if (p >= 1) phase = 'press';
  } else if (phase === 'press') {
    setHome(`<div class="center">${TITLE}<div id="ltxt" class="ready">PRESS ANY KEY OR CLICK TO START</div></div>`, 'press');
    const l = $('#ltxt'); if (l) l.style.opacity = 0.55 + 0.45 * Math.sin(t / 380);
  } else if (open) {
    setHome('', 'title');
  } else {
    const n = NAV[navSel];
    setHome(`<div class="brand"><span class="fc">FC</span>SOCCER BROS <small>27</small></div>
      <div class="nav">${NAV.map((x, i) => `<div class="navitem ${i === navSel ? 'sel' : ''}" data-i="${i}"><i>${String(i + 1).padStart(2, '0')}</i>${x.t}</div>`).join('')}</div>
      <div class="modeinfo"><div class="modesub">${n.sub}</div><div class="modebig">${n.big}</div></div><div class="hint"><b>↑ ↓</b> navigate &nbsp; <b>ENTER</b> select</div>`, 'home' + navSel);
  }
}
$('#home').addEventListener('click', e => { const it = e.target.closest('.navitem'); if (it && phase === 'home') { navSel = +it.dataset.i; Snd.init(); openNav(navSel); } });
$('#home').addEventListener('mouseover', e => { const it = e.target.closest('.navitem'); if (it && +it.dataset.i !== navSel) navSel = +it.dataset.i; });
$('#lstage').addEventListener('pointerdown', () => { if (phase === 'press') { phase = 'home'; Snd.init(); Snd.coin(); } });
addEventListener('keydown', e => {
  if (cur || typing()) return;
  if (phase === 'press') { phase = 'home'; Snd.init(); Snd.coin(); return; }
  if (phase === 'home' && uiEl.innerHTML === '') {
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { navSel = (navSel + 1) % NAV.length; Snd.blip(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { navSel = (navSel + NAV.length - 1) % NAV.length; Snd.blip(); }
    else if (e.code === 'Enter' || e.code === 'Space') openNav(navSel);
  }
});
function showMain() { uiEl.innerHTML = ''; homeKey = ''; if (phase === 'loading') return; phase = 'home'; }
function openNav(i) {
  const k = NAV[i].k;
  ({ quick: qmSetup, online: onlineMenu, ut: utScreen, wc: wcSetup, story: storyMenu, how: howTo })[k]();
}
function howTo() {
  go(`<h2>Learn To Play</h2>
  <h3>Move</h3><p><span class="kbd">Arrow Keys</span> (or <span class="kbd">WASD</span>) · hold <span class="kbd">Shift</span> to sprint</p>
  <h3>Space = everything</h3>
  <p><b>Tap Space</b> with the ball → <b>PASS</b>. Hold an arrow (↑ ↓ ← →) while you tap to pick the teammate in that direction. Blocked lane? It auto-lobs. 95+ PASS players curl <b>Trivela</b> passes.</p>
  <p><b>Hold Space</b> → charge a <b>SHOT</b>. The curved bar at your feet fills Green → Yellow → Gold. Release in the gold band for a blazing <b>Power Shot</b>. Hold <span class="kbd">↑</span>/<span class="kbd">↓</span> to aim the laser arrow.</p>
  <p><b>Space without the ball</b> → slide tackle. In the air → diving header / bicycle kick.</p>
  <h3>That's it</h3><p>Everything is on <span class="kbd">Space</span>. The game switches to your nearest player automatically. Tap Space near a high ball to jump for a header. <span class="kbd">Esc</span> pauses.</p>
  <h3>Local 2-Player</h3><p>P1: <span class="kbd">WASD</span> + <span class="kbd">Space</span> (sprint L-Shift) · P2: <span class="kbd">Arrows</span> + <span class="kbd">Enter</span> (sprint R-Shift)</p>
  <h3>Game facts</h3><p>11v11. Ultimate Team chemistry links join players who share a club or nation. Modrić + Rakitić = Croatia Hyper-Link (+5).</p>
  <div class="menu"><button class="btn big" data-act="back">Back</button></div>`, { back: showMain });
}

/* ============================== QUICK MATCH =========================== */
const QM = { mode: 'cpu', a: 'CRO', b: 'ARG', p1: 'modric_active', p2: '', lock: false, half: 120, lvl: 0.85 };
function qmSetup() {
  const sa = squadFor(QM.a), sb = squadFor(QM.b);
  if (!QM.p1 || !PLAYERS[QM.p1] || !sa.includes(PLAYERS[QM.p1])) QM.p1 = (sa[0] || {}).id || '';
  if (!QM.p2 || !PLAYERS[QM.p2] || !sb.includes(PLAYERS[QM.p2])) QM.p2 = (sb[0] || {}).id || '';
  const p1 = PLAYERS[QM.p1], p2 = PLAYERS[QM.p2], local = QM.mode === 'local';
  go(`<h2>Quick Match · 11 v 11</h2>
   <div class="row"><button class="btn ${!local ? '' : 'dim'}" data-act="mode" data-v="cpu">Vs CPU</button><button class="btn ${local ? '' : 'dim'}" data-act="mode" data-v="local">Local 2-Player</button></div>
   <div class="row"><div><label>Your team</label><br><select data-chg="ta">${teamOptions(QM.a)}</select></div><div><label>Opponent</label><br><select data-chg="tb">${teamOptions(QM.b)}</select></div></div>
   <div class="row"><div><label>${local ? 'P1' : 'Your'} player</label><br><select data-chg="pa">${playerOptions(QM.a, QM.p1)}</select></div>${local ? `<div><label>P2 player</label><br><select data-chg="pb">${playerOptions(QM.b, QM.p2)}</select></div>` : ''}</div>
   <div class="pinfo">${p1 ? cardHTML(p1) : ''}<div class="bars">${statBars(p1)}</div></div>
   ${local && p2 ? `<div class="pinfo">${cardHTML(p2)}<div class="bars">${statBars(p2)}</div></div>` : ''}
   <div class="row"><div><label>Half length</label> <select data-chg="half">${[60, 120, 180].map(v => `<option value="${v}" ${QM.half === v ? 'selected' : ''}>${v / 60} min</option>`).join('')}</select></div>
   ${local ? '' : `<div><label>CPU level</label> <select data-chg="lvl">${[[0.6, 'Easy'], [0.85, 'Normal'], [1, 'Hard']].map(a => `<option value="${a[0]}" ${QM.lvl === a[0] ? 'selected' : ''}>${a[1]}</option>`).join('')}</select></div>`}
   <div><label><input type="checkbox" data-chg="lock" ${QM.lock ? 'checked' : ''}> Lock me to my chosen player</label></div></div>
   <p class="small" style="text-align:center">The other 10 on each side are AI, placed by position. Tap <span class="kbd">Space</span> = pass · hold = shoot. See Learn To Play.</p>
   <div class="menu"><button class="btn big" data-act="start">Kick Off!</button><button class="btn dim" data-act="back">Back</button></div>`, {
    mode: v => { QM.mode = v; qmSetup(); }, ta: v => { QM.a = v; QM.p1 = ''; qmSetup(); }, tb: v => { QM.b = v; QM.p2 = ''; qmSetup(); },
    pa: v => { QM.p1 = v; qmSetup(); }, pb: v => { QM.p2 = v; qmSetup(); }, half: v => { QM.half = +v; }, lvl: v => { QM.lvl = +v; }, lock: (v, el) => { QM.lock = el.checked; },
    start: qmStart, back: showMain });
}
function qmStart() {
  const local = QM.mode === 'local', a = QM.a, b = QM.b;
  const pk0 = QM.p1 ? [PLAYERS[QM.p1]] : [], pk1 = local && QM.p2 ? [PLAYERS[QM.p2]] : [];
  const s0 = buildSide(a, pk0, pk1.map(p => p.id)), s1 = buildSide(b, pk1, s0.slots.map(p => p.id));
  const ix = (s, pd) => { const i = pd ? s.pickIdx[pd.id] : undefined; return i > 0 ? i - 1 : null; };
  const h = [{ ctl: mkCtl('keys', local ? 'p1' : 'solo'), team: 0, lock: QM.lock ? ix(s0, pk0[0]) : null, start: ix(s0, pk0[0]), name: local ? 'P1' : 'YOU' }];
  if (local) h.push({ ctl: mkCtl('keys', 'p2'), team: 1, lock: QM.lock ? ix(s1, pk1[0]) : null, start: ix(s1, pk1[0]), name: 'P2' });
  startMatch({ sides: [{ team: a, slots: s0.slots }, { team: b, slots: s1.slots }], humans: h, lvls: [0.85, local ? 0.85 : QM.lvl], halfLen: QM.half, golden: false, onQuit: qmSetup,
    onEnd: res => resultScreen('Full Time', res, teamName(a), teamName(b), [{ t: 'Rematch', act: 'again', fn: qmStart }, { t: 'Setup', act: 'setup', fn: qmSetup, cls: 'alt' }, { t: 'Main Menu', act: 'menu', fn: showMain, cls: 'dim' }]) });
}

/* ============================== WORLD CUP ============================= */
let WC = null, WCSEL = 'CRO';
const WC_ROUNDS = ['Round of 32', 'Round of 16', 'Quarter-finals', 'Semi-finals', 'Final'];
const PAIRS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
const strCache = {};
const nstr = id => strCache[id] || (strCache[id] = sideStrength(buildSide(id, [], [])));
function pois(l) { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; }
function simMatch(a, b, ko) {
  const d = nstr(a) - nstr(b), ga = pois(clamp(1.3 * Math.exp(d / 20), 0.25, 5)), gb = pois(clamp(1.3 * Math.exp(-d / 20), 0.25, 5));
  let w = ga > gb ? a : gb > ga ? b : null, pens = false;
  if (ko && !w) { pens = true; w = Math.random() < 0.5 + d / 80 ? a : b; }
  return { a, b, ga, gb, w, pens };
}
function wcSetup() {
  go(`<h2>World Cup</h2><p class="sub">48 teams · 12 groups of 4 · top 2 + 8 best 3rd place → 32-team knockout → Final</p>
    <div class="row"><select data-chg="wt">${nationOptions(WCSEL)}</select></div>
    <div class="menu"><button class="btn big" data-act="go">Start Tournament</button><button class="btn big dim" data-act="back">Back</button></div>`,
    { wt: v => { WCSEL = v; }, go: () => { wcNew(WCSEL); wcHome(); }, back: showMain });
}
function wcNew(team) {
  const all = shuffle([team].concat(shuffle(NATIONS.map(n => n.id).filter(i => i !== team)).slice(0, 47)));
  const groups = [], tab = {};
  for (let g = 0; g < 12; g++) { groups.push(all.slice(g * 4, g * 4 + 4)); }
  all.forEach(id => tab[id] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
  WC = { team, groups, tab, md: 0, stage: 'group', my: groups.findIndex(g => g.includes(team)), last: '', teams: [], round: 0, koLog: [] };
}
const cmpTab = (a, b) => { const x = WC.tab[a], y = WC.tab[b]; return (y.pts - x.pts) || ((y.gf - y.ga) - (x.gf - x.ga)) || (y.gf - x.gf) || (nstr(b) - nstr(a)); };
function wcRecord(r) {
  const A = WC.tab[r.a], B = WC.tab[r.b]; A.p++; B.p++; A.gf += r.ga; A.ga += r.gb; B.gf += r.gb; B.ga += r.ga;
  if (r.ga > r.gb) { A.w++; B.l++; A.pts += 3; } else if (r.gb > r.ga) { B.w++; A.l++; B.pts += 3; } else { A.d++; B.d++; A.pts++; B.pts++; }
}
const tn = id => `${TEAMS[id].flag} ${TEAMS[id].name}`;
function gtable(gi) {
  return `<table class="table"><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr>` + WC.groups[gi].slice().sort(cmpTab).map((id, i) => { const t = WC.tab[id]; return `<tr class="${id === WC.team ? 'me' : ''}"><td>${i + 1}</td><td>${tn(id)}</td><td>${t.p}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td><td>${t.gf - t.ga}</td><td>${t.pts}</td></tr>`; }).join('') + '</table>';
}
function wcOpp() { const g = WC.groups[WC.my], me = g.indexOf(WC.team), pr = PAIRS[WC.md].find(p => p.includes(me)); return g[pr[0] === me ? pr[1] : pr[0]]; }
function wcHome() {
  if (WC.stage === 'group') {
    const opp = wcOpp();
    go(`<h2>Group ${String.fromCharCode(65 + WC.my)} · Matchday ${WC.md + 1}/3</h2>${WC.last ? `<p class="small">${WC.last}</p>` : ''}${gtable(WC.my)}
      <p class="sub">Next: <b>${tn(WC.team)}</b> vs <b>${tn(opp)}</b></p>
      <div class="menu"><button class="btn big" data-act="play">Play Match</button><button class="btn alt" data-act="sim">Sim My Match</button><button class="btn dim" data-act="all">All Groups</button><button class="btn dim" data-act="quit">Main Menu</button></div>`,
      { play: () => wcPlay(false), sim: () => wcPlay(true), all: wcAllGroups, quit: showMain });
  } else wcKoHome();
}
function wcAllGroups() {
  go(`<h2>All Groups</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:6px">${WC.groups.map((g, i) => `<div><h3>Group ${String.fromCharCode(65 + i)}</h3>${gtable(i)}</div>`).join('')}</div><div class="menu"><button class="btn" data-act="back">Back</button></div>`, { back: wcHome });
}
function wcPlay(sim) {
  const opp = wcOpp();
  if (sim) { const r = simMatch(WC.team, opp, false); wcRecord(r); WC.last = `${tn(r.a)} ${r.ga}-${r.gb} ${tn(r.b)}`; wcFinishMd(); return; }
  const s0 = buildSide(WC.team, [], []), s1 = buildSide(opp, [], s0.slots.map(p => p.id));
  startMatch({ sides: [{ team: WC.team, slots: s0.slots }, { team: opp, slots: s1.slots }], humans: [{ ctl: mkCtl('keys', 'solo'), team: 0, lock: null, start: 8, name: 'YOU' }], lvls: [0.85, 0.85], halfLen: 90, golden: false, onQuit: wcHome,
    onEnd: res => { const r = { a: WC.team, b: opp, ga: res.h, gb: res.a }; wcRecord(r); WC.last = `${tn(r.a)} ${r.ga}-${r.gb} ${tn(r.b)}`; wcFinishMd(); } });
}
function wcFinishMd() {
  const me = WC.groups[WC.my].indexOf(WC.team), mine = PAIRS[WC.md].find(p => p.includes(me));
  WC.groups.forEach((g, gi) => PAIRS[WC.md].forEach(pr => { if (gi === WC.my && pr === mine) return; wcRecord(simMatch(g[pr[0]], g[pr[1]], false)); }));
  WC.md++;
  if (WC.md === 3) wcKoInit();
  wcHome();
}
function wcKoInit() {
  const top = [], thirds = [];
  WC.groups.forEach(g => { const s = g.slice().sort(cmpTab); top.push(s[0], s[1]); thirds.push(s[2]); });
  thirds.sort(cmpTab); const q = top.concat(thirds.slice(0, 8));
  WC.stage = 'ko'; WC.round = 0; WC.teams = shuffle(q); WC.koLog = [];
  WC.last = WC.teams.includes(WC.team) ? `${tn(WC.team)} advance to the Round of 32!` : `${tn(WC.team)} were knocked out in the group stage.`;
}
function wcRoundTable() {
  const l = WC.koLog[WC.koLog.length - 1]; if (!l) return '';
  return `<h3>${l.round} results</h3><table class="table">${l.log.map(r => `<tr class="${r.a === WC.team || r.b === WC.team ? 'me' : ''}"><td>${tn(r.a)}</td><td>${r.ga} - ${r.gb}${r.pens ? ' (pens)' : ''}</td><td>${tn(r.b)}</td></tr>`).join('')}</table>`;
}
function wcKoHome() {
  if (WC.teams.length === 1) return wcEnd();
  const rn = WC_ROUNDS[WC.round], idx = WC.teams.indexOf(WC.team), alive = idx >= 0;
  let body;
  if (alive) { const opp = WC.teams[idx ^ 1]; body = `<p class="sub">Your match: <b>${tn(WC.team)}</b> vs <b>${tn(opp)}</b></p><div class="menu"><button class="btn big" data-act="play">Play Match</button><button class="btn alt" data-act="sim">Sim My Match</button><button class="btn dim" data-act="quit">Main Menu</button></div>`; }
  else body = `<p class="sub">You are out. ${WC.teams.length} teams remain.</p><div class="menu"><button class="btn" data-act="simall">Sim Round</button><button class="btn alt" data-act="simend">Sim To The Final</button><button class="btn dim" data-act="quit">Main Menu</button></div>`;
  go(`<h2>${rn}</h2>${WC.last ? `<p class="small">${WC.last}</p>` : ''}${body}${wcRoundTable()}`,
    { play: wcKoPlay, sim: () => { wcKoRound(null); wcHome(); }, simall: () => { wcKoRound(null); wcHome(); }, simend: () => { while (WC.teams.length > 1) wcKoRound(null); wcHome(); }, quit: showMain });
}
function wcKoPlay() {
  const idx = WC.teams.indexOf(WC.team), opp = WC.teams[idx ^ 1];
  const s0 = buildSide(WC.team, [], []), s1 = buildSide(opp, [], s0.slots.map(p => p.id));
  startMatch({ sides: [{ team: WC.team, slots: s0.slots }, { team: opp, slots: s1.slots }], humans: [{ ctl: mkCtl('keys', 'solo'), team: 0, lock: null, start: 8, name: 'YOU' }], lvls: [0.85, 0.9], halfLen: 90, golden: true, onQuit: wcHome,
    onEnd: res => { wcKoRound({ a: WC.team, b: opp, ga: res.h, gb: res.a, w: res.winner === 1 ? opp : WC.team, pens: res.pens }); wcHome(); } });
}
function wcKoRound(ur) {
  const next = [], log = [], rn = WC_ROUNDS[WC.round];
  for (let i = 0; i < WC.teams.length; i += 2) {
    const a = WC.teams[i], b = WC.teams[i + 1]; let r;
    if (ur && (a === WC.team || b === WC.team)) { r = ur.a === a ? ur : { a, b, ga: ur.gb, gb: ur.ga, w: ur.w, pens: ur.pens }; } else r = simMatch(a, b, true);
    log.push(r); next.push(r.w);
  }
  WC.koLog.push({ round: rn, log }); WC.teams = next; WC.round++;
  const mine = log.find(r => r.a === WC.team || r.b === WC.team);
  if (mine) WC.last = mine.w === WC.team ? `You beat ${tn(mine.a === WC.team ? mine.b : mine.a)}!` : `You lost to ${tn(mine.a === WC.team ? mine.b : mine.a)}.`;
}
function wcEnd() {
  const champ = WC.teams[0], won = champ === WC.team;
  if (won) { Snd.chime(); Snd.roar(); }
  go(`<h1 class="logo">${won ? 'WORLD CHAMPIONS!' : 'TOURNAMENT OVER'}</h1>
    <div style="text-align:center;font-size:96px" class="walkin">🏆</div>
    <p class="sub" style="font-size:24px">${won ? `${tn(champ)} lift the trophy! 🎉🎉🎉` : `${tn(champ)} are the World Champions.`}</p>${wcRoundTable()}
    <div class="menu"><button class="btn big" data-act="again">New Tournament</button><button class="btn big dim" data-act="menu">Main Menu</button></div>`, { again: wcSetup, menu: showMain });
}

/* ============================== STORY MODE ============================ */
const CHAPTERS = [
  { t: 'Sunday League Debut', d: 'Win your first match for Sunday Lads’ rivals — Bros FC are underdogs.', opp: 'LOC', oppStr: 60, us: 'BROS', usStr: 66 },
  { t: 'Academy Showdown', d: 'Ajax’s academy stars want your spot.', opp: 'AJA', us: 'BROS', usStr: 70 },
  { t: 'Croatian Midfield Masterclass', d: 'Play beside Prime Luka Modrić (96) and Ivan Rakitić (88).', opp: 'ESP', us: 'CRO', extra: ['modric_prime', 'rakitic_icon'], exclude: ['modric_active'] },
  { t: 'Champions League Comeback', d: 'Down 0–2 to Bayern at half-time. Rewrite the script.', opp: 'BAY', us: 'BROS', usStr: 78, start: [0, 2] },
  { t: 'Semi-Final Nerves', d: 'Croatia vs France for a place in the Final.', opp: 'FRA', us: 'CRO', extra: ['modric_prime'], exclude: ['modric_active'], golden: true },
  { t: 'World Cup Final', d: 'Argentina. Messi. Everything on the line.', opp: 'ARG', us: 'CRO', extra: ['modric_prime', 'rakitic_icon'], exclude: ['modric_active'], golden: true },
];
let ST = null;
function storyLoad() { try { const s = JSON.parse(localStorage.getItem('fcb_story')); if (s && s.name) return s; } catch (e) {} return null; }
function storySave() { try { localStorage.setItem('fcb_story', JSON.stringify(ST)); } catch (e) {} }
function broPD() {
  return { id: 'bro', name: ST.name, ovr: ST.ovr, pos: ST.pos, nation: 'OTH', nationName: 'Rookie', club: 'OTH', tier: tierFor(ST.ovr), stats: deriveStats(ST.ovr, ST.pos, ST.name), skinTone: ST.skin, hairStyle: ST.hair, hairColor: ST.hairColor, generated: true };
}
let SC = { name: 'Bro', pos: 'CM', skin: SKINS[1], hair: 'short', hairColor: HAIR_COLORS[1] };
function storyMenu() {
  ST = storyLoad();
  if (!ST) return storyCreate();
  const bro = broPD();
  go(`<h2>Road To Glory</h2><div class="pinfo">${cardHTML(bro)}<div class="bars">${statBars(bro)}<p class="small">XP progress: chapters won upgrade your OVR (max 97).</p></div></div>
    ${CHAPTERS.map((c, i) => {
      const open = i <= ST.ch, done = ST.done.includes(i);
      return `<div class="lobbyrow"><b>${i + 1}. ${c.t}</b><span class="small" style="flex:1">${c.d}</span>${open ? `<button class="btn ${done ? 'dim' : ''}" data-act="play" data-v="${i}">${done ? 'Replay' : 'Play'}</button>` : '<span>🔒</span>'}</div>`;
    }).join('')}
    <div class="menu"><button class="btn dim" data-act="reset">New Bro (reset)</button><button class="btn dim" data-act="back">Back</button></div>`,
    { play: v => storyPlay(+v), reset: () => { try { localStorage.removeItem('fcb_story'); } catch (e) {} ST = null; storyCreate(); }, back: showMain });
}
function storyCreate() {
  const bro = { id: 'bro', name: SC.name, ovr: 68, pos: SC.pos, nation: 'OTH', club: 'OTH', tier: 'Bronze', stats: deriveStats(68, SC.pos, SC.name), skinTone: SC.skin, hairStyle: SC.hair, hairColor: SC.hairColor };
  const rd = () => { const el = $('#bn'); if (el) SC.name = (el.value || 'Bro').slice(0, 12); };
  go(`<h2>Create Your Bro</h2><div class="pinfo">${cardHTML(bro)}<div class="bars">${statBars(bro)}</div></div>
    <div class="row"><div><label>Name</label><br><input type="text" id="bn" value="${esc(SC.name)}" maxlength="12"></div>
    <div><label>Position</label><br><select data-chg="pos">${['ST', 'LW', 'RW', 'CAM', 'CM', 'CB'].map(p => `<option ${SC.pos === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    <div><label>Hair</label><br><select data-chg="hair">${HAIR_STYLES.map(p => `<option ${SC.hair === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div></div>
    <div class="row"><label>Skin</label>${SKINS.map(c => `<button class="btn ${SC.skin === c ? '' : 'dim'}" data-act="skin" data-v="${c}" style="background:${c};min-width:36px;height:30px"></button>`).join('')}
    <label>Hair colour</label>${HAIR_COLORS.map(c => `<button class="btn ${SC.hairColor === c ? '' : 'dim'}" data-act="hc" data-v="${c}" style="background:${c};min-width:36px;height:30px"></button>`).join('')}</div>
    <div class="menu"><button class="btn big" data-act="go">Start Career (68 OVR)</button><button class="btn dim" data-act="back">Back</button></div>`,
    { pos: v => { rd(); SC.pos = v; storyCreate(); }, hair: v => { rd(); SC.hair = v; storyCreate(); }, skin: v => { rd(); SC.skin = v; storyCreate(); }, hc: v => { rd(); SC.hairColor = v; storyCreate(); },
      go: () => { rd(); ST = { name: SC.name, pos: SC.pos, skin: SC.skin, hair: SC.hair, hairColor: SC.hairColor, ch: 0, ovr: 68, done: [] }; storySave(); storyMenu(); }, back: showMain });
}
function storyPlay(i) {
  const c = CHAPTERS[i], bro = broPD();
  TEAMS.BROS.str = c.usStr || 70; clearFillers('BROS'); TEAMS.LOC.str = c.oppStr || 62; clearFillers('LOC');
  const extras = (c.extra || []).map(id => PLAYERS[id]);
  const s0 = buildSide(c.us, [bro].concat(extras), c.exclude || []), s1 = buildSide(c.opp, [], s0.slots.map(p => p.id));
  const idx = s0.pickIdx[bro.id], lk = idx > 0 ? idx - 1 : null;
  startMatch({ sides: [{ team: c.us, slots: s0.slots }, { team: c.opp, slots: s1.slots }], humans: [{ ctl: mkCtl('keys', 'solo'), team: 0, lock: lk, start: lk, name: ST.name }], lvls: [0.85, 0.7 + i * 0.06], halfLen: 90, golden: !!c.golden, startScore: c.start || [0, 0], onQuit: storyMenu, onEnd: res => storyEnd(i, res) });
}
function storyEnd(i, res) {
  const c = CHAPTERS[i], win = res.winner === 0, first = !ST.done.includes(i); let msg = '';
  if (win && first) { const old = ST.ovr; ST.ovr = Math.min(97, ST.ovr + 5); ST.done.push(i); ST.ch = Math.max(ST.ch, i + 1); msg = `<p class="chem">+XP! ${ST.name} OVR ${old} → ${ST.ovr}</p>`; }
  else if (!win && first) { ST.ovr = Math.min(97, ST.ovr + 1); msg = `<p class="chem">Lost, but you learned something: OVR +1 → ${ST.ovr}</p>`; }
  storySave();
  const btns = [{ t: win ? 'Continue' : 'Retry', act: 'c', fn: win ? storyMenu : () => storyPlay(i) }, { t: 'Chapters', act: 'm', fn: storyMenu, cls: 'dim' }];
  if (win && i === CHAPTERS.length - 1) { Snd.chime(); msg += `<div style="text-align:center;font-size:80px" class="walkin">🏆</div><p class="sub">${esc(ST.name)} lifts the World Cup! Legend status unlocked.</p>`; }
  resultScreen(c.t, res, teamName(c.us), teamName(c.opp), btns, msg);
}

/* ============================== ULTIMATE TEAM ========================= */
const UTP = [[7, 50], [22, 14], [20, 38], [20, 62], [22, 86], [42, 28], [42, 72], [56, 50], [76, 18], [84, 50], [76, 82]];
const FN = ['Marco', 'Leo', 'Tom', 'Ivan', 'Ruben', 'Kai', 'Diego', 'Sami', 'Theo', 'Nico', 'Jamal', 'Yuki', 'Omar', 'Luca', 'Felix', 'Andre', 'Enzo', 'Milan', 'Jonas', 'Tariq'];
const LN = ['Silva', 'Novak', 'Rossi', 'Berg', 'Okoye', 'Tanaka', 'Duarte', 'Costa', 'Weber', 'Mendes', 'Haas', 'Petrov', 'Alves', 'Moreau', 'Ito', 'Lang', 'Vega', 'Kovac', 'Reyes', 'Dunn'];
let UT = null, utTab = 'squad', utSel = null;
function genUT(pos, ovr) {
  const id = 'ut_' + Date.now().toString(36) + (UT.n++);
  const club = pick(CLUBS).id, nat = pick(NATIONS);
  const p = addPlayer({ id, name: pick(FN) + ' ' + pick(LN), ovr, nation: nat.id, nationName: nat.name, club, pos, tier: tierFor(ovr), generated: true, ut: true });
  UT.custom.push(p); return p;
}
function utNew() {
  UT = { v: 1, coins: 3000, col: [], squad: [], custom: [], n: 0, w: 0, played: 0 };
  SLOT_POS.forEach(pos => { const p = genUT(pos, 58 + Math.floor(Math.random() * 11)); UT.col.push(p.id); UT.squad.push(p.id); });
  utSave();
}
function utLoad() {
  if (UT) return;
  try { const s = JSON.parse(localStorage.getItem('fcb_ut')); if (s && s.v === 1) { s.custom.forEach(p => { addPlayer(p); }); UT = s; return; } } catch (e) {}
  utNew();
}
function utSave() { try { localStorage.setItem('fcb_ut', JSON.stringify(UT)); } catch (e) {} }
// Chemistry links: any two players on the field who share a CLUB or NATIONAL TEAM are linked.
function utChem(sq) {
  const links = [], cnt = new Array(11).fill(0), hyper = new Set();
  for (let i = 0; i < 11; i++) for (let j = i + 1; j < 11; j++) {
    const a = sq[i], b = sq[j]; if (!a || !b) continue;
    if ((isModric(a) && b.id === 'rakitic_icon') || (isModric(b) && a.id === 'rakitic_icon')) { links.push({ i, j, type: 'hyper' }); hyper.add(i); hyper.add(j); continue; }
    const nat = a.nation === b.nation && a.nation !== 'OTH', clb = a.club === b.club && a.club !== 'OTH' && a.club !== 'ICN';
    if (nat || clb) { links.push({ i, j, type: nat && clb ? 'both' : nat ? 'nation' : 'club' }); const n = nat && clb ? 2 : 1; cnt[i] += n; cnt[j] += n; }
  }
  const boosts = cnt.map((n, i) => hyper.has(i) ? 5 : n === 0 ? 0 : n === 1 ? 2 : n === 2 ? 3 : 4);
  return { links, boosts, pct: Math.round(boosts.reduce((a, b) => a + b, 0) / (11 * 4) * 100) };
}
const utOk = (slot, p) => !!p && (slotOk(SLOT_POS[slot], p.pos) || (COMPAT[SLOT_POS[slot]] || []).includes(p.pos));
function utScreen() {
  utLoad();
  const sq = UT.squad.map(id => PLAYERS[id] || null), ch = utChem(sq), ovr = sq.every(Boolean) ? Math.round(sq.reduce((a, p) => a + p.ovr, 0) / 11) : 0;
  const tabs = ['squad', 'store', 'play'].map(t => `<button class="btn ${utTab === t ? '' : 'dim'}" data-act="tab" data-v="${t}">${t}</button>`).join('');
  let body = '';
  if (utTab === 'squad') {
    const colors = { club: '#35e08a', nation: '#4cc9f0', both: '#ffffff', hyper: '#ffd23f' };
    const svg = ch.links.map(l => `<line x1="${UTP[l.i][0] * 1.6}" y1="${UTP[l.i][1] * 0.9}" x2="${UTP[l.j][0] * 1.6}" y2="${UTP[l.j][1] * 0.9}" stroke="${colors[l.type]}" stroke-width="${l.type === 'hyper' ? 1.4 : l.type === 'both' ? 1.1 : 0.6}" opacity=".85"/>`).join('');
    const slots = UTP.map((xy, i) => { const p = sq[i], b = ch.boosts[i], tier = p ? (p.tier === 'Prime Icon' ? 'PrimeIcon' : p.tier) : '';
      return `<div class="slot ${p ? '' : 'empty'} ${utSel === i ? 'sel' : ''}" style="left:${xy[0]}%;top:${xy[1]}%" data-act="slot" data-v="${i}"><div class="mini ${tier}">${p ? `<span class="o">${p.ovr}</span><span class="p">${p.pos}</span><span class="f">${(TEAMS[p.nation] || {}).flag || ''}</span>` : '+'}</div>${p ? `<div class="nm">${esc(shortName(p))}</div><span class="chm ${b ? '' : 'z'}">+${b}</span>` : `<div class="nm">${SLOT_POS[i]}</div>`}</div>`; }).join('');
    let cands = '';
    if (utSel !== null) {
      const list = UT.col.map(id => PLAYERS[id]).filter(p => p && utOk(utSel, p)).sort((a, b) => b.ovr - a.ovr);
      cands = `<h3>Pick a ${SLOT_POS[utSel]}</h3><div class="cards">${list.map(p => cardHTML(p, { act: 'assign', sel: UT.squad[utSel] === p.id })).join('') || '<p class="small">No compatible cards - open packs!</p>'}</div>`;
    }
    body = `<div class="chem">Chemistry ${ch.pct}% · Team OVR ${ovr || '—'} <span class="small">(links: <span style="color:#35e08a">club</span> · <span style="color:#4cc9f0">nation</span> · <span style="color:#ffd23f">Croatia Hyper-Link</span>)</span></div><div class="meter"><i style="width:${ch.pct}%"></i></div>
      <div class="pitchbox"><svg viewBox="0 0 160 90" preserveAspectRatio="none"><g stroke="#fff" fill="none" stroke-width=".5" opacity=".6"><rect x="1" y="1" width="158" height="88"/><line x1="80" y1="1" x2="80" y2="89"/><circle cx="80" cy="45" r="12"/></g>${svg}</svg>${slots}</div>${cands}
      <div class="row"><button class="btn alt" data-act="auto">Auto Fill Best XI</button></div>`;
  } else if (utTab === 'store') {
    const packs = [['bronze', 'Bronze Pack', 500, '3 cards'], ['silver', 'Silver Pack', 1500, '2 cards'], ['gold', 'Gold Pack', 4000, '2 cards · 86+ guaranteed'], ['icon', 'Icon Pack', 12000, '1 ICON / PRIME ICON']];
    body = `<div class="row">${packs.map(p => `<div class="lobbyrow" style="flex-direction:column;width:200px"><b>${p[1]}</b><span class="small">${p[3]}</span><button class="btn ${UT.coins >= p[2] ? '' : 'dim'}" data-act="pack" data-v="${p[0]}">🪙 ${p[2]}</button></div>`).join('')}</div><p class="small">Duplicates are auto-sold for coins. Collection: ${UT.col.length} cards.</p>`;
  } else {
    body = `<p class="sub">Squad chemistry gives each player +0 to +5 on every stat. Win coins to open better packs.</p>
      <div class="row"><button class="btn" data-act="match" data-v="Rookie">Rookie CPU</button><button class="btn alt" data-act="match" data-v="Pro">Pro CPU</button><button class="btn" style="background:#ef476f;color:#fff" data-act="match" data-v="World">World Class CPU</button></div>
      <p class="small" style="text-align:center">Record: ${UT.w} wins from ${UT.played} matches</p>`;
  }
  go(`<h2>FC Bros UT 27 · 🪙 ${UT.coins}</h2><div class="row">${tabs}<button class="btn dim" data-act="back">Menu</button></div>${body}`, {
    tab: v => { utTab = v; utSel = null; utScreen(); }, back: showMain, slot: v => { utSel = utSel === +v ? null : +v; utScreen(); },
    assign: v => { const cur = UT.squad[utSel], old = UT.squad.indexOf(v); if (old >= 0) UT.squad[old] = utOk(old, PLAYERS[cur]) ? cur : null; UT.squad[utSel] = v; utSave(); utSel = null; utScreen(); },
    auto: () => { const used = new Set(UT.squad.filter(Boolean)); UT.squad = SLOT_POS.map((s, i) => { const c = UT.col.map(id => PLAYERS[id]).filter(p => p && utOk(i, p) && !used.has(p.id)).sort((a, b) => b.ovr - a.ovr)[0]; if (c) used.add(c.id); return c ? c.id : null; }); utSave(); utScreen(); },
    pack: v => utPack(v), match: v => utPlay(v) });
}
function utPick(min, max, notIcon) {
  const pool = Object.values(PLAYERS).filter(p => !p.generated && p.ovr >= min && p.ovr <= max && p.club !== 'ICN' && p.tier !== 'Icon' && p.tier !== 'Prime Icon');
  const w = pool.map(p => Math.pow(0.78, Math.max(0, p.ovr - 86))), tot = w.reduce((a, b) => a + b, 0); let r = Math.random() * tot;
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; } return pool[0];
}
function utPack(kind) {
  const cost = { bronze: 500, silver: 1500, gold: 4000, icon: 12000 }[kind];
  if (UT.coins < cost) { Snd.tick(); return; }
  UT.coins -= cost; const rp = () => pick(['ST', 'LW', 'CAM', 'CM', 'CM', 'LB', 'CB', 'CB', 'RB', 'RW', 'GK']), cards = [];
  if (kind === 'bronze') for (let i = 0; i < 3; i++) cards.push(genUT(rp(), 58 + Math.floor(Math.random() * 15)));
  else if (kind === 'silver') { cards.push(utPick(80, 85)); cards.push(genUT(rp(), 70 + Math.floor(Math.random() * 10))); }
  else if (kind === 'gold') { cards.push(utPick(86, 99)); cards.push(utPick(80, 85)); }
  else { const ic = Object.values(PLAYERS).filter(p => p.tier === 'Icon' || p.tier === 'Prime Icon'); cards.push(pick(ic)); }
  const sell = { Bronze: 100, Silver: 250, Gold: 600, Icon: 1500, 'Prime Icon': 3000 };
  const res = cards.map(p => { const dup = UT.col.includes(p.id) && !p.ut; if (dup) UT.coins += sell[p.tier] || 100; else if (!UT.col.includes(p.id)) UT.col.push(p.id); return { p, dup }; });
  utSave(); utReveal(res, 0);
}
function utReveal(res, i) {
  const r = res[i], p = r.p, big = p.tier === 'Icon' || p.tier === 'Prime Icon' || p.ovr >= 90;
  const fl = document.createElement('div'); fl.className = 'flare'; document.body.appendChild(fl); setTimeout(() => fl.remove(), 1100);
  if (big) { Snd.chime(); setTimeout(Snd.chime, 450); Snd.roar(); } else Snd.coin();
  go(`<h2>Pack Opened! ${i + 1}/${res.length}</h2><div style="text-align:center;padding:30px 0"><div class="walkin">${cardHTML(p)}</div><p class="sub" style="margin-top:34px">${esc(p.name)} · ${p.pos} · ${p.ovr} OVR</p>${r.dup ? '<p class="chem">Duplicate - sold for coins</p>' : '<p class="chem">NEW CARD!</p>'}</div>
    <div class="menu"><button class="btn big" data-act="next">${i + 1 < res.length ? 'Next Card' : 'Done'}</button></div>`, { next: () => { if (i + 1 < res.length) utReveal(res, i + 1); else { utTab = 'squad'; utScreen(); } } });
}
function utPlay(diff) {
  const sq = UT.squad.map(id => PLAYERS[id]);
  if (sq.some(p => !p)) { utTab = 'squad'; utScreen(); return; }
  const ch = utChem(sq), mine = sq.map((p, i) => boosted(p, ch.boosts[i])), base = pick(CLUBS), str = { Rookie: 66, Pro: 77, World: 86 }[diff];
  TEAMS.UTOPP = Object.assign({}, base, { id: 'UTOPP', str, kind: 'club' }); clearFillers('UTOPP');
  const s1 = buildSide('UTOPP', [], []);
  startMatch({ sides: [{ team: 'UTME', label: 'FC Bros UT', slots: mine }, { team: 'UTOPP', label: base.name, slots: s1.slots }], humans: [{ ctl: mkCtl('keys', 'solo'), team: 0, lock: null, start: 8, name: 'YOU' }], lvls: [0.85, { Rookie: 0.65, Pro: 0.85, World: 1 }[diff]], halfLen: 90, golden: false, onQuit: utScreen,
    onEnd: res => {
      const coins = (res.winner === 0 ? 600 : res.winner < 0 ? 250 : 100) + res.h * 50 + { Rookie: 0, Pro: 150, World: 400 }[diff] * (res.winner === 0 ? 1 : 0);
      UT.coins += coins; UT.played++; if (res.winner === 0) UT.w++; utSave();
      resultScreen('Full Time', res, 'FC Bros UT', base.name, [{ t: 'Squad', act: 's', fn: () => { utTab = 'squad'; utScreen(); } }, { t: 'Play Again', act: 'a', fn: () => utPlay(diff), cls: 'alt' }, { t: 'Menu', act: 'm', fn: showMain, cls: 'dim' }], `<p class="chem">+${coins} 🪙 coins</p>`);
    } });
}

/* ============================== ONLINE LOBBY ========================== */
let LB = null;
function takenMap() { const t = {}; for (const id in LB.members) { const p = LB.members[id].pid; if (p) t[p] = +id; } return t; }
function allPlayerOptions(sel, taken) {
  const list = Object.values(PLAYERS).filter(p => !p.generated).sort((a, b) => b.ovr - a.ovr);
  return `<option value="">🎲 Auto (best available)</option>` + list.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''} ${taken[p.id] !== undefined && p.id !== sel ? 'disabled' : ''}>${esc(p.name)} · ${p.pos} ${p.ovr}${p.tier === 'Icon' || p.tier === 'Prime Icon' ? ' ★' : ''}</option>`).join('');
}
function onlineMenu() {
  const nm = (LB && LB.name) || 'Player';
  go(`<h2>Online Lobby</h2><p class="sub">Host a room (up to 8 players) and share the 5-letter code - or join a friend's.</p>
    <div class="row"><div><label>Your name</label><br><input type="text" id="on" value="${esc(nm)}" maxlength="12"></div></div>
    <div class="menu"><button class="btn big" data-act="host">Create Lobby</button>
    <div class="row"><input type="text" id="jc" placeholder="CODE" maxlength="5" style="text-transform:uppercase;width:120px;text-align:center;font-size:22px"><button class="btn alt" data-act="join">Join Lobby</button></div>
    <p class="small">No server needed - connects directly (WebRTC). ${Net.available() ? '' : '<b style="color:#ef476f">PeerJS failed to load - check your connection.</b>'}</p>
    <button class="btn dim" data-act="back">Back</button></div>`,
    { host: () => lobbyHost(($('#on').value || 'Host').slice(0, 12)), join: () => lobbyJoin(($('#jc').value || '').toUpperCase(), ($('#on').value || 'Guest').slice(0, 12)), back: showMain });
}
function autoSide() { const c = [0, 0]; for (const id in LB.members) c[LB.members[id].side]++; return c[0] <= c[1] ? 0 : 1; }
function lobbyHost(name) {
  LB = { role: 'host', name, code: '', myId: 0, members: { 0: { name, side: 0, pid: '' } }, sideTeam: ['CRO', 'ARG'], half: 120, ctls: {} };
  Net.createLobby({
    onCode: c => { LB.code = c; lobbyScreen(); },
    onJoin: id => { LB.members[id] = { name: 'Player ' + (id + 1), side: autoSide(), pid: '' }; pushLobby(); },
    onLeave: id => { delete LB.members[id]; if (cur && cur.humans) { const h = cur.humans.find(x => x.id === id); if (h) h.ctl = null; } delete LB.ctls[id]; pushLobby(); },
    onData: (id, msg) => {
      if (msg.t === 'pick') {
        const m = LB.members[id]; if (!m) return;
        if (msg.name) m.name = String(msg.name).slice(0, 12);
        if (msg.side === 0 || msg.side === 1) m.side = msg.side;
        if ('pid' in msg) { const v = msg.pid, tk = takenMap(); if (!v || (PLAYERS[v] && (tk[v] === undefined || tk[v] === id))) m.pid = v || ''; }
        pushLobby();
      } else if (msg.t === 'in') { const c = LB.ctls[id]; if (c) { c.net = msg.h; for (const k in (msg.ev || {})) c.ev[k] = 1; } }
    },
    onError: e => { alert('Lobby error: ' + e); LB = null; onlineMenu(); } });
  go('<h2>Creating lobby…</h2>', {});
}
function lobbyJoin(code, name) {
  LB = { role: 'guest', name, code, myId: null, members: {}, sideTeam: ['CRO', 'ARG'], half: 120 };
  Net.joinLobby(code, {
    onConnect: () => {},
    onData: msg => {
      switch (msg.t) {
        case 'welcome': LB.myId = msg.id; Net.send({ t: 'pick', name }); break;
        case 'full': alert('Lobby is full (8 players max).'); Net.close(); LB = null; onlineMenu(); break;
        case 'lobby': LB.members = msg.members; LB.sideTeam = msg.sideTeam; LB.half = msg.half; if (!cur) lobbyScreen(); break;
        case 'start': startMatch({ sides: msg.sides, humans: msg.humans.map(h => Object.assign({}, h, { ctl: null })), halfLen: msg.halfLen, lvls: [0.85, 0.85], net: { role: 'guest' } }); break;
        case 's': if (cur && cur.net && cur.net.role === 'guest') applySnap(cur, msg); break;
        case 'end': if (cur) stopMatch(); resultScreen('Full Time', msg.res, teamName(LB.sideTeam[0]), teamName(LB.sideTeam[1]), [{ t: 'Back to Lobby', act: 'l', fn: lobbyScreen }]); break;
      }
    },
    onClose: () => { if (cur) stopMatch(); alert('Disconnected from the lobby.'); Net.close(); LB = null; onlineMenu(); },
    onError: e => { alert('Could not join: ' + e); Net.close(); LB = null; onlineMenu(); } });
  go('<h2>Joining…</h2>', {});
}
function pushLobby() { Net.broadcast({ t: 'lobby', members: LB.members, sideTeam: LB.sideTeam, half: LB.half }); if (!cur) lobbyScreen(); }
function lobbyScreen() {
  if (!LB) return;
  const host = LB.role === 'host', me = LB.myId, taken = takenMap(), ids = Object.keys(LB.members).map(Number).sort((a, b) => a - b);
  const cnt = [0, 0]; ids.forEach(id => cnt[LB.members[id].side]++);
  const rows = ids.map(id => {
    const m = LB.members[id], mine = id === me;
    return `<div class="lobbyrow"><span class="sidebadge s${m.side}">TEAM ${m.side ? 'B' : 'A'}</span><b>${esc(m.name)}${id === 0 ? ' 👑' : ''}${mine ? ' (you)' : ''}</b>
      ${mine ? `<select data-chg="mypick">${allPlayerOptions(m.pid, taken)}</select><button class="btn dim" data-act="myside">Switch side</button>` : `<span>${m.pid ? esc(PLAYERS[m.pid].name) : 'Auto'}</span>${host ? `<button class="btn dim" data-act="move" data-v="${id}">Move</button>` : ''}`}</div>`;
  }).join('');
  go(`<h2>Lobby ${host ? 'Code' : ''}</h2>${LB.code ? `<div class="codebox">${LB.code}</div>` : ''}
    <p class="sub">${ids.length}/8 players · Team A ${cnt[0]} v ${cnt[1]} Team B · the rest of each 11 are AI placed by position. Pick any player in the game (keepers stay AI).</p>${rows}
    ${host ? `<div class="row"><div><label>Team A kit</label><br><select data-chg="st0">${teamOptions(LB.sideTeam[0])}</select></div><div><label>Team B kit</label><br><select data-chg="st1">${teamOptions(LB.sideTeam[1])}</select></div>
    <div><label>Half</label><br><select data-chg="half">${[60, 120, 180].map(v => `<option value="${v}" ${LB.half === v ? 'selected' : ''}>${v / 60} min</option>`).join('')}</select></div></div>
    <div class="menu"><button class="btn big" data-act="start">Start Match</button><button class="btn dim" data-act="leave">Close Lobby</button></div>` : `<p class="sub">Waiting for the host to start…</p><div class="menu"><button class="btn dim" data-act="leave">Leave</button></div>`}`, {
    mypick: v => { const m = LB.members[me]; if (host) { if (!v || taken[v] === undefined || taken[v] === me) m.pid = v; pushLobby(); } else Net.send({ t: 'pick', pid: v, side: m.side }); },
    myside: () => { const m = LB.members[me]; if (host) { m.side = 1 - m.side; pushLobby(); } else Net.send({ t: 'pick', side: 1 - m.side, pid: m.pid }); },
    move: v => { const m = LB.members[+v]; m.side = 1 - m.side; pushLobby(); },
    st0: v => { LB.sideTeam[0] = v; pushLobby(); }, st1: v => { LB.sideTeam[1] = v; pushLobby(); }, half: v => { LB.half = +v; pushLobby(); },
    start: lobbyStart, leave: () => { Net.close(); LB = null; showMain(); } });
}
function lobbyStart() {
  const ids = Object.keys(LB.members).map(Number).sort((a, b) => a - b), picks = [[], []];
  ids.forEach(id => { const m = LB.members[id]; if (m.pid) picks[m.side].push(PLAYERS[m.pid]); });
  const s0 = buildSide(LB.sideTeam[0], picks[0], picks[1].map(p => p.id)), s1 = buildSide(LB.sideTeam[1], picks[1], s0.slots.map(p => p.id)), S = [s0, s1];
  LB.ctls = {};
  const humans = ids.map(id => {
    const m = LB.members[id], i = m.pid ? S[m.side].pickIdx[m.pid] : undefined, lk = i > 0 ? i - 1 : null;
    return { ctl: id === 0 ? mkCtl('keys', 'solo') : (LB.ctls[id] = mkCtl('net')), team: m.side, lock: lk, start: lk, name: m.name, id };
  });
  const sides = [0, 1].map(t => ({ team: LB.sideTeam[t], label: teamName(LB.sideTeam[t]), slots: S[t].slots }));
  Net.broadcast({ t: 'start', sides, humans: humans.map(h => ({ team: h.team, lock: h.lock, start: h.start, name: h.name, id: h.id })), halfLen: LB.half });
  startMatch({ sides, humans, lvls: [0.85, 0.85], halfLen: LB.half, golden: false, net: { role: 'host' }, onQuit: lobbyScreen,
    onEnd: res => resultScreen('Full Time', res, teamName(LB.sideTeam[0]), teamName(LB.sideTeam[1]), [{ t: 'Back to Lobby', act: 'l', fn: lobbyScreen }]) });
}

/* ============================== BOOT ================================== */
rafId = requestAnimationFrame(frame);

