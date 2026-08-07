# Patch Stash

Self-hosted sound element exchange for music producers. Part of the Dance Music Toolkit.

Upload synth patches, FX chains, audio renders, and ideas. Tag them by layer, source type, and processing state. Track their status through a review workflow. Export accepted elements directly into Palette Arsenal.

---

## Requirements

- Docker Engine (not Docker Desktop) on the host machine
- Git

---

## First-time setup on Ubuntu

### 1. Install Docker Engine

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

Log out and back in so the group change takes effect. Verify with:

```bash
docker run hello-world
```

### 2. Clone the repository

```bash
git clone https://github.com/yourname/patchstash.git ~/patchstash
cd ~/patchstash
```

### 3. Create the data directory

```bash
mkdir -p ~/patchstash-data
```

This is where the SQLite database and all uploaded files will live. It persists across container rebuilds.

### 4. Configure environment variables

```bash
cp .env.example .env
nano .env
```

Set the following in `.env`:

| Variable | Description |
|---|---|
| `AUTH_PASSWORD` | Shared login password. Leave blank to disable auth (Tailscale use). |
| `SESSION_SECRET` | Long random string for cookie signing. Generate with the command below. |
| `DATA_DIR` | Path to your data directory, e.g. `/home/james/patchstash-data` |

Generate a session secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 5. Build and start

```bash
docker compose up -d --build
```

The app will be available at `http://localhost:3000` (or your machine's IP/Tailscale hostname on port 3000).

Check it's running:
```bash
docker compose logs -f
```

---

## Daily operation

### Start / stop

```bash
docker compose up -d      # start (or restart if already stopped)
docker compose down       # stop
```

The container is set to `restart: unless-stopped`, so it starts automatically when the Ubuntu machine boots.

### Check status and logs

```bash
docker compose ps
docker compose logs -f patchstash
```

### Update to a new version

```bash
cd ~/patchstash
git pull
docker compose up -d --build
```

The data directory is untouched by this process. Database migrations run automatically on startup.

---

## Backup

Everything important is in the data directory.

```bash
# Full backup (database + all uploaded files)
tar czf patchstash-backup-$(date +%Y%m%d).tar.gz ~/patchstash-data/

# Database only (files can be re-uploaded if lost)
cp ~/patchstash-data/patchstash.db ~/patchstash-backup-$(date +%Y%m%d).db
```

---

## Restore from backup

```bash
# Stop the container
docker compose down

# Restore the data directory
tar xzf patchstash-backup-YYYYMMDD.tar.gz -C ~/

# Start again
docker compose up -d
```

---

## Changing the password

Edit `.env`, update `AUTH_PASSWORD`, then restart:

```bash
docker compose up -d
```

Active sessions will remain valid until they expire (7 days). To immediately invalidate all sessions, restart the container — in-memory sessions are cleared on restart.

---

## Accessing via Tailscale

If you're running on a home server with Tailscale:

1. Leave `AUTH_PASSWORD` blank in `.env` — Tailscale network membership is the security gate.
2. Access the app at `http://your-tailscale-hostname:3000` from any device on your Tailscale network.

For a temporary public collaboration instance (e.g. a VPS), set `AUTH_PASSWORD` to a strong shared password and share it with your collaborator via a separate channel.

---

## Temporary collaboration VPS

To spin up a temporary instance on a cheap VPS:

```bash
# On the VPS (Hetzner, DigitalOcean, etc.)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# re-login

git clone https://github.com/yourname/patchstash.git
cd patchstash
mkdir -p ~/patchstash-data
cp .env.example .env
# Set AUTH_PASSWORD, SESSION_SECRET, DATA_DIR in .env
docker compose up -d --build
```

When the collaboration is done:

```bash
# Back up data before teardown
tar czf final-backup.tar.gz ~/patchstash-data/
# Download the backup to your local machine, then tear down the VPS
```

---

## Architecture

```
patchstash/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
├── server/
│   ├── index.js          Entry point — Express app, middleware, route registration
│   ├── db.js             SQLite connection, migrations, seed
│   ├── migrations.js     Idempotent schema (CREATE TABLE IF NOT EXISTS etc.)
│   ├── seed.js           Seeds default layers on first run
│   ├── auth.js           Session handling + requireAuth middleware
│   └── routes/
│       ├── login.js      POST /api/login, POST /api/logout, GET /api/auth
│       ├── layers.js     Layer taxonomy CRUD
│       ├── projects.js   Project CRUD
│       ├── elements.js   Element CRUD + status transitions + log
│       ├── files.js      Streaming upload/download/delete for primary + audio files
│       └── export.js     Palette Arsenal JSON export
└── public/
    ├── index.html        Single-page frontend (full UI in Phase 3+)
    ├── style.css         Light theme stylesheet
    └── app.js            Frontend JS
```

### Data directory layout (on host)

```
patchstash-data/
├── patchstash.db
└── files/
    └── {projectId}/
        └── {elementId}/
            ├── primary_{originalname}.wav   (or .zip, .fxp, .als, etc.)
            └── audio_{originalname}.mp3
```

---

## API reference (brief)

All routes are under `/api/`. All return JSON. Authentication (when enabled) is via session cookie set at `/api/login`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auth` | Check auth status |
| `POST` | `/api/login` | Log in with shared password |
| `POST` | `/api/logout` | End session |
| `GET` | `/api/layers` | List all layers |
| `POST` | `/api/layers` | Create layer |
| `PATCH` | `/api/layers/:id` | Update layer |
| `DELETE` | `/api/layers/:id` | Delete layer (blocked if elements reference it) |
| `POST` | `/api/layers/:id/migrate` | Move elements to another layer, then delete |
| `GET` | `/api/projects` | List projects |
| `POST` | `/api/projects` | Create project |
| `PATCH` | `/api/projects/:id` | Update project |
| `DELETE` | `/api/projects/:id` | Delete project + all elements |
| `GET` | `/api/projects/:id/elements` | List elements (filterable) |
| `POST` | `/api/projects/:id/elements` | Create element |
| `GET` | `/api/elements/:id` | Get element |
| `PATCH` | `/api/elements/:id` | Update element metadata |
| `POST` | `/api/elements/:id/status` | Change status (always creates log entry) |
| `GET` | `/api/elements/:id/log` | Get element log |
| `DELETE` | `/api/elements/:id` | Delete element + log |
| `POST` | `/api/elements/:id/files/:slot` | Upload file (slot: primary or audio) |
| `GET` | `/api/elements/:id/files/:slot` | Download / stream file |
| `DELETE` | `/api/elements/:id/files/:slot` | Delete file |
| `GET` | `/api/export/check?ids=...` | Pre-flight: check if custom layer mapping needed |
| `POST` | `/api/export` | Export elements as Palette Arsenal JSON |-

--

## What gets built — the complete picture

The app has three logical parts that live together in one repository:

**1. The Node.js server** (`server/`) — handles everything that needs to run on the backend: authentication middleware, all API routes (projects, elements, layers, files, status/log), file upload streaming to disk, and serving the frontend as static files. About 600–800 lines of straightforward Express code across a handful of files. No framework magic, no ORM — just `better-sqlite3` for the database and `busboy` for streaming file uploads.

**2. The frontend** (`public/`) — a single-page HTML/CSS/JS application, built in exactly the same way as every other tool in this toolkit: vanilla JS, no framework, no bundler. It talks to the server via `fetch()` calls to the API routes. Because it's served by the Node server (not opened via `file://`), it can make authenticated API calls without any CORS complexity.

**3. The container packaging** (root level) — `Dockerfile`, `docker-compose.yml`, `.env.example`, `README.md`. This is everything needed to go from the repository to a running instance.

---

## Disk layout — the repository

```
patchstash/
├── Dockerfile
├── docker-compose.yml
├── .env.example          ← copy to .env and set AUTH_PASSWORD, PORT etc.
├── .gitignore            ← excludes node_modules, .env, and the data/ directory
├── README.md             ← install, run, update, backup commands
│
├── server/
│   ├── index.js          ← entry point: creates Express app, registers middleware, starts listening
│   ├── db.js             ← opens the SQLite connection, runs migrations on startup
│   ├── migrations.js     ← idempotent schema setup: CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT EXISTS
│   ├── auth.js           ← the AUTH_PASSWORD middleware (single function, ~30 lines)
│   ├── routes/
│   │   ├── login.js      ← POST /api/login, GET /api/logout
│   │   ├── projects.js   ← CRUD for projects
│   │   ├── elements.js   ← CRUD for elements + status transitions + log
│   │   ├── files.js      ← upload (streaming), download, delete for primary + audio files
│   │   ├── layers.js     ← CRUD for the configurable layer taxonomy
│   │   └── export.js     ← Palette Arsenal JSON export
│   └── seed.js           ← seeds the five default layers if the layers table is empty on first run
│
└── public/
    ├── index.html        ← the single HTML file that is the entire frontend
    ├── style.css         ← the light-theme stylesheet
    └── app.js            ← all frontend JS: routing between views, API calls, DOM rendering
```

That's the entire source tree. No `src/`, no `dist/`, no build step. The Node server serves `public/` as static files directly.

---

## Disk layout — the host (Ubuntu machine)

The repository lives wherever you clone it. The data directory is separate from the repository — this is important, because the `.gitignore` explicitly excludes it and you never want uploaded audio files and patch files going to GitHub.

```
/home/james/                        ← or wherever you keep things
├── patchstash/                     ← git clone lands here
│   ├── docker-compose.yml
│   ├── .env                        ← not in git, created from .env.example
│   └── ... (source files)
│
└── patchstash-data/                ← host data directory, bind-mounted into the container
    ├── patchstash.db               ← created automatically on first run
    └── files/
        └── {projectId}/
            └── {elementId}/
                ├── primary.wav     ← or .zip, .fxp, .als, whatever was uploaded
                └── audio.mp3       ← the playable preview
```

The `docker-compose.yml` references the data directory with a relative or absolute path:

```yaml
services:
  patchstash:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - /home/james/patchstash-data:/app/data
    env_file:
      - .env
    restart: unless-stopped
```

`restart: unless-stopped` means the container comes back up automatically after a reboot of the Ubuntu machine — important for a always-on home server.

---

## The `.env` file (never committed to git)

```bash
AUTH_PASSWORD=something-strong-here
PORT=3000
SESSION_SECRET=another-random-string-for-cookie-signing
```

`SESSION_SECRET` is used to sign the session cookie so it can't be forged — should be a long random string. `AUTH_PASSWORD` is what collaborators type at the login screen. Both are absent from the repository; `.env.example` shows the keys without values.

---

## The Dockerfile — what actually happens at build time

```dockerfile
FROM node:22-alpine

WORKDIR /app

# Copy dependency manifest first (layer cache optimisation —
# npm install only reruns if package.json changes)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source
COPY server/ ./server/
COPY public/ ./public/

# The data directory is a mount point — nothing is baked into the image here
RUN mkdir -p /app/data/files

EXPOSE 3000
CMD ["node", "server/index.js"]
```

`npm ci` (not `npm install`) with `--omit=dev` runs only inside the image build — you never touch npm on the host. `node:22-alpine` keeps the image small (~50MB base).

---

## The workflow from your perspective

**First-time setup on Ubuntu:**
```bash
# Install Docker Engine (once, not Docker Desktop)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # so you don't need sudo for docker commands
# log out and back in

# Clone the repository
git clone https://github.com/you/patchstash.git ~/patchstash
cd ~/patchstash

# Create data directory
mkdir -p ~/patchstash-data

# Create .env from the example
cp .env.example .env
nano .env   # set AUTH_PASSWORD and SESSION_SECRET

# Build and start
docker compose up -d --build
```

The app is then running on `http://ubuntu-machine-ip:3000`. Via Tailscale, that becomes `http://ubuntu-tailscale-hostname:3000` from anywhere on your network.

**Updating after you push changes to GitHub:**
```bash
cd ~/patchstash
git pull
docker compose up -d --build
```

That's the entire update process. The data directory is untouched.

**Backup:**
```bash
tar czf patchstash-backup-$(date +%Y%m%d).tar.gz ~/patchstash-data/
```

