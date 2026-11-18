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

## Rules added in round 1
- **Combo play:** play 2+ number cards with the same number together, any colors. One must match the top card, you pick which of the played colors stays. Host toggle.
- **Challenge rules:** Wild +4 and the new **Draw 12** can be played any time. The player they hit may challenge.
  Wild +4: caught = thrower draws 4, wrong challenge = challenger draws 6 and is skipped (classic).
  Draw 12: caught (thrower held ANY other playable card, wilds and custom cards count) = thrower draws 16, wrong challenge = challenger draws 16.
  No answer in 10 s counts as accept. The server never sends whether the thrower was bluffing; it only judges when challenged.
- **Turn timer:** off / 15 / 30 / 45 / 60 s. Out of time = draw and pass.
- **Hold any card** to see it enlarged with its rule text. The screen is kept awake while playing.

## How a game goes
Create game, share the 4-letter code or invite link, host picks the rules, Start. People can join while a round is running.
If a phone drops, it reconnects to the same hand; a player who stays offline is auto-skipped (draw and pass) after 6 s.

## Adding your own card
1. `server/game.js`: add an entry to `HOUSE_CARDS` (name, icon, description, `needs: 'target'` if it targets a player).
2. Same file: add a `case` in `applyHouse()` with what it does. End with `return this.advance(n)`.
3. The lobby toggle, card face and rules text appear automatically (client reads `/meta`).

## Draw until you can play

On by default, switch in the lobby. If nothing in your hand fits the top card, Draw keeps drawing until a card fits, then you may play it or keep it and pass. If you already hold a playable card, a voluntary draw is still one card. Stacked penalties (+2, +4, Draw 12) are always drawn exactly.

## Round 2: the table

- **Round white table** with players seated around it as avatars (circle, fanned cards, card count). With more than 6 players seats shrink to small circles with the count inside. The seat whose turn it is glows and has a countdown ring.
- **Colour ring** around the deck and discard pile shows the colour in play; the chevrons spin in the play direction and flip when someone plays Reverse.
- **Deck and discard pile** drawn as stacks. Only the top discard is face up, the ones under it show the UNO back.
- **Room backdrops** (host picks in the lobby): Living room, Café, Rooftop night, Beach hut, Hostel lounge, Game lounge. Drawn as SVG in `public/scenes.js`, rendered on each phone, nothing to download.
- **Avatars**: 12 illustrated PNGs (`public/avatars`, sources in `tools/`) or any of 30 emoji. Tap your avatar on the home screen, in the lobby, or via the menu.
- **Effects** (all drawn on the phone): confetti on a win, storm cloud + red flash + shake for Draw 12, BUSTED stamp, egg splat on a wrong challenge, skip mark, synthesized sounds.
- Menu has **Sound** and **Effects: reduced** switches. The app has a web manifest so it can be added to the home screen.

- **Card flights:** drawn cards fly from the deck to the player who took them (to your own hand if it is you, face down to opponents). Played cards fly from the hand or seat to the pile and land face up. Worked out on each phone by comparing the new game state with the previous one; turned off by Effects: reduced.
