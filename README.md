# 🚌 Campus BusTrack — Real-Time Bus Tracking Web App

A lightweight, real-time bus tracking system for college campuses built with Flask, SQLite, Leaflet.js, and WebSockets.

---

## 📁 Project Structure

```
bus-tracker/
├── app.py                  # Flask backend (REST API + WebSocket events)
├── schema.sql              # SQLite schema + sample data
├── requirements.txt        # Python dependencies
├── bus_tracker.db          # SQLite DB (auto-created on first run)
│
├── templates/
│   ├── student.html        # 🎓 Student live map page
│   ├── driver.html         # 🧑‍✈️ Driver GPS control panel
│   └── admin.html          # 🧑‍💼 Admin management panel
│
└── static/
    ├── css/
    │   ├── student.css
    │   ├── driver.css
    │   └── admin.css
    └── js/
        ├── student.js      # Map rendering + WebSocket listener
        ├── driver.js       # GPS capture + WebSocket emitter
        └── admin.js        # CRUD management
```

---

## ⚙️ Tech Stack

| Layer      | Technology                  |
|------------|-----------------------------|
| Frontend   | HTML5, CSS3, Vanilla JS     |
| Map        | Leaflet.js + OpenStreetMap  |
| Backend    | Python 3 + Flask            |
| Real-Time  | Flask-SocketIO (WebSockets) |
| Database   | SQLite 3                    |

---

## 🚀 Setup Instructions

### Step 1 — Clone / download the project
```bash
# If using git:
git clone <repo-url>
cd bus-tracker

# Or just copy the folder and navigate into it
cd bus-tracker
```

### Step 2 — Create a Python virtual environment
```bash
python3 -m venv venv

# Activate it:
# macOS / Linux:
source venv/bin/activate

# Windows:
venv\Scripts\activate
```

### Step 3 — Install dependencies
```bash
pip install -r requirements.txt
```

### Step 4 — Configure secrets
```bash
copy .env.example .env
```

Generate a `SECRET_KEY` with:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Put the generated key in `.env`, and set `ADMIN_USERNAME` and `ADMIN_PASSWORD` there before the first run. The admin is seeded only when both admin variables are set and the users table is empty.

### Step 5 — Run the app
```bash
python app.py
```

You should see:
```
✅ Database initialised.
 * Running on http://0.0.0.0:5000
```

> The SQLite database (`bus_tracker.db`) and sample data are created **automatically** on first run.

### Step 5 — Open the pages

| Role    | URL                          |
|---------|------------------------------|
| Student | http://localhost:5000/student |
| Driver  | http://localhost:5000/driver  |
| Admin   | http://localhost:5000/admin   |

---

## 🗺️ Configuring Your Campus Map

The default map centre is set to **Bengaluru (12.9716, 77.5946)**.

To change it to your campus:

1. Open `static/js/student.js`
2. Find this line near the top:
   ```js
   center: [12.9716, 77.5946],  // Default: Bengaluru
   ```
3. Replace with your campus latitude/longitude.
4. Update the stop coordinates in `schema.sql` (or via the Admin panel after setup).

**How to find coordinates:**
- Open Google Maps → right-click on a location → "What's here?" → copy the coordinates shown at the bottom.

---

## 🔁 System Flow

```
Driver (phone/laptop)
   │
   ├── Opens driver.html
   ├── Selects bus → clicks "Start Trip"
   ├── Browser captures GPS via Geolocation API
   └── Emits `location_update` WebSocket event every 7 seconds
            │
            ▼
      Flask-SocketIO Server (app.py)
            │
            ├── Saves lat/lon to SQLite (trips table)
            ├── Calculates ETA to each stop (Haversine formula)
            └── Broadcasts `location_update` to ALL connected students
                        │
                        ▼
            Student (student.html)
                        │
                        ├── Receives WebSocket update
                        ├── Moves bus marker on Leaflet map
                        ├── Updates ETA display in sidebar
                        └── Appends live feed entry
```

---

## 📡 WebSocket Events Reference

| Event             | Direction         | Payload                                      |
|-------------------|-------------------|----------------------------------------------|
| `start_trip`      | Driver → Server   | `{ bus_id }`                                 |
| `stop_trip`       | Driver → Server   | `{ bus_id }`                                 |
| `location_update` | Driver → Server   | `{ bus_id, latitude, longitude }`            |
| `location_update` | Server → Students | `{ bus_id, latitude, longitude, timestamp, stops[] }` |
| `trip_started`    | Server → All      | `{ bus_id }`                                 |
| `trip_stopped`    | Server → All      | `{ bus_id }`                                 |

---

## 🌐 REST API Reference

### Buses
| Method | Endpoint           | Description       |
|--------|--------------------|-------------------|
| GET    | `/api/buses`       | List all buses    |
| POST   | `/api/buses`       | Add a new bus     |
| PUT    | `/api/buses/<id>`  | Update a bus      |
| DELETE | `/api/buses/<id>`  | Delete a bus      |

### Routes
| Method | Endpoint            | Description        |
|--------|---------------------|--------------------|
| GET    | `/api/routes`       | List all routes    |
| POST   | `/api/routes`       | Add a route        |
| PUT    | `/api/routes/<id>`  | Update a route     |
| DELETE | `/api/routes/<id>`  | Delete a route     |

### Stops
| Method | Endpoint                         | Description                     |
|--------|----------------------------------|---------------------------------|
| GET    | `/api/stops`                     | All stops                       |
| GET    | `/api/stops?route_id=1`          | Stops for a specific route      |
| POST   | `/api/stops`                     | Add a stop                      |
| DELETE | `/api/stops/<id>`                | Delete a stop                   |

### Utility
| Method | Endpoint                               | Description                   |
|--------|----------------------------------------|-------------------------------|
| POST   | `/api/assign`                          | Assign bus to route           |
| GET    | `/api/live`                            | All currently active buses    |
| GET    | `/api/eta?bus_id=1&stop_id=2`          | ETA from bus to a stop        |

---

## 🧮 ETA Calculation

Uses the **Haversine formula** to calculate great-circle distance between two GPS coordinates, then applies:

```
ETA (minutes) = (distance_km / average_speed_kmh) × 60
```

Default average speed: **20 km/h** (configurable in `app.py`).

---

## 🗄️ Database Schema

```
buses
  id, name, number_plate, capacity, status, route_id, created_at

routes
  id, name, description, created_at

stops
  id, route_id, name, latitude, longitude, stop_order

trips
  id, bus_id, start_time, end_time, latitude, longitude, timestamp
```

---

## 🧪 Testing with Sample Data

The database is pre-loaded with:
- **3 Routes** (Route A, B, C)
- **12 Stops** across the 3 routes
- **3 Buses** (Bus Alpha, Beta, Gamma)

To test the full flow:
1. Open Admin → Assign Tab → assign Bus Alpha to Route A.
2. Open Driver page → select Bus Alpha → click **Start Trip**.
   - Allow location access when prompted.
3. Open Student page in another tab → click on Bus Alpha in the sidebar.
4. Watch the marker move on the map in real time!

---

## 🔒 Production Notes

Before deploying for real use:
- Set `SECRET_KEY` to a long random string (use `os.environ.get(...)`)
- Run with a production WSGI server: `gunicorn -k eventlet -w 1 app:app`
- Add authentication (student/driver login) for security
- Use HTTPS for geolocation to work on mobile browsers (required by browsers)
- Consider PostgreSQL for multi-server deployments

---

## 📱 Mobile Usage

- **Driver page** works on any smartphone browser with GPS.
- HTTPS is **required** for the Geolocation API on most mobile browsers.
- For local testing on a phone, use `ngrok` to expose your local server over HTTPS:
  ```bash
  ngrok http 5000
  ```

---

## 🛠️ Common Issues

| Issue | Fix |
|-------|-----|
| GPS not working on driver page | Use HTTPS or localhost only |
| Map not loading | Check internet connection (Leaflet uses OpenStreetMap CDN) |
| WebSocket not connecting | Ensure Flask-SocketIO is installed and app.py is running |
| `ModuleNotFoundError` | Run `pip install -r requirements.txt` with venv activated |
| Database errors | Delete `bus_tracker.db` and restart — it will recreate |
