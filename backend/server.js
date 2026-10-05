/**
 * CarTracker — Backend (SINGLE FILE) — FULL & FINAL
 * Real GPS + Person location sharing + Google OAuth + Socket.IO + MongoDB
 * Google credentials are read from environment variables (.env / Render).
 */
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cartracker';
const JWT_SECRET = process.env.JWT_SECRET || 'cartracker-dev-secret-change-me';
const SEED_DEMO_DATA = (process.env.SEED_DEMO_DATA || 'true') === 'true';
const IS_DEV = process.env.NODE_ENV !== 'production';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

/* ================================ MODELS ================================ */
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, default: '', trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['PASSENGER', 'DRIVER', 'ADMIN'], default: 'PASSENGER' },
  avatar: { type: String, default: '' },
  licenseNumber: { type: String, default: '' },
  active: { type: Boolean, default: true },
  lastLogin: { type: Date, default: null },
  resetToken: String, resetExpires: Date, googleId: String,
  locationSharing: { type: Boolean, default: false },
  currentLocation: { type: { type: String, enum: ['Point'] }, coordinates: { type: [Number] } },
  lastLocationUpdate: { type: Date, default: null },
}, { timestamps: true });
userSchema.index({ currentLocation: '2dsphere' });

const busStopSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  location: { type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: { type: [Number], required: true } },
  address: { type: String, default: '' },
  geofenceRadius: { type: Number, default: 100 },
  routes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Route' }],
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
}, { timestamps: true });
busStopSchema.index({ location: '2dsphere' });

const routeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  routeNumber: { type: String, required: true, unique: true },
  startPoint: { type: String, required: true },
  destination: { type: String, required: true },
  geometry: [[Number]],
  stops: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BusStop' }],
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
}, { timestamps: true });

const vehicleSchema = new mongoose.Schema({
  vehicleNumber: { type: String, required: true, unique: true, trim: true },
  licensePlate: { type: String, default: '' },
  type: { type: String, enum: ['BUS', 'MINIBUS', 'CAR'], default: 'BUS' },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', default: null },
  status: { type: String, enum: ['LIVE', 'GPS_DELAYED', 'OFFLINE', 'TRACKING_STOPPED', 'IN_SERVICE'], default: 'OFFLINE' },
  currentLocation: { type: { type: String, enum: ['Point'] }, coordinates: { type: [Number] } },
  speed: { type: Number, default: 0 }, heading: { type: Number, default: 0 }, accuracy: { type: Number, default: null },
  lastUpdated: { type: Date, default: null },
  progressIndex: { type: Number, default: 0 },
  stopEvents: [{ stopId: mongoose.Schema.Types.ObjectId, arrivedAt: Date, departedAt: Date }],
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });
vehicleSchema.index({ currentLocation: '2dsphere' });

const gpsHistorySchema = new mongoose.Schema({
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', index: true },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  latitude: Number, longitude: Number, speed: Number, heading: Number, accuracy: Number,
  source: { type: String, default: 'gps' }, timestamp: { type: Date, default: Date.now },
});
gpsHistorySchema.index({ timestamp: 1, expireAfterSeconds: 60 * 60 * 24 * 7 });

const tripSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
  routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route' },
  startTime: Date, endTime: Date,
  startStop: String, destinationStop: String,
  distanceKm: { type: Number, default: 0 }, completedStops: { type: Number, default: 0 },
  status: { type: String, enum: ['ONGOING', 'COMPLETED'], default: 'ONGOING' },
}, { timestamps: true });

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  audience: { type: String, enum: ['ALL', 'PASSENGERS', 'DRIVERS', 'ADMINS', 'USER'], default: 'ALL' },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', default: null },
  stopId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusStop', default: null },
  title: String, message: String,
  type: { type: String, enum: ['INFO', 'SUCCESS', 'WARNING', 'DANGER'], default: 'INFO' },
  eta: Number, distance: Number, read: { type: Boolean, default: false },
}, { timestamps: true });

const trackingSessionSchema = new mongoose.Schema({
  passengerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', index: true },
  selectedStopId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusStop' },
  startedAt: { type: Date, default: Date.now }, endedAt: Date,
  status: { type: String, enum: ['ACTIVE', 'STOPPED'], default: 'ACTIVE' },
  notificationState: {
    n10: { type: Boolean, default: false }, n5: Boolean, n2: Boolean,
    d1500: { type: Boolean, default: false }, d800: Boolean, d300: Boolean, arrived: Boolean,
    insideZone: { type: Boolean, default: false }, lastZoneCheck: { type: Date, default: null },
  },
}, { timestamps: true });

const personLocationSchema = new mongoose.Schema({
  phone: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  currentLocation: { type: { type: String, enum: ['Point'] }, coordinates: { type: [Number] } },
  isSharing: { type: Boolean, default: false },
  lastUpdate: { type: Date, default: Date.now },
  userAgent: { type: String, default: '' },
}, { timestamps: true });
personLocationSchema.index({ currentLocation: '2dsphere' });
personLocationSchema.index({ lastUpdate: 1 }, { expireAfterSeconds: 60 * 60 });

const auditLogSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId, userName: String,
  action: String, resource: String, resourceId: String, details: String, ip: String,
  category: { type: String, enum: ['AUTH', 'ADMIN', 'SYSTEM', 'SECURITY'], default: 'ADMIN' },
  timestamp: { type: Date, default: Date.now },
});
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ category: 1, timestamp: -1 });

const settingsSchema = new mongoose.Schema({
  systemName: { type: String, default: 'CarTracker' },
  timezone: { type: String, default: 'Africa/Kigali' },
  gpsUpdateIntervalSec: { type: Number, default: 3 },
  delayedAfterSec: { type: Number, default: 20 },
  offlineAfterSec: { type: Number, default: 60 },
  notifyMinutes: { type: [Number], default: [10, 5, 2] },
  notifyDistanceM: { type: [Number], default: [1500, 800, 300, 100] },
  arrivalRadiusM: { type: Number, default: 100 },
  sessionHours: { type: Number, default: 168 },
  passwordMinLength: { type: Number, default: 6 },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const BusStop = mongoose.model('BusStop', busStopSchema);
const Route = mongoose.model('Route', routeSchema);
const Vehicle = mongoose.model('Vehicle', vehicleSchema);
const GPSHistory = mongoose.model('GPSHistory', gpsHistorySchema);
const Trip = mongoose.model('Trip', tripSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const TrackingSession = mongoose.model('TrackingSession', trackingSessionSchema);
const PersonLocation = mongoose.model('PersonLocation', personLocationSchema);
const AuditLog = mongoose.model('AuditLog', auditLogSchema);
const Settings = mongoose.model('Settings', settingsSchema);

/* ================================ HELPERS ================================ */
const aw = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isNum = (v) => typeof v === 'number' && isFinite(v);
const cleanId = (x) => (x && /^[0-9a-fA-F]{24}$/.test(String(x)) ? String(x) : null);

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
async function getSettings() { let s = await Settings.findOne(); if (!s) s = await Settings.create({}); return s; }
function signToken(user, hours) { return jwt.sign({ id: user._id.toString(), role: user.role }, JWT_SECRET, { expiresIn: (hours || 168) + 'h' }); }
function publicUser(u) { return u ? { _id: u._id.toString(), name: u.name, email: u.email, phone: u.phone, role: u.role, avatar: u.avatar, licenseNumber: u.licenseNumber, active: u.active, lastLogin: u.lastLogin, createdAt: u.createdAt } : null; }
async function audit(req, action, resource, resourceId, details, category = 'ADMIN') {
  try { await AuditLog.create({ userId: req.user && req.user.id, userName: req.user && req.user.name, action, resource, resourceId: String(resourceId || ''), details: details || '', ip: req.ip, category }); } catch (e) { /* ignore */ }
}
async function auditSystem(action, resource, resourceId, details, category = 'SYSTEM', userName = 'system') {
  try { await AuditLog.create({ userName, action, resource, resourceId: String(resourceId || ''), details: details || '', category }); } catch (e) { /* ignore */ }
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Session expired. Please log in again.' }); }
}
const role = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission to perform this action.' });
const hits = new Map();
function rateLimit(windowMs = 60000, max = 25) {
  return (req, res, next) => {
    const now = Date.now(); const arr = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    arr.push(now); hits.set(req.ip, arr);
    if (arr.length > max) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    next();
  };
}

const audienceFor = (r) => ({ PASSENGER: 'PASSENGERS', DRIVER: 'DRIVERS', ADMIN: 'ADMINS' }[r] || 'ALL');
const notifFilter = (user) => ({ $or: [{ userId: user.id }, { userId: null, audience: { $in: ['ALL', audienceFor(user.role)] } }] });
async function notifyUser(userId, title, message, type, extra) {
  const n = await Notification.create({ userId, audience: 'USER', title, message, type, ...extra });
  io.to('user:' + userId).to('public').emit('notificationCreated', { userId: userId.toString(), notification: n.toJSON() });
  return n;
}
async function notifyAudience(audience, title, message, type, extra) {
  const n = await Notification.create({ userId: null, audience, title, message, type, ...extra });
  io.to('admins').to('public').emit('notificationCreated', { userId: null, notification: n.toJSON() });
  return n;
}

/* ============================ ETA / GPS ENGINE ============================ */
async function computeEtaInfo(vehicle) {
  if (!vehicle.routeId) return null;
  const routeId = vehicle.routeId._id ? vehicle.routeId._id : vehicle.routeId;
  let route;
  try { route = await Route.findById(routeId).populate('stops'); } catch (e) { return null; }
  if (!route || !route.stops.length) return null;
  const coords = vehicle.currentLocation && vehicle.currentLocation.coordinates;
  if (!coords || coords.length !== 2) return null;
  const [vLng, vLat] = coords;
  const stops = route.stops;
  const idx = Math.min(vehicle.progressIndex || 0, stops.length);
  const speed = vehicle.speed && vehicle.speed > 5 ? vehicle.speed : 30;
  const stopLite = (s) => ({ _id: s._id.toString(), name: s.name, lat: s.location.coordinates[1], lng: s.location.coordinates[0], address: s.address, geofenceRadius: s.geofenceRadius });
  const base = { routeId: route._id.toString(), routeName: route.name, routeNumber: route.routeNumber, from: route.startPoint, to: route.destination, speedUsed: speed };
  if (idx >= stops.length) return { ...base, completed: true, nextStop: null, etaMinutes: null, stops: stops.map((s) => ({ ...stopLite(s), status: 'DEPARTED', etaMinutes: null, departedAt: (vehicle.stopEvents.find((e) => e.stopId && e.stopId.toString() === s._id.toString()) || {}).departedAt || null })) };
  let cum = haversine(vLat, vLng, stops[idx].location.coordinates[1], stops[idx].location.coordinates[0]);
  const entries = [];
  for (let i = 0; i < stops.length; i++) {
    const lite = stopLite(stops[i]);
    if (i < idx) {
      const ev = vehicle.stopEvents.find((e) => e.stopId && e.stopId.toString() === lite._id) || {};
      entries.push({ ...lite, status: 'DEPARTED', etaMinutes: null, departedAt: ev.departedAt || ev.arrivedAt || null });
    } else if (i === idx) entries.push({ ...lite, status: 'NEXT', etaMinutes: Math.max(1, Math.round((cum / speed) * 60)), distanceKm: +cum.toFixed(2) });
    else {
      cum += haversine(stops[i - 1].location.coordinates[1], stops[i - 1].location.coordinates[0], stops[i].location.coordinates[1], stops[i].location.coordinates[0]);
      entries.push({ ...lite, status: i === stops.length - 1 ? 'TERMINUS' : 'UPCOMING', etaMinutes: Math.max(1, Math.round((cum / speed) * 60)), distanceKm: +cum.toFixed(2) });
    }
  }
  const next = entries[idx];
  return { ...base, completed: false, nextStop: { _id: next._id, name: next.name, etaMinutes: next.etaMinutes, distanceKm: next.distanceKm }, etaMinutes: next.etaMinutes, stops: entries };
}

async function checkPassengerNotifications(vehicle, lat, lng, eta) {
  const sessions = await TrackingSession.find({ vehicleId: vehicle._id, status: 'ACTIVE' }).populate('selectedStopId');
  if (!sessions.length) return;
  const s = await getSettings();
  const [t10, t5, t2] = [s.notifyMinutes[0] ?? 10, s.notifyMinutes[1] ?? 5, s.notifyMinutes[2] ?? 2];
  const [m1500, m800, m300] = [(s.notifyDistanceM || [])[0] ?? 1500, (s.notifyDistanceM || [])[1] ?? 800, (s.notifyDistanceM || [])[2] ?? 300];

  for (const sess of sessions) {
    const stop = sess.selectedStopId; if (!stop) continue;
    const dKm = haversine(lat, lng, stop.location.coordinates[1], stop.location.coordinates[0]);
    const dM = dKm * 1000;
    const entry = eta && eta.stops ? eta.stops.find((st) => st._id === stop._id.toString()) : null;
    const etaMin = entry ? entry.etaMinutes : Math.max(1, Math.round((dKm / (vehicle.speed > 5 ? vehicle.speed : 30)) * 60));
    const ns = sess.notificationState;
    const radius = stop.geofenceRadius || s.arrivalRadiusM;
    const fired = [];

    const wasInside = ns.insideZone;
    const isInside = dM <= radius;
    if (isInside && !wasInside) {
      ns.insideZone = true; ns.arrived = true;
      ns.n10 = ns.n5 = ns.n2 = ns.d1500 = ns.d800 = ns.d300 = true;
      fired.push(['SUCCESS', `${vehicle.vehicleNumber} has entered your selected area at ${stop.name}.`, 0, 0]);
      await auditSystem('ZONE_ENTERED', 'vehicle', vehicle._id, vehicle.vehicleNumber + ' entered geofence of ' + stop.name + ' (passenger notified)', 'SYSTEM');
    } else if (!isInside && wasInside) {
      ns.insideZone = false; ns.arrived = false;
    }
    ns.lastZoneCheck = new Date();

    if (!ns.arrived) {
      if (!ns.n2 && etaMin <= t2) { ns.n10 = ns.n5 = ns.n2 = true; fired.push(['WARNING', `${vehicle.vehicleNumber} is almost at ${stop.name}.`, etaMin, dKm]); }
      else if (!ns.n5 && etaMin <= t5) { ns.n10 = ns.n5 = true; fired.push(['INFO', `${vehicle.vehicleNumber} will reach ${stop.name} in approximately ${etaMin} minutes.`, etaMin, dKm]); }
      else if (!ns.n10 && etaMin <= t10) { ns.n10 = true; fired.push(['INFO', `${vehicle.vehicleNumber} is approaching ${stop.name}.`, etaMin, dKm]); }
      if (fired.length === 0) {
        if (!ns.d300 && dM <= m300) { ns.d1500 = ns.d800 = ns.d300 = true; fired.push(['WARNING', `${vehicle.vehicleNumber} is almost here — about ${Math.round(dM)} m from ${stop.name}.`, etaMin, dKm]); }
        else if (!ns.d800 && dM <= m800) { ns.d1500 = ns.d800 = true; fired.push(['INFO', `${vehicle.vehicleNumber} is coming soon — about ${Math.round(dM)} m away.`, etaMin, dKm]); }
        else if (!ns.d1500 && dM <= m1500) { ns.d1500 = true; fired.push(['INFO', `${vehicle.vehicleNumber} is approaching — about ${(dKm).toFixed(1)} km away.`, etaMin, dKm]); }
      }
    }
    for (const f of fired) await notifyUser(sess.passengerId, f[0] === 'SUCCESS' ? 'Bus Alert' : 'Bus approaching', f[1], f[0], { vehicleId: vehicle._id, stopId: stop._id, eta: f[2], distance: +f[3].toFixed(2) });
    if (fired.length || wasInside !== isInside) await sess.save();
  }
}

async function processLocation(vehicleId, data, meta = {}) {
  const vehicle = await Vehicle.findById(vehicleId);
  if (!vehicle) { const e = new Error('Vehicle not found'); e.status = 404; throw e; }
  const latitude = +data.latitude, longitude = +data.longitude;
  if (!isNum(latitude) || !isNum(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) { const e = new Error('Invalid latitude/longitude'); e.status = 400; throw e; }
  const speed = isNum(+data.speed) ? Math.max(0, +data.speed) : vehicle.speed || 0;
  const heading = isNum(+data.heading) ? +data.heading : vehicle.heading || 0;
  vehicle.currentLocation = { type: 'Point', coordinates: [longitude, latitude] };
  vehicle.speed = speed; vehicle.heading = heading;
  vehicle.accuracy = isNum(+data.accuracy) ? +data.accuracy : null;
  vehicle.lastUpdated = new Date();
  if (vehicle.status === 'OFFLINE' || vehicle.status === 'GPS_DELAYED' || vehicle.status === 'TRACKING_STOPPED') vehicle.status = 'LIVE';

  if (vehicle.routeId) {
    try {
      const routeId = vehicle.routeId._id ? vehicle.routeId._id : vehicle.routeId;
      const route = await Route.findById(routeId).populate('stops');
      if (route && route.stops.length) {
        const idx = vehicle.progressIndex || 0;
        if (idx < route.stops.length) {
          const st = route.stops[idx];
          const d = haversine(latitude, longitude, st.location.coordinates[1], st.location.coordinates[0]);
          let ev = vehicle.stopEvents.find((e) => e.stopId && e.stopId.toString() === st._id.toString());
          if (!ev) { ev = { stopId: st._id }; vehicle.stopEvents.push(ev); }
          if (!ev.arrivedAt && d <= 0.12) ev.arrivedAt = new Date();
          if (ev.arrivedAt && !ev.departedAt && (d > 0.25 || idx === route.stops.length - 1)) {
            ev.departedAt = new Date(); vehicle.progressIndex = idx + 1;
            if (idx === route.stops.length - 1) vehicle.status = 'IN_SERVICE';
          }
        }
      }
    } catch (e) { console.error('[processLocation] route error:', e.message); }
  }
  await vehicle.save();
  if (IS_DEV) console.log('[gps]', vehicle.vehicleNumber, latitude.toFixed(5), longitude.toFixed(5), Math.round(speed) + 'km/h via ' + (meta.via || 'gps'));
  await GPSHistory.create({ vehicleId: vehicle._id, driverId: vehicle.driverId, latitude, longitude, speed, heading, accuracy: vehicle.accuracy, source: meta.via || 'gps' });
  const eta = await computeEtaInfo(vehicle);
  await checkPassengerNotifications(vehicle, latitude, longitude, eta);
  const payload = {
    vehicleId: vehicle._id.toString(), vehicleNumber: vehicle.vehicleNumber, vehicleCode: vehicle.vehicleNumber,
    latitude, longitude, speed, heading, accuracy: vehicle.accuracy, status: vehicle.status, lastUpdated: vehicle.lastUpdated,
    nextStop: eta && eta.nextStop ? eta.nextStop.name : null, etaMinutes: eta ? eta.etaMinutes : null,
    distanceToNextStop: eta && eta.nextStop ? eta.nextStop.distanceKm : null, eta, timestamp: new Date().toISOString(), via: meta.via || 'gps',
  };
  io.to('vehicle:' + vehicle._id.toString()).to('admins').to('public').emit('vehicleLocationUpdated', payload);
  return payload;
}

/* ============================ SOCKET.IO ============================ */
io.use((socket, next) => {
  const t = socket.handshake.auth && socket.handshake.auth.token;
  socket.data.user = null;
  if (t) { try { socket.data.user = jwt.verify(t, JWT_SECRET); } catch { /* anonymous */ } }
  next();
});
io.on('connection', (socket) => {
  const u = socket.data.user;
  if (!u) { socket.join('public'); return; }
  socket.join('user:' + u.id);
  if (u.role === 'ADMIN') socket.join('admins');
  if (u.role === 'DRIVER') Vehicle.findOne({ driverId: u.id }).then((v) => { if (v) socket.join('vehicle:' + v._id.toString()); }).catch(() => {});
  socket.on('track:vehicle', (id) => socket.join('vehicle:' + id));
  socket.on('untrack:vehicle', (id) => socket.leave('vehicle:' + id));
  socket.on('track:person', (phone) => { const c = String(phone).replace(/\D/g, ''); if (c) socket.join('track:' + c); });
  socket.on('untrack:person', (phone) => { const c = String(phone).replace(/\D/g, ''); if (c) socket.leave('track:' + c); });
});

/* Vehicle offline sweep */
setInterval(async () => {
  try {
    const s = await getSettings(); const now = Date.now();
    const offCut = new Date(now - s.offlineAfterSec * 1000), delCut = new Date(now - s.delayedAfterSec * 1000);
    const toOff = await Vehicle.find({ status: { $in: ['LIVE', 'GPS_DELAYED'] }, lastUpdated: { $lt: offCut } });
    for (const v of toOff) { v.status = 'OFFLINE'; await v.save(); io.to('vehicle:' + v._id.toString()).to('admins').to('public').emit('vehicleStatusChanged', { vehicleId: v._id.toString(), status: 'OFFLINE', lastUpdated: v.lastUpdated }); await auditSystem('VEHICLE_OFFLINE', 'vehicle', v._id, v.vehicleNumber + ' marked OFFLINE (no GPS for ' + s.offlineAfterSec + 's)', 'SYSTEM'); }
    const toDel = await Vehicle.find({ status: 'LIVE', lastUpdated: { $lt: delCut, $gte: offCut } });
    for (const v of toDel) { v.status = 'GPS_DELAYED'; await v.save(); io.to('vehicle:' + v._id.toString()).to('admins').to('public').emit('vehicleStatusChanged', { vehicleId: v._id.toString(), status: 'GPS_DELAYED', lastUpdated: v.lastUpdated }); }
  } catch { /* db not ready */ }
}, 10000);

/* Person location cleanup sweep */
setInterval(async () => {
  try {
    const stale = new Date(Date.now() - 2 * 60 * 1000);
    const staleUsers = await User.find({ locationSharing: true, lastLocationUpdate: { $lt: stale } });
    for (const u of staleUsers) { u.locationSharing = false; await u.save(); io.to('track:' + String(u.phone).replace(/\D/g, '')).emit('person:offline', { userId: u._id, phone: u.phone }); }
    const stalePersons = await PersonLocation.find({ isSharing: true, lastUpdate: { $lt: stale } });
    for (const p of stalePersons) { p.isSharing = false; await p.save(); io.to('track:' + String(p.phone).replace(/\D/g, '')).emit('person:offline', { phone: p.phone }); }
    if (staleUsers.length || stalePersons.length) console.log('[cleanup] offline:', staleUsers.length, 'users,', stalePersons.length, 'persons');
  } catch (e) { console.error('[cleanup]', e.message); }
}, 30000);

/* ================================== AUTH ================================== */
app.post('/api/auth/register', rateLimit(), aw(async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  const s = await getSettings();
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (String(password).length < s.passwordMinLength) return res.status(400).json({ error: 'Password must be at least ' + s.passwordMinLength + ' characters.' });
  const roleVal = ['PASSENGER', 'DRIVER'].includes(req.body.role) ? req.body.role : 'PASSENGER';
  if (await User.findOne({ email: String(email).toLowerCase() })) return res.status(409).json({ error: 'An account with this email already exists.' });
  const user = await User.create({ name, email, phone: phone || '', passwordHash: await bcrypt.hash(String(password), 10), role: roleVal });
  await auditSystem('REGISTER', 'user', user._id, 'New ' + roleVal + ' account created: ' + user.email, 'AUTH', user.name);
  res.status(201).json({ token: signToken(user, s.sessionHours), user: publicUser(user) });
}));

app.post('/api/auth/login', rateLimit(), aw(async (req, res) => {
  const { identifier, email, password } = req.body || {};
  const idf = String(identifier || email || '').toLowerCase().trim();
  if (!idf || !password) return res.status(400).json({ error: 'Email/phone and password are required.' });
  const user = await User.findOne({ $or: [{ email: idf }, { phone: idf }] });
  if (!user || !(await bcrypt.compare(String(password), user.passwordHash))) {
    await auditSystem('LOGIN_FAILED', 'user', null, 'Failed sign-in attempt for identifier: ' + idf, 'SECURITY');
    return res.status(401).json({ error: 'Invalid email/phone or password.' });
  }
  if (!user.active) {
    await auditSystem('LOGIN_BLOCKED', 'user', user._id, 'Disabled account attempted sign-in: ' + user.email, 'SECURITY', user.name);
    return res.status(403).json({ error: 'Your account has been disabled. Please contact an administrator.' });
  }
  user.lastLogin = new Date(); await user.save();
  await auditSystem('LOGIN', 'user', user._id, user.email + ' signed in (' + user.role + ')', 'AUTH', user.name);
  const s = await getSettings();
  res.json({ success: true, token: signToken(user, s.sessionHours), user: publicUser(user) });
}));

app.post('/api/auth/logout', auth, aw(async (req, res) => {
  await auditSystem('LOGOUT', 'user', req.user.id, 'Signed out', 'AUTH', req.user.name);
  res.json({ ok: true });
}));

app.post('/api/auth/forgot-password', rateLimit(), aw(async (req, res) => {
  const idf = String(req.body.identifier || req.body.email || '').toLowerCase().trim();
  const u = await User.findOne({ $or: [{ email: idf }, { phone: idf }] });
  let devToken = null;
  if (u) {
    u.resetToken = crypto.randomBytes(32).toString('hex'); u.resetExpires = Date.now() + 3600e3; await u.save();
    if (IS_DEV) { devToken = u.resetToken; console.log('[dev] reset token for ' + u.email + ': ' + u.resetToken); }
  }
  res.json({ ok: true, message: 'If an account exists for that identifier, a recovery link has been sent.', ...(IS_DEV && devToken ? { devResetToken: devToken } : {}) });
}));

app.post('/api/auth/reset-password', rateLimit(), aw(async (req, res) => {
  const u = await User.findOne({ resetToken: req.body.token, resetExpires: { $gt: Date.now() } });
  if (!u) return res.status(400).json({ error: 'Reset link is invalid or has expired.' });
  const s = await getSettings();
  if (String(req.body.newPassword || '').length < s.passwordMinLength) return res.status(400).json({ error: 'Password too short.' });
  u.passwordHash = await bcrypt.hash(String(req.body.newPassword), 10); u.resetToken = undefined; u.resetExpires = undefined; await u.save();
  await auditSystem('PASSWORD_CHANGE', 'user', u._id, 'Password reset via recovery link', 'SECURITY', u.name);
  res.json({ ok: true });
}));

/* ---------- GOOGLE OAUTH (reads GOOGLE_CLIENT_ID / SECRET from env) ---------- */
app.get('/api/auth/google/url', (req, res) => {
  const cid = process.env.GOOGLE_CLIENT_ID;
  if (!cid) return res.status(501).json({ error: 'Google login is not configured. Set GOOGLE_CLIENT_ID in the server .env file.' });
  const ru = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback';
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${cid}&redirect_uri=${encodeURIComponent(ru)}&response_type=code&scope=email%20profile` });
});
app.get('/api/auth/google/callback', aw(async (req, res) => {
  const cid = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  const ru = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback';
  if (!cid || !secret) return res.status(501).json({ error: 'Google login is not configured on the server.' });
  const tr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: req.query.code, client_id: cid, client_secret: secret, redirect_uri: ru, grant_type: 'authorization_code' }),
  });
  const tj = await tr.json();
  if (!tj.id_token) return res.status(400).json({ error: 'Google authentication failed.' });
  const info = await (await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + tj.id_token)).json();
  if (!info || !info.email) return res.status(400).json({ error: 'Google authentication failed.' });
  let user = await User.findOne({ $or: [{ googleId: info.sub }, { email: info.email }] });
  if (!user) user = await User.create({ name: info.name || info.email, email: info.email, googleId: info.sub, passwordHash: await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10), role: 'PASSENGER' });
  user.lastLogin = new Date(); await user.save();
  await auditSystem('LOGIN', 'user', user._id, user.email + ' signed in with Google', 'AUTH', user.name);
  const client = process.env.CLIENT_URL || 'http://localhost:3000';
  res.redirect(client + '/#/google-callback?token=' + signToken(user));
}));

app.get('/api/users/me', auth, aw(async (req, res) => res.json({ user: publicUser(await User.findById(req.user.id)) })));
app.put('/api/users/me', auth, aw(async (req, res) => {
  const u = await User.findById(req.user.id);
  if (req.body.name) u.name = String(req.body.name).trim();
  if (req.body.phone !== undefined) u.phone = String(req.body.phone);
  if (req.body.avatar !== undefined) u.avatar = String(req.body.avatar);
  await u.save(); res.json({ user: publicUser(u) });
}));
app.put('/api/users/me/password', auth, rateLimit(), aw(async (req, res) => {
  const u = await User.findById(req.user.id);
  if (!(await bcrypt.compare(String(req.body.currentPassword || ''), u.passwordHash))) return res.status(400).json({ error: 'Current password is incorrect.' });
  const s = await getSettings();
  if (String(req.body.newPassword || '').length < s.passwordMinLength) return res.status(400).json({ error: 'New password too short.' });
  u.passwordHash = await bcrypt.hash(String(req.body.newPassword), 10); await u.save();
  await auditSystem('PASSWORD_CHANGE', 'user', u._id, 'Password changed', 'SECURITY', u.name);
  res.json({ ok: true });
}));

/* ================================ VEHICLES ================================ */
const vehiclePop = [
  { path: 'routeId', select: 'name routeNumber startPoint destination stops geometry', populate: { path: 'stops', select: 'name location address geofenceRadius' } },
  { path: 'driverId', select: 'name email phone' },
];
async function vehicleJson(v) {
  let eta = null;
  try { eta = await computeEtaInfo(v); } catch (e) { console.error('[eta] failed for', v.vehicleNumber, '-', e.message); eta = null; }
  const j = v.toJSON();
  return { ...j, eta, nextStopName: eta && eta.nextStop ? eta.nextStop.name : null };
}

app.get('/api/vehicles', auth, aw(async (req, res) => {
  let q = Vehicle.find().populate(vehiclePop);
  if (req.query.routeId) q = q.where('routeId').equals(req.query.routeId);
  if (req.query.status) q = q.where('status').equals(req.query.status);
  const vs = await q.sort('vehicleNumber');
  const out = [];
  for (const v of vs) { try { out.push(await vehicleJson(v)); } catch (e) { console.error('[vehicles] skip', v._id, e.message); } }
  res.json(out);
}));

app.get('/api/vehicles/nearby', auth, aw(async (req, res) => {
  const lat = +req.query.lat, lng = +req.query.lng;
  const radiusKm = Math.min(+(req.query.radiusKm || 5), 50);
  if (!isNum(lat) || !isNum(lng)) return res.status(400).json({ error: 'lat and lng query params required' });
  const vehicles = await Vehicle.find({
    currentLocation: { $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: radiusKm * 1000 } },
    status: { $nin: ['OFFLINE', 'TRACKING_STOPPED'] },
  }).populate(vehiclePop).limit(20);
  const out = [];
  for (const v of vehicles) {
    try {
      const json = await vehicleJson(v);
      out.push({ ...json, distanceKm: +haversine(lat, lng, v.currentLocation.coordinates[1], v.currentLocation.coordinates[0]).toFixed(2) });
    } catch (e) { /* skip */ }
  }
  res.json(out);
}));

app.get('/api/drivers/phone/:phone', auth, aw(async (req, res) => {
  const phoneDigits = String(req.params.phone).trim().replace(/\D/g, '');
  if (!phoneDigits) return res.status(400).json({ error: 'Phone number required' });
  let driver = await User.findOne({ phone: new RegExp('^' + phoneDigits.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'), role: 'DRIVER' }).select('name phone licenseNumber active');
  if (!driver) driver = await User.findOne({ phone: new RegExp(phoneDigits.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), role: 'DRIVER' }).select('name phone licenseNumber active');
  if (!driver) return res.status(404).json({ error: 'Driver not found', message: 'No driver registered with that phone number.' });
  const vehicle = await Vehicle.findOne({ driverId: driver._id }).populate(vehiclePop);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found', message: 'Driver found but no vehicle assigned.' });
  res.json({
    driver: { _id: driver._id, name: driver.name, phone: driver.phone, licenseNumber: driver.licenseNumber },
    vehicle: await vehicleJson(vehicle),
    eta: await computeEtaInfo(vehicle),
  });
}));

app.post('/api/admin/simulate/:id', auth, role('ADMIN'), aw(async (req, res) => {
  if (!IS_DEV) return res.status(403).json({ error: 'Simulator is only available in development mode.' });
  const v = await Vehicle.findById(req.params.id);
  if (!v) return res.status(404).json({ error: 'Vehicle not found.' });
  const { latitude, longitude, speed = 30, heading = 0 } = req.body || {};
  if (!isNum(+latitude) || !isNum(+longitude)) return res.status(400).json({ error: 'Valid lat/lng required.' });
  res.json(await processLocation(v._id, { latitude, longitude, speed, heading, accuracy: 10 }, { via: 'simulator' }));
}));

app.get('/api/vehicles/live', auth, aw(async (req, res) => {
  const vs = await Vehicle.find().populate(vehiclePop).sort({ lastUpdated: -1 });
  const out = [];
  for (const v of vs) { try { out.push(await vehicleJson(v)); } catch (e) { /* skip */ } }
  res.json(out);
}));
app.get('/api/vehicles/code/:code', auth, aw(async (req, res) => {
  const v = await Vehicle.findOne({ vehicleNumber: new RegExp('^' + String(req.params.code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }).populate(vehiclePop);
  if (!v) return res.status(404).json({ error: 'Vehicle not found', message: 'Check the vehicle code and try again.' });
  res.json({ vehicle: await vehicleJson(v), eta: await computeEtaInfo(v) });
}));
app.get('/api/vehicles/:id', auth, aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid vehicle id.' });
  const v = await Vehicle.findById(req.params.id).populate(vehiclePop);
  if (!v) return res.status(404).json({ error: 'Vehicle not found.' });
  res.json({ vehicle: await vehicleJson(v), eta: await computeEtaInfo(v) });
}));

app.post('/api/vehicles', auth, role('ADMIN'), aw(async (req, res) => {
  const { vehicleNumber, licensePlate, type, driverId, routeId } = req.body || {};
  if (!vehicleNumber) return res.status(400).json({ error: 'Vehicle number is required.' });
  if (await Vehicle.findOne({ vehicleNumber })) return res.status(409).json({ error: 'Vehicle number already exists.' });
  const v = await Vehicle.create({ vehicleNumber, licensePlate: licensePlate || '', type: type || 'BUS', driverId: cleanId(driverId), routeId: cleanId(routeId), status: 'OFFLINE', currentLocation: undefined });
  await audit(req, 'CREATE', 'vehicle', v._id, 'Added vehicle ' + v.vehicleNumber);
  const created = await Vehicle.findById(v._id).populate(vehiclePop);
  res.status(201).json(created ? created.toJSON() : v.toJSON());
}));

app.put('/api/vehicles/:id', auth, role('ADMIN'), aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid vehicle id.' });
  const v = await Vehicle.findById(req.params.id); if (!v) return res.status(404).json({ error: 'Vehicle not found.' });
  const { vehicleNumber, licensePlate, type, driverId, routeId, status } = req.body || {};
  if (vehicleNumber) v.vehicleNumber = String(vehicleNumber).trim();
  if (licensePlate !== undefined) v.licensePlate = licensePlate;
  if (type) v.type = type;
  if (driverId !== undefined) { const did = cleanId(driverId._id || driverId); await Vehicle.updateMany({ driverId: did, _id: { $ne: v._id } }, { driverId: null }); v.driverId = did; }
  if (routeId !== undefined) { v.routeId = cleanId(routeId._id || routeId); v.progressIndex = 0; v.stopEvents = []; }
  if (status && ['LIVE', 'OFFLINE', 'IN_SERVICE', 'TRACKING_STOPPED'].includes(status)) v.status = status;
  await v.save();
  await audit(req, 'UPDATE', 'vehicle', v._id, 'Updated vehicle ' + v.vehicleNumber);
  const updated = await Vehicle.findById(v._id).populate(vehiclePop);
  res.json(updated ? updated.toJSON() : v.toJSON());
}));

app.delete('/api/vehicles/:id', auth, role('ADMIN'), aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid vehicle id.' });
  const v = await Vehicle.findByIdAndDelete(req.params.id); if (!v) return res.status(404).json({ error: 'Vehicle not found.' });
  await GPSHistory.deleteMany({ vehicleId: v._id });
  await TrackingSession.updateMany({ vehicleId: v._id }, { status: 'STOPPED', endedAt: new Date() });
  await audit(req, 'DELETE', 'vehicle', v._id, 'Deleted vehicle ' + v.vehicleNumber);
  res.json({ ok: true });
}));

app.post('/api/vehicles/:id/location', auth, aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid vehicle id.' });
  const v = await Vehicle.findById(req.params.id); if (!v) return res.status(404).json({ error: 'Vehicle not found.' });
  const owner = v.driverId && v.driverId.toString() === req.user.id;
  if (req.user.role !== 'ADMIN' && !(req.user.role === 'DRIVER' && owner)) return res.status(403).json({ error: 'Only the assigned driver (or admin) can send GPS for this vehicle.' });
  res.json(await processLocation(v._id, req.body, { via: 'gps' }));
}));

app.post('/api/vehicles/:id/status', auth, aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid vehicle id.' });
  const v = await Vehicle.findById(req.params.id); if (!v) return res.status(404).json({ error: 'Vehicle not found.' });
  const owner = v.driverId && v.driverId.toString() === req.user.id;
  if (req.user.role !== 'ADMIN' && !(req.user.role === 'DRIVER' && owner)) return res.status(403).json({ error: 'Not allowed for this vehicle.' });
  if (['LIVE', 'OFFLINE', 'IN_SERVICE', 'TRACKING_STOPPED'].includes(req.body.status)) v.status = req.body.status;
  await v.save();
  io.to('vehicle:' + v._id.toString()).to('admins').to('public').emit('vehicleStatusChanged', { vehicleId: v._id.toString(), status: v.status, lastUpdated: v.lastUpdated });
  res.json(v.toJSON());
}));

app.get('/api/vehicles/:id/history', auth, aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid vehicle id.' });
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(await GPSHistory.find({ vehicleId: req.params.id }).sort({ timestamp: -1 }).limit(limit));
}));

/* ============ PERSON LOCATION SHARING (ALL USERS) ============ */
app.post('/api/location/start', auth, aw(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!user.phone) return res.status(400).json({ error: 'Add a phone number to your profile before sharing location.' });
  user.locationSharing = true;
  user.lastLocationUpdate = new Date();
  await user.save();
  await PersonLocation.findOneAndUpdate(
    { phone: user.phone },
    { phone: user.phone, userId: user._id, isSharing: true, lastUpdate: new Date(), userAgent: req.headers['user-agent'] || '' },
    { upsert: true, new: true }
  );
  io.to('user:' + user._id.toString()).emit('location:started', { userId: user._id, phone: user.phone });
  await auditSystem('LOCATION_START', 'user', user._id, user.name + ' started sharing location', 'SYSTEM', user.name);
  res.json({ ok: true, message: 'Location sharing started', userId: user._id, phone: user.phone, role: user.role });
}));

app.post('/api/location/update', auth, aw(async (req, res) => {
  const { latitude, longitude, accuracy, speed, heading } = req.body;
  if (!isNum(+latitude) || !isNum(+longitude) || Math.abs(+latitude) > 90 || Math.abs(+longitude) > 180) return res.status(400).json({ error: 'Invalid coordinates' });
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  user.currentLocation = { type: 'Point', coordinates: [+longitude, +latitude] };
  user.lastLocationUpdate = new Date();
  user.locationSharing = true;
  await user.save();
  await PersonLocation.findOneAndUpdate(
    { phone: user.phone },
    { currentLocation: { type: 'Point', coordinates: [+longitude, +latitude] }, isSharing: true, lastUpdate: new Date() },
    { upsert: true }
  );
  if (IS_DEV) console.log('[location]', user.name, user.role, (+latitude).toFixed(5), (+longitude).toFixed(5));
  io.to('track:' + String(user.phone).replace(/\D/g, '')).emit('person:location', {
    userId: user._id.toString(), phone: user.phone, name: user.name, role: user.role,
    latitude: +latitude, longitude: +longitude, accuracy: accuracy || null, speed: speed || 0, heading: heading || 0,
    lastUpdate: new Date().toISOString(), isDriver: user.role === 'DRIVER',
  });
  res.json({ ok: true });
}));

app.post('/api/location/stop', auth, aw(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  user.locationSharing = false;
  user.currentLocation = undefined;
  await user.save();
  await PersonLocation.findOneAndUpdate({ phone: user.phone }, { isSharing: false, currentLocation: undefined });
  io.to('track:' + String(user.phone).replace(/\D/g, '')).emit('person:offline', { userId: user._id, phone: user.phone });
  await auditSystem('LOCATION_STOP', 'user', user._id, user.name + ' stopped sharing location', 'SYSTEM', user.name);
  res.json({ ok: true, message: 'Location sharing stopped' });
}));

/* Track ANY phone number */
app.get('/api/track/:phone', auth, aw(async (req, res) => {
  const phone = String(req.params.phone).trim().replace(/\D/g, '');
  if (!phone) return res.status(400).json({ error: 'Phone number required' });
  const foundUser = await User.findOne({ phone: new RegExp('^' + phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'), active: true })
    .select('name phone role locationSharing currentLocation lastLocationUpdate avatar');
  if (foundUser) {
    const isSharing = !!(foundUser.locationSharing && foundUser.lastLocationUpdate && (Date.now() - new Date(foundUser.lastLocationUpdate).getTime() < 120000));
    return res.json({
      found: true, type: 'registered', isDriver: foundUser.role === 'DRIVER',
      user: { _id: foundUser._id, name: foundUser.name, phone: foundUser.phone, role: foundUser.role, avatar: foundUser.avatar },
      location: isSharing
        ? { latitude: foundUser.currentLocation && foundUser.currentLocation.coordinates ? foundUser.currentLocation.coordinates[1] : null, longitude: foundUser.currentLocation && foundUser.currentLocation.coordinates ? foundUser.currentLocation.coordinates[0] : null, lastUpdate: foundUser.lastLocationUpdate, isSharing: true }
        : { isSharing: false, message: 'This person is not currently sharing their location.' },
    });
  }
  const personLoc = await PersonLocation.findOne({ phone });
  if (personLoc && personLoc.isSharing) {
    const isRecent = (Date.now() - new Date(personLoc.lastUpdate).getTime() < 120000);
    return res.json({
      found: true, type: 'unregistered', isDriver: false,
      location: isRecent
        ? { latitude: personLoc.currentLocation && personLoc.currentLocation.coordinates ? personLoc.currentLocation.coordinates[1] : null, longitude: personLoc.currentLocation && personLoc.currentLocation.coordinates ? personLoc.currentLocation.coordinates[0] : null, lastUpdate: personLoc.lastUpdate, isSharing: true }
        : { isSharing: false, message: 'Location data is stale.' },
    });
  }
  res.json({ found: false, message: 'This phone number is not currently sharing location.' });
}));

app.post('/api/track/unregistered/start', aw(async (req, res) => {
  const { phone } = req.body;
  const cleanPhone = String(phone || '').trim().replace(/\D/g, '');
  if (!cleanPhone) return res.status(400).json({ error: 'Phone number required' });
  const existingUser = await User.findOne({ phone: cleanPhone });
  if (existingUser) return res.status(400).json({ error: 'This phone is already registered. Please log in to share location.' });
  const personLoc = await PersonLocation.findOneAndUpdate(
    { phone: cleanPhone },
    { phone: cleanPhone, userId: null, isSharing: true, lastUpdate: new Date(), userAgent: req.headers['user-agent'] || '' },
    { upsert: true, new: true }
  );
  const tempToken = jwt.sign({ phone: cleanPhone, type: 'temp-location', id: personLoc._id.toString() }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ ok: true, token: tempToken, phone: cleanPhone, personId: personLoc._id });
}));

app.post('/api/track/unregistered/update', aw(async (req, res) => {
  const { phone, latitude, longitude, accuracy, speed, heading } = req.body;
  const cleanPhone = String(phone || '').trim().replace(/\D/g, '');
  if (!cleanPhone || !isNum(+latitude) || !isNum(+longitude)) return res.status(400).json({ error: 'Invalid data' });
  await PersonLocation.findOneAndUpdate(
    { phone: cleanPhone },
    { currentLocation: { type: 'Point', coordinates: [+longitude, +latitude] }, isSharing: true, lastUpdate: new Date() },
    { upsert: true, new: true }
  );
  if (IS_DEV) console.log('[location-unregistered]', cleanPhone, (+latitude).toFixed(5), (+longitude).toFixed(5));
  io.to('track:' + cleanPhone).emit('person:location', {
    phone: cleanPhone, name: 'Person', role: 'UNREGISTERED',
    latitude: +latitude, longitude: +longitude, accuracy: accuracy || null, speed: speed || 0, heading: heading || 0,
    lastUpdate: new Date().toISOString(), isDriver: false,
  });
  res.json({ ok: true });
}));

app.post('/api/track/unregistered/stop', aw(async (req, res) => {
  const { phone } = req.body;
  const cleanPhone = String(phone || '').trim().replace(/\D/g, '');
  await PersonLocation.findOneAndUpdate({ phone: cleanPhone }, { isSharing: false, currentLocation: undefined });
  io.to('track:' + cleanPhone).emit('person:offline', { phone: cleanPhone });
  res.json({ ok: true });
}));

/* ============================ ROUTES / STOPS ============================ */
app.get('/api/routes', auth, aw(async (req, res) => {
  const routes = await Route.find().populate('stops', 'name location address').sort('routeNumber');
  const vehicles = await Vehicle.find().select('routeId status');
  res.json(routes.map((r) => ({ ...r.toJSON(), stopCount: r.stops.length, activeVehicles: vehicles.filter((v) => v.routeId && v.routeId.toString() === r._id.toString() && v.status !== 'OFFLINE').length })));
}));
app.get('/api/routes/:id', auth, aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid route id.' });
  const route = await Route.findById(req.params.id).populate('stops');
  if (!route) return res.status(404).json({ error: 'Route not found.' });
  const vehicles = await Vehicle.find({ routeId: route._id }).populate('driverId', 'name');
  const out = [];
  for (const v of vehicles) { try { out.push(await vehicleJson(v)); } catch (e) { /* skip */ } }
  res.json({ route: route.toJSON(), vehicles: out });
}));
app.post('/api/routes', auth, role('ADMIN'), aw(async (req, res) => {
  const { name, routeNumber, startPoint, destination, stops, geometry } = req.body || {};
  if (!name || !routeNumber) return res.status(400).json({ error: 'Route name and number are required.' });
  if (await Route.findOne({ routeNumber })) return res.status(409).json({ error: 'Route number already exists.' });
  const cleanStops = Array.isArray(stops) ? stops.map(cleanId).filter(Boolean) : [];
  const route = await Route.create({ name, routeNumber, startPoint: startPoint || '', destination: destination || '', stops: cleanStops, geometry: geometry || [] });
  await BusStop.updateMany({ _id: { $in: cleanStops } }, { $addToSet: { routes: route._id } });
  await audit(req, 'CREATE', 'route', route._id, 'Created ' + route.name);
  res.status(201).json(route);
}));
app.put('/api/routes/:id', auth, role('ADMIN'), aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid route id.' });
  const route = await Route.findById(req.params.id); if (!route) return res.status(404).json({ error: 'Route not found.' });
  const { name, routeNumber, startPoint, destination, stops, geometry, status } = req.body || {};
  if (name) route.name = name; if (routeNumber) route.routeNumber = routeNumber;
  if (startPoint !== undefined) route.startPoint = startPoint; if (destination !== undefined) route.destination = destination;
  if (status) route.status = status; if (geometry) route.geometry = geometry;
  if (stops) {
    await BusStop.updateMany({ routes: route._id }, { $pull: { routes: route._id } });
    const cleanStops = Array.isArray(stops) ? stops.map(cleanId).filter(Boolean) : [];
    route.stops = cleanStops;
    await BusStop.updateMany({ _id: { $in: cleanStops } }, { $addToSet: { routes: route._id } });
  }
  await route.save(); await audit(req, 'UPDATE', 'route', route._id, 'Updated ' + route.name);
  res.json(route);
}));
app.delete('/api/routes/:id', auth, role('ADMIN'), aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid route id.' });
  const route = await Route.findByIdAndDelete(req.params.id); if (!route) return res.status(404).json({ error: 'Route not found.' });
  await BusStop.updateMany({ routes: route._id }, { $pull: { routes: route._id } });
  await Vehicle.updateMany({ routeId: route._id }, { routeId: null });
  await audit(req, 'DELETE', 'route', route._id, 'Deleted ' + route.name);
  res.json({ ok: true });
}));
app.get('/api/stops', auth, aw(async (req, res) => {
  const filter = {};
  if (req.query.q) { const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.$or = [{ name: rx }, { address: rx }]; }
  const stops = await BusStop.find(filter).populate('routes', 'name routeNumber');
  const vehicles = await Vehicle.find({ status: { $nin: ['OFFLINE', 'TRACKING_STOPPED'] } });
  const etas = [];
  for (const v of vehicles) { try { const e = await computeEtaInfo(v); if (e) etas.push({ v, e }); } catch (e) { /* skip */ } }
  res.json(stops.map((s) => ({
    ...s.toJSON(),
    upcoming: etas.flatMap(({ v, e }) => (e.stops || []).filter((st) => st._id === s._id.toString() && ['NEXT', 'UPCOMING', 'TERMINUS'].includes(st.status)).map((st) => ({ vehicleId: v._id.toString(), vehicleNumber: v.vehicleNumber, etaMinutes: st.etaMinutes, status: st.status }))),
  })));
}));
app.get('/api/stops/:id', auth, aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid stop id.' });
  const s = await BusStop.findById(req.params.id).populate('routes', 'name routeNumber');
  if (!s) return res.status(404).json({ error: 'Bus stop not found.' }); res.json(s);
}));
app.post('/api/stops', auth, role('ADMIN'), aw(async (req, res) => {
  const { name, address, latitude, longitude, routes, geofenceRadius } = req.body || {};
  if (!name || !isNum(+latitude) || !isNum(+longitude)) return res.status(400).json({ error: 'Name, latitude and longitude are required.' });
  const cleanRoutes = Array.isArray(routes) ? routes.map(cleanId).filter(Boolean) : [];
  const stop = await BusStop.create({ name, address: address || '', geofenceRadius: geofenceRadius || 100, location: { type: 'Point', coordinates: [+longitude, +latitude] }, routes: cleanRoutes });
  await Route.updateMany({ _id: { $in: cleanRoutes } }, { $addToSet: { stops: stop._id } });
  await audit(req, 'CREATE', 'busstop', stop._id, 'Added bus stop ' + stop.name);
  res.status(201).json(stop);
}));
app.put('/api/stops/:id', auth, role('ADMIN'), aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid stop id.' });
  const stop = await BusStop.findById(req.params.id); if (!stop) return res.status(404).json({ error: 'Bus stop not found.' });
  const { name, address, latitude, longitude, routes, geofenceRadius } = req.body || {};
  if (name) stop.name = name; if (address !== undefined) stop.address = address;
  if (geofenceRadius !== undefined) stop.geofenceRadius = +geofenceRadius;
  if (isNum(+latitude) && isNum(+longitude)) stop.location = { type: 'Point', coordinates: [+longitude, +latitude] };
  if (routes) {
    await Route.updateMany({ stops: stop._id }, { $pull: { stops: stop._id } });
    const cleanRoutes = Array.isArray(routes) ? routes.map(cleanId).filter(Boolean) : [];
    stop.routes = cleanRoutes;
    await Route.updateMany({ _id: { $in: cleanRoutes } }, { $addToSet: { stops: stop._id } });
  }
  await stop.save(); await audit(req, 'UPDATE', 'busstop', stop._id, 'Updated bus stop ' + stop.name);
  res.json(stop);
}));
app.delete('/api/stops/:id', auth, role('ADMIN'), aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid stop id.' });
  const stop = await BusStop.findByIdAndDelete(req.params.id); if (!stop) return res.status(404).json({ error: 'Bus stop not found.' });
  await Route.updateMany({ stops: stop._id }, { $pull: { stops: stop._id } });
  await audit(req, 'DELETE', 'busstop', stop._id, 'Deleted bus stop ' + stop.name);
  res.json({ ok: true });
}));

/* ======================= NOTIFICATIONS / TRIPS / SEARCH / TRACKING ======================= */
app.get('/api/notifications', auth, aw(async (req, res) => res.json(await Notification.find(notifFilter(req.user)).sort({ createdAt: -1 }).limit(60))));
app.get('/api/notifications/unread-count', auth, aw(async (req, res) => res.json({ count: await Notification.countDocuments({ ...notifFilter(req.user), read: false }) })));
app.patch('/api/notifications/:id/read', auth, aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid id.' });
  res.json(await Notification.findByIdAndUpdate(req.params.id, { read: true }, { new: true }));
}));
app.patch('/api/notifications/read-all', auth, aw(async (req, res) => { await Notification.updateMany({ ...notifFilter(req.user), read: false }, { read: true }); res.json({ ok: true }); }));

app.get('/api/trips', auth, aw(async (req, res) => res.json(await Trip.find({ $or: [{ userId: req.user.id }, { driverId: req.user.id }] }).populate('vehicleId', 'vehicleNumber').populate('routeId', 'name routeNumber startPoint destination').sort({ startTime: -1 }))));
app.post('/api/trips', auth, aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.body.vehicleId))) return res.status(400).json({ error: 'Invalid vehicle id.' });
  const v = await Vehicle.findById(req.body.vehicleId).populate('routeId');
  if (!v) return res.status(404).json({ error: 'Vehicle not found.' });
  res.status(201).json(await Trip.create({ userId: req.user.id, driverId: v.driverId, vehicleId: v._id, routeId: v.routeId ? v.routeId._id : null, startTime: new Date(), startStop: v.routeId ? v.routeId.startPoint : '', destinationStop: v.routeId ? v.routeId.destination : '' }));
}));
app.patch('/api/trips/:id/end', auth, aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid id.' });
  const trip = await Trip.findOne({ _id: req.params.id, $or: [{ userId: req.user.id }, { driverId: req.user.id }] });
  if (!trip) return res.status(404).json({ error: 'Trip not found.' });
  trip.endTime = new Date(); trip.status = 'COMPLETED';
  const pts = await GPSHistory.find({ vehicleId: trip.vehicleId, timestamp: { $gte: trip.startTime, $lte: trip.endTime } }).sort('timestamp');
  let km = 0; for (let i = 1; i < pts.length; i++) km += haversine(pts[i - 1].latitude, pts[i - 1].longitude, pts[i].latitude, pts[i].longitude);
  trip.distanceKm = +km.toFixed(2);
  const veh = await Vehicle.findById(trip.vehicleId); trip.completedStops = veh ? veh.progressIndex : 0;
  await trip.save(); res.json(trip);
}));

app.post('/api/tracking/start', auth, aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.body.vehicleId))) return res.status(400).json({ error: 'Invalid vehicle id.' });
  const { vehicleId, stopId } = req.body || {};
  const v = await Vehicle.findById(vehicleId); if (!v) return res.status(404).json({ error: 'Vehicle not found.' });
  await TrackingSession.updateMany({ passengerId: req.user.id, vehicleId, status: 'ACTIVE' }, { status: 'STOPPED', endedAt: new Date() });
  const sess = await TrackingSession.create({ passengerId: req.user.id, vehicleId, selectedStopId: stopId ? cleanId(stopId) : null });
  res.status(201).json(sess);
}));
app.get('/api/tracking', auth, aw(async (req, res) => res.json(await TrackingSession.find({ passengerId: req.user.id }).populate('vehicleId', 'vehicleNumber status').populate('selectedStopId', 'name').sort('-startedAt').limit(20))));
app.get('/api/tracking/:id', auth, aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid id.' });
  const sess = await TrackingSession.findOne({ _id: req.params.id, passengerId: req.user.id }).populate('selectedStopId').populate({ path: 'vehicleId', populate: vehiclePop });
  if (!sess) return res.status(404).json({ error: 'Tracking session not found.' });
  let distanceKm = null, etaMinutes = null;
  if (sess.vehicleId && sess.selectedStopId && sess.vehicleId.currentLocation && sess.vehicleId.currentLocation.coordinates) {
    const c = sess.vehicleId.currentLocation.coordinates;
    distanceKm = +haversine(c[1], c[0], sess.selectedStopId.location.coordinates[1], sess.selectedStopId.location.coordinates[0]).toFixed(2);
    const eta = await computeEtaInfo(sess.vehicleId);
    const en = eta && eta.stops ? eta.stops.find((x) => x._id === sess.selectedStopId._id.toString()) : null;
    etaMinutes = en ? en.etaMinutes : Math.max(1, Math.round((distanceKm / 30) * 60));
  }
  res.json({ session: sess, distanceKm, etaMinutes });
}));
app.post('/api/tracking/:id/stop', auth, aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid id.' });
  const sess = await TrackingSession.findOneAndUpdate({ _id: req.params.id, passengerId: req.user.id }, { status: 'STOPPED', endedAt: new Date() }, { new: true });
  if (!sess) return res.status(404).json({ error: 'Tracking session not found.' });
  res.json(sess);
}));

app.get('/api/search', auth, aw(async (req, res) => {
  const q = String(req.query.q || '').trim(); if (!q) return res.json({ vehicles: [], routes: [], stops: [], users: [], drivers: [] });
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const [vehicles, routes, stops, users] = await Promise.all([
    Vehicle.find({ $or: [{ vehicleNumber: rx }, { licensePlate: rx }] }).limit(6).populate('routeId', 'name routeNumber'),
    Route.find({ $or: [{ name: rx }, { routeNumber: rx }, { startPoint: rx }, { destination: rx }] }).limit(6),
    BusStop.find({ $or: [{ name: rx }, { address: rx }] }).limit(6),
    req.user.role === 'ADMIN' ? User.find({ $or: [{ name: rx }, { email: rx }, { phone: rx }] }).limit(6) : Promise.resolve([]),
  ]);
  res.json({ vehicles, routes, stops, users, drivers: users.filter((u) => u.role === 'DRIVER') });
}));

/* ================================== DRIVER ================================== */
const driverVehicle = (userId) => Vehicle.findOne({ driverId: userId }).populate(vehiclePop);
app.get('/api/driver/vehicle', auth, role('DRIVER', 'ADMIN'), aw(async (req, res) => {
  const v = await driverVehicle(req.user.id); if (!v) return res.json({ vehicle: null });
  res.json({ vehicle: await vehicleJson(v), eta: await computeEtaInfo(v) });
}));
app.get('/api/driver/route', auth, role('DRIVER', 'ADMIN'), aw(async (req, res) => {
  const v = await driverVehicle(req.user.id); if (!v || !v.routeId) return res.json({ route: null });
  res.json({ route: await Route.findById(v.routeId).populate('stops') });
}));
app.get('/api/driver/gps-history', auth, role('DRIVER', 'ADMIN'), aw(async (req, res) => {
  const v = await driverVehicle(req.user.id); if (!v) return res.json([]);
  res.json(await GPSHistory.find({ vehicleId: v._id }).sort({ timestamp: -1 }).limit(Math.min(Number(req.query.limit) || 30, 200)));
}));
app.get('/api/driver/dashboard', auth, role('DRIVER', 'ADMIN'), aw(async (req, res) => {
  const v = await driverVehicle(req.user.id);
  if (!v) return res.json({ vehicle: null });
  const eta = await computeEtaInfo(v);
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  let trip = await Trip.findOne({ driverId: req.user.id, vehicleId: v._id, status: 'ONGOING' });
  if (!trip) trip = await Trip.findOne({ driverId: req.user.id, vehicleId: v._id, startTime: { $gte: dayStart } }).sort('-startTime');
  const pts = await GPSHistory.find({ vehicleId: v._id, timestamp: { $gte: trip ? trip.startTime : dayStart } }).sort('timestamp');
  let km = 0; for (let i = 1; i < pts.length; i++) km += haversine(pts[i - 1].latitude, pts[i - 1].longitude, pts[i].latitude, pts[i].longitude);
  const durationMin = trip && trip.startTime ? Math.round(((trip.endTime ? new Date(trip.endTime) : new Date()) - new Date(trip.startTime)) / 60000) : 0;
  const route = v.routeId ? await Route.findById(v.routeId).populate('stops') : null;
  res.json({
    vehicle: await vehicleJson(v), eta, route: route ? route.toJSON() : null, trip,
    stats: { distanceKm: +km.toFixed(1), durationMin, stopsCompleted: Math.min(v.progressIndex || 0, route ? route.stops.length : 0), stopsTotal: route ? route.stops.length : 0, onTime: null },
    recentGps: (await GPSHistory.find({ vehicleId: v._id }).sort({ timestamp: -1 }).limit(8)).map((p) => ({ time: p.timestamp, speed: p.speed, lat: p.latitude, lng: p.longitude })),
  });
}));
app.post('/api/driver/tracking/start', auth, role('DRIVER', 'ADMIN'), aw(async (req, res) => {
  const v = await driverVehicle(req.user.id); if (!v) return res.status(400).json({ error: 'No vehicle assigned to your account.' });
  let trip = await Trip.findOne({ driverId: req.user.id, vehicleId: v._id, status: 'ONGOING' });
  if (!trip) trip = await Trip.create({ userId: req.user.id, driverId: req.user.id, vehicleId: v._id, routeId: v.routeId, startTime: new Date(), startStop: v.routeId ? (await Route.findById(v.routeId)).startPoint : '', destinationStop: v.routeId ? (await Route.findById(v.routeId)).destination : '' });
  await auditSystem('TRACKING_START', 'vehicle', v._id, req.user.name + ' started GPS tracking for ' + v.vehicleNumber, 'SYSTEM', req.user.name);
  res.json({ trip, vehicleId: v._id.toString() });
}));
app.post('/api/driver/tracking/stop', auth, role('DRIVER', 'ADMIN'), aw(async (req, res) => {
  const v = await driverVehicle(req.user.id); if (!v) return res.status(400).json({ error: 'No vehicle assigned.' });
  const trip = await Trip.findOne({ driverId: req.user.id, vehicleId: v._id, status: 'ONGOING' });
  if (trip) {
    trip.endTime = new Date(); trip.status = 'COMPLETED';
    const pts = await GPSHistory.find({ vehicleId: v._id, timestamp: { $gte: trip.startTime, $lte: trip.endTime } }).sort('timestamp');
    let km = 0; for (let i = 1; i < pts.length; i++) km += haversine(pts[i - 1].latitude, pts[i - 1].longitude, pts[i].latitude, pts[i].longitude);
    trip.distanceKm = +km.toFixed(2); trip.completedStops = v.progressIndex || 0; await trip.save();
  }
  v.status = 'TRACKING_STOPPED'; await v.save();
  io.to('vehicle:' + v._id.toString()).to('admins').to('public').emit('vehicleStatusChanged', { vehicleId: v._id.toString(), status: 'TRACKING_STOPPED', lastUpdated: v.lastUpdated });
  await auditSystem('TRACKING_STOP', 'vehicle', v._id, req.user.name + ' stopped GPS tracking for ' + v.vehicleNumber, 'SYSTEM', req.user.name);
  res.json({ ok: true, trip });
}));
app.get('/api/driver/profile', auth, role('DRIVER'), aw(async (req, res) => {
  const u = await User.findById(req.user.id); const v = await driverVehicle(req.user.id);
  res.json({ user: publicUser(u), vehicle: v ? { _id: v._id.toString(), vehicleNumber: v.vehicleNumber, route: v.routeId } : null });
}));
app.put('/api/driver/profile', auth, role('DRIVER'), aw(async (req, res) => {
  const u = await User.findById(req.user.id);
  if (req.body.name) u.name = String(req.body.name).trim();
  if (req.body.phone !== undefined) u.phone = String(req.body.phone);
  await u.save(); res.json({ user: publicUser(u) });
}));

/* ================================== ADMIN ================================== */
const adminStats = aw(async (req, res) => {
  const week = new Date(Date.now() - 7 * 86400e3);
  const [totalVehicles, liveVehicles, offlineVehicles, totalDrivers, activeDrivers, totalRoutes, totalBusStops, totalUsers] = await Promise.all([
    Vehicle.countDocuments(), Vehicle.countDocuments({ status: 'LIVE' }), Vehicle.countDocuments({ status: 'OFFLINE' }),
    User.countDocuments({ role: 'DRIVER' }), User.countDocuments({ role: 'DRIVER', active: true }),
    Route.countDocuments(), BusStop.countDocuments(), User.countDocuments(),
  ]);
  const [wV, wD, wR, wS, wU] = await Promise.all([
    Vehicle.countDocuments({ createdAt: { $gte: week } }), User.countDocuments({ role: 'DRIVER', createdAt: { $gte: week } }),
    Route.countDocuments({ createdAt: { $gte: week } }), BusStop.countDocuments({ createdAt: { $gte: week } }), User.countDocuments({ createdAt: { $gte: week } }),
  ]);
  res.json({ totalVehicles, liveVehicles, offlineVehicles, totalDrivers, activeDrivers, totalRoutes, totalBusStops, totalUsers, livePercent: totalVehicles ? Math.round((liveVehicles / totalVehicles) * 100) : 0, week: { vehicles: wV, drivers: wD, routes: wR, stops: wS, users: wU } });
});
app.get('/api/admin/dashboard/stats', auth, role('ADMIN'), adminStats);
app.get('/api/admin/stats', auth, role('ADMIN'), adminStats);

app.get('/api/admin/activity', auth, role('ADMIN'), aw(async (req, res) => {
  const [logs, notifs] = await Promise.all([
    AuditLog.find().sort('-timestamp').limit(6),
    Notification.find({ type: { $in: ['SUCCESS', 'WARNING'] } }).sort('-createdAt').limit(6),
  ]);
  const items = [
    ...logs.map((l) => ({ kind: 'audit', icon: l.action, text: `${l.userName || 'Admin'} ${l.details || l.action + ' ' + l.resource}`, time: l.timestamp })),
    ...notifs.map((n) => ({ kind: 'event', icon: n.type, text: n.message, time: n.createdAt })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 8);
  res.json(items);
}));

app.get('/api/admin/drivers', auth, role('ADMIN'), aw(async (req, res) => {
  const drivers = await User.find({ role: 'DRIVER' }).sort('-createdAt');
  const vehicles = await Vehicle.find().populate('routeId', 'name routeNumber');
  res.json(drivers.map((d) => {
    const v = vehicles.find((x) => x.driverId && x.driverId.toString() === d._id.toString());
    return { ...publicUser(d), vehicle: v ? { _id: v._id.toString(), vehicleNumber: v.vehicleNumber, status: v.status, lastUpdated: v.lastUpdated, route: v.routeId, currentLocation: v.currentLocation } : null };
  }));
}));
app.post('/api/admin/drivers', auth, role('ADMIN'), aw(async (req, res) => {
  const { name, email, password, phone, licenseNumber } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (await User.findOne({ email: String(email).toLowerCase() })) return res.status(409).json({ error: 'Email already in use.' });
  const u = await User.create({ name, email, phone: phone || '', licenseNumber: licenseNumber || '', passwordHash: await bcrypt.hash(String(password), 10), role: 'DRIVER' });
  await audit(req, 'CREATE', 'driver', u._id, 'Added driver ' + u.name);
  res.status(201).json(publicUser(u));
}));
app.put('/api/admin/drivers/:id', auth, role('ADMIN'), aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid id.' });
  const u = await User.findById(req.params.id); if (!u || u.role !== 'DRIVER') return res.status(404).json({ error: 'Driver not found.' });
  const { name, phone, licenseNumber, active, assignedVehicleId } = req.body || {};
  if (name) u.name = name; if (phone !== undefined) u.phone = phone; if (licenseNumber !== undefined) u.licenseNumber = licenseNumber;
  if (active !== undefined) u.active = !!active;
  await u.save();
  if (assignedVehicleId !== undefined) {
    const vid = cleanId(assignedVehicleId);
    await Vehicle.updateMany({ driverId: u._id }, { driverId: null });
    if (vid) { await Vehicle.findByIdAndUpdate(vid, { driverId: u._id }); await Vehicle.updateMany({ _id: { $ne: vid }, driverId: u._id }, { driverId: null }); }
    await audit(req, 'ASSIGN', 'driver', u._id, 'Vehicle assignment changed for ' + u.name);
  } else await audit(req, 'UPDATE', 'driver', u._id, 'Updated driver ' + u.name);
  res.json(publicUser(u));
}));
app.delete('/api/admin/drivers/:id', auth, role('ADMIN'), aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid id.' });
  const u = await User.findById(req.params.id); if (!u || u.role !== 'DRIVER') return res.status(404).json({ error: 'Driver not found.' });
  const assigned = await Vehicle.findOne({ driverId: u._id, status: 'LIVE' });
  if (assigned && req.body.force !== true) return res.status(409).json({ error: 'Driver is assigned to live vehicle ' + assigned.vehicleNumber + '. Reassign or confirm unassigning.', needConfirm: true });
  await Vehicle.updateMany({ driverId: u._id }, { driverId: null });
  await User.findByIdAndDelete(u._id);
  await audit(req, 'DELETE', 'driver', u._id, 'Deleted driver ' + u.name);
  res.json({ ok: true });
}));

app.get('/api/admin/users', auth, role('ADMIN'), aw(async (req, res) => res.json((await User.find().sort('-createdAt')).map(publicUser))));
app.get('/api/users', auth, role('ADMIN'), aw(async (req, res) => {
  const users = await User.find().sort('-createdAt'); const vehicles = await Vehicle.find().select('vehicleNumber driverId status lastUpdated');
  res.json(users.map((u) => ({ ...publicUser(u), vehicle: vehicles.find((v) => v.driverId && v.driverId.toString() === u._id.toString()) || null })));
}));
app.post('/api/users', auth, role('ADMIN'), aw(async (req, res) => {
  const { name, email, password, role: r } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (!['PASSENGER', 'DRIVER', 'ADMIN'].includes(r)) return res.status(400).json({ error: 'Invalid role.' });
  if (await User.findOne({ email: String(email).toLowerCase() })) return res.status(409).json({ error: 'Email already in use.' });
  const u = await User.create({ name, email, passwordHash: await bcrypt.hash(String(password), 10), role: r });
  await audit(req, 'CREATE', 'user', u._id, 'Created ' + r + ' account ' + u.email);
  res.status(201).json(publicUser(u));
}));
app.put('/api/admin/users/:id', auth, role('ADMIN'), aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid id.' });
  const u = await User.findById(req.params.id); if (!u) return res.status(404).json({ error: 'User not found.' });
  const { role: r, active } = req.body || {};
  if (r && ['PASSENGER', 'DRIVER', 'ADMIN'].includes(r)) u.role = r;
  if (active !== undefined) u.active = !!active;
  await u.save(); await audit(req, 'UPDATE', 'user', u._id, `Updated ${u.email} (role=${u.role}, active=${u.active})`);
  res.json(publicUser(u));
}));
app.patch('/api/users/:id/active', auth, role('ADMIN'), aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid id.' });
  const u = await User.findById(req.params.id); if (!u) return res.status(404).json({ error: 'User not found.' });
  u.active = !!req.body.active; await u.save();
  await audit(req, u.active ? 'ACTIVATE' : 'DEACTIVATE', 'user', u._id, (u.active ? 'Activated ' : 'Deactivated ') + u.email);
  res.json(publicUser(u));
}));
app.delete('/api/admin/users/:id', auth, role('ADMIN'), aw(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid id.' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  const u = await User.findByIdAndDelete(req.params.id); if (!u) return res.status(404).json({ error: 'User not found.' });
  await Vehicle.updateMany({ driverId: u._id }, { driverId: null });
  await audit(req, 'DELETE', 'user', u._id, 'Deleted account ' + u.email);
  res.json({ ok: true });
}));

app.get('/api/admin/notifications', auth, role('ADMIN'), aw(async (req, res) => res.json(await Notification.find().sort('-createdAt').limit(100))));
app.post('/api/admin/notifications', auth, role('ADMIN'), aw(async (req, res) => {
  const { title, message, type, target } = req.body || {};
  if (!title || !message) return res.status(400).json({ error: 'Title and message are required.' });
  let created = [];
  if (target === 'ALL' || target === 'PASSENGERS' || target === 'DRIVERS') created = [await notifyAudience(target, title, message, type || 'INFO')];
  else created = [await notifyUser(target, title, message, type || 'INFO')];
  await audit(req, 'CREATE', 'notification', created[0]._id, 'Sent notification: ' + title);
  res.status(201).json(created[0]);
}));

app.get('/api/admin/gps-history', auth, role('ADMIN'), aw(async (req, res) => {
  const filter = {};
  if (req.query.vehicleId) filter.vehicleId = req.query.vehicleId;
  if (req.query.from || req.query.to) { filter.timestamp = {}; if (req.query.from) filter.timestamp.$gte = new Date(req.query.from); if (req.query.to) filter.timestamp.$lte = new Date(req.query.to); }
  if (req.query.routeId) { const ids = (await Vehicle.find({ routeId: req.query.routeId }).select('_id')).map((v) => v._id); filter.vehicleId = { $in: ids }; }
  const rows = await GPSHistory.find(filter).sort('-timestamp').limit(Math.min(Number(req.query.limit) || 200, 1000)).populate({ path: 'vehicleId', select: 'vehicleNumber' });
  res.json(rows);
}));

app.get('/api/admin/reports', auth, role('ADMIN'), aw(async (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : null, to = req.query.to ? new Date(req.query.to) : null;
  const vFilter = {}; if (req.query.vehicleId) vFilter._id = req.query.vehicleId; if (req.query.routeId) vFilter.routeId = req.query.routeId; if (req.query.driverId) vFilter.driverId = req.query.driverId;
  const vehicles = await Vehicle.find(vFilter).populate('routeId', 'name routeNumber');
  const vIds = vehicles.map((v) => v._id);
  const gpsFilter = { vehicleId: { $in: vIds } }; if (from || to) { gpsFilter.timestamp = {}; if (from) gpsFilter.timestamp.$gte = from; if (to) gpsFilter.timestamp.$lte = to; }
  const [gpsUpdates, trips, routes, drivers] = await Promise.all([
    GPSHistory.countDocuments(gpsFilter),
    Trip.find(from || to ? { startTime: { $gte: from || new Date(0), $lte: to || new Date() } } : {}).populate('routeId', 'name routeNumber'),
    Route.find(), User.find({ role: 'DRIVER' }),
  ]);
  const completed = trips.filter((t) => t.status === 'COMPLETED');
  const avgDur = completed.length ? Math.round(completed.reduce((a, t) => a + ((t.endTime ? new Date(t.endTime) : new Date()) - new Date(t.startTime)) / 60000, 0) / completed.length) : 0;
  res.json({
    fleet: { total: vehicles.length, active: vehicles.filter((v) => v.status === 'LIVE').length, offline: vehicles.filter((v) => v.status === 'OFFLINE').length },
    drivers: { total: drivers.length, active: drivers.filter((d) => d.active).length, inactive: drivers.filter((d) => !d.active).length },
    routes: routes.map((r) => ({ _id: r._id.toString(), name: r.name, stops: r.stops.length, vehicles: vehicles.filter((v) => v.routeId && v.routeId._id.toString() === r._id.toString()).length })),
    trips: { total: trips.length, completed: completed.length, avgDurationMin: avgDur },
    gps: { updates: gpsUpdates, offlineVehicles: vehicles.filter((v) => v.status === 'OFFLINE').length },
  });
}));

app.get('/api/admin/audit-logs', auth, role('ADMIN'), aw(async (req, res) => {
  const filter = {};
  if (req.query.category) filter.category = req.query.category;
  if (req.query.action) filter.action = req.query.action;
  if (req.query.userId) filter.userId = req.query.userId;
  if (req.query.from || req.query.to) { filter.timestamp = {}; if (req.query.from) filter.timestamp.$gte = new Date(req.query.from); if (req.query.to) filter.timestamp.$lte = new Date(req.query.to); }
  if (req.query.q) { const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.$or = [{ details: rx }, { userName: rx }, { resource: rx }, { action: rx }]; }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const [total, rows] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter).sort('-timestamp').skip((page - 1) * limit).limit(limit),
  ]);
  res.json({ total, page, limit, pages: Math.ceil(total / limit) || 1, rows });
}));
app.get('/api/admin/audit-logs/stats', auth, role('ADMIN'), aw(async (req, res) => {
  const day = new Date(Date.now() - 86400e3);
  const [total, today, authC, security, system, admin] = await Promise.all([
    AuditLog.countDocuments({}), AuditLog.countDocuments({ timestamp: { $gte: day } }),
    AuditLog.countDocuments({ category: 'AUTH' }), AuditLog.countDocuments({ category: 'SECURITY' }),
    AuditLog.countDocuments({ category: 'SYSTEM' }), AuditLog.countDocuments({ category: 'ADMIN' }),
  ]);
  res.json({ total, today, auth: authC, security, system, admin });
}));

app.get('/api/admin/settings', auth, role('ADMIN'), aw(async (req, res) => res.json(await getSettings())));
app.put('/api/admin/settings', auth, role('ADMIN'), aw(async (req, res) => {
  const s = await getSettings();
  ['systemName', 'timezone', 'gpsUpdateIntervalSec', 'delayedAfterSec', 'offlineAfterSec', 'arrivalRadiusM', 'sessionHours', 'passwordMinLength'].forEach((k) => { if (req.body[k] !== undefined) s[k] = req.body[k]; });
  if (Array.isArray(req.body.notifyMinutes)) s.notifyMinutes = req.body.notifyMinutes.map(Number);
  if (Array.isArray(req.body.notifyDistanceM)) s.notifyDistanceM = req.body.notifyDistanceM.map(Number);
  await s.save(); await audit(req, 'UPDATE', 'settings', s._id, 'Updated system settings');
  res.json(s);
}));

/* ============================ STATIC + FALLBACK ============================ */
app.use(express.static(path.join(__dirname, '..', 'client', 'build')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return res.status(404).json({ error: 'Not found' });
  const indexPath = path.join(__dirname, '..', 'client', 'build', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send(`
      <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; text-align: center; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h1 style="color: #2563eb;">🚀 CarTracker API is Online</h1>
        <p style="color: #475569;">Backend running on port ${PORT}.</p>
        <p style="margin-top: 15px;">Open the frontend at: <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}" style="font-weight: bold; color: #1d4ed8;">${process.env.CLIENT_URL || 'http://localhost:3000'}</a></p>
      </div>
    `);
  }
});

app.use((err, req, res, next) => {
  console.error('[ERROR]', req.method, req.originalUrl, '→', err.message);
  if (IS_DEV) console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

/* ========================== DEV SEED ========================== */
async function seed() {
  try {
    const indexes = await Vehicle.collection.indexes();
    const geoIdx = indexes.find((idx) => idx.name && idx.name.includes('currentLocation'));
    if (geoIdx) {
      try { await Vehicle.findOne({ currentLocation: { $near: { $geometry: { type: 'Point', coordinates: [30, -2] }, $maxDistance: 1000 } } }); }
      catch (e) { console.log('[seed] Dropping broken 2dsphere index...'); await Vehicle.collection.dropIndex(geoIdx.name); }
    }
    await Vehicle.createIndexes();
  } catch (e) { console.error('[seed] index fix:', e.message); }

  if (!SEED_DEMO_DATA || (await User.countDocuments()) > 0) return;
  console.log('[seed] Creating DEMO development data (vehicles start OFFLINE — real GPS required)...');
  const [passenger, driver, admin] = await User.create([
    { name: 'Mugisha Fabrice', email: 'passenger@demo.com', phone: '0780000001', passwordHash: await bcrypt.hash('demo1234', 10), role: 'PASSENGER' },
    { name: 'Uwase Alice', email: 'driver@demo.com', phone: '0780000002', licenseNumber: 'DL-2214', passwordHash: await bcrypt.hash('demo1234', 10), role: 'DRIVER' },
    { name: 'System Admin', email: 'admin@demo.com', phone: '0780000003', passwordHash: await bcrypt.hash('admin1234', 10), role: 'ADMIN' },
  ]);
  const S = (name, lat, lng, address) => ({ name, address, geofenceRadius: 100, location: { type: 'Point', coordinates: [lng, lat] } });
  const stops = await BusStop.create([
    S('Kimironko', -1.9369, 30.1122, 'Kimironko Market, Gasabo'), S('Remera', -1.9423, 30.1006, 'Remera, Gasabo'),
    S('Kacyiru', -1.9352, 30.0851, 'Kacyiru, Gasabo'), S('Gacuriro', -1.9285, 30.0925, 'Gacuriro, Gasabo'),
    S('Downtown', -1.9441, 30.0619, 'City Centre, Nyarugenge'), S('Nyabugogo', -1.9462, 30.0453, 'Nyabugogo Bus Park'),
    S('Nyamirambo', -1.9546, 30.0344, 'Nyamirambo, Nyarugenge'), S('Kimisagara', -1.9657, 30.0425, 'Kimisagara, Nyarugenge'),
    S('Kicukiro', -1.9667, 30.0833, 'Kicukiro Centre'), S('Rugando', -1.9478, 30.1163, 'Rugando, Kicukiro'),
  ]);
  const byName = (n) => stops.find((s) => s.name === n);
  const geo = (names) => {
    const pts = names.map((n) => { const s = byName(n); return [s.location.coordinates[1], s.location.coordinates[0]]; });
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) { out.push(pts[i]); out.push([(pts[i][0] + pts[i + 1][0]) / 2 + (i % 2 ? 0.004 : -0.004), (pts[i][1] + pts[i + 1][1]) / 2 + (i % 2 ? -0.004 : 0.004)]); }
    out.push(pts[pts.length - 1]); return out;
  };
  const mk = (rn, names) => ({ routeNumber: rn, name: rn, startPoint: names[0], destination: names[names.length - 1], stops: names.map((n) => byName(n)._id), geometry: geo(names) });
  const routes = await Route.create([
    mk('Route 1', ['Nyabugogo', 'Nyamirambo', 'Downtown', 'Remera', 'Kacyiru']),
    mk('Route 2', ['Rugando', 'Remera', 'Kacyiru', 'Downtown', 'Kimisagara']),
    mk('Route 3', ['Kimironko', 'Remera', 'Kacyiru', 'Gacuriro', 'Downtown']),
    mk('Route 5', ['Kicukiro', 'Kimironko', 'Remera', 'Downtown', 'Nyamirambo']),
  ]);
  for (const r of routes) await BusStop.updateMany({ _id: { $in: r.stops } }, { $addToSet: { routes: r._id } });
  await Vehicle.create([
    { vehicleNumber: 'RT-204', licensePlate: 'RAC 204J', routeId: routes[2]._id, driverId: driver._id, status: 'OFFLINE', currentLocation: undefined },
    { vehicleNumber: 'RT-317', licensePlate: 'RAC 317J', routeId: routes[0]._id, status: 'OFFLINE', currentLocation: undefined },
    { vehicleNumber: 'RT-126', licensePlate: 'RAC 126J', routeId: routes[1]._id, status: 'OFFLINE', currentLocation: undefined },
    { vehicleNumber: 'RT-089', licensePlate: 'RAC 089J', routeId: routes[3]._id, status: 'OFFLINE', currentLocation: undefined },
  ]);
  await Settings.create({});
  console.log('[seed] DEMO accounts → passenger@demo.com/demo1234 · driver@demo.com/demo1234 · admin@demo.com/admin1234');
}

mongoose.connect(MONGO_URI).then(async () => {
  console.log('[db] MongoDB connected:', MONGO_URI);
  await seed();
  server.listen(PORT, () => console.log(`[server] CarTracker API + Socket.IO on http://localhost:${PORT} (real-GPS mode)`));
}).catch((err) => { console.error('[db] MongoDB connection failed:', err.message); process.exit(1); });