'use strict';
// Pure game engine. No networking in here, so it can be tested with bots.

const COLORS = ['red', 'yellow', 'green', 'blue'];
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 15;

// ---- Custom "house" cards -------------------------------------------------
// Every house card is wild-type: playable on anything, the player picks a color.
// needs: 'target' means the player must also pick another player.
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
};

const DEFAULT_SETTINGS = () => ({
  stacking: false,                 // +2 on +2, +4 on +4
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
    for (const key of houseKeys) for (let k = 0; k < 2; k++) add({ type: 'house', house: key });
  }
  return cards;
}

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
    this.color = null;          // current color in force
    this.pending = 0;           // stacked draw penalty
    this.pendingType = null;
    this.drawnId = null;        // card id drawn this turn (only that card may be played)
    this.unoWindow = null;      // player id that can still be caught
    this.winnerId = null;
    this.log = [];
    this.nextPid = 1;
  }

  // ---- helpers ------------------------------------------------------------
  say(text) { this.log.push(text); if (this.log.length > 40) this.log.shift(); }
  byId(id) { return this.players.find((p) => p.id === id); }
  get current() { return this.players[this.turn]; }
  idx(id) { return this.players.findIndex((p) => p.id === id); }
  step(from, n) { const L = this.players.length; return (((from + this.dir * n) % L) + L) % L; }
  get top() { return this.discard[this.discard.length - 1]; }

  // ---- lobby --------------------------------------------------------------
  addPlayer(name, { bot = false } = {}) {
    if (this.players.length >= MAX_PLAYERS) throw new Error(`Room is full (${MAX_PLAYERS} players max).`);
    if (this.phase === 'playing' && !this.settings.lateJoin) throw new Error('Game in progress, late joining is off.');
    const p = { id: 'p' + this.nextPid++, name, hand: [], connected: true, bot, wins: 0, called: false };
    this.players.push(p);
    if (!this.hostId && !bot) this.hostId = p.id;
    if (this.phase === 'playing') {
      this.drawInto(p, this.settings.handSize);
      this.say(`${p.name} joined the game with ${p.hand.length} cards.`);
    }
    return p;
  }

  removePlayer(id) {
    const i = this.idx(id);
    if (i < 0) return;
    const [p] = this.players.splice(i, 1);
    // their cards go back under the draw pile so no card is lost
    this.drawPile.unshift(...shuffle(p.hand));
    if (this.hostId === id) {
      const nh = this.players.find((q) => !q.bot && q.connected) || this.players.find((q) => !q.bot);
      this.hostId = nh ? nh.id : null;
    }
    if (this.phase === 'playing') {
      this.say(`${p.name} left.`);
      if (this.unoWindow === id) this.unoWindow = null;
      if (this.players.length < 2) { this.phase = 'lobby'; this.say('Not enough players. Back to lobby.'); return; }
      if (i < this.turn) this.turn--;
      else if (i === this.turn) { this.drawnId = null; this.pending = 0; this.pendingType = null; if (this.dir === 1) this.turn = this.turn % this.players.length; else this.turn = (this.turn - 1 + this.players.length) % this.players.length; }
      this.turn = ((this.turn % this.players.length) + this.players.length) % this.players.length;
    }
  }

  // ---- round start --------------------------------------------------------
  start() {
    if (this.players.length < 2) throw new Error('Need at least 2 players.');
    const decks = this.players.length * this.settings.handSize > 90 ? 2 : 1;
    const keys = this.settings.houseCards.filter((k) => HOUSE_CARDS[k]);
    this.drawPile = shuffle(buildDeck(decks, keys));
    this.discard = []; this.played = []; this.log = [];
    this.dir = 1; this.pending = 0; this.pendingType = null; this.drawnId = null;
    this.unoWindow = null; this.winnerId = null;
    for (const p of this.players) { p.hand = []; p.called = false; }
    for (const p of this.players) this.drawInto(p, this.settings.handSize);
    // first card must be a plain number card
    let first;
    do { first = this.drawPile.pop(); if (first.type !== 'num') this.drawPile.unshift(first); } while (first.type !== 'num');
    this.discard.push(first);
    this.played.push({ card: first, by: null, color: first.color });
    this.color = first.color;
    this.turn = Math.floor(Math.random() * this.players.length);
    this.phase = 'playing';
    this.say(`New round. ${this.current.name} goes first.`);
  }

  backToLobby() { this.phase = 'lobby'; this.winnerId = null; }

  // ---- drawing ------------------------------------------------------------
  refill() {
    if (this.drawPile.length > 0 || this.discard.length <= 1) return;
    const top = this.discard.pop();
    this.drawPile = shuffle(this.discard);
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
    if (this.phase !== 'playing' || this.current.id !== p.id) return [];
    return p.hand.filter((c) => (this.drawnId ? c.id === this.drawnId : true) && this.isPlayable(c)).map((c) => c.id);
  }
  canDraw(p) { return this.phase === 'playing' && this.current.id === p.id && !this.drawnId; }
  canPass(p) { return this.phase === 'playing' && this.current.id === p.id && !!this.drawnId; }

  advance(n) { this.turn = this.step(this.turn, n); this.drawnId = null; }

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

    this.unoWindow = null; // any action closes the previous catch window
    p.hand.splice(p.hand.indexOf(card), 1);
    this.discard.push(card);
    this.color = colorless ? opts.color : card.color;
    this.played.push({ card, by: p.name, color: this.color });
    if (this.played.length > 30) this.played.shift();
    this.drawnId = null;

    const label = card.type === 'house' ? HOUSE_CARDS[card.house].name : cardLabel(card);
    this.say(`${p.name} played ${label}${colorless ? ' → ' + this.color : ''}${target ? ' on ' + target.name : ''}.`);

    if (p.hand.length === 0) return this.win(p);

    this.applyEffect(p, card, target);

    if (this.phase !== 'playing') return; // a Color Dump may have ended the round
    if (p.hand.length === 1 && !p.called) this.unoWindow = p.id;
    if (p.hand.length !== 1) p.called = false;
  }

  applyEffect(p, card, target) {
    const n = this.players.length;
    switch (card.type) {
      case 'num': case 'wild': return this.advance(1);
      case 'skip': return this.advance(2);
      case 'reverse':
        this.dir *= -1;
        return this.advance(n === 2 ? 2 : 1);
      case 'draw2': case 'wild4': {
        const amt = card.type === 'draw2' ? 2 : 4;
        if (this.settings.stacking) {
          this.pending += amt; this.pendingType = card.type; return this.advance(1);
        }
        const v = this.players[this.step(this.turn, 1)];
        this.drawInto(v, amt); this.say(`${v.name} draws ${amt} and is skipped.`);
        return this.advance(2);
      }
      case 'house': return this.applyHouse(p, card, target);
    }
  }

  applyHouse(p, card, target) {
    const n = this.players.length;
    switch (card.house) {
      case 'swap': {
        [p.hand, target.hand] = [target.hand, p.hand];
        p.called = false; target.called = false;
        this.say(`${p.name} and ${target.name} swapped hands.`);
        return this.advance(1);
      }
      case 'rotate': {
        const hands = this.players.map((q) => q.hand);
        this.players.forEach((q, i) => { q.hand = hands[(((i - this.dir) % n) + n) % n]; q.called = false; });
        this.say('Everyone passed their hand along.');
        return this.advance(1);
      }
      case 'shuffle': {
        const sizes = this.players.map((q) => q.hand.length);
        const pool = shuffle(this.players.flatMap((q) => q.hand));
        this.players.forEach((q, i) => { q.hand = pool.splice(0, sizes[i]); q.called = false; });
        this.say('All hands were shuffled and re-dealt.');
        return this.advance(1);
      }
      case 'sniper': {
        this.drawInto(target, 3); this.say(`${target.name} draws 3.`);
        return this.advance(1);
      }
      case 'doubleskip': {
        this.say('Next two players are skipped.');
        return this.advance(n <= 2 ? 2 : 3);
      }
      case 'pickpocket': {
        if (target.hand.length) {
          const c = target.hand.splice(Math.floor(Math.random() * target.hand.length), 1)[0];
          p.hand.push(c); p.called = false; target.called = false;
          this.say(`${p.name} stole a card from ${target.name}.`);
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
        return this.advance(2);
      }
      case 'groupdraw': {
        for (const q of this.players) if (q.id !== p.id) this.drawInto(q, 1);
        this.say('Everyone else draws 1.');
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
      this.pending = 0; this.pendingType = null;
      return this.advance(1);
    }
    const before = p.hand.length;
    this.drawInto(p, 1);
    if (p.hand.length === before) { this.say(`${p.name} cannot draw (no cards left).`); return this.advance(1); }
    const c = p.hand[p.hand.length - 1];
    this.say(`${p.name} drew a card.`);
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
    this.drawInto(v, 2);
    this.say(`${this.byId(byId).name} caught ${v.name} without UNO! ${v.name} draws 2.`);
  }

  win(p) {
    this.phase = 'ended'; this.winnerId = p.id; p.wins++;
    this.say(`${p.name} wins the round!`);
  }

  assertTurn(pid) {
    if (this.phase !== 'playing') throw new Error('No round in progress.');
    if (this.current.id !== pid) throw new Error('Not your turn.');
  }

  // ---- what each phone is allowed to see ----------------------------------
  view(pid) {
    const me = this.byId(pid);
    return {
      phase: this.phase,
      you: pid,
      host: this.hostId,
      settings: this.settings,
      max: MAX_PLAYERS,
      players: this.players.map((p) => ({ id: p.id, name: p.name, count: p.hand.length, connected: p.connected, bot: p.bot, wins: p.wins, called: p.called })),
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
      winner: this.winnerId,
      log: this.log.slice(-6),
    };
  }
}

function cardLabel(c) {
  const col = c.color ? c.color[0].toUpperCase() + c.color.slice(1) + ' ' : '';
  if (c.type === 'num') return col + c.value;
  return { skip: col + 'Skip', reverse: col + 'Reverse', draw2: col + '+2', wild: 'Wild', wild4: 'Wild +4' }[c.type];
}

// ---- simple bot (also used by tests) ----------------------------------------
function botMove(game, pid) {
  const p = game.byId(pid);
  const ids = game.playableIds(p);
  const others = game.players.filter((q) => q.id !== pid);
  if (ids.length) {
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
  else if (a.kind === 'draw') game.draw(pid);
  else if (a.kind === 'pass') game.pass(pid);
}

module.exports = { Game, HOUSE_CARDS, COLORS, MAX_PLAYERS, botMove, apply, cardLabel };
