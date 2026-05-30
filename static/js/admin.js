/* ════════════════════════════════════════════════════════════
   admin.js – Admin management panel
════════════════════════════════════════════════════════════ */

// ── Tab switching ──────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'assign') loadAssignTab();
    if (tab.dataset.tab === 'stops')  loadStopFilters();
    if (tab.dataset.tab === 'users')  loadUsersTab();
  });
});

// ── Toast ──────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ═══════════════════════════════════════════════════════════
// BUSES
// ═══════════════════════════════════════════════════════════

let buses  = [];
let routes = [];
let editingBusId = null;

async function loadBuses() {
  const [busRes, routeRes] = await Promise.all([fetch('/api/buses'), fetch('/api/routes')]);
  buses  = await busRes.json();
  routes = await routeRes.json();
  renderBusTable();
}

function renderBusTable() {
  const tb = document.getElementById('bus-tbody');
  tb.innerHTML = '';
  if (buses.length === 0) {
    tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">No buses yet. Add one above.</td></tr>`;
    return;
  }
  buses.forEach(b => {
    const routeName = routes.find(r => r.id === b.route_id)?.name ?? '–';
    const badge = `<span class="badge badge-${b.status}">${b.status}</span>`;
    tr(tb, `
      <td>${b.id}</td>
      <td>${b.name}</td>
      <td style="font-family:var(--mono);font-size:11px">${b.number_plate}</td>
      <td>${b.capacity}</td>
      <td>${badge}</td>
      <td>${routeName}</td>
      <td>
        <button class="btn btn-edit"   onclick="editBus(${b.id})">Edit</button>
        <button class="btn btn-danger" onclick="deleteBus(${b.id})">Delete</button>
      </td>
    `);
  });
}

function tr(tbody, html) {
  const row = document.createElement('tr');
  row.innerHTML = html;
  tbody.appendChild(row);
}

// Add button
document.getElementById('btn-add-bus').addEventListener('click', () => {
  editingBusId = null;
  document.getElementById('bus-form-title').textContent = 'New Bus';
  document.getElementById('bus-name').value  = '';
  document.getElementById('bus-plate').value = '';
  document.getElementById('bus-cap').value   = '40';
  document.getElementById('bus-form').style.display = 'block';
});
document.getElementById('bus-cancel-btn').addEventListener('click', () => {
  document.getElementById('bus-form').style.display = 'none';
});

document.getElementById('bus-save-btn').addEventListener('click', async () => {
  const body = {
    name:         document.getElementById('bus-name').value.trim(),
    number_plate: document.getElementById('bus-plate').value.trim(),
    capacity:     parseInt(document.getElementById('bus-cap').value) || 40
  };
  if (!body.name || !body.number_plate) return alert('Fill in all required fields.');

  const url    = editingBusId ? `/api/buses/${editingBusId}` : '/api/buses';
  const method = editingBusId ? 'PUT' : 'POST';
  await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  document.getElementById('bus-form').style.display = 'none';
  showToast(editingBusId ? '✅ Bus updated' : '✅ Bus added');
  loadBuses();
});

function editBus(id) {
  const bus = buses.find(b => b.id === id);
  if (!bus) return;
  editingBusId = id;
  document.getElementById('bus-form-title').textContent = `Editing: ${bus.name}`;
  document.getElementById('bus-name').value  = bus.name;
  document.getElementById('bus-plate').value = bus.number_plate;
  document.getElementById('bus-cap').value   = bus.capacity;
  document.getElementById('bus-form').style.display = 'block';
  document.getElementById('bus-form').scrollIntoView({ behavior: 'smooth' });
}

async function deleteBus(id) {
  if (!confirm('Delete this bus? This cannot be undone.')) return;
  await fetch(`/api/buses/${id}`, { method: 'DELETE' });
  showToast('🗑️ Bus deleted');
  loadBuses();
}

// ═══════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════

let editingRouteId = null;

async function loadRoutes() {
  const res = await fetch('/api/routes');
  routes = await res.json();
  renderRouteTable();
}

function renderRouteTable() {
  const tb = document.getElementById('route-tbody');
  tb.innerHTML = '';
  if (routes.length === 0) {
    tb.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">No routes yet.</td></tr>`;
    return;
  }
  routes.forEach(r => {
    tr(tb, `
      <td>${r.id}</td>
      <td>${r.name}</td>
      <td style="color:var(--text-muted)">${r.description || '–'}</td>
      <td>
        <button class="btn btn-edit"   onclick="editRoute(${r.id})">Edit</button>
        <button class="btn btn-danger" onclick="deleteRoute(${r.id})">Delete</button>
      </td>
    `);
  });
}

document.getElementById('btn-add-route').addEventListener('click', () => {
  editingRouteId = null;
  document.getElementById('route-name').value = '';
  document.getElementById('route-desc').value = '';
  document.getElementById('route-form').style.display = 'block';
});
document.getElementById('route-cancel-btn').addEventListener('click', () => {
  document.getElementById('route-form').style.display = 'none';
});

document.getElementById('route-save-btn').addEventListener('click', async () => {
  const body = {
    name:        document.getElementById('route-name').value.trim(),
    description: document.getElementById('route-desc').value.trim()
  };
  if (!body.name) return alert('Route name is required.');
  const url    = editingRouteId ? `/api/routes/${editingRouteId}` : '/api/routes';
  const method = editingRouteId ? 'PUT' : 'POST';
  await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('route-form').style.display = 'none';
  showToast(editingRouteId ? '✅ Route updated' : '✅ Route added');
  loadRoutes();
});

function editRoute(id) {
  const r = routes.find(x => x.id === id);
  if (!r) return;
  editingRouteId = id;
  document.getElementById('route-name').value = r.name;
  document.getElementById('route-desc').value = r.description;
  document.getElementById('route-form').style.display = 'block';
}

async function deleteRoute(id) {
  if (!confirm('Delete this route AND all its stops?')) return;
  await fetch(`/api/routes/${id}`, { method: 'DELETE' });
  showToast('🗑️ Route deleted');
  loadRoutes();
}

// ── STOPS ───────────────────────────────────────────────────

let stops = [];
let adminMap = null;
let adminMarker = null;

function initStopMap() {
  if (adminMap) return;

  // Initialize map
  adminMap = L.map('stop-map').setView([12.372115, 76.584975], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(adminMap);

  // Initial marker
  adminMarker = L.marker([12.372115, 76.584975], { draggable: true }).addTo(adminMap);

  // Click on map to move marker and update inputs
  adminMap.on('click', (e) => {
    const { lat, lng } = e.latlng;
    updateMarkerAndInputs(lat, lng);
  });

  // Drag marker to update inputs
  adminMarker.on('dragend', (e) => {
    const { lat, lng } = e.target.getLatLng();
    updateMarkerAndInputs(lat, lng);
  });

  // Sync manual input changes back to map
  document.getElementById('stop-lat').addEventListener('input', syncInputsToMap);
  document.getElementById('stop-lon').addEventListener('input', syncInputsToMap);
}

function updateMarkerAndInputs(lat, lng) {
  const fixedLat = parseFloat(lat).toFixed(6);
  const fixedLng = parseFloat(lng).toFixed(6);
  adminMarker.setLatLng([lat, lng]);
  document.getElementById('stop-lat').value = fixedLat;
  document.getElementById('stop-lon').value = fixedLng;
}

function syncInputsToMap() {
  const lat = parseFloat(document.getElementById('stop-lat').value);
  const lng = parseFloat(document.getElementById('stop-lon').value);
  if (!isNaN(lat) && !isNaN(lng)) {
    adminMarker.setLatLng([lat, lng]);
    adminMap.panTo([lat, lng]);
  }
}

// Search functionality
document.getElementById('btn-map-search').addEventListener('click', performSearch);
document.getElementById('stop-map-search').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') performSearch();
});

async function performSearch() {
  const query = document.getElementById('stop-map-search').value.trim();
  if (!query) return;

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
    const results = await res.json();
    if (results && results.length > 0) {
      const { lat, lon } = results[0];
      adminMap.setView([lat, lon], 16);
      updateMarkerAndInputs(lat, lon);
    } else {
      showToast('❌ Location not found');
    }
  } catch (err) {
    console.error('Search error:', err);
    showToast('❌ Search failed');
  }
}

async function loadStops(filterRouteId = '') {
  const url = filterRouteId ? `/api/stops?route_id=${filterRouteId}` : '/api/stops';
  const res = await fetch(url);
  stops = await res.json();
  renderStopTable();
}

function renderStopTable() {
  const tb = document.getElementById('stop-tbody');
  tb.innerHTML = '';
  if (stops.length === 0) {
    tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">No stops found.</td></tr>`;
    return;
  }
  stops.forEach(s => {
    const routeName = routes.find(r => r.id === s.route_id)?.name ?? '–';
    tr(tb, `
      <td>${s.id}</td>
      <td style="font-size:12px;color:var(--text-muted)">${routeName}</td>
      <td>${s.name}</td>
      <td style="font-family:var(--mono);font-size:11px">${s.latitude}</td>
      <td style="font-family:var(--mono);font-size:11px">${s.longitude}</td>
      <td>${s.stop_order}</td>
      <td>
        <button class="btn btn-danger" onclick="deleteStop(${s.id})">Delete</button>
      </td>
    `);
  });
}

function loadStopFilters() {
  // Populate route dropdowns inside stops tab
  const sel  = document.getElementById('stop-route-id');
  const filt = document.getElementById('stop-filter-route');
  sel.innerHTML  = routes.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
  filt.innerHTML = '<option value="">All Routes</option>' +
                   routes.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
  loadStops();
}

document.getElementById('stop-filter-route').addEventListener('change', (e) => {
  loadStops(e.target.value);
});

document.getElementById('btn-add-stop').addEventListener('click', () => {
  document.getElementById('stop-name').value = '';
  document.getElementById('stop-lat').value = '';
  document.getElementById('stop-lon').value = '';
  document.getElementById('stop-order').value = '';
  document.getElementById('stop-map-search').value = '';
  
  document.getElementById('stop-form').style.display = 'block';
  initStopMap();
  
  // Set default view to campus
  const campusCoords = [12.372115, 76.584975];
  adminMap.setView(campusCoords, 15);
  adminMarker.setLatLng(campusCoords);
  
  setTimeout(() => adminMap.invalidateSize(), 100);
});
document.getElementById('stop-cancel-btn').addEventListener('click', () => {
  document.getElementById('stop-form').style.display = 'none';
});

document.getElementById('stop-save-btn').addEventListener('click', async () => {
  const body = {
    route_id:   parseInt(document.getElementById('stop-route-id').value),
    name:       document.getElementById('stop-name').value.trim(),
    latitude:   parseFloat(document.getElementById('stop-lat').value),
    longitude:  parseFloat(document.getElementById('stop-lon').value),
    stop_order: parseInt(document.getElementById('stop-order').value) || 0
  };
  if (!body.name || isNaN(body.latitude) || isNaN(body.longitude)) {
    return alert('Please fill all stop fields including coordinates.');
  }
  await fetch('/api/stops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('stop-form').style.display = 'none';
  showToast('✅ Stop added');
  loadStops(document.getElementById('stop-filter-route').value);
});

async function deleteStop(id) {
  if (!confirm('Delete this stop?')) return;
  await fetch(`/api/stops/${id}`, { method: 'DELETE' });
  showToast('🗑️ Stop deleted');
  loadStops(document.getElementById('stop-filter-route').value);
}

// ═══════════════════════════════════════════════════════════
// ASSIGN
// ═══════════════════════════════════════════════════════════

async function loadAssignTab() {
  const [busRes, routeRes] = await Promise.all([fetch('/api/buses'), fetch('/api/routes')]);
  buses  = await busRes.json();
  routes = await routeRes.json();

  const busSelect   = document.getElementById('assign-bus');
  const routeSelect = document.getElementById('assign-route');
  busSelect.innerHTML   = buses.map(b  => `<option value="${b.id}">${b.name}</option>`).join('');
  routeSelect.innerHTML = routes.map(r => `<option value="${r.id}">${r.name}</option>`).join('');

  renderAssignTable();
}

function renderAssignTable() {
  const tb = document.getElementById('assign-tbody');
  tb.innerHTML = '';
  buses.forEach(b => {
    const routeName = routes.find(r => r.id === b.route_id)?.name ?? '–';
    const badge = `<span class="badge badge-${b.status}">${b.status}</span>`;
    tr(tb, `<td>${b.name}</td><td style="font-family:var(--mono);font-size:11px">${b.number_plate}</td><td>${badge}</td><td>${routeName}</td>`);
  });
}

document.getElementById('assign-btn').addEventListener('click', async () => {
  const busId   = parseInt(document.getElementById('assign-bus').value);
  const routeId = parseInt(document.getElementById('assign-route').value);
  if (!busId || !routeId) return;
  await fetch('/api/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bus_id: busId, route_id: routeId })
  });
  document.getElementById('assign-msg').textContent = '✅ Assignment saved!';
  setTimeout(() => document.getElementById('assign-msg').textContent = '', 3000);
  showToast('✅ Bus assigned to route');
  loadAssignTab();
});

// ═══════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════

let users = [];

async function loadUsersTab() {
  const res = await fetch('/api/users');
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/';
    return;
  }
  users = await res.json();
  renderUserTable();
}

function renderUserTable() {
  const tb = document.getElementById('user-tbody');
  tb.innerHTML = '';
  if (users.length === 0) {
    tb.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">No users found.</td></tr>`;
    return;
  }
  users.forEach(u => {
    const roleBadge = u.role === 'admin' ? 
      `<span class="badge" style="background:rgba(139,92,246,0.15);color:#c084fc;border:1px solid rgba(139,92,246,0.3)">admin</span>` : 
      (u.role === 'driver' ? 
        `<span class="badge" style="background:rgba(245,166,35,0.15);color:var(--amber);border:1px solid rgba(245,166,35,0.3)">driver</span>` : 
        `<span class="badge" style="background:rgba(96,165,250,0.15);color:var(--blue);border:1px solid rgba(96,165,250,0.3)">student</span>`
      );
    
    tr(tb, `
      <td>${u.id}</td>
      <td>${u.username}</td>
      <td>${roleBadge}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--text-muted)">${u.created_at}</td>
      <td>
        <button class="btn btn-danger" onclick="deleteUser(${u.id})">Delete</button>
      </td>
    `);
  });
}

document.getElementById('btn-add-user').addEventListener('click', () => {
  document.getElementById('user-username').value = '';
  document.getElementById('user-password').value = '';
  document.getElementById('user-role').value = 'student';
  document.getElementById('user-form').style.display = 'block';
});

document.getElementById('user-cancel-btn').addEventListener('click', () => {
  document.getElementById('user-form').style.display = 'none';
});

document.getElementById('user-save-btn').addEventListener('click', async () => {
  const username = document.getElementById('user-username').value.trim();
  const password = document.getElementById('user-password').value;
  const role     = document.getElementById('user-role').value;

  if (!username || !password) {
    return alert('Username and password are required.');
  }

  const body = { username, password, role };
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (res.status === 201) {
    document.getElementById('user-form').style.display = 'none';
    showToast('✅ User added successfully');
    loadUsersTab();
  } else {
    alert(data.error || 'Failed to add user');
  }
});

async function deleteUser(id) {
  if (!confirm('Are you sure you want to delete this user?')) return;
  const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (res.status === 200) {
    showToast('🗑️ User deleted');
    loadUsersTab();
  } else {
    alert(data.error || 'Failed to delete user');
  }
}

// ── Boot ───────────────────────────────────────────────────
loadBuses();
loadRoutes();
