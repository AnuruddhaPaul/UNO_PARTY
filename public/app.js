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
let prevTurn = null;

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
  } else if (m.t === 'state') { S = m; recvAt = performance.now(); render(); keepAwake(); }
  else if (m.t === 'error') {
    toast(m.msg);
    if (m.code === 'noroom') { session = null; localStorage.removeItem('uno.session'); S = null; paintScene(false); show('home'); }
  } else if (m.t === 'kicked' || m.t === 'left') { leaveLocal(); if (m.t === 'kicked') toast('You were removed from the room.'); }
}
function leaveLocal() { session = null; S = null; selIds = []; lastSeq = undefined; localStorage.removeItem('uno.session'); history.replaceState(null, '', location.pathname); overlay('ovEnd', false); overlay('ovMenu', false); paintScene(false); show('home'); }

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
  if (lastSeq === undefined) lastSeq = S.event ? S.event.seq : 0;
  else if (S.event && S.event.seq > lastSeq) { lastSeq = S.event.seq; showEvent(S.event); }
  if (S.phase === 'lobby') { paintScene(false); show('lobby'); overlay('ovEnd', false); overlay('ovChallenge', false); renderLobby(); }
  else { show('table'); renderTable(me); }
}

function toggleRow(title, desc, on, fn, ro) {
  return h('div', { class: 'tog' + (ro ? ' ro' : ''), onclick: ro ? null : fn }, h('div', { class: 't' }, h('b', {}, title), h('span', {}, desc)), h('div', { class: 'sw' + (on ? ' on' : '') }));
}

function renderLobby() {
  const isHost = S.host === S.you, set = S.settings;
  $('lcode').textContent = session ? session.code : '';
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
    toggleRow('Stack +2 / +4', 'Answer a +2 with another +2 (or +4 with +4) and pass the penalty on.', set.stacking, () => send({ stacking: !set.stacking }), ro),
    toggleRow('Combo play', 'Play two or more cards with the same number together, even in different colors. At least one must match the top card, and you pick which of those colors stays.', set.combos, () => send({ combos: !set.combos }), ro),
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
    const i = (meIdx + k) % L, p = S.players[i];
    const a = Math.PI / 2 + (k * 2 * Math.PI) / L;
    const x = g.W / 2 + g.rx * Math.cos(a), y = g.H / 2 + g.ry * Math.sin(a);
    const el = h('div', { class: 'seat' + (g.compact ? ' c' : '') + (p.id === cur && S.phase === 'playing' ? ' cur' : '') + (p.id === S.you ? ' me' : '') + (p.connected || p.bot ? '' : ' off'), 'data-pid': p.id, style: `left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;--sc:${SEAT_HUES[i % 15]}` });
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
    if (p.count === 1) el.append(h('div', { class: 'tag' }, 'UNO'));
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
  // discard pile: a few UNO backs peeking out under the face-up top card
  const under = Math.min(3, Math.max(0, S.played.length - 1)), n = S.played.length;
  const kids = [];
  for (let k = under; k >= 1; k--) { const e = backEl(); const r = ((n * 53 + k * 37) % 40) - 20; e.style.transform = `rotate(${r}deg) translate(${(k % 2 ? -1 : 1) * 2}px,${k}px)`; kids.push(e); }
  const top = cardOnTable(S.top); top.classList.add('top'); top.style.transform = `rotate(${((n * 29) % 14) - 7}deg)`;
  if (lastTop !== S.top.id && lastTop !== null) { FX.sound('play'); top.style.animation = 'pop .3s'; }
  lastTop = S.top.id;
  kids.push(top);
  if (S.pending) kids.push(h('div', { class: 'pend' }, '+' + S.pending));
  $('disc').replaceChildren(...kids);
  const cp = $('cpill'); cp.className = 'cpill ' + S.color; cp.textContent = CNAME[S.color];
}

function renderTable(me) {
  $('tcode').textContent = session ? session.code : '';
  paintScene(true);
  const myTurn = S.turn === S.you && S.phase === 'playing';
  renderSeats(me);
  renderCenter();

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
  bn.dataset.base = S.phase !== 'playing' ? '' : ch ? (ch.target === S.you ? 'Your call: accept or challenge?' : `${chT ? chT.name : ''} must accept or challenge…`) : myTurn ? (S.drawnId ? 'Play the drawn card or pass' : S.pending ? `Stack a draw card or take +${S.pending}` : 'Your turn') : `${cur ? cur.name : ''}'s turn${cur && !cur.connected && !cur.bot ? ' (offline)' : ''}`;
  tickTimer();
  $('logl').replaceChildren(...S.log.slice(-2).map((t) => h('div', {}, t)));
  if (myTurn && prevTurn !== S.you) { if (navigator.vibrate) navigator.vibrate(120); FX.sound('turn'); }
  prevTurn = S.turn;

  // hand
  const hand = $('hand'), sx = hand.scrollLeft;
  const sorted = [...S.hand].sort((a, b) => colorIdx(a) - colorIdx(b) || ORDER[a.type] - ORDER[b.type] || (a.value || 0) - (b.value || 0));
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
  else if (S.canDraw && !sc.length) acts.append(h('button', { onclick: doDraw }, S.pending ? `Draw ${S.pending}` : 'Draw'));

  renderChallenge();
  renderEnd();
}

function doDraw() { if (S && S.canDraw) tx({ t: 'draw' }); else if (S && S.phase === 'playing') toast(S.turn === S.you ? 'Play or pass first.' : 'Not your turn.'); }

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
function showEvent(e) {
  const nm = (id) => { const p = S.players.find((q) => q.id === id); return p ? p.name : 'Someone'; };
  const box = $('evt'); let kids = null;
  if (e.type === 'reverse') kids = [e.dir === 1 ? '↻ REVERSE' : '↺ REVERSE'];
  else if (e.type === 'skip') kids = [`⊘ ${nm(e.who)} is skipped`];
  else if (e.type === 'combo') kids = [`COMBO × ${e.n}!`];
  else if (e.type === 'draw' && e.n >= 4) kids = [`${nm(e.to)} draws ${e.n}!`];
  else if (e.type === 'busted') kids = ['🚨 BUSTED!', h('div', { style: 'font-size:14px;font-weight:600' }, `${nm(e.by)} was holding`), cardEl(e.card, { info: false }), `${nm(e.by)} draws ${e.n}`];
  else if (e.type === 'failed') kids = [`Wrong call! ${nm(e.to)} draws ${e.n}`];
  const seat = (id) => document.querySelector(`.seat[data-pid="${id}"]`);
  const at = (id, el) => { const s = seat(id); if (!s) return; el.style.left = s.style.left; el.style.top = s.style.top; $('fxl').append(el); setTimeout(() => el.remove(), 2800); };
  if (e.type === 'reverse') FX.sound('reverse');
  if (e.type === 'draw') { FX.sound('draw'); if (e.n >= 12) { FX.sound('storm'); $('flash').classList.remove('on'); void $('flash').offsetWidth; $('flash').classList.add('on'); const st = $('stage'); st.classList.remove('shk'); void st.offsetWidth; st.classList.add('shk'); at(e.to, h('div', { class: 'cloud' }, '⛈️', h('span', {}, '⚡'))); } }
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
  const left = S.ms && actor && !actor.bot && actor.connected ? Math.max(0, Math.ceil((S.ms - (performance.now() - recvAt)) / 1000)) : 0;
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
    h('h2', { style: 'margin:6px 0' }, w ? (w.id === S.you ? 'You win!' : `${w.name} wins!`) : 'Round over'),
    h('div', { class: 'plist', style: 'margin:14px 0;text-align:left' }, board.map((p) => h('div', { class: 'pl' }, h('span', { class: 'nm' }, p.name + (p.id === S.you ? ' (you)' : '')), h('small', {}, `${p.count} left`), h('b', {}, `🏆 ${p.wins}`)))),
    isHost ? h('div', {}, h('button', { class: 'primary', style: 'width:100%;margin-bottom:8px', onclick: () => tx({ t: 'start' }) }, 'Next round'), h('button', { style: 'width:100%', onclick: () => tx({ t: 'lobby' }) }, 'Back to lobby / change rules')) : h('p', { class: 'sub' }, 'Waiting for the host…'));
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
for (const id of ['ovPick', 'ovRules', 'ovMenu', 'ovAv']) $(id).addEventListener('click', (e) => { if (e.target.id === id) overlay(id, false); });

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
