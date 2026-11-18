# FC Soccer Bros — deploy to GitHub Pages

1. Create a GitHub account (github.com) and click **New repository**. Name it `fc-soccer-bros`, set it to **Public**, and create it.
2. Click **uploading an existing file**, drag in all of these files, then **Commit changes**:
   `index.html  style.css  teams.js  players.js  multiplayer.js  game.js`
3. Go to **Settings → Pages**. Under *Build and deployment*, set Source to **Deploy from a branch**, Branch **main**, folder **/ (root)**, then **Save**.
4. Wait about a minute. Your game is live at `https://YOURUSERNAME.github.io/fc-soccer-bros/`.

## Online play
One person clicks **Online Lobby → Create Lobby** and shares the 5-letter code (up to 8 players). Everyone else picks **Join Lobby** and types it in. Each player picks any player in the game and a side; AI fills the other positions of each 11.
Needs `unpkg.com` reachable for PeerJS. Local 2-Player (Quick Match) works offline.

## Controls
Arrows/WASD move · Shift sprint · **Space does everything:** tap = pass (hold ↑/↓/←/→ to choose who), hold = shoot, no ball = slide tackle, high ball = jump header · Esc pause
