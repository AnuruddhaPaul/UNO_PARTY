'use strict';
// Plays many random bot games and checks invariants after every single move.
const { Game, HOUSE_CARDS, botMove, apply, MAX_PLAYERS } = require('../server/game');

const rnd = (n) => Math.floor(Math.random() * n);
let games = 0, finished = 0, stalled = 0, moves = 0;
const used = {}; const errors = [];
const COLORS = ['red', 'yellow', 'green', 'blue'];

for (let n = 0; n < 3000; n++) {
  const np = 2 + rnd(MAX_PLAYERS - 1);
  const keys = Object.keys(HOUSE_CARDS).filter(() => Math.random() < 0.7);
  const g = new Game({ stacking: Math.random() < 0.5, combos: Math.random() < 0.8, challenges: Math.random() < 0.7, houseCards: keys, handSize: 7 });
  for (let i = 0; i < np; i++) g.addPlayer('P' + i);
  g.start();
  const startTotal = g.drawPile.length + g.discard.length + g.players.reduce((s, p) => s + p.hand.length, 0);
  games++;
  let steps = 0;
  try {
    while (g.phase === 'playing' && steps < 6000) {
      steps++; moves++;
      if (g.challenge) {                       // the target answers: bluff-callers and trusters mixed
        const c = g.challenge; const t = c.target;
        const callIt = Math.random() < 0.5;
        used[c.kind + (callIt ? (c.hadAlt ? ':caught' : ':failed') : ':accepted')] = (used[c.kind + (callIt ? (c.hadAlt ? ':caught' : ':failed') : ':accepted')] || 0) + 1;
        // while a challenge is open nobody may act, except UNO calls / catches
        try { g.play(g.current.id, g.current.hand[0].id, { color: 'red', target: t }); errors.push('acted during challenge'); } catch (e) { /* expected */ }
        g.respond(t, callIt);
      } else {
        const p = g.current;
        if (Math.random() < 0.3 && p.hand.length <= 2) g.callUno(p.id);
        if (g.unoWindow && Math.random() < 0.5) { const o = g.players.find((q) => q.id !== g.unoWindow); g.catchUno(o.id); }
        const a = botMove(g, p.id);
        if (a.kind === 'play') { const c = p.hand.find((x) => x.id === a.cardId); if (c.house) used[c.house] = (used[c.house] || 0) + 1; }
        if (a.kind === 'combo') used.combo = (used.combo || 0) + 1;
        apply(g, p.id, a);
        // human-style misplays must be rejected, never corrupt state
        if (Math.random() < 0.05) { try { g.playMany(p.id, p.hand.slice(0, 3).map((c) => c.id), { color: 'purple' }); } catch (e) { /* fine */ } }
      }
      if (Math.random() < 0.01 && g.players.length < MAX_PLAYERS && g.phase === 'playing') g.addPlayer('Late' + steps);
      if (Math.random() < 0.005 && g.players.length > 3 && g.phase === 'playing') g.removePlayer(g.players[rnd(g.players.length)].id);
      const all = [...g.drawPile, ...g.discard, ...g.players.flatMap((q) => q.hand)];
      if (new Set(all.map((c) => c.id)).size !== all.length) throw new Error('duplicate card ids mid-game');
      if (all.length > startTotal) throw new Error('cards were created from nothing');
      if (g.turn < 0 || g.turn >= g.players.length) throw new Error('turn out of range');
      if (g.challenge && !g.byId(g.challenge.target)) throw new Error('challenge points at a missing player');
      if (!g.settings.challenges && all.some((c) => c.house === 'draw12')) throw new Error('draw12 in deck with challenges off');
    }
    if (g.phase === 'ended') { finished++; if (g.byId(g.winnerId).hand.length !== 0) throw new Error('winner still has cards'); }
    else if (g.phase === 'playing') stalled++;
  } catch (e) { errors.push(`game ${n} (${np}p): ${e.stack.split('\n').slice(0, 3).join(' | ')}`); if (errors.length > 5) break; }
}
console.log({ games, finished, stalled, moves });
console.log('usage:', used);
if (errors.length) { console.log('ERRORS', errors); process.exit(1); }
console.log('OK: no invariant violations');
