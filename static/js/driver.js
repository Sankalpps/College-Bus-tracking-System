/* ════════════════════════════════════════════════════════════
   driver.js – Driver control panel
════════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────
let tripActive     = false;
let selectedBusId  = null;
let geoWatchId     = null;
let pingInterval   = null;
let lastPosition   = null;
const PING_MS      = 7000;   // send GPS every 7 seconds
let isSimulating   = false;
let simulationInterval = null;

// ── DOM ────────────────────────────────────────────────────
const busSelect    = document.getElementById('bus-select');
const busInfo      = document.getElementById('bus-info');
const infoRoute    = document.getElementById('info-route');
const infoPlate    = document.getElementById('info-plate');
const infoCap      = document.getElementById('info-cap');
const btnStart     = document.getElementById('btn-start');
const btnStop      = document.getElementById('btn-stop');
const btnSimulate  = document.getElementById('btn-simulate');
const tripBadge    = document.getElementById('trip-badge');
const gpsLat       = document.getElementById('gps-lat');
const gpsLon       = document.getElementById('gps-lon');
const gpsAcc       = document.getElementById('gps-acc');
const gpsTs        = document.getElementById('gps-ts');
const gpsMsg       = document.getElementById('gps-msg');
const gpsBarFill   = document.getElementById('gps-bar-fill');
const logList      = document.getElementById('log-list');

// ── Socket ─────────────────────────────────────────────────
let socket = null;
if (typeof io !== 'undefined') {
  socket = io();
  socket.on('connect', ()    => setConnStatus(true));
  socket.on('disconnect', () => setConnStatus(false));
  socket.on('trip_started', (data) => {
    if (data.bus_id === selectedBusId) log('Trip confirmed started', 'success');
  });
  socket.on('trip_stopped', (data) => {
    if (data.bus_id === selectedBusId) log('Trip confirmed stopped', 'success');
  });
} else {
  console.warn('Socket.io not available. Some features will not work.');
}

// ── Load buses ─────────────────────────────────────────────
async function fetchBuses() {
  const res   = await fetch('/api/buses');
  const buses = await res.json();
  busSelect.innerHTML = '<option value="">-- Choose a bus --</option>';
  buses.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    // Show 'Active' in dropdown if bus is already in a trip
    const statusText = b.status === 'active' ? ' [ACTIVE]' : '';
    opt.textContent = `${b.name} (${b.number_plate})${statusText}`;
    busSelect.appendChild(opt);
  });

  // Restore from sessionStorage (allows multiple tabs to have different buses)
  const savedId = sessionStorage.getItem('selectedBusId');
  if (savedId) {
    busSelect.value = savedId;
    selectedBusId = parseInt(savedId);
    await loadBusDetails(selectedBusId);
  }

  return buses;
}

// ── Bus selection ──────────────────────────────────────────
busSelect.addEventListener('change', async () => {
  const id = parseInt(busSelect.value);
  if (!id) {
    busInfo.style.display = 'none';
    btnStart.disabled = true;
    selectedBusId = null;
    sessionStorage.removeItem('selectedBusId');
    return;
  }
  selectedBusId = id;
  sessionStorage.setItem('selectedBusId', id);

  await loadBusDetails(id);
});

async function loadBusDetails(id) {
  // Load bus details
  const res   = await fetch('/api/buses');
  const buses = await res.json();
  const bus   = buses.find(b => b.id === id);

  if (bus) {
    busInfo.style.display = 'flex';
    infoPlate.textContent = bus.number_plate;
    infoCap.textContent   = `${bus.capacity} seats`;

    // Load route name
    if (bus.route_id) {
      const rRes    = await fetch('/api/routes');
      const routes  = await rRes.json();
      const route   = routes.find(r => r.id === bus.route_id);
      infoRoute.textContent = route ? route.name : '–';
      btnSimulate.disabled = false;
    } else {
      infoRoute.textContent = 'No route assigned';
      btnSimulate.disabled = true;
    }

    if (bus.status === 'active' && !tripActive) {
      log(`Bus ${bus.name} is already active. Resuming...`, 'info');
      startTripUI();
    }
  }

  btnStart.disabled = tripActive;
  log(`Bus ${bus?.name} selected`);
}

function startTripUI() {
  tripActive = true;

  tripBadge.textContent = 'ACTIVE';
  tripBadge.classList.add('active');
  btnStart.disabled = true;
  btnStop.disabled  = false;
  btnSimulate.disabled = false;
  busSelect.disabled = true;

  gpsMsg.textContent = 'Acquiring GPS…';

  // Start watching position
  geoWatchId = navigator.geolocation.watchPosition(
    onPosition,
    onGeoError,
    { enableHighAccuracy: true, maximumAge: 5000 }
  );

  // Periodically send last known position even if no movement
  pingInterval = setInterval(() => {
    if (lastPosition && tripActive) sendLocation(lastPosition);
  }, PING_MS);
}

// ── Start trip ─────────────────────────────────────────────
btnStart.addEventListener('click', () => {
  if (!selectedBusId) return alert('Please select a bus first.');

  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }

  if (socket) socket.emit('start_trip', { bus_id: selectedBusId });
  startTripUI();

  log('Trip started – GPS tracking active', 'success');
});

// ── Stop trip ──────────────────────────────────────────────
btnStop.addEventListener('click', () => {
  if (!selectedBusId) return;

  if (socket) socket.emit('stop_trip', { bus_id: selectedBusId });
  tripActive = false;
  if (isSimulating) stopSimulation();

  if (geoWatchId !== null) { navigator.geolocation.clearWatch(geoWatchId); geoWatchId = null; }
  clearInterval(pingInterval);

  tripBadge.textContent = 'STOPPED';
  tripBadge.classList.remove('active');
  btnStart.disabled  = false;
  btnStop.disabled   = true;
  busSelect.disabled = false;
  btnSimulate.disabled = false;

  gpsMsg.textContent = 'GPS inactive';
  gpsBarFill.style.width = '0%';

  log('Trip stopped', 'warn');
});

// ── GPS callbacks ──────────────────────────────────────────
function onPosition(pos) {
  lastPosition = pos;
  const { latitude, longitude, accuracy } = pos.coords;

  gpsLat.textContent = latitude.toFixed(6);
  gpsLon.textContent = longitude.toFixed(6);
  gpsAcc.textContent = `±${Math.round(accuracy)} m`;
  gpsTs.textContent  = new Date().toLocaleTimeString();

  // Accuracy bar: 100% at <10m, 0% at >200m
  const pct = Math.max(0, Math.min(100, 100 - ((accuracy - 10) / 190 * 100)));
  gpsBarFill.style.width = `${pct}%`;
  gpsMsg.textContent = accuracy < 30 ? '✅ Good GPS accuracy' : '⚠️ Low accuracy – keep moving';

  sendLocation(pos);
}

function onGeoError(err) {
  gpsMsg.textContent = `⚠️ GPS error: ${err.message}`;
  log(`GPS error: ${err.message}`, 'error');
}

function sendLocation(pos) {
  if (!tripActive || !selectedBusId || !socket) return;
  socket.emit('location_update', {
    bus_id:    selectedBusId,
    latitude:  pos.coords.latitude,
    longitude: pos.coords.longitude
  });
}

// ── Activity log ───────────────────────────────────────────
function log(msg, type = '') {
  const ul = logList;
  ul.querySelectorAll('.muted').forEach(e => e.remove());

  const li = document.createElement('li');
  li.className = `log-item ${type}`;
  const ts = new Date().toLocaleTimeString();
  li.textContent = `[${ts}] ${msg}`;
  ul.insertBefore(li, ul.firstChild);

  while (ul.children.length > 12) ul.lastChild.remove();
}

// ── Connection indicator ───────────────────────────────────
function setConnStatus(connected) {
  document.getElementById('conn-dot').className  = `dot ${connected ? 'connected' : 'disconnected'}`;
  document.getElementById('conn-label').textContent = connected ? 'Connected' : 'Disconnected';
}

// ── Simulator ──────────────────────────────────────────────
btnSimulate.addEventListener('click', async () => {
  if (isSimulating) {
    stopSimulation();
    return;
  }
  startSimulation();
});

async function startSimulation() {
  if (!selectedBusId) return;
  
  // 1. Get bus details to find route_id
  const res = await fetch('/api/buses');
  const buses = await res.json();
  const bus = buses.find(b => b.id === selectedBusId);
  if (!bus || !bus.route_id) return alert('Bus has no route assigned.');

  // 2. Get stops for this route
  const sRes = await fetch(`/api/stops?route_id=${bus.route_id}`);
  const stops = await sRes.json();
  if (stops.length < 2) return alert('Route needs at least 2 stops to simulate.');

  // 3. Fetch the actual road path from OSRM
  const coords = stops.map(s => `${s.longitude},${s.latitude}`).join(';');
  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  
  log('Fetching road path...', 'info');
  const routeRes = await fetch(osrmUrl);
  const routeData = await routeRes.json();
  
  if (!routeData.routes || routeData.routes.length === 0) {
    return alert('Could not find road path between stops.');
  }

  const pathPoints = routeData.routes[0].geometry.coordinates; // [[lng, lat], ...]

  isSimulating = true;
  btnSimulate.innerHTML = '<span class="btn-icon">⏹</span> Stop Simulation';
  log('Simulation started (Road Following)', 'info');
  
  // Ensure trip is started
  if (!tripActive) {
    if (socket) socket.emit('start_trip', { bus_id: selectedBusId });
    startTripUI();
  }

  let pointIndex = 0;

  simulationInterval = setInterval(() => {
    if (pointIndex >= pathPoints.length) {
      stopSimulation();
      return;
    }

    const [lng, lat] = pathPoints[pointIndex];

    onPosition({
      coords: {
        latitude: lat,
        longitude: lng,
        accuracy: 5
      }
    });

    // Move faster: skip some points to maintain speed, or adjust interval
    pointIndex += 2; 
  }, 1000); 
}

function stopSimulation() {
  isSimulating = false;
  clearInterval(simulationInterval);
  btnSimulate.innerHTML = '<span class="btn-icon">🔄</span> Simulate Route';
  log('Simulation stopped', 'info');
}

// ── Boot ───────────────────────────────────────────────────
fetchBuses();
