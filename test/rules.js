'use strict';
// Deterministic tests for combo play and the Wild +4 / Draw 12 challenge rules.
const assert = require('assert');
const { Game } = require('../server/game');

let n = 0, _id = -1000;
const mk = (s) => ({ id: _id--, color: null, value: null, house: null, ...s });
const num = (color, value) => mk({ type: 'num', color, value });
const wild = () => mk({ type: 'wild' });
const w4 = () => mk({ type: 'wild4' });
const d12 = () => mk({ type: 'house', house: 'draw12' });
const sniper = () => mk({ type: 'house', house: 'sniper' });

function setup(top, turn, hands, settings = {}, players = hands.length) {
  const g = new Game({ houseCards: [], ...settings });
  for (let i = 0; i < players; i++) g.addPlayer('P' + i);
  g.start();
  g.players.forEach((p, i) => { p.hand = hands[i] || [num('green', 2), num('green', 3), num('green', 4)]; p.called = false; });
  g.discard.push(top); g.color = top.color; g.turn = turn; g.dir = 1;
  g.pending = 0; g.pendingType = null; g.drawnId = null; g.challenge = null; g.unoWindow = null; g.phase = 'playing';
  return g;
}
const t = (name, fn) => { try { fn(); n++; console.log('ok  -', name); } catch (e) { console.error('FAIL -', name, '\n   ', e.message); process.exit(1); } };
const ids = (...cs) => cs.map((c) => c.id);
const throws = (fn, re) => assert.throws(fn, re);

// ---------- combos ----------
t('combo: yellow/red/blue 1s on a yellow 1, pick red', () => {
  const a = num('yellow', 1), b = num('red', 1), c = num('blue', 1), x = num('green', 9);
  const g = setup(num('yellow', 1), 0, [[a, b, c, x], [num('red', 5)]]);
  g.playMany('p1', ids(a, b, c), { color: 'red' });
  assert.equal(g.players[0].hand.length, 1);
  assert.equal(g.color, 'red');
  assert.equal(g.top.color, 'red', 'the chosen color is the card left on top');
  assert.equal(g.turn, 1);
  assert.equal(g.unoWindow, 'p1', 'down to one card without calling UNO can be caught');
  assert.equal(g.played.slice(-3).length, 3);
});
t('combo: a card matching only by color is enough (yellow 5 + red 5 on yellow 9)', () => {
  const a = num('yellow', 5), b = num('red', 5);
  const g = setup(num('yellow', 9), 0, [[a, b, num('blue', 2)], [num('red', 5)]]);
  g.playMany('p1', ids(a, b), { color: 'yellow' });
  assert.equal(g.color, 'yellow');
});
t('combo: same color pair needs no color choice', () => {
  const a = num('red', 4), b = num('red', 4);
  const g = setup(num('red', 7), 0, [[a, b, num('blue', 2)], [num('red', 5)]]);
  g.playMany('p1', ids(a, b));
  assert.equal(g.color, 'red');
});
t('combo: emptying your hand wins', () => {
  const a = num('yellow', 1), b = num('red', 1);
  const g = setup(num('yellow', 3), 0, [[a, b], [num('red', 5)]]);
  g.playMany('p1', ids(a, b), { color: 'red' });
  assert.equal(g.phase, 'ended'); assert.equal(g.winnerId, 'p1');
});
t('combo: rejects bad sets', () => {
  const a = num('red', 1), b = num('blue', 1), c = num('blue', 2), s = mk({ type: 'skip', color: 'red' });
  let g = setup(num('yellow', 5), 0, [[a, b, c, s], [num('red', 5)]]);
  throws(() => g.playMany('p1', ids(a, b), { color: 'red' }), /match the top/);       // nothing fits yellow 5
  g = setup(num('red', 5), 0, [[a, b, c, s], [num('red', 5)]]);
  throws(() => g.playMany('p1', ids(a, c), { color: 'red' }), /same number/);          // different numbers
  throws(() => g.playMany('p1', ids(a, s), { color: 'red' }), /same number/);          // not a number card
  throws(() => g.playMany('p1', ids(a, b), { color: 'green' }), /one of the colors/);  // color not in the set
  throws(() => g.playMany('p1', ids(a, b)), /one of the colors/);                      // color missing
  g = setup(num('red', 5), 0, [[a, b], [num('red', 5)]], { combos: false });
  throws(() => g.playMany('p1', ids(a, b), { color: 'red' }), /off/);
  g = setup(num('red', 5), 0, [[a, b, c], [num('red', 5)]]);
  throws(() => g.playMany('p2', ids(a, b), { color: 'red' }), /Not your turn/);
  g.pending = 2; g.pendingType = 'draw2';
  throws(() => g.playMany('p1', ids(a, b), { color: 'red' }), /penalty/);
});

// ---------- Draw 12 ----------
t('draw 12 accepted: target draws 12, play moves on', () => {
  const D = d12();
  const g = setup(num('yellow', 1), 0, [[D, num('red', 3), num('red', 8)], [num('green', 5)], [num('green', 6)]]);
  g.play('p1', D.id, { color: 'blue', target: 'p3' });
  assert.ok(g.challenge, 'challenge opened'); assert.equal(g.turn, 0, 'turn waits');
  throws(() => g.play('p1', g.players[0].hand[0].id, { color: 'red' }), /Waiting/);
  throws(() => g.respond('p2', true), /not your call/);
  g.respond('p3', false);
  assert.equal(g.players[2].hand.length, 1 + 12);
  assert.equal(g.current.id, 'p2', 'next in order plays, target is not skipped nor forced');
  assert.equal(g.color, 'blue');
});
t('draw 12 caught: a wild in hand counts as a legal alternative, thrower draws 16', () => {
  const D = d12(), W = wild();
  const g = setup(num('yellow', 1), 0, [[D, W, num('red', 8)], [num('green', 5)], [num('green', 6)]]);
  g.play('p1', D.id, { color: 'blue', target: 'p2' });
  g.respond('p2', true);
  assert.equal(g.players[0].hand.length, 2 + 16);
  assert.equal(g.players[1].hand.length, 1, 'target draws nothing');
  assert.equal(g.event.type, 'busted'); assert.equal(g.event.card.id, W.id, 'the offending card is revealed');
  assert.equal(g.current.id, 'p2');
});
t('draw 12 caught: a color-matching card also counts', () => {
  const D = d12(), Y = num('yellow', 7);
  const g = setup(num('yellow', 1), 0, [[D, Y], [num('green', 5)], [num('green', 6)]]);
  g.play('p1', D.id, { color: 'red', target: 'p2' }); g.respond('p2', true);
  assert.equal(g.players[0].hand.length, 1 + 16);
});
t('draw 12 honest play, wrong challenge: challenger draws 16', () => {
  const D = d12();
  const g = setup(num('yellow', 1), 0, [[D, num('red', 3), mk({ type: 'draw2', color: 'blue' })], [num('green', 5)], [num('green', 6)]]);
  g.play('p1', D.id, { color: 'red', target: 'p2' }); g.respond('p2', true);
  assert.equal(g.players[1].hand.length, 1 + 16);
  assert.equal(g.players[0].hand.length, 2);
  assert.equal(g.event.type, 'failed');
  assert.equal(g.current.id, 'p2');
});
t('draw 12: another Draw 12 in hand is NOT an alternative', () => {
  const D = d12(), E = d12();
  const g = setup(num('yellow', 1), 0, [[D, E, num('red', 3)], [num('green', 5)], [num('green', 6)]]);
  g.play('p1', D.id, { color: 'red', target: 'p2' }); g.respond('p2', true);
  assert.equal(g.players[1].hand.length, 1 + 16, 'honest, so the challenger pays');
});
t('draw 12 as your last card wins at once, no challenge', () => {
  const D = d12();
  const g = setup(num('yellow', 1), 0, [[D], [num('green', 5)]]);
  g.play('p1', D.id, { color: 'red', target: 'p2' });
  assert.equal(g.phase, 'ended'); assert.equal(g.challenge, null);
});
t('draw 12 is not playable under a stacked draw penalty', () => {
  const D = d12();
  const g = setup(num('yellow', 1), 0, [[D, mk({ type: 'draw2', color: 'red' })], [num('green', 5)]], { stacking: true });
  g.pending = 2; g.pendingType = 'draw2';
  assert.ok(!g.playableIds(g.players[0]).includes(D.id));
});
t('draw 12 is left out of the deck when challenge rules are off', () => {
  const g = new Game({ challenges: false });
  g.addPlayer('a'); g.addPlayer('b'); g.start();
  const all = [...g.drawPile, ...g.players.flatMap((p) => p.hand)];
  assert.ok(!all.some((c) => c.house === 'draw12'));
  const h = new Game({ challenges: true }); h.addPlayer('a'); h.addPlayer('b'); h.start();
  assert.equal([...h.drawPile, ...h.players.flatMap((p) => p.hand)].filter((c) => c.house === 'draw12').length, 1, 'one copy per deck');
});

// ---------- Wild +4 ----------
t('wild +4 caught (held a card of the current color): thrower draws 4, target not skipped', () => {
  const W = w4();
  const g = setup(num('red', 1), 0, [[W, num('red', 9), num('blue', 3)], [num('green', 5)], [num('green', 6)]]);
  g.play('p1', W.id, { color: 'blue' });
  assert.equal(g.challenge.target, 'p2');
  g.respond('p2', true);
  assert.equal(g.players[0].hand.length, 2 + 4);
  assert.equal(g.current.id, 'p2');
});
t('wild +4 legal, wrong challenge: challenger draws 6 and is skipped', () => {
  const W = w4();
  const g = setup(num('red', 1), 0, [[W, num('blue', 9)], [num('green', 5)], [num('green', 6)]]);
  g.play('p1', W.id, { color: 'blue' }); g.respond('p2', true);
  assert.equal(g.players[1].hand.length, 1 + 6);
  assert.equal(g.current.id, 'p3');
});
t('wild +4 accepted: draws 4 and is skipped (or stacks)', () => {
  const W = w4();
  let g = setup(num('red', 1), 0, [[W, num('blue', 9)], [num('green', 5)], [num('green', 6)]]);
  g.play('p1', W.id, { color: 'blue' }); g.respond('p2', false);
  assert.equal(g.players[1].hand.length, 1 + 4); assert.equal(g.current.id, 'p3');
  const W2 = w4();
  g = setup(num('red', 1), 0, [[W2, num('blue', 9)], [num('green', 5)], [num('green', 6)]], { stacking: true });
  g.play('p1', W2.id, { color: 'blue' }); g.respond('p2', false);
  assert.equal(g.pending, 4); assert.equal(g.current.id, 'p2');
});
t('wild +4 with challenge rules off behaves as before', () => {
  const W = w4();
  const g = setup(num('red', 1), 0, [[W, num('red', 9)], [num('green', 5)], [num('green', 6)]], { challenges: false });
  g.play('p1', W.id, { color: 'blue' });
  assert.equal(g.challenge, null); assert.equal(g.players[1].hand.length, 1 + 4); assert.equal(g.current.id, 'p3');
});
t('stacking a +4 onto a pending +4 is not challengeable', () => {
  const W = w4();
  const g = setup(num('red', 1), 0, [[W, num('red', 9)], [num('green', 5)], [num('green', 6)]], { stacking: true });
  g.pending = 4; g.pendingType = 'wild4';
  g.play('p1', W.id, { color: 'blue' });
  assert.equal(g.challenge, null); assert.equal(g.pending, 8);
});

// ---------- safety ----------
t('the view never leaks whether the thrower was bluffing', () => {
  const D = d12();
  const g = setup(num('yellow', 1), 0, [[D, wild()], [num('green', 5)], [num('green', 6)]]);
  g.play('p1', D.id, { color: 'red', target: 'p2' });
  for (const id of ['p1', 'p2', 'p3']) { const s = JSON.stringify(g.view(id)); assert.ok(!/hadAlt|proof/.test(s)); assert.ok(s.includes('"challenge":{')); }
});
t('target leaves mid-challenge: challenge cleared and play continues', () => {
  const D = d12();
  const g = setup(num('yellow', 1), 0, [[D, num('red', 3)], [num('green', 5)], [num('green', 6)]]);
  g.play('p1', D.id, { color: 'red', target: 'p3' });
  g.removePlayer('p3');
  assert.equal(g.challenge, null); assert.equal(g.current.id, 'p2');
});
t('thrower leaves mid-challenge: challenge cleared, next player plays', () => {
  const D = d12();
  const g = setup(num('yellow', 1), 0, [[D, num('red', 3)], [num('green', 5)], [num('green', 6)]]);
  g.play('p1', D.id, { color: 'red', target: 'p3' });
  g.removePlayer('p1');
  assert.equal(g.challenge, null); assert.equal(g.current.id, 'p2');
});
t('UNO catch window still works when the last-but-one card is a Draw 12', () => {
  const D = d12(), x = num('red', 3);
  const g = setup(num('yellow', 1), 0, [[D, x], [num('green', 5)], [num('green', 6)]]);
  g.play('p1', D.id, { color: 'red', target: 'p2' });
  assert.equal(g.unoWindow, 'p1');
  g.catchUno('p3');
  assert.equal(g.players[0].hand.length, 3);
});


// ---------- draw until you can play ----------
t('draw-until: with nothing playable you keep drawing until a card fits', () => {
  const g = setup(num('yellow', 1), 0, [[num('red', 5), num('green', 7)], [num('green', 5)]]);
  const fit = num('yellow', 9), junk1 = num('red', 2), junk2 = num('blue', 4);
  g.drawPile.push(fit, junk2, junk1); // pop order: junk1, junk2, fit
  g.draw(g.players[0].id);
  assert.equal(g.players[0].hand.length, 5, 'drew 3');
  assert.equal(g.drawnId, fit.id, 'the fitting card is the drawn card');
  assert.equal(g.turn, 0, 'still my turn, I may play it');
  g.play(g.players[0].id, fit.id);
  assert.equal(g.turn, 1);
});
t('draw-until: holding a playable card, a voluntary draw is a single card', () => {
  const g = setup(num('yellow', 1), 0, [[num('yellow', 5), num('green', 7)], [num('green', 5)]]);
  g.drawPile.push(num('blue', 4), num('red', 2));
  g.draw(g.players[0].id);
  assert.equal(g.players[0].hand.length, 3); assert.equal(g.turn, 1, 'unplayable draw passes the turn');
});
t('draw-until off: one card, then the turn passes if it does not fit', () => {
  const g = setup(num('yellow', 1), 0, [[num('red', 5)], [num('green', 5)]], { drawUntil: false });
  g.drawPile.push(num('blue', 4), num('red', 2));
  g.draw(g.players[0].id);
  assert.equal(g.players[0].hand.length, 2); assert.equal(g.turn, 1);
});
t('draw-until: a stacked penalty is still drawn exactly, no chasing', () => {
  const g = setup(num('yellow', 1), 0, [[num('red', 5)], [num('green', 5)]], { stacking: true });
  g.pending = 2; g.pendingType = 'draw2';
  g.drawPile.push(num('yellow', 9), num('yellow', 8), num('yellow', 7));
  g.draw(g.players[0].id);
  assert.equal(g.players[0].hand.length, 3); assert.equal(g.turn, 1);
});
t('draw-until: ends cleanly when the deck and discards run out', () => {
  const g = setup(num('yellow', 1), 0, [[num('red', 5)], [num('green', 5)]]);
  g.drawPile.length = 0; g.discard.length = 1;
  g.draw(g.players[0].id);
  assert.equal(g.turn, 1);
});

// ---------- pacing data, events, shuffle / swap / rotate ----------
t('events: queue keeps order and every event carries a duration', () => {
  const g = setup(num('yellow', 1), 0, [[num('yellow', 2), num('red', 3)], [num('green', 5)]]);
  g.emit('skip', { who: 'x' }); g.emit('draw', { to: 'x', n: 12 }); g.emit('draw', { to: 'x', n: 2 }); g.emit('draw', { to: 'x', n: 6, self: true });
  const ev = g.view(g.players[0].id).events;
  assert.deepEqual(ev.slice(-4).map((e) => e.dur), [1800, 2400, 0, 0]);
  assert.ok(ev.every((e, i) => i === 0 || e.seq > ev[i - 1].seq));
});
t('start: deal timing is published (shuffle, one card at a time, flip)', () => {
  const g = setup(num('yellow', 1), 0, [[num('yellow', 2)], [num('red', 3)]]);
  g.start(); const d = g.view(g.players[0].id).deal;
  assert.ok(d.round >= 1 && d.stagger >= 70 && d.stagger <= 240 && d.total > d.shuffleMs + d.flipMs);
});
t('shuffle hands: everyone keeps their count, event lists the sizes, log names them', () => {
  const sh = mk({ type: 'house', house: 'shuffle' });
  const g = setup(num('yellow', 1), 0, [[sh, num('red', 3), num('red', 4)], [num('green', 5)], [num('blue', 1), num('blue', 2), num('blue', 3)]], { houseCards: ['shuffle'] });
  g.play(g.players[0].id, sh.id, { color: 'red' });
  assert.deepEqual(g.players.map((p) => p.hand.length), [2, 1, 3]);
  const e = g.event; assert.equal(e.type, 'shuffle'); assert.deepEqual(Object.values(e.sizes), [2, 1, 3]);
  assert.ok(g.log.some((l) => /same number of cards/.test(l)));
});
t('swap hands: event names both players and the cards that moved', () => {
  const sw = mk({ type: 'house', house: 'swap' });
  const g = setup(num('yellow', 1), 0, [[sw, num('red', 3), num('red', 4)], [num('green', 5)]], { houseCards: ['swap'] });
  const [a, b] = g.players.map((p) => p.id);
  g.play(a, sw.id, { color: 'red', target: b });
  assert.equal(g.event.type, 'swap'); assert.equal(g.event.a, a); assert.equal(g.event.b, b);
  assert.equal(g.players[0].hand.length, 1); assert.equal(g.players[1].hand.length, 2);
  assert.equal(g.event.na, 2, 'two cards travelled a to b'); assert.equal(g.event.nb, 1);
});
t('rotate: event lists every pass in the play direction', () => {
  const ro = mk({ type: 'house', house: 'rotate' });
  const g = setup(num('yellow', 1), 0, [[ro, num('red', 3)], [num('green', 5)], [num('blue', 1), num('blue', 2)]], { houseCards: ['rotate'] });
  g.play(g.players[0].id, ro.id, { color: 'red' });
  const m = g.event.moves; assert.equal(g.event.type, 'rotate'); assert.equal(m.length, 3);
  assert.deepEqual(m.map((x) => x.n), [1, 1, 2]);
  assert.equal(m[0].to, g.players[1].id); assert.equal(m[2].to, g.players[0].id);
});
t('pickpocket emits a steal event', () => {
  const pp = mk({ type: 'house', house: 'pickpocket' });
  const g = setup(num('yellow', 1), 0, [[pp, num('red', 3)], [num('green', 5), num('green', 6)]], { houseCards: ['pickpocket'] });
  g.play(g.players[0].id, pp.id, { color: 'red', target: g.players[1].id });
  assert.equal(g.event.type, 'steal'); assert.equal(g.event.from, g.players[1].id);
});

// ---------- spy, color lock, match mode, awards ----------
t('spy: only the spy sees the hand, everyone is told, it ends on the spy\'s next turn', () => {
  const sp = mk({ type: 'house', house: 'spy' });
  const g = setup(num('yellow', 1), 0, [[sp, num('red', 3), num('red', 4)], [num('red', 6), num('green', 5)], [num('red', 7), num('blue', 2)]], { houseCards: ['spy'] });
  const [a, b, c] = g.players.map((p) => p.id);
  const b6 = g.players[1].hand[0], c7 = g.players[2].hand[0];
  g.play(a, sp.id, { color: 'red', target: b });
  assert.equal(g.event.type, 'spy');
  assert.deepEqual(g.view(a).spy.hand.map((x) => x.id), g.players[1].hand.map((x) => x.id));
  assert.equal(g.view(b).spy, null); assert.equal(g.view(c).spy, null);
  g.play(b, b6.id); g.play(c, c7.id);       // turn comes round to a again
  assert.equal(g.view(a).spy, null, 'peek is over');
});
t('color lock: nobody can change the color until the locker plays again', () => {
  const lk = mk({ type: 'house', house: 'colorlock' }), w = wild();
  const g = setup(num('yellow', 1), 0, [[lk, num('red', 3), num('red', 4)], [w, num('green', 5)], [num('red', 9), num('blue', 2)]], { houseCards: ['colorlock'] });
  const [a, b, c] = g.players.map((p) => p.id);
  g.play(a, lk.id, { color: 'red' });
  assert.equal(g.color, 'red'); assert.equal(g.lock.by, a);
  assert.equal(g.view(c).lock.color, 'red');
  g.play(b, w.id, { color: 'blue' });
  assert.equal(g.color, 'red', 'the wild could not change the color');
  assert.ok(g.log.some((l) => /locked, the color stays/.test(l)));
  g.play(c, g.players[2].hand[0].id);
  assert.equal(g.lock, null, 'lock ends when it is the locker\'s turn again'); assert.equal(g.turn, 0);
});
t('match mode: first to N round wins, then a new match starts from zero', () => {
  const g = setup(num('yellow', 1), 0, [[num('yellow', 2)], [num('green', 5)]], { match: 2 });
  g.play(g.players[0].id, g.players[0].hand[0].id);
  assert.equal(g.players[0].wins, 1); assert.equal(g.matchWinner, null);
  g.start(); g.players[0].hand = [num(g.color, 2)]; g.turn = 0; g.drawnId = null; g.play(g.players[0].id, g.players[0].hand[0].id);
  assert.equal(g.matchWinner, g.players[0].id); assert.equal(g.view(g.players[1].id).matchWinner, g.players[0].id);
  g.start(); assert.equal(g.matchWinner, null); assert.deepEqual(g.players.map((p) => p.wins), [0, 0]);
});
t('awards: earned from real stats, nothing invented', () => {
  const a = num('yellow', 2), b = num('red', 2);
  const g = setup(num('yellow', 1), 0, [[a, b, num('green', 7)], [num('green', 5), num('green', 6), num('green', 8), num('green', 9), num('green', 4), num('green', 3), num('green', 2), num('green', 1)]], {});
  g.stats = {};
  g.drawPile.push(...Array.from({ length: 5 }, () => num('blue', 9)));
  g.drawInto(g.players[1], 5);
  g.playMany(g.players[0].id, [a.id, b.id], { color: 'red' });
  g.players[0].hand = [num('red', 4)]; g.turn = 0;
  g.play(g.players[0].id, g.players[0].hand[0].id);
  const names = g.awards.map((x) => x.title);
  assert.ok(names.includes('Card Magnet') && names.includes('Combo King') && names.includes('Card Hoarder'), names.join());
  const mag = g.awards.find((x) => x.title === 'Card Magnet'); assert.equal(mag.who, g.players[1].id);
  const none = setup(num('yellow', 1), 0, [[num('yellow', 2)], [num('green', 5)]]); none.play(none.players[0].id, none.players[0].hand[0].id);
  assert.deepEqual(none.awards, [], 'a quiet round earns no awards');
});

// ---------- owner's private opening hand ----------
const { isVip, norm } = require('../server/vip');
t('vip: only the owner\'s handle plus the secret key unlocks it', () => {
  for (const n of ['ANI_MrPaul_72', 'Ani_Paul', 'Onu_Paul', 'ANI_PAUL', 'ANU_PAUL', 'ANI_Mr Paul_72', 'ANU_72', 'anu 72', 'ani-paul']) assert.equal(isVip(n, 'k3y', 'k3y'), true, n);
  assert.equal(isVip('ANU_72', 'wrong', 'k3y'), false, 'right name, wrong key');
  assert.equal(isVip('Sam', 'k3y', 'k3y'), false, 'right key, other name');
  assert.equal(isVip('ANU_72', undefined, 'k3y'), false);
  assert.equal(isVip('ANU_72', 'anything', undefined), false, 'no secret set means the feature is off');
  assert.equal(isVip('ANU_72', '', ''), false);
});
t('vip: 4 strong cards plus normal ones, hand size unchanged, nobody else affected', () => {
  const g = new Game({ handSize: 7, challenges: false });
  const v = g.addPlayer('ANU_72', { vip: true }), o = g.addPlayer('Sam'); g.start();
  assert.equal(v.hand.length, 7); assert.equal(o.hand.length, 7);
  const sp = v.hand.filter((c) => g.vipIds.has(c.id));
  assert.equal(sp.length, 4); assert.ok(sp.some((c) => c.house === 'draw12'), 'Draw 12 is always there');
  assert.equal(new Set(sp.map((c) => c.house || c.type)).size, 4, 'four different cards');
  assert.ok(o.hand.every((c) => !g.vipIds.has(c.id)));
  assert.ok(!('vip' in g.view(o.id).players.find((p) => p.id === v.id)), 'the flag is never sent to phones');
  assert.ok(!JSON.stringify(g.view(o.id)).includes('"vip"'));
});
t('vip: a small hand is all special cards', () => {
  const g = new Game({ handSize: 3 });
  const v = g.addPlayer('Onu_Paul', { vip: true }); g.addPlayer('Sam'); g.start();
  assert.equal(v.hand.length, 3); assert.ok(v.hand.every((c) => g.vipIds.has(c.id)));
});
t('vip: the extra cards vanish when played instead of being shuffled into the deck', () => {
  const g = new Game({ handSize: 5 }); const v = g.addPlayer('ANU_72', { vip: true }); g.addPlayer('Sam'); g.start();
  const total = () => g.drawPile.length + g.discard.length + g.players.reduce((a, p) => a + p.hand.length, 0);
  const ids = [...g.vipIds]; g.discard.push(...g.players[0].hand.filter((c) => g.vipIds.has(c.id)));
  g.players[0].hand = g.players[0].hand.filter((c) => !g.vipIds.has(c.id));
  g.discard.push(num('red', 1));            // a normal card is now on top of the pile
  g.drawPile.length = 0; g.refill();
  assert.ok(![...g.drawPile, ...g.discard].some((c) => ids.includes(c.id)), 'vip cards are gone for good');
});
t('vip: Draw 12 works even with challenges switched off', () => {
  const d12 = mk({ type: 'house', house: 'draw12' });
  const g = setup(num('yellow', 1), 0, [[d12, num('red', 3)], [num('green', 5)]], { challenges: false });
  g.play(g.players[0].id, d12.id, { color: 'red', target: g.players[1].id });
  assert.equal(g.players[1].hand.length, 13);
});

// ---------- avatars and rooms ----------
{
  const { cleanAvatar, AVATAR_PNG, ROOMS } = require('../server/game');
  t('avatars: only listed emoji / PNG names are accepted', () => {
    assert.equal(cleanAvatar('e:🦊'), 'e:🦊'); assert.equal(cleanAvatar('p:fox'), 'p:fox');
    for (const bad of ['p:../../etc/passwd', 'e:<script>', 'x:fox', 'p:', '', null, 42, 'p:fox.png', 'e:🦊🦊']) assert.equal(cleanAvatar(bad), null, String(bad));
    const g = new Game(); const a = g.addPlayer('A', { avatar: 'javascript:alert(1)' });
    assert.ok(AVATAR_PNG.includes(a.avatar.slice(2)), 'invalid avatar falls back to a real one');
    assert.equal(g.addPlayer('Bot', { bot: true }).avatar, 'p:robot');
    g.setAvatar(a.id, 'e:🐙'); assert.equal(g.byId(a.id).avatar, 'e:🐙');
    throws(() => g.setAvatar(a.id, 'p:nope'), /not available/);
    assert.equal(g.view(a.id).players[0].avatar, 'e:🐙');
  });
  t('rooms: six backdrops, living room is the default', () => { assert.equal(ROOMS.length, 6); assert.equal(new Game().settings.room, 'living'); });
  console.log(`\n${n} rule tests passed`);
}
