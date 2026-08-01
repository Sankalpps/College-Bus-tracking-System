from flask import Flask, render_template, request, jsonify, session, redirect, url_for, flash
from flask_socketio import SocketIO, emit
import sqlite3
import math
import os
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import traceback

app = Flask(__name__)
app.config['SECRET_KEY'] = 'campus-bus-tracker-secret'
socketio = SocketIO(app, cors_allowed_origins="*")

# ─────────────────────────────────────────────
# Authentication Guard Decorator
# ─────────────────────────────────────────────

def login_required(role=None):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user_id' not in session:
                if request.path.startswith('/api/'):
                    return jsonify({'error': 'Unauthorized'}), 401
                if request.path == '/admin':
                    return redirect(url_for('login_page', role='admin'))
                elif request.path == '/driver':
                    return redirect(url_for('login_page', role='driver'))
                elif request.path == '/student':
                    return redirect(url_for('login_page', role='student'))
                return redirect(url_for('portal'))
            
            user_role = session.get('role')
            if role:
                if role == 'student' and user_role == 'admin':
                    # Admin can view student live map
                    pass
                elif user_role != role:
                    if request.path.startswith('/api/'):
                        return jsonify({'error': 'Forbidden'}), 403
                    if role == 'admin':
                        return redirect(url_for('login_page', role='admin'))
                    elif role == 'driver':
                        return redirect(url_for('login_page', role='driver'))
                    elif role == 'student':
                        return redirect(url_for('login_page', role='student'))
                    return redirect(url_for('portal'))
            return f(*args, **kwargs)
        return decorated_function
    return decorator

DB_PATH = 'bus_tracker.db'

# ─────────────────────────────────────────────
# Database helpers
# ─────────────────────────────────────────────

def get_db():
    global DB_PATH
    if 'VERCEL' in os.environ:
        import tempfile
        DB_PATH = os.path.join(tempfile.gettempdir(), 'bus_tracker.db')
        if not os.path.exists(DB_PATH):
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schema.sql')
            with open(schema_path, 'r') as f:
                conn.executescript(f.read())
            
            # Deduplicate stops
            conn.execute("""
                DELETE FROM stops
                WHERE id NOT IN (
                    SELECT MIN(id)
                    FROM stops
                    GROUP BY route_id, name, stop_order
                )
            """)
            
            # Seed default users
            default_users = [
                ('admin', generate_password_hash('admin123'), 'admin'),
                ('driver1', generate_password_hash('driver123'), 'driver'),
                ('student1', generate_password_hash('student123'), 'student')
            ]
            conn.executemany(
                'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
                default_users
            )
            conn.commit()
            print("[OK] Vercel Database initialized.")
            return conn

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schema.sql')
        with open(schema_path, 'r') as f:
            conn.executescript(f.read())
        
        # Deduplicate stops (cleanup for previously duplicated sample data)
        conn.execute("""
            DELETE FROM stops
            WHERE id NOT IN (
                SELECT MIN(id)
                FROM stops
                GROUP BY route_id, name, stop_order
            )
        """)
        
        # Migration: Add last_reached_stop_order to trips if it doesn't exist
        try:
            conn.execute('ALTER TABLE trips ADD COLUMN last_reached_stop_order INTEGER DEFAULT 0')
        except sqlite3.OperationalError:
            pass # Already exists

        # Seed default users if users table is empty
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM users")
        if cursor.fetchone()[0] == 0:
            default_users = [
                ('admin', generate_password_hash('admin123'), 'admin'),
                ('driver1', generate_password_hash('driver123'), 'driver'),
                ('student1', generate_password_hash('student123'), 'student')
            ]
            conn.executemany(
                'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
                default_users
            )
            print("[OK] Default users seeded.")
    print("[OK] Database initialised.")

# ─────────────────────────────────────────────
# Haversine distance (km)
# ─────────────────────────────────────────────

def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def eta_minutes(distance_km, avg_speed_kmh=20):
    if avg_speed_kmh == 0:
        return None
    return round((distance_km / avg_speed_kmh) * 60, 1)

# ─────────────────────────────────────────────
# Page routes
# ─────────────────────────────────────────────

@app.route('/')
def portal():
    if 'user_id' in session:
        role = session.get('role')
        if role == 'admin':
            return redirect(url_for('admin'))
        elif role == 'driver':
            return redirect(url_for('driver'))
        elif role == 'student':
            return redirect(url_for('student'))
    return render_template('portal.html')

@app.route('/login/<role>', methods=['GET'])
def login_page(role):
    if role not in ['student', 'driver', 'admin']:
        return redirect(url_for('portal'))
    return render_template('login.html', role=role)

@app.route('/login', methods=['POST'])
def do_login():
    username = request.form.get('username', '').strip()
    password = request.form.get('password', '')
    role = request.form.get('role', '')
    
    if not username or not password or not role:
        flash("Username and password are required.", "error")
        return redirect(url_for('login_page', role=role or 'student'))
    
    with get_db() as conn:
        user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    
    if user and check_password_hash(user['password'], password):
        if user['role'] != role:
            flash(f"Invalid credentials for {role.capitalize()} portal.", "error")
            return redirect(url_for('login_page', role=role))
        
        session['user_id'] = user['id']
        session['username'] = user['username']
        session['role'] = user['role']
        
        if role == 'admin':
            return redirect(url_for('admin'))
        elif role == 'driver':
            return redirect(url_for('driver'))
        else:
            return redirect(url_for('student'))
    else:
        flash("Invalid username or password.", "error")
        return redirect(url_for('login_page', role=role))

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('portal'))

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        confirm_password = request.form.get('confirm_password', '')
        role = 'student'
        
        if not username or not password:
            flash("Username and password are required.", "error")
            return render_template('register.html')
            
        if password != confirm_password:
            flash("Passwords do not match.", "error")
            return render_template('register.html')
            
        with get_db() as conn:
            existing = conn.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone()
            if existing:
                flash("Username already exists.", "error")
                return render_template('register.html')
            
            conn.execute(
                'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
                (username, generate_password_hash(password), role)
            )
            
        flash("Registration successful! Please log in.", "success")
        return redirect(url_for('login_page', role='student'))
        
    return render_template('register.html')

@app.route('/student')
@login_required('student')
def student():
    return render_template('student.html')

@app.route('/driver')
@login_required('driver')
def driver():
    return render_template('driver.html')

@app.route('/admin')
@login_required('admin')
def admin():
    return render_template('admin.html')

# ─────────────────────────────────────────────
# REST API – Buses
# ─────────────────────────────────────────────

@app.route('/api/buses', methods=['GET'])
@login_required()
def get_buses():
    with get_db() as conn:
        buses = conn.execute('SELECT * FROM buses').fetchall()
    return jsonify([dict(b) for b in buses])

@app.route('/api/buses', methods=['POST'])
@login_required('admin')
def add_bus():
    data = request.get_json()
    with get_db() as conn:
        conn.execute(
            'INSERT INTO buses (name, number_plate, capacity, status) VALUES (?,?,?,?)',
            (data['name'], data['number_plate'], data.get('capacity', 40), 'offline')
        )
    return jsonify({'message': 'Bus added'}), 201

@app.route('/api/buses/<int:bus_id>', methods=['PUT'])
@login_required('admin')
def update_bus(bus_id):
    data = request.get_json()
    with get_db() as conn:
        conn.execute(
            'UPDATE buses SET name=?, number_plate=?, capacity=? WHERE id=?',
            (data['name'], data['number_plate'], data.get('capacity', 40), bus_id)
        )
    return jsonify({'message': 'Bus updated'})

@app.route('/api/buses/<int:bus_id>', methods=['DELETE'])
@login_required('admin')
def delete_bus(bus_id):
    with get_db() as conn:
        conn.execute('DELETE FROM buses WHERE id=?', (bus_id,))
    return jsonify({'message': 'Bus deleted'})

# ─────────────────────────────────────────────
# REST API – Routes
# ─────────────────────────────────────────────

@app.route('/api/routes', methods=['GET'])
@login_required()
def get_routes():
    with get_db() as conn:
        routes = conn.execute('SELECT * FROM routes').fetchall()
    return jsonify([dict(r) for r in routes])

@app.route('/api/routes', methods=['POST'])
@login_required('admin')
def add_route():
    data = request.get_json()
    with get_db() as conn:
        conn.execute(
            'INSERT INTO routes (name, description) VALUES (?,?)',
            (data['name'], data.get('description', ''))
        )
    return jsonify({'message': 'Route added'}), 201

@app.route('/api/routes/<int:route_id>', methods=['PUT'])
@login_required('admin')
def update_route(route_id):
    data = request.get_json()
    with get_db() as conn:
        conn.execute(
            'UPDATE routes SET name=?, description=? WHERE id=?',
            (data['name'], data.get('description', ''), route_id)
        )
    return jsonify({'message': 'Route updated'})

@app.route('/api/routes/<int:route_id>', methods=['DELETE'])
@login_required('admin')
def delete_route(route_id):
    with get_db() as conn:
        conn.execute('DELETE FROM routes WHERE id=?', (route_id,))
        conn.execute('DELETE FROM stops WHERE route_id=?', (route_id,))
    return jsonify({'message': 'Route deleted'})

# ─────────────────────────────────────────────
# REST API – Stops
# ─────────────────────────────────────────────

@app.route('/api/stops', methods=['GET'])
@login_required()
def get_stops():
    route_id = request.args.get('route_id')
    with get_db() as conn:
        if route_id:
            stops = conn.execute(
                'SELECT * FROM stops WHERE route_id=? ORDER BY stop_order',
                (route_id,)
            ).fetchall()
        else:
            stops = conn.execute('SELECT * FROM stops ORDER BY route_id, stop_order').fetchall()
    return jsonify([dict(s) for s in stops])

@app.route('/api/stops', methods=['POST'])
@login_required('admin')
def add_stop():
    data = request.get_json()
    with get_db() as conn:
        conn.execute(
            'INSERT INTO stops (route_id, name, latitude, longitude, stop_order) VALUES (?,?,?,?,?)',
            (data['route_id'], data['name'], data['latitude'], data['longitude'], data.get('stop_order', 0))
        )
    return jsonify({'message': 'Stop added'}), 201

@app.route('/api/stops/<int:stop_id>', methods=['DELETE'])
@login_required('admin')
def delete_stop(stop_id):
    with get_db() as conn:
        conn.execute('DELETE FROM stops WHERE id=?', (stop_id,))
    return jsonify({'message': 'Stop deleted'})

# ─────────────────────────────────────────────
# REST API – Assignments & Live data
# ─────────────────────────────────────────────

@app.route('/api/assign', methods=['POST'])
@login_required('admin')
def assign_bus_route():
    data = request.get_json()
    with get_db() as conn:
        conn.execute(
            'UPDATE buses SET route_id=? WHERE id=?',
            (data['route_id'], data['bus_id'])
        )
    return jsonify({'message': 'Assigned'})

@app.route('/api/live', methods=['GET'])
@login_required()
def get_live_buses():
    """Return all active buses with their last known positions."""
    with get_db() as conn:
        buses = conn.execute(
            '''SELECT b.id, b.name, b.number_plate, b.status, b.route_id,
                      r.name as route_name,
                      t.latitude, t.longitude, t.timestamp
               FROM buses b
               LEFT JOIN routes r ON b.route_id = r.id
               LEFT JOIN trips t ON t.bus_id = b.id AND t.end_time IS NULL
               WHERE b.status = "active"'''
        ).fetchall()
    return jsonify([dict(b) for b in buses])

@app.route('/api/eta', methods=['GET'])
@login_required()
def get_eta():
    """Calculate ETA from bus current position to a stop."""
    bus_id   = request.args.get('bus_id', type=int)
    stop_id  = request.args.get('stop_id', type=int)
    with get_db() as conn:
        trip = conn.execute(
            'SELECT latitude, longitude FROM trips WHERE bus_id=? AND end_time IS NULL',
            (bus_id,)
        ).fetchone()
        stop = conn.execute('SELECT latitude, longitude FROM stops WHERE id=?', (stop_id,)).fetchone()

    if not trip or not stop or trip['latitude'] is None:
        return jsonify({'eta': None, 'message': 'Bus not active or no position data'})

    dist = haversine(trip['latitude'], trip['longitude'], stop['latitude'], stop['longitude'])
    eta  = eta_minutes(dist)
    return jsonify({'eta': eta, 'distance_km': round(dist, 2)})

# ─────────────────────────────────────────────
# REST API – Users (Admin only)
# ─────────────────────────────────────────────

@app.route('/api/users', methods=['GET'])
@login_required('admin')
def get_users():
    with get_db() as conn:
        users = conn.execute('SELECT id, username, role, created_at FROM users').fetchall()
    return jsonify([dict(u) for u in users])

@app.route('/api/users', methods=['POST'])
@login_required('admin')
def add_user():
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    role = data.get('role', 'student')
    
    if not username or not password or role not in ['student', 'driver', 'admin']:
        return jsonify({'error': 'Invalid user data'}), 400
    
    with get_db() as conn:
        existing = conn.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone()
        if existing:
            return jsonify({'error': 'Username already exists'}), 400
        
        conn.execute(
            'INSERT INTO users (username, password, role) VALUES (?,?,?)',
            (username, generate_password_hash(password), role)
        )
    return jsonify({'message': 'User added'}), 201

@app.route('/api/users/<int:user_id>', methods=['DELETE'])
@login_required('admin')
def delete_user(user_id):
    if session.get('user_id') == user_id:
        return jsonify({'error': 'You cannot delete yourself'}), 400
    with get_db() as conn:
        conn.execute('DELETE FROM users WHERE id=?', (user_id,))
    return jsonify({'message': 'User deleted'})

# ─────────────────────────────────────────────
# WebSocket events
# ─────────────────────────────────────────────

@socketio.on('connect')
def on_connect():
    print(f"Client connected: {request.sid}")

@socketio.on('disconnect')
def on_disconnect():
    print(f"Client disconnected: {request.sid}")

@socketio.on('start_trip')
def handle_start_trip(data):
    """Driver starts a trip. Creates a trip record."""
    try:
        if session.get('role') != 'driver':
            print("[ERROR] Unauthorized start_trip socket attempt.")
            emit('server_error', {'error': 'unauthorized'}, room=request.sid)
            return

        bus_id = data.get('bus_id')
        if not bus_id:
            emit('server_error', {'error': 'missing_bus_id'}, room=request.sid)
            return

        with get_db() as conn:
            # Close any existing open trip for this bus
            conn.execute('UPDATE trips SET end_time=? WHERE bus_id=? AND end_time IS NULL',
                         (datetime.utcnow().isoformat(), bus_id))
            # Try inserting with the newer schema first; fall back if column missing
            try:
                conn.execute('INSERT INTO trips (bus_id, start_time, last_reached_stop_order) VALUES (?,?,0)',
                             (bus_id, datetime.utcnow().isoformat()))
            except sqlite3.OperationalError:
                # Older schema without last_reached_stop_order
                conn.execute('INSERT INTO trips (bus_id, start_time) VALUES (?,?)',
                             (bus_id, datetime.utcnow().isoformat()))

            conn.execute('UPDATE buses SET status="active" WHERE id=?', (bus_id,))

        emit('trip_started', {'bus_id': bus_id}, broadcast=True)
        print(f"[BUS] Trip started for bus {bus_id}")
    except Exception:
        traceback.print_exc()
        emit('server_error', {'error': 'internal_error'}, room=request.sid)

@socketio.on('stop_trip')
def handle_stop_trip(data):
    """Driver ends a trip."""
    try:
        if session.get('role') != 'driver':
            print("[ERROR] Unauthorized stop_trip socket attempt.")
            emit('server_error', {'error': 'unauthorized'}, room=request.sid)
            return
        bus_id = data.get('bus_id')
        if not bus_id:
            emit('server_error', {'error': 'missing_bus_id'}, room=request.sid)
            return

        with get_db() as conn:
            conn.execute('UPDATE trips SET end_time=? WHERE bus_id=? AND end_time IS NULL',
                         (datetime.utcnow().isoformat(), bus_id))
            conn.execute('UPDATE buses SET status="offline" WHERE id=?', (bus_id,))

        emit('trip_stopped', {'bus_id': bus_id}, broadcast=True)
        print(f"[STOP] Trip stopped for bus {bus_id}")
    except Exception:
        traceback.print_exc()
        emit('server_error', {'error': 'internal_error'}, room=request.sid)

@socketio.on('location_update')
def handle_location_update(data):
    """Driver sends GPS coords. We persist and broadcast to all students."""
    try:
        if session.get('role') != 'driver':
            print("[ERROR] Unauthorized location_update socket attempt.")
            emit('server_error', {'error': 'unauthorized'}, room=request.sid)
            return

        bus_id = data.get('bus_id')
        lat    = data.get('latitude')
        lon    = data.get('longitude')
        ts     = datetime.utcnow().isoformat()

        if not bus_id or lat is None or lon is None:
            emit('server_error', {'error': 'invalid_location_payload'}, room=request.sid)
            return

        with get_db() as conn:
            # Get the current active trip
            trip = conn.execute('SELECT id, last_reached_stop_order FROM trips WHERE bus_id=? AND end_time IS NULL', (bus_id,)).fetchone()
            if not trip:
                return

            last_order = trip['last_reached_stop_order'] or 0

            # Update position
            conn.execute(
                'UPDATE trips SET latitude=?, longitude=?, timestamp=? WHERE id=?',
                (lat, lon, ts, trip['id'])
            )
            
            # Fetch route stops
            bus = conn.execute('SELECT route_id FROM buses WHERE id=?', (bus_id,)).fetchone()
            stops = []
            if bus and bus['route_id']:
                raw_stops = conn.execute(
                    'SELECT id, name, latitude, longitude, stop_order FROM stops WHERE route_id=? ORDER BY stop_order',
                    (bus['route_id'],)
                ).fetchall()

                new_last_order = last_order
                for s in raw_stops:
                    # Calculate distance to see if we reached it
                    dist = haversine(lat, lon, s['latitude'], s['longitude'])
                    
                    # If we are within 150m of a stop that is next in sequence, mark it as reached
                    # Use new_last_order + 1 to allow marking multiple stops in one go if they are very close
                    if dist < 0.15 and s['stop_order'] == new_last_order + 1:
                        new_last_order = s['stop_order']
                    
                    # Only include upcoming stops in the payload
                    if s['stop_order'] > new_last_order:
                        stops.append({
                            'id': s['id'],
                            'name': s['name'],
                            'latitude': s['latitude'],
                            'longitude': s['longitude'],
                            'stop_order': s['stop_order'],
                            'eta_minutes': eta_minutes(dist)
                        })
                
                if new_last_order != last_order:
                    try:
                        conn.execute('UPDATE trips SET last_reached_stop_order=? WHERE id=?', (new_last_order, trip['id']))
                    except sqlite3.OperationalError:
                        # Older schema may not have this column; ignore
                        pass

        payload = {
            'bus_id': bus_id,
            'latitude': lat,
            'longitude': lon,
            'timestamp': ts,
            'stops': stops
        }
        emit('location_update', payload, broadcast=True)
    except Exception:
        traceback.print_exc()
        emit('server_error', {'error': 'internal_error'}, room=request.sid)

# ─────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────

if __name__ == '__main__':
    # Always call init_db to ensure schema is up to date (migrations handled inside)
    init_db()
    socketio.run(app, debug=True, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)
