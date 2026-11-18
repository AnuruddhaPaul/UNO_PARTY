'use strict';
// Real WebSocket test: 15 phones join, a 16th is refused, a game is played to the end through
// the network protocol (with combos and challenge answers), one phone drops and reconnects, one joins
// mid-game. Then the turn timer and the challenge timeout are checked on a second room.
process.env.SEC_MS = '20';            // run every "second" in 20 ms so timers can be tested quickly
const WebSocket = require('ws');
const { server, rooms, broadcast } = require('../server/server');

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

  phones[1].tx({ t: 'start' }); await wait(100);
  assert(host.state.phase === 'lobby', 'non-host start ignored');
  phones[1].tx({ t: 'settings', combos: false }); await wait(100);
  assert(host.state.settings.combos === true, 'non-host cannot change rules');
  const KEYS = ['swap', 'sniper', 'dump', 'encore', 'draw12'];
  host.tx({ t: 'settings', stacking: true, challenges: true, timer: 45, houseCards: KEYS }); await wait(100);
  assert(host.state.settings.stacking && host.state.settings.timer === 45 && host.state.settings.houseCards.length === 5, 'settings applied');
  host.tx({ t: 'settings', timer: 7 }); await wait(60);
  assert(host.state.settings.timer === 45, 'invalid timer value ignored');
  host.tx({ t: 'start' }); await wait(200);
  assert(host.state.phase === 'playing', 'game started');
  const houseInHands = new Set(phones.flatMap((p) => p.state.hand).filter((c) => c.type === 'house').map((c) => c.house));
  for (const k of houseInHands) assert(KEYS.includes(k), 'only enabled house cards: ' + k);
  assert(phones.every((p) => p.state.hand.length === 7), 'each hand 7');
  assert(!JSON.stringify(phones[3].state.players).includes('"hand"'), 'no hands leak in player list');
  assert(host.state.ms > 0, 'turn countdown is sent to phones');
  console.log('ok: started, 15 x 7 cards dealt from a double deck (' + host.state.drawCount + ' left), countdown present');

  const late = new Phone(port, 'Late'); await late.open();
  phones[14].tx({ t: 'leave' }); await wait(100); phones.pop();
  late.tx({ t: 'join', code, name: 'Late' }); await wait(150);
  assert(late.state && late.state.hand.length === 7, 'late joiner got 7 cards');
  phones.push(late);
  console.log('ok: late join mid-game');

  const old = phones[2], sess = old.session; old.ws.terminate(); await wait(150);
  assert(host.state.players.find((p) => p.id === sess.pid).connected === false, 'shows offline');
  const back = new Phone(port, 'P2'); await back.open(); back.tx({ t: 'join', code, pid: sess.pid, token: sess.token, name: 'P2' }); await wait(150);
  assert(back.state && back.state.you === sess.pid && back.state.hand.length > 0, 'resume restores hand');
  phones[2] = back;
  console.log('ok: reconnect restores the same hand');

  // play with real clients until someone wins; use combos and answer challenges when they come up
  let turns = 0, combos = 0, challenges = 0;
  const COLORS = ['red', 'yellow', 'green', 'blue'];
  while (host.state.phase === 'playing' && turns < 5000) {
    const tgt = phones.find((p) => p.state && p.state.challenge && p.state.challenge.target === p.state.you);
    if (tgt) { tgt.tx({ t: 'respond', challenge: turns % 2 === 0 }); challenges++; turns++; await wait(10); continue; }
    const cur = phones.find((p) => p.state && p.state.turn === p.state.you && !p.state.challenge);
    if (!cur) { await wait(15); continue; }
    const s = cur.state;
    if (s.hand.length <= 2) cur.tx({ t: 'uno' });
    // a combo whenever the hand allows one
    const groups = {}; for (const c of s.hand) if (c.type === 'num') (groups[c.value] = groups[c.value] || []).push(c);
    const combo = !s.drawnId && !s.pending && Object.values(groups).find((g) => g.length >= 2 && g.some((c) => s.playable.includes(c.id)));
    if (combo) { cur.tx({ t: 'playmany', cardIds: combo.map((c) => c.id), color: combo[0].color }); combos++; }
    else if (s.canPass && !s.playable.length) cur.tx({ t: 'pass' });
    else if (s.playable.length) {
      const c = s.hand.find((x) => x.id === s.playable[0]);
      const others = s.players.filter((p) => p.id !== s.you);
      cur.tx({ t: 'play', cardId: c.id, color: COLORS[turns % 4], target: others[turns % others.length].id });
    } else cur.tx({ t: 'draw' });
    turns++;
    await wait(10);
    const uw = host.state.unoWindow; if (uw && uw !== host.state.you && turns % 3 === 0) host.tx({ t: 'catch' });
  }
  assert(host.state.phase === 'ended', 'round ended with a winner after ' + turns + ' moves');
  const winner = host.state.players.find((p) => p.id === host.state.winner);
  console.log(`ok: ${winner.name} won after ${turns} moves over the network (${combos} combos, ${challenges} challenge answers)`);

  host.tx({ t: 'start' }); await wait(200);
  const notMe = phones.find((p) => p.state.turn !== p.state.you);
  notMe.errors.length = 0; notMe.tx({ t: 'play', cardId: notMe.state.hand[0].id, color: 'red' }); await wait(100);
  assert(notMe.errors.length === 1, 'out-of-turn play rejected: ' + notMe.errors);
  const me = phones.find((p) => p.state.turn === p.state.you);
  me.errors.length = 0; me.tx({ t: 'play', cardId: 999999, color: 'red' }); await wait(100);
  assert(me.errors.length === 1, 'unknown card rejected');
  me.errors.length = 0; me.tx({ t: 'respond', challenge: true }); await wait(100);
  assert(me.errors.length === 1, 'responding with no open challenge rejected');
  console.log('ok: out-of-turn, fake-card and stray-challenge moves rejected');

  // ---- second room: turn timer + challenge timeout ----
  const A = new Phone(port, 'A'); await A.open(); A.tx({ t: 'create', name: 'A' }); await wait(100);
  const B = new Phone(port, 'B'); await B.open(); B.tx({ t: 'join', code: A.session.code, name: 'B' }); await wait(100);
  A.tx({ t: 'settings', timer: 15, houseCards: ['draw12'] }); await wait(50);
  A.tx({ t: 'start' }); await wait(100);
  const first = A.state.turn, n0 = A.state.log.length;
  await wait(1200);   // 15 s = 300 ms here, so the idle player must have been auto-played by now
  assert(A.state.log.some((l) => /drew a card|kept the card/.test(l)), 'idle player is auto-played when the timer runs out: ' + A.state.log.join(' | '));
  console.log('ok: turn timer plays for an idle player');

  const room = rooms.get(A.session.code), g = room.game;
  g.turn = 0; g.drawnId = null; g.pending = 0; g.turnNo++;
  g.players[0].hand = [{ id: -5, type: 'house', house: 'draw12', color: null, value: null }, { id: -6, type: 'wild', color: null, value: null }];
  const bBefore = g.players[1].hand.length;
  broadcast(room); await wait(80);
  A.tx({ t: 'play', cardId: -5, color: 'red', target: B.session.pid }); await wait(80);
  assert(B.state.challenge && B.state.challenge.target === B.session.pid, 'target sees the challenge prompt');
  assert(!/hadAlt|proof/.test(JSON.stringify(B.state)) && !/hadAlt|proof/.test(JSON.stringify(A.state)), 'bluff info is not sent to anyone');
  assert(B.state.ms > 0, 'challenge countdown sent');
  await wait(500);    // 10 s = 200 ms: silence counts as accept
  // B then becomes the current player and may already have been auto-played once (draw 1), so allow +13
  assert(!g.challenge && g.log.some((l) => /B draws 12/.test(l)) && g.players[1].hand.length >= bBefore + 12, 'silence = accept, target drew 12 (had ' + bBefore + ', has ' + g.players[1].hand.length + ')');
  console.log('ok: unanswered Draw 12 is auto-accepted after the countdown');

  console.log('ALL E2E CHECKS PASSED');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
