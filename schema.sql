-- Campus Bus Tracker – SQLite Schema
-- Run once on first launch (handled automatically by app.py)

PRAGMA foreign_keys = ON;

-- ─── Buses ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    number_plate  TEXT    NOT NULL UNIQUE,
    capacity      INTEGER DEFAULT 40,
    status        TEXT    DEFAULT 'offline',   -- 'active' | 'offline'
    route_id      INTEGER REFERENCES routes(id) ON DELETE SET NULL,
    created_at    TEXT    DEFAULT (datetime('now'))
);

-- ─── Routes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS routes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT    DEFAULT '',
    created_at  TEXT    DEFAULT (datetime('now'))
);

-- ─── Stops ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stops (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id    INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    latitude    REAL    NOT NULL,
    longitude   REAL    NOT NULL,
    stop_order  INTEGER DEFAULT 0,
    UNIQUE(route_id, name, stop_order)
);

-- ─── Trips (live session per bus) ────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    bus_id     INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    start_time TEXT    NOT NULL,
    end_time   TEXT,                  -- NULL while trip is active
    latitude   REAL,                  -- last known position
    longitude  REAL,
    timestamp  TEXT,                  -- time of last GPS ping
    last_reached_stop_order INTEGER DEFAULT 0
);

-- ─── Sample data ─────────────────────────────────────────────

-- Routes
INSERT OR IGNORE INTO routes (id, name, description) VALUES
(1, 'Route A – Main Gate Loop',   'Main gate → Library → Hostel → Canteen → Main gate'),
(2, 'Route B – Sports Complex',   'Admin block → Labs → Sports complex → Back gate'),
(3, 'Route C – City Express',     'Campus → Railway station (morning & evening)');

-- Stops for Route A  (NIE North Campus internal - Adjusted to user exact coords)
INSERT OR IGNORE INTO stops (id, route_id, name, latitude, longitude, stop_order) VALUES
(1, 1, 'NIE North Main Gate',    12.372115, 76.584975, 1),
(2, 1, 'Admin Block',           12.372500, 76.585500, 2),
(3, 1, 'Academic Block 1',      12.373500, 76.586000, 3),
(4, 1, 'Campus Canteen',        12.373000, 76.587000, 4),
(5, 1, 'Hostel Block',          12.374500, 76.587500, 5);

-- Stops for Route B (Hootagalli to Campus)
INSERT OR IGNORE INTO stops (id, route_id, name, latitude, longitude, stop_order) VALUES
(6, 2, 'Hootagalli Circle',     12.3400, 76.5900, 1),
(7, 2, 'BEML Circle',           12.3415, 76.5850, 2),
(8, 2, 'NIE North Main Gate',   12.372115, 76.584975, 3);

-- Stops for Route C (Railway Station to Campus)
INSERT OR IGNORE INTO stops (id, route_id, name, latitude, longitude, stop_order) VALUES
(9, 3, 'Mysuru Railway Station', 12.3160, 76.6465, 1),
(10, 3, 'V.V. Puram',            12.3250, 76.6200, 2),
(11, 3, 'NIE North Main Gate',   12.372115, 76.584975, 3);

-- Buses
INSERT OR IGNORE INTO buses (id, name, number_plate, capacity, status, route_id) VALUES
(1, 'Bus Alpha',   'KA-01-AB-1234', 52, 'offline', 1),
(2, 'Bus Beta',    'KA-01-CD-5678', 40, 'offline', 2),
(3, 'Bus Gamma',   'KA-01-EF-9012', 40, 'offline', 3);

-- ─── Users ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    NOT NULL UNIQUE,
    password    TEXT    NOT NULL,                  -- will be hashed
    role        TEXT    NOT NULL,                  -- 'student' | 'driver' | 'admin'
    created_at  TEXT    DEFAULT (datetime('now'))
);
