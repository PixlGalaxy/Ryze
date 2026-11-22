# Ryze

Discord bot for **temporary voice channels** ("Join to Create"), with **anti-spam** and a **control panel that opens as an Activity** inside Discord.

- **Temporary channels**: join the lobby channel and Ryze creates your own voice channel, then deletes it when it's empty.
- **Anti-spam**: detects the same link posted in several channels (or blocked words such as "MrBeast" or "free Nitro" scams), deletes the messages, times the user out and posts an alert mentioning the admins.
- **Panel (Activity)** that opens inside Discord:
  - **Every member** sees **My channel**: rename it, set the user limit, lock or unlock it, permit or block people, kick, hand the channel over, claim an ownerless channel and save their preferences for next time.
  - **The owner and managers** also get the **Configure Ryze** button: temporary channels, anti-spam, who else can manage Ryze, and the activity log.

Built with TypeScript, discord.js v14, Express and SQLite (`node:sqlite`). The panel uses React (TSX), Tailwind CSS v4, lucide-react and Vite.

---

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/voice lock` · `/voice unlock` | Channel owner | Locks or unlocks the channel |
| `/voice permit @user` | Channel owner | Lets someone join |
| `/voice reject @user` | Channel owner | Kicks them and removes their access |
| `/voice limit <0-99>` | Channel owner | User limit |
| `/voice name <name>` | Channel owner | Renames the channel (remembered) |
| `/voice claim` | Anyone in the channel | Takes over the channel if the owner left |
| `/voice setup` | Owner / managers | Creates the category and the lobby channel |
| `/panel` | Everyone | Opens the panel (Activity): My channel, plus Configure Ryze for admins |
| `/help` | Everyone | Help |

The panel also opens from Discord's app launcher (🚀) → **Ryze**, and from the button on every spam alert.

**Permissions:** any member can open the panel and manage their own channel. The server owner always sees **Configure Ryze**. From **Configure Ryze → Permissions** the owner can add users or roles as *managers*, who can configure everything except the manager list. If customization is turned off under *Voice channels*, members can still lock and permit people, but can't change the name or the limit.

---

## 1. Set up the application in the Developer Portal

At <https://discord.com/developers/applications> → your application:

1. **Bot**
   - Copy the token (`DISCORD_TOKEN`).
   - Under *Privileged Gateway Intents* enable **Server Members Intent** and **Message Content Intent** (the anti-spam needs to read links). Without them the bot can't log in (`Used disallowed intents`). Presence Intent is not needed.
2. **General Information** → copy the *Application ID* (`DISCORD_CLIENT_ID`).
3. **OAuth2**
   - Copy the *Client Secret* (`DISCORD_CLIENT_SECRET`).
   - Under *Redirects* add **exactly one** URL, `https://127.0.0.1`, and press **Save Changes**. It's required: without it the Activity login fails with `Missing "redirect_uri" in request`. It is not the same as the URL Mapping.
4. **Activities → Settings** → turn on **Enable Activities**, allow launching in servers and tick the **Supported Platforms** (at least Desktop).
5. **Activities → URL Mappings** → add:

   | Prefix | Target |
   | --- | --- |
   | `/` | `ryze.yourdomain.com` (your public domain, **without** `https://`) |

6. **Invite the bot** with these permissions (Manage Channels, Manage Roles, Move Members, Timeout Members, Manage Messages, Send Messages, View Channels, Connect, Embed Links, Read Message History):

   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=1099797982224&integration_type=0&scope=bot+applications.commands
   ```

   > Ryze's role must be **above** the roles of the users it has to time out. Administrators can't be timed out.

---

## 2. Run with Docker

```bash
cp .env.example .env      # and fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
docker compose pull       # published image: ghcr.io/pixlgalaxy/ryze:latest
docker compose up -d      # or `docker compose up -d --build` to build it locally
docker compose logs -f
```

GitHub Actions ([docker-build.yml](.github/workflows/docker-build.yml)) publishes the image on every push to `main` (`latest`, the `package.json` version and the commit SHA). Dependabot keeps npm, the base image and the Actions up to date; minor/patch PRs merge themselves once the build passes, majors wait for review.

- The container exposes port **3000** (panel + API). Change the host port with `RYZE_PORT` in `.env`.
- **Persistent data**: everything is stored in `/appdata` inside the container, mounted at `./appdata` on the host (database `ryze.db`). Back up that folder.
- **Migrating from the old bot**: put the Python bot's `voice.db` at `./appdata/voice.db` and its configuration (lobby channel, category and limit per server) is imported on the first start.
- Healthcheck: `GET /api/health`.

Without compose:

```bash
docker build -t ryze .
docker run -d --name ryze --restart unless-stopped --env-file .env \
  -p 3000:3000 -v "$(pwd)/appdata:/appdata" ryze
```

---

## 3. Publish the panel over HTTPS

Discord only loads Activities from a **public HTTPS** URL: it fetches the panel through its own proxy, so it can't reach `localhost`. Ryze serves HTTP on port 3000; put a proxy with a certificate in front of it, then use that domain in *URL Mappings* (step 1.5).

### Option A: Nginx Proxy Manager

1. In NPM → **Hosts → Proxy Hosts → Add Proxy Host**.
2. *Details*:
   - **Domain Names**: `ryze.yourdomain.com` (with a DNS A/CNAME record pointing to your server).
   - **Scheme**: `http`
   - **Forward Hostname / IP**: the IP of the server running Ryze, or `ryze` if NPM is on the same Docker network as the container.
   - **Forward Port**: `3000` (or the `RYZE_PORT` you set).
   - Enable **Block Common Exploits**.
3. *SSL*: **Request a new SSL Certificate** (Let's Encrypt), enable **Force SSL** and **HTTP/2 Support**.
4. Save and check that `https://ryze.yourdomain.com/api/health` returns `{"ok":true,...}`.

If NPM and Ryze share a Docker network, you can drop `ports:` from the compose file and join them like this:

```yaml
services:
  ryze:
    # ...
    networks: [npm]
networks:
  npm:
    external: true   # the name of your Nginx Proxy Manager network
```

### Option B: Cloudflare Tunnel

No open ports or public IP needed.

1. In Cloudflare Zero Trust → **Networks → Tunnels → Create a tunnel** (type *Cloudflared*). Copy the token.
2. Add the connector to your `docker-compose.yml`:

   ```yaml
   services:
     ryze:
       # ...
     cloudflared:
       image: cloudflare/cloudflared:latest
       restart: unless-stopped
       command: tunnel --no-autoupdate run
       environment:
         TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
       depends_on: [ryze]
   ```

   and `CLOUDFLARE_TUNNEL_TOKEN=...` in `.env`.
3. In the tunnel → **Public Hostname → Add**:
   - **Subdomain/Domain**: `ryze.yourdomain.com`
   - **Service**: `HTTP` → `ryze:3000` (if cloudflared runs in the same compose) or `localhost:3000` (if it runs on the host).
4. Check `https://ryze.yourdomain.com/api/health`.

For a quick test without a domain: `cloudflared tunnel --url http://localhost:3000` gives you a temporary `*.trycloudflare.com` URL (it changes every run, so update the URL Mapping each time).

---

## Local development

Requires Node.js 22.13 or newer (24+ recommended).

```bash
npm install
cp .env.example .env     # set DEV_GUILD_ID so commands register instantly in your server
npm run build:web        # build the panel once (or use `npm run dev:web` with a tunnel to port 5173)
npm run dev              # bot + API with auto-reload
```

Or without Docker in production mode: `npm run build` and `npm start` (both read `.env`).

### Preview the panel locally (no tunnel)

Discord desktop can load the Activity from your PC with the **Application URL Override**, but **only over HTTPS**. With `http://localhost` it stays blank.

1. Create a trusted certificate for `localhost`:
   ```powershell
   winget install FiloSottile.mkcert   # then open a new terminal
   mkcert -install
   mkdir certs
   mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost 127.0.0.1
   ```
2. In `.env`:
   ```env
   HTTPS_CERT_FILE=./certs/localhost.pem
   HTTPS_KEY_FILE=./certs/localhost-key.pem
   ```
3. `npm start` → `listening on https://localhost:3000`.
4. Discord → User Settings → Advanced → **Developer Mode** and **Application URL Override** = `https://localhost:3000`. Fully quit Discord and reopen it.
5. Open the Activity (`/panel` or 🚀). To debug, `LOG_REQUESTS=1` prints every request to the console.

Remove the override when you use the tunnel or your domain: while it's set, Discord always uses the override.

| Script | Description |
| --- | --- |
| `npm run dev` | Bot + web server with auto-reload (tsx) |
| `npm run dev:web` | Vite dev server for the panel on :5173 (proxies `/api` to :3000) |
| `npm run build` | Builds the bot (`dist/`) and the panel (`dist/public/`) |
| `npm run typecheck` | Type-checks the bot and the panel |
| `npm start` | Runs the built version |

### Project structure

```
src/
  index.ts            startup: migration, web server and bot
  config.ts           environment variables
  db.ts               SQLite: settings, temporary channels, activity log
  settings.ts         per-server settings schemas (zod)
  permissions.ts      owner / managers / anti-spam exemptions
  bot/
    client.ts         discord.js client and events
    commands.ts       slash commands and the "Open panel" button
    tempChannels.ts   Join to Create
    antispam.ts       spam detection, timeout and alerts
    alerts.ts         alert channel and mentions
    voiceActions.ts   channel actions (lock, permit, rename…) shared by /voice and the panel
  web/
    server.ts         admin API + static files + avatar proxy
    member.ts         "My channel" API (/api/me) for any member
    auth.ts           Activity OAuth2 login, sessions and requireAdmin
web/src/              panel: React + TSX + Tailwind + lucide-react
  App.tsx             startup (Embedded App SDK) and My channel ↔ Configure Ryze switch
  views/MyChannel.tsx member view
  views/admin/        configuration tabs
  components/ui.tsx   shared components
docker/entrypoint.sh  fixes /appdata ownership and drops to an unprivileged user
```

### Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Yes | | Bot token |
| `DISCORD_CLIENT_ID` | Yes | | Application ID |
| `DISCORD_CLIENT_SECRET` | Yes | | OAuth2 Client Secret |
| `DATA_DIR` | No | `./appdata` (`/appdata` in Docker) | Persistent data folder |
| `PORT` | No | `3000` | HTTP port of the panel |
| `DEV_GUILD_ID` | No | | Registers commands only in that server |
| `PRESENCE_TEXT` | No | `/help · /voice` | Bot status text |
| `EVENT_RETENTION_DAYS` | No | `90` | Days the activity log is kept |
| `HTTPS_CERT_FILE` / `HTTPS_KEY_FILE` | No | | Serve the panel over HTTPS (local testing with the URL override only) |
| `LOG_REQUESTS` | No | | `1` = print every HTTP request to the console |
