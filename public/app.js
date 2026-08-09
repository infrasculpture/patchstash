'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
//  Patch Stash — frontend single-page application
//
//  Architecture:
//    - api.*       thin fetch wrappers, always return { data } or { error }
//    - router.*    path-based client router with parameterised routes
//    - toast.*     non-blocking notification system
//    - modal.*     shared modal helpers
//    - views       one function per screen, writes to #app
//
//  Phase 2: Layer management
//  Phase 3: Project switcher, project view + filters, element create/detail
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
  get:    (path)       => api.request('GET',    path),
  post:   (path, body) => api.request('POST',   path, body),
  patch:  (path, body) => api.request('PATCH',  path, body),
  delete: (path)       => api.request('DELETE', path),
  upload: (path, form) => api.request('POST',   path, form, true),

  auth:    ()    => api.get('/api/auth'),
  login:   (pw)  => api.post('/api/login', { password: pw }),
  logout:  ()    => api.post('/api/logout'),

  layers:       ()            => api.get('/api/layers'),
  createLayer:  (body)        => api.post('/api/layers', body),
  updateLayer:  (id, body)    => api.patch(`/api/layers/${id}`, body),
  deleteLayer:  (id)          => api.delete(`/api/layers/${id}`),
  migrateLayer: (id, target)  => api.post(`/api/layers/${id}/migrate`, { targetLayerId: target }),

  projects:      (archived) => api.get(`/api/projects${archived ? '?archived=1' : ''}`),
  getProject:    (id)       => api.get(`/api/projects/${id}`),
  createProject: (body)     => api.post('/api/projects', body),
  updateProject: (id, body) => api.patch(`/api/projects/${id}`, body),
  deleteProject: (id)       => api.delete(`/api/projects/${id}`),

  elements:      (pid, q)   => api.get(`/api/projects/${pid}/elements${q ? '?' + q : ''}`),
  getElement:    (id)       => api.get(`/api/elements/${id}`),
  createElement: (pid, body)=> api.post(`/api/projects/${pid}/elements`, body),
  updateElement: (id, body) => api.patch(`/api/elements/${id}`, body),
  deleteElement: (id)       => api.delete(`/api/elements/${id}`),
  setStatus:     (id, body) => api.post(`/api/elements/${id}/status`, body),
  getLog:        (id)       => api.get(`/api/elements/${id}/log`),

  uploadFile:   (id, slot, form) => api.upload(`/api/elements/${id}/files/${slot}`, form),
  deleteFile:   (id, slot)       => api.delete(`/api/elements/${id}/files/${slot}`),
  fileUrl:      (id, slot)       => `/api/elements/${id}/files/${slot}`,

  exportCheck:    (ids)  => api.get(`/api/export/check?ids=${ids.join(',')}`),
  exportElements: (body) => api.post('/api/export', body),
};

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  authenticated:  false,
  authEnabled:    false,
  currentProject: null,   // full project object when inside a project
  layers:         [],     // cached layer list, refreshed on boot and after changes
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

  register(path, handler) { this.routes[path] = handler; },

  navigate(path, replace = false) {
    if (replace) history.replaceState(null, '', path);
    else         history.pushState(null, '', path);
    this.dispatch(path);
  },

  dispatch(path) {
    const [pathname, search] = path.split('?');
    const params = new URLSearchParams(search || '');

    if (this.routes[pathname]) return this.routes[pathname](params);

    for (const [pattern, handler] of Object.entries(this.routes)) {
      const regex = new RegExp('^' + pattern.replace(/:([^/]+)/g, '([^/]+)') + '$');
      const match = pathname.match(regex);
      if (match) {
        const keys        = [...pattern.matchAll(/:([^/]+)/g)].map(m => m[1]);
        const routeParams = Object.fromEntries(keys.map((k, i) => [k, match[i + 1]]));
        return handler(params, routeParams);
      }
    }

    router.navigate('/projects', true);
  },

  init() {
    window.addEventListener('popstate', () => this.dispatch(location.pathname));
    this.dispatch(location.pathname);
  },
};

// ── Shell ─────────────────────────────────────────────────────────────────────

function setApp(html) {
  document.getElementById('app').innerHTML = html;
}

function renderShell() {
  document.getElementById('root').innerHTML = `
    <div class="app-shell">
      <nav class="topnav" id="topnav">
        <div class="topnav-brand" onclick="router.navigate('/projects')" style="cursor:pointer">
          Patch<span>Stash</span>
        </div>
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
    ? `<strong>${esc(state.currentProject.name)}</strong>`
      + (state.currentProject.bpm ? ` · ${esc(state.currentProject.bpm)} BPM` : '')
      + (state.currentProject.key ? ` · ${esc(state.currentProject.key)}` : '')
    : '';

  actionsEl.innerHTML = `
    ${state.currentProject
      ? `<button class="btn btn-ghost btn-sm" onclick="router.navigate('/projects')">← Projects</button>`
      : ''}
    <button class="btn btn-ghost btn-sm" onclick="router.navigate('/layers')" title="Manage layers">⚙ Layers</button>
    ${state.authEnabled
      ? `<button class="btn btn-ghost btn-sm" onclick="doLogout()">Sign out</button>`
      : ''}
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

document.addEventListener('click', (e) => {
  if (e.target.id === 'modal-backdrop') modal.close();
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function layerById(id) {
  return state.layers.find(l => l.id === id) || null;
}

function layerBadgeHtml(layerId) {
  const l = layerById(layerId);
  if (!l) return layerId ? `<span class="layer-badge" style="background:#eee;color:#888">${esc(layerId)}</span>` : '';
  return `<span class="layer-badge" style="background:${l.colour}22;color:${l.colour};border:1px solid ${l.colour}55">${esc(l.name)}</span>`;
}

function statusBadgeHtml(status) {
  const labels = {
    'new':              'New',
    'under-assessment': 'Under Assessment',
    'selected':         'Selected',
    'imported':         'Imported',
    'rejected':         'Rejected',
  };
  return `<span class="badge badge-${esc(status)}">${labels[status] || esc(status)}</span>`;
}

function sourceTypeLabel(v) {
  const map = {
    'software-synth': 'Software Synth',
    'hardware-synth': 'Hardware Synth',
    'sample':         'Sample',
    'field-recording':'Field Recording',
    'plugin-chain':   'Plugin Chain',
    'daw-project':    'DAW Project',
    'other':          'Other',
  };
  return map[v] || v || '';
}

function processingLabel(v) {
  const map = {
    'raw':         'Raw',
    'processed':   'Processed',
    'print-ready': 'Print-ready',
    'stems':       'Stems',
  };
  return map[v] || v || '';
}

function energyLabel(v) {
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : '';
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const COLOUR_PRESETS = [
  '#ff2060','#c8ff00','#00deff','#ffaa00','#a855f7',
  '#3b6fd4','#e67e22','#27ae60','#e74c3c','#1abc9c',
  '#9b59b6','#f39c12','#2980b9','#d35400','#7f8c8d',
];

const SOURCE_TYPES = [
  { value: 'software-synth',  label: 'Software Synth' },
  { value: 'hardware-synth',  label: 'Hardware Synth' },
  { value: 'sample',          label: 'Sample' },
  { value: 'field-recording', label: 'Field Recording' },
  { value: 'plugin-chain',    label: 'Plugin Chain' },
  { value: 'daw-project',     label: 'DAW Project' },
  { value: 'other',           label: 'Other' },
];

const PROCESSING_STATES = [
  { value: 'raw',         label: 'Raw — dry, minimal processing' },
  { value: 'processed',   label: 'Processed — treated but not finalised' },
  { value: 'print-ready', label: 'Print-ready — can drop straight in' },
  { value: 'stems',       label: 'Stems — multiple layered components' },
];

const ENERGY_LEVELS = [
  { value: 'low',  label: 'Low' },
  { value: 'mid',  label: 'Mid' },
  { value: 'high', label: 'High' },
];

const VALID_STATUSES = [
  { value: 'new',              label: 'New' },
  { value: 'under-assessment', label: 'Under Assessment' },
  { value: 'selected',         label: 'Selected' },
  { value: 'imported',         label: 'Imported' },
  { value: 'rejected',         label: 'Rejected' },
];

// ── Auth ──────────────────────────────────────────────────────────────────────

async function doLogout() {
  await api.logout();
  state.authenticated = false;
  viewLogin();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOGIN VIEW
// ═══════════════════════════════════════════════════════════════════════════════

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
        <button class="btn btn-primary" style="width:100%" onclick="submitLogin()">Sign in</button>
      </div>
    </div>
    <div id="toast-container"></div>
  `;
  const pw = document.getElementById('login-pw');
  pw.addEventListener('keydown', e => { if (e.key === 'Enter') submitLogin(); });
  requestAnimationFrame(() => pw.focus());
}

async function submitLogin() {
  const pw      = document.getElementById('login-pw').value;
  const alertEl = document.getElementById('login-alert');
  alertEl.innerHTML = '';

  const { error } = await api.login(pw);
  if (error) {
    alertEl.innerHTML = `<div class="alert alert-error" style="margin-bottom:1rem">${esc(error)}</div>`;
    document.getElementById('login-pw').select();
    return;
  }

  state.authenticated = true;
  renderShell();
  await loadLayers();
  router.navigate('/projects', true);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LAYER MANAGEMENT VIEW  (Phase 2 — unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

let _layers = [];

async function loadLayers() {
  const { data } = await api.layers();
  if (data) { _layers = data; state.layers = data; }
}

async function viewLayers() {
  updateTopnav();
  setApp(`
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Layer Management</h1>
        <p class="page-sub">Customise the classification taxonomy used across all projects.</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" onclick="openAddLayerModal()">+ Add layer</button>
      </div>
    </div>
    <div id="layer-list-wrap"><p class="muted">Loading…</p></div>
  `);
  await refreshLayers();
}

async function refreshLayers() {
  const { data, error } = await api.layers();
  if (error) { toast.error(error); return; }
  _layers = data;
  state.layers = data;
  renderLayerList();
}

function renderLayerList() {
  const wrap = document.getElementById('layer-list-wrap');
  if (!wrap) return;

  if (!_layers.length) {
    wrap.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">◈</div>
      <p>No layers yet.</p>
    </div>`;
    return;
  }

  const rows = _layers.map((l, idx) => `
    <div class="layer-row${l.archived ? ' archived' : ''}">
      <div class="drag-handle">⠿</div>
      <div class="layer-colour-swatch" style="background:${esc(l.colour)}"></div>
      <div class="layer-name">${esc(l.name)}</div>
      ${l.archived ? `<span class="layer-archived-tag">archived</span>` : ''}
      <div class="layer-row-actions">
        <button class="btn btn-secondary btn-sm" onclick="openEditLayerModal('${esc(l.id)}')">Edit</button>
        ${idx > 0
          ? `<button class="btn btn-ghost btn-icon btn-sm" onclick="moveLayer('${esc(l.id)}',-1)">↑</button>`
          : '<div style="width:30px"></div>'}
        ${idx < _layers.length - 1
          ? `<button class="btn btn-ghost btn-icon btn-sm" onclick="moveLayer('${esc(l.id)}',1)">↓</button>`
          : '<div style="width:30px"></div>'}
        ${l.archived
          ? `<button class="btn btn-ghost btn-sm" onclick="unarchiveLayer('${esc(l.id)}')">Restore</button>`
          : `<button class="btn btn-danger btn-sm" onclick="openDeleteLayerModal('${esc(l.id)}')">Delete</button>`}
      </div>
    </div>`).join('');

  wrap.innerHTML = `<div class="layer-list">${rows}</div>
    <p class="hint" style="margin-top:1rem">
      Layers are shared across all projects. Deleting a layer that has elements requires archiving or migrating first.
    </p>`;
}

function openAddLayerModal() {
  modal.open('Add layer',
    `<div class="field">
      <label for="new-layer-name">Layer name</label>
      <input type="text" id="new-layer-name" placeholder="e.g. Rhythmic Texture" maxlength="60">
    </div>
    <div class="field">
      <label>Colour</label>
      <div style="display:flex;align-items:center;gap:0.75rem">
        <input type="color" id="new-layer-colour" value="#3b6fd4">
        <div>
          <div class="hint" style="margin-bottom:0.35rem">Presets:</div>
          <div class="colour-presets" id="add-colour-presets">
            ${COLOUR_PRESETS.map(c =>
              `<div class="colour-preset" style="background:${c}" data-colour="${c}"
                onclick="pickColour('new-layer-colour','add-colour-presets','${c}')"></div>`
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

function openEditLayerModal(id) {
  const layer = _layers.find(l => l.id === id);
  if (!layer) return;
  modal.open('Edit layer',
    `<div class="field">
      <label for="edit-layer-name">Layer name</label>
      <input type="text" id="edit-layer-name" value="${esc(layer.name)}" maxlength="60">
    </div>
    <div class="field">
      <label>Colour</label>
      <div style="display:flex;align-items:center;gap:0.75rem">
        <input type="color" id="edit-layer-colour" value="${esc(layer.colour)}">
        <div>
          <div class="hint" style="margin-bottom:0.35rem">Presets:</div>
          <div class="colour-presets" id="edit-colour-presets">
            ${COLOUR_PRESETS.map(c =>
              `<div class="colour-preset${c === layer.colour ? ' selected' : ''}" style="background:${c}" data-colour="${c}"
                onclick="pickColour('edit-layer-colour','edit-colour-presets','${c}')"></div>`
            ).join('')}
          </div>
        </div>
      </div>
    </div>`,
    `<button class="btn btn-secondary" onclick="modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="submitEditLayer('${esc(id)}')">Save changes</button>`
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

async function moveLayer(id, direction) {
  const idx     = _layers.findIndex(l => l.id === id);
  if (idx < 0) return;
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= _layers.length) return;
  const a = _layers[idx], b = _layers[swapIdx];
  [_layers[idx], _layers[swapIdx]] = [b, a];
  renderLayerList();
  const [r1, r2] = await Promise.all([
    api.updateLayer(a.id, { ord: b.ord }),
    api.updateLayer(b.id, { ord: a.ord }),
  ]);
  if (r1.error || r2.error) { toast.error('Could not save new order.'); await refreshLayers(); }
}

async function unarchiveLayer(id) {
  const { error } = await api.updateLayer(id, { archived: false });
  if (error) { toast.error(error); return; }
  toast.success('Layer restored.');
  await refreshLayers();
}

async function openDeleteLayerModal(id) {
  const layer = _layers.find(l => l.id === id);
  if (!layer) return;
  const { error, data } = await api.delete(`/api/layers/${id}`);
  if (!error) { toast.success(`Layer "${layer.name}" deleted.`); await refreshLayers(); return; }

  const count  = data && data.elementCount ? data.elementCount : '?';
  const others = _layers.filter(l => l.id !== id && !l.archived);
  const opts   = others.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');

  modal.open(`Delete "${esc(layer.name)}"`,
    `<div class="alert alert-info" style="margin-bottom:1rem">
      This layer has <strong>${count} element${count !== 1 ? 's' : ''}</strong> assigned. Choose what to do:
    </div>
    <div class="field">
      <label><input type="radio" name="del-action" value="archive" checked onchange="toggleDeleteAction()">
        Archive this layer</label>
      <p class="hint" style="margin-left:1.4rem;margin-top:0.2rem">Hides from pickers but keeps elements intact.</p>
    </div>
    <div class="field">
      <label><input type="radio" name="del-action" value="migrate" onchange="toggleDeleteAction()">
        Migrate elements to another layer, then delete</label>
      <div id="migrate-target-wrap" style="margin-top:0.5rem;margin-left:1.4rem;display:none">
        ${others.length
          ? `<select id="migrate-target">${opts}</select>`
          : `<p class="hint" style="color:var(--red)">No other layers available. Add one first.</p>`}
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

// ═══════════════════════════════════════════════════════════════════════════════
//  PROJECT SWITCHER VIEW
// ═══════════════════════════════════════════════════════════════════════════════

async function viewProjects() {
  state.currentProject = null;
  updateTopnav();
  setApp(`<div class="page-header">
    <div class="page-header-left">
      <h1 class="page-title">Projects</h1>
      <p class="page-sub">Select a project to view its elements, or create a new one.</p>
    </div>
    <div class="page-header-actions">
      <button class="btn btn-primary" onclick="openCreateProjectModal()">+ New project</button>
    </div>
  </div>
  <div id="projects-list"><p class="muted">Loading…</p></div>`);

  await renderProjectsList(false);
}

async function renderProjectsList(includeArchived) {
  const { data, error } = await api.projects(includeArchived);
  if (error) { toast.error(error); return; }

  const listEl = document.getElementById('projects-list');
  if (!listEl) return;

  const active   = data.filter(p => !p.archived);
  const archived = data.filter(p => p.archived);

  if (!active.length && !archived.length) {
    listEl.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">◈</div>
      <p>No projects yet.</p>
      <p class="hint">Create your first project to start stashing elements.</p>
    </div>`;
    return;
  }

  const projectCard = p => `
    <div class="project-card" onclick="router.navigate('/projects/${p.id}')">
      <div class="project-card-name">${esc(p.name)}</div>
      <div class="project-card-meta">
        ${p.bpm ? `<span>${esc(p.bpm)} BPM</span>` : ''}
        ${p.key ? `<span>${esc(p.key)}</span>` : ''}
        ${(p.flavours || []).map(f => `<span class="project-flavour-tag">${esc(f)}</span>`).join('')}
      </div>
      ${p.description ? `<div class="project-card-desc">${esc(p.description)}</div>` : ''}
      <div class="project-card-footer">
        <span class="hint">${fmtDate(p.createdAt)}</span>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEditProjectModal('${p.id}')">Edit</button>
      </div>
    </div>`;

  let html = `<div class="projects-grid">${active.map(projectCard).join('')}</div>`;

  if (archived.length) {
    html += `<div style="margin-top:1.5rem">
      <button class="btn btn-ghost btn-sm" onclick="renderProjectsList(true)" style="margin-bottom:0.75rem">
        Show ${archived.length} archived project${archived.length !== 1 ? 's' : ''}
      </button>`;
    if (includeArchived) {
      html += `<div class="projects-grid">${archived.map(projectCard).join('')}</div>`;
    }
    html += `</div>`;
  }

  listEl.innerHTML = html;
}

function openCreateProjectModal() {
  modal.open('New project',
    `<div class="field">
      <label for="proj-name">Project name *</label>
      <input type="text" id="proj-name" placeholder="e.g. Carbon Swirl collab" maxlength="120">
    </div>
    <div class="field-row">
      <div class="field">
        <label for="proj-bpm">BPM (default)</label>
        <input type="number" id="proj-bpm" placeholder="e.g. 138" min="60" max="250">
      </div>
      <div class="field">
        <label for="proj-key">Key (default)</label>
        <input type="text" id="proj-key" placeholder="e.g. C Minor" maxlength="30">
      </div>
    </div>
    <div class="field">
      <label for="proj-flavours">Genre / style tags (comma-separated)</label>
      <input type="text" id="proj-flavours" placeholder="e.g. Psy-Techno, Dark, Forest">
    </div>
    <div class="field">
      <label for="proj-desc">Description</label>
      <textarea id="proj-desc" rows="2" placeholder="What is this project for?"></textarea>
    </div>`,
    `<button class="btn btn-secondary" onclick="modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="submitCreateProject()">Create project</button>`
  );
}

async function submitCreateProject() {
  const name = document.getElementById('proj-name').value.trim();
  if (!name) { toast.error('Project name is required.'); return; }

  const flavours = document.getElementById('proj-flavours').value
    .split(',').map(s => s.trim()).filter(Boolean);

  const { data, error } = await api.createProject({
    name,
    bpm:         document.getElementById('proj-bpm').value.trim(),
    key:         document.getElementById('proj-key').value.trim(),
    description: document.getElementById('proj-desc').value.trim(),
    flavours,
  });
  if (error) { toast.error(error); return; }

  modal.close();
  router.navigate(`/projects/${data.id}`);
}

async function openEditProjectModal(id) {
  const { data, error } = await api.getProject(id);
  if (error) { toast.error(error); return; }
  const p = data;

  modal.open('Edit project',
    `<div class="field">
      <label for="eproj-name">Project name *</label>
      <input type="text" id="eproj-name" value="${esc(p.name)}" maxlength="120">
    </div>
    <div class="field-row">
      <div class="field">
        <label for="eproj-bpm">BPM (default)</label>
        <input type="number" id="eproj-bpm" value="${esc(p.bpm)}" min="60" max="250">
      </div>
      <div class="field">
        <label for="eproj-key">Key (default)</label>
        <input type="text" id="eproj-key" value="${esc(p.key)}" maxlength="30">
      </div>
    </div>
    <div class="field">
      <label for="eproj-flavours">Genre / style tags (comma-separated)</label>
      <input type="text" id="eproj-flavours" value="${esc((p.flavours || []).join(', '))}">
    </div>
    <div class="field">
      <label for="eproj-desc">Description</label>
      <textarea id="eproj-desc" rows="2">${esc(p.description)}</textarea>
    </div>
    <div class="divider"></div>
    <div class="field">
      <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
        <input type="checkbox" id="eproj-archived" ${p.archived ? 'checked' : ''}>
        Archive this project
      </label>
      <p class="hint" style="margin-top:0.25rem">Archived projects are hidden from the main list.</p>
    </div>`,
    `<button class="btn btn-danger btn-sm" style="margin-right:auto" onclick="confirmDeleteProject('${esc(id)}')">Delete project</button>
     <button class="btn btn-secondary" onclick="modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="submitEditProject('${esc(id)}')">Save</button>`
  );
}

async function submitEditProject(id) {
  const name = document.getElementById('eproj-name').value.trim();
  if (!name) { toast.error('Project name is required.'); return; }

  const flavours = document.getElementById('eproj-flavours').value
    .split(',').map(s => s.trim()).filter(Boolean);

  const { error } = await api.updateProject(id, {
    name,
    bpm:         document.getElementById('eproj-bpm').value.trim(),
    key:         document.getElementById('eproj-key').value.trim(),
    description: document.getElementById('eproj-desc').value.trim(),
    flavours,
    archived:    document.getElementById('eproj-archived').checked,
  });
  if (error) { toast.error(error); return; }

  modal.close();
  toast.success('Project updated.');

  // If we're inside the project view, refresh project state; otherwise refresh list
  if (state.currentProject && state.currentProject.id === id) {
    const { data } = await api.getProject(id);
    if (data) { state.currentProject = data; updateTopnav(); }
  } else {
    await renderProjectsList(false);
  }
}

async function confirmDeleteProject(id) {
  if (!confirm('Delete this project and all its elements? This cannot be undone.\n\nFiles on disk are not removed — only the database records.')) return;
  const { error } = await api.deleteProject(id);
  if (error) { toast.error(error); return; }
  modal.close();
  toast.success('Project deleted.');
  router.navigate('/projects', true);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PROJECT VIEW  (element list + filters)
// ═══════════════════════════════════════════════════════════════════════════════

// Active filter state for the current project view
const filters = { status: '', layerId: '', sourceType: '', processingState: '', energyLevel: '' };

async function viewProject(queryParams, routeParams) {
  const { id } = routeParams;

  // Load project
  const { data: project, error } = await api.getProject(id);
  if (error) { toast.error('Project not found.'); router.navigate('/projects', true); return; }

  state.currentProject = project;
  updateTopnav();

  // Reset filters when entering a project
  Object.keys(filters).forEach(k => filters[k] = '');

  setApp(`
    <div class="project-view-header">
      <div class="project-view-title-row">
        <div>
          <h1 class="page-title">${esc(project.name)}</h1>
          <div class="project-view-meta">
            ${project.bpm ? `<span>${esc(project.bpm)} BPM</span>` : ''}
            ${project.key ? `<span>${esc(project.key)}</span>` : ''}
            ${(project.flavours || []).map(f => `<span class="project-flavour-tag">${esc(f)}</span>`).join('')}
          </div>
          ${project.description ? `<p class="project-view-desc">${esc(project.description)}</p>` : ''}
        </div>
        <div class="page-header-actions">
          <button class="btn btn-ghost btn-sm" onclick="openEditProjectModal('${esc(id)}')">Edit project</button>
          <button class="btn btn-secondary btn-sm" onclick="router.navigate('/projects/${esc(id)}/export')">↓ Export to Palette Arsenal</button>
          <button class="btn btn-primary" onclick="router.navigate('/projects/${esc(id)}/elements/new')">+ Add element</button>
        </div>
      </div>
    </div>

    <div class="filter-bar" id="filter-bar"></div>

    <div id="elements-area"><p class="muted" style="padding:1rem 0">Loading…</p></div>
  `);

  await renderFilterBar(id);
  await renderElements(id);
}

async function renderFilterBar(projectId) {
  const barEl = document.getElementById('filter-bar');
  if (!barEl) return;

  const activeLayers = state.layers.filter(l => !l.archived);

  const filterBtn = (group, value, label) => {
    const active = filters[group] === value;
    return `<button class="filter-chip${active ? ' active' : ''}"
      onclick="setFilter('${group}','${esc(value)}','${esc(projectId)}')">${esc(label)}</button>`;
  };

  barEl.innerHTML = `
    <div class="filter-group">
      <span class="filter-group-label">Status</span>
      ${filterBtn('status', '', 'All')}
      ${VALID_STATUSES.map(s => filterBtn('status', s.value, s.label)).join('')}
    </div>
    ${activeLayers.length ? `
    <div class="filter-group">
      <span class="filter-group-label">Layer</span>
      ${filterBtn('layerId', '', 'All')}
      ${activeLayers.map(l => filterBtn('layerId', l.id, l.name)).join('')}
    </div>` : ''}
    <div class="filter-group">
      <span class="filter-group-label">Source</span>
      ${filterBtn('sourceType', '', 'All')}
      ${SOURCE_TYPES.map(s => filterBtn('sourceType', s.value, s.label)).join('')}
    </div>
    <div class="filter-group">
      <span class="filter-group-label">State</span>
      ${filterBtn('processingState', '', 'All')}
      ${PROCESSING_STATES.map(s => filterBtn('processingState', s.value, s.label.split(' — ')[0])).join('')}
    </div>
    <div class="filter-group">
      <span class="filter-group-label">Energy</span>
      ${filterBtn('energyLevel', '', 'All')}
      ${ENERGY_LEVELS.map(s => filterBtn('energyLevel', s.value, s.label)).join('')}
    </div>
  `;
}

async function setFilter(group, value, projectId) {
  filters[group] = value;
  await renderFilterBar(projectId);
  await renderElements(projectId);
}

async function renderElements(projectId) {
  const area = document.getElementById('elements-area');
  if (!area) return;

  const q = new URLSearchParams();
  if (filters.status)          q.set('status',          filters.status);
  if (filters.layerId)         q.set('layerId',          filters.layerId);
  if (filters.sourceType)      q.set('sourceType',       filters.sourceType);
  if (filters.processingState) q.set('processingState',  filters.processingState);
  if (filters.energyLevel)     q.set('energyLevel',      filters.energyLevel);

  const { data, error } = await api.elements(projectId, q.toString());
  if (error) { area.innerHTML = `<div class="alert alert-error">${esc(error)}</div>`; return; }

  if (!data.length) {
    const hasFilters = Object.values(filters).some(Boolean);
    area.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">◈</div>
      <p>${hasFilters ? 'No elements match these filters.' : 'No elements yet.'}</p>
      ${!hasFilters ? `<p class="hint">Hit <strong>+ Add element</strong> to stash your first sound.</p>` : ''}
    </div>`;
    return;
  }

  area.innerHTML = `
    <div class="elements-header">
      <span class="hint">${data.length} element${data.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="element-list">
      ${data.map(elementCardHtml).join('')}
    </div>
  `;
}

function elementCardHtml(el) {
  const hasAudio   = !!el.audioFile;
  const hasFile    = !!el.primaryFile;
  const layer      = layerById(el.layerId);

  return `
    <div class="element-card" onclick="router.navigate('/elements/${esc(el.id)}')">
      <div class="element-card-top">
        <div class="element-card-title">${esc(el.title)}</div>
        <div class="element-card-badges">
          ${statusBadgeHtml(el.status)}
          ${layerBadgeHtml(el.layerId)}
        </div>
      </div>
      ${el.description ? `<div class="element-card-desc">${esc(el.description)}</div>` : ''}
      <div class="element-card-meta">
        ${el.sourceType      ? `<span class="meta-tag">${esc(sourceTypeLabel(el.sourceType))}</span>` : ''}
        ${el.processingState ? `<span class="meta-tag">${esc(processingLabel(el.processingState))}</span>` : ''}
        ${el.energyLevel     ? `<span class="meta-tag">${esc(energyLabel(el.energyLevel))}</span>` : ''}
        ${el.bpm  || el.key  ? `<span class="meta-tag mono">${[el.bpm ? el.bpm + ' BPM' : '', el.key].filter(Boolean).join(' · ')}</span>` : ''}
      </div>
      <div class="element-card-footer">
        <div class="element-card-files">
          <span class="file-indicator${hasAudio ? ' has-file' : ''}" title="${hasAudio ? 'Audio preview attached' : 'No audio preview'}">♪</span>
          <span class="file-indicator${hasFile  ? ' has-file' : ''}" title="${hasFile  ? 'File attached' : 'No file attached'}">⊙</span>
          ${!hasAudio ? `<span class="hint" style="font-size:0.75rem">no audio preview</span>` : ''}
        </div>
        <span class="hint" style="font-size:0.75rem">${el.submittedBy ? esc(el.submittedBy) + ' · ' : ''}${fmtDate(el.createdAt)}</span>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ELEMENT CREATE VIEW
// ═══════════════════════════════════════════════════════════════════════════════

async function viewNewElement(queryParams, routeParams) {
  const { id: projectId } = routeParams;

  const { data: project, error } = await api.getProject(projectId);
  if (error) { toast.error('Project not found.'); router.navigate('/projects', true); return; }

  state.currentProject = project;
  updateTopnav();

  const activeLayers = state.layers.filter(l => !l.archived);

  setApp(`
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Add element</h1>
        <p class="page-sub">to <strong>${esc(project.name)}</strong></p>
      </div>
    </div>

    <div class="element-form card">
      <div class="card-body">
        <h3 style="margin-bottom:1rem">Element details</h3>

        <div class="field">
          <label for="el-title">Title *</label>
          <input type="text" id="el-title" placeholder="Give this element a name" maxlength="200">
        </div>
        <div class="field">
          <label for="el-desc">Description</label>
          <textarea id="el-desc" rows="3" placeholder="What is this? What's it chasing? What makes it interesting?"></textarea>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="el-layer">Layer *</label>
            <select id="el-layer">
              <option value="">— select layer —</option>
              ${activeLayers.map(l =>
                `<option value="${esc(l.id)}">${esc(l.name)}</option>`
              ).join('')}
            </select>
          </div>
          <div class="field">
            <label for="el-source">Source type</label>
            <select id="el-source">
              <option value="">— select —</option>
              ${SOURCE_TYPES.map(s => `<option value="${esc(s.value)}">${esc(s.label)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="el-processing">Processing state</label>
            <select id="el-processing">
              <option value="">— select —</option>
              ${PROCESSING_STATES.map(s => `<option value="${esc(s.value)}">${esc(s.label)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="el-energy">Energy level</label>
            <select id="el-energy">
              <option value="">— select —</option>
              ${ENERGY_LEVELS.map(s => `<option value="${esc(s.value)}">${esc(s.label)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="el-bpm">BPM</label>
            <input type="number" id="el-bpm" placeholder="${esc(project.bpm || 'inherited from project')}" min="60" max="250">
          </div>
          <div class="field">
            <label for="el-key">Key</label>
            <input type="text" id="el-key" placeholder="${esc(project.key || 'inherited from project')}" maxlength="30">
          </div>
        </div>
      </div>

      <div class="card-body">
        <h3 style="margin-bottom:0.25rem">Synth / plugin details</h3>
        <p class="hint" style="margin-bottom:1rem">Optional — fills in cleanly when exported to Palette Arsenal.</p>

        <div class="field-row">
          <div class="field">
            <label for="el-synth">Synth / plugin</label>
            <input type="text" id="el-synth" placeholder="e.g. Vital, Serum">
          </div>
          <div class="field">
            <label for="el-patch">Patch name</label>
            <input type="text" id="el-patch" placeholder="e.g. Dark Sub Roller">
          </div>
        </div>
        <div class="field">
          <label for="el-bank">Soundbank / directory</label>
          <input type="text" id="el-bank" placeholder="e.g. Factory / Bass">
        </div>
        <div class="field">
          <label for="el-tech">Technique notes</label>
          <textarea id="el-tech" rows="2" placeholder="Key settings, modulation, signal chain…"></textarea>
        </div>
      </div>

      <div class="card-body">
        <h3 style="margin-bottom:0.25rem">Attribution</h3>
        <div class="field">
          <label for="el-author">Submitted by</label>
          <input type="text" id="el-author" placeholder="Your name" maxlength="80">
          <p class="field-hint">Pre-filled from your browser. Not a login — just a label.</p>
        </div>
      </div>

      <div class="card-body">
        <div style="display:flex;gap:0.75rem;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn btn-secondary" onclick="router.navigate('/projects/${esc(projectId)}')">Cancel</button>
          <button class="btn btn-primary" onclick="submitNewElement('${esc(projectId)}')">Save element</button>
        </div>
      </div>
    </div>
  `);

  // Pre-fill author from localStorage
  const savedAuthor = localStorage.getItem('ps_author') || '';
  document.getElementById('el-author').value = savedAuthor;
}

async function submitNewElement(projectId) {
  const title = document.getElementById('el-title').value.trim();
  if (!title) { toast.error('Title is required.'); document.getElementById('el-title').focus(); return; }

  const author = document.getElementById('el-author').value.trim();
  if (author) localStorage.setItem('ps_author', author);

  const { data, error } = await api.createElement(projectId, {
    title,
    description:     document.getElementById('el-desc').value.trim(),
    layerId:         document.getElementById('el-layer').value,
    sourceType:      document.getElementById('el-source').value,
    processingState: document.getElementById('el-processing').value,
    energyLevel:     document.getElementById('el-energy').value,
    bpm:             document.getElementById('el-bpm').value.trim(),
    key:             document.getElementById('el-key').value.trim(),
    synth:           document.getElementById('el-synth').value.trim(),
    patch:           document.getElementById('el-patch').value.trim(),
    bank:            document.getElementById('el-bank').value.trim(),
    tech:            document.getElementById('el-tech').value.trim(),
    submittedBy:     author,
  });

  if (error) { toast.error(error); return; }
  toast.success('Element saved.');
  router.navigate(`/elements/${data.id}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ELEMENT DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════════════════

async function viewElement(queryParams, routeParams) {
  const { id } = routeParams;

  const [elRes, logRes] = await Promise.all([api.getElement(id), api.getLog(id)]);
  if (elRes.error) { toast.error('Element not found.'); history.back(); return; }

  const el  = elRes.data;
  const log = logRes.data || [];

  // Ensure topnav has project context
  if (!state.currentProject || state.currentProject.id !== el.projectId) {
    const { data: project } = await api.getProject(el.projectId);
    if (project) state.currentProject = project;
  }
  updateTopnav();

  const layer  = layerById(el.layerId);
  const author = localStorage.getItem('ps_author') || '';

  setApp(`
    <div class="page-header">
      <div class="page-header-left">
        <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.4rem">
          <h1 class="page-title" style="margin-bottom:0">${esc(el.title)}</h1>
          ${statusBadgeHtml(el.status)}
          ${layerBadgeHtml(el.layerId)}
        </div>
        <div class="element-detail-meta">
          ${el.sourceType      ? `<span>${esc(sourceTypeLabel(el.sourceType))}</span>` : ''}
          ${el.processingState ? `<span>${esc(processingLabel(el.processingState))}</span>` : ''}
          ${el.energyLevel     ? `<span>${esc(energyLabel(el.energyLevel))} energy</span>` : ''}
          ${el.bpm || el.key   ? `<span class="mono">${[el.bpm ? el.bpm + ' BPM' : '', el.key].filter(Boolean).join(' · ')}</span>` : ''}
          <span class="muted">${el.submittedBy ? esc(el.submittedBy) + ' · ' : ''}${fmtDate(el.createdAt)}</span>
        </div>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-ghost btn-sm" onclick="router.navigate('/projects/${esc(el.projectId)}')">← Back</button>
        <button class="btn btn-secondary btn-sm" onclick="openEditElementModal('${esc(id)}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="confirmDeleteElement('${esc(id)}','${esc(el.projectId)}')">Delete</button>
      </div>
    </div>

    <div class="element-detail-grid">

      <!-- Left column: description + synth details + files -->
      <div class="element-detail-left">

        ${el.description ? `
        <div class="card" style="margin-bottom:1rem">
          <div class="card-body">
            <div class="label" style="margin-bottom:0.4rem">Description</div>
            <p style="line-height:1.7">${esc(el.description)}</p>
          </div>
        </div>` : ''}

        ${(el.synth || el.patch || el.bank || el.tech) ? `
        <div class="card" style="margin-bottom:1rem">
          <div class="card-body">
            <div class="label" style="margin-bottom:0.75rem">Synth / Plugin</div>
            <div class="detail-fields">
              ${el.synth ? `<div class="detail-field"><span class="detail-field-label">Plugin</span><span class="detail-field-value mono">${esc(el.synth)}</span></div>` : ''}
              ${el.patch ? `<div class="detail-field"><span class="detail-field-label">Patch</span><span class="detail-field-value mono">${esc(el.patch)}</span></div>` : ''}
              ${el.bank  ? `<div class="detail-field"><span class="detail-field-label">Bank</span><span class="detail-field-value mono">${esc(el.bank)}</span></div>` : ''}
            </div>
            ${el.tech ? `<div style="margin-top:0.75rem"><div class="label" style="margin-bottom:0.35rem">Technique notes</div><p style="font-size:0.875rem;line-height:1.7;color:var(--t2)">${esc(el.tech)}</p></div>` : ''}
          </div>
        </div>` : ''}

        <!-- Audio file -->
        <div class="card" style="margin-bottom:1rem">
          <div class="card-body">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
              <div class="label">Audio preview</div>
              ${el.audioFile
                ? `<button class="btn btn-danger btn-sm" onclick="deleteFileSlot('${esc(id)}','audio')">Remove</button>`
                : ''}
            </div>
            ${el.audioFile
              ? `<audio controls style="width:100%;margin-bottom:0.5rem"
                   src="${api.fileUrl(id,'audio')}"
                   preload="metadata">
                   Your browser does not support the audio element.
                 </audio>
                 <div class="file-info mono">${esc(el.audioFile.filename.replace(/^audio_/,''))} · ${fmtSize(el.audioFile.sizeBytes)}
                   <a href="${api.fileUrl(id,'audio')}" download style="margin-left:0.75rem;font-size:0.78rem">↓ Download</a>
                 </div>`
              : `<div class="file-upload-area" id="audio-upload-area">
                   <p class="hint" style="margin-bottom:0.75rem">No audio preview attached yet. Adding one lets collaborators assess the element without opening a DAW.</p>
                   <label class="btn btn-secondary btn-sm" style="cursor:pointer">
                     ♪ Upload audio preview
                     <input type="file" accept="audio/*,.wav,.mp3,.aif,.aiff,.flac,.ogg,.m4a" style="display:none" onchange="uploadFile('${esc(id)}','audio',this)">
                   </label>
                 </div>`}
          </div>
        </div>

        <!-- Primary file -->
        <div class="card" style="margin-bottom:1rem">
          <div class="card-body">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
              <div class="label">Primary file</div>
              ${el.primaryFile
                ? `<button class="btn btn-danger btn-sm" onclick="deleteFileSlot('${esc(id)}','primary')">Remove</button>`
                : ''}
            </div>
            ${el.primaryFile
              ? `<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
                   <a class="btn btn-primary btn-sm" href="${api.fileUrl(id,'primary')}" download>↓ Download</a>
                   <span class="file-info mono">
                     ${esc(el.primaryFile.filename.replace(/^primary_/,''))}
                     · ${fmtSize(el.primaryFile.sizeBytes)}
                     ${el.primaryFile.type && el.primaryFile.type !== 'other' ? `· <span style="color:var(--t3)">${esc(el.primaryFile.type)}</span>` : ''}
                   </span>
                 </div>
                 <p class="hint" style="margin-top:0.6rem">Uploaded ${fmtDate(el.primaryFile.uploadedAt)}</p>`
              : `<div class="file-upload-area" id="primary-upload-area">
                   <p class="hint" style="margin-bottom:0.4rem">No file attached yet.</p>
                   <p class="hint" style="margin-bottom:0.85rem;font-size:0.78rem">
                     Attaching multiple files? <strong>Zip them first</strong> and upload the archive.
                   </p>
                   <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
                     <select id="primary-type-select" style="font-size:0.82rem;padding:0.4rem 0.6rem;width:auto;border:1px solid var(--border2);border-radius:4px;background:var(--surface);color:var(--t1)">
                       <option value="synth-patch">Synth patch</option>
                       <option value="fx-chain">FX chain</option>
                       <option value="daw-project">DAW project</option>
                       <option value="archive">Archive (.zip / .7z)</option>
                       <option value="other">Other</option>
                     </select>
                     <label class="btn btn-secondary btn-sm" style="cursor:pointer">
                       ⊙ Upload file
                       <input type="file" style="display:none" onchange="uploadFile('${esc(id)}','primary',this)">
                     </label>
                   </div>
                 </div>`}
          </div>
        </div>

      </div>

      <!-- Right column: status + log -->
      <div class="element-detail-right">

        <!-- Status control -->
        <div class="card" style="margin-bottom:1rem">
          <div class="card-body">
            <div class="label" style="margin-bottom:0.75rem">Status</div>
            <div class="status-buttons" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:1rem">
              ${VALID_STATUSES.map(s => `
                <button class="btn btn-sm ${el.status === s.value ? 'btn-primary' : 'btn-secondary'}"
                  onclick="openStatusModal('${esc(id)}','${esc(s.value)}','${esc(el.status)}')"
                  ${el.status === s.value ? 'disabled' : ''}>
                  ${esc(s.label)}
                </button>`).join('')}
            </div>
            <div class="divider"></div>
            <div class="label" style="margin:0.75rem 0 0.5rem">Add a note</div>
            <textarea id="freestanding-note" rows="2" placeholder="Mid-session thought, observation…" style="margin-bottom:0.5rem"></textarea>
            <input type="text" id="freestanding-author" value="${esc(author)}" placeholder="Your name" style="margin-bottom:0.5rem">
            <button class="btn btn-secondary btn-sm" onclick="addFreestandingNote('${esc(id)}')">Add note</button>
          </div>
        </div>

        <!-- Log -->
        <div class="card">
          <div class="card-body">
            <div class="label" style="margin-bottom:0.75rem">Log</div>
            ${log.length
              ? log.slice().reverse().map(entry => logEntryHtml(entry)).join('')
              : `<p class="hint">No log entries yet.</p>`}
          </div>
        </div>

      </div>
    </div>
  `);
}

function logEntryHtml(entry) {
  const isTransition = entry.from_status && entry.to_status;
  return `
    <div class="log-entry">
      <div class="log-entry-head">
        ${isTransition
          ? `<span class="log-transition">${statusBadgeHtml(entry.from_status)} → ${statusBadgeHtml(entry.to_status)}</span>`
          : `<span class="badge" style="background:#f0ede8;color:#666">Note</span>`}
        <span class="log-entry-meta">${entry.author ? esc(entry.author) + ' · ' : ''}${fmtDate(entry.created_at)}</span>
      </div>
      ${entry.comment ? `<p class="log-entry-comment">${esc(entry.comment)}</p>` : ''}
    </div>
  `;
}

// ── Status change modal ───────────────────────────────────────────────────────

function openStatusModal(elementId, toStatus, fromStatus) {
  if (toStatus === fromStatus) return;
  const toLabel = VALID_STATUSES.find(s => s.value === toStatus)?.label || toStatus;
  const author  = localStorage.getItem('ps_author') || '';

  modal.open(`Change status to "${toLabel}"`,
    `<p style="margin-bottom:1rem;color:var(--t2)">A comment is required when changing status.</p>
    <div class="field">
      <label for="status-comment">Comment *</label>
      <textarea id="status-comment" rows="3" placeholder="e.g. Movement line introduced at bar 96 for 16 bars…"></textarea>
    </div>
    <div class="field">
      <label for="status-author">Your name</label>
      <input type="text" id="status-author" value="${esc(author)}" placeholder="Your name">
    </div>`,
    `<button class="btn btn-secondary" onclick="modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="submitStatusChange('${esc(elementId)}','${esc(toStatus)}')">Confirm</button>`
  );
}

async function submitStatusChange(elementId, toStatus) {
  const comment = document.getElementById('status-comment').value.trim();
  const author  = document.getElementById('status-author').value.trim();
  if (!comment) { toast.error('A comment is required.'); return; }
  if (author) localStorage.setItem('ps_author', author);

  const { error } = await api.setStatus(elementId, { toStatus, comment, author });
  if (error) { toast.error(error); return; }

  modal.close();
  toast.success('Status updated.');
  // Reload the element detail view
  await viewElement(new URLSearchParams(), { id: elementId });
}

async function addFreestandingNote(elementId) {
  const comment = document.getElementById('freestanding-note').value.trim();
  const author  = document.getElementById('freestanding-author').value.trim();
  if (!comment) { toast.error('Note text is required.'); return; }
  if (author) localStorage.setItem('ps_author', author);

  const { error } = await api.setStatus(elementId, { comment, author });
  if (error) { toast.error(error); return; }

  toast.success('Note added.');
  await viewElement(new URLSearchParams(), { id: elementId });
}

// ── File upload / delete ──────────────────────────────────────────────────────

async function uploadFile(elementId, slot, input) {
  const file = input.files[0];
  if (!file) return;

  // Show progress state in the upload area
  const areaId  = slot === 'audio' ? 'audio-upload-area' : 'primary-upload-area';
  const areaEl  = document.getElementById(areaId);
  if (areaEl) {
    areaEl.innerHTML = `
      <div class="upload-progress">
        <div class="upload-progress-bar" id="upload-progress-bar"></div>
      </div>
      <p class="hint" style="margin-top:0.5rem" id="upload-progress-label">Uploading <strong>${esc(file.name)}</strong>…</p>
    `;
  }

  // Use XMLHttpRequest so we can show real upload progress
  const result = await new Promise((resolve) => {
    const form = new FormData();
    form.append('file', file);
    if (slot === 'primary') {
      const typeEl = document.getElementById('primary-type-select');
      form.append('type', typeEl ? typeEl.value : 'other');
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/elements/${elementId}/files/${slot}`);

    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      const bar = document.getElementById('upload-progress-bar');
      const lbl = document.getElementById('upload-progress-label');
      if (bar) bar.style.width = pct + '%';
      if (lbl) lbl.innerHTML = `Uploading <strong>${esc(file.name)}</strong>… ${pct}%`;
    });

    xhr.addEventListener('load', () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve({ data });
        else resolve({ error: data.error || `Upload failed (${xhr.status})` });
      } catch (_) {
        resolve({ error: 'Unexpected server response' });
      }
    });

    xhr.addEventListener('error', () => resolve({ error: 'Network error during upload' }));
    xhr.addEventListener('abort', () => resolve({ error: 'Upload cancelled' }));

    xhr.send(form);
  });

  if (result.error) {
    toast.error(result.error);
    // Reload the view to restore the upload area
    await viewElement(new URLSearchParams(), { id: elementId });
    return;
  }

  toast.success(`${file.name} uploaded.`);
  await viewElement(new URLSearchParams(), { id: elementId });
}

async function deleteFileSlot(elementId, slot) {
  const label = slot === 'audio' ? 'audio preview' : 'primary file';
  if (!confirm(`Remove this ${label}? The file will be deleted from disk.`)) return;
  const { error } = await api.deleteFile(elementId, slot);
  if (error) { toast.error(error); return; }
  toast.success('File removed.');
  await viewElement(new URLSearchParams(), { id: elementId });
}

// ── Edit element modal ────────────────────────────────────────────────────────

async function openEditElementModal(id) {
  const { data: el, error } = await api.getElement(id);
  if (error) { toast.error(error); return; }

  const activeLayers = state.layers.filter(l => !l.archived);

  modal.open('Edit element',
    `<div class="field">
      <label for="eel-title">Title *</label>
      <input type="text" id="eel-title" value="${esc(el.title)}" maxlength="200">
    </div>
    <div class="field">
      <label for="eel-desc">Description</label>
      <textarea id="eel-desc" rows="3">${esc(el.description)}</textarea>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="eel-layer">Layer</label>
        <select id="eel-layer">
          <option value="">— none —</option>
          ${activeLayers.map(l =>
            `<option value="${esc(l.id)}" ${el.layerId === l.id ? 'selected' : ''}>${esc(l.name)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="field">
        <label for="eel-source">Source type</label>
        <select id="eel-source">
          <option value="">— none —</option>
          ${SOURCE_TYPES.map(s =>
            `<option value="${esc(s.value)}" ${el.sourceType === s.value ? 'selected' : ''}>${esc(s.label)}</option>`
          ).join('')}
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="eel-processing">Processing state</label>
        <select id="eel-processing">
          <option value="">— none —</option>
          ${PROCESSING_STATES.map(s =>
            `<option value="${esc(s.value)}" ${el.processingState === s.value ? 'selected' : ''}>${esc(s.label.split(' — ')[0])}</option>`
          ).join('')}
        </select>
      </div>
      <div class="field">
        <label for="eel-energy">Energy level</label>
        <select id="eel-energy">
          <option value="">— none —</option>
          ${ENERGY_LEVELS.map(s =>
            `<option value="${esc(s.value)}" ${el.energyLevel === s.value ? 'selected' : ''}>${esc(s.label)}</option>`
          ).join('')}
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="eel-bpm">BPM</label>
        <input type="number" id="eel-bpm" value="${esc(el.bpm)}" min="60" max="250">
      </div>
      <div class="field">
        <label for="eel-key">Key</label>
        <input type="text" id="eel-key" value="${esc(el.key)}" maxlength="30">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="eel-synth">Synth / plugin</label>
        <input type="text" id="eel-synth" value="${esc(el.synth)}">
      </div>
      <div class="field">
        <label for="eel-patch">Patch name</label>
        <input type="text" id="eel-patch" value="${esc(el.patch)}">
      </div>
    </div>
    <div class="field">
      <label for="eel-bank">Soundbank</label>
      <input type="text" id="eel-bank" value="${esc(el.bank)}">
    </div>
    <div class="field">
      <label for="eel-tech">Technique notes</label>
      <textarea id="eel-tech" rows="2">${esc(el.tech)}</textarea>
    </div>`,
    `<button class="btn btn-secondary" onclick="modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="submitEditElement('${esc(id)}')">Save changes</button>`
  );
}

async function submitEditElement(id) {
  const title = document.getElementById('eel-title').value.trim();
  if (!title) { toast.error('Title is required.'); return; }

  const { error } = await api.updateElement(id, {
    title,
    description:     document.getElementById('eel-desc').value.trim(),
    layerId:         document.getElementById('eel-layer').value,
    sourceType:      document.getElementById('eel-source').value,
    processingState: document.getElementById('eel-processing').value,
    energyLevel:     document.getElementById('eel-energy').value,
    bpm:             document.getElementById('eel-bpm').value.trim(),
    key:             document.getElementById('eel-key').value.trim(),
    synth:           document.getElementById('eel-synth').value.trim(),
    patch:           document.getElementById('eel-patch').value.trim(),
    bank:            document.getElementById('eel-bank').value.trim(),
    tech:            document.getElementById('eel-tech').value.trim(),
  });

  if (error) { toast.error(error); return; }
  modal.close();
  toast.success('Element updated.');
  await viewElement(new URLSearchParams(), { id });
}

async function confirmDeleteElement(id, projectId) {
  if (!confirm('Delete this element? Its log entries will be removed.\n\nFiles on disk are not deleted — use the Remove buttons on the files first if you want them gone.')) return;
  const { error } = await api.deleteElement(id);
  if (error) { toast.error(error); return; }
  toast.success('Element deleted.');
  router.navigate(`/projects/${projectId}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROUTER REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
//  EXPORT VIEW  — select elements, map custom layers, download PA JSON
// ═══════════════════════════════════════════════════════════════════════════════

const PA_LAYERS = ['foundation', 'movement', 'texture', 'punctuation', 'psychedelic'];
const PA_LAYER_LABELS = {
  foundation:  'Foundation',
  movement:    'Movement',
  texture:     'Texture',
  punctuation: 'Punctuation',
  psychedelic: 'Psychedelic Detail',
};

// Selected element IDs for export — module-level so the mapping step can read them
let _exportSelectedIds = new Set();

async function viewExport(queryParams, routeParams) {
  const { id: projectId } = routeParams;

  const { data: project, error: pErr } = await api.getProject(projectId);
  if (pErr) { toast.error('Project not found.'); router.navigate('/projects', true); return; }

  state.currentProject = project;
  updateTopnav();

  // Load all elements for this project — filter to exportable statuses
  const { data: allElements, error: eErr } = await api.elements(projectId);
  if (eErr) { toast.error(eErr); return; }

  const exportable = allElements.filter(el =>
    el.status === 'selected' || el.status === 'imported'
  );
  const other = allElements.filter(el =>
    el.status !== 'selected' && el.status !== 'imported'
  );

  // Pre-select all exportable elements
  _exportSelectedIds = new Set(exportable.map(el => el.id));

  setApp(`
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Export to Palette Arsenal</h1>
        <p class="page-sub">from <strong>${esc(project.name)}</strong></p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-ghost btn-sm" onclick="router.navigate('/projects/${esc(projectId)}')">← Back</button>
      </div>
    </div>

    <div class="export-layout">

      <!-- Element selection -->
      <div class="card" style="margin-bottom:1rem">
        <div class="card-body">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.9rem;flex-wrap:wrap;gap:0.5rem">
            <div>
              <div class="label" style="margin-bottom:0.2rem">Select elements to export</div>
              <p class="hint">Only <strong>Selected</strong> and <strong>Imported</strong> elements are shown. Change an element's status to include it.</p>
            </div>
            <div style="display:flex;gap:0.5rem">
              <button class="btn btn-ghost btn-sm" onclick="exportSelectAll(true)">Select all</button>
              <button class="btn btn-ghost btn-sm" onclick="exportSelectAll(false)">Deselect all</button>
            </div>
          </div>

          ${exportable.length ? `
          <div class="export-element-list" id="export-element-list">
            ${exportable.map(el => exportElementRowHtml(el)).join('')}
          </div>` : `
          <div class="empty-state" style="padding:1.5rem">
            <p>No elements with status <strong>Selected</strong> or <strong>Imported</strong> in this project.</p>
            <p class="hint" style="margin-top:0.35rem">Mark elements as Selected or Imported from their detail view, then return here to export.</p>
          </div>`}

          ${other.length ? `
          <details style="margin-top:1rem">
            <summary class="hint" style="cursor:pointer;user-select:none">
              Show ${other.length} element${other.length !== 1 ? 's' : ''} with other statuses (not exported by default)
            </summary>
            <div class="export-element-list" id="export-element-list-other" style="margin-top:0.75rem;opacity:0.65">
              ${other.map(el => exportElementRowHtml(el)).join('')}
            </div>
          </details>` : ''}
        </div>
      </div>

      <!-- Export action -->
      <div class="card">
        <div class="card-body">
          <div class="label" style="margin-bottom:0.5rem">Export</div>
          <p class="hint" style="margin-bottom:1rem">
            Downloads a <code>.json</code> file shaped to match Palette Arsenal v11's sound schema.
            Import it into Palette Arsenal using the <strong>Import sounds</strong> button —
            it appends the sounds into the right layers without touching the rest of your palette.
          </p>
          <div id="export-mapping-area"></div>
          <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-top:1rem">
            <button class="btn btn-primary" id="export-btn" onclick="runExport('${esc(projectId)}')">
              ↓ Download Palette Arsenal JSON
            </button>
            <span class="hint" id="export-selection-count"></span>
          </div>
        </div>
      </div>

    </div>
  `);

  updateExportCount();
}

function exportElementRowHtml(el) {
  const checked = _exportSelectedIds.has(el.id);
  return `
    <label class="export-element-row" id="export-row-${esc(el.id)}">
      <input type="checkbox" ${checked ? 'checked' : ''}
        onchange="toggleExportElement('${esc(el.id)}', this.checked)">
      <div class="export-element-info">
        <span class="export-element-title">${esc(el.title)}</span>
        <span class="export-element-meta">
          ${layerBadgeHtml(el.layerId)}
          ${statusBadgeHtml(el.status)}
          ${el.synth ? `<span class="meta-tag">${esc(el.synth)}</span>` : ''}
        </span>
      </div>
    </label>`;
}

function toggleExportElement(id, checked) {
  if (checked) _exportSelectedIds.add(id);
  else         _exportSelectedIds.delete(id);
  updateExportCount();
}

function exportSelectAll(select) {
  // Select/deselect all checkboxes currently rendered
  document.querySelectorAll('.export-element-row input[type=checkbox]').forEach(cb => {
    cb.checked = select;
    const row = cb.closest('.export-element-row');
    if (row) {
      const id = row.id.replace('export-row-', '');
      if (select) _exportSelectedIds.add(id);
      else        _exportSelectedIds.delete(id);
    }
  });
  updateExportCount();
}

function updateExportCount() {
  const countEl = document.getElementById('export-selection-count');
  if (countEl) {
    const n = _exportSelectedIds.size;
    countEl.textContent = n
      ? `${n} element${n !== 1 ? 's' : ''} selected`
      : 'No elements selected';
  }
}

async function runExport(projectId) {
  const ids = [..._exportSelectedIds];
  if (!ids.length) { toast.error('No elements selected.'); return; }

  const btn = document.getElementById('export-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }

  // Pre-flight: check for custom layers that need mapping
  const { data: check, error: checkErr } = await api.exportCheck(ids);
  if (checkErr) {
    toast.error(checkErr);
    if (btn) { btn.disabled = false; btn.textContent = '↓ Download Palette Arsenal JSON'; }
    return;
  }

  if (check.needsMapping) {
    // Show mapping UI inline, then wait for user to confirm
    showLayerMappingUI(check.unmappedLayers, ids, projectId);
    if (btn) { btn.disabled = false; btn.textContent = '↓ Download Palette Arsenal JSON'; }
    return;
  }

  // No mapping needed — export directly
  await doExport(ids, {}, projectId);
  if (btn) { btn.disabled = false; btn.textContent = '↓ Download Palette Arsenal JSON'; }
}

function showLayerMappingUI(unmappedLayers, ids, projectId) {
  const mappingArea = document.getElementById('export-mapping-area');
  if (!mappingArea) return;

  const paOptions = PA_LAYERS.map(id =>
    `<option value="${id}">${PA_LAYER_LABELS[id]}</option>`
  ).join('');

  mappingArea.innerHTML = `
    <div class="alert alert-info" style="margin-bottom:1rem">
      Some elements use custom layers. Map each one to a Palette Arsenal layer before exporting.
    </div>
    <div class="export-layer-map">
      ${unmappedLayers.map(l => `
        <div class="export-layer-map-row">
          <span class="export-layer-map-from">${esc(l.name)}</span>
          <span class="export-layer-map-arrow">→</span>
          <select class="export-layer-map-select" id="layermap-${esc(l.id)}">
            ${paOptions}
          </select>
        </div>`).join('')}
    </div>
    <button class="btn btn-primary" style="margin-top:1rem"
      onclick="confirmMappedExport(${JSON.stringify(unmappedLayers.map(l => l.id))}, ${JSON.stringify(ids)})">
      ↓ Download with this mapping
    </button>
  `;
}

async function confirmMappedExport(unmappedLayerIds, ids) {
  const layerMap = {};
  for (const layerId of unmappedLayerIds) {
    const sel = document.getElementById(`layermap-${layerId}`);
    if (sel) layerMap[layerId] = sel.value;
  }
  await doExport(ids, layerMap);
}

async function doExport(ids, layerMap) {
  const btn = document.getElementById('export-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }

  // POST to the export endpoint — response is a JSON file download
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elementIds: ids, layerMap }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || 'Export failed');
      return;
    }

    // Trigger a browser download from the response blob
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;

    // Use filename from Content-Disposition header if present, otherwise generate one
    const cd       = res.headers.get('Content-Disposition') || '';
    const match    = cd.match(/filename="([^"]+)"/);
    a.download     = match ? match[1] : `patchstash-export-${Date.now()}.json`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${ids.length} element${ids.length !== 1 ? 's' : ''}.`);

    // Clear mapping UI if it was shown
    const mappingArea = document.getElementById('export-mapping-area');
    if (mappingArea) mappingArea.innerHTML = '';

  } catch (e) {
    toast.error('Network error during export.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↓ Download Palette Arsenal JSON'; }
  }
}

router.register('/login',                       viewLogin);
router.register('/layers',                      viewLayers);
router.register('/projects',                    viewProjects);
router.register('/projects/:id',                viewProject);
router.register('/projects/:id/elements/new',   viewNewElement);
router.register('/projects/:id/export',         viewExport);
router.register('/elements/:id',                viewElement);

// ═══════════════════════════════════════════════════════════════════════════════
//  BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════════════

async function boot() {
  const { data, error } = await api.auth();

  if (error) {
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

  renderShell();
  await loadLayers();
  router.init();
  if (location.pathname === '/') router.navigate('/projects', true);
}

document.addEventListener('DOMContentLoaded', boot);
