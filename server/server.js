'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, EVENT_MS, HOUSE_CARDS, AVATAR_EMOJI, AVATAR_PNG, ROOMS, MAX_PLAYERS, botMove, apply } = require('./game');

const PORT = process.env.PORT || 3000;
const SEC = Number(process.env.SEC_MS) || 1000;           // tests shrink this to run timers fast
const PACE = SEC / 1000;                                     // scales animation waits the same way as the timers
const CHALLENGE_SEC = 10;                                    // time the target has to accept / challenge
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 50;   // free-tier friendly
const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// ---- static files -------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
  if (url.pathname === '/meta') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ house: HOUSE_CARDS, max: MAX_PLAYERS, avatars: { emoji: AVATAR_EMOJI, png: AVATAR_PNG }, rooms: ROOMS }));
  }
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---- rooms ----------------------------------------------------------------------
const rooms = new Map(); // code -> { game, socks: Map<pid, ws>, tokens: Map<pid, token>, idleSince, timers }
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
function newCode() {
  for (;;) {
    let c = ''; for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const clean = (s) => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14);
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

// Work out how long the phones will be busy animating what just happened (cards flying,
// banners, swaps) so bots and timers wait for it instead of piling the next move on top.
function noteBusy(room) {
  const g = room.game, snap = room.snap;
  const now = { phase: g.phase, seq: g.seq, draw: g.drawPile.length, played: g.played.length, counts: Object.fromEntries(g.players.map((p) => [p.id, p.hand.length])) };
  room.snap = now;
  if (!snap || snap.phase !== 'playing' || g.phase !== 'playing') return;
  const evMs = g.events.filter((e) => e.seq > snap.seq).reduce((a, e) => a + (e.dur || 0), 0);
  let moved = Math.max(0, g.played.length - snap.played);
  for (const p of g.players) if (p.id in snap.counts) moved += Math.max(0, p.hand.length - snap.counts[p.id]);
  const flight = moved ? 700 + Math.min(moved, 24) * 340 : 0;
  const est = Math.max(evMs, flight);
  if (est) g.busyUntil = Math.max(g.busyUntil || 0, Date.now() + (est + 300) * PACE);
}

function broadcast(room) {
  noteBusy(room);
  scheduleAuto(room);   // first, so the deadline is part of what every phone receives
  for (const [pid, ws] of room.socks) send(ws, { t: 'state', ...room.game.view(pid) });
}

// Turn timer, bots and absent players: whoever has to decide is played automatically
// when time runs out, so the table never stalls. The deadline is fixed per decision
// point (turnNo), so unrelated broadcasts do not extend anybody's time.
function scheduleAuto(room) {
  clearTimeout(room.autoTimer);
  const g = room.game;
  if (g.phase !== 'playing') { g.deadline = 0; room.key = null; room.deadline = 0; return; }
  const ch = g.challenge;
  const actor = ch ? g.byId(ch.target) : g.current;
  const key = g.turnNo + (ch ? 'c' : '');
  if (room.key !== key) { room.key = key; room.deadline = 0; }
  let delay;
  const busy = Math.max(0, (g.busyUntil || 0) - Date.now());   // animations still playing on the phones
  if (actor.bot) delay = (ch ? 2200 : 1600) + busy;
  else if (!actor.connected) delay = (ch ? 2500 : 6000) + busy;
  else if (ch) delay = CHALLENGE_SEC * SEC + busy;
  else if (g.settings.timer > 0) delay = g.settings.timer * SEC + busy;
  else { g.deadline = 0; return; }
  if (!room.deadline) room.deadline = Date.now() + delay;
  g.deadline = room.deadline;
  room.autoTimer = setTimeout(() => {
    try {
      if (g.phase !== 'playing') return;
      if (ch) { if (g.challenge && g.challenge.target === actor.id) g.respond(actor.id, actor.bot ? Math.random() < 0.3 : false); }
      else if (g.current.id === actor.id) {
        if (actor.bot) apply(g, actor.id, botMove(g, actor.id));
        else { if (g.canPass(actor)) g.pass(actor.id); else g.draw(actor.id); }   // out of time: draw and pass
      }
    } catch (e) { /* ignore */ }
    broadcast(room);
  }, Math.max(0, room.deadline - Date.now()));
}

function join(ws, msg) {
  const name = clean(msg.name) || 'Player';
  let code = String(msg.code || '').toUpperCase().trim();
  const resume = msg.pid && msg.token;
  let room;
  if (msg.t === 'create') {
    if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'error', msg: 'Server is busy, try again in a few minutes.' });
    code = newCode();
    room = { game: new Game(), socks: new Map(), tokens: new Map(), idleSince: null, autoTimer: null, key: null, deadline: 0 };
    rooms.set(code, room);
  } else {
    room = rooms.get(code);
    if (!room) return send(ws, { t: 'error', code: 'noroom', msg: `Room ${code} was not found.` });
  }
  const g = room.game;
  let p;
  if (resume && room.tokens.get(msg.pid) === msg.token && g.byId(msg.pid)) {
    p = g.byId(msg.pid); p.connected = true;
    const old = room.socks.get(p.id); if (old && old !== ws) { old.pid = null; old.close(); }
  } else {
    try { p = g.addPlayer(name, { avatar: msg.avatar }); } catch (e) { return send(ws, { t: 'error', msg: e.message }); }
    room.tokens.set(p.id, crypto.randomBytes(12).toString('hex'));
    g.say(`${p.name} joined.`);
  }
  ws.room = code; ws.pid = p.id;
  room.socks.set(p.id, ws); room.idleSince = null;
  send(ws, { t: 'joined', code, pid: p.id, token: room.tokens.get(p.id) });
  broadcast(room);
}

function handle(ws, msg) {
  if (msg.t === 'create' || msg.t === 'join') return join(ws, msg);
  if (msg.t === 'ping') return send(ws, { t: 'pong' });
  const room = rooms.get(ws.room); if (!room || !ws.pid) return;
  const g = room.game, pid = ws.pid, isHost = g.hostId === pid;
  try {
    switch (msg.t) {
      case 'settings': {
        if (!isHost || g.phase === 'playing') throw new Error('Only the host can change rules between rounds.');
        const s = g.settings;
        if (typeof msg.stacking === 'boolean') s.stacking = msg.stacking;
        if (typeof msg.lateJoin === 'boolean') s.lateJoin = msg.lateJoin;
        if (typeof msg.combos === 'boolean') s.combos = msg.combos;
        if (typeof msg.drawUntil === 'boolean') s.drawUntil = msg.drawUntil;
        if (typeof msg.challenges === 'boolean') s.challenges = msg.challenges;
        if ([0, 15, 30, 45, 60].includes(msg.timer)) s.timer = msg.timer;
        if (ROOMS.includes(msg.room)) s.room = msg.room;
        if (Array.isArray(msg.houseCards)) s.houseCards = msg.houseCards.filter((k) => HOUSE_CARDS[k]);
        if (msg.handSize >= 3 && msg.handSize <= 10) s.handSize = msg.handSize | 0;
        break;
      }
      case 'bot': {
        if (!isHost || g.phase === 'playing') throw new Error('Host only, between rounds.');
        const n = g.players.filter((p) => p.bot).length + 1;
        g.addPlayer('Bot ' + n, { bot: true });
        break;
      }
      case 'avatar': g.setAvatar(pid, msg.avatar); break;
      case 'claimhost': {
        const h = g.byId(g.hostId);
        if (h && h.connected) throw new Error('The host is still here.');
        g.hostId = pid; g.say(`${g.byId(pid).name} is now the host.`);
        break;
      }
      case 'start': if (!isHost) throw new Error('Only the host can start.'); g.start(); g.deal.until = g.busyUntil = Date.now() + g.deal.total * PACE; break;
      case 'lobby': if (!isHost) throw new Error('Only the host.'); g.backToLobby(); break;
      case 'kick': {
        if (!isHost || msg.pid === pid) throw new Error('Not allowed.');
        const ks = room.socks.get(msg.pid);
        g.removePlayer(msg.pid); room.tokens.delete(msg.pid);
        if (ks) { send(ks, { t: 'kicked' }); ks.pid = null; room.socks.delete(msg.pid); }
        break;
      }
      case 'leave': {
        g.removePlayer(pid); room.socks.delete(pid); room.tokens.delete(pid); ws.pid = null;
        send(ws, { t: 'left' });
        break;
      }
      case 'play': g.play(pid, msg.cardId, { color: msg.color, target: msg.target }); break;
      case 'playmany': g.playMany(pid, msg.cardIds, { color: msg.color }); break;
      case 'respond': g.respond(pid, !!msg.challenge); break;
      case 'draw': g.draw(pid); break;
      case 'pass': g.pass(pid); break;
      case 'uno': g.callUno(pid); break;
      case 'catch': g.catchUno(pid); break;
      default: return;
    }
  } catch (e) { send(ws, { t: 'error', msg: e.message }); }
  broadcast(room);
}

const wss = new WebSocketServer({ server, maxPayload: 2048 });
wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  let last = 0, burst = 0;
  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - last < 1000) { if (++burst > 20) return; } else burst = 0;  // crude flood guard
    last = now;
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg && typeof msg === 'object') handle(ws, msg);
  });
  ws.on('close', () => {
    const room = rooms.get(ws.room);
    if (!room || !ws.pid || room.socks.get(ws.pid) !== ws) return;
    room.socks.delete(ws.pid);
    const p = room.game.byId(ws.pid); if (p) p.connected = false;
    if (![...room.game.players].some((q) => q.connected && !q.bot)) room.idleSince = Date.now();
    broadcast(room);
  });
});

// detect dead phone connections, and tidy up empty rooms after 30 minutes
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
  for (const [code, room] of rooms) if (room.idleSince && Date.now() - room.idleSince > 30 * 60 * 1000) { clearTimeout(room.autoTimer); rooms.delete(code); }
}, 20000);

if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log(`UNO party running on port ${PORT}`));
module.exports = { server, rooms, broadcast };
