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
| `POST` | `/api/export` | Export elements as Palette Arsenal JSON |
