/* ════════════════════════════════════════════════════════════
   student.js – Live map for students
════════════════════════════════════════════════════════════ */

// ── Map init ───────────────────────────────────────────────
const map = L.map('map', {
  center: [12.372115, 76.584975],   // Exact: NIE North Campus Main Gate
  zoom: 16,
  zoomControl: true
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

// ── State ──────────────────────────────────────────────────
let buses          = [];       // [{id, name, number_plate, status, route_id, …}]
let busMarkers     = {};       // {bus_id: L.Marker}
let stopMarkers    = {};       // {stop_id: L.Marker}
let routeLine      = null;     // Routing control object (dynamic segment)
let staticPolyline = null;    // Full static route line
let selectedBus    = null;
const feedLimit    = 8;

// ── Socket ─────────────────────────────────────────────────
let socket = null;
if (typeof io !== 'undefined') {
  socket = io();
  
  socket.on('connect', () => {
    setConnStatus(true);
  });
  socket.on('disconnect', () => {
    setConnStatus(false);
  });

  socket.on('location_update', (data) => {
    updateBusMarker(data);
    if (selectedBus && data.bus_id === selectedBus.id) {
      updateSidebarETA(data.stops);
      updateStopETAs(data.stops);
      // Dynamic routing: Update path to start from current location
      renderRoadRoute(data.stops, { lat: data.latitude, lng: data.longitude });
    }
    addFeedItem(`🚌 Bus ${getBusName(data.bus_id)} updated position`);
  });

  socket.on('trip_started', (data) => {
    addFeedItem(`▶ Bus ${getBusName(data.bus_id)} started a trip`, 'success');
    fetchBuses(); // refresh status
  });

  socket.on('trip_stopped', (data) => {
    addFeedItem(`■ Bus ${getBusName(data.bus_id)} ended trip`, 'warn');
    removeMarker(data.bus_id);
    if (selectedBus && data.bus_id === selectedBus.id) {
      if (routeLine) map.removeControl(routeLine);
      routeLine = null;
      if (staticPolyline) staticPolyline.remove();
      staticPolyline = null;
      updateInstruction(null);
    }
    fetchBuses();
  });
} else {
  console.warn('Socket.io not available. Real-time updates will not work.');
}

// ── Fetch initial data ─────────────────────────────────────
async function fetchBuses() {
  const res = await fetch('/api/buses');
  buses = await res.json();
  renderBusList();
}

async function fetchStops(routeId) {
  if (!routeId) return [];
  const res = await fetch(`/api/stops?route_id=${routeId}`);
  return res.json();
}

// ── Render bus list in sidebar ─────────────────────────────
function renderBusList() {
  const el = document.getElementById('bus-list');
  el.innerHTML = '';
  if (buses.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px">No buses available</div>';
    return;
  }
  buses.forEach(bus => {
    const card = document.createElement('div');
    card.className = 'bus-card' + (selectedBus?.id === bus.id ? ' selected' : '');
    card.dataset.id = bus.id;
    const isActive = bus.status === 'active';
    card.innerHTML = `
      <div>
        <div class="bus-card-name">${bus.name}</div>
        <div class="bus-card-plate">${bus.number_plate}</div>
      </div>
      <span class="dot bus-card-dot ${isActive ? 'green' : 'red'}" title="${isActive ? 'Active' : 'Offline'}"></span>
    `;
    card.addEventListener('click', () => selectBus(bus));
    el.appendChild(card);
  });
}

// ── Select a bus ───────────────────────────────────────────
async function selectBus(bus) {
  selectedBus = bus;

  // Update UI selection
  document.querySelectorAll('.bus-card').forEach(c => {
    c.classList.toggle('selected', parseInt(c.dataset.id) === bus.id);
  });

  // Clear old stop markers and routing control
  Object.values(stopMarkers).forEach(m => m.remove());
  stopMarkers = {};
  if (routeLine) {
    map.removeControl(routeLine);
    routeLine = null;
  }
  if (staticPolyline) {
    staticPolyline.remove();
    staticPolyline = null;
  }
  updateInstruction(null);

  if (!bus.route_id) {
    document.getElementById('route-section').style.display = 'none';
    document.getElementById('eta-section').style.display   = 'none';
    return;
  }

  // Load stops
  const stops = await fetchStops(bus.route_id);
  renderStopList(stops);
  renderStopMarkers(stops);
  
  // If bus is active and we have its marker, start route from its current position
  const currentPos = busMarkers[bus.id] ? busMarkers[bus.id].getLatLng() : null;
  renderRoadRoute(stops, currentPos);

  // Pan to bus if active
  if (busMarkers[bus.id]) {
    map.panTo(busMarkers[bus.id].getLatLng());
  } else if (stops.length) {
    map.panTo([stops[0].latitude, stops[0].longitude]);
  }
}

// ── Render stops in sidebar ────────────────────────────────
function renderStopList(stops) {
  const section = document.getElementById('route-section');
  const ol      = document.getElementById('stop-list');
  section.style.display = 'block';
  ol.innerHTML = '';
  stops.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'stop-item' + (i === 0 ? ' next' : '');
    li.dataset.stopId = s.id;
    li.style.cursor = 'pointer';
    li.innerHTML = `
      <span>${s.name}</span>
      <span class="stop-eta" id="eta-stop-${s.id}">–</span>
    `;
    li.addEventListener('click', () => {
      map.flyTo([s.latitude, s.longitude], 17);
      const marker = stopMarkers[s.id];
      if (marker) marker.openPopup();
    });
    ol.appendChild(li);
  });
}

// ── Render stop markers on map ─────────────────────────────
function renderStopMarkers(stops) {
  stops.forEach((s, i) => {
    const isNext = i === 0;
    const icon = createStopIcon(isNext);
    const marker = L.marker([s.latitude, s.longitude], { icon })
      .addTo(map)
      .bindPopup(`<b>${s.name}</b><br>Stop #${s.stop_order}`);
    stopMarkers[s.id] = marker;
  });
}

function createStopIcon(isNext, isPassed = false) {
  let color = 'var(--surface2)';
  let border = 'var(--border)';
  if (isNext) {
    color = 'var(--amber)';
    border = '#fff';
  } else if (isPassed) {
    color = 'rgba(255,255,255,0.1)';
    border = 'rgba(255,255,255,0.1)';
  }

  return L.divIcon({
    className: '',
    html: `<div style="
      background:${color};
      border:2px solid ${border};
      width:12px;height:12px;border-radius:50%;
      box-shadow:${isNext ? '0 2px 8px var(--amber)' : '0 2px 6px rgba(0,0,0,.4)'};
      opacity:${isPassed ? 0.5 : 1}
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });
}

// ── Render road-following route ───────────────────────────
function renderRoadRoute(stops, currentPos = null) {
  if (!stops || stops.length === 0) return;

  // 1. Manage Static Full Route
  if (!staticPolyline) {
    const latlngs = stops.map(s => [s.latitude, s.longitude]);
    staticPolyline = L.polyline(latlngs, {
      color: '#f5a623',
      weight: 6,
      opacity: 0.3,
      dashArray: '5, 10'
    }).addTo(map);
  }

  // 2. Manage Dynamic Segment
  let waypoints = [];
  if (currentPos) {
    waypoints.push(L.latLng(currentPos.lat, currentPos.lng));
    waypoints.push(L.latLng(stops[0].latitude, stops[0].longitude));
  } else {
    stops.forEach(s => waypoints.push(L.latLng(s.latitude, s.longitude)));
  }

  if (waypoints.length < 2) return;

  if (routeLine) {
    routeLine.setWaypoints(waypoints);
  } else {
    routeLine = L.Routing.control({
      waypoints: waypoints,
      router: L.Routing.osrmv1({
        serviceUrl: 'https://router.project-osrm.org/route/v1'
      }),
      routeWhileDragging: false,
      addWaypoints: false,
      draggableWaypoints: false,
      fitSelectedRoutes: false,
      showAlternatives: false,
      lineOptions: {
        styles: [{ color: '#f5a623', opacity: 0.8, weight: 6 }]
      },
      createMarker: function() { return null; }
    }).addTo(map);

    routeLine.on('routesfound', function(e) {
      const routes = e.routes;
      if (routes && routes.length > 0 && routes[0].instructions.length > 0) {
        const instr = routes[0].instructions[0];
        updateInstruction(instr);
      }
    });

    routeLine.hide();
  }
}

function updateInstruction(instr) {
  const box = document.getElementById('nav-instruction-box');
  const icon = document.getElementById('nav-icon');
  const text = document.getElementById('nav-text');

  if (!instr && !selectedBus) {
    box.style.display = 'none';
    return;
  }

  box.style.display = 'flex';
  if (instr) {
    text.textContent = instr.text || 'Continue on path';
    const type = instr.type?.toLowerCase() || '';
    if (type.includes('left')) icon.textContent = '↰';
    else if (type.includes('right')) icon.textContent = '↱';
    else if (type.includes('straight')) icon.textContent = '↑';
    else if (type.includes('destination') || type.includes('waypoint')) icon.textContent = '📍';
    else if (type.includes('roundabout')) icon.textContent = '🔄';
    else icon.textContent = '↑';
  } else {
    text.textContent = 'Calculating route...';
    icon.textContent = '🚌';
  }
}

// ── Update/create bus marker on map ───────────────────────
function updateBusMarker(data) {
  const bus = buses.find(b => b.id === data.bus_id);
  const label = bus ? bus.name : `Bus ${data.bus_id}`;

  const icon = L.divIcon({
    className: '',
    html: `<div style="
      background:var(--amber);
      border:3px solid #fff;
      border-radius:50% 50% 50% 0;
      width:32px;height:32px;
      transform:rotate(-45deg);
      box-shadow:0 3px 12px rgba(0,0,0,.5);
      display:flex;align-items:center;justify-content:center;
    "><span style="transform:rotate(45deg);font-size:14px">🚌</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32]
  });

  if (busMarkers[data.bus_id]) {
    busMarkers[data.bus_id].setLatLng([data.latitude, data.longitude]);
  } else {
    busMarkers[data.bus_id] = L.marker([data.latitude, data.longitude], { icon })
      .addTo(map)
      .bindPopup(`<b>${label}</b><br>Last seen: ${new Date(data.timestamp).toLocaleTimeString()}`);
  }

  busMarkers[data.bus_id]
    .getPopup()
    ?.setContent(`<b>${label}</b><br>Last seen: ${new Date(data.timestamp).toLocaleTimeString()}`);
}

function removeMarker(busId) {
  if (busMarkers[busId]) {
    busMarkers[busId].remove();
    delete busMarkers[busId];
  }
}

// ── Update ETA in sidebar and stop list ──────────────────
function updateSidebarETA(stops) {
  const etaSection = document.getElementById('eta-section');
  if (!stops || stops.length === 0) { 
    etaSection.style.display = 'none'; 
    return; 
  }

  etaSection.style.display = 'block';
  const next = stops[0];
  const mins = next.eta_minutes ?? '–';
  const arrivalTime = formatArrivalTime(next.eta_minutes);

  document.getElementById('eta-value').textContent     = mins;
  document.getElementById('eta-arrival').textContent   = `Arrival: ${arrivalTime}`;
  document.getElementById('eta-stop-name').textContent = next.name;

  const navMins = document.getElementById('nav-eta-mins');
  const navArrival = document.getElementById('nav-eta-arrival');
  const navStop = document.getElementById('nav-next-stop');
  
  if (navMins) navMins.textContent = mins !== '–' ? `${mins} min` : '–';
  if (navArrival) navArrival.textContent = mins !== '–' ? `Arr: ${arrivalTime}` : '--:--';
  if (navStop) navStop.textContent = `Heading to: ${next.name}`;
}

function updateStopETAs(stops) {
  if (!stops) return;

  document.querySelectorAll('.stop-item').forEach(el => el.classList.remove('next', 'passed'));
  Object.keys(stopMarkers).forEach(id => {
    stopMarkers[id].setIcon(createStopIcon(false));
  });

  const upcomingIds = stops.map(s => s.id);
  const nextStopId = stops.length > 0 ? stops[0].id : null;

  document.querySelectorAll('.stop-item').forEach(el => {
    const id = parseInt(el.dataset.stopId);
    if (id === nextStopId) {
      el.classList.add('next');
      if (stopMarkers[id]) stopMarkers[id].setIcon(createStopIcon(true));
    } else if (!upcomingIds.includes(id)) {
      el.classList.add('passed');
      if (stopMarkers[id]) stopMarkers[id].setIcon(createStopIcon(false, true));
    }
  });

  stops.forEach(s => {
    const el = document.getElementById(`eta-stop-${s.id}`);
    if (el) {
      const timeStr = formatArrivalTime(s.eta_minutes);
      el.textContent = s.eta_minutes != null ? `${s.eta_minutes}m (${timeStr})` : '–';
    }
  });
}

function formatArrivalTime(minutes) {
  if (minutes == null) return '–';
  const now = new Date();
  const arrival = new Date(now.getTime() + minutes * 60000);
  return arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Feed ───────────────────────────────────────────────────
function addFeedItem(text, type = '') {
  const ul = document.getElementById('feed-list');
  ul.querySelectorAll('.muted').forEach(e => e.remove());

  const li = document.createElement('li');
  li.className = `feed-item ${type}`;
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  li.textContent = `[${now}] ${text}`;
  ul.insertBefore(li, ul.firstChild);

  while (ul.children.length > feedLimit) ul.lastChild.remove();
}

// ── Connection status ──────────────────────────────────────
function setConnStatus(connected) {
  const dot   = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  dot.className   = `dot ${connected ? 'connected' : 'disconnected'}`;
  label.textContent = connected ? 'Live' : 'Disconnected';
}

// ── Helpers ────────────────────────────────────────────────
function getBusName(busId) {
  return buses.find(b => b.id === busId)?.name ?? `#${busId}`;
}

// ── Boot ───────────────────────────────────────────────────
async function boot() {
  await fetchBuses();
  await fetchLiveBuses();
}

boot();

setInterval(fetchBuses, 30_000);

async function fetchLiveBuses() {
  try {
    const res = await fetch('/api/live');
    const liveData = await res.json();
    liveData.forEach(data => {
      if (data.latitude && data.longitude) {
        updateBusMarker({
          ...data,
          bus_id: data.id
        });
      }
    });
  } catch (err) {
    console.error('Error fetching live buses:', err);
  }
}
