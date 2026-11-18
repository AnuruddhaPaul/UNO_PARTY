'use strict';
const COLORS = ['red', 'yellow', 'green', 'blue'];
const CNAME = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' };
let META = { house: {}, max: 15 };
let S = null;                 // latest game state from server
let ws = null, wantOpen = false, retry = 0;
let session = JSON.parse(localStorage.getItem('uno.session') || 'null');
let selIds = [];             // selected card ids in hand (more than one = combo)
let lastHold = 0, recvAt = 0, lastSeq;   // press-and-hold timestamp, state arrival time, last event shown
let pick = null;              // {card,color,target}
let prevTurn = null, spyHidden = null;
let curRects = {}, curPrev = null, flownSeq = 0;   // pre-render hand positions, previous state
let dealing = null, dealtRound = 0;       // the shuffle-and-deal intro in progress

const $ = (id) => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in (attrs || {})) {
    if (attrs[k] == null || attrs[k] === false) continue;
    if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else if (k === 'style') e.style.cssText = attrs[k];
    else if (k === 'innerHTML') e.innerHTML = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((c) => c != null && c !== false).map((c) => (c.nodeType ? c : document.createTextNode(String(c)))));
function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms); }
function show(id) { for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === id); }
const overlay = (id, on) => $(id).classList.toggle('on', on);

// ---------- network ----------
function connect(then) {
  wantOpen = true;
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) { if (ws.readyState === 1 && then) then(); else if (then) ws.addEventListener('open', then, { once: true }); return; }
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => {
    retry = 0; $('recon').classList.remove('on');
    if (session) tx({ t: 'join', code: session.code, pid: session.pid, token: session.token, name: myName() });
    if (then) then();
  };
  ws.onmessage = (ev) => onMsg(JSON.parse(ev.data));
  ws.onclose = () => {
    if (!wantOpen) return;
    $('recon').classList.add('on');
    setTimeout(() => connect(), Math.min(1000 * 2 ** retry++, 6000));
  };
}
const tx = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
setInterval(() => tx({ t: 'ping' }), 25000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && wantOpen && (!ws || ws.readyState > 1)) connect(); });

function onMsg(m) {
  if (m.t === 'joined') {
    session = { code: m.code, pid: m.pid, token: m.token };
    localStorage.setItem('uno.session', JSON.stringify(session));
    history.replaceState(null, '', '?room=' + m.code); lastSeq = undefined;
  } else if (m.t === 'state') {
    const prev = S, rects = {};
    if (prev) document.querySelectorAll('#hand .card').forEach((el) => { rects[el.dataset.id] = el.getBoundingClientRect(); });
    curRects = rects; curPrev = prev;
    S = m; recvAt = performance.now();
    const dealNew = maybeDeal(prev);
    render(); keepAwake();
    if (dealNew) runDeal(dealNew);
    else { const sp = (m.events || []).filter((e) => (e.seq > (flownSeq || 0)) && ['swap', 'rotate', 'shuffle'].includes(e.type)).pop(); if (m.events && m.events.length) flownSeq = m.events[m.events.length - 1].seq; try { flyDiff(prev, m, rects, sp ? { by: sp.by || sp.a } : null); } catch (e) { /* animations are decoration only */ } }
  }
  else if (m.t === 'react') { showReaction(m.pid, m.e); }
  else if (m.t === 'error') {
    toast(m.msg);
    if (m.code === 'noroom') { session = null; localStorage.removeItem('uno.session'); S = null; paintScene(false); show('home'); }
  } else if (m.t === 'kicked' || m.t === 'left') { leaveLocal(); if (m.t === 'kicked') toast('You were removed from the room.'); }
}
function leaveLocal() { evQ = []; evBusy = false; dealing = null; session = null; S = null; selIds = []; lastSeq = undefined; localStorage.removeItem('uno.session'); history.replaceState(null, '', location.pathname); overlay('ovEnd', false); overlay('ovMenu', false); paintScene(false); show('home'); }

// ---------- cards ----------
function sym(c) {
  switch (c.type) { case 'num': return String(c.value); case 'skip': return '⊘'; case 'reverse': return '⇄'; case 'draw2': return '+2'; case 'wild': return 'W'; case 'wild4': return '+4'; case 'house': return (META.house[c.house] || {}).icon || '★'; }
}
function cardEl(c, o = {}) {
  const cls = ['card', c.type === 'house' ? 'house' : c.type.startsWith('wild') ? 'wild' : c.color];
  if (o.dim) cls.push('dim'); if (o.sel) cls.push('sel'); if (o.drawn) cls.push('drawn');
  const s = sym(c), small = c.type === 'house' || c.type === 'wild' ? '' : s;
  const e = h('div', { class: cls.join(' '), 'data-id': c.id },
    small && h('span', { class: 'c a' }, small), h('span', { class: 'm' }, s), small && h('span', { class: 'c b' }, small),
    c.type === 'house' && h('span', { class: 'nm' }, (META.house[c.house] || {}).name || ''));
  if (o.dot) e.append(h('i', { class: 'dot', style: `background:var(--${o.dot})` }));
  if (o.info !== false) bindHold(e, c);
  return e;
}
const backEl = () => h('div', { class: 'card back' });
function cardName(c) {
  if (c.type === 'house') return (META.house[c.house] || {}).name;
  const col = c.color ? CNAME[c.color] + ' ' : '';
  return c.type === 'num' ? col + c.value : { skip: col + 'Skip', reverse: col + 'Reverse', draw2: col + '+2', wild: 'Wild', wild4: 'Wild +4' }[c.type];
}
function cardDesc(c) {
  if (c.type === 'house') return META.house[c.house].desc;
  return { num: 'Match the color or the number.', skip: 'Next player loses their turn.', reverse: 'Turn order flips (acts as Skip with 2 players).', draw2: 'Next player draws 2 and loses their turn.', wild: 'Play any time and choose the color.', wild4: S && S.settings.challenges ? 'You choose the color. Next player draws 4 and loses their turn, unless they challenge: if you held a card of the color in play you draw 4 instead, if you were honest they draw 6.' : 'Next player draws 4 and loses their turn. You choose the color.' }[c.type];
}
const needsColor = (c) => c.type === 'wild' || c.type === 'wild4' || c.type === 'house';
const needsTarget = (c) => c.type === 'house' && META.house[c.house].needs === 'target';
const colorIdx = (c) => (c.color ? COLORS.indexOf(c.color) : 9);
const ORDER = { num: 0, skip: 1, reverse: 2, draw2: 3, wild: 4, wild4: 5, house: 6 };

// ---------- render ----------
function render() {
  if (!S) return;
  const me = S.players.find((p) => p.id === S.you);
  const evs = S.events || (S.event ? [S.event] : []);
  if (lastSeq === undefined) lastSeq = evs.length ? evs[evs.length - 1].seq : 0;
  else for (const e of evs) if (e.seq > lastSeq) { lastSeq = e.seq; queueEvent(e); }
  if (S.phase === 'lobby') { paintScene(false); show('lobby'); overlay('ovEnd', false); overlay('ovChallenge', false); renderLobby(); }
  else { show('table'); renderTable(me); }
}

const ALLH = () => Object.keys(META.house);
const PRESETS = [
  { icon: '🎴', name: 'Classic', desc: 'Plain UNO', set: () => ({ stacking: false, combos: false, challenges: false, drawUntil: false, houseCards: [], handSize: 7, timer: 0 }) },
  { icon: '🎉', name: 'Party', desc: 'The default mix', set: () => ({ stacking: false, combos: true, challenges: true, drawUntil: true, houseCards: ALLH(), handSize: 7, timer: 30 }) },
  { icon: '🌪️', name: 'Chaos', desc: 'Everything on', set: () => ({ stacking: true, combos: true, challenges: true, drawUntil: true, houseCards: ALLH(), handSize: 10, timer: 15 }) },
  { icon: '⚡', name: 'Quick', desc: 'Short rounds', set: () => ({ stacking: false, combos: true, challenges: false, drawUntil: true, houseCards: ['sniper', 'groupdraw', 'encore', 'doubleskip', 'colorlock'].filter((k) => META.house[k]), handSize: 5, timer: 15 }) },
];
function paintQR() {
  const box = $('qrBox'); if (!box || !session || typeof qrcode === 'undefined') return;
  const url = `${location.origin}/?room=${session.code}`;
  if (box.dataset.url === url) return; box.dataset.url = url;
  try { const q = qrcode(0, 'M'); q.addData(url); q.make(); box.innerHTML = q.createSvgTag({ cellSize: 5, margin: 3, scalable: true }); } catch (e) { box.textContent = ''; }
}
function toggleRow(title, desc, on, fn, ro) {
  return h('div', { class: 'tog' + (ro ? ' ro' : ''), onclick: ro ? null : fn }, h('div', { class: 't' }, h('b', {}, title), h('span', {}, desc)), h('div', { class: 'sw' + (on ? ' on' : '') }));
}

function renderLobby() {
  const isHost = S.host === S.you, set = S.settings;
  $('lcode').textContent = session ? session.code : '';
  paintQR();
  $('pcount').textContent = `(${S.players.length}/${S.max})`;
  const pl = $('plist'); pl.replaceChildren(...S.players.map((p) => h('div', { class: 'pl' },
    (() => { const a = avatarEl(p.avatar); if (p.id === S.you) { a.classList.add('mine'); a.onclick = () => pickAvatar(); } return a; })(),
    h('span', { class: 'nm' }, (p.id === S.host ? '👑 ' : p.bot ? '🤖 ' : '') + p.name + (p.id === S.you ? ' (you)' : '')),
    !p.connected && h('small', {}, 'offline'), p.wins > 0 && h('small', {}, `🏆 ${p.wins}`),
    isHost && p.id !== S.you && h('button', { onclick: () => tx({ t: 'kick', pid: p.id }) }, 'Remove'))));
  $('botrow').style.display = isHost ? '' : 'none';
  const rb = $('rulebody'), ro = !isHost;
  const send = (o) => tx({ t: 'settings', ...o });
  const house = Object.entries(META.house);
  rb.replaceChildren(
    h('div', { class: 'lbl' }, 'Quick setups' + (ro ? ' (host picks)' : '')),
    h('div', { class: 'presets' + (ro ? ' ro' : '') }, PRESETS.map((p) => h('button', { onclick: () => !ro && send(p.set()) }, h('b', {}, p.icon + ' ' + p.name), h('small', {}, p.desc)))),
    h('div', { class: 'tog' + (ro ? ' ro' : ''), style: 'flex-wrap:wrap' }, h('div', { class: 't' }, h('b', {}, 'Match'), h('span', {}, 'Play several rounds. First to this many round wins takes the match.')),
      h('div', { class: 'seg' }, [[0, 'Single'], [2, 'First to 2'], [3, 'First to 3'], [5, 'First to 5']].map(([v, l]) => h('button', { class: (set.match || 0) === v ? 'on' : '', onclick: () => !ro && send({ match: v }) }, l)))),
    toggleRow('Stack +2 / +4', 'Answer a +2 with another +2 (or +4 with +4) and pass the penalty on.', set.stacking, () => send({ stacking: !set.stacking }), ro),
    toggleRow('Combo play', 'Play two or more cards with the same number together, even in different colors. At least one must match the top card, and you pick which of those colors stays.', set.combos, () => send({ combos: !set.combos }), ro),
    toggleRow('Draw until you can play', 'Nothing that fits the top card? Keep drawing until you get one that does. If you already hold a playable card, a voluntary draw is just one card.', set.drawUntil, () => send({ drawUntil: !set.drawUntil }), ro),
    toggleRow('Challenge rules', 'Wild +4 and Draw 12 may be played any time. The player they hit can challenge a bluff. Draw 12 is only in the deck when this is on.', set.challenges, () => send({ challenges: !set.challenges }), ro),
    h('div', { class: 'tog' + (ro ? ' ro' : ''), style: 'flex-wrap:wrap' }, h('div', { class: 't' }, h('b', {}, 'Turn timer'), h('span', {}, 'Out of time means draw and pass.')),
      h('div', { class: 'seg' }, [0, 15, 30, 45, 60].map((v) => h('button', { class: set.timer === v ? 'on' : '', onclick: () => !ro && send({ timer: v }) }, v ? v + 's' : 'Off')))),
    toggleRow('Allow joining mid-game', 'Friends can hop into a round that is already running.', set.lateJoin, () => send({ lateJoin: !set.lateJoin }), ro),
    h('div', { class: 'tog' + (ro ? ' ro' : '') }, h('div', { class: 't' }, h('b', {}, 'Starting hand'), h('span', {}, 'Cards each player gets.')),
      h('div', { class: 'step' }, h('button', { onclick: () => !ro && send({ handSize: Math.max(3, set.handSize - 1) }) }, '−'), h('b', {}, set.handSize), h('button', { onclick: () => !ro && send({ handSize: Math.min(10, set.handSize + 1) }) }, '+'))),
    h('div', { class: 'lbl', style: 'margin-top:14px' }, 'Room backdrop' + (ro ? ' (host picks)' : '')),
    h('div', { class: 'rgrid' + (ro ? ' ro' : '') }, (META.rooms || []).map((k) => h('button', { class: set.room === k ? 's' : '', onclick: () => send({ room: k }) }, h('div', { class: 'th', innerHTML: SCENES[k] ? SCENES[k].svg() : '' }), h('span', {}, SCENES[k] ? SCENES[k].name : k)))),
    h('div', { class: 'lbl', style: 'margin-top:14px' }, `House cards in the deck (${set.houseCards.length}/${house.length}) · 2 copies each (Draw 12: 1)`),
    ...house.map(([k, v]) => toggleRow(`${v.icon} ${v.name}`, v.desc, set.houseCards.includes(k), () => send({ houseCards: set.houseCards.includes(k) ? set.houseCards.filter((x) => x !== k) : [...set.houseCards, k] }), ro)));
  const st = $('btnStart'); st.style.display = isHost ? '' : 'none'; st.disabled = S.players.length < 2;
  st.textContent = S.players.length < 2 ? 'Waiting for another player…' : 'Start game';
  const hostP = S.players.find((p) => p.id === S.host);
  const w = $('waitHost'); w.replaceChildren();
  if (!isHost) { w.append(hostP && hostP.connected ? 'Waiting for the host to start…' : h('button', { onclick: () => tx({ t: 'claimhost' }) }, 'Host is away. Become host')); }
}

// ---------- avatars ----------
function avatarEl(code, cls = '') {
  const el = h('div', { class: 'av ' + cls });
  if (code && code.startsWith('p:')) el.append(h('img', { src: `avatars/${code.slice(2)}.png`, alt: '', draggable: 'false' }));
  else el.textContent = code && code.startsWith('e:') ? code.slice(2) : '🙂';
  return el;
}
const myAvatar = () => localStorage.getItem('uno.avatar') || '';
function paintAvBtn() { const b = $('btnAv'); const code = myAvatar() || 'e:🙂'; b.replaceChildren(); if (code.startsWith('p:')) b.append(h('img', { src: `avatars/${code.slice(2)}.png`, alt: '' })); else b.textContent = code.slice(2); }
function pickAvatar(onDone) {
  const cur = myAvatar();
  const choose = (code) => { localStorage.setItem('uno.avatar', code); paintAvBtn(); if (S) tx({ t: 'avatar', avatar: code }); overlay('ovAv', false); if (onDone) onDone(); };
  const pngs = (META.avatars ? META.avatars.png : []).map((n) => h('button', { class: cur === 'p:' + n ? 's' : '', onclick: () => choose('p:' + n) }, h('img', { src: `avatars/${n}.png`, alt: n })));
  const emos = (META.avatars ? META.avatars.emoji : []).map((e) => h('button', { class: cur === 'e:' + e ? 's' : '', onclick: () => choose('e:' + e) }, e));
  fill($('avBody'), h('h3', {}, 'Pick your avatar'), h('p', {}, 'Illustrated characters or any emoji.'), h('div', { class: 'agrid' }, pngs), h('div', { class: 'agrid' }, emos), h('button', { style: 'width:100%', onclick: () => overlay('ovAv', false) }, 'Close'));
  overlay('ovAv', true);
}

// ---------- room backdrop + table geometry ----------
let sceneKey = null;
function paintScene(on) {
  const sc = $('scene'); sc.classList.toggle('on', on);
  const key = S ? S.settings.room : null;
  if (on && key && key !== sceneKey && typeof SCENES !== 'undefined' && SCENES[key]) { sc.innerHTML = SCENES[key].svg(); sceneKey = key; }
}
const prevCount = {};
let lastTop = null;
const SEAT_HUES = ['#e53935', '#8e24aa', '#3949ab', '#039be5', '#00897b', '#7cb342', '#fb8c00', '#6d4c41', '#d81b60', '#5e35b1', '#00acc1', '#43a047', '#f4511e', '#546e7a', '#c0ca33'];

function layout(L) {
  const st = $('stage'), W = st.clientWidth, H = st.clientHeight;
  const compact = L > 6;
  const seatH = compact ? 48 : 74;
  const tw = Math.max(150, Math.min(W * 0.6, H - seatH * 1.7));
  st.style.setProperty('--tw', tw + 'px');
  const rw = Math.min(tw * 0.78, 190);
  st.style.setProperty('--rw', rw + 'px'); st.style.setProperty('--pw', Math.round(rw * 0.29) + 'px');
  const rx = W / 2 - (compact ? 24 : 38), ry = H / 2 - (compact ? 30 : 52);
  return { W, H, rx, ry, compact };
}

function renderSeats(me) {
  const L = S.players.length, meIdx = S.players.findIndex((p) => p.id === S.you);
  const g = layout(L);
  const cur = S.challenge ? S.challenge.target : S.turn;
  const total = (S.settings.timer || 0) * 1000;
  const seats = S.players.map((_, k) => {
    const i = (meIdx + k) % L, p0 = S.players[i];
    const p = dealing && dealing.counts[p0.id] !== undefined ? { ...p0, count: dealing.counts[p0.id] } : p0;
    const a = Math.PI / 2 + (k * 2 * Math.PI) / L;
    const x = g.W / 2 + g.rx * Math.cos(a), y = g.H / 2 + g.ry * Math.sin(a);
    const el = h('div', { class: 'seat' + (g.compact ? ' c' : '') + (p.id === cur && S.phase === 'playing' && !dealing ? ' cur' : '') + (p.id === S.you ? ' me' : '') + (p.connected || p.bot ? '' : ' off'), 'data-pid': p.id, style: `left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;--sc:${SEAT_HUES[i % 15]}` });
    const av = avatarEl(p.avatar);
    if (g.compact) { av.replaceChildren(h('b', {}, p.count)); av.dataset.cnt = p.count; }
    else {
      const n = Math.min(p.count, 7), rot = Math.atan2(-Math.cos(a), Math.sin(a)) * 180 / Math.PI;
      const fan = h('div', { class: 'fan', style: `transform:translate(${(-Math.cos(a) * 16).toFixed(1)}px,${(-Math.sin(a) * 16).toFixed(1)}px) rotate(${rot.toFixed(0)}deg)` });
      for (let j = 0; j < n; j++) fan.append(h('i', { style: `transform:rotate(${((j - (n - 1) / 2) * 11).toFixed(1)}deg)` }));
      el.append(fan);
      const bd = h('div', { class: 'bd' + (prevCount[p.id] !== undefined && prevCount[p.id] !== p.count ? ' pop' : '') }, p.count);
      av.append(bd);
    }
    prevCount[p.id] = p.count;
    el.append(av, h('div', { class: 'nm' }, (p.bot ? '🤖' : '') + p.name.slice(0, g.compact ? 7 : 12)));
    if (p.count === 1 && !dealing) el.append(h('div', { class: 'tag' }, 'UNO'));
    if (!g.compact && p.wins) el.append(h('div', { class: 'win' }, '🏆' + p.wins));
    return el;
  });
  $('seats').replaceChildren(...seats);
  seatPct();
}
function seatPct() {
  const el = document.querySelector('.seat.cur .av'); if (!el || !S) return;
  const total = (S.settings.timer || 0) * 1000;
  const actor = S.players.find((p) => p.id === (S.challenge ? S.challenge.target : S.turn));
  const live = S.ms && actor && !actor.bot && actor.connected;
  const left = live ? Math.max(0, S.ms - (performance.now() - recvAt)) : 0;
  const denom = S.challenge ? 10000 : total;
  el.style.setProperty('--pct', live && denom ? Math.max(0, Math.min(100, (left / denom) * 100)).toFixed(1) : 100);
}

// ring chevrons are built once
(function buildRing() {
  const g = []; for (let i = 0; i < 12; i++) g.push(`<polyline points="-4,-6 3,0 -4,6" transform="rotate(${i * 30} 100 100) translate(100 8)"/>`);
  $('rspin').innerHTML = g.join('');
})();

function cardOnTable(c, extra) { const e = cardEl(c, { info: false, dot: c.color ? null : S.color }); if (extra) e.style.cssText += extra; return e; }

function renderCenter() {
  const ctr = $('ctr');
  ctr.style.setProperty('--c', `var(--${S.color})`);
  $('rwrap').classList.toggle('ccw', S.dir === -1);
  $('stage').classList.toggle('win-glow', S.phase === 'ended');
  // deck: three stacked backs
  const d = $('deck'); d.classList.toggle('can', !!S.canDraw);
  d.replaceChildren(...[2, 1, 0].map((k) => { const e = backEl(); e.style.transform = `translate(${-k * 1.5}px,${-k * 1.5}px)`; return e; }), h('div', { class: 'dn' }, `${S.drawCount}`));
  d.onclick = doDraw;
  if (dealing) { const left = dealing.total - Object.values(dealing.counts).reduce((a, b) => a + b, 0) + (dealing.flip ? 0 : 1); $('deck').querySelector('.dn').textContent = S.drawCount + left; }
  // discard pile: a few UNO backs peeking out under the face-up top card
  const under = Math.min(3, Math.max(0, S.played.length - 1)), n = S.played.length;
  const kids = [];
  for (let k = under; k >= 1; k--) { const e = backEl(); const r = ((n * 53 + k * 37) % 40) - 20; e.style.transform = `rotate(${r}deg) translate(${(k % 2 ? -1 : 1) * 2}px,${k}px)`; kids.push(e); }
  if (dealing && !dealing.flip) { $('disc').replaceChildren(); $('cpill').className = 'cpill ' + S.color; $('cpill').textContent = ''; $('cpill').style.display = 'none'; return; }
  $('cpill').style.display = '';
  const top = cardOnTable(S.top); top.classList.add('top'); top.style.transform = `rotate(${((n * 29) % 14) - 7}deg)`;
  if (lastTop !== S.top.id && lastTop !== null && !dealing) { FX.sound('play'); top.style.animation = 'land .3s'; }
  lastTop = S.top.id;
  if (performance.now() < landUntil) { top.style.opacity = 0; clearTimeout(renderCenter.t); renderCenter.t = setTimeout(revealTop, Math.max(0, landUntil - performance.now())); }
  kids.push(top);
  if (S.pending) kids.push(h('div', { class: 'pend' }, '+' + S.pending));
  $('disc').replaceChildren(...kids);
  const cp = $('cpill'); cp.className = 'cpill ' + S.color; cp.textContent = (S.lock ? '🔒 ' : '') + CNAME[S.color];
}

function renderTable(me) {
  $('tcode').textContent = session ? session.code : '';
  paintScene(true);
  const myTurn = S.turn === S.you && S.phase === 'playing' && !dealing;
  renderSeats(me);
  renderCenter();

  // spy panel: only the spy ever receives this
  const sp = $('spy');
  if (S.spy && spyHidden !== S.spy.target + ':' + S.turnNo + ':' + S.round) {
    sp.classList.add('on');
    fill(sp, h('div', { class: 'sh' }, h('b', {}, `👁 ${S.spy.name}'s hand`), h('span', {}, ` (${S.spy.hand.length} card${S.spy.hand.length === 1 ? '' : 's'}, live until your next turn)`), h('button', { onclick: () => { spyHidden = S.spy.target + ':' + S.turnNo + ':' + S.round; sp.classList.remove('on'); } }, '✕')),
      h('div', { class: 'sc' }, [...S.spy.hand].sort((a, b) => colorIdx(a) - colorIdx(b) || ORDER[a.type] - ORDER[b.type] || (a.value || 0) - (b.value || 0)).map((c) => cardEl(c, { info: false }))));
  } else sp.classList.remove('on');

  // played history: collapsed by default, tap to expand
  const hs = $('hist'); const last = S.played[S.played.length - 1];
  $('histTog').textContent = `${hs.classList.contains('open') ? '▾' : '▸'} Played so far (${S.played.length})${last && last.by ? ' · last: ' + last.by : ''}`;
  $('histTog').onclick = () => { hs.classList.toggle('open'); renderTable(me); };
  const pl = $('played'), atEnd = pl.scrollWidth - pl.scrollLeft - pl.clientWidth < 40;
  pl.replaceChildren(...S.played.map((e) => h('div', { class: 'pc' }, cardEl(e.card, { dot: e.card.color ? null : e.color }), h('span', {}, e.by || 'start'))));
  if (atEnd) pl.scrollLeft = pl.scrollWidth;

  // banner + log
  const cur = S.players.find((p) => p.id === S.turn);
  const bn = $('banner'); bn.className = 'banner' + (myTurn ? ' me' : '');
  const ch = S.challenge, chT = ch && S.players.find((p) => p.id === ch.target);
  if (ch && ch.target === S.you) bn.className = 'banner me';
  bn.dataset.base = dealing ? (dealing.flip ? 'Turning over the first card…' : Object.values(dealing.counts).every((n) => !n) ? 'Shuffling the deck…' : 'Dealing cards…') : S.phase !== 'playing' ? '' : ch ? (ch.target === S.you ? 'Your call: accept or challenge?' : `${chT ? chT.name : ''} must accept or challenge…`) : myTurn ? (S.drawnId ? 'Play the drawn card or pass' : S.pending ? `Stack a draw card or take +${S.pending}` : 'Your turn') : `${cur ? cur.name : ''}'s turn${cur && !cur.connected && !cur.bot ? ' (offline)' : ''}`;
  tickTimer();
  $('logl').replaceChildren(...S.log.slice(-2).map((t) => h('div', {}, t)));
  renderLog();
  if (myTurn && prevTurn !== S.you) { if (navigator.vibrate) navigator.vibrate(120); FX.sound('turn'); }
  prevTurn = S.turn;

  // hand
  const hand = $('hand'), sx = hand.scrollLeft;
  const dealtHand = dealing ? S.hand.slice(0, dealing.mine) : S.hand;
  const sorted = [...dealtHand].sort((a, b) => colorIdx(a) - colorIdx(b) || ORDER[a.type] - ORDER[b.type] || (a.value || 0) - (b.value || 0));
  selIds = selIds.filter((id) => S.hand.some((c) => c.id === id));
  if (!myTurn || S.challenge) selIds = [];
  const sc = selCards(), one = sc.length === 1 && sc[0].type === 'num' ? sc[0] : null;
  const mates = (c) => !!one && c.id !== one.id && c.type === 'num' && c.value === one.value && S.settings.combos && !S.drawnId && !S.pending;
  hand.replaceChildren(...sorted.map((c) => {
    const e = cardEl(c, { dim: myTurn && !S.challenge && !usable(c), sel: selIds.includes(c.id), drawn: S.drawnId === c.id });
    if (mates(c)) e.classList.add('combo');
    e.addEventListener('click', () => onCard(c, e));
    return e;
  }));
  hand.style.setProperty('--ov', S.hand.length <= 6 ? '-.06' : S.hand.length <= 10 ? '-.22' : '-.4');
  hand.scrollLeft = sx;

  // action bar
  const acts = $('acts'); acts.replaceChildren();
  const hasMates = one && S.hand.some(mates);
  acts.append(h('div', { class: 'info' }, sc.length > 1 ? h('span', {}, h('b', {}, `Combo × ${sc.length}`), ' — tap more ' + sc[0].value + 's to add, tap one to remove.') : sc.length === 1 ? h('span', {}, h('b', {}, cardName(sc[0])), ' — ', cardDesc(sc[0]), hasMates ? ` Tap another ${one.value} to make a combo.` : '') : `You hold ${S.hand.length} card${S.hand.length === 1 ? '' : 's'}.`));
  if (S.unoWindow && S.unoWindow !== S.you) { const v = S.players.find((p) => p.id === S.unoWindow); acts.append(h('button', { class: 'catch', onclick: () => tx({ t: 'catch' }) }, `Catch ${v.name}!`)); }
  if (S.hand.length <= 2 && me && !me.called) acts.append(h('button', { class: 'uno', onclick: () => tx({ t: 'uno' }) }, 'UNO!'));
  else if (me && me.called && S.hand.length <= 2) acts.append(h('button', { disabled: '' }, 'UNO ✓'));
  if (sc.length) acts.append(h('button', { class: 'primary', onclick: startPlay }, sc.length > 1 ? `Play ${sc.length}` : 'Play'));
  if (S.canPass) acts.append(h('button', { onclick: () => tx({ t: 'pass' }) }, 'Pass'));
  else if (S.canDraw && !sc.length) acts.append(h('button', { onclick: doDraw }, S.pending ? `Draw ${S.pending}` : S.settings.drawUntil && !S.playable.length ? 'Draw until playable' : 'Draw'));

  renderChallenge();
  renderEnd();
}

function doDraw() { if (dealing) return; if (S && S.canDraw) tx({ t: 'draw' }); else if (S && S.phase === 'playing') toast(S.turn === S.you ? 'Play or pass first.' : 'Not your turn.'); }

// ---------- selection / combos ----------
const selCards = () => selIds.map((id) => S.hand.find((c) => c.id === id)).filter(Boolean);
const comboOK = () => S.settings.combos && !S.drawnId && !S.pending;
// a number card that cannot be played alone can still ride along with a playable card of the same number
const comboable = (c) => comboOK() && c.type === 'num' && S.hand.some((x) => x.type === 'num' && x.value === c.value && S.playable.includes(x.id));
const usable = (c) => S.playable.includes(c.id) || comboable(c);
const freshSel = (c) => (S.playable.includes(c.id) ? [c.id] : S.hand.filter((x) => x.type === 'num' && x.value === c.value).map((x) => x.id));

function onCard(c, el) {
  if (Date.now() - lastHold < 450) return;               // that was a press-and-hold, not a tap
  if (S.challenge) return toast('Waiting for the challenge answer.');
  if (S.turn !== S.you) return toast('Not your turn yet.');
  if (!usable(c)) { el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 300); return toast(S.pending ? 'Stack a matching draw card, or draw.' : S.drawnId ? 'You can only play the card you drew.' : 'That one does not match.'); }
  const first = selCards()[0], i = selIds.indexOf(c.id);
  if (!first) selIds = freshSel(c);
  else if (i >= 0) { if (selIds.length === 1) return startPlay(); selIds.splice(i, 1); }
  else if (comboOK() && first.type === 'num' && c.type === 'num' && first.value === c.value) selIds.push(c.id);
  else selIds = freshSel(c);
  renderTable(S.players.find((p) => p.id === S.you));
}

function startPlay() {
  const cards = selCards(); if (!cards.length) return;
  if (cards.length === 1) {
    const c = cards[0];
    if (!needsColor(c) && !needsTarget(c)) { selIds = []; return tx({ t: 'play', cardId: c.id }); }
    pick = { card: c, color: null, target: null }; renderPick(); return overlay('ovPick', true);
  }
  if (!cards.some((c) => S.playable.includes(c.id))) return toast('Include a card that matches the top card.');
  const colors = [...new Set(cards.map((c) => c.color))];
  if (colors.length === 1) { selIds = []; return tx({ t: 'playmany', cardIds: cards.map((c) => c.id), color: colors[0] }); }
  pick = { combo: cards, colors, color: null }; renderPick(); overlay('ovPick', true);
}
function renderPick() {
  const body = $('pickBody');
  if (pick.combo) {
    fill(body, h('h3', {}, `Combo × ${pick.combo.length}`), h('p', {}, 'Pick the color that stays in play. It has to be one of the colors you are playing.'),
      h('div', { class: 'cols' }, pick.colors.map((k) => h('button', { class: pick.color === k ? 's' : '', style: `background:var(--${k})`, onclick: () => { pick.color = k; renderPick(); } }))),
      h('div', { class: 'row' }, h('button', { onclick: () => overlay('ovPick', false) }, 'Cancel'),
        h('button', { class: 'primary', disabled: pick.color ? null : '', onclick: () => { overlay('ovPick', false); const ids = pick.combo.map((c) => c.id); selIds = []; tx({ t: 'playmany', cardIds: ids, color: pick.color }); } }, 'Play combo')));
    return;
  }
  const { card } = pick, others = S.players.filter((p) => p.id !== S.you);
  const ready = (!needsColor(card) || pick.color) && (!needsTarget(card) || pick.target);
  fill(body,
    h('h3', {}, cardName(card)), h('p', {}, cardDesc(card)),
    needsColor(card) && h('div', {}, h('div', { class: 'lbl' }, card.house === 'dump' || card.house === 'roulette' ? 'Pick the color (also the new color in play)' : 'Pick the new color'),
      h('div', { class: 'cols' }, COLORS.map((k) => h('button', { class: pick.color === k ? 's' : '', style: `background:var(--${k})`, onclick: () => { pick.color = k; renderPick(); } })))),
    needsTarget(card) && h('div', {}, h('div', { class: 'lbl' }, 'Pick a player'),
      h('div', { class: 'tg' }, others.map((p) => h('button', { class: pick.target === p.id ? 's' : '', onclick: () => { pick.target = p.id; renderPick(); } }, h('span', {}, p.name), h('b', {}, p.count))))),
    h('div', { class: 'row' }, h('button', { onclick: () => overlay('ovPick', false) }, 'Cancel'),
      h('button', { class: 'primary', disabled: ready ? null : '', onclick: () => { overlay('ovPick', false); selIds = []; tx({ t: 'play', cardId: card.id, color: pick.color, target: pick.target }); } }, 'Play it')));
  if (!ready) body.querySelector('.primary').setAttribute('disabled', '');
  else body.querySelector('.primary').removeAttribute('disabled');
}

// ---------- challenge prompt, event banners, timer ----------
function renderChallenge() {
  const c = S.challenge, mine = !!c && c.target === S.you && S.phase === 'playing';
  overlay('ovChallenge', mine); if (!mine) return;
  const by = S.players.find((p) => p.id === c.by), w4 = c.kind === 'wild4';
  fill($('chBody'),
    h('div', { class: 'win' }, w4 ? '🎴' : '💥'),
    h('h2', { style: 'margin:6px 0' }, `${by ? by.name : 'Someone'} played ${w4 ? 'Wild +4' : 'Draw 12'} on you`),
    h('p', { class: 'sub', style: 'margin:0 0 4px' }, w4 ? 'It is only legal if they had no card of the color that was in play.' : 'It is only legal if they had no other playable card. Wilds and custom cards count.'),
    h('p', { class: 'sub', style: 'margin:0' }, `${by ? by.name : 'They'} still holds ${by ? by.count : '?'} card${by && by.count === 1 ? '' : 's'}. Decide: ` , h('b', { id: 'chTime' }, '')),
    h('div', { class: 'chbtns' },
      h('button', { class: 'danger', onclick: () => tx({ t: 'respond', challenge: true }) }, 'Challenge!', h('small', {}, `Right: they draw ${c.caught}. Wrong: you draw ${c.fail}.`)),
      h('button', { onclick: () => tx({ t: 'respond', challenge: false }) }, `Accept and draw ${c.amount}`, w4 ? h('small', {}, 'and lose your turn') : null)));
  tickTimer();
}

// ---------- reactions ----------
function showReaction(pid, e) {
  if (FX.lowMotion() || !S || S.phase === 'lobby') return;
  const seat = document.querySelector(`.seat[data-pid="${pid}"]`); if (!seat) return;
  const el = h('div', { class: 'react' }, e);
  el.style.left = seat.style.left; el.style.top = seat.style.top; $('fxl').append(el);
  setTimeout(() => el.remove(), 2600);
}
function toggleReactTray() {
  const t = $('reacts'); if (t.classList.toggle('on')) fill(t, (META.reactions || []).map((e) => h('button', { onclick: () => { tx({ t: 'react', e }); t.classList.remove('on'); } }, e)));
}

// ---------- events play one after another, at a human pace ----------
let evQ = [], evBusy = false;
const involvesMe = (e) => e.type === 'shuffle' || e.type === 'rotate' || (e.type === 'swap' && (e.a === S.you || e.b === S.you));
function queueEvent(e) {
  evQ.push({ e, rects: curRects, prevHand: curPrev && curPrev.hand ? curPrev.hand : [] });
  if (['swap', 'rotate', 'shuffle'].includes(e.type) && involvesMe(e) && !FX.lowMotion()) $('hand').classList.add('hide');
  pumpEvents();
}
function pumpEvents() {
  while (!evBusy && evQ.length) {
    const it = evQ.shift(); let dur = 0;
    try { dur = playEvent(it) || 0; } catch (err) { dur = 0; }
    if (dur > 0) { evBusy = true; setTimeout(() => { evBusy = false; pumpEvents(); }, dur); }
  }
}
function unhideHand() { const h = $('hand'); h.classList.remove('hide'); h.classList.add('reveal'); setTimeout(() => h.classList.remove('reveal'), 700); }
function playEvent(it) {
  const e = it.e;
  if (['swap', 'rotate', 'shuffle', 'steal'].includes(e.type)) {
    bigNotice(it);
    let end = 0;
    if (!FX.lowMotion()) { end = e.type === 'swap' ? flySwap(it) : e.type === 'rotate' ? flyRotate(it) : e.type === 'shuffle' ? flyShuffle(it) : flySteal(it); }
    if (e.type !== 'steal') setTimeout(unhideHand, Math.max(end + 250, 600));
    setTimeout(() => $('hand').classList.remove('hide'), e.dur + 600);   // safety net
    return e.dur;
  }
  showEvent(e);
  return e.dur || 0;
}
const playerOf = (id) => S.players.find((p) => p.id === id) || { id, name: 'Someone', avatar: null, count: 0 };
function chipEl(id, note) { const p = playerOf(id); return h('div', { class: 'pa' }, avatarEl(p.avatar), h('span', {}, id === S.you ? 'You' : p.name.slice(0, 9)), note != null && h('small', {}, note)); }
function bigNotice(it) {
  const e = it.e, me = S.you, nm = (id) => (id === me ? 'You' : playerOf(id).name);
  let head, row, sub, mine = false, sm = false;
  if (e.type === 'swap') {
    mine = e.a === me || e.b === me; const other = e.a === me ? e.b : e.a;
    head = '🔄 SWAP HANDS';
    row = [chipEl(e.a, `${e.nb} card${e.nb === 1 ? '' : 's'} now`), h('div', { class: 'arrows' }, '⇄'), chipEl(e.b, `${e.na} card${e.na === 1 ? '' : 's'} now`)];
    sub = mine ? `You and ${nm(other)} swapped whole hands. You now hold ${e.a === me ? e.nb : e.na}.` : `${nm(e.a)} and ${nm(e.b)} swapped whole hands.`;
  } else if (e.type === 'rotate') {
    mine = true; sm = e.moves.length > 6; const into = e.moves.find((m) => m.to === me);
    head = `🌀 HAND ROTATE ${e.dir === 1 ? '↻' : '↺'}`;
    row = e.moves.flatMap((m, i) => [chipEl(m.from, m.n), i < e.moves.length - 1 && h('div', { class: 'arrows s' }, '›')]);
    sub = `Every hand moves to the next player (${e.dir === 1 ? 'clockwise' : 'anti-clockwise'}).` + (into ? ` You now hold ${into.from === me ? 'your own' : nm(into.from) + "'s"} hand (${into.n}).` : '');
  } else if (e.type === 'shuffle') {
    mine = true; sm = Object.keys(e.sizes).length > 6;
    head = '🔀 HANDS SHUFFLED';
    row = Object.entries(e.sizes).map(([id, n]) => chipEl(id, `${n} card${n === 1 ? '' : 's'}`));
    sub = `${nm(e.by)} pooled every card and dealt them out again. Everyone keeps the same number of cards.`;
  } else {
    mine = e.from === me || e.to === me;
    head = '🕵️ PICKPOCKET';
    row = [chipEl(e.to), h('div', { class: 'arrows' }, '←'), chipEl(e.from)];
    sub = e.from === me ? 'A card was stolen from YOU.' : e.to === me ? 'You stole a card.' : `${nm(e.to)} stole a card from ${nm(e.from)}.`;
  }
  const b = $('big'); fill(b, h('h4', {}, head), h('div', { class: 'row2' }, row), h('p', {}, sub));
  b.className = 'big on' + (mine ? ' mine' : '') + (sm ? ' sm' : '');
  clearTimeout(bigNotice.t); bigNotice.t = setTimeout(() => { b.classList.remove('on'); b.classList.add('off'); }, Math.max(1500, e.dur - 600));
  FX.sound(e.type === 'steal' ? 'bust' : 'reverse');
}

function showEvent(e) {
  const nm = (id) => { const p = S.players.find((q) => q.id === id); return p ? p.name : 'Someone'; };
  const box = $('evt'); let kids = null;
  if (e.type === 'reverse') kids = [e.dir === 1 ? '↻ REVERSE' : '↺ REVERSE'];
  else if (e.type === 'skip') kids = [`⊘ ${nm(e.who)} is skipped`];
  else if (e.type === 'combo') kids = [`COMBO × ${e.n}!`];
  else if (e.type === 'draw' && e.n >= 4 && !e.self) kids = [`${nm(e.to)} draws ${e.n}!`];
  else if (e.type === 'busted') kids = ['🚨 BUSTED!', h('div', { style: 'font-size:14px;font-weight:600' }, `${nm(e.by)} was holding`), cardEl(e.card, { info: false }), `${nm(e.by)} draws ${e.n}`];
  else if (e.type === 'failed') kids = [`Wrong call! ${nm(e.to)} draws ${e.n}`];
  else if (e.type === 'spy') kids = [e.target === S.you ? `👁 ${nm(e.by)} is looking at YOUR hand!` : e.by === S.you ? `👁 You are spying on ${nm(e.target)}` : `👁 ${nm(e.by)} is peeking at ${nm(e.target)}'s hand`];
  else if (e.type === 'lock') kids = [`🔒 Color locked to ${CNAME[e.color].toUpperCase()}`, h('div', { style: 'font-size:14px;font-weight:600' }, `until ${nm(e.by)}'s next turn`)];
  const seat = (id) => document.querySelector(`.seat[data-pid="${id}"]`);
  const at = (id, el) => { const s = seat(id); if (!s) return; el.style.left = s.style.left; el.style.top = s.style.top; $('fxl').append(el); setTimeout(() => el.remove(), 2800); };
  if (e.type === 'reverse') FX.sound('reverse');
  if (e.type === 'draw') { FX.sound('draw'); if (e.n >= 12 && !e.self) { FX.sound('storm'); $('flash').classList.remove('on'); void $('flash').offsetWidth; $('flash').classList.add('on'); const st = $('stage'); st.classList.remove('shk'); void st.offsetWidth; st.classList.add('shk'); at(e.to, h('div', { class: 'cloud' }, '⛈️', h('span', {}, '⚡'))); } }
  if (e.type === 'skip') at(e.who, h('div', { class: 'skipm' }, '⊘'));
  if (e.type === 'busted') { FX.sound('bust'); at(e.by, h('div', { class: 'stamp' }, 'BUSTED')); }
  if (e.type === 'failed') { FX.sound('bust'); at(e.to, h('div', { class: 'splat' }, '🥚')); }
  if (e.type === 'win') { FX.sound('win'); const st = $('stage').getBoundingClientRect(); FX.confetti(st.left + st.width / 2, st.top + st.height / 2, 130); setTimeout(() => FX.confetti(innerWidth * 0.2, innerHeight * 0.3, 60), 350); setTimeout(() => FX.confetti(innerWidth * 0.8, innerHeight * 0.3, 60), 600); }
  if (e.type === 'combo' || e.type === 'draw' && e.n < 4) { /* sound only */ }
  if (!kids) return;
  fill(box, kids); box.classList.remove('on'); void box.offsetWidth; box.classList.add('on');
  if (navigator.vibrate && (e.type === 'busted' || (e.type === 'draw' && e.n >= 12))) navigator.vibrate([80, 60, 80]);
}
function tickTimer() {
  if (!S || S.phase !== 'playing') return;
  const actor = S.players.find((p) => p.id === (S.challenge ? S.challenge.target : S.turn));
  let left = S.ms && actor && !actor.bot && actor.connected ? Math.max(0, Math.ceil((S.ms - (performance.now() - recvAt)) / 1000)) : 0;
  const cap = S.challenge ? 10 : S.settings.timer; if (cap && left > cap) left = cap;   // animation time is not counted against you
  const bn = $('banner'); bn.textContent = (bn.dataset.base || '') + (left ? ` · ${left}s` : '');
  const t = $('chTime'); if (t) t.textContent = left ? `${left}s` : '';
  seatPct();
}
setInterval(tickTimer, 250);

// ---------- press and hold a card to see what it does ----------
let holdT = null, holdXY = null, infoShown = false;
function bindHold(el, c) {
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => { holdXY = [e.clientX, e.clientY]; clearTimeout(holdT); holdT = setTimeout(() => showInfo(c), 380); });
  el.addEventListener('pointermove', (e) => { if (holdXY && Math.hypot(e.clientX - holdXY[0], e.clientY - holdXY[1]) > 10) clearTimeout(holdT); });
}
function showInfo(c) {
  const big = cardEl(c, { info: false }); big.style.setProperty('--cw', '150px');
  fill($('infoBody'), h('div', { style: 'display:flex;justify-content:center' }, big), h('h3', {}, cardName(c)), h('p', {}, cardDesc(c)),
    c.type === 'num' && S && S.settings.combos ? h('p', { style: 'margin-top:6px' }, 'Combo: play several cards with this number together.') : null);
  infoShown = true; overlay('ovInfo', true);
}
function endHold() { clearTimeout(holdT); holdXY = null; if (infoShown) { infoShown = false; lastHold = Date.now(); overlay('ovInfo', false); } }
for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, endHold);

// ---------- keep the screen on while playing ----------
let wake = null;
async function keepAwake() { try { if ('wakeLock' in navigator && !wake && !document.hidden) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { /* not supported or refused */ } }
document.addEventListener('visibilitychange', () => { if (!document.hidden && session) keepAwake(); });

function renderEnd() {
  const on = S.phase === 'ended';
  overlay('ovEnd', on); if (!on) return;
  const w = S.players.find((p) => p.id === S.winner), isHost = S.host === S.you;
  const board = [...S.players].sort((a, b) => b.wins - a.wins);
  fill($('endBody'),
    h('div', { class: 'win' }, w && w.id === S.you ? '🎉' : '🏁'),
    S.matchWinner && h('div', { class: 'matchwin' }, '🏆 MATCH WON'),
    h('h2', { style: 'margin:6px 0' }, S.matchWinner ? (S.matchWinner === S.you ? 'You won the match!' : `${playerOf(S.matchWinner).name} won the match!`) : w ? (w.id === S.you ? 'You win!' : `${w.name} wins!`) : 'Round over'),
    S.settings.match > 0 && !S.matchWinner && h('p', { class: 'sub', style: 'margin:0' }, `Match: first to ${S.settings.match} round wins`),
    S.awards && S.awards.length > 0 && h('div', { class: 'awards' }, S.awards.map((a) => h('div', { class: 'aw' }, h('span', { class: 'ai' }, a.icon), h('div', {}, h('b', {}, a.title), h('small', {}, `${a.who === S.you ? 'You' : playerOf(a.who).name} · ${a.note}`))))),
    h('div', { class: 'plist', style: 'margin:14px 0;text-align:left' }, board.map((p) => h('div', { class: 'pl' }, h('span', { class: 'nm' }, p.name + (p.id === S.you ? ' (you)' : '')), h('small', {}, `${p.count} left`), h('b', {}, `🏆 ${p.wins}${S.settings.match ? '/' + S.settings.match : ''}`)))),
    isHost ? h('div', {}, h('button', { class: 'primary', style: 'width:100%;margin-bottom:8px', onclick: () => tx({ t: 'start' }) }, S.matchWinner ? 'Start a new match' : 'Next round'), h('button', { style: 'width:100%', onclick: () => tx({ t: 'lobby' }) }, 'Back to lobby / change rules')) : h('p', { class: 'sub' }, 'Waiting for the host…'));
}

// ---------- menus ----------
function showRules() {
  const house = S ? S.settings.houseCards : Object.keys(META.house);
  fill($('rulesBody'),
    h('h3', {}, 'How to play'),
    ...[['Match', 'Play a card that matches the top card by color, number or symbol. Wild cards go on anything.'],
      ['Draw', 'No play? Tap the draw pile. If the card you drew fits, you may play it or pass.'],
      ['Skip / Reverse / +2', 'Skip: next player loses a turn. Reverse: flips direction. +2: next player draws 2 and loses a turn.'],
      ['Wild / Wild +4', 'Pick the color. +4 makes the next player draw 4 and lose a turn.'],
      ['UNO!', 'Down to one card? Hit UNO before your turn ends. If someone catches you first, you draw 2.'],
      ['Winning', 'First player to empty their hand wins the round.']].map(([a, b]) => h('div', { class: 'rule' }, h('b', {}, a), b)),
    S && S.settings.stacking && h('div', { class: 'rule' }, h('b', {}, 'Stacking is ON'), 'You can answer +2 with +2 and +4 with +4.'),
    S && S.settings.combos && h('div', { class: 'rule' }, h('b', {}, 'Combo play'), 'Play 2 or more number cards with the same number at once, in any colors. At least one must match the top card, and you choose which of those colors stays in play.'),
    S && S.settings.challenges && h('div', { class: 'rule' }, h('b', {}, 'Challenges'), 'Wild +4 and Draw 12 can be played any time, but it is on your conscience. The player hit may challenge. Caught: you draw the penalty instead (+4 or 16). Wrong call: they draw 6 for +4, or 16 for Draw 12.'),
    S && S.settings.timer > 0 && h('div', { class: 'rule' }, h('b', {}, `${S.settings.timer}s turn timer`), 'Out of time means you draw a card and pass.'),
    h('h3', { style: 'margin-top:16px' }, 'House cards in this game'),
    house.length ? house.map((k) => h('div', { class: 'rule' }, h('b', {}, `${META.house[k].icon} ${META.house[k].name}`), META.house[k].desc)) : h('p', {}, 'None enabled.'),
    h('button', { style: 'width:100%;margin-top:14px', onclick: () => overlay('ovRules', false) }, 'Close'));
  overlay('ovRules', true);
}
function renderLog() {
  const box = $('logBody'); if (!box || !S) return;
  const stick = !$('ovLog').classList.contains('on') || box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  fill(box, S.log.map((t, i) => h('div', { class: 'logrow' + (i === S.log.length - 1 ? ' new' : '') }, t)));
  if (stick) box.scrollTop = box.scrollHeight;
}
function showLog() { overlay('ovLog', true); renderLog(); $('logBody').scrollTop = $('logBody').scrollHeight; }
function showMenu() {
  const isHost = S && S.host === S.you;
  fill($('menuBody'),
    h('h3', {}, 'Menu'),
    h('button', { style: 'width:100%;margin-bottom:8px', onclick: () => { overlay('ovMenu', false); share(); } }, '📤 Invite friends'),
    h('button', { style: 'width:100%;margin-bottom:8px', onclick: () => { overlay('ovMenu', false); pickAvatar(); } }, '🎭 Change avatar'),
    h('button', { style: 'width:100%;margin-bottom:8px', onclick: () => { localStorage.setItem('uno.snd', FX.soundOn() ? 'off' : 'on'); showMenu(); } }, FX.soundOn() ? '🔊 Sound: on' : '🔇 Sound: off'),
    h('button', { style: 'width:100%;margin-bottom:8px', onclick: () => { const low = !FX.lowMotion(); localStorage.setItem('uno.fx', low ? 'low' : 'full'); document.body.classList.toggle('lowfx', low); showMenu(); } }, FX.lowMotion() ? '✨ Effects: reduced' : '✨ Effects: full'),
    isHost && S.phase === 'playing' && h('button', { style: 'width:100%;margin-bottom:8px', onclick: () => { overlay('ovMenu', false); tx({ t: 'lobby' }); } }, 'End round, back to lobby'),
    h('button', { class: 'danger', style: 'width:100%;margin-bottom:8px', onclick: () => { overlay('ovMenu', false); tx({ t: 'leave' }); } }, 'Leave game'),
    h('button', { style: 'width:100%', onclick: () => overlay('ovMenu', false) }, 'Close'));
  overlay('ovMenu', true);
}
async function share() {
  if (!session) return;
  const url = `${location.origin}/?room=${session.code}`;
  const text = `Join my UNO game! Code: ${session.code}`;
  try { if (navigator.share) return await navigator.share({ title: 'UNO Party', text, url }); } catch (e) { return; }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Invite link copied'); } catch { toast(url, 5000); }
}


// ---------- card flight animations ----------
// Draws and plays are worked out by comparing the previous state with the new one, so the server
// sends nothing extra. Swaps, rotations and shuffles are driven by their events. Everything is slow
// on purpose: one card at a time, at a pace a person can follow.
let landUntil = 0;
const centerOf = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
function fly(from, to, opts = {}) {
  const el = opts.face ? cardEl(opts.face, { info: false, dot: opts.face.color ? null : S.color }) : backEl();
  const w = opts.w || 46;
  el.style.cssText += `;--cw:${w}px;position:fixed;left:${-w / 2}px;top:${-w * 0.75}px;z-index:96;pointer-events:none;margin:0`;
  document.body.append(el);
  const a = centerOf(from), b = centerOf(to), s0 = from.width && opts.w ? Math.min(1.4, from.width / w) : 1;
  const rot = opts.rot || 0;
  const anim = el.animate([
    { transform: `translate(${a.x}px,${a.y}px) scale(${s0}) rotate(0deg)`, opacity: 0.9 },
    { transform: `translate(${(a.x + b.x) / 2}px,${Math.min(a.y, b.y) - 18 + Math.abs(a.y - b.y) / 2}px) scale(${(s0 + (opts.endScale || 1)) / 2 + 0.12}) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${b.x}px,${b.y}px) scale(${opts.endScale || 1}) rotate(${rot}deg)`, opacity: 1 },
  ], { duration: opts.dur || 800, delay: opts.delay || 0, easing: 'cubic-bezier(.3,.7,.35,1)', fill: 'both' });
  anim.onfinish = () => { el.remove(); if (opts.done) opts.done(); };
  return anim;
}
const seatAv = (pid) => { const e = document.querySelector(`.seat[data-pid="${pid}"] .av`); return e ? e.getBoundingClientRect() : null; };
const handSlot = (i) => { const els = document.querySelectorAll('#hand .card'); return els.length ? els[i % els.length].getBoundingClientRect() : $('hand').getBoundingClientRect(); };
const deckRect = () => $('deck').getBoundingClientRect();
const discRect = () => $('disc').getBoundingClientRect();
const ctrRect = () => $('ctr').getBoundingClientRect();
const MIN_W = 40;

function flyDiff(prev, next, rects, special) {
  if (!prev || dealing || FX.lowMotion() || document.hidden || prev.phase !== 'playing' || next.phase !== 'playing' || !prev.hand) return;
  const deck = deckRect(), disc = discRect();
  if (!deck.width) return;
  const oldP = Object.fromEntries(prev.players.map((p) => [p.id, p]));
  const deckDrop = prev.drawCount - next.drawCount;
  let budget = deckDrop > 0 ? deckDrop : next.drawCount > prev.drawCount ? 99 : 0;   // a reshuffle counts as draws, swaps do not

  // 1) the played card(s) travel from the hand / seat to the pile
  const added = next.played.length > prev.played.length ? next.played.slice(prev.played.length) : [];
  const myGone = prev.hand.filter((c) => !next.hand.some((x) => x.id === c.id));
  let src = null;
  if (special) src = special.by;
  else {
    const g = next.players.find((p) => p.id !== S.you && oldP[p.id] && p.count < oldP[p.id].count);
    src = myGone.length ? S.you : g ? g.id : null;
  }
  const shown = added.slice(-4);
  if (shown.length && src) {
    const dur = 850; landUntil = performance.now() + 200 + dur + 320 * shown.length;
    shown.forEach((e, i) => {
      const from = src === S.you ? (rects[e.card.id] || (myGone[i] && rects[myGone[i].id]) || deck) : (seatAv(src) || deck);
      setTimeout(() => FX.sound('play'), 200 + i * 320);
      fly(from, disc, { face: e.card, w: 58, delay: 200 + i * 320, dur, rot: ((i * 23) % 14) - 7, endScale: 46 / 58, done: i === shown.length - 1 ? revealTop : null });
    });
  }

  // 2) cards coming from the deck, one at a time
  let k = 0;
  const myNew = next.hand.filter((c) => !prev.hand.some((x) => x.id === c.id));
  const draws = [];
  if (myNew.length && budget > 0) { const n = Math.min(myNew.length, budget); draws.push({ pid: S.you, n, cards: myNew.slice(0, n) }); budget -= n; }
  for (const p of next.players) { const o = oldP[p.id]; if (o && p.id !== S.you && p.count > o.count && budget > 0) { const n = Math.min(p.count - o.count, budget); draws.push({ pid: p.id, n }); budget -= n; } }
  const startAt = shown.length ? 200 + shown.length * 320 + 500 : 250;   // a played card lands before the next one is dealt out
  for (const d of draws) {
    const n = Math.min(d.n, 14), step = n > 8 ? 280 : 420;
    for (let i = 0; i < n; i++) {
      let to, el = null;
      if (d.pid === S.you) { el = d.cards[i] ? document.querySelector(`#hand .card[data-id="${d.cards[i].id}"]`) : null; to = el ? el.getBoundingClientRect() : $('hand').getBoundingClientRect(); if (el) el.style.opacity = 0; }
      else to = seatAv(d.pid);
      if (!to) continue;
      const delay = startAt + k++ * step;
      setTimeout(() => FX.sound('draw'), delay);
      fly(deck, to, { w: d.pid === S.you ? to.width || 58 : MIN_W, delay, dur: 800, endScale: d.pid === S.you ? 1 : 0.7, done: () => { if (el) { el.style.opacity = ''; el.style.animation = 'land .35s'; } } });
    }
    if (d.pid === S.you) setTimeout(() => document.querySelectorAll('#hand .card').forEach((c) => { c.style.opacity = ''; }), startAt + k * 420 + 1000);
  }
}
function revealTop() { landUntil = 0; const t = document.querySelector('#disc .card.top'); if (t) { t.style.opacity = ''; t.style.animation = 'land .35s'; } }
const oldRect = (it, i) => { const c = it.prevHand[i % Math.max(1, it.prevHand.length)]; return c && it.rects[c.id] ? { rect: it.rects[c.id], card: c } : null; };

function flySwap(it) {
  const e = it.e, me = S.you; let last = 900;
  [{ from: e.a, to: e.b, n: e.na, off: 0 }, { from: e.b, to: e.a, n: e.nb, off: 220 }].forEach((l) => {
    const n = Math.min(l.n, 8);
    for (let i = 0; i < n; i++) {
      const delay = 900 + i * 380 + l.off; last = Math.max(last, delay + 1100);
      const old = l.from === me ? oldRect(it, i) : null;
      const from = old ? old.rect : seatAv(l.from), to = l.to === me ? handSlot(i) : seatAv(l.to);
      if (from && to) { setTimeout(() => FX.sound('draw'), delay); fly(from, to, { face: old ? old.card : null, w: l.to === me || l.from === me ? 58 : MIN_W, delay, dur: 1100, endScale: l.to === me ? 1 : 0.7 }); }
    }
  });
  return last;
}
function flyRotate(it) {
  const e = it.e, me = S.you, per = e.moves.length > 10 ? 2 : e.moves.length > 6 ? 3 : 4, gap = e.moves.length > 8 ? 120 : 220; let last = 900, k = 0;
  for (const m of e.moves) {
    const n = Math.min(m.n, per);
    for (let i = 0; i < n; i++) {
      const delay = 900 + k++ * gap; last = Math.max(last, delay + 1100);
      const old = m.from === me ? oldRect(it, i) : null;
      const from = old ? old.rect : seatAv(m.from), to = m.to === me ? handSlot(i) : seatAv(m.to);
      if (from && to) fly(from, to, { face: old ? old.card : null, w: m.to === me || m.from === me ? 58 : MIN_W, delay, dur: 1100, endScale: m.to === me ? 1 : 0.7 });
    }
    if (k % 3 === 0) setTimeout(() => FX.sound('draw'), 900 + k * gap);
  }
  return last;
}
function flyShuffle(it) {
  const e = it.e, me = S.you, ids = Object.keys(e.sizes), N = ids.length, per = Math.max(1, Math.min(4, Math.floor(24 / N)));
  const c = ctrRect(), centre = { left: c.left + c.width / 2 - 10, top: c.top + c.height / 2 - 10, width: 20, height: 20 };
  let k = 0, last = 900;
  // 1) everybody's cards are collected into the middle
  for (const id of ids) for (let i = 0; i < Math.min(e.sizes[id], per); i++) {
    const delay = 900 + k++ * 70; last = Math.max(last, delay + 900);
    const old = id === me ? oldRect(it, i) : null, from = old ? old.rect : seatAv(id);
    if (from) fly(from, centre, { face: old ? old.card : null, w: id === me ? 58 : MIN_W, delay, dur: 900, endScale: 0.8 });
  }
  setTimeout(() => FX.sound('draw'), 900);
  // 2) the pile is shuffled in the middle
  const rs = last + 150; setTimeout(() => riffle(centre, 1700), rs);
  // 3) and dealt out again, same counts as before
  k = 0;
  for (const id of ids) for (let i = 0; i < Math.min(e.sizes[id], per); i++) {
    const delay = rs + 1900 + k++ * 70; last = Math.max(last, delay + 900);
    const to = id === me ? handSlot(i) : seatAv(id);
    if (to) { setTimeout(() => FX.sound('draw'), delay); fly(centre, to, { w: id === me ? 58 : MIN_W, delay, dur: 900, endScale: id === me ? 1 : 0.7 }); }
  }
  return last + 200;
}
function flySteal(it) { const e = it.e, from = e.from === S.you ? null : seatAv(e.from), to = e.to === S.you ? handSlot(0) : seatAv(e.to); const f = from || seatAv(S.you); if (f && to) fly(f, to, { w: MIN_W, delay: 900, dur: 1000, endScale: 0.8 }); return 2200; }

// a quick riffle: two halves of a pile interleave a few times
function riffle(at, ms) {
  FX.sound('shuffle');
  const loops = Math.max(2, Math.round(ms / 650)), pw = 44, els = [];
  const x0 = at.left + at.width / 2, y0 = at.top + at.height / 2;
  for (let i = 0; i < 16; i++) {
    const el = backEl(); el.style.cssText += `;--cw:${pw}px;position:fixed;left:${x0 - pw / 2}px;top:${y0 - pw * 0.75}px;z-index:95;pointer-events:none;margin:0`;
    document.body.append(el); els.push(el);
    const side = i % 2 ? 1 : -1;
    el.animate(Array.from({ length: loops }).flatMap((_, L) => [
      { transform: `translate(${side * 30}px,${(i % 4) * -1}px) rotate(${side * 9}deg)`, offset: L / loops },
      { transform: `translate(${side * 30}px,${(i % 4) * -1}px) rotate(${side * 9}deg)`, offset: (L + 0.15 + (i % 8) * 0.04) / loops },
      { transform: `translate(0px,${-i * 0.8}px) rotate(${side * 2}deg)`, offset: (L + 0.5 + (i % 8) * 0.04) / loops },
    ]).concat([{ transform: `translate(0px,${-i * 0.8}px) rotate(0deg)`, offset: 1 }]), { duration: ms, easing: 'ease-in-out', fill: 'both' });
  }
  setTimeout(() => els.forEach((e) => e.remove()), ms + 100);
}

// ---------- shuffle and deal at the start of a round ----------
function maybeDeal(prev) {
  const d = S.deal;
  if (!d || S.phase !== 'playing' || d.round === dealtRound) return null;
  dealtRound = d.round;
  if (FX.lowMotion() || document.hidden || d.left < d.total * 0.5) return null;
  const order = S.players.map((p) => p.id);
  dealing = { round: d.round, counts: Object.fromEntries(order.map((id) => [id, 0])), mine: 0, flip: false, total: order.length * S.settings.handSize };
  return { d, order };
}
function runDeal({ d, order }) {
  const rd = dealing, me = S.you, H = S.settings.handSize;
  const dk = deckRect(); if (!dk.width) { dealing = null; render(); return; }
  riffle({ left: dk.left + dk.width / 2, top: dk.top + dk.height / 2, width: 0, height: 0 }, d.shuffleMs - 150);
  let i = 0;
  for (let r = 0; r < H; r++) for (const pid of order) {
    const at = d.shuffleMs + i * d.stagger, myIdx = r;
    i++;
    setTimeout(() => {
      if (dealing !== rd) return;
      const to = pid === me ? handSlot(Math.min(myIdx, Math.max(0, document.querySelectorAll('#hand .card').length - 1))) : seatAv(pid);
      if (!to) return;
      FX.sound('draw');
      fly(deckRect(), to, { w: pid === me ? 56 : MIN_W, dur: d.flightMs, endScale: pid === me ? 1 : 0.6, done: () => { if (dealing !== rd) return; rd.counts[pid]++; if (pid === me) rd.mine++; render(); } });
    }, at);
  }
  // finally the first card is turned over onto the pile
  setTimeout(() => {
    if (dealing !== rd) return;
    rd.flip = true; render();
    const to = discRect(); const t = S.top;
    landUntil = performance.now() + d.flightMs + 200; render();
    fly(deckRect(), to, { face: t, w: 46, dur: d.flightMs, rot: 4, done: () => { if (dealing !== rd) return; dealing = null; FX.sound('play'); revealTop(); render(); } });
  }, d.shuffleMs + i * d.stagger + d.flightMs + 200);
}

// ---------- wiring ----------
const myName = () => ($('name').value.trim() || localStorage.getItem('uno.name') || 'Player');
function needName() { const n = $('name').value.trim(); if (!n) { $('name').focus(); toast('Type your name first.'); return null; } localStorage.setItem('uno.name', n); return n; }
$('btnCreate').onclick = () => { const n = needName(); if (n) connect(() => tx({ t: 'create', name: n, avatar: myAvatar() || undefined })); };
$('btnJoin').onclick = () => { const n = needName(); const c = $('code').value.trim().toUpperCase(); if (!n) return; if (c.length !== 4) return toast('Enter the 4-letter code.'); session = null; connect(() => tx({ t: 'join', code: c, name: n, avatar: myAvatar() || undefined })); };
$('btnShare').onclick = share;
$('btnAv').onclick = () => pickAvatar();
$('btnLeave').onclick = () => tx({ t: 'leave' });
$('btnBot').onclick = () => tx({ t: 'bot' });
$('btnStart').onclick = () => tx({ t: 'start' });
$('btnRules').onclick = showRules;
$('btnMenu').onclick = showMenu;
$('btnLog').onclick = showLog;
$('btnReact').onclick = toggleReactTray;
$('logl').onclick = showLog;
$('btnLogX').onclick = () => overlay('ovLog', false);
for (const id of ['ovPick', 'ovRules', 'ovMenu', 'ovAv', 'ovLog']) $(id).addEventListener('click', (e) => { if (e.target.id === id) overlay(id, false); });

(async function init() {
  try { META = await (await fetch('/meta')).json(); } catch {}
  $('maxp').textContent = META.max;
  if (!myAvatar() && META.avatars && META.avatars.png.length) localStorage.setItem('uno.avatar', 'p:' + META.avatars.png[Math.floor(Math.random() * META.avatars.png.length)]);
  paintAvBtn();
  if (localStorage.getItem('uno.fx') === 'low') document.body.classList.add('lowfx');
  $('name').value = localStorage.getItem('uno.name') || '';
  const q = new URLSearchParams(location.search).get('room');
  if (q) $('code').value = q.toUpperCase().slice(0, 4);
  if (session && (!q || q.toUpperCase() === session.code)) connect();   // resume after refresh / phone sleep
  else if (q) { session = null; localStorage.removeItem('uno.session'); }
})();
