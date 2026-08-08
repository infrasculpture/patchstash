'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
//  Patch Stash — frontend single-page application
//
//  Architecture:
//    - api.*       thin fetch wrappers, always return { data } or { error }
//    - router.*    hash-based routing (#/projects, #/layers, etc.)
//    - toast.*     non-blocking notification system
//    - views.*     one function per screen, returns nothing, writes to #app
//    - modal.*     shared modal helpers
//
//  Phases 3–6 add new view functions and route entries; nothing else changes.
// ═══════════════════════════════════════════════════════════════════════════════

// ── API client ────────────────────────────────────────────────────────────────

const api = {
  async request(method, path, body, isFormData) {
    const opts = {
      method,
      headers: isFormData ? {} : { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = isFormData ? body : JSON.stringify(body);
    try {
      const res = await fetch(path, opts);
      const data = await res.json();
      if (!res.ok) return { error: data.error || `HTTP ${res.status}`, data };
      return { data };
    } catch (e) {
      return { error: 'Network error — is the server running?' };
    }
  },
  get:    (path)        => api.request('GET',    path),
  post:   (path, body)  => api.request('POST',   path, body),
  patch:  (path, body)  => api.request('PATCH',  path, body),
  delete: (path)        => api.request('DELETE', path),
  upload: (path, form)  => api.request('POST',   path, form, true),

  // Domain helpers
  auth:     ()         => api.get('/api/auth'),
  login:    (pw)       => api.post('/api/login', { password: pw }),
  logout:   ()         => api.post('/api/logout'),

  layers:          ()           => api.get('/api/layers'),
  createLayer:     (body)       => api.post('/api/layers', body),
  updateLayer:     (id, body)   => api.patch(`/api/layers/${id}`, body),
  deleteLayer:     (id)         => api.delete(`/api/layers/${id}`),
  migrateLayer:    (id, target) => api.post(`/api/layers/${id}/migrate`, { targetLayerId: target }),

  projects:        (archived)   => api.get(`/api/projects${archived ? '?archived=1' : ''}`),
  getProject:      (id)         => api.get(`/api/projects/${id}`),
  createProject:   (body)       => api.post('/api/projects', body),
  updateProject:   (id, body)   => api.patch(`/api/projects/${id}`, body),
  deleteProject:   (id)         => api.delete(`/api/projects/${id}`),

  elements:        (pid, q)     => api.get(`/api/projects/${pid}/elements${q ? '?' + q : ''}`),
  getElement:      (id)         => api.get(`/api/elements/${id}`),
  createElement:   (pid, body)  => api.post(`/api/projects/${pid}/elements`, body),
  updateElement:   (id, body)   => api.patch(`/api/elements/${id}`, body),
  deleteElement:   (id)         => api.delete(`/api/elements/${id}`),
  setStatus:       (id, body)   => api.post(`/api/elements/${id}/status`, body),
  getLog:          (id)         => api.get(`/api/elements/${id}/log`),

  uploadFile:      (id, slot, form) => api.upload(`/api/elements/${id}/files/${slot}`, form),
  deleteFile:      (id, slot)       => api.delete(`/api/elements/${id}/files/${slot}`),
  fileUrl:         (id, slot)       => `/api/elements/${id}/files/${slot}`,

  exportCheck:     (ids)        => api.get(`/api/export/check?ids=${ids.join(',')}`),
  exportElements:  (body)       => api.post('/api/export', body),
};

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  authenticated: false,
  authEnabled:   false,
  currentProject: null,   // { id, name, bpm, key } — set when user picks a project
};

// ── Toast notifications ───────────────────────────────────────────────────────

const toast = {
  show(msg, type = '', duration = 3200) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ` toast-${type}` : '');
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), duration);
  },
  success: (msg) => toast.show(msg, 'success'),
  error:   (msg) => toast.show(msg, 'error', 4500),
};

// ── Router ────────────────────────────────────────────────────────────────────

const router = {
  routes: {},

  register(path, handler) {
    this.routes[path] = handler;
  },

  navigate(path, replace = false) {
    if (replace) {
      history.replaceState(null, '', path);
    } else {
      history.pushState(null, '', path);
    }
    this.dispatch(path);
  },

  dispatch(path) {
    // Strip query string for route matching, keep it available for the handler
    const [pathname, search] = path.split('?');
    const params = new URLSearchParams(search || '');

    // Exact match first
    if (this.routes[pathname]) {
      return this.routes[pathname](params);
    }

    // Parameterised match: e.g. /projects/:id
    for (const [pattern, handler] of Object.entries(this.routes)) {
      const regex = new RegExp('^' + pattern.replace(/:([^/]+)/g, '([^/]+)') + '$');
      const match = pathname.match(regex);
      if (match) {
        const keys = [...pattern.matchAll(/:([^/]+)/g)].map(m => m[1]);
        const routeParams = Object.fromEntries(keys.map((k, i) => [k, match[i + 1]]));
        return handler(params, routeParams);
      }
    }

    // Fallback
    router.navigate('/projects', true);
  },

  init() {
    window.addEventListener('popstate', () => this.dispatch(location.pathname));
    this.dispatch(location.pathname);
  },
};

// ── Shell helpers ─────────────────────────────────────────────────────────────

function setApp(html) {
  document.getElementById('app').innerHTML = html;
}

function renderShell() {
  document.getElementById('root').innerHTML = `
    <div class="app-shell">
      <nav class="topnav" id="topnav">
        <div class="topnav-brand">Patch<span>Stash</span></div>
        <div class="topnav-project" id="topnav-project"></div>
        <div class="topnav-actions" id="topnav-actions"></div>
      </nav>
      <main class="main" id="main-area">
        <div id="app"></div>
      </main>
    </div>
    <div id="toast-container"></div>
    <div class="modal-backdrop hidden" id="modal-backdrop">
      <div class="modal" id="modal-box"></div>
    </div>
  `;
}

function updateTopnav() {
  const projectEl = document.getElementById('topnav-project');
  const actionsEl = document.getElementById('topnav-actions');
  if (!projectEl || !actionsEl) return;

  projectEl.innerHTML = state.currentProject
    ? `<strong>${esc(state.currentProject.name)}</strong>${state.currentProject.bpm ? ' · ' + esc(state.currentProject.bpm) + ' BPM' : ''}${state.currentProject.key ? ' · ' + esc(state.currentProject.key) : ''}`
    : '';

  actionsEl.innerHTML = `
    ${state.currentProject ? `<button class="btn btn-ghost btn-sm" onclick="router.navigate('/projects')">← Projects</button>` : ''}
    <button class="btn btn-ghost btn-sm" onclick="router.navigate('/layers')" title="Manage layers">⚙ Layers</button>
    ${state.authEnabled ? `<button class="btn btn-ghost btn-sm" onclick="doLogout()">Sign out</button>` : ''}
  `;
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

const modal = {
  open(title, bodyHtml, footerHtml) {
    document.getElementById('modal-box').innerHTML = `
      <div class="modal-header">
        <div class="modal-title">${title}</div>
        <button class="btn btn-ghost btn-icon" onclick="modal.close()" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
    `;
    document.getElementById('modal-backdrop').classList.remove('hidden');
    // Focus first input if present
    requestAnimationFrame(() => {
      const first = document.querySelector('#modal-box input, #modal-box textarea, #modal-box select');
      if (first) first.focus();
    });
  },

  close() {
    document.getElementById('modal-backdrop').classList.add('hidden');
    document.getElementById('modal-box').innerHTML = '';
  },
};

// Close modal on backdrop click
document.addEventListener('click', (e) => {
  if (e.target.id === 'modal-backdrop') modal.close();
});

// ── Utility ───────────────────────────────────────────────────────────────────

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function layerBadgeHtml(layer) {
  if (!layer) return '';
  const bg = layer.colour + '22'; // ~13% opacity
  return `<span class="layer-badge" style="background:${layer.colour}22;color:${layer.colour};border:1px solid ${layer.colour}55">${esc(layer.name)}</span>`;
}

function statusBadgeHtml(status) {
  const labels = {
    'new':              'New',
    'under-assessment': 'Under Assessment',
    'selected':         'Selected',
    'imported':         'Imported',
    'rejected':         'Rejected',
  };
  return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Shared colour presets (Palette Arsenal defaults + extras) ─────────────────

const COLOUR_PRESETS = [
  '#ff2060', '#c8ff00', '#00deff', '#ffaa00', '#a855f7', // PA defaults
  '#3b6fd4', '#e67e22', '#27ae60', '#e74c3c', '#1abc9c',
  '#9b59b6', '#f39c12', '#2980b9', '#d35400', '#7f8c8d',
];

// ── Auth ──────────────────────────────────────────────────────────────────────

async function doLogout() {
  await api.logout();
  state.authenticated = false;
  router.navigate('/login', true);
}

// ── LOGIN VIEW ────────────────────────────────────────────────────────────────

function viewLogin() {
  document.getElementById('root').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-brand">
          <h1>Patch<span>Stash</span></h1>
          <p>Sound element exchange</p>
        </div>
        <div id="login-alert"></div>
        <div class="field">
          <label for="login-pw">Password</label>
          <input type="password" id="login-pw" autocomplete="current-password" placeholder="Shared password">
        </div>
        <button class="btn btn-primary" style="width:100%" id="login-btn" onclick="submitLogin()">Sign in</button>
      </div>
    </div>
    <div id="toast-container"></div>
  `;
  document.getElementById('login-pw').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitLogin();
  });
  requestAnimationFrame(() => document.getElementById('login-pw').focus());
}

async function submitLogin() {
  const pw  = document.getElementById('login-pw').value;
  const btn = document.getElementById('login-btn');
  const alertEl = document.getElementById('login-alert');
  alertEl.innerHTML = '';
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  const { error } = await api.login(pw);
  if (error) {
    alertEl.innerHTML = `<div class="alert alert-error login-error">${esc(error)}</div>`;
    btn.disabled = false;
    btn.textContent = 'Sign in';
    document.getElementById('login-pw').select();
    return;
  }

  state.authenticated = true;
  renderShell();
  router.navigate('/projects', true);
}

// ── LAYER MANAGEMENT VIEW ─────────────────────────────────────────────────────

let _layers = []; // module-level cache for the current layer list

async function viewLayers() {
  updateTopnav();
  setApp(`<div class="page-header">
    <div class="page-header-left">
      <h1 class="page-title">Layer Management</h1>
      <p class="page-sub">Customise the classification taxonomy used across all projects. Default layers match Palette Arsenal's five.</p>
    </div>
    <div class="page-header-actions">
      <button class="btn btn-primary" onclick="openAddLayerModal()">+ Add layer</button>
    </div>
  </div>
  <div id="layer-list-wrap"><p class="muted">Loading…</p></div>`);

  await refreshLayers();
}

async function refreshLayers() {
  const { data, error } = await api.layers();
  if (error) { toast.error(error); return; }
  _layers = data;
  renderLayerList();
}

function renderLayerList() {
  const wrap = document.getElementById('layer-list-wrap');
  if (!wrap) return;

  if (!_layers.length) {
    wrap.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">◈</div>
      <p>No layers yet.</p>
      <p class="hint">Add your first layer to get started.</p>
    </div>`;
    return;
  }

  const rows = _layers.map((l, idx) => {
    const isFirst    = idx === 0;
    const isLast     = idx === _layers.length - 1;
    const archivedTag = l.archived
      ? `<span class="layer-archived-tag">archived</span>`
      : '';

    return `<div class="layer-row${l.archived ? ' archived' : ''}" data-id="${l.id}">
      <div class="drag-handle" title="Reorder">⠿</div>
      <div class="layer-colour-swatch" style="background:${esc(l.colour)}"></div>
      <div class="layer-name">${esc(l.name)}</div>
      ${archivedTag}
      <div class="layer-row-actions">
        <button class="btn btn-secondary btn-sm" onclick="openEditLayerModal('${esc(l.id)}')" title="Edit">Edit</button>
        ${!isFirst ? `<button class="btn btn-ghost btn-icon btn-sm" onclick="moveLayer('${esc(l.id)}',-1)" title="Move up">↑</button>` : '<div style="width:30px"></div>'}
        ${!isLast  ? `<button class="btn btn-ghost btn-icon btn-sm" onclick="moveLayer('${esc(l.id)}',1)"  title="Move down">↓</button>` : '<div style="width:30px"></div>'}
        ${l.archived
          ? `<button class="btn btn-ghost btn-sm" onclick="unarchiveLayer('${esc(l.id)}')">Restore</button>`
          : `<button class="btn btn-danger btn-sm" onclick="openDeleteLayerModal('${esc(l.id)}')">Delete</button>`
        }
      </div>
    </div>`;
  }).join('');

  wrap.innerHTML = `<div class="layer-list">${rows}</div>
    <p class="hint" style="margin-top:1rem">
      Layers are shared across all projects. Deleting a layer that has elements assigned requires archiving or migrating those elements first.
    </p>`;
}

// ── Add layer modal ───────────────────────────────────────────────────────────

function openAddLayerModal() {
  modal.open(
    'Add layer',
    `<div class="field">
      <label for="new-layer-name">Layer name</label>
      <input type="text" id="new-layer-name" placeholder="e.g. Rhythmic Texture" maxlength="60">
    </div>
    <div class="field">
      <label>Colour</label>
      <div style="display:flex;align-items:center;gap:0.75rem">
        <input type="color" id="new-layer-colour" value="#3b6fd4">
        <div>
          <div class="hint" style="margin-bottom:0.35rem">Or pick a preset:</div>
          <div class="colour-presets" id="add-colour-presets">
            ${COLOUR_PRESETS.map(c =>
              `<div class="colour-preset" style="background:${c}" data-colour="${c}" onclick="pickColour('new-layer-colour','add-colour-presets','${c}')" title="${c}"></div>`
            ).join('')}
          </div>
        </div>
      </div>
    </div>`,
    `<button class="btn btn-secondary" onclick="modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="submitAddLayer()">Add layer</button>`
  );
}

function pickColour(inputId, presetsId, colour) {
  document.getElementById(inputId).value = colour;
  document.querySelectorAll(`#${presetsId} .colour-preset`).forEach(el => {
    el.classList.toggle('selected', el.dataset.colour === colour);
  });
}

async function submitAddLayer() {
  const name   = document.getElementById('new-layer-name').value.trim();
  const colour = document.getElementById('new-layer-colour').value;
  if (!name) { toast.error('Layer name is required.'); return; }

  const { error } = await api.createLayer({ name, colour });
  if (error) { toast.error(error); return; }

  modal.close();
  toast.success(`Layer "${name}" added.`);
  await refreshLayers();
}

// ── Edit layer modal ──────────────────────────────────────────────────────────

function openEditLayerModal(id) {
  const layer = _layers.find(l => l.id === id);
  if (!layer) return;

  modal.open(
    'Edit layer',
    `<div class="field">
      <label for="edit-layer-name">Layer name</label>
      <input type="text" id="edit-layer-name" value="${esc(layer.name)}" maxlength="60">
    </div>
    <div class="field">
      <label>Colour</label>
      <div style="display:flex;align-items:center;gap:0.75rem">
        <input type="color" id="edit-layer-colour" value="${esc(layer.colour)}">
        <div>
          <div class="hint" style="margin-bottom:0.35rem">Or pick a preset:</div>
          <div class="colour-presets" id="edit-colour-presets">
            ${COLOUR_PRESETS.map(c =>
              `<div class="colour-preset${c === layer.colour ? ' selected' : ''}" style="background:${c}" data-colour="${c}"
                onclick="pickColour('edit-layer-colour','edit-colour-presets','${c}')" title="${c}"></div>`
            ).join('')}
          </div>
        </div>
      </div>
    </div>`,
    `<button class="btn btn-secondary" onclick="modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="submitEditLayer('${id}')">Save changes</button>`
  );
}

async function submitEditLayer(id) {
  const name   = document.getElementById('edit-layer-name').value.trim();
  const colour = document.getElementById('edit-layer-colour').value;
  if (!name) { toast.error('Layer name is required.'); return; }

  const { error } = await api.updateLayer(id, { name, colour });
  if (error) { toast.error(error); return; }

  modal.close();
  toast.success('Layer updated.');
  await refreshLayers();
}

// ── Move layer (reorder) ──────────────────────────────────────────────────────

async function moveLayer(id, direction) {
  const idx = _layers.findIndex(l => l.id === id);
  if (idx < 0) return;
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= _layers.length) return;

  // Swap ord values between the two layers
  const a = _layers[idx];
  const b = _layers[swapIdx];

  // Optimistic UI update first
  [_layers[idx], _layers[swapIdx]] = [b, a];
  renderLayerList();

  // Persist both ord changes
  const [r1, r2] = await Promise.all([
    api.updateLayer(a.id, { ord: b.ord }),
    api.updateLayer(b.id, { ord: a.ord }),
  ]);
  if (r1.error || r2.error) {
    toast.error('Could not save new order.');
    await refreshLayers(); // revert
  }
}

// ── Unarchive layer ───────────────────────────────────────────────────────────

async function unarchiveLayer(id) {
  const { error } = await api.updateLayer(id, { archived: false });
  if (error) { toast.error(error); return; }
  toast.success('Layer restored.');
  await refreshLayers();
}

// ── Delete layer modal ────────────────────────────────────────────────────────

async function openDeleteLayerModal(id) {
  const layer = _layers.find(l => l.id === id);
  if (!layer) return;

  // Attempt a dry-run delete to find out how many elements are affected
  const { error, data } = await api.delete(`/api/layers/${id}`);

  if (!error) {
    // Delete succeeded (no elements referenced it) — just confirm it happened
    toast.success(`Layer "${layer.name}" deleted.`);
    await refreshLayers();
    return;
  }

  // Elements are still using this layer — offer archive or migrate
  const count   = data && data.elementCount ? data.elementCount : '?';
  const others  = _layers.filter(l => l.id !== id && !l.archived);
  const opts    = others.map(l =>
    `<option value="${esc(l.id)}">${esc(l.name)}</option>`
  ).join('');

  modal.open(
    `Delete "${esc(layer.name)}"`,
    `<div class="alert alert-info" style="margin-bottom:1rem">
      This layer has <strong>${count} element${count !== 1 ? 's' : ''}</strong> assigned to it and cannot be deleted directly.
      Choose what to do:
    </div>

    <div class="field">
      <label><input type="radio" name="del-action" value="archive" checked onchange="toggleDeleteAction()"> Archive this layer</label>
      <p class="hint" style="margin-left:1.4rem;margin-top:0.2rem">Hides the layer from pickers but keeps all elements intact. You can restore it later.</p>
    </div>

    <div class="field">
      <label><input type="radio" name="del-action" value="migrate" onchange="toggleDeleteAction()"> Migrate elements to another layer, then delete</label>
      <div id="migrate-target-wrap" style="margin-top:0.5rem;margin-left:1.4rem;display:none">
        ${others.length
          ? `<select id="migrate-target">${opts}</select>`
          : `<p class="hint" style="color:var(--red)">No other layers available to migrate to. Add another layer first.</p>`
        }
      </div>
    </div>`,
    `<button class="btn btn-secondary" onclick="modal.close()">Cancel</button>
     <button class="btn btn-danger" onclick="submitDeleteLayer('${esc(id)}')">Confirm</button>`
  );
}

function toggleDeleteAction() {
  const action = document.querySelector('input[name="del-action"]:checked').value;
  const wrap   = document.getElementById('migrate-target-wrap');
  if (wrap) wrap.style.display = action === 'migrate' ? '' : 'none';
}

async function submitDeleteLayer(id) {
  const action = document.querySelector('input[name="del-action"]:checked').value;
  const layer  = _layers.find(l => l.id === id);

  if (action === 'archive') {
    const { error } = await api.updateLayer(id, { archived: true });
    if (error) { toast.error(error); return; }
    modal.close();
    toast.success(`"${layer.name}" archived.`);
  } else {
    const targetEl = document.getElementById('migrate-target');
    if (!targetEl) { toast.error('No target layer selected.'); return; }
    const targetId = targetEl.value;
    const target   = _layers.find(l => l.id === targetId);

    const { error } = await api.migrateLayer(id, targetId);
    if (error) { toast.error(error); return; }
    modal.close();
    toast.success(`Elements moved to "${target ? target.name : targetId}" and "${layer.name}" deleted.`);
  }

  await refreshLayers();
}

// ── PROJECTS VIEW (stub — Phase 3) ────────────────────────────────────────────

function viewProjects() {
  state.currentProject = null;
  updateTopnav();
  setApp(`<div class="page-header">
    <div class="page-header-left">
      <h1 class="page-title">Projects</h1>
      <p class="page-sub">Select a project to view its elements, or create a new one.</p>
    </div>
  </div>
  <div class="empty-state">
    <div class="empty-state-icon">◈</div>
    <p>Project view coming in Phase 3.</p>
    <p class="hint">The server and layer management are fully functional.</p>
  </div>`);
}

// ── ROUTER REGISTRATION ───────────────────────────────────────────────────────

router.register('/login',    viewLogin);
router.register('/layers',   viewLayers);
router.register('/projects', viewProjects);
// Phase 3 will add:
// router.register('/projects/:id', viewProject);
// router.register('/projects/:id/elements/new', viewNewElement);
// router.register('/elements/:id', viewElement);

// ── BOOTSTRAP ─────────────────────────────────────────────────────────────────

async function boot() {
  const { data, error } = await api.auth();

  if (error) {
    // Can't reach the server at all
    document.getElementById('root').innerHTML = `
      <div class="login-wrap">
        <div class="login-card" style="text-align:center">
          <h1 style="margin-bottom:0.75rem">Patch<span style="color:var(--accent)">Stash</span></h1>
          <div class="alert alert-error">Cannot reach the server. Is the container running?</div>
        </div>
      </div>
      <div id="toast-container"></div>`;
    return;
  }

  state.authEnabled   = data.authEnabled;
  state.authenticated = data.authenticated;

  if (state.authEnabled && !state.authenticated) {
    viewLogin();
    return;
  }

  // Authenticated (or auth disabled) — render the shell and route
  renderShell();

  const path = location.pathname === '/' ? '/projects' : location.pathname;
  router.init();
  if (location.pathname === '/') router.navigate('/projects', true);
}

document.addEventListener('DOMContentLoaded', boot);
