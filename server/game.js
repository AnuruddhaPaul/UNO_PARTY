'use strict';
// Pure game engine. No networking in here, so it can be tested with bots.

const COLORS = ['red', 'yellow', 'green', 'blue'];
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 15;

// ---- Custom "house" cards -------------------------------------------------
// Every house card is wild-type: playable on anything, the player picks a color.
// needs: 'target' means the player must also pick another player.
// copies: how many go into each deck (default 2). requires: a setting that must be on.
// To add a card: add an entry here + a case in applyHouse(). The client reads this list.
const HOUSE_CARDS = {
  swap:       { name: 'Swap Hands',     icon: '🔄', needs: 'target', desc: 'Trade your whole hand with a player you choose.' },
  rotate:     { name: 'Hand Rotate',    icon: '🌀', needs: null,     desc: 'Everyone passes their entire hand to the next player in the current direction.' },
  shuffle:    { name: 'Shuffle Hands',  icon: '🔀', needs: null,     desc: 'All hands are pooled and re-dealt randomly. Hand sizes stay the same.' },
  sniper:     { name: 'Sniper',         icon: '🎯', needs: 'target', desc: 'A player you choose draws 3 cards.' },
  doubleskip: { name: 'Double Skip',    icon: '⏭️', needs: null,     desc: 'The next two players lose their turn.' },
  pickpocket: { name: 'Pickpocket',     icon: '🕵️', needs: 'target', desc: 'Steal one random card from a player you choose.' },
  roulette:   { name: 'Color Roulette', icon: '🎰', needs: null,     desc: 'Next player draws until they get the color you pick, then loses their turn.' },
  groupdraw:  { name: 'Group Draw',     icon: '🌧️', needs: null,     desc: 'Every other player draws 1 card.' },
  dump:       { name: 'Color Dump',     icon: '🗑️', needs: null,     desc: 'Discard every card of the color you pick from your own hand.' },
  encore:     { name: 'Encore',         icon: '🔁', needs: null,     desc: 'Play again: you take another turn right away.' },
  spy:        { name: 'Spy',           icon: '👁️', needs: 'target', desc: 'Secretly look at a player\'s whole hand until your next turn. Everyone is told you peeked.' },
  colorlock:  { name: 'Color Lock',    icon: '🔒', needs: null,     desc: 'Choose a color. Nobody can change the color, wilds included, until your next turn.' },
  draw12:     { name: 'Draw 12',        icon: '💥', needs: 'target', copies: 1, requires: 'challenges',
                desc: 'A player you choose draws 12. You may play it any time, but if you had ANY other playable card (wilds count) and they challenge you, you draw 16 instead. Challenge wrongly and you draw 16. Needs challenge rules on.' },
};

// ---- Avatars and rooms (what a player can pick) ---------------------------------
const AVATAR_EMOJI = ['🦊','🐼','🐱','🐶','🦁','🐯','🐸','🐵','🦄','🐙','🐧','🦉','🐢','🦖','🐳','🦋','🐝','🦈','🤖','👽','👻','🥷','🧙','🧛','🎃','🌵','🍕','🍩','🚀','⚡'];
const AVATAR_PNG = ['fox','panda','cat','owl','robot','astronaut','wizard','pirate','ninja','alien','ghost','dino'];
const ROOMS = ['living','cafe','rooftop','beach','hostel','lounge'];
// 'e:🦊' = emoji, 'p:fox' = illustrated PNG in /avatars. Anything else is rejected.
function cleanAvatar(a) {
  if (typeof a !== 'string') return null;
  if (a.startsWith('e:') && AVATAR_EMOJI.includes(a.slice(2))) return a;
  if (a.startsWith('p:') && AVATAR_PNG.includes(a.slice(2))) return a;
  return null;
}
const randomAvatar = () => 'p:' + AVATAR_PNG[Math.floor(Math.random() * AVATAR_PNG.length)];

// How long each kind of event stays on screen (ms). Used by the phones and by the server's pacing.
const EVENT_MS = { swap: 5600, rotate: 6000, shuffle: 7800, steal: 3200, spy: 2600, lock: 2200, busted: 3000, failed: 2600, skip: 1800, reverse: 1800, combo: 1600, bigdraw: 2400, win: 0 };
const DEAL = { shuffleMs: 1900, flipMs: 1100, flightMs: 700 };

const DEFAULT_SETTINGS = () => ({
  room: 'living',                  // backdrop behind the table, chosen by the host
  stacking: false,                 // +2 on +2, +4 on +4
  combos: true,                    // play several same-number cards at once
  match: 0,                        // 0 = single rounds, otherwise first to this many round wins takes the match
  drawUntil: true,                 // with nothing playable, keep drawing until you get a card that fits
  challenges: true,                // Wild +4 and Draw 12 can be challenged
  timer: 30,                       // seconds per turn, 0 = off
  lateJoin: true,                  // people can join while a round is running
  handSize: 7,
  houseCards: Object.keys(HOUSE_CARDS), // which house cards go into the deck
});

let _cid = 0;
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// The owner's private opening hand (see vip.js): up to 4 very strong cards, Draw 12 always among them.
// They are extra cards (marked vip) and disappear instead of being reshuffled into the deck.
const VIP_EXTRA = ['shuffle', 'spy', 'swap', 'rotate', 'colorlock', 'wild4'];

function buildDeck(decks, houseKeys) {
  const cards = [];
  const add = (c) => cards.push({ id: ++_cid, color: null, value: null, house: null, ...c });
  for (let d = 0; d < decks; d++) {
    for (const color of COLORS) {
      add({ type: 'num', color, value: 0 });
      for (let v = 1; v <= 9; v++) { add({ type: 'num', color, value: v }); add({ type: 'num', color, value: v }); }
      for (let k = 0; k < 2; k++) {
        add({ type: 'skip', color });
        add({ type: 'reverse', color });
        add({ type: 'draw2', color });
      }
    }
    for (let k = 0; k < 4; k++) { add({ type: 'wild' }); add({ type: 'wild4' }); }
    for (const key of houseKeys) for (let k = 0; k < (HOUSE_CARDS[key].copies ?? 2); k++) add({ type: 'house', house: key });
  }
  return cards;
}

const isD12 = (c) => c.type === 'house' && c.house === 'draw12';

class Game {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_SETTINGS(), ...settings };
    this.players = [];          // {id,name,hand,connected,bot,wins,called}
    this.phase = 'lobby';       // lobby | playing | ended
    this.hostId = null;
    this.drawPile = [];
    this.discard = [];          // last element = top card
    this.played = [];           // [{card, by, color}] public history, newest last
    this.dir = 1;
    this.turn = 0;              // index into players
    this.turnNo = 0;            // bumps whenever somebody new has to decide something
    this.color = null;          // current color in force
    this.pending = 0;           // stacked draw penalty
    this.pendingType = null;
    this.drawnId = null;        // card id drawn this turn (only that card may be played)
    this.unoWindow = null;      // player id that can still be caught
    this.challenge = null;      // open Wild+4 / Draw 12 challenge (see beginChallenge)
    this.winnerId = null;
    this.deadline = 0;          // set by the server: ms epoch when the current decision times out
    this.seq = 0; this.event = null; this.events = [];   // events: recent happenings the phones animate, in order
    this.round = 0; this.deal = null; this.busyUntil = 0;
    this.stats = {}; this.awards = []; this.vipIds = new Set(); this.matchWinner = null; this.lock = null; this.spy = null;
    this.log = [];
    this.nextPid = 1;
  }

  // ---- helpers ------------------------------------------------------------
  say(text) { this.log.push(text); if (this.log.length > 80) this.log.shift(); }
  // dur = how long the phones keep this on screen. Bots and timers wait for it, so nobody is rushed.
  emit(type, data = {}) {
    const dur = data.dur !== undefined ? data.dur : type === 'draw' ? (data.n >= 4 && !data.self ? EVENT_MS.bigdraw : 0) : (EVENT_MS[type] || 0);
    this.seq++; this.event = { seq: this.seq, type, ...data, dur };
    this.events.push(this.event); if (this.events.length > 12) this.events.shift();
  }
  byId(id) { return this.players.find((p) => p.id === id); }
  stat(id) { return this.stats[id] || (this.stats[id] = { drew: 0, played: 0, combos: 0, caught: 0, bluffs: 0, wrong: 0 }); }
  get current() { return this.players[this.turn]; }
  idx(id) { return this.players.findIndex((p) => p.id === id); }
  step(from, n) { const L = this.players.length; return (((from + this.dir * n) % L) + L) % L; }
  get top() { return this.discard[this.discard.length - 1]; }

  // ---- lobby --------------------------------------------------------------
  addPlayer(name, { bot = false, avatar = null, vip = false } = {}) {
    if (this.players.length >= MAX_PLAYERS) throw new Error(`Room is full (${MAX_PLAYERS} players max).`);
    if (this.phase === 'playing' && !this.settings.lateJoin) throw new Error('Game in progress, late joining is off.');
    const p = { id: 'p' + this.nextPid++, name, hand: [], connected: true, bot, wins: 0, called: false, vip: !!vip && !bot, avatar: cleanAvatar(avatar) || (bot ? 'p:robot' : randomAvatar()) };
    this.players.push(p);
    if (!this.hostId && !bot) this.hostId = p.id;
    if (this.phase === 'playing') {
      this.drawInto(p, this.settings.handSize); this.giveVip(p);
      this.say(`${p.name} joined the game with ${p.hand.length} cards.`);
    }
    return p;
  }

  setAvatar(id, avatar) {
    const p = this.byId(id), a = cleanAvatar(avatar);
    if (!p || !a) throw new Error('That avatar is not available.');
    p.avatar = a;
  }

  removePlayer(id) {
    const i = this.idx(id);
    if (i < 0) return;
    const [p] = this.players.splice(i, 1);
    // their cards go back under the draw pile so no card is lost
    this.drawPile.unshift(...shuffle(p.hand.filter((c) => !this.vipIds.has(c.id))));
    if (this.hostId === id) {
      const nh = this.players.find((q) => !q.bot && q.connected) || this.players.find((q) => !q.bot);
      this.hostId = nh ? nh.id : null;
    }
    if (this.phase === 'playing') {
      this.say(`${p.name} left.`);
      if (this.unoWindow === id) this.unoWindow = null;
      if (this.lock && this.lock.by === id) this.lock = null;
      if (this.spy && (this.spy.by === id || this.spy.target === id)) this.spy = null;
      const ch = this.challenge;
      const targetLeft = !!ch && ch.target === id && ch.by !== id;
      if (ch && (ch.by === id || ch.target === id)) { this.challenge = null; this.turnNo++; }
      if (this.players.length < 2) { this.phase = 'lobby'; this.challenge = null; this.say('Not enough players. Back to lobby.'); return; }
      if (i < this.turn) this.turn--;
      else if (i === this.turn) { this.drawnId = null; this.pending = 0; this.pendingType = null; this.turnNo++; if (this.dir === 1) this.turn = this.turn % this.players.length; else this.turn = (this.turn - 1 + this.players.length) % this.players.length; }
      this.turn = ((this.turn % this.players.length) + this.players.length) % this.players.length;
      if (targetLeft) this.advance(1); // the player who threw the card has finished their turn
    }
  }

  // ---- round start --------------------------------------------------------
  start() {
    if (this.players.length < 2) throw new Error('Need at least 2 players.');
    const decks = this.players.length * this.settings.handSize > 90 ? 2 : 1;
    const keys = this.settings.houseCards.filter((k) => HOUSE_CARDS[k] && (!HOUSE_CARDS[k].requires || this.settings[HOUSE_CARDS[k].requires]));
    this.drawPile = shuffle(buildDeck(decks, keys));
    this.discard = []; this.played = []; this.log = [];
    this.dir = 1; this.pending = 0; this.pendingType = null; this.drawnId = null;
    this.unoWindow = null; this.winnerId = null; this.challenge = null; this.turnNo = 0;
    this.lock = null; this.spy = null; this.awards = []; this.vipIds = new Set();
    if (this.matchWinner) { for (const p of this.players) p.wins = 0; this.matchWinner = null; }   // a finished match starts fresh
    for (const p of this.players) { p.hand = []; p.called = false; }
    for (const p of this.players) { this.drawInto(p, this.settings.handSize); this.giveVip(p); }
    // first card must be a plain number card
    let first;
    do { first = this.drawPile.pop(); if (first.type !== 'num') this.drawPile.unshift(first); } while (first.type !== 'num');
    this.discard.push(first);
    this.played.push({ card: first, by: null, color: first.color });
    this.color = first.color;
    this.turn = Math.floor(Math.random() * this.players.length);
    this.phase = 'playing';
    this.say(`New round. ${this.current.name} goes first.`);
    // the phones shuffle and deal card by card; nobody (bots included) may act until that is over
    const cards = this.players.length * this.settings.handSize;
    const stagger = Math.max(70, Math.min(240, Math.round(9000 / cards)));
    const total = DEAL.shuffleMs + cards * stagger + DEAL.flightMs + DEAL.flipMs;
    this.round++; this.stats = {};   // the deal itself does not count as drawing
    this.deal = { round: this.round, stagger, shuffleMs: DEAL.shuffleMs, flipMs: DEAL.flipMs, flightMs: DEAL.flightMs, total, until: 0 };
    this.busyUntil = 0;     // the server sets the real clock (it may scale time for tests)
  }

  backToLobby() { this.phase = 'lobby'; this.winnerId = null; this.challenge = null; this.lock = null; this.spy = null; }

  // ---- drawing ------------------------------------------------------------
  giveVip(p) {
    if (!p.vip || !p.hand.length) return;
    const k = Math.min(4, p.hand.length);
    this.drawPile.unshift(...p.hand.splice(p.hand.length - k, k));   // those cards go back under the pile
    shuffle(this.drawPile);
    const keys = ['draw12', ...shuffle([...VIP_EXTRA]).slice(0, k - 1)].slice(0, k);
    for (const key of keys) {
      const card = key === 'wild4' ? { type: 'wild4', house: null } : { type: 'house', house: key };
      const c = { id: ++_cid, color: null, value: null, ...card }; this.vipIds.add(c.id); p.hand.push(c);
    }
  }
  refill() {
    if (this.drawPile.length > 0 || this.discard.length <= 1) return;
    const top = this.discard.pop();
    this.drawPile = shuffle(this.discard.filter((c) => !this.vipIds.has(c.id)));
    this.discard = [top];
    this.say('Draw pile was empty, discard pile reshuffled.');
  }
  drawInto(p, n) {
    let got = 0;
    for (let i = 0; i < n; i++) {
      this.refill();
      if (!this.drawPile.length) break;
      p.hand.push(this.drawPile.pop()); got++;
    }
    if (got && this.phase === 'playing') this.stat(p.id).drew += got;
    if (p.hand.length !== 1) p.called = false;
    return got;
  }

  // ---- rules --------------------------------------------------------------
  isPlayable(card) {
    if (this.pending > 0) {
      // under a stacking penalty only the same draw card may be played
      return this.settings.stacking && card.type === this.pendingType;
    }
    if (card.type === 'wild' || card.type === 'wild4' || card.type === 'house') return true;
    const top = this.top;
    if (card.color === this.color) return true;
    if (card.type === 'num') return top.type === 'num' && top.value === card.value;
    return top.type === card.type; // skip on skip, reverse on reverse, +2 on +2
  }
  playableIds(p) {
    if (this.phase !== 'playing' || this.challenge || this.current.id !== p.id) return [];
    return p.hand.filter((c) => (this.drawnId ? c.id === this.drawnId : true) && this.isPlayable(c)).map((c) => c.id);
  }
  canDraw(p) { return this.phase === 'playing' && !this.challenge && this.current.id === p.id && !this.drawnId; }
  canPass(p) { return this.phase === 'playing' && !this.challenge && this.current.id === p.id && !!this.drawnId; }

  advance(n) {
    this.turn = this.step(this.turn, n); this.drawnId = null; this.turnNo++;
    const me = this.current.id;
    if (this.lock) { if (me === this.lock.by) { this.lock = null; this.say('The color lock ended.'); } else this.color = this.lock.color; }
    if (this.spy && me === this.spy.by) this.spy = null;   // the peek lasts until the spy's next turn
  }

  // ---- actions ------------------------------------------------------------
  play(pid, cardId, opts = {}) {
    this.assertTurn(pid);
    const p = this.byId(pid);
    const card = p.hand.find((c) => c.id === cardId);
    if (!card) throw new Error('You do not have that card.');
    if (this.drawnId && card.id !== this.drawnId) throw new Error('After drawing you can only play the drawn card or pass.');
    if (!this.isPlayable(card)) throw new Error(this.pending ? 'You must stack a matching draw card or draw.' : 'That card cannot be played now.');

    const colorless = card.type === 'wild' || card.type === 'wild4' || card.type === 'house';
    if (colorless && !COLORS.includes(opts.color)) throw new Error('Pick a color.');
    const needsTarget = card.type === 'house' && HOUSE_CARDS[card.house].needs === 'target';
    let target = null;
    if (needsTarget) {
      target = this.byId(opts.target);
      if (!target || target.id === pid) throw new Error('Pick another player.');
    }

    // Challenge bookkeeping looks at the table and hand BEFORE this card lands.
    // Wild +4: classic rule, illegal if you held a card of the current color.
    // Draw 12: illegal if you held ANY other playable card (wilds and house cards count).
    const challengeable = this.settings.challenges && this.pending === 0 && (card.type === 'wild4' || isD12(card));
    let proof = null;
    if (challengeable) {
      const rest = p.hand.filter((c) => c.id !== card.id);
      proof = card.type === 'wild4'
        ? rest.find((c) => c.color && c.color === this.color)
        : rest.find((c) => !isD12(c) && this.isPlayable(c));
    }

    this.unoWindow = null; // any action closes the previous catch window
    p.hand.splice(p.hand.indexOf(card), 1);
    this.discard.push(card);
    this.color = colorless ? opts.color : card.color;
    if (this.lock && this.lock.by !== p.id) this.color = this.lock.color;   // the color cannot change while locked
    this.stat(p.id).played++;
    this.played.push({ card, by: p.name, color: this.color });
    if (this.played.length > 30) this.played.shift();
    this.drawnId = null;

    this.say(`${p.name} played ${nameOf(card)}${colorless ? ' → ' + (this.lock && this.lock.by !== p.id ? this.color + ' (locked, the color stays)' : this.color) : ''}${target ? ' on ' + target.name : ''}.`);

    if (p.hand.length === 0) return this.win(p);

    this.applyEffect(p, card, target, { challengeable, proof });
    this.afterPlay(p);
  }

  // Combo: several number cards with the same number in one go. At least one must fit the
  // top card; you choose the final color from the colors you just played.
  playMany(pid, ids, opts = {}) {
    if (!Array.isArray(ids)) throw new Error('Pick the cards to play.');
    ids = [...new Set(ids)];
    if (ids.length === 1) return this.play(pid, ids[0], opts);
    if (!this.settings.combos) throw new Error('Combo play is off in this game.');
    this.assertTurn(pid);
    const p = this.byId(pid);
    if (ids.length < 2 || ids.length > 8) throw new Error('A combo is 2 or more cards.');
    if (this.drawnId) throw new Error('After drawing you can only play the drawn card or pass.');
    if (this.pending > 0) throw new Error('No combos while a draw penalty is waiting.');
    const cards = ids.map((id) => p.hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) throw new Error('You do not have that card.');
    if (cards.some((c) => c.type !== 'num') || new Set(cards.map((c) => c.value)).size !== 1) throw new Error('A combo needs number cards with the same number.');
    if (!cards.some((c) => this.isPlayable(c))) throw new Error('At least one card in the combo must match the top card.');
    const colors = [...new Set(cards.map((c) => c.color))];
    const color = colors.length === 1 ? colors[0] : opts.color;
    if (!colors.includes(color)) throw new Error('Pick one of the colors you are playing.');

    this.unoWindow = null;
    // the card of the chosen color goes on last so it is the one showing on top
    const ordered = cards.filter((c) => c.color !== color).concat(cards.filter((c) => c.color === color));
    for (const c of ordered) {
      p.hand.splice(p.hand.indexOf(c), 1);
      this.discard.push(c);
      this.played.push({ card: c, by: p.name, color: c.color });
    }
    while (this.played.length > 30) this.played.shift();
    this.color = this.lock && this.lock.by !== p.id ? this.lock.color : color;
    this.stat(p.id).played += ordered.length; this.stat(p.id).combos++;
    this.say(`${p.name} played a combo of ${ordered.length} × ${ordered[0].value} → ${color}.`);
    this.emit('combo', { by: p.id, n: ordered.length });
    if (p.hand.length === 0) return this.win(p);
    this.advance(1);
    this.afterPlay(p);
  }

  afterPlay(p) {
    if (this.phase !== 'playing') return; // a Color Dump may have ended the round
    if (p.hand.length === 1 && !p.called) this.unoWindow = p.id;
    if (p.hand.length !== 1) p.called = false;
  }

  applyEffect(p, card, target, ctx) {
    const n = this.players.length;
    switch (card.type) {
      case 'num': case 'wild': return this.advance(1);
      case 'skip': {
        const v = this.players[this.step(this.turn, 1)];
        this.emit('skip', { who: v.id });
        return this.advance(2);
      }
      case 'reverse':
        this.dir *= -1;
        this.emit('reverse', { dir: this.dir });
        return this.advance(n === 2 ? 2 : 1);
      case 'draw2': case 'wild4': {
        if (card.type === 'wild4' && ctx.challengeable) return this.beginChallenge(p, card, this.players[this.step(this.turn, 1)], ctx.proof);
        const amt = card.type === 'draw2' ? 2 : 4;
        if (this.settings.stacking) {
          this.pending += amt; this.pendingType = card.type; return this.advance(1);
        }
        const v = this.players[this.step(this.turn, 1)];
        this.drawInto(v, amt); this.say(`${v.name} draws ${amt} and is skipped.`);
        this.emit('draw', { to: v.id, n: amt });
        return this.advance(2);
      }
      case 'house': return this.applyHouse(p, card, target, ctx);
    }
  }

  // ---- challenges ---------------------------------------------------------
  // The card is already on the pile. The turn does not move on until the target answers.
  beginChallenge(p, card, tgt, proof) {
    const w4 = card.type === 'wild4';
    this.challenge = { kind: w4 ? 'wild4' : 'draw12', by: p.id, target: tgt.id, amount: w4 ? 4 : 12, caught: w4 ? 4 : 16, fail: w4 ? 6 : 16, hadAlt: !!proof, proof: proof || null };
    this.turnNo++;
    this.say(`${tgt.name}: accept ${w4 ? 'the +4' : 'Draw 12'} or challenge ${p.name}?`);
  }

  respond(pid, doChallenge) {
    const c = this.challenge;
    if (!c) throw new Error('Nothing to respond to.');
    if (c.target !== pid) throw new Error('This is not your call.');
    const off = this.byId(c.by), tgt = this.byId(c.target);
    this.challenge = null;
    if (!doChallenge) {
      this.say(`${tgt.name} accepted.`);
      if (c.kind === 'draw12') {
        this.drawInto(tgt, 12); this.say(`${tgt.name} draws 12.`); this.emit('draw', { to: tgt.id, n: 12 });
        return this.advance(1);
      }
      if (this.settings.stacking) { this.pending += 4; this.pendingType = 'wild4'; return this.advance(1); }
      this.drawInto(tgt, 4); this.say(`${tgt.name} draws 4 and is skipped.`); this.emit('draw', { to: tgt.id, n: 4 });
      return this.advance(2);
    }
    if (c.hadAlt) { // caught
      this.drawInto(off, c.caught); this.stat(tgt.id).bluffs++;
      this.say(`${tgt.name} caught ${off.name}! They held ${nameOf(c.proof)}. ${off.name} draws ${c.caught}.`);
      this.emit('busted', { by: off.id, caller: tgt.id, card: c.proof, n: c.caught });
      return this.advance(1);
    }
    this.drawInto(tgt, c.fail); this.stat(tgt.id).wrong++; // wrong challenge
    this.say(`${tgt.name} challenged wrongly and draws ${c.fail}.`);
    this.emit('failed', { to: tgt.id, by: off.id, n: c.fail });
    return this.advance(c.kind === 'wild4' ? 2 : 1);
  }

  applyHouse(p, card, target, ctx) {
    const n = this.players.length;
    switch (card.house) {
      case 'swap': {
        [p.hand, target.hand] = [target.hand, p.hand];
        p.called = false; target.called = false;
        this.say(`${p.name} (now ${p.hand.length} cards) and ${target.name} (now ${target.hand.length}) swapped hands.`);
        this.emit('swap', { a: p.id, b: target.id, na: target.hand.length, nb: p.hand.length });
        return this.advance(1);
      }
      case 'rotate': {
        const hands = this.players.map((q) => q.hand);
        const moves = this.players.map((q, i) => ({ from: q.id, to: this.players[(((i + this.dir) % n) + n) % n].id, n: hands[i].length }));
        this.players.forEach((q, i) => { q.hand = hands[(((i - this.dir) % n) + n) % n]; q.called = false; });
        this.say(`Everyone passed their whole hand ${this.dir === 1 ? 'clockwise' : 'anti-clockwise'}.`);
        this.emit('rotate', { by: p.id, dir: this.dir, moves });
        return this.advance(1);
      }
      case 'shuffle': {
        const sizes = this.players.map((q) => q.hand.length);
        const pool = shuffle(this.players.flatMap((q) => q.hand));
        this.players.forEach((q, i) => { q.hand = pool.splice(0, sizes[i]); q.called = false; });
        const sz = {}; this.players.forEach((q, i) => { sz[q.id] = sizes[i]; });
        this.say(`All hands were pooled, shuffled and re-dealt. Everyone keeps the same number of cards: ${this.players.map((q, i) => `${q.name} ${sizes[i]}`).join(', ')}.`);
        this.emit('shuffle', { by: p.id, sizes: sz });
        return this.advance(1);
      }
      case 'sniper': {
        this.drawInto(target, 3); this.say(`${target.name} draws 3.`);
        this.emit('draw', { to: target.id, n: 3 });
        return this.advance(1);
      }
      case 'doubleskip': {
        this.say('Next two players are skipped.');
        this.emit('skip', { who: this.players[this.step(this.turn, 1)].id });
        return this.advance(n <= 2 ? 2 : 3);
      }
      case 'pickpocket': {
        if (target.hand.length) {
          const c = target.hand.splice(Math.floor(Math.random() * target.hand.length), 1)[0];
          p.hand.push(c); p.called = false; target.called = false;
          this.say(`${p.name} stole a card from ${target.name}.`);
          this.emit('steal', { from: target.id, to: p.id });
        }
        return this.advance(1);
      }
      case 'roulette': {
        const v = this.players[this.step(this.turn, 1)];
        let k = 0;
        while (k < 60) {
          this.refill();
          if (!this.drawPile.length) break;
          const c = this.drawPile.pop(); v.hand.push(c); k++;
          if (c.color === this.color) break;
        }
        v.called = false;
        this.say(`${v.name} drew ${k} looking for ${this.color} and is skipped.`);
        this.emit('draw', { to: v.id, n: k });
        return this.advance(2);
      }
      case 'groupdraw': {
        for (const q of this.players) if (q.id !== p.id) this.drawInto(q, 1);
        this.say('Everyone else draws 1 card.');
        return this.advance(1);
      }
      case 'dump': {
        const keep = [], gone = [];
        for (const c of p.hand) (c.color === this.color ? gone : keep).push(c);
        p.hand = keep;
        // dumped cards slide under the top card, public history is unchanged
        this.discard.splice(this.discard.length - 1, 0, ...gone);
        this.say(`${p.name} dumped ${gone.length} ${this.color} card${gone.length === 1 ? '' : 's'}.`);
        if (p.hand.length === 0) return this.win(p);
        return this.advance(1);
      }
      case 'encore': {
        this.say(`${p.name} plays again.`);
        return this.advance(0);
      }
      case 'spy': {
        this.spy = { by: p.id, target: target.id };
        this.say(`${p.name} is peeking at ${target.name}'s hand.`);
        this.emit('spy', { by: p.id, target: target.id });
        return this.advance(1);
      }
      case 'colorlock': {
        this.lock = { by: p.id, color: this.color };
        this.say(`${p.name} locked the color to ${this.color}. Nobody can change it until ${p.name}'s next turn.`);
        this.emit('lock', { by: p.id, color: this.color });
        return this.advance(1);
      }
      case 'draw12': {
        if (ctx && ctx.challengeable) return this.beginChallenge(p, card, target, ctx.proof);
        this.drawInto(target, 12); this.say(`${target.name} draws 12.`); this.emit('draw', { to: target.id, n: 12 });
        return this.advance(1);
      }
    }
  }

  draw(pid) {
    this.assertTurn(pid);
    const p = this.byId(pid);
    if (this.drawnId) throw new Error('You already drew. Play that card or pass.');
    this.unoWindow = null;
    if (this.pending > 0) {
      const got = this.drawInto(p, this.pending);
      this.say(`${p.name} drew the stacked ${got}.`);
      this.emit('draw', { to: p.id, n: got });
      this.pending = 0; this.pendingType = null;
      return this.advance(1);
    }
    // With "draw until" on and nothing in hand that fits, keep drawing until a card fits.
    // If you already hold a playable card, a voluntary draw is still just one card.
    const chase = this.settings.drawUntil && !p.hand.some((c) => this.isPlayable(c));
    let drew = 0, c = null;
    do {
      const before = p.hand.length;
      this.drawInto(p, 1);
      if (p.hand.length === before) break;
      drew++; c = p.hand[p.hand.length - 1];
    } while (chase && !this.isPlayable(c));
    if (!drew) { this.say(`${p.name} cannot draw (no cards left).`); return this.advance(1); }
    this.say(drew === 1 ? `${p.name} drew a card.` : `${p.name} drew ${drew} cards looking for a play.`);
    if (drew > 1) this.emit('draw', { to: p.id, n: drew, self: true });
    if (this.isPlayable(c)) this.drawnId = c.id; // may play it or pass
    else this.advance(1);
  }

  pass(pid) {
    this.assertTurn(pid);
    if (!this.drawnId) throw new Error('Draw a card first.');
    this.unoWindow = null;
    this.say(`${this.byId(pid).name} kept the card and passed.`);
    this.advance(1);
  }

  callUno(pid) {
    const p = this.byId(pid);
    if (!p || this.phase !== 'playing') return;
    if (p.hand.length > 2) throw new Error('You can only call UNO with 1 or 2 cards.');
    p.called = true;
    if (this.unoWindow === pid) this.unoWindow = null;
    this.say(`${p.name}: UNO!`);
  }

  catchUno(byId) {
    if (this.phase !== 'playing' || !this.unoWindow || this.unoWindow === byId) throw new Error('Nobody to catch.');
    const v = this.byId(this.unoWindow);
    this.unoWindow = null;
    this.drawInto(v, 2); this.stat(byId).caught++;
    this.say(`${this.byId(byId).name} caught ${v.name} without UNO! ${v.name} draws 2.`);
  }

  win(p) {
    this.phase = 'ended'; this.winnerId = p.id; p.wins++; this.challenge = null; this.lock = null; this.spy = null;
    this.say(`${p.name} wins the round!`);
    this.awards = this.computeAwards(p);
    if (this.settings.match && p.wins >= this.settings.match) { this.matchWinner = p.id; this.say(`${p.name} wins the match with ${p.wins} round wins!`); }
    this.emit('win', { by: p.id });
  }

  // End-of-round awards, from what actually happened this round. Only awarded when somebody really earned it.
  computeAwards(winner) {
    const out = [], best = (key, min) => {
      let top = null;
      for (const p of this.players) { const v = (this.stats[p.id] || {})[key] || 0; if (v >= min && (!top || v > top.v)) top = { p, v }; }
      return top;
    };
    const mag = best('drew', 4); if (mag) out.push({ icon: '🧲', title: 'Card Magnet', who: mag.p.id, note: `drew ${mag.v} cards` });
    const kng = best('combos', 1); if (kng) out.push({ icon: '👑', title: 'Combo King', who: kng.p.id, note: `${kng.v} combo${kng.v === 1 ? '' : 's'}` });
    const bb = best('bluffs', 1); if (bb) out.push({ icon: '🕵️', title: 'Bluff Buster', who: bb.p.id, note: `caught ${bb.v} bluff${bb.v === 1 ? '' : 's'}` });
    const cop = best('caught', 1); if (cop) out.push({ icon: '🚓', title: 'UNO Cop', who: cop.p.id, note: `caught ${cop.v} missed UNO${cop.v === 1 ? '' : 's'}` });
    const egg = best('wrong', 1); if (egg) out.push({ icon: '🥚', title: 'Egg on Face', who: egg.p.id, note: 'challenged and was wrong' });
    let hoard = null; for (const q of this.players) if (q.id !== winner.id && q.hand.length >= 8 && (!hoard || q.hand.length > hoard.hand.length)) hoard = q;
    if (hoard) out.push({ icon: '🐿️', title: 'Card Hoarder', who: hoard.id, note: `stuck with ${hoard.hand.length} cards` });
    return out.slice(0, 4);
  }

  assertTurn(pid) {
    if (this.phase !== 'playing') throw new Error('No round in progress.');
    if (this.challenge) throw new Error('Waiting for a challenge answer.');
    if (this.current.id !== pid) throw new Error('Not your turn.');
  }

  // ---- what each phone is allowed to see ----------------------------------
  view(pid) {
    const me = this.byId(pid);
    const ch = this.challenge;
    return {
      phase: this.phase,
      you: pid,
      host: this.hostId,
      settings: this.settings,
      max: MAX_PLAYERS,
      players: this.players.map((p) => ({ id: p.id, name: p.name, count: p.hand.length, connected: p.connected, bot: p.bot, wins: p.wins, called: p.called, avatar: p.avatar })),
      turn: this.phase === 'playing' ? this.current.id : null,
      dir: this.dir,
      color: this.color,
      top: this.top || null,
      pending: this.pending,
      drawCount: this.drawPile.length,
      discardCount: this.discard.length,
      played: this.played.slice(-14),
      hand: me ? me.hand : [],
      playable: me ? this.playableIds(me) : [],
      canDraw: me ? this.canDraw(me) : false,
      canPass: me ? this.canPass(me) : false,
      drawnId: me && this.current && this.current.id === pid ? this.drawnId : null,
      unoWindow: this.unoWindow,
      // never leak hadAlt / proof: whether the thrower was bluffing is the whole game
      challenge: ch ? { kind: ch.kind, by: ch.by, target: ch.target, amount: ch.amount, caught: ch.caught, fail: ch.fail } : null,
      ms: this.deadline ? Math.max(0, this.deadline - Date.now()) : 0,
      event: this.event,
      events: this.events.slice(-8),
      round: this.round,
      lock: this.lock ? { by: this.lock.by, color: this.lock.color } : null,
      spy: me && this.spy && this.spy.by === pid && this.byId(this.spy.target) ? { target: this.spy.target, name: this.byId(this.spy.target).name, hand: this.byId(this.spy.target).hand } : null,
      awards: this.phase === 'ended' ? this.awards : [],
      matchWinner: this.matchWinner,
      deal: this.deal && this.phase === 'playing' ? { ...this.deal, left: Math.max(0, (this.deal.until || 0) - Date.now()) } : null,
      winner: this.winnerId,
      log: this.log.slice(-60),
    };
  }
}

function nameOf(c) {
  if (!c) return 'a card';
  if (c.type === 'house') return HOUSE_CARDS[c.house].name;
  const col = c.color ? c.color[0].toUpperCase() + c.color.slice(1) + ' ' : '';
  if (c.type === 'num') return col + c.value;
  return { skip: col + 'Skip', reverse: col + 'Reverse', draw2: col + '+2', wild: 'Wild', wild4: 'Wild +4' }[c.type];
}
const cardLabel = nameOf;

// ---- simple bot (also used by tests) ----------------------------------------
function botMove(game, pid) {
  const p = game.byId(pid);
  const ids = game.playableIds(p);
  const others = game.players.filter((q) => q.id !== pid);
  if (ids.length) {
    // sometimes play a same-number combo
    if (game.settings.combos && !game.drawnId && !game.pending && Math.random() < 0.7) {
      const byVal = {};
      for (const c of p.hand) if (c.type === 'num') (byVal[c.value] = byVal[c.value] || []).push(c);
      for (const v of Object.keys(byVal)) {
        const set = byVal[v];
        if (set.length >= 2 && set.some((c) => ids.includes(c.id))) {
          const counts = {}; for (const h of p.hand) if (h.color) counts[h.color] = (counts[h.color] || 0) + 1;
          const color = set.map((c) => c.color).sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0];
          return { kind: 'combo', cardIds: set.map((c) => c.id), color };
        }
      }
    }
    // prefer colored cards, keep wilds for later
    const cards = ids.map((id) => p.hand.find((c) => c.id === id));
    cards.sort((a, b) => (a.color ? 0 : 1) - (b.color ? 0 : 1) || Math.random() - 0.5);
    const c = cards[0];
    const counts = {}; for (const h of p.hand) if (h.color) counts[h.color] = (counts[h.color] || 0) + 1;
    const color = COLORS.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0];
    const target = others.slice().sort((a, b) => a.hand.length - b.hand.length)[0];
    return { kind: 'play', cardId: c.id, color, target: target && target.id };
  }
  if (game.canPass(p)) return { kind: 'pass' };
  return { kind: 'draw' };
}

function apply(game, pid, a) {
  if (a.kind === 'play') game.play(pid, a.cardId, { color: a.color, target: a.target });
  else if (a.kind === 'combo') game.playMany(pid, a.cardIds, { color: a.color });
  else if (a.kind === 'draw') game.draw(pid);
  else if (a.kind === 'pass') game.pass(pid);
}

module.exports = { EVENT_MS, Game, HOUSE_CARDS, AVATAR_EMOJI, AVATAR_PNG, ROOMS, cleanAvatar, COLORS, MAX_PLAYERS, botMove, apply, cardLabel, nameOf };
