# Castle Strategy

A live, phone-friendly version of the Colonel Blotto game described in `rules.md`.
Host it on your laptop or for free online. Players join from their phones with the 3-digit room code on the board and a 4-digit table code.

There is nothing to install except Node.js. The game has no dependencies and works without internet once it's running.

## Run it

1. Install Node.js 18 or newer from https://nodejs.org (or `brew install node`).
2. In this folder, run:

   ```
   node server.js
   ```

3. The terminal prints three addresses and the admin password:
   - **Admin dashboard**: `http://localhost:3000/admin` (on your laptop)
   - **Leaderboard** for the projector: `http://localhost:3000/board`
   - **Player link**: `http://<your-laptop-ip>:3000`. Phones open this.

The admin password is generated once and saved in `data/admin-password.txt`.
To choose your own, start the server with `ADMIN_PASSWORD=yourpassword node server.js`.
Use `PORT=8080 node server.js` to change the port.

When macOS asks whether to allow incoming connections for `node`, click **Allow**.

## Getting phones connected

There are three ways, from least to most dependent on the room's Wi-Fi.

### A. Host it online for free (Render), recommended

The game runs on a free Render server. Students open a normal `https://` link on mobile data
or any Wi-Fi, and your laptop only needs a browser.

1. Put this folder in a GitHub repository. It can be private.
2. Sign in at https://render.com with GitHub, choose **New → Blueprint** and pick the repository.
   The included `render.yaml` sets everything up (free plan, `node server.js`).
   When asked, type an **ADMIN_PASSWORD**. Set one, otherwise the password changes whenever Render restarts the server.
3. After the first deploy you get a link such as `https://castle-clash-ab12.onrender.com`.
   Open `/admin` and `/board` on it. The board, the QR codes and the table cards use this link automatically.

Things to know about the free plan:
- The server sleeps after 15 minutes without visitors and takes about a minute to wake up.
  Open the admin page a few minutes before the event. Open pages ping it, so it stays awake during the game.
- A free server forgets everything when it restarts or redeploys. The admin dashboard keeps a backup of the
  whole game in your browser. If the server ever comes back empty, a **Restore the game** banner appears.
  One click brings back the teams, codes, players and scores, and students' phones reconnect by themselves.
  Use **Settings → Download backup** and **Download current config** to keep copies as files.
- Don't push changes to GitHub during the event, because each push redeploys and restarts the server.

### ngrok (laptop + your ngrok account)

```
node server.js                 # terminal 1
ngrok http 3000                # terminal 2 (prints https://<your-name>.ngrok-free.app)
```

1. On the laptop, open `http://localhost:3000/admin` and `http://localhost:3000/board`. Using localhost keeps them off your ngrok quota.
2. **Admin → Settings → Join address**: paste the `https://…ngrok-free.app` link and save. The board, QR codes and table cards now use it.
3. Students scan the QR code. ngrok shows a one-time "You are about to visit…" page; they tap **Visit Site**.

The free plan allows 1 GB and 20,000 requests a month. A test game with 48 phones and 8 rounds used about 3–4 MB
and under 1,000 requests, so you're far below that. **Settings → About this server** shows the running total.
Keep the laptop plugged in and awake (`caffeinate -dims` in a third terminal) for the whole event.

### B. Your laptop plus a free Cloudflare tunnel (no account)

The game runs on your laptop, and Cloudflare gives it a temporary public `https://….trycloudflare.com` link.
Students use mobile data or any Wi-Fi. Your laptop needs any internet connection, and eduroam is fine.

```
brew install cloudflared      # once
node server.js --tunnel       # or: npm run tunnel
```

The terminal prints the public link, and the board and QR codes switch to it automatically.
The link changes every time you start the tunnel, so print table cards after it appears.
Quick tunnels don't support live streaming updates, so phones on the tunnel check for updates every 2 seconds instead.
They also allow 200 requests at once, which is plenty for a class.

### C. Same Wi-Fi as the laptop

Run `node server.js` and have everyone join the Wi-Fi your laptop is on. University networks such as eduroam
usually block phone-to-laptop traffic. Use a hotspot or a small router, or use A or B.

You can always override the link shown to players in **Admin → Settings → Join address**.

## Running an event

1. **Teams tab:** add one team per table. Each team gets a unique 4-digit code.
   Click **Print table cards** to get one card per table, with its code and a QR code
   that fills the code in automatically.
2. **Rounds tab:** choose the rounds, their modes, time limits, multipliers and parameters. Click **Save rounds**.
3. **Settings tab:** save the whole setup as a named config so you can load it again next time.
   A config includes rounds, settings and (optionally) teams with their codes. You can also download a config as a file and import it later.
4. Put `/board` on the projector, opened in the same browser where you're logged in to `/admin`.
   The board then shows the 3-digit **room code**. Players scan the QR code and enter the room code, their table code and their name.
   The room code changes every time you clear scores (or press **New code** on the Game tab), so people from an earlier session can't join with an old link.
   Players already in the game stay in when you choose **Clear scores, keep players**.
5. Click **Start round** in the header. Everyone first sees the round's rules, a worked example and a picture of an example matchup for 30 seconds
   (change this in Settings, or press **Start now**). Then the timer starts. When it runs out the round is scored automatically.
   The board plays countdown music during the timer (a march that speeds up in the last 10 seconds, then a gong).
   Click once anywhere on the board to allow sound; the button in the corner turns it off.
   After each round the results show a strategy tip for that mode and the best army in hindsight
   (the army that would have scored highest against everyone's real armies).
   Results appear on the phones and the board, or wait for you to click **Reveal results** if you turned off auto-reveal.
6. Use **Pause**, **+30 s** or **End now** as needed. **Restart round** clears that round's armies. **Cancel round** throws the round away.
   **Discard** on a played round removes its scores so it can be replayed.

Before the event, add test bots (Teams tab) to rehearse the whole flow, then remove them.

If the server restarts mid-game, everything resumes from `data/state.json`, including a running timer.
To start completely fresh, stop the server and delete `data/state.json`.

## Rules details

- Players who don't submit sit the round out: they score nothing and nobody plays against them. You can change this in Settings.
- Phones have an English / 中文 switch (Traditional Chinese). The board and admin pages stay in English.
- Players can change their army until the timer ends. They may place fewer soldiers than they have; unplaced soldiers don't fight.
- A player who reconnects with the current room code, the same table code and the same name gets their own seat back, for example after switching phones.
- Your score for a round is the average of your scores against every opponent, and that average is the number shown on screen.
- Team score for a round = the best individual score at that table, times the round's multiplier. Tied teams share a placing.

## Round modes

| Mode | Idea |
|---|---|
| Classic | The rules as written. |
| Blackjack | Score above 21 in a matchup and you get 0 for that matchup. |
| Good Neighbours | A castle only scores if you also capture an adjacent castle. |
| Family Ties | Castle 2i is worth double if you also capture castle i. |
| Prime Garrisons | Every castle gets a prime number of soldiers, or none. |
| Attrition March | Survivors of each castle battle march on to the next castle. |
| Beauty Contest | After submission, the most popular castle is worth 1 and the least popular is worth 10. |
| Shuffled Banners | Castle values are secretly shuffled and revealed after the round. |
| War Chest | Soldiers kept home earn 0.25 points per matchup. |
| Lingering Garrison | Half of last round's soldiers stay and fight again. |
| Grand Alliance | Each table's armies are averaged into one team army. |
| Decisive Victory | You need more than twice your opponent's soldiers to capture. |
| Winner Takes All | Whoever wins a matchup takes all 55 points. |

Any mode can also get the "primes only" twist. The numbers in the table (21, 0.25, half, ×2) can be changed per round.

## Checks

```
node tools/test-scoring.js   # scoring for every mode, including the example in rules.md
node tools/test-e2e.js       # plays all 13 modes against a live server
```

## Files

- `server.js`: game server (HTTP, live updates, admin actions, saving)
- `src/modes.js`: all round modes and the scoring engine
- `public/`: phone app (`index.html`, `app.js`), admin dashboard (`admin.html`, `admin.js`), board (`board.html`)
- `data/`: live game state, saved configs (`data/presets/`), admin password
- `render.yaml`: free Render hosting setup
