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

