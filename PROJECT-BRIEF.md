# Patch Stash — Project Brief (Design Spec v1)

> **Status:** Pre-build design specification. Nothing has been built yet. This document is the agreed spec to build against, in the same spirit as the Palette Arsenal, Willpower, and Workout Ledger briefs — it explains not just *what* to build but *why*, so a future session can pick up the reasoning without re-litigating it.
>
> **Part of:** Dance Music Toolkit. This is the first tool in the toolkit that is *not* a standalone local HTML file — see "A Deliberate Departure From Toolkit Convention" below before building anything.

---

## What This Project Is

Patch Stash is a small, password-protected, self-hosted web app — packaged as a Docker container — for exchanging sound design elements between collaborators who aren't in the same room, or between your own past and future self when you're away from the studio. Elements are synth patches, FX chains, DAW project files, audio renders, or nothing but an idea with a description.

It borrows its core vocabulary directly from Palette Arsenal: a configurable layer classification system (defaulting to Foundation / Movement / Texture / Punctuation / Psychedelic Detail but fully customisable per instance), the same append-only log pattern used by the Producer Log, and — critically — a JSON export format that lines up with Palette Arsenal's own sound object schema, so anything accepted here can be pulled straight into a palette without re-typing metadata.

It serves two distinct use cases equally well:

1. **Remote collaboration.** Artist A preps elements ahead of a studio session — days or weeks in advance — and Artist B reviews, tries, and triages them asynchronously before A and B are ever in the same room. By the time the session starts, the sorting work is already done.
2. **Solo, on-the-go capture.** You have an idea in a coffee shop or on holiday, with no studio and no DAW open. You record a rough audio idea on your phone, write what it's chasing, tag it, and park it. When you're back at the studio, you pull it into the relevant palette.

Both cases use exactly the same app and the same data model — the only difference is whether there's a second person involved.

---

## The Real-World Problem It Solves

- **Remote collaboration currently means a shared folder plus a chat thread.** Nothing tracks what's been listened to, what's been decided, or why. Decisions live in scrollback and get lost.
- **There's no record of the conversation an accepted or rejected sound actually had.** "I liked it but didn't use it because X" or "this is close but change the filter movement" disappears into a DM instead of staying attached to the file.
- **Ideas captured away from the studio have nowhere good to land.** A phone voice memo of a groove idea, or a patch sketched on a laptop between sessions, currently either gets forgotten or requires manually re-entering it into Palette Arsenal later — enough friction that it often just doesn't happen.

---

## Core Design Principles

- **Asynchronous by design, not as a compromise.** There is no notification system, no live status, no read receipts. The intended experience is closer to opening a box of tools that's quietly evolved since you last looked, on your own schedule. If two people genuinely need to coordinate in real time, that's what WhatsApp is for — this app should never try to replace that.
- **Bundle-first, not file-first.** The unit of the app is an *element* — an idea with a title, a description, and a classification — which *may* have files attached. An element with zero files is a completely valid, first-class thing: a tagged idea with a detailed comment, waiting for a file later or never getting one.
- **Simple auth now, room to grow later.** A single shared password gates the whole app in v1. No per-user accounts, no per-project permissions. This is explicitly scoped to a small number of trusted collaborators.
- **Palette Arsenal interoperability is a first-class feature, not an afterthought.** Anything with status `selected` or `imported` should be exportable in a form Palette Arsenal can absorb directly.
- **The layer taxonomy serves the project, not the genre.** Default layers match Palette Arsenal's five, but every instance can add, rename, reorder, and delete them — so the app works for any musical style or project type, not just psy-techno.
- **Legible on any device, in any lighting.** The app will be used in the field on laptops and small tablets. The design must be comfortable to read in bright ambient light and on non-studio screens — see Aesthetic below.

---

## A Deliberate Departure From Toolkit Convention

Every other tool in the Dance Music Toolkit is a single self-contained HTML file, opened via `file://`, with zero backend and zero ongoing maintenance beyond editing the file in place. Patch Stash cannot work that way — real password gating, real multi-user shared state, and real uploaded-file storage all require a server-side component. What changes:

- This app is a small Node.js HTTP server (serving the frontend and handling API routes), packaged as a Docker container alongside a SQLite database file and an uploaded-files directory on a host-mounted volume.
- Deploying an update means pulling a new container image and restarting, not dropping a new HTML file into a folder.
- There is a small ongoing maintenance surface: a container to occasionally update, a password to rotate, and a data directory to back up.

None of this is a reason not to build it — but it's a different mode of operation than everything else in this project, worth going in with eyes open.

---

## Hosting Architecture — Docker + SQLite + Host Volume

### The stack

A single Docker container running a small Node.js server (Express or Fastify). No external services, no cloud accounts, no vendor dependencies. Everything the app needs is either in the container image or on the mounted host volume.

```
docker-compose.yml
  └── patchstash container
        ├── Node.js HTTP server (API + static frontend)
        └── /app/data  ← bind-mounted from host
              ├── patchstash.db          (SQLite — all metadata)
              └── files/
                    └── {projectId}/{elementId}/
                          ├── primary.{ext}
                          └── audio.{ext}
```

The compose file is the primary way to run it — documents the volume mount, port, and env vars in one place, and is what gets handed to a collaborator or pasted into a VPS setup guide.

### Deployment scenarios

- **Home server + Tailscale:** run permanently on home infrastructure; access from anywhere on the Tailscale network. In this configuration, Tailscale *is* the authentication layer — the app's own password gate can be disabled entirely by not setting `AUTH_PASSWORD`.
- **Temporary collaboration VPS:** spin up a cheap cloud instance (Hetzner, DigitalOcean, etc.) for a limited-duration collab, run the container with the password gate enabled, tear it down when done. Data directory tars up cleanly for archiving before teardown.
- **Offline / local use:** run on a laptop with no network access at all — useful for solo capture at an airport or anywhere with no connectivity.

### Authentication

Controlled by a single environment variable:

```
AUTH_PASSWORD=your-shared-password
```

If set: every request that isn't the login endpoint gets checked for a valid session cookie. The login page accepts the password, sets an httpOnly session cookie, and that's the entire auth system.

If not set: no auth check at all. Correct mode for a Tailscale-gated home instance.

This is a single middleware function at the top of the Express router — easy to audit, nothing clever.

### Storage

**SQLite** via the `better-sqlite3` package. A single `patchstash.db` file in the mounted data directory. Synchronous API keeps the code simple; at this scale there is no concurrency pressure that would warrant anything heavier.

**Files** stored directly on the host filesystem under `/app/data/files/`, organised as `{projectId}/{elementId}/primary.{ext}` and `{projectId}/{elementId}/audio.{ext}`. Human-inspectable, directly accessible from the host for backup without opening the app.

**Uploads** are streamed directly to disk via multipart form handling — no holding the whole file in memory.

### Backup

```bash
# Back up everything
tar czf patchstash-backup.tar.gz /path/to/data/

# Database only
cp /path/to/data/patchstash.db patchstash-backup.db
```

### Updating the container

```bash
docker compose pull
docker compose up -d
```

The data volume persists across container replacements. Schema migrations run on startup and are idempotent.

---

## Data Model

### Layer (configurable taxonomy)

```javascript
{
  id: String,           // stable internal identifier, used in element.layerId
  name: '',             // display label — e.g. "Movement", "Rhythmic Texture", "Pad"
  colour: '',           // hex colour for the layer badge
  order: Number,        // controls display order in filters and element grids
  archived: Boolean,    // true when a layer is removed but elements still reference it
}
```

**Defaults seeded on first run** (matching Palette Arsenal exactly):

| id | name | colour |
|---|---|---|
| `foundation` | Foundation | `#ff2060` |
| `movement` | Movement | `#c8ff00` |
| `texture` | Texture | `#00deff` |
| `punctuation` | Punctuation | `#ffaa00` |
| `psychedelic` | Psychedelic Detail | `#a855f7` |

All five can be renamed, recoloured, reordered, or deleted. New layers can be added at any time with a name and a colour — the colour picker should offer the standard toolkit palette as suggestions without restricting to it.

**Deletion constraint:** a layer cannot be hard-deleted if any element references it. Two paths offered in the UI:
- **Archive:** the layer stops appearing in pickers but existing elements retain their tag, displayed greyed-out.
- **Migrate:** pick a replacement layer for all currently-tagged elements, then delete.

Hard deletion is only possible once zero elements reference the layer.

**Palette Arsenal export mapping:** when exporting elements that use custom (non-default) layers, the export flow prompts the user to map each custom layer to one of Palette Arsenal's five fixed layers. This is a one-time prompt per export session, not a persistent mapping.

### Project

```javascript
{
  id: String,
  name: '',              // e.g. "Carbon Swirl collab w/ B"
  bpm: '',               // inheritable default for elements in this project
  key: '',               // inheritable default
  flavours: [],          // freetext genre tags — not locked to Palette Arsenal's list
  description: '',
  createdAt: '',
  archived: Boolean,     // hide from the project switcher without deleting data
}
```

BPM, key, and flavours set here are **defaults**, not locks — each element can override them individually.

### Element

```javascript
{
  id: String,
  projectId: String,
  title: '',                 // required
  description: '',           // what the idea is, what it's chasing

  // Classification
  layerId: '',               // references layers.id
  sourceType: '',            // see Source Type below
  processingState: '',       // see Processing State below
  energyLevel: '',           // 'low' | 'mid' | 'high' | '' (optional)

  // Inherited / overridable from project
  bpm: '',
  key: '',

  // Optional fields mirroring Palette Arsenal's sound object for clean export
  synth: '',
  bank: '',
  patch: '',
  tech: '',                  // technique notes

  // Optional files — both are independent; either or neither may be present
  primaryFile: {
    filename: '',
    type: '',                // 'synth-patch' | 'fx-chain' | 'daw-project' | 'archive' | 'other'
    sizeBytes: Number,
    uploadedAt: '',
  } | null,

  audioFile: {
    filename: '',
    sizeBytes: Number,
    uploadedAt: '',
  } | null,

  status: '',                // 'new' | 'under-assessment' | 'selected' | 'imported' | 'rejected'
  log: [],                   // array of StatusLogEntry

  submittedBy: '',           // freetext display name, not authenticated identity
  createdAt: '',
  updatedAt: '',
}
```

### Status Log Entry

```javascript
{
  id: String,
  elementId: String,
  fromStatus: '' | null,    // null for a freestanding note with no status change
  toStatus: '' | null,
  comment: '',              // required on status change; optional on freestanding note
  author: '',               // freetext display name
  createdAt: '',
}
```

---

## The Element Bundle — Files In Detail

An element can have **zero, one, or two files**:

- **Primary file** (optional) — a synth patch, FX chain, DAW project file, or archive. If a submission needs multiple files (patch plus samples, a small Ableton project folder), the primary file should be a `.zip` or `.7z`. The upload UI should surface a hint: *"multiple files? zip them up first"* — without blocking a single-file upload or making it feel like a warning.
- **Audio file** (optional) — a playable preview, rendered separately. This is what makes an element assessable without opening a DAW or plugin. Always treated as audio with no further type tag.

Both are optional and independent. Files can be added after initial element creation — submit the idea now, attach the render later. In a collaboration context, elements with both files have the most immediate impact; the UI should gently surface this (a small nudge on the card when audio is missing, not a validation error that blocks submission).

---

## Classification System — Layers + Additional Tags

Beyond the layer (sonic function), three additional structured tags can be set on any element. All are optional and all are filterable in the project view.

### Source Type
What was used to create the element. Makes a project view filterable by instrument/tool type without requiring the reviewer to know the exact plugin name.

Fixed options:
- `software-synth` — VST/AU plugin synthesiser (e.g. Serum, Vital)
- `hardware-synth` — physical synthesiser or groovebox
- `sample` — a recorded, sampled, or sliced audio source
- `field-recording` — environmental or found-sound recording
- `plugin-chain` — an FX chain / preset stack with no specific synth
- `daw-project` — a partial or complete DAW session file
- `other`

### Processing State
Tells the reviewer how finished the element is before they need to open anything. Particularly valuable in collaboration — B knows immediately whether they're getting a sketch or something print-ready.

Fixed options:
- `raw` — dry signal, minimal processing; rough idea only
- `processed` — treated and shaped but not finalised
- `print-ready` — mixed and polished; can drop straight into a session
- `stems` — multiple layered or separated components (likely a zip)

### Energy Level
Simple three-way indicator of the element's intensity/density. Useful when searching for something specific while building a track ("what do I have that's high energy in the movement layer?"). Works across all genres.

Fixed options: `low` | `mid` | `high`

### Filtering in the project view
The project view supports filtering by any combination of:
- Layer
- Status
- Source type
- Processing state
- Energy level

Filters are additive (AND logic within a field, e.g. layer = Movement AND status = new) and independently clearable. The filter bar should stay compact — small toggle buttons, not a full form — since it will often be used on a tablet in portrait.

---

## Status Workflow

| Status | Meaning |
|---|---|
| `new` | Submitted, not yet looked at |
| `under-assessment` | Actively being listened to / tried out |
| `selected` | Informal promise: reviewer intends to use it, not yet pulled into their project |
| `imported` | Confirmed: files downloaded and pulled into the studio project or Palette Arsenal |
| `rejected` | Won't be used |

**On the selected / imported distinction:** `selected` is an informal hold — "I like this, I'm going to use it." `imported` is the terminal success state — "files downloaded, sitting in my project folder or Palette Arsenal." The two states earn their distinction because the reviewer might mark something `selected` days before actually sitting down to integrate it; seeing a list of `selected` elements is a useful "still to do" view. `imported` closes the loop.

**On rejection:** a single `rejected` status — the distinction between "outright reject" and "reject with notes on how to change it" lives entirely in the comment attached to that transition. The log carries the nuance; no second enum value needed.

**Every status change requires a comment.** Freestanding log notes (not tied to a status change) are also allowed, for mid-assessment observations that don't yet warrant moving the status.

---

## Palette Arsenal Interop

Export produces JSON shaped like a Palette Arsenal v11 sound object for each selected element:

```javascript
{
  name: element.title,
  synth: element.synth,
  bank: element.bank,
  patch: element.patch,
  file: '',          // left blank — user places the downloaded file into their layer folder
                      // and fills this in, exactly as with any other sound file in Palette Arsenal
  desc: element.description,
  tech: element.tech,
  savedAt: element.createdAt,
}
```

Custom layers are mapped to Palette Arsenal's five fixed layers at export time via a prompted per-layer dropdown.

**Palette Arsenal companion feature (prerequisite, not part of this build):** Palette Arsenal's current `importJSON()` replaces the entire palette state. For this export to be actually useful, Palette Arsenal v11 needs an "import sounds only" action that appends incoming sound objects into `state.sounds[layer]` without touching the rest of the palette state. This is a small, self-contained addition to Palette Arsenal — flagged here so it doesn't get missed when sequencing the build.

---

## Identity & Access

**Access:** controlled by `AUTH_PASSWORD` environment variable. If set, a shared-password login gate protects the whole app. If not set, no auth — appropriate when network access is itself gated (Tailscale, VPN, local-only).

**Attribution without accounts:** `submittedBy` and log `author` are freetext. The app asks for a display name once per browser (stored in localStorage, never on the server) and pre-fills it into every submission and log entry from that browser. It's a courtesy label, not a security control — the distinction should be clear in any UI that surfaces it.

**Growing this later:** real per-user accounts and per-project visibility would require adding a `users` table, replacing freetext author fields with user IDs, and a `projectMembers` join table. The current data model supports this as an additive change — nothing needs to be rebuilt.

---

## Screens

1. **Login** — single shared password, session via httpOnly cookie. Skipped entirely if `AUTH_PASSWORD` is unset.
2. **Project switcher** — list of active projects (archived hidden by default), + create new. Compact enough to work as a landing page on a phone.
3. **Project view** — element grid/list with filter bar (layer, status, source type, processing state, energy level). Project BPM/key/flavours shown as context. Default sort: newest first.
4. **Element detail / create** — title, description, layer picker, source type, processing state, energy level, BPM/key (pre-filled from project, editable), optional synth/bank/patch/tech fields, file upload slots (primary + audio), inline audio player, status control, log.
5. **Export** — select one or more `selected`/`imported` elements → download as Palette Arsenal-compatible JSON. Custom layer mapping prompt appears if any elements use non-default layers.
6. **Layer Management** (settings area, not main nav) — add, rename, recolour, reorder, archive, migrate, delete layers.

**Mobile-first for the create flow:** the element create screen specifically must work comfortably on a phone — large tap targets, single-column layout, no hover-dependent interactions. The project view and detail screens can be desktop-optimised with a functional mobile fallback.

---

## Aesthetic

Patch Stash deliberately departs from the dark-terminal aesthetic used throughout the rest of the Dance Music Toolkit. The reasons:

- It will be used in the field, on laptops and small tablets, in varying ambient lighting including bright environments where dark backgrounds are harder to read.
- It may be used for genres and collaborators with no connection to the psy-techno world — the toolkit's acid green and near-black read as genre-specific to anyone who doesn't already know this project.
- It has a broader potential audience than any other tool in the toolkit.

**Chosen direction: warm off-white light theme, clean and tool-like.**

- **Background:** warm off-white (`#f8f7f4`) rather than stark white — easier on the eyes in varying lighting, avoids the clinical feel of pure white.
- **Surface:** white (`#ffffff`) for cards and panels, with a subtle shadow or border to create depth.
- **Text:** near-black (`#1a1a1a`) for primary content; `#555` for secondary labels; `#999` for metadata and timestamps. High-contrast ratios throughout — minimum WCAG AA for all text.
- **Accent:** calm slate-blue (`#3b6fd4`) — professional, readable on light backgrounds, not genre-coded, works as an interactive colour for buttons, selected states, and highlights. On hover/active states, a slightly deeper `#2d57b8`.
- **Fonts:** Inter (or system-ui) for body text and UI — neutral, highly legible at small sizes on any screen; Space Mono retained for filenames, metadata fields, BPM/key values, and log timestamps where the monospace character is genuinely useful, not decorative.
- **Type sizing:** base 15px (not 14px as elsewhere in the toolkit), with clearly differentiated heading sizes. This is a content-first app used on non-studio screens — legibility over density.
- **Layer badge colours:** kept from Palette Arsenal's colour language exactly (pink, green, cyan, amber, violet) so that elements look visually consistent whether they're in Patch Stash or in a Palette Arsenal. These pop cleanly against the light background.
- **No noise grain overlay.** That texture is part of the dark toolkit's character and would look out of place here.
- **Touch targets:** minimum 44×44px on interactive elements in the create flow.

The overall impression should be a clean, professional tool — closer to a well-designed notes app than a music production terminal. Someone who has never seen Palette Arsenal should find it immediately legible.

---

## Explicitly Out of Scope for v1

- Per-user accounts and per-project permissions (additive later, not a rebuild).
- Notifications of any kind — deliberate product decision, not a missing feature.
- In-app zip/archive creation — the app nudges you to zip multi-file submissions, doesn't do it for you.
- Real-time / live collaborative editing.
- Waveform visualisation on the audio player.
- Bulk download of multiple elements' files as a single zip.
- The Palette Arsenal "import sounds only" companion feature — a prerequisite of the export flow but a separate piece of work against the existing Palette Arsenal v11 file, not part of Patch Stash's own build.

---

## Planned Future Enhancements

- Per-user accounts and per-project visibility.
- Optional notifications if the async-only model turns out to be insufficient.
- Bulk export/download.
- Per-project layer taxonomy override (if the instance-level taxonomy turns out to be too coarse once used across genuinely different project types simultaneously).
- Waveform visualisation on the audio player.

---

## Critical Development Rules

1. **Single shared password only in v1.** The schema supports real accounts later without a rebuild — don't over-build now.
2. **No notification system of any kind.** Deliberate product decision.
3. **`AUTH_PASSWORD` controls the entire auth gate.** If unset, no auth. If set, every non-login route is gated. Nothing more complex than this middleware in v1.
4. **Uploads are streamed to disk, never buffered in memory.** Use multipart streaming directly to the data volume.
5. **An element with zero files is valid everywhere.** Filters, export, and the element detail view must never assume a file exists.
6. **Rejection is one status.** The nuance lives in the log comment text.
7. **`submittedBy` / log `author` are freetext, not authentication.** Code and documentation must never imply otherwise.
8. **Layer deletions must respect referential integrity.** Block hard deletion of any layer referenced by elements — offer archive or migrate instead.
9. **The Palette Arsenal export format tracks Palette Arsenal v11's actual sound object schema.** If that schema changes in a future Palette Arsenal version, this export must be updated alongside it — it's a live contract between two apps.
10. **SQLite migrations run on container startup and are idempotent.** Any new column or table must use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` or equivalent — old data volumes must always load cleanly.
11. **The data volume is the source of truth.** The container image is stateless and disposable. Destroying and recreating the container against the same volume must restore the app to exactly the same state.
12. **Document the exact `docker compose` workflow** in a README alongside the project — this is the first container in the toolkit and the run/update/backup commands need to be written down clearly.

---

## Open Questions Still Worth Settling (non-blocking)

- Exact wording and placement of the "zip multiple files" nudge in the upload UI.
- Whether the display-name-for-attribution idea (stored in localStorage, pre-filled into every log entry) is worth building in v1, or whether freetext-every-time is acceptable to start.
- Whether the layer taxonomy should eventually be per-project rather than per-instance (deferred — assess after using the instance-level model in practice).

---

## Suggested Build Order

Reasonable phases, each independently testable:

1. **Container scaffold** — Node.js + Express, Dockerfile, docker-compose.yml with volume mount, port config, SQLite initialisation, schema migrations runner, `AUTH_PASSWORD` middleware.
2. **Layer management** — seed default layers, full CRUD (add/rename/recolour/reorder/archive/migrate/delete with referential integrity check), Layer Management screen.
3. **Project + element CRUD** — create/edit/archive projects and elements, no files yet, all classification tags, layer picker using the live taxonomy.
4. **File upload + download + audio playback** — multipart upload streaming to host volume, download endpoint, inline audio player, "zip multiple files" nudge in the UI.
5. **Status workflow + log** — status transitions with required comment, freestanding log notes, log display on element detail.
6. **Palette Arsenal export** — element selection, custom layer mapping prompt if needed, JSON download shaped to Palette Arsenal v11 sound object schema. (Companion "import sounds only" feature in Palette Arsenal is a separate piece of work, tracked against that project.)
