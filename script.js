const $ = s => document.querySelector(s);
const PATH = [[6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0]];
const HOME = [0,1,2,3].map(p => [1,2,3,4,5].map(i => [[7,i],[i,7],[7,14-i],[14-i,7]][p]));
const FIN = [[7,6],[6,7],[7,8],[8,7]];
const JAIL = [[0,0],[0,9],[9,9],[9,0]];
const PAL = [['#e4572e','Red'],['#2fa36b','Green'],['#f2b134','Gold'],['#3a7bd5','Blue'],['#8e44ad','Purple'],['#e84393','Pink'],['#17a2b8','Teal'],['#f57c00','Orange']];
let COLORS = [], NAMES = [], SEAT = [0,1,2,3], spd = 1;   // per-player colour/name; SEAT maps player -> board corner
const off = p => 13 * SEAT[p];
const TYPES = ['Off','Human','Easy CPU','Smart CPU'];
const SAFE = new Set([0,8,13,21,26,34,39,47]);
const BOOST = new Set([4,17,30,43]), TRAP = new Set([11,24,37,50]);
const NEG_UNLOCK = 5;   // every player's lead token must be past this square before negatives appear
const INFO = {
  jail:['🔓','Jailbreak','Free one token'], swap:['🔄','Swap','Trade places with a rival'],
  skip:['⛔','Skip','Next player loses a turn'], rep:['🔁','Repeat','Play another turn'],
  elim:['💥','Eliminate','Send a rival to jail'], shield:['🛡️','Shield','Protect a token'],
  rev:['🔃','Reverse','Flip turn order'], quake:['🌋','Quake','Everyone slides back 3']
};
const cfg = {t:4, mode:0, sp:0, win:0, bon:1, seats:[{type:1,col:0,name:''},{type:3,col:1,name:''},{type:0,col:2,name:''},{type:0,col:3,name:''}]};
try { Object.assign(cfg, JSON.parse(localStorage.getItem('cc-cfg') || '{}')); } catch (e) {}
let G = null, all = [], logs = [], audio, muted = false, epoch = 0, cardId = 0, jailEls = [];
const ABORT = {};
// sleep aborts when the game is restarted so old async chains die quietly
const sleep = ms => { const e = epoch; return new Promise((res, rej) => setTimeout(() => e === epoch ? res() : rej(ABORT), ms * spd)); };
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { if (e !== ABORT) throw e; } };

function beep(f, d = .08, ty = 'sine') {
  if (muted) return;
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = ty; o.frequency.value = f; g.gain.value = .05;
    o.connect(g); g.connect(audio.destination); o.start();
    g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + d); o.stop(audio.currentTime + d);
  } catch (e) {}
}
function toast(m) { const e = $('#toast'); e.textContent = m; e.style.animation = 'none'; e.offsetWidth; e.style.animation = ''; }
function shake() { const b = $('#board'); b.classList.remove('shake'); b.offsetWidth; b.classList.add('shake'); }
$('#mute').onclick = e => { muted = !muted; e.target.textContent = muted ? '🔇' : '🔊'; };

/* ---------- menu / settings ---------- */
const pname = i => cfg.seats[i].name.trim() || PAL[cfg.seats[i].col][1];
function syncSeg() {
  document.querySelectorAll('.seg[data-key]').forEach(seg => seg.querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', +b.dataset.v === +cfg[seg.dataset.key])));
  const cnt = ty => cfg.seats.filter(s => ty(s.type)).length;
  const h = cnt(t => t == 1), c = cnt(t => t >= 2);
  document.querySelectorAll('.seg[data-grp]').forEach(seg => seg.querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', +b.dataset.v === (seg.dataset.grp == 'h' ? h : c))));
  $('#seats').innerHTML = cfg.seats.map((s, i) => `<div class="seat ${s.type ? '' : 'offseat'}" style="--col:${PAL[s.col][0]}">
    <div class="shead"><b>P${i + 1}</b><input maxlength="10" data-i="${i}" placeholder="${PAL[s.col][1]}" value="${s.name.replace(/"/g, '')}">
    <div class="seg types">${TYPES.map((n, v) => `<button data-i="${i}" data-ty="${v}" class="${s.type == v ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    <div class="sw">${PAL.map((p, c) => `<button class="swatch ${s.col == c ? 'on' : ''}" data-i="${i}" data-c="${c}" style="--col:${p[0]}" title="${p[1]}" aria-label="${p[1]}"></button>`).join('')}</div></div>`).join('');
  const act = cnt(t => t > 0);
  $('#startBtn').disabled = act < 2;
  $('#warn').textContent = act < 2 ? 'Pick at least 2 players' : act + ' players: ' + cfg.seats.map((s, i) => s.type ? (s.type > 1 ? '🤖 ' : '') + pname(i) : '').filter(Boolean).join(', ');
  $('#lvl').textContent = cfg.mode ? '🎲 Roll the dice. A 6 frees a token and gives another roll.' : '🃏 Draw cards: power-ups, attacks, swaps and more.';
}
document.querySelectorAll('.seg[data-key]').forEach(seg => seg.onclick = e => {
  if (e.target.tagName != 'BUTTON') return;
  cfg[seg.dataset.key] = +e.target.dataset.v;
  syncSeg();
});
document.querySelectorAll('.seg[data-grp]').forEach(seg => seg.onclick = e => {
  if (e.target.tagName != 'BUTTON') return;
  let h = +$('.seg[data-grp=h] .on').dataset.v, c = +$('.seg[data-grp=c] .on').dataset.v;
  const v = +e.target.dataset.v;
  if (seg.dataset.grp == 'h') { h = v; if (h + c > 4) c = 4 - h; } else { c = v; if (h + c > 4) h = 4 - c; }
  cfg.seats.forEach((s, i) => s.type = i < h ? 1 : i < h + c ? 3 : 0);
  syncSeg();
});
$('#seats').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const i = +b.dataset.i;
  if (b.dataset.ty != null) cfg.seats[i].type = +b.dataset.ty;
  else if (b.dataset.c != null) {   // colours stay unique: swap with whoever holds it
    const c = +b.dataset.c, o = cfg.seats.findIndex((s, j) => j != i && s.col == c);
    if (o >= 0) cfg.seats[o].col = cfg.seats[i].col;
    cfg.seats[i].col = c;
  }
  syncSeg();
});
$('#seats').addEventListener('input', e => { if (e.target.tagName == 'INPUT') cfg.seats[+e.target.dataset.i].name = e.target.value; });
$('#shuffleCol').onclick = () => {
  const cols = shuffle(PAL.map((_, i) => i)); cfg.seats.forEach((s, i) => s.col = cols[i]); syncSeg();
};
function openMenu(over) {
  const live = G && G.phase != 'over';
  $('#title').textContent = over ? $('#title').textContent : 'Chrono Clash';
  if (!over) {
    $('#sub').textContent = live ? 'Starting a new game replaces the current one.' : 'The classic Ludo race, with a twist of time.';
    $('#startBtn').textContent = live ? 'New game' : '▶ Start game';
  }
  $('#closeBtn').classList.toggle('hide', !live);
  syncSeg();
  $('#overlay').classList.remove('hide');
}
$('#startBtn').onclick = start;
$('#closeBtn').onclick = () => $('#overlay').classList.add('hide');
$('#menu').onclick = () => openMenu(false);
$('#restart').onclick = () => {
  if (!G) return start();
  if (G.phase == 'over' || confirm('Restart the game with the same settings?')) start();
};
$('#drawBtn').onclick = () => { if (!isCpu()) draw(); };
$('#pile').onclick = () => { if (G && G.phase == 'draw' && !isCpu()) draw(); };
syncSeg();

/* ---------- board ---------- */
function box(cls, x, y, w, h, p) {
  const d = document.createElement('div');
  d.className = cls;
  Object.assign(d.style, {left:x*100/15+'%', top:y*100/15+'%', width:w*100/15+'%', height:h*100/15+'%'});
  if (p != null) d.style.setProperty('--col', p);
  return d;
}

function buildBoard() {
  const b = $('#board');
  b.innerHTML = '';
  const sc = q => { const p = SEAT.indexOf(q); return p < 0 ? '#8a929b' : COLORS[p]; };
  jailEls = JAIL.map((j, q) => { const e = box('jail' + (SEAT.includes(q) ? '' : ' unused'), j[1], j[0], 6, 6, sc(q)); b.append(e); return e; });
  b.append(box('center', 6, 6, 3, 3));
  PATH.forEach((c, i) => {
    const st = i % 13 == 0;
    const d = box('cell' + (st ? ' start' : '') + (SAFE.has(i) ? ' safe' : '') + (BOOST.has(i) ? ' boost' : '') + (TRAP.has(i) ? ' trap' : ''), c[1], c[0], 1, 1, st ? sc(i / 13) : null);
    b.append(d);
  });
  HOME.forEach((h, q) => h.forEach(c => b.append(box('cell home', c[1], c[0], 1, 1, sc(q)))));
}

/* ---------- deck ---------- */
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function mkDeck() {
  const d = [];
  for (let v = 1; v <= 9; v++) d.push({t:'n', v}, {t:'n', v});
  for (let v = 1; v <= 3; v++) d.push({t:'n', v:-v}, {t:'n', v:-v}, {t:'n', v:-v});   // only -1, -2, -3 exist
  [['jail',8],['swap',3],['skip',3],['rep',3],['elim',3],['shield',3],['rev',2],['quake',2]].forEach(([t, n]) => { while (n--) d.push({t}); });
  return shuffle(d);
}
// negatives are only dealt once EVERY player has a token beyond square 5
const best = p => Math.max(-1, ...all.filter(t => t.p == p).map(t => t.prog));
const negOK = () => Array.from({length:G.n}, (_, p) => best(p)).every(b => b > NEG_UNLOCK);
function nextCard() {
  if (G.dice) return {t:'n', v:1 + (Math.random() * 6 | 0), dice:true};
  const ok = negOK(), held = [];
  for (;;) {
    if (!G.deck.length) G.deck = mkDeck();
    const c = G.deck.pop();
    if (c.t == 'n' && c.v < 0 && !ok) { held.push(c); continue; }
    G.deck.unshift(...held);
    return c;
  }
}

/* ---------- card visuals ---------- */
const BACK = '<div class="face back"><div class="logo"><span>⏳</span>CHRONO CLASH</div></div>';
function setCard(front, kind) {
  const e = $('#card');
  e.className = 'card' + (kind ? ' k-' + kind + ' deal' : '');
  e.innerHTML = `<div class="tilt"><div class="inner">${BACK}${front || ''}</div></div>`;
  return e;
}
function resetCard() { cardId++; setCard(); }
function frontHTML(c) {
  let k, corner, center, ttl, sub;
  if (c.t == 'n') {
    const up = c.v > 0;
    k = up ? 'plus' : 'minus'; corner = label(c);
    center = `<div class="num">${label(c)}</div><div class="arrow">${up ? '▲' : '▼'}</div>`;
    ttl = up ? 'Move forward' : 'Push back';
    sub = up ? 'Advance one of your tokens' : "Hit any token, even yours";
    if (c.dice) { corner = '🎲'; center = `<div class="num">${c.v}</div><div class="arrow">🎲</div>`; ttl = 'Dice roll'; sub = c.v == 6 ? 'Six! Frees a token, roll again' : 'Move a token'; }
  } else {
    const [i, n, d] = INFO[c.t];
    k = c.t; corner = i; center = `<div class="ico">${i}</div>`; ttl = n; sub = d;
  }
  const sparks = Array.from({length:7}, () => `<i style="--x:${8 + Math.random() * 84}%;--y:${8 + Math.random() * 84}%;--d:${(Math.random() * 1.8).toFixed(2)}s"></i>`).join('');
  return [k, `<div class="face front"><div class="grid"></div><div class="sparks">${sparks}</div><span class="corner tl">${corner}</span><span class="corner br">${corner}</span>${center}<div class="ttl">${ttl}</div><small>${sub}</small><div class="holo"></div></div>`];
}
function show(c) {
  const [k, html] = frontHTML(c), id = ++cardId;
  const e = setCard(html, k);
  beep(300, .05, 'triangle');
  setTimeout(() => { if (id === cardId) { e.classList.add('flipped'); beep(520, .09, 'triangle'); } }, 260);
}
// 3D tilt that follows the pointer
(() => {
  const e = $('#card');
  e.addEventListener('pointermove', ev => {
    const t = e.querySelector('.tilt'); if (!t) return;
    const r = e.getBoundingClientRect();
    t.style.setProperty('--ry', ((ev.clientX - r.left) / r.width - .5) * 26 + 'deg');
    t.style.setProperty('--rx', (.5 - (ev.clientY - r.top) / r.height) * 26 + 'deg');
  });
  e.addEventListener('pointerleave', () => { const t = e.querySelector('.tilt'); if (t) { t.style.setProperty('--rx', '0deg'); t.style.setProperty('--ry', '0deg'); } });
})();

/* ---------- game setup ---------- */
function start() {
  const act = cfg.seats.map((x, i) => i).filter(i => cfg.seats[i].type > 0);
  if (act.length < 2) return;
  epoch++;
  spd = [1, .5, .25][cfg.sp] || 1;
  try { localStorage.setItem('cc-cfg', JSON.stringify(cfg)); } catch (e) {}
  document.querySelectorAll('.conf').forEach(c => c.remove());
  const n = act.length;
  SEAT = n == 2 ? [0, 2] : n == 3 ? [0, 1, 2] : [0, 1, 2, 3];
  COLORS = act.map(i => PAL[cfg.seats[i].col][0]);
  NAMES = act.map(i => pname(i));
  buildBoard();
  all = [];
  for (let p = 0; p < n; p++) for (let k = 0; k < cfg.t; k++) {
    const t = {p, k, prog:-1, shield:false, el:document.createElement('div')};
    t.el.className = 'token';
    t.el.style.setProperty('--col', COLORS[p]);
    t.el.onclick = () => { if (!isCpu()) pick(t); };
    $('#board').append(t.el);
    all.push(t);
  }
  const ty = act.map(i => cfg.seats[i].type);
  G = {n, t:cfg.t, turn:0, deck:mkDeck(), card:null, phase:'wait', tg:[], skip:[], dir:1, tries:1, src:null,
       cpu:ty.map(x => x >= 2), lvl:ty.map(x => x == 3 ? 1 : 0), neg:false, dice:cfg.mode == 1, win:cfg.win, bon:cfg.bon};
  logs = [];
  resetCard();
  $('#overlay').classList.add('hide');
  startTurn();
}

const isCpu = () => !!(G && G.cpu && G.cpu[G.turn] && G.phase != 'over');
const mine = () => all.filter(t => t.p == G.turn);
const foes = () => all.filter(t => t.p != G.turn);
const ring = t => t.prog >= 0 && t.prog <= 50;
const idx = t => (off(t.p) + t.prog) % 52;
const prot = t => !ring(t) || SAFE.has(idx(t)) || t.shield || all.some(o => o !== t && o.p == t.p && o.prog == t.prog);
const swapOK = (a, b) => (idx(b) - off(a.p) + 52) % 52 <= 50 && (idx(a) - off(b.p) + 52) % 52 <= 50;
const label = c => c.t == 'n' ? (c.v > 0 ? '+' + c.v : '' + c.v) : INFO[c.t][1];

function say(m) { logs.unshift(m); logs.length = Math.min(logs.length, 4); }
function hint(m) {
  $('#hint').textContent = isCpu() ? `🤖 ${NAMES[G.turn]} (computer) is playing…` : m;
}

function targets() {
  const c = G.card, m = mine(), f = foes();
  if (c.t == 'n') return c.v > 0
    ? m.filter(t => t.prog >= 0 ? t.prog + c.v <= 56 : (c.dice && c.v == 6))
    : m.filter(t => t.prog >= 1 && t.prog < 56).concat(f.filter(t => t.prog >= 1 && !prot(t)));
  if (c.t == 'jail') return m.filter(t => t.prog < 0);
  if (c.t == 'elim') return f.filter(t => ring(t) && !prot(t));
  if (c.t == 'shield') return m.filter(t => ring(t) && t.prog > 0 && !t.shield);
  if (c.t == 'swap') return G.src
    ? f.filter(t => ring(t) && !prot(t) && swapOK(G.src, t))
    : m.filter(t => ring(t) && f.some(o => ring(o) && !prot(o) && swapOK(t, o)));
  return [];
}

/* ---------- turn flow ---------- */
function startTurn() {
  mine().forEach(t => t.shield = false);
  G.src = null;
  G.tries = mine().some(t => t.prog >= 0 && t.prog < 56) ? 1 : 3;
  G.phase = 'draw';
  const ok = !G.dice && negOK();
  if (ok !== G.neg) {
    G.neg = ok;
    toast(ok ? '⚠️ Negative cards unlocked' : '🔒 Negative cards locked');
    beep(ok ? 220 : 440, .25, 'square');
  }
  hint(NAMES[G.turn] + (G.dice ? ', roll the dice' : ', draw a card') + (G.tries > 1 ? (G.dice ? ' (3 tries to roll a 6)' : ' (3 tries to find a Jailbreak)') : ''));
  render();
  kick();
}

function endTurn(extra) {
  const e = epoch;
  G.phase = 'wait';
  render();
  setTimeout(() => {
    if (e !== epoch) return;
    if (!extra) {
      let s = true;
      while (s) {
        G.turn = (G.turn + G.dir + G.n) % G.n;
        s = G.skip[G.turn];
        if (s) { G.skip[G.turn] = false; say(NAMES[G.turn] + ' skips a turn'); }
      }
    }
    startTurn();
  }, 1000 * spd);
}

function draw() {
  if (!G || G.phase != 'draw') return;
  const c = G.card = nextCard();
  show(c);
  const me = NAMES[G.turn];
  if (c.t == 'skip') {
    const nx = (G.turn + G.dir + G.n) % G.n;
    G.skip[nx] = true;
    say(`${me} played Skip: ${NAMES[nx]} loses a turn`);
    return endTurn(false);
  }
  if (c.t == 'rep') { say(`${me} gets another turn`); return endTurn(true); }
  if (c.t == 'rev') { G.dir *= -1; say(`${me} reversed the order`); toast('🔃 Reverse!'); beep(380,.2); return endTurn(false); }
  if (c.t == 'quake') { say(`${me} caused a quake!`); return quake(); }
  G.tg = targets();
  if (!G.tg.length) {
    G.tries--;
    say(`${me} drew ${label(c)}: no legal move`);
    if (G.tries > 0) { G.phase = 'draw'; hint('No legal move. Draw again'); render(); kick(); }
    else endTurn(false);
    return;
  }
  G.phase = 'pick';
  const tips = {
    jail:'Tap a jailed token to free it', elim:'Tap a rival token to send it to jail',
    shield:'Tap your token to shield it', swap:'Tap your token, then a rival to swap places'
  };
  hint(c.t == 'n'
    ? (c.v > 0 ? `Tap a glowing token to move it ${c.v}` : `Tap a glowing token to push it back ${-c.v}: yours or a rival's`)
    : tips[c.t]);
  render();
  kick();
}

function hop(t) { t.el.classList.remove('hop'); t.el.offsetWidth; t.el.classList.add('hop'); }

async function walk(t, np) {
  const d = np > t.prog ? 1 : -1;
  while (t.prog != np) { t.prog += d; hop(t); render(); beep(260 + t.prog * 7, .05); await sleep(140); }
}

async function kill(o) {
  const [r, c] = pos(o), d = document.createElement('div');
  d.className = 'burst';
  d.style.left = (c + .5) * 100 / 15 + '%'; d.style.top = (r + .5) * 100 / 15 + '%';
  d.style.setProperty('--col', COLORS[o.p]);
  d.innerHTML = Array.from({length:8}, (_, i) => `<i style="--a:${i * 45}deg"></i>`).join('');
  $('#board').append(d); shake(); beep(150, .35, 'sawtooth');
  setTimeout(() => d.remove(), 700);
  o.el.classList.add('die'); await sleep(450);
  o.prog = -1; o.el.classList.remove('die'); render();
}

async function move(t, np) {
  await walk(t, np);
  let bonus = false;
  if (ring(t)) {
    const i = idx(t);
    if (BOOST.has(i) && t.prog + 5 <= 50) { toast('⚡ Boost +5'); beep(800, .2); await sleep(300); await walk(t, t.prog + 5); }
    else if (TRAP.has(i) && t.prog > 1) { toast('🕳️ Trap! Back 4'); beep(120, .3, 'square'); await sleep(300); await walk(t, Math.max(t.prog - 4, 1)); }
  }
  if (ring(t) && !SAFE.has(idx(t))) {
    const v = foes().filter(o => ring(o) && idx(o) == idx(t) && !prot(o));
    for (const o of v) { say(`${NAMES[t.p]} captured a ${NAMES[o.p]} token!`); await kill(o); }
    if (v.length) { toast('💥 Captured! Bonus turn'); bonus = true; }
  }
  if (t.prog == 56) { toast('🏠 Home! Bonus turn'); say(`${NAMES[t.p]} token reached home!`); beep(660, .3); bonus = true; }
  return bonus;
}

const quake = guard(async () => {
  G.phase = 'wait'; toast('🌋 Quake! Everyone back 3'); shake(); beep(90, .6, 'sawtooth');
  await sleep(500);
  all.filter(t => ring(t) && t.prog > 1 && !prot(t)).forEach(t => t.prog = Math.max(t.prog - 3, 1));
  render(); await sleep(700);
  endTurn(false);
});

const pick = guard(async t => {
  if (!G || G.phase != 'pick' || !G.tg.includes(t)) return;
  const c = G.card, me = NAMES[G.turn];
  let bonus = false;
  if (c.t == 'swap' && !G.src) { G.src = t; G.tg = targets(); hint('Now tap a rival to swap with'); render(); kick(); return; }
  G.phase = 'wait'; G.tg = []; render();
  if (c.t == 'n') {
    const np = t.prog < 0 ? 0 : Math.max(t.prog + c.v, 0);
    if (t.p == G.turn) bonus = await move(t, np);
    else { await walk(t, np); say(`${me} pushed a ${NAMES[t.p]} token back ${-c.v}`); }
  } else if (c.t == 'jail') {
    t.prog = 0; hop(t); beep(520, .2); toast('🔓 Jailbreak!'); say(`${me} broke a token out of jail!`); render(); await sleep(600);
  } else if (c.t == 'elim') {
    say(`${me} sent a ${NAMES[t.p]} token to jail`); await kill(t);
  } else if (c.t == 'shield') {
    t.shield = true; toast('🛡️ Shielded'); beep(700, .15); say(`${me} shielded a token`); render(); await sleep(500);
  } else if (c.t == 'swap') {
    const a = G.src, pa = (idx(t) - off(a.p) + 52) % 52, pb = (idx(a) - off(t.p) + 52) % 52;
    a.prog = pa; t.prog = pb; G.src = null; toast('🔄 Swap!'); beep(440, .2);
    say(`${me} swapped places with ${NAMES[t.p]}`); render(); await sleep(700);
  }
  if (G.win == 1 ? mine().some(x => x.prog == 56) : mine().every(x => x.prog == 56)) return win();
  endTurn((bonus && G.bon) || (c.dice && c.v == 6 && t.p == G.turn));
});

function win() {
  G.phase = 'over';
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('i');
    c.className = 'conf';
    c.style.cssText = `left:${Math.random() * 100}vw;background:${COLORS[i % COLORS.length]};animation-delay:${Math.random()}s`;
    document.body.append(c); setTimeout(() => c.remove(), 4500);
  }
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, .25, 'triangle'), i * 160));
  render();
  const cpu = G.cpu[G.turn];
  $('#title').textContent = (cpu ? '🤖 ' : '') + NAMES[G.turn] + ' wins! 🎉';
  $('#sub').textContent = G.win == 1 ? 'First token home takes the win. Play again?' : 'All tokens made it home. Play again?';
  $('#startBtn').textContent = 'Play again';
  $('#closeBtn').classList.add('hide');
  $('#overlay').classList.remove('hide');
}

/* ---------- computer player ---------- */
function kick() {
  if (!isCpu()) return;
  const e = epoch;
  setTimeout(() => {
    if (e !== epoch || !isCpu()) return;
    if (G.phase == 'draw') draw();
    else if (G.phase == 'pick') cpuPick();
  }, (900 + Math.random() * 500) * spd);
}

function cpuPick() {
  let t;
  if (!G.lvl[G.turn]) t = G.tg[Math.random() * G.tg.length | 0];
  else t = G.tg.map(x => [score(x) + Math.random() * .5, x]).sort((a, b) => b[0] - a[0])[0][1];
  pick(t);
}

function score(t) {
  const c = G.card, me = G.turn;
  if (c.t == 'n' && c.v > 0) {
    if (t.prog < 0) return 8;
    const np = t.prog + c.v;
    let s = c.v * .2 + t.prog * .05;
    if (np == 56) s += 12;
    else if (np > 50) s += 6;
    else {
      const i = (off(t.p) + np) % 52;
      if (SAFE.has(i)) s += 4;
      if (BOOST.has(i) && np + 5 <= 50) s += 5;
      if (TRAP.has(i)) s -= 5;
      if (foes().some(o => ring(o) && idx(o) == i && !prot(o))) s += 9;
    }
    if (t.prog == 0) s += 1;
    return s;
  }
  if (c.t == 'n') return t.p == me ? -20 + t.prog * -.1 : t.prog * .3 + (t.prog > 40 ? 5 : 0);
  if (c.t == 'jail') return 1;
  if (c.t == 'elim') return t.prog;
  if (c.t == 'shield') {
    const threat = foes().some(o => ring(o) && ((idx(t) - idx(o) + 52) % 52) > 0 && ((idx(t) - idx(o) + 52) % 52) <= 6);
    return t.prog * .1 + (threat ? 4 : 0);
  }
  if (c.t == 'swap') {
    if (!G.src) {
      let g = -99;
      foes().forEach(o => { if (ring(o) && !prot(o) && swapOK(t, o)) g = Math.max(g, (idx(o) - off(t.p) + 52) % 52 - t.prog); });
      return g;
    }
    const a = G.src, mineGain = (idx(t) - off(a.p) + 52) % 52 - a.prog, foeGain = (idx(a) - off(t.p) + 52) % 52 - t.prog;
    return mineGain - foeGain * .5;
  }
  return 0;
}

/* ---------- render ---------- */
function pos(t) {
  if (t.prog < 0) return [JAIL[SEAT[t.p]][0] + 1.5 + (t.k >> 1) * 2, JAIL[SEAT[t.p]][1] + 1.5 + (t.k % 2) * 2, 'j' + t.p + t.k];
  const c = t.prog <= 50 ? PATH[idx(t)] : t.prog <= 55 ? HOME[SEAT[t.p]][t.prog - 51] : FIN[SEAT[t.p]];
  return [c[0], c[1], c.join()];
}

function render() {
  const groups = {}, human = !isCpu();
  all.forEach(t => { const [r, c, k] = pos(t); t.r = r; t.c = c; (groups[k] = groups[k] || []).push(t); });
  Object.values(groups).forEach(g => g.forEach((t, i) => {
    const o = (i - (g.length - 1) / 2) * .22;
    t.el.style.left = (t.c + .1 + o) * 100 / 15 + '%';
    t.el.style.top = (t.r + .1 + o) * 100 / 15 + '%';
    t.el.classList.toggle('go', human && G.phase == 'pick' && G.tg.includes(t));
    t.el.classList.toggle('shield', t.shield);
    t.el.classList.toggle('done', t.prog == 56);
  }));
  jailEls.forEach((e, q) => e.classList.toggle('active', G.phase != 'over' && q == SEAT[G.turn]));
  $('#players').innerHTML = Array.from({length:G.n}, (_, p) =>
    `${p ? '' : '<span class="dir">' + (G.dir > 0 ? '↻' : '↺') + '</span>'}<div class="chip ${p == G.turn ? 'on' : ''}" style="--col:${COLORS[p]}">${G.cpu[p] ? '🤖 ' : ''}${NAMES[p]} ${all.filter(t => t.p == p && t.prog == 56).length}/${G.t}</div>`).join('');
  $('#log').innerHTML = logs.map(l => `<li>${l}</li>`).join('');
  $('#drawBtn').disabled = G.phase != 'draw' || !human;
  $('#pile').classList.toggle('ready', G.phase == 'draw' && human);
  $('#left').textContent = G.dice ? 'Classic dice' : G.deck.length + ' cards left';
  $('#drawBtn').textContent = G.dice ? '🎲 Roll dice' : 'Draw a card';
  const ok = negOK(), n = $('#neg');
  n.classList.toggle('hide', !!G.dice);
  n.className = 'neg ' + (ok ? 'open' : 'locked') + (G.dice ? ' hide' : '');
  n.textContent = ok ? '⚠️ Negative cards active (-1, -2, -3)' : '🔒 Negatives unlock when every player passes square ' + NEG_UNLOCK;
}
const $ = s => document.querySelector(s);
const PATH = [[6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0]];
const HOME = [0,1,2,3].map(p => [1,2,3,4,5].map(i => [[7,i],[i,7],[7,14-i],[14-i,7]][p]));
const FIN = [[7,6],[6,7],[7,8],[8,7]];
const JAIL = [[0,0],[0,9],[9,9],[9,0]];
const PAL = [['#e4572e','Red'],['#2fa36b','Green'],['#f2b134','Gold'],['#3a7bd5','Blue'],['#8e44ad','Purple'],['#e84393','Pink'],['#17a2b8','Teal'],['#f57c00','Orange']];
let COLORS = [], NAMES = [], SEAT = [0,1,2,3], spd = 1;   // per-player colour/name; SEAT maps player -> board corner
const off = p => 13 * SEAT[p];
const TYPES = ['Off','Human','Easy CPU','Smart CPU'];
const SAFE = new Set([0,8,13,21,26,34,39,47]);
const BOOST = new Set([4,17,30,43]), TRAP = new Set([11,24,37,50]);
const NEG_UNLOCK = 5;   // every player's lead token must be past this square before negatives appear
const INFO = {
  jail:['🔓','Jailbreak','Free one token'], swap:['🔄','Swap','Trade places with a rival'],
  skip:['⛔','Skip','Next player loses a turn'], rep:['🔁','Repeat','Play another turn'],
  elim:['💥','Eliminate','Send a rival to jail'], shield:['🛡️','Shield','Protect a token'],
  rev:['🔃','Reverse','Flip turn order'], quake:['🌋','Quake','Everyone slides back 3']
};
const cfg = {t:4, mode:0, sp:0, win:0, bon:1, seats:[{type:1,col:0,name:''},{type:3,col:1,name:''},{type:0,col:2,name:''},{type:0,col:3,name:''}]};
try { Object.assign(cfg, JSON.parse(localStorage.getItem('cc-cfg') || '{}')); } catch (e) {}
let G = null, all = [], logs = [], audio, muted = false, epoch = 0, cardId = 0, jailEls = [];
const ABORT = {};
// sleep aborts when the game is restarted so old async chains die quietly
const sleep = ms => { const e = epoch; return new Promise((res, rej) => setTimeout(() => e === epoch ? res() : rej(ABORT), ms * spd)); };
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { if (e !== ABORT) throw e; } };

function beep(f, d = .08, ty = 'sine') {
  if (muted) return;
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = ty; o.frequency.value = f; g.gain.value = .05;
    o.connect(g); g.connect(audio.destination); o.start();
    g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + d); o.stop(audio.currentTime + d);
  } catch (e) {}
}
function toast(m) { const e = $('#toast'); e.textContent = m; e.style.animation = 'none'; e.offsetWidth; e.style.animation = ''; }
function shake() { const b = $('#board'); b.classList.remove('shake'); b.offsetWidth; b.classList.add('shake'); }
$('#mute').onclick = e => { muted = !muted; e.target.textContent = muted ? '🔇' : '🔊'; };

/* ---------- menu / settings ---------- */
const pname = i => cfg.seats[i].name.trim() || PAL[cfg.seats[i].col][1];
function syncSeg() {
  document.querySelectorAll('.seg[data-key]').forEach(seg => seg.querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', +b.dataset.v === +cfg[seg.dataset.key])));
  const cnt = ty => cfg.seats.filter(s => ty(s.type)).length;
  const h = cnt(t => t == 1), c = cnt(t => t >= 2);
  document.querySelectorAll('.seg[data-grp]').forEach(seg => seg.querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', +b.dataset.v === (seg.dataset.grp == 'h' ? h : c))));
  $('#seats').innerHTML = cfg.seats.map((s, i) => `<div class="seat ${s.type ? '' : 'offseat'}" style="--col:${PAL[s.col][0]}">
    <div class="shead"><b>P${i + 1}</b><input maxlength="10" data-i="${i}" placeholder="${PAL[s.col][1]}" value="${s.name.replace(/"/g, '')}">
    <div class="seg types">${TYPES.map((n, v) => `<button data-i="${i}" data-ty="${v}" class="${s.type == v ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    <div class="sw">${PAL.map((p, c) => `<button class="swatch ${s.col == c ? 'on' : ''}" data-i="${i}" data-c="${c}" style="--col:${p[0]}" title="${p[1]}" aria-label="${p[1]}"></button>`).join('')}</div></div>`).join('');
  const act = cnt(t => t > 0);
  $('#startBtn').disabled = act < 2;
  $('#warn').textContent = act < 2 ? 'Pick at least 2 players' : act + ' players: ' + cfg.seats.map((s, i) => s.type ? (s.type > 1 ? '🤖 ' : '') + pname(i) : '').filter(Boolean).join(', ');
  $('#lvl').textContent = cfg.mode ? '🎲 Roll the dice. A 6 frees a token and gives another roll.' : '🃏 Draw cards: power-ups, attacks, swaps and more.';
}
document.querySelectorAll('.seg[data-key]').forEach(seg => seg.onclick = e => {
  if (e.target.tagName != 'BUTTON') return;
  cfg[seg.dataset.key] = +e.target.dataset.v;
  syncSeg();
});
document.querySelectorAll('.seg[data-grp]').forEach(seg => seg.onclick = e => {
  if (e.target.tagName != 'BUTTON') return;
  let h = +$('.seg[data-grp=h] .on').dataset.v, c = +$('.seg[data-grp=c] .on').dataset.v;
  const v = +e.target.dataset.v;
  if (seg.dataset.grp == 'h') { h = v; if (h + c > 4) c = 4 - h; } else { c = v; if (h + c > 4) h = 4 - c; }
  cfg.seats.forEach((s, i) => s.type = i < h ? 1 : i < h + c ? 3 : 0);
  syncSeg();
});
$('#seats').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const i = +b.dataset.i;
  if (b.dataset.ty != null) cfg.seats[i].type = +b.dataset.ty;
  else if (b.dataset.c != null) {   // colours stay unique: swap with whoever holds it
    const c = +b.dataset.c, o = cfg.seats.findIndex((s, j) => j != i && s.col == c);
    if (o >= 0) cfg.seats[o].col = cfg.seats[i].col;
    cfg.seats[i].col = c;
  }
  syncSeg();
});
$('#seats').addEventListener('input', e => { if (e.target.tagName == 'INPUT') cfg.seats[+e.target.dataset.i].name = e.target.value; });
$('#shuffleCol').onclick = () => {
  const cols = shuffle(PAL.map((_, i) => i)); cfg.seats.forEach((s, i) => s.col = cols[i]); syncSeg();
};
function openMenu(over) {
  const live = G && G.phase != 'over';
  $('#title').textContent = over ? $('#title').textContent : 'Chrono Clash';
  if (!over) {
    $('#sub').textContent = live ? 'Starting a new game replaces the current one.' : 'The classic Ludo race, with a twist of time.';
    $('#startBtn').textContent = live ? 'New game' : '▶ Start game';
  }
  $('#closeBtn').classList.toggle('hide', !live);
  syncSeg();
  $('#overlay').classList.remove('hide');
}
$('#startBtn').onclick = start;
$('#closeBtn').onclick = () => $('#overlay').classList.add('hide');
$('#menu').onclick = () => openMenu(false);
$('#restart').onclick = () => {
  if (!G) return start();
  if (G.phase == 'over' || confirm('Restart the game with the same settings?')) start();
};
$('#drawBtn').onclick = () => { if (!isCpu()) draw(); };
$('#pile').onclick = () => { if (G && G.phase == 'draw' && !isCpu()) draw(); };
syncSeg();

/* ---------- board ---------- */
function box(cls, x, y, w, h, p) {
  const d = document.createElement('div');
  d.className = cls;
  Object.assign(d.style, {left:x*100/15+'%', top:y*100/15+'%', width:w*100/15+'%', height:h*100/15+'%'});
  if (p != null) d.style.setProperty('--col', p);
  return d;
}

function buildBoard() {
  const b = $('#board');
  b.innerHTML = '';
  const sc = q => { const p = SEAT.indexOf(q); return p < 0 ? '#8a929b' : COLORS[p]; };
  jailEls = JAIL.map((j, q) => { const e = box('jail' + (SEAT.includes(q) ? '' : ' unused'), j[1], j[0], 6, 6, sc(q)); b.append(e); return e; });
  b.append(box('center', 6, 6, 3, 3));
  PATH.forEach((c, i) => {
    const st = i % 13 == 0;
    const d = box('cell' + (st ? ' start' : '') + (SAFE.has(i) ? ' safe' : '') + (BOOST.has(i) ? ' boost' : '') + (TRAP.has(i) ? ' trap' : ''), c[1], c[0], 1, 1, st ? sc(i / 13) : null);
    b.append(d);
  });
  HOME.forEach((h, q) => h.forEach(c => b.append(box('cell home', c[1], c[0], 1, 1, sc(q)))));
}

/* ---------- deck ---------- */
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function mkDeck() {
  const d = [];
  for (let v = 1; v <= 9; v++) d.push({t:'n', v}, {t:'n', v});
  for (let v = 1; v <= 3; v++) d.push({t:'n', v:-v}, {t:'n', v:-v}, {t:'n', v:-v});   // only -1, -2, -3 exist
  [['jail',8],['swap',3],['skip',3],['rep',3],['elim',3],['shield',3],['rev',2],['quake',2]].forEach(([t, n]) => { while (n--) d.push({t}); });
  return shuffle(d);
}
// negatives are only dealt once EVERY player has a token beyond square 5
const best = p => Math.max(-1, ...all.filter(t => t.p == p).map(t => t.prog));
const negOK = () => Array.from({length:G.n}, (_, p) => best(p)).every(b => b > NEG_UNLOCK);
function nextCard() {
  if (G.dice) return {t:'n', v:1 + (Math.random() * 6 | 0), dice:true};
  const ok = negOK(), held = [];
  for (;;) {
    if (!G.deck.length) G.deck = mkDeck();
    const c = G.deck.pop();
    if (c.t == 'n' && c.v < 0 && !ok) { held.push(c); continue; }
    G.deck.unshift(...held);
    return c;
  }
}

/* ---------- card visuals ---------- */
const BACK = '<div class="face back"><div class="logo"><span>⏳</span>CHRONO CLASH</div></div>';
function setCard(front, kind) {
  const e = $('#card');
  e.className = 'card' + (kind ? ' k-' + kind + ' deal' : '');
  e.innerHTML = `<div class="tilt"><div class="inner">${BACK}${front || ''}</div></div>`;
  return e;
}
function resetCard() { cardId++; setCard(); }
function frontHTML(c) {
  let k, corner, center, ttl, sub;
  if (c.t == 'n') {
    const up = c.v > 0;
    k = up ? 'plus' : 'minus'; corner = label(c);
    center = `<div class="num">${label(c)}</div><div class="arrow">${up ? '▲' : '▼'}</div>`;
    ttl = up ? 'Move forward' : 'Push back';
    sub = up ? 'Advance one of your tokens' : "Hit any token, even yours";
    if (c.dice) { corner = '🎲'; center = `<div class="num">${c.v}</div><div class="arrow">🎲</div>`; ttl = 'Dice roll'; sub = c.v == 6 ? 'Six! Frees a token, roll again' : 'Move a token'; }
  } else {
    const [i, n, d] = INFO[c.t];
    k = c.t; corner = i; center = `<div class="ico">${i}</div>`; ttl = n; sub = d;
  }
  const sparks = Array.from({length:7}, () => `<i style="--x:${8 + Math.random() * 84}%;--y:${8 + Math.random() * 84}%;--d:${(Math.random() * 1.8).toFixed(2)}s"></i>`).join('');
  return [k, `<div class="face front"><div class="grid"></div><div class="sparks">${sparks}</div><span class="corner tl">${corner}</span><span class="corner br">${corner}</span>${center}<div class="ttl">${ttl}</div><small>${sub}</small><div class="holo"></div></div>`];
}
function show(c) {
  const [k, html] = frontHTML(c), id = ++cardId;
  const e = setCard(html, k);
  beep(300, .05, 'triangle');
  setTimeout(() => { if (id === cardId) { e.classList.add('flipped'); beep(520, .09, 'triangle'); } }, 260);
}
// 3D tilt that follows the pointer
(() => {
  const e = $('#card');
  e.addEventListener('pointermove', ev => {
    const t = e.querySelector('.tilt'); if (!t) return;
    const r = e.getBoundingClientRect();
    t.style.setProperty('--ry', ((ev.clientX - r.left) / r.width - .5) * 26 + 'deg');
    t.style.setProperty('--rx', (.5 - (ev.clientY - r.top) / r.height) * 26 + 'deg');
  });
  e.addEventListener('pointerleave', () => { const t = e.querySelector('.tilt'); if (t) { t.style.setProperty('--rx', '0deg'); t.style.setProperty('--ry', '0deg'); } });
})();

/* ---------- game setup ---------- */
function start() {
  const act = cfg.seats.map((x, i) => i).filter(i => cfg.seats[i].type > 0);
  if (act.length < 2) return;
  epoch++;
  spd = [1, .5, .25][cfg.sp] || 1;
  try { localStorage.setItem('cc-cfg', JSON.stringify(cfg)); } catch (e) {}
  document.querySelectorAll('.conf').forEach(c => c.remove());
  const n = act.length;
  SEAT = n == 2 ? [0, 2] : n == 3 ? [0, 1, 2] : [0, 1, 2, 3];
  COLORS = act.map(i => PAL[cfg.seats[i].col][0]);
  NAMES = act.map(i => pname(i));
  buildBoard();
  all = [];
  for (let p = 0; p < n; p++) for (let k = 0; k < cfg.t; k++) {
    const t = {p, k, prog:-1, shield:false, el:document.createElement('div')};
    t.el.className = 'token';
    t.el.style.setProperty('--col', COLORS[p]);
    t.el.onclick = () => { if (!isCpu()) pick(t); };
    $('#board').append(t.el);
    all.push(t);
  }
  const ty = act.map(i => cfg.seats[i].type);
  G = {n, t:cfg.t, turn:0, deck:mkDeck(), card:null, phase:'wait', tg:[], skip:[], dir:1, tries:1, src:null,
       cpu:ty.map(x => x >= 2), lvl:ty.map(x => x == 3 ? 1 : 0), neg:false, dice:cfg.mode == 1, win:cfg.win, bon:cfg.bon};
  logs = [];
  resetCard();
  $('#overlay').classList.add('hide');
  startTurn();
}

const isCpu = () => !!(G && G.cpu && G.cpu[G.turn] && G.phase != 'over');
const mine = () => all.filter(t => t.p == G.turn);
const foes = () => all.filter(t => t.p != G.turn);
const ring = t => t.prog >= 0 && t.prog <= 50;
const idx = t => (off(t.p) + t.prog) % 52;
const prot = t => !ring(t) || SAFE.has(idx(t)) || t.shield || all.some(o => o !== t && o.p == t.p && o.prog == t.prog);
const swapOK = (a, b) => (idx(b) - off(a.p) + 52) % 52 <= 50 && (idx(a) - off(b.p) + 52) % 52 <= 50;
const label = c => c.t == 'n' ? (c.v > 0 ? '+' + c.v : '' + c.v) : INFO[c.t][1];

function say(m) { logs.unshift(m); logs.length = Math.min(logs.length, 4); }
function hint(m) {
  $('#hint').textContent = isCpu() ? `🤖 ${NAMES[G.turn]} (computer) is playing…` : m;
}

function targets() {
  const c = G.card, m = mine(), f = foes();
  if (c.t == 'n') return c.v > 0
    ? m.filter(t => t.prog >= 0 ? t.prog + c.v <= 56 : (c.dice && c.v == 6))
    : m.filter(t => t.prog >= 1 && t.prog < 56).concat(f.filter(t => t.prog >= 1 && !prot(t)));
  if (c.t == 'jail') return m.filter(t => t.prog < 0);
  if (c.t == 'elim') return f.filter(t => ring(t) && !prot(t));
  if (c.t == 'shield') return m.filter(t => ring(t) && t.prog > 0 && !t.shield);
  if (c.t == 'swap') return G.src
    ? f.filter(t => ring(t) && !prot(t) && swapOK(G.src, t))
    : m.filter(t => ring(t) && f.some(o => ring(o) && !prot(o) && swapOK(t, o)));
  return [];
}

/* ---------- turn flow ---------- */
function startTurn() {
  mine().forEach(t => t.shield = false);
  G.src = null;
  G.tries = mine().some(t => t.prog >= 0 && t.prog < 56) ? 1 : 3;
  G.phase = 'draw';
  const ok = !G.dice && negOK();
  if (ok !== G.neg) {
    G.neg = ok;
    toast(ok ? '⚠️ Negative cards unlocked' : '🔒 Negative cards locked');
    beep(ok ? 220 : 440, .25, 'square');
  }
  hint(NAMES[G.turn] + (G.dice ? ', roll the dice' : ', draw a card') + (G.tries > 1 ? (G.dice ? ' (3 tries to roll a 6)' : ' (3 tries to find a Jailbreak)') : ''));
  render();
  kick();
}

function endTurn(extra) {
  const e = epoch;
  G.phase = 'wait';
  render();
  setTimeout(() => {
    if (e !== epoch) return;
    if (!extra) {
      let s = true;
      while (s) {
        G.turn = (G.turn + G.dir + G.n) % G.n;
        s = G.skip[G.turn];
        if (s) { G.skip[G.turn] = false; say(NAMES[G.turn] + ' skips a turn'); }
      }
    }
    startTurn();
  }, 1000 * spd);
}

function draw() {
  if (!G || G.phase != 'draw') return;
  const c = G.card = nextCard();
  show(c);
  const me = NAMES[G.turn];
  if (c.t == 'skip') {
    const nx = (G.turn + G.dir + G.n) % G.n;
    G.skip[nx] = true;
    say(`${me} played Skip: ${NAMES[nx]} loses a turn`);
    return endTurn(false);
  }
  if (c.t == 'rep') { say(`${me} gets another turn`); return endTurn(true); }
  if (c.t == 'rev') { G.dir *= -1; say(`${me} reversed the order`); toast('🔃 Reverse!'); beep(380,.2); return endTurn(false); }
  if (c.t == 'quake') { say(`${me} caused a quake!`); return quake(); }
  G.tg = targets();
  if (!G.tg.length) {
    G.tries--;
    say(`${me} drew ${label(c)}: no legal move`);
    if (G.tries > 0) { G.phase = 'draw'; hint('No legal move. Draw again'); render(); kick(); }
    else endTurn(false);
    return;
  }
  G.phase = 'pick';
  const tips = {
    jail:'Tap a jailed token to free it', elim:'Tap a rival token to send it to jail',
    shield:'Tap your token to shield it', swap:'Tap your token, then a rival to swap places'
  };
  hint(c.t == 'n'
    ? (c.v > 0 ? `Tap a glowing token to move it ${c.v}` : `Tap a glowing token to push it back ${-c.v}: yours or a rival's`)
    : tips[c.t]);
  render();
  kick();
}

function hop(t) { t.el.classList.remove('hop'); t.el.offsetWidth; t.el.classList.add('hop'); }

async function walk(t, np) {
  const d = np > t.prog ? 1 : -1;
  while (t.prog != np) { t.prog += d; hop(t); render(); beep(260 + t.prog * 7, .05); await sleep(140); }
}

async function kill(o) {
  const [r, c] = pos(o), d = document.createElement('div');
  d.className = 'burst';
  d.style.left = (c + .5) * 100 / 15 + '%'; d.style.top = (r + .5) * 100 / 15 + '%';
  d.style.setProperty('--col', COLORS[o.p]);
  d.innerHTML = Array.from({length:8}, (_, i) => `<i style="--a:${i * 45}deg"></i>`).join('');
  $('#board').append(d); shake(); beep(150, .35, 'sawtooth');
  setTimeout(() => d.remove(), 700);
  o.el.classList.add('die'); await sleep(450);
  o.prog = -1; o.el.classList.remove('die'); render();
}

async function move(t, np) {
  await walk(t, np);
  let bonus = false;
  if (ring(t)) {
    const i = idx(t);
    if (BOOST.has(i) && t.prog + 5 <= 50) { toast('⚡ Boost +5'); beep(800, .2); await sleep(300); await walk(t, t.prog + 5); }
    else if (TRAP.has(i) && t.prog > 1) { toast('🕳️ Trap! Back 4'); beep(120, .3, 'square'); await sleep(300); await walk(t, Math.max(t.prog - 4, 1)); }
  }
  if (ring(t) && !SAFE.has(idx(t))) {
    const v = foes().filter(o => ring(o) && idx(o) == idx(t) && !prot(o));
    for (const o of v) { say(`${NAMES[t.p]} captured a ${NAMES[o.p]} token!`); await kill(o); }
    if (v.length) { toast('💥 Captured! Bonus turn'); bonus = true; }
  }
  if (t.prog == 56) { toast('🏠 Home! Bonus turn'); say(`${NAMES[t.p]} token reached home!`); beep(660, .3); bonus = true; }
  return bonus;
}

const quake = guard(async () => {
  G.phase = 'wait'; toast('🌋 Quake! Everyone back 3'); shake(); beep(90, .6, 'sawtooth');
  await sleep(500);
  all.filter(t => ring(t) && t.prog > 1 && !prot(t)).forEach(t => t.prog = Math.max(t.prog - 3, 1));
  render(); await sleep(700);
  endTurn(false);
});

const pick = guard(async t => {
  if (!G || G.phase != 'pick' || !G.tg.includes(t)) return;
  const c = G.card, me = NAMES[G.turn];
  let bonus = false;
  if (c.t == 'swap' && !G.src) { G.src = t; G.tg = targets(); hint('Now tap a rival to swap with'); render(); kick(); return; }
  G.phase = 'wait'; G.tg = []; render();
  if (c.t == 'n') {
    const np = t.prog < 0 ? 0 : Math.max(t.prog + c.v, 0);
    if (t.p == G.turn) bonus = await move(t, np);
    else { await walk(t, np); say(`${me} pushed a ${NAMES[t.p]} token back ${-c.v}`); }
  } else if (c.t == 'jail') {
    t.prog = 0; hop(t); beep(520, .2); toast('🔓 Jailbreak!'); say(`${me} broke a token out of jail!`); render(); await sleep(600);
  } else if (c.t == 'elim') {
    say(`${me} sent a ${NAMES[t.p]} token to jail`); await kill(t);
  } else if (c.t == 'shield') {
    t.shield = true; toast('🛡️ Shielded'); beep(700, .15); say(`${me} shielded a token`); render(); await sleep(500);
  } else if (c.t == 'swap') {
    const a = G.src, pa = (idx(t) - off(a.p) + 52) % 52, pb = (idx(a) - off(t.p) + 52) % 52;
    a.prog = pa; t.prog = pb; G.src = null; toast('🔄 Swap!'); beep(440, .2);
    say(`${me} swapped places with ${NAMES[t.p]}`); render(); await sleep(700);
  }
  if (G.win == 1 ? mine().some(x => x.prog == 56) : mine().every(x => x.prog == 56)) return win();
  endTurn((bonus && G.bon) || (c.dice && c.v == 6 && t.p == G.turn));
});

function win() {
  G.phase = 'over';
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('i');
    c.className = 'conf';
    c.style.cssText = `left:${Math.random() * 100}vw;background:${COLORS[i % COLORS.length]};animation-delay:${Math.random()}s`;
    document.body.append(c); setTimeout(() => c.remove(), 4500);
  }
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, .25, 'triangle'), i * 160));
  render();
  const cpu = G.cpu[G.turn];
  $('#title').textContent = (cpu ? '🤖 ' : '') + NAMES[G.turn] + ' wins! 🎉';
  $('#sub').textContent = G.win == 1 ? 'First token home takes the win. Play again?' : 'All tokens made it home. Play again?';
  $('#startBtn').textContent = 'Play again';
  $('#closeBtn').classList.add('hide');
  $('#overlay').classList.remove('hide');
}

/* ---------- computer player ---------- */
function kick() {
  if (!isCpu()) return;
  const e = epoch;
  setTimeout(() => {
    if (e !== epoch || !isCpu()) return;
    if (G.phase == 'draw') draw();
    else if (G.phase == 'pick') cpuPick();
  }, (900 + Math.random() * 500) * spd);
}

function cpuPick() {
  let t;
  if (!G.lvl[G.turn]) t = G.tg[Math.random() * G.tg.length | 0];
  else t = G.tg.map(x => [score(x) + Math.random() * .5, x]).sort((a, b) => b[0] - a[0])[0][1];
  pick(t);
}

function score(t) {
  const c = G.card, me = G.turn;
  if (c.t == 'n' && c.v > 0) {
    if (t.prog < 0) return 8;
    const np = t.prog + c.v;
    let s = c.v * .2 + t.prog * .05;
    if (np == 56) s += 12;
    else if (np > 50) s += 6;
    else {
      const i = (off(t.p) + np) % 52;
      if (SAFE.has(i)) s += 4;
      if (BOOST.has(i) && np + 5 <= 50) s += 5;
      if (TRAP.has(i)) s -= 5;
      if (foes().some(o => ring(o) && idx(o) == i && !prot(o))) s += 9;
    }
    if (t.prog == 0) s += 1;
    return s;
  }
  if (c.t == 'n') return t.p == me ? -20 + t.prog * -.1 : t.prog * .3 + (t.prog > 40 ? 5 : 0);
  if (c.t == 'jail') return 1;
  if (c.t == 'elim') return t.prog;
  if (c.t == 'shield') {
    const threat = foes().some(o => ring(o) && ((idx(t) - idx(o) + 52) % 52) > 0 && ((idx(t) - idx(o) + 52) % 52) <= 6);
    return t.prog * .1 + (threat ? 4 : 0);
  }
  if (c.t == 'swap') {
    if (!G.src) {
      let g = -99;
      foes().forEach(o => { if (ring(o) && !prot(o) && swapOK(t, o)) g = Math.max(g, (idx(o) - off(t.p) + 52) % 52 - t.prog); });
      return g;
    }
    const a = G.src, mineGain = (idx(t) - off(a.p) + 52) % 52 - a.prog, foeGain = (idx(a) - off(t.p) + 52) % 52 - t.prog;
    return mineGain - foeGain * .5;
  }
  return 0;
}

/* ---------- render ---------- */
function pos(t) {
  if (t.prog < 0) return [JAIL[SEAT[t.p]][0] + 1.5 + (t.k >> 1) * 2, JAIL[SEAT[t.p]][1] + 1.5 + (t.k % 2) * 2, 'j' + t.p + t.k];
  const c = t.prog <= 50 ? PATH[idx(t)] : t.prog <= 55 ? HOME[SEAT[t.p]][t.prog - 51] : FIN[SEAT[t.p]];
  return [c[0], c[1], c.join()];
}

function render() {
  const groups = {}, human = !isCpu();
  all.forEach(t => { const [r, c, k] = pos(t); t.r = r; t.c = c; (groups[k] = groups[k] || []).push(t); });
  Object.values(groups).forEach(g => g.forEach((t, i) => {
    const o = (i - (g.length - 1) / 2) * .22;
    t.el.style.left = (t.c + .1 + o) * 100 / 15 + '%';
    t.el.style.top = (t.r + .1 + o) * 100 / 15 + '%';
    t.el.classList.toggle('go', human && G.phase == 'pick' && G.tg.includes(t));
    t.el.classList.toggle('shield', t.shield);
    t.el.classList.toggle('done', t.prog == 56);
  }));
  jailEls.forEach((e, q) => e.classList.toggle('active', G.phase != 'over' && q == SEAT[G.turn]));
  $('#players').innerHTML = Array.from({length:G.n}, (_, p) =>
    `${p ? '' : '<span class="dir">' + (G.dir > 0 ? '↻' : '↺') + '</span>'}<div class="chip ${p == G.turn ? 'on' : ''}" style="--col:${COLORS[p]}">${G.cpu[p] ? '🤖 ' : ''}${NAMES[p]} ${all.filter(t => t.p == p && t.prog == 56).length}/${G.t}</div>`).join('');
  $('#log').innerHTML = logs.map(l => `<li>${l}</li>`).join('');
  $('#drawBtn').disabled = G.phase != 'draw' || !human;
  $('#pile').classList.toggle('ready', G.phase == 'draw' && human);
  $('#left').textContent = G.dice ? 'Classic dice' : G.deck.length + ' cards left';
  $('#drawBtn').textContent = G.dice ? '🎲 Roll dice' : 'Draw a card';
  const ok = negOK(), n = $('#neg');
  n.classList.toggle('hide', !!G.dice);
  n.className = 'neg ' + (ok ? 'open' : 'locked') + (G.dice ? ' hide' : '');
  n.textContent = ok ? '⚠️ Negative cards active (-1, -2, -3)' : '🔒 Negatives unlock when every player passes square ' + NEG_UNLOCK;
}
