# UNO Party (prototype)

Multiplayer UNO-style game. One small Node server holds the game, every player opens the link on their own phone.
Up to 15 players per room (`MAX_PLAYERS` env var), 50 rooms per server (`MAX_ROOMS`).

## Run it
    npm install
    npm start          # http://localhost:3000
    npm test           # 3000 bot games + a 15-client websocket test

## Get friends on it over mobile data (SIM network)
Phones on mobile data cannot reach your laptop directly, so the server needs a public address. Two easy ways:

1. **Quick, tonight:** on a laptop run `npm start`, then in another terminal
   `npx cloudflared tunnel --url http://localhost:3000` (or `ngrok http 3000`). Send the https link it prints.
2. **Always on, free:** push this folder to GitHub, create a *Web Service* on render.com from the repo.
   `render.yaml` is included, so it picks up the settings itself. Free instances sleep after ~15 min idle
   (first load takes ~30 s) and game rooms live in memory, so a restart clears them.

Vercel / Netlify will NOT work: they cannot hold WebSocket connections open.

## How a game goes
Create game, share the 4-letter code or invite link, host picks the rules, Start. People can join while a round is running.
If a phone drops, it reconnects to the same hand; a player who stays offline is auto-skipped (draw and pass) after 6 s.

## Adding your own card
1. `server/game.js`: add an entry to `HOUSE_CARDS` (name, icon, description, `needs: 'target'` if it targets a player).
2. Same file: add a `case` in `applyHouse()` with what it does. End with `return this.advance(n)`.
3. The lobby toggle, card face and rules text appear automatically (client reads `/meta`).
