'use strict';
// Real WebSocket test: 15 phones join, a 16th is refused, game is played to the end
// through the network protocol, one phone drops and reconnects, one joins mid-game.
const WebSocket = require('ws');
const { server } = require('../server/server');

const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class Phone {
  constructor(port, name) { this.name = name; this.port = port; this.state = null; this.errors = []; }
  open() {
    return new Promise((res) => {
      this.ws = new WebSocket(`ws://localhost:${this.port}`);
      this.ws.on('open', res);
      this.ws.on('message', (d) => {
        const m = JSON.parse(d);
        if (m.t === 'joined') this.session = m;
        if (m.t === 'state') this.state = m;
        if (m.t === 'error') this.errors.push(m.msg);
      });
    });
  }
  tx(o) { this.ws.send(JSON.stringify(o)); }
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const host = new Phone(port, 'Host'); await host.open();
  host.tx({ t: 'create', name: 'Host' }); await wait(100);
  const code = host.session.code; assert(/^[A-Z]{4}$/.test(code), 'room code');

  const phones = [host];
  for (let i = 1; i < 15; i++) { const p = new Phone(port, 'P' + i); await p.open(); p.tx({ t: 'join', code, name: p.name }); phones.push(p); await wait(30); }
  await wait(200);
  assert(host.state.players.length === 15, '15 players in lobby, got ' + host.state.players.length);

  const extra = new Phone(port, 'TooMany'); await extra.open(); extra.tx({ t: 'join', code, name: 'x' }); await wait(150);
  assert(extra.errors.some((e) => /full/i.test(e)), '16th player must be refused: ' + extra.errors);
  console.log('ok: 15 joined, 16th refused');

  // non-host cannot start; host can, with stacking on and a subset of house cards
  phones[1].tx({ t: 'start' }); await wait(100);
  assert(host.state.phase === 'lobby', 'non-host start ignored');
  host.tx({ t: 'settings', stacking: true, houseCards: ['swap', 'sniper', 'dump', 'encore'] }); await wait(100);
  assert(host.state.settings.stacking && host.state.settings.houseCards.length === 4, 'settings applied');
  host.tx({ t: 'start' }); await wait(200);
  assert(host.state.phase === 'playing', 'game started');
  const houseInHands = new Set(phones.flatMap((p) => p.state.hand).filter((c) => c.type === 'house').map((c) => c.house));
  for (const k of houseInHands) assert(['swap', 'sniper', 'dump', 'encore'].includes(k), 'only enabled house cards: ' + k);
  // privacy: nobody sees others' cards
  assert(phones.every((p) => p.state.hand.length === 7), 'each hand 7');
  assert(!JSON.stringify(phones[3].state.players).includes('"hand"'), 'no hands leak in player list');
  console.log('ok: started, 15 x 7 cards dealt from a double deck (' + (host.state.drawCount) + ' left)');

  // late joiner
  const late = new Phone(port, 'Late'); await late.open();
  // room is full at 15, so first free a seat
  phones[14].tx({ t: 'leave' }); await wait(100); phones.pop();
  late.tx({ t: 'join', code, name: 'Late' }); await wait(150);
  assert(late.state && late.state.hand.length === 7, 'late joiner got 7 cards');
  phones.push(late);
  console.log('ok: late join mid-game');

  // drop and resume phone 2
  const old = phones[2], sess = old.session; old.ws.terminate(); await wait(150);
  assert(host.state.players.find((p) => p.id === sess.pid).connected === false, 'shows offline');
  const back = new Phone(port, 'P2'); await back.open(); back.tx({ t: 'join', code, pid: sess.pid, token: sess.token, name: 'P2' }); await wait(150);
  assert(back.state && back.state.you === sess.pid && back.state.hand.length > 0, 'resume restores hand');
  phones[2] = back;
  console.log('ok: reconnect restores the same hand');

  // play with real clients until someone wins
  let turns = 0;
  const COLORS = ['red', 'yellow', 'green', 'blue'];
  while (host.state.phase === 'playing' && turns < 4000) {
    const cur = phones.find((p) => p.state && p.state.turn === p.state.you);
    if (!cur) { await wait(20); continue; }
    const s = cur.state, before = JSON.stringify([s.turn, s.hand.length, s.drawCount, s.pending]);
    if (s.hand.length <= 2) cur.tx({ t: 'uno' });
    if (s.canPass && !s.playable.length) cur.tx({ t: 'pass' });
    else if (s.playable.length) {
      const c = s.hand.find((x) => x.id === s.playable[0]);
      const others = s.players.filter((p) => p.id !== s.you);
      cur.tx({ t: 'play', cardId: c.id, color: COLORS[turns % 4], target: others[turns % others.length].id });
    } else cur.tx({ t: 'draw' });
    turns++;
    await wait(8);
    // catch anyone who forgot UNO now and then
    const uw = host.state.unoWindow; if (uw && uw !== host.state.you && turns % 3 === 0) host.tx({ t: 'catch' });
  }
  assert(host.state.phase === 'ended', 'round ended with a winner after ' + turns + ' moves');
  const winner = host.state.players.find((p) => p.id === host.state.winner);
  console.log(`ok: ${winner.name} won after ${turns} moves over the network`);

  // cheating checks: playing out of turn / a card you do not own is rejected
  host.tx({ t: 'start' }); await wait(200);
  const notMe = phones.find((p) => p.state.turn !== p.state.you);
  notMe.errors.length = 0; notMe.tx({ t: 'play', cardId: notMe.state.hand[0].id, color: 'red' }); await wait(100);
  assert(notMe.errors.length === 1, 'out-of-turn play rejected: ' + notMe.errors);
  const me = phones.find((p) => p.state.turn === p.state.you);
  me.errors.length = 0; me.tx({ t: 'play', cardId: 999999, color: 'red' }); await wait(100);
  assert(me.errors.length === 1, 'unknown card rejected');
  console.log('ok: out-of-turn and fake-card moves rejected');

  // bots fill in for absent players
  console.log('ALL E2E CHECKS PASSED');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
