'use strict';
// Plays many random bot games and checks invariants after every single move.
const { Game, HOUSE_CARDS, botMove, apply, MAX_PLAYERS } = require('../server/game');

const rnd = (n) => Math.floor(Math.random() * n);
let games = 0, finished = 0, stalled = 0, moves = 0;
const played = {}; // house card usage counter
const errors = [];

function total(g) { return g.drawPile.length + g.discard.length + g.players.reduce((s, p) => s + p.hand.length, 0); }

for (let n = 0; n < 3000; n++) {
  const np = 2 + rnd(MAX_PLAYERS - 1);
  const keys = Object.keys(HOUSE_CARDS).filter(() => Math.random() < 0.7);
  const g = new Game({ stacking: Math.random() < 0.5, houseCards: keys, handSize: 7 });
  for (let i = 0; i < np; i++) g.addPlayer('P' + i, { bot: false });
  g.start();
  const startTotal = total(g);
  const ids = new Set();
  [...g.drawPile, ...g.discard, ...g.players.flatMap((p) => p.hand)].forEach((c) => { if (ids.has(c.id)) errors.push('dup id'); ids.add(c.id); });
  games++;
  let steps = 0;
  try {
    while (g.phase === 'playing' && steps < 6000) {
      const p = g.current;
      // sometimes a random player calls UNO or catches, like real people
      if (Math.random() < 0.3 && p.hand.length <= 2) g.callUno(p.id);
      if (g.unoWindow && Math.random() < 0.5) { const o = g.players.find((q) => q.id !== g.unoWindow); g.catchUno(o.id); }
      const a = botMove(g, p.id);
      if (a.kind === 'play') { const c = p.hand.find((x) => x.id === a.cardId); if (c.house) played[c.house] = (played[c.house] || 0) + 1; }
      apply(g, p.id, a);
      steps++; moves++;
      // late joiner / leaver now and then
      if (Math.random() < 0.01 && g.players.length < MAX_PLAYERS && g.phase === 'playing') { g.addPlayer('Late' + steps); }
      if (Math.random() < 0.005 && g.players.length > 3 && g.phase === 'playing') { g.removePlayer(g.players[rnd(g.players.length)].id); }
      const t = total(g);
      const dec = g.players.length; // late joiners add cards, so only check for ids/size sanity
      const all = [...g.drawPile, ...g.discard, ...g.players.flatMap((q) => q.hand)];
      if (new Set(all.map((c) => c.id)).size !== all.length) throw new Error('duplicate card ids mid-game');
      if (all.length > startTotal + 0) throw new Error('cards were created from nothing');
      if (g.turn < 0 || g.turn >= g.players.length) throw new Error('turn out of range');
    }
    if (g.phase === 'ended') {
      finished++;
      if (g.byId(g.winnerId).hand.length !== 0) throw new Error('winner still has cards');
    } else if (g.phase === 'playing') stalled++;
  } catch (e) { errors.push(`game ${n} (${np}p): ${e.message}`); if (errors.length > 5) break; }
}
console.log({ games, finished, stalled, moves });
console.log('house cards played:', played);
if (errors.length) { console.log('ERRORS', errors); process.exit(1); }
console.log('OK: no invariant violations');
