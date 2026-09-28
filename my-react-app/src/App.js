import React, { useState, useEffect, useRef, useContext, createContext, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { io } from 'socket.io-client';

/* ================================ CONFIG ================================ */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const BLUE = '#2563eb';

/* Design tokens */
const NAVY = 'bg-gradient-to-b from-[#0a1f3c] via-[#0c2648] to-[#0e2d55]';
const GRADS = {
  blue: 'from-blue-500 to-blue-700',
  green: 'from-emerald-500 to-green-600',
  purple: 'from-violet-500 to-purple-600',
  orange: 'from-orange-400 to-amber-500',
  red: 'from-rose-500 to-red-600',
  cyan: 'from-cyan-500 to-teal-500',
  slate: 'from-slate-500 to-slate-700',
};

const getToken = () => localStorage.getItem('ct_token') || sessionStorage.getItem('ct_token');
const setToken = (t, remember) => { localStorage.removeItem('ct_token'); sessionStorage.removeItem('ct_token'); (remember ? localStorage : sessionStorage).setItem('ct_token', t); };
const clearToken = () => { localStorage.removeItem('ct_token'); sessionStorage.removeItem('ct_token'); };

async function api(path, opts = {}) {
  const res = await fetch(API_BASE + '/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { if (res.status === 401) clearToken(); const e = new Error(data.error || data.message || 'Request failed (' + res.status + ')'); e.status = res.status; e.payload = data; throw e; }
  return data;
}

/* ================================ HELPERS ================================ */
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) : '');
function timeAgo(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 5) return 'just now'; if (s < 60) return Math.floor(s) + ' sec ago';
  if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
const etaLabel = (m) => (m == null ? '—' : m + ' min');
const initials = (n) => (n || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
function useNow(ms = 30000) { const [n, setN] = useState(new Date()); useEffect(() => { const t = setInterval(() => setN(new Date()), ms); return () => clearInterval(t); }, [ms]); return n; }
function exportCsv(filename, rows) {
  if (!rows || !rows.length) return;
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => JSON.stringify(r[c] == null ? '' : r[c])).join(','))).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = filename; a.click();
}
const STATUS_META = {
  LIVE: { label: 'Live', dot: 'bg-green-500', badge: 'green' },
  GPS_DELAYED: { label: 'GPS Delayed', dot: 'bg-amber-500', badge: 'amber' },
  OFFLINE: { label: 'Offline', dot: 'bg-red-500', badge: 'red' },
  TRACKING_STOPPED: { label: 'Tracking stopped', dot: 'bg-slate-400', badge: 'gray' },
  IN_SERVICE: { label: 'In Service', dot: 'bg-blue-500', badge: 'blue' },
};
const sMeta = (s) => STATUS_META[s] || STATUS_META.OFFLINE;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function normalizeRwandaPhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('250') && digits.length === 12) digits = digits.slice(3);
  return digits;
}

/* ================================ ROUTER ================================ */
function useRoute() {
  const [h, setH] = useState(window.location.hash.slice(1) || '/');
  useEffect(() => { const f = () => setH(window.location.hash.slice(1) || '/'); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return h;
}
const navigate = (to) => { window.location.hash = to; };
function parseHash(h) { const [path, qs] = h.split('?'); return { path: path || '/', params: new URLSearchParams(qs || '') }; }
function matchPath(pattern, path) {
  const p = pattern.split('/').filter(Boolean), a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) { if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]); else if (p[i] !== a[i]) return null; }
  return params;
}

/* ================================ ICONS ================================ */
const ICON_PATHS = {
  home: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>,
  map: <><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="2" x2="16" y2="18" /></>,
  route: <><circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" /></>,
  pin: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>,
  login: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></>,
  search: <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  bus: <><rect x="3" y="3" width="18" height="15" rx="2.5" /><path d="M3 10h18" /><path d="M8 21v-3M16 21v-3" /><circle cx="8" cy="14" r="0.5" fill="currentColor" /><circle cx="16" cy="14" r="0.5" fill="currentColor" /></>,
  gauge: <><path d="M12 14l3.5-3.5" /><path d="M20.3 18a10 10 0 1 0-16.6 0" /></>,
  nav: <polygon points="3 11 22 2 13 21 11 13 3 11" />,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  minus: <line x1="5" y1="12" x2="19" y2="12" />,
  locate: <><line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" /><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /></>,
  layers: <><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
  chevron: <polyline points="6 9 12 15 18 9" />,
  menu: <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  phone: <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></>,
  edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
  trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  play: <polygon points="6 3 20 12 6 21 6 3" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  info: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>,
  alert: <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
  arrow: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  shieldcheck: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></>,
  mail: <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>,
  eyeoff: <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>,
  chart: <><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
  up: <><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></>,
  down: <><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></>,
  signal: <><path d="M2 20h.01" /><path d="M7 20v-4" /><path d="M12 20v-8" /><path d="M17 20V8" /><path d="M22 4v16" /></>,
  star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
};
function Icon({ name, className = 'w-5 h-5' }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICON_PATHS[name] || null}</svg>;
}
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A10.97 10.97 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
);
function LogoMark({ className = 'w-10 h-10' }) {
  return (
    <span className={`relative inline-block ${className}`}>
      <svg viewBox="0 0 24 24" className="w-full h-full drop-shadow-md" fill="url(#lg1)"><defs><linearGradient id="lg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#3b82f6" /><stop offset="100%" stopColor="#1d4ed8" /></linearGradient></defs><path d="M12 2a8 8 0 0 0-8 8c0 5.4 7 11.5 7.3 11.8a1 1 0 0 0 1.4 0C13 21.5 20 15.4 20 10a8 8 0 0 0-8-8z" /></svg>
      <span className="absolute inset-0 flex items-center justify-center" style={{ paddingTop: '12%' }}>
        <Icon name="bus" className="w-[46%] h-[46%] text-white" />
      </span>
    </span>
  );
}

/* ============================== PRIMITIVES ============================== */
const Card = ({ className = '', children }) => <div className={`bg-white rounded-2xl border border-slate-200/70 shadow-[0_1px_3px_rgba(15,23,42,0.06)] ${className}`}>{children}</div>;
const GradIcon = ({ color = 'blue', name, className = 'w-5 h-5', size = 'w-11 h-11 rounded-xl' }) => (
  <span className={`${size} bg-gradient-to-br ${GRADS[color]} text-white flex items-center justify-center shadow-md shrink-0`}><Icon name={name} className={className} /></span>
);
const Badge = ({ color = 'green', children }) => {
  const c = { green: 'bg-green-100 text-green-700', blue: 'bg-blue-100 text-blue-700', red: 'bg-red-100 text-red-600', gray: 'bg-slate-100 text-slate-600', amber: 'bg-amber-100 text-amber-700', purple: 'bg-purple-100 text-purple-700' }[color];
  return <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ${c}`}>{children}</span>;
};
const StatusBadge = ({ status }) => { const m = sMeta(status); return <Badge color={m.badge}><span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />{m.label}</Badge>; };
const LiveDot = ({ status }) => { const m = sMeta(status); return <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><span className={`w-2 h-2 rounded-full ${m.dot}`} />{m.label}</span>; };
const Skeleton = ({ className = '' }) => <div className={`animate-pulse bg-slate-200 rounded-lg ${className}`} />;
const EmptyState = ({ icon = 'info', title, sub }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center px-4">
    <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3"><Icon name={icon} className="w-6 h-6" /></div>
    <p className="text-sm font-semibold text-slate-700">{title}</p>
    {sub && <p className="text-xs text-slate-500 mt-1 max-w-xs">{sub}</p>}
  </div>
);
const ErrorState = ({ message, retry }) => (
  <div className="flex flex-col items-center justify-center py-10 text-center px-4">
    <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center text-red-500 mb-3"><Icon name="alert" className="w-6 h-6" /></div>
    <p className="text-sm font-semibold text-slate-700">Something went wrong</p>
    <p className="text-xs text-slate-500 mt-1 max-w-sm">{message}</p>
    {retry && <button onClick={retry} className="mt-3 text-xs font-medium text-blue-600 hover:underline">Try again</button>}
  </div>
);
const Input = (props) => <input {...props} className={`w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 bg-white placeholder:text-slate-400 ${props.className || ''}`} />;
const Select = (props) => <select {...props} className={`w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 bg-white ${props.className || ''}`} />;
const Label = ({ children }) => <label className="block text-xs font-semibold text-slate-600 mb-1.5">{children}</label>;
const Btn = ({ variant = 'primary', className = '', ...props }) => {
  const v = {
    primary: 'bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-700 hover:to-blue-600 shadow-md shadow-blue-600/20',
    outline: 'border border-slate-200 text-slate-700 hover:bg-slate-50 bg-white',
    danger: 'bg-gradient-to-r from-red-600 to-rose-500 text-white hover:from-red-700 hover:to-rose-600 shadow-md shadow-red-600/20',
    dangerOutline: 'border border-red-200 text-red-600 hover:bg-red-50 bg-white',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }[variant];
  return <button {...props} className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${v} ${className}`} />;
};
function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center"><Icon name="x" className="w-5 h-5" /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
function Confirm({ open, title, message, confirmLabel = 'Delete', onConfirm, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-slate-600">{message}</p>
      <div className="flex justify-end gap-2 mt-6">
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" onClick={onConfirm}>{confirmLabel}</Btn>
      </div>
    </Modal>
  );
}
function MapPick({ lat, lng, onChange }) {
  const ref = useRef(null); const mapRef = useRef(null); const mkRef = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const map = L.map(ref.current, { zoomControl: true });
    map.setView([lat || -1.9441, lng || 30.0619], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    map.on('click', (e) => onChange(+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5)));
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => { clearTimeout(t); map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const map = mapRef.current; if (!map || lat == null || lng == null) return;
    if (!mkRef.current) mkRef.current = L.marker([lat, lng]).addTo(map); else mkRef.current.setLatLng([lat, lng]);
  }, [lat, lng]);
  return <div><div ref={ref} className="h-48 rounded-xl border border-slate-200 z-0" /><p className="text-[11px] text-slate-400 mt-1">Click the map to choose coordinates.</p></div>;
}
function FormModal({ open, onClose, title, fields, initial, onSubmit, saving }) {
  const [vals, setVals] = useState(initial || {});
  useEffect(() => { if (open) setVals(initial || {}); }, [open, initial]);
  if (!open) return null;
  const set = (k, v) => setVals((f) => ({ ...f, [k]: v }));
  return (
    <Modal open onClose={onClose} title={title} wide={fields.some((f) => f.type === 'mappick')}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(vals); }} className="space-y-4">
        {fields.map((f) => (
          <div key={f.key}>
            <Label>{f.label}{f.required ? ' *' : ''}</Label>
            {f.type === 'select' ? (
              <Select required={f.required} value={vals[f.key] || ''} onChange={(e) => set(f.key, e.target.value || null)}>
                <option value="">{f.placeholder || 'Select...'}</option>
                {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            ) : f.type === 'mappick' ? (
              <MapPick lat={vals.latitude} lng={vals.longitude} onChange={(la, ln) => setVals((v2) => ({ ...v2, latitude: la, longitude: ln }))} />
            ) : (
              <Input required={f.required} type={f.type || 'text'} step={f.step} value={vals[f.key] == null ? '' : vals[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />
            )}
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <Btn type="button" variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Btn>
        </div>
      </form>
    </Modal>
  );
}
const StatCard = ({ icon, color = 'blue', label, value, sub, subColor = 'text-green-600', loading }) => (
  <Card className="p-4">
    {loading ? <Skeleton className="h-16" /> : (
      <div className="flex items-start gap-3">
        <GradIcon color={color} name={icon} />
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-500 truncate">{label}</p>
          <p className="text-xl font-extrabold text-slate-800 mt-0.5">{value}</p>
          {sub && <p className={`text-[11px] font-semibold ${subColor} mt-0.5`}>{sub}</p>}
        </div>
      </div>
    )}
  </Card>
);

/* =============================== CONTEXTS =============================== */
const ToastCtx = createContext(null);
const AuthCtx = createContext(null);
const SocketCtx = createContext({ socket: null, connected: false });
const VehiclesCtx = createContext(null);
const useToast = () => useContext(ToastCtx);
const useAuth = () => useContext(AuthCtx);
const useSocket = () => useContext(SocketCtx);
const useVehicles = () => useContext(VehiclesCtx);

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[1300] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => <div key={t.id} className={`px-4 py-3 rounded-xl shadow-xl text-sm text-white backdrop-blur ${t.type === 'error' ? 'bg-red-600/95' : t.type === 'success' ? 'bg-green-600/95' : 'bg-slate-800/95'}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api('/users/me').then((d) => setUser(d.user)).catch(() => clearToken()).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const login = async (identifier, password, remember) => {
    const d = await api('/auth/login', { method: 'POST', body: { identifier, password } });
    setToken(d.token, remember); setUser(d.user); return d.user;
  };
  const register = async (payload) => { const d = await api('/auth/register', { method: 'POST', body: payload }); setToken(d.token, false); setUser(d.user); return d.user; };
  const adoptToken = async (t) => { setToken(t, false); const d = await api('/users/me'); setUser(d.user); return d.user; };
  const logout = async () => { try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ } clearToken(); setUser(null); navigate('/login'); };
  return <AuthCtx.Provider value={{ user, setUser, login, register, adoptToken, logout, loading }}>{children}</AuthCtx.Provider>;
}
function SocketProvider({ children }) {
  const { user } = useAuth();
  const [st, setSt] = useState({ socket: null, connected: false });
  const userId = user ? user._id : null;
  useEffect(() => {
    const s = io(API_BASE, { transports: ['websocket', 'polling'], auth: { token: getToken() || undefined } });
    const on = () => setSt({ socket: s, connected: true });
    const off = () => setSt({ socket: s, connected: false });
    s.on('connect', on); s.on('disconnect', off); s.on('connect_error', off);
    setSt({ socket: s, connected: s.connected });
    return () => { s.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  return <SocketCtx.Provider value={st}>{children}</SocketCtx.Provider>;
}
function VehiclesProvider({ children }) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const load = useCallback(() => {
    if (!user) return;
    setLoading(true);
    api('/vehicles').then((v) => { setVehicles(v); setSelectedId((s) => s || (v[0] ? v[0]._id : null)); setError(null); })
      .catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [user]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!socket) return;
    const h1 = (p) => setVehicles((vs) => vs.map((v) => (v._id === p.vehicleId ? { ...v, currentLocation: { type: 'Point', coordinates: [p.longitude, p.latitude] }, speed: p.speed, heading: p.heading, status: p.status, lastUpdated: p.lastUpdated, eta: p.eta, nextStopName: p.nextStop, etaMinutes: p.etaMinutes } : v)));
    const h2 = (p) => setVehicles((vs) => vs.map((v) => (v._id === p.vehicleId ? { ...v, status: p.status, lastUpdated: p.lastUpdated } : v)));
    socket.on('vehicleLocationUpdated', h1); socket.on('vehicleStatusChanged', h2);
    return () => { socket.off('vehicleLocationUpdated', h1); socket.off('vehicleStatusChanged', h2); };
  }, [socket]);
  const selectVehicle = useCallback((id) => setSelectedId(id), []);
  return <VehiclesCtx.Provider value={{ vehicles, loading, error, reload: load, selectedId, selectVehicle }}>{children}</VehiclesCtx.Provider>;
}

/* ================================ MAP VIEW ================================ */
const busIcon = (color, heading) => L.divIcon({
  className: '', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -16],
  html: `<div style="width:36px;height:36px;background:${color};border:2.5px solid #fff;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;transform:rotate(${heading || 0}deg)">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="15" rx="2.5"/><path d="M3 10h18"/><path d="M8 21v-3M16 21v-3"/></svg></div>`,
});
const stopIcon = () => L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -8], html: '<div style="width:15px;height:15px;background:#fff;border:3px solid #2563eb;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.25)"></div>' });
const startIcon = () => L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -9], html: '<div style="width:16px;height:16px;background:#16a34a;border:2.5px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>' });
const endIcon = () => L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 26], popupAnchor: [0, -24], html: '<svg width="28" height="28" viewBox="0 0 24 24" fill="#dc2626" stroke="#fff" stroke-width="1.4"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3" fill="#fff" stroke="none"/></svg>' });
const yourStopIcon = () => L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 28], popupAnchor: [0, -26], html: '<div style="width:26px;height:26px;background:#2563eb;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><div style="width:8px;height:8px;background:#fff;border-radius:50%;transform:rotate(45deg)"></div></div>' });
const personIcon = (color = '#7c3aed', isOnline = true) => L.divIcon({
  className: '', iconSize: [40, 48], iconAnchor: [20, 48], popupAnchor: [0, -44],
  html: `<div style="position:relative;width:40px;height:48px">
    <div style="position:absolute;top:0;left:0;width:40px;height:40px;background:${isOnline ? color : '#94a3b8'};border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;opacity:${isOnline ? 1 : 0.6}">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    </div>
    <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:10px solid ${isOnline ? color : '#94a3b8'};opacity:${isOnline ? 1 : 0.6}"></div>
    ${isOnline ? '<div style="position:absolute;top:2px;right:2px;width:10px;height:10px;background:#22c55e;border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px rgba(34,197,94,0.6)"></div>' : ''}
  </div>`,
});

function vehiclePopupHtml(v) {
  const r = v.routeId; const m = sMeta(v.status);
  return `<div style="min-width:160px"><b style="font-size:13px">${v.vehicleNumber}</b>
    ${v.driverId ? `<div style="color:#1e293b;font-size:12px;margin-top:2px;">Driver: ${v.driverId.name || '—'}</div>` : ''}
    ${r ? `<div style="color:#64748b">${r.name || ''}<br/>${r.startPoint || ''} → ${r.destination || ''}</div>` : ''}
    <div style="margin-top:4px">Speed: <b>${Math.round(v.speed || 0)} km/h</b></div>
    <div>Next: <b>${v.nextStopName || '—'}</b> · ETA <b style="color:#2563eb">${etaLabel(v.etaMinutes)}</b></div>
    <div style="color:#64748b">Status: ${m.label}</div>
    <div style="color:#94a3b8;font-size:11px">Last update: ${timeAgo(v.lastUpdated)}</div></div>`;
}
function personPopupHtml(p) {
  const isOnline = p.isSharing !== false && (!p.lastUpdate || (Date.now() - new Date(p.lastUpdate).getTime() < 120000));
  const roleLabel = p.isDriver ? 'Driver' : p.role === 'UNREGISTERED' ? 'Unregistered' : 'User';
  return `<div style="min-width:160px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <div style="width:28px;height:28px;border-radius:50%;background:${p.isDriver ? '#2563eb' : '#7c3aed'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${initials(p.name || 'P')}</div>
      <div><b style="font-size:13px">${p.name || 'Person'}</b><div style="color:#64748b;font-size:11px">${roleLabel}</div></div>
    </div>
    ${p.phone ? `<div style="color:#64748b;font-size:11px">📱 ${p.phone}</div>` : ''}
    <div style="margin-top:4px">Speed: <b>${Math.round(p.speed || 0)} km/h</b></div>
    <div style="color:${isOnline ? '#16a34a' : '#dc2626'};margin-top:4px;font-size:11px;font-weight:600">${isOnline ? '🟢 Live' : '🔴 Offline'}</div>
    <div style="color:#94a3b8;font-size:11px">Updated: ${p.lastUpdate ? timeAgo(p.lastUpdate) : '—'}</div>
  </div>`;
}

function MapView({ route, vehicles, selectedVehicleId, onSelectVehicle, userLocation, heightClass = 'h-[380px] md:h-[520px]', showLegend = true, fitOnRoute = true, centerOnSelect = false, onMapClick, historyPoints, yourStopId, persons = [], selectedPersonPhone = null, onSelectPerson = null }) {
  const divRef = useRef(null); const mapRef = useRef(null); const baseRef = useRef(null); const satRef = useRef(null);
  const layersRef = useRef({ polyline: null, stops: [], markers: {}, history: [], personMarkers: {} });
  const [satellite, setSatellite] = useState(false);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showStops, setShowStops] = useState(true);
  const toast = useToast();
  const routeId = route ? route._id : null;
  const youRef = useRef(null);

  useEffect(() => {
    if (!divRef.current) return;
    const map = L.map(divRef.current, { zoomControl: false });
    map.setView([-1.9441, 30.075], 12);
    baseRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
    satRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri', maxZoom: 19 });
    mapRef.current = map;
    if (onMapClick) map.on('click', (e) => onMapClick(+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5)));
    const t = setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize(); }, 60);
    return () => { clearTimeout(t); if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } layersRef.current = { polyline: null, stops: [], markers: {}, history: [], personMarkers: {} }; youRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (satellite) { map.removeLayer(baseRef.current); satRef.current.addTo(map); } else { map.removeLayer(satRef.current); baseRef.current.addTo(map); }
  }, [satellite]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const Ls = layersRef.current;
    if (Ls.polyline) { map.removeLayer(Ls.polyline); Ls.polyline = null; }
    Ls.stops.forEach((m) => map.removeLayer(m)); Ls.stops = [];
    if (route && showRoutes) {
      const stopPts = (route.stops || []).filter((s) => s && s.location && s.location.coordinates).map((s) => [s.location.coordinates[1], s.location.coordinates[0]]);
      const latlngs = (route.geometry && route.geometry.length) ? route.geometry : stopPts;
      if (latlngs.length > 1) Ls.polyline = L.polyline(latlngs, { color: '#2563eb', weight: 4, opacity: 0.9 }).addTo(map);
      if (showStops) {
        const valid = (route.stops || []).filter((s) => s && s.location && s.location.coordinates);
        valid.forEach((s, i) => {
          const ll = [s.location.coordinates[1], s.location.coordinates[0]];
          const isYour = yourStopId && s._id === yourStopId;
          const icon = isYour ? yourStopIcon() : (i === 0 ? startIcon() : (i === valid.length - 1 ? endIcon() : stopIcon()));
          const m = L.marker(ll, { icon, zIndexOffset: isYour ? 700 : 0 }).addTo(map);
          m.bindPopup(`<b>${isYour ? '📍 Your Stop: ' : ''}${s.name}</b><br/><span style="color:#64748b">${s.address || ''}</span>`);
          Ls.stops.push(m);
        });
      }
      if (fitOnRoute && Ls.polyline) map.fitBounds(Ls.polyline.getBounds().pad(0.25));
    }
    if (!Ls.polyline && vehicles && vehicles.length > 0) {
      const pts = [];
      vehicles.forEach(v => { const c = v.currentLocation && v.currentLocation.coordinates; if (c && c.length === 2) pts.push([c[1], c[0]]); });
      if (pts.length > 0) { if (pts.length === 1) map.setView(pts[0], 15, { animate: true }); else map.fitBounds(L.latLngBounds(pts).pad(0.2), { animate: true }); }
    }
  }, [routeId, route, showRoutes, showStops, yourStopId, fitOnRoute, vehicles]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const Ls = layersRef.current; const seen = new Set();
    const animateTo = (marker, target) => {
      const start = marker.getLatLng(); const end = L.latLng(target[0], target[1]);
      if (!start || (Math.abs(start.lat - end.lat) < 1e-6 && Math.abs(start.lng - end.lng) < 1e-6)) { marker.setLatLng(end); return; }
      const duration = 1500; const t0 = performance.now();
      const step = (t) => { const p = Math.min(1, (t - t0) / duration); marker.setLatLng([start.lat + (end.lat - start.lat) * p, start.lng + (end.lng - start.lng) * p]); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    (persons || []).forEach((p) => {
      if (!p.latitude || !p.longitude) return;
      const phone = p.phone; seen.add(phone);
      const ll = [p.latitude, p.longitude];
      const isOnline = p.isSharing !== false && (!p.lastUpdate || (Date.now() - new Date(p.lastUpdate).getTime() < 120000));
      const color = p.isDriver ? '#2563eb' : '#7c3aed';
      let m = Ls.personMarkers[phone];
      if (!m) { m = L.marker(ll, { icon: personIcon(color, isOnline), zIndexOffset: 500 }).addTo(map); m.bindPopup(personPopupHtml(p)); if (onSelectPerson) m.on('click', () => onSelectPerson(phone)); Ls.personMarkers[phone] = m; }
      else { animateTo(m, ll); m.setIcon(personIcon(color, isOnline)); m.setPopupContent(personPopupHtml(p)); }
    });
    Object.keys(Ls.personMarkers).forEach((phone) => { if (!seen.has(phone)) { map.removeLayer(Ls.personMarkers[phone]); delete Ls.personMarkers[phone]; } });
  }, [persons, onSelectPerson]);

  useEffect(() => {
    if (!centerOnSelect || !selectedPersonPhone) return;
    const map = mapRef.current; if (!map) return;
    const p = (persons || []).find((x) => x.phone === selectedPersonPhone);
    if (p && p.latitude && p.longitude) {
      const cc = map.getCenter();
      if (haversine(cc.lat, cc.lng, p.latitude, p.longitude) > 0.5) map.setView([p.latitude, p.longitude], 15, { animate: true });
    }
  }, [selectedPersonPhone, centerOnSelect, persons]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const Ls = layersRef.current;
    Ls.history.forEach((m) => map.removeLayer(m)); Ls.history = [];
    if (!historyPoints || historyPoints.length < 2) return;
    const pts = historyPoints.map((p) => [p.latitude, p.longitude]);
    const line = L.polyline(pts, { color: '#7c3aed', weight: 3, dashArray: '6 6' }).addTo(map);
    Ls.history.push(line);
    historyPoints.forEach((p, i) => {
      const c = L.circleMarker([p.latitude, p.longitude], { radius: i === historyPoints.length - 1 ? 6 : 3, color: '#7c3aed', fillColor: '#c4b5fd', fillOpacity: 0.9 }).addTo(map);
      c.bindPopup(`${fmtTime(p.timestamp)} · ${Math.round(p.speed || 0)} km/h`);
      Ls.history.push(c);
    });
    map.fitBounds(line.getBounds().pad(0.2));
  }, [historyPoints]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const Ls = layersRef.current; const seen = new Set();
    const animateTo = (marker, target) => {
      const start = marker.getLatLng(); const end = L.latLng(target[0], target[1]);
      if (!start || (Math.abs(start.lat - end.lat) < 1e-6 && Math.abs(start.lng - end.lng) < 1e-6)) { marker.setLatLng(end); return; }
      const duration = 1500; const t0 = performance.now();
      const step = (t) => { const p = Math.min(1, (t - t0) / duration); marker.setLatLng([start.lat + (end.lat - start.lat) * p, start.lng + (end.lng - start.lng) * p]); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    (vehicles || []).forEach((v) => {
      const c = v.currentLocation && v.currentLocation.coordinates;
      if (!c || c.length !== 2) return;
      const ll = [c[1], c[0]]; seen.add(v._id);
      const color = (v.status === 'OFFLINE' || v.status === 'TRACKING_STOPPED') ? '#94a3b8' : '#2563eb';
      let m = Ls.markers[v._id];
      if (!m) { m = L.marker(ll, { icon: busIcon(color, v.heading), zIndexOffset: 600 }).addTo(map); m.bindPopup(vehiclePopupHtml(v)); m.on('click', () => { if (onSelectVehicle) onSelectVehicle(v._id); }); Ls.markers[v._id] = m; }
      else { animateTo(m, ll); m.setIcon(busIcon(color, v.heading)); m.setPopupContent(vehiclePopupHtml(v)); }
    });
    Object.keys(Ls.markers).forEach((id) => { if (!seen.has(id)) { map.removeLayer(Ls.markers[id]); delete Ls.markers[id]; } });
  }, [vehicles, onSelectVehicle]);

  useEffect(() => {
    if (!centerOnSelect || !selectedVehicleId) return;
    const map = mapRef.current; if (!map) return;
    const v = (vehicles || []).find((x) => x._id === selectedVehicleId);
    const c = v && v.currentLocation && v.currentLocation.coordinates;
    if (c) { const cc = map.getCenter(); if (haversine(cc.lat, cc.lng, c[1], c[0]) > 0.5) map.setView([c[1], c[0]], 15, { animate: true }); }
  }, [selectedVehicleId, centerOnSelect, vehicles]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLocation) { if (youRef.current && map) { map.removeLayer(youRef.current); youRef.current = null; } return; }
    const ll = [userLocation.lat, userLocation.lng];
    if (!youRef.current) { youRef.current = L.circleMarker(ll, { radius: 8, color: '#2563eb', fillColor: '#93c5fd', fillOpacity: 0.9, weight: 3 }).addTo(map); youRef.current.bindPopup('You are here'); }
    else youRef.current.setLatLng(ll);
  }, [userLocation]);

  const locate = () => {
    if (!navigator.geolocation) { toast('Geolocation is not supported by this browser.', 'error'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { const ll = [p.coords.latitude, p.coords.longitude]; if (mapRef.current) { mapRef.current.setView(ll, 14); L.circleMarker(ll, { radius: 7, color: '#2563eb', fillColor: '#93c5fd', fillOpacity: 0.9 }).addTo(mapRef.current).bindPopup('You are here').openPopup(); } },
      () => toast('Unable to access your location. Please enable location permission.', 'error'),
      { enableHighAccuracy: true }
    );
  };
  const fitAll = () => {
    const map = mapRef.current; if (!map) return;
    const Ls = layersRef.current; const pts = [];
    if (Ls.polyline) Ls.polyline.getLatLngs().forEach((p) => pts.push(p));
    Object.values(Ls.markers).forEach((m) => pts.push(m.getLatLng()));
    Object.values(Ls.personMarkers).forEach((m) => pts.push(m.getLatLng()));
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2));
  };
  const ctl = 'w-9 h-9 bg-white rounded-lg shadow-md border border-slate-200/60 flex items-center justify-center text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors';
  return (
    <div className={`relative w-full ${heightClass} rounded-2xl overflow-hidden border border-slate-200/70 z-0 bg-slate-100 shadow-sm`}>
      <div ref={divRef} className="absolute inset-0" />
      <div className="absolute top-3 left-3 z-[500] flex rounded-lg overflow-hidden shadow-md text-xs font-semibold">
        <button onClick={() => setSatellite(false)} className={`px-3.5 py-2 ${!satellite ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Map</button>
        <button onClick={() => setSatellite(true)} className={`px-3.5 py-2 ${satellite ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Satellite</button>
      </div>
      <div className="absolute top-3 right-3 z-[500] flex flex-col gap-1.5">
        <div className="flex flex-col rounded-lg overflow-hidden shadow-md">
          <button className="w-9 h-9 bg-white flex items-center justify-center text-slate-600 hover:bg-slate-50" title="Zoom in" onClick={() => mapRef.current && mapRef.current.zoomIn()}><Icon name="plus" className="w-4 h-4" /></button>
          <button className="w-9 h-9 bg-white border-t border-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-50" title="Zoom out" onClick={() => mapRef.current && mapRef.current.zoomOut()}><Icon name="minus" className="w-4 h-4" /></button>
        </div>
        <button className={ctl} title="Center map" onClick={locate}><Icon name="locate" className="w-4 h-4" /></button>
        <button className={ctl} title="Fit all" onClick={fitAll}><Icon name="layers" className="w-4 h-4" /></button>
        <button className={`${ctl} ${showRoutes ? 'text-blue-600' : 'text-slate-300'}`} title="Show routes" onClick={() => setShowRoutes((s) => !s)}><Icon name="route" className="w-4 h-4" /></button>
        <button className={`${ctl} ${showStops ? 'text-blue-600' : 'text-slate-300'}`} title="Show bus stops" onClick={() => setShowStops((s) => !s)}><Icon name="pin" className="w-4 h-4" /></button>
      </div>
      {showLegend && (
        <div className="absolute bottom-3 right-3 z-[500] bg-white/95 backdrop-blur rounded-xl shadow-md p-3 text-[11px] text-slate-600 space-y-1.5 hidden sm:block">
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Live</div>
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Offline</div>
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> In Service</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-white border-2 border-blue-600" /> Bus stop</div>
          <div className="flex items-center gap-2"><span className="w-4 h-0.5 bg-blue-600" /> Route path</div>
        </div>
      )}
    </div>
  );
}

/* =========================== SHARED COMPONENTS =========================== */
function UpcomingStopsList({ eta, loading }) {
  if (loading) return <div className="space-y-4 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>;
  if (!eta || !eta.stops || !eta.stops.length) return <EmptyState icon="pin" title="No route assigned" sub="This vehicle has no route with stops yet." />;
  return (
    <div className="p-5">
      <div className="flex items-center gap-3 mb-4">
        <GradIcon color="green" name="clock" size="w-9 h-9 rounded-lg" className="w-4 h-4" />
        <h3 className="text-sm font-bold text-slate-800">Upcoming Stops</h3>
      </div>
      <div className="space-y-1">
        {eta.stops.map((s, i) => {
          const departed = s.status === 'DEPARTED'; const next = s.status === 'NEXT'; const terminus = s.status === 'TERMINUS';
          return (
            <div key={s._id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${next ? 'bg-blue-50/80 ring-1 ring-blue-100' : ''}`}>
              <span className={`w-3.5 h-3.5 rounded-full shrink-0 ${departed ? 'bg-green-500' : next ? 'bg-blue-600 ring-4 ring-blue-100' : terminus ? 'bg-red-500' : 'bg-white border-[3px] border-blue-500'}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${next ? 'font-bold text-blue-700' : departed ? 'font-medium text-slate-400' : 'font-semibold text-slate-700'}`}>{s.name}</p>
                <p className="text-[11px] text-slate-400">
                  {departed ? (s.departedAt ? 'Departed ' + fmtTime(s.departedAt) : 'Departed') : 'ETA ' + fmtTime(new Date(Date.now() + (s.etaMinutes || 0) * 60000).toISOString()) + (s.distanceKm != null ? ' · ' + s.distanceKm + ' km' : '')}
                </p>
              </div>
              {next && <Badge color="blue">Next stop</Badge>}
              {!departed && <span className={`text-xs font-bold shrink-0 ${next ? 'text-blue-600' : 'text-slate-400'}`}>{etaLabel(s.etaMinutes)}</span>}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2 bg-blue-50/70 rounded-xl p-3 text-[11px] text-slate-600">
        <Icon name="info" className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <p>ETA is estimated from real GPS speed and route distance. It may change slightly.</p>
      </div>
    </div>
  );
}
function RouteProgress({ eta }) {
  if (!eta || !eta.stops) return null;
  return (
    <div className="flex items-start w-full overflow-x-auto py-1">
      {eta.stops.map((s, i) => {
        const done = s.status === 'DEPARTED'; const cur = s.status === 'NEXT';
        return (
          <React.Fragment key={s._id}>
            {i > 0 && <div className={`flex-1 h-1 mt-[7px] min-w-[16px] rounded-full ${done || cur ? 'bg-gradient-to-r from-green-500 to-green-400' : 'bg-slate-200'}`} />}
            <div className="flex flex-col items-center w-16 shrink-0">
              <span className={`w-4 h-4 rounded-full flex items-center justify-center ${done ? 'bg-green-500 text-white' : cur ? 'bg-white border-[4px] border-blue-600' : 'bg-slate-200'}`}>{done && <Icon name="check" className="w-2 h-2" />}</span>
              <span className={`text-[10px] mt-1 truncate w-full text-center ${cur ? 'text-blue-600 font-bold' : 'text-slate-500'}`}>{s.name}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
function ConnectionBanner() {
  const { connected } = useSocket();
  if (connected) return null;
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-700 flex items-center gap-2">
      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" /> Connection lost — trying to reconnect... Live updates are paused.
    </div>
  );
}

/* ================================ HEADER ================================ */
function Header({ onMenu, placeholder }) {
  const { user, logout } = useAuth();
  const [q, setQ] = useState(''); const [results, setResults] = useState(null); const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0); const [profileOpen, setProfileOpen] = useState(false);
  const { socket } = useSocket();
  const userId = user ? user._id : null;

  useEffect(() => {
    if (!userId) return;
    const load = () => api('/notifications/unread-count').then((d) => setUnread(d.count)).catch(() => {});
    load(); const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [userId]);
  useEffect(() => {
    if (!socket) return;
    const h = () => api('/notifications/unread-count').then((d) => setUnread(d.count)).catch(() => {});
    socket.on('notificationCreated', h);
    return () => socket.off('notificationCreated', h);
  }, [socket]);
  useEffect(() => {
    if (!q.trim()) { setResults(null); return; }
    const t = setTimeout(() => api('/search?q=' + encodeURIComponent(q)).then(setResults).catch(() => setResults(null)), 250);
    return () => clearTimeout(t);
  }, [q]);

  const go = (to) => { setOpen(false); setQ(''); navigate(to); };
  const has = results && ((results.vehicles && results.vehicles.length) || (results.routes && results.routes.length) || (results.stops && results.stops.length) || (results.users && results.users.length));
  return (
    <header className="sticky top-0 z-[900] bg-white/90 backdrop-blur border-b border-slate-200/70 h-16 flex items-center gap-3 px-4 md:px-6">
      <button className="lg:hidden text-slate-600" onClick={onMenu}><Icon name="menu" className="w-6 h-6" /></button>
      <div className="flex-1 max-w-xl mx-auto relative">
        <Icon name="search" className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <Input placeholder={placeholder} value={q} className="pl-10 rounded-full bg-slate-100/80 border-transparent focus:bg-white focus:border-blue-300" onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)} />
        {open && q.trim() && (
          <Card className="absolute top-12 left-0 right-0 max-h-96 overflow-y-auto p-2 z-[950] shadow-xl">
            {!results ? <div className="p-3"><Skeleton className="h-6 mb-2" /><Skeleton className="h-6" /></div> : !has ? <p className="text-xs text-slate-500 p-3">No results for "{q}".</p> : (
              <>
                {(results.stops || []).map((s) => <button key={s._id} onMouseDown={() => go('/bus-stops?q=' + encodeURIComponent(s.name))} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 text-left"><span className="text-blue-600"><Icon name="pin" className="w-4 h-4" /></span><span className="flex-1 min-w-0"><span className="block text-sm text-slate-800">{s.name}</span><span className="block text-[11px] text-slate-400">Bus stop</span></span></button>)}
                {(results.routes || []).map((r) => <button key={r._id} onMouseDown={() => go('/routes/' + r._id)} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 text-left"><span className="text-blue-600"><Icon name="route" className="w-4 h-4" /></span><span className="flex-1 min-w-0"><span className="block text-sm text-slate-800">{r.name}</span><span className="block text-[11px] text-slate-400">Route · {r.startPoint} → {r.destination}</span></span></button>)}
                {(results.vehicles || []).map((v) => <button key={v._id} onMouseDown={() => go('/vehicles/' + v._id)} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 text-left"><span className="text-blue-600"><Icon name="bus" className="w-4 h-4" /></span><span className="flex-1 min-w-0"><span className="block text-sm text-slate-800">{v.vehicleNumber}</span><span className="block text-[11px] text-slate-400">Vehicle · {v.routeId ? v.routeId.name : 'No route'} · {sMeta(v.status).label}</span></span></button>)}
                {(results.users || []).map((u) => <button key={u._id} onMouseDown={() => go(u.role === 'DRIVER' ? '/admin/drivers' : '/admin/users')} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 text-left"><span className="text-blue-600"><Icon name="user" className="w-4 h-4" /></span><span className="flex-1 min-w-0"><span className="block text-sm text-slate-800">{u.name}</span><span className="block text-[11px] text-slate-400">{u.role.toLowerCase()} · {u.email}</span></span></button>)}
              </>
            )}
          </Card>
        )}
      </div>
      <button className="relative text-slate-500 hover:text-slate-700 w-10 h-10 rounded-xl hover:bg-slate-100 flex items-center justify-center" onClick={() => navigate(user.role === 'ADMIN' ? '/admin/notifications' : user.role === 'DRIVER' ? '/driver/notifications' : '/notifications')} title="Notifications">
        <Icon name="bell" className="w-5 h-5" />
        {unread > 0 && <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-br from-red-500 to-rose-600 text-white text-[10px] font-bold flex items-center justify-center shadow">{unread}</span>}
      </button>
      <div className="relative">
        <button className="flex items-center gap-2.5" onClick={() => setProfileOpen((o) => !o)}>
          <span className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center text-xs font-bold shadow-md">{initials(user.name)}</span>
          <span className="hidden md:block text-left">
            <span className="block text-sm font-bold text-slate-800 leading-tight">{user.name}</span>
            <span className="block text-[11px] text-slate-500 leading-tight">{user.role === 'ADMIN' ? 'Administrator' : user.role === 'DRIVER' ? 'Driver' : 'Passenger'}</span>
          </span>
          <Icon name="chevron" className="w-4 h-4 text-slate-400 hidden md:block" />
        </button>
        {profileOpen && (
          <>
            <div className="fixed inset-0 z-[940]" onClick={() => setProfileOpen(false)} />
            <Card className="absolute right-0 top-13 mt-1 w-52 p-1.5 z-[950] shadow-xl">
              <button className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 rounded-xl hover:bg-slate-50" onClick={() => { setProfileOpen(false); navigate(user.role === 'ADMIN' ? '/admin/settings' : user.role === 'DRIVER' ? '/driver/profile' : '/profile'); }}><Icon name="user" className="w-4 h-4" /> My Profile</button>
              <button className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 rounded-xl hover:bg-slate-50" onClick={() => { setProfileOpen(false); navigate(user.role === 'ADMIN' ? '/admin/settings' : user.role === 'DRIVER' ? '/driver/settings' : '/settings'); }}><Icon name="settings" className="w-4 h-4" /> Settings</button>
              <div className="my-1 border-t border-slate-100" />
              <button className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-600 rounded-xl hover:bg-red-50" onClick={() => { setProfileOpen(false); logout(); }}><Icon name="logout" className="w-4 h-4" /> Logout</button>
            </Card>
          </>
        )}
      </div>
    </header>
  );
}

/* ================================ AUTH PAGES ================================ */
function BrandPanel({ children }) {
  return (
    <div className={`hidden lg:flex lg:w-[46%] flex-col justify-between p-12 relative overflow-hidden text-white ${NAVY}`}>
      <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-blue-500/10" />
      <div className="absolute -bottom-32 -left-20 w-96 h-96 rounded-full bg-blue-400/10" />
      <div className="relative flex items-center gap-3">
        <LogoMark className="w-12 h-12" />
        <div>
          <span className="text-2xl font-extrabold tracking-tight">Car<span className="text-blue-400">Tracker</span></span>
          <p className="text-[12px] text-slate-400 tracking-wide">Track • Ride • Arrive</p>
        </div>
      </div>
      <div className="relative">{children}</div>
      <div className="relative grid grid-cols-3 gap-4">
        {[['120+', 'Buses tracked'], ['40+', 'City routes'], ['10k+', 'Daily riders']].map(([v, l]) => (
          <div key={l} className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center backdrop-blur">
            <p className="text-xl font-extrabold text-blue-300">{v}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setError(null);
    if (!identifier.trim()) { setError('Please enter your email or phone number.'); return; }
    if (!password) { setError('Please enter your password.'); return; }
    setBusy(true);
    try {
      const u = await login(identifier.trim(), password, remember);
      toast('Welcome, ' + u.name + '!', 'success');
      navigate(u.role === 'ADMIN' ? '/admin' : u.role === 'DRIVER' ? '/driver/dashboard' : '/');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const google = async () => { try { const d = await api('/auth/google/url'); window.location.href = d.url; } catch (err) { toast(err.message, 'error'); } };

  return (
    <div className="min-h-screen flex bg-slate-100">
      <BrandPanel>
        <h1 className="text-4xl xl:text-[44px] leading-[1.15] font-extrabold">Smarter Transport<br />for a <span className="text-blue-400">Better City</span></h1>
        <p className="text-[15px] text-slate-300 mt-5 max-w-md leading-relaxed">Real-time vehicle tracking, route management and smart public transport for a connected and efficient city.</p>
        <div className="grid grid-cols-2 gap-4 mt-8">
          {[['pin', 'Live Tracking', 'See vehicles in real time'], ['route', 'Smart Routes', 'Find the best route'], ['clock', 'Accurate ETA', 'Know when to arrive'], ['shieldcheck', 'Safe & Reliable', 'Better for everyone']].map(([ic, t, s]) => (
            <div key={t} className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center text-blue-300 shrink-0"><Icon name={ic} className="w-5 h-5" /></span>
              <div><p className="text-[13px] font-bold">{t}</p><p className="text-[11px] text-slate-400">{s}</p></div>
            </div>
          ))}
        </div>
      </BrandPanel>

      <div className="flex-1 flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-[420px]">
          <div className="flex items-center justify-center gap-2.5 lg:hidden mb-6">
            <LogoMark className="w-11 h-11" />
            <span className="text-[26px] font-extrabold tracking-tight text-slate-900">Car<span style={{ color: BLUE }}>Tracker</span></span>
          </div>
          <Card className="p-8 md:p-10 shadow-xl">
            <div className="hidden lg:flex items-center gap-2.5 mb-6">
              <LogoMark className="w-10 h-10" />
              <span className="text-[24px] font-extrabold tracking-tight text-slate-900">Car<span style={{ color: BLUE }}>Tracker</span></span>
            </div>
            <h2 className="text-[24px] font-extrabold text-slate-900">Welcome back!</h2>
            <p className="text-[13px] text-slate-500 mt-1.5">Sign in to access your dashboard and track vehicles.</p>
            {error && <div className="mt-4 flex gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs"><Icon name="alert" className="w-4 h-4 shrink-0" />{error}</div>}
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <Label>Email or Phone</Label>
                <div className="relative">
                  <Icon name="mail" className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <Input className="pl-10" placeholder="Enter your email or phone number" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" />
                </div>
              </div>
              <div>
                <Label>Password</Label>
                <div className="relative">
                  <Icon name="lock" className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <Input className="pl-10 pr-10" type={showPw ? 'text' : 'password'} placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                  <button type="button" className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setShowPw((s) => !s)}><Icon name={showPw ? 'eyeoff' : 'eye'} className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 rounded border-slate-300" style={{ accentColor: BLUE }} /> Remember me
                </label>
                <button type="button" className="text-[13px] font-semibold hover:underline" style={{ color: BLUE }} onClick={() => navigate('/forgot-password')}>Forgot password?</button>
              </div>
              <Btn type="submit" disabled={busy} className="w-full py-3">
                {busy ? 'Signing in...' : <><Icon name="login" className="w-4 h-4" /> Sign In</>}
              </Btn>
            </form>
            <div className="flex items-center gap-3 my-5"><div className="flex-1 border-t border-slate-200" /><span className="text-[11px] text-slate-400 tracking-widest">OR</span><div className="flex-1 border-t border-slate-200" /></div>
            <button onClick={google} className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-xl border border-slate-200 bg-white text-[14px] font-semibold hover:bg-slate-50 text-slate-700">
              <GoogleIcon /> Continue with Google
            </button>
            <p className="text-[13px] text-slate-500 text-center mt-6">Don't have an account? <button className="font-bold hover:underline" style={{ color: BLUE }} onClick={() => navigate('/register')}>Register here</button></p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RegisterPage() {
  const { register } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', role: 'PASSENGER' });
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setError(null); setBusy(true);
    try { const u = await register(form); toast('Account created. Welcome, ' + u.name + '!', 'success'); navigate(u.role === 'DRIVER' ? '/driver/dashboard' : '/'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-100">
      <Card className="w-full max-w-md p-8 shadow-xl">
        <div className="flex items-center justify-center gap-2">
          <LogoMark className="w-10 h-10" />
          <span className="text-2xl font-extrabold text-slate-900">Car<span style={{ color: BLUE }}>Tracker</span></span>
        </div>
        <h2 className="text-xl font-extrabold text-slate-900 text-center mt-4">Create your account</h2>
        <p className="text-xs text-slate-500 text-center mt-1">Choose how you will use CarTracker.</p>
        <div className="grid grid-cols-2 gap-3 mt-5">
          {[['PASSENGER', 'Passenger', 'Track vehicles and people', 'user', 'blue'], ['DRIVER', 'Driver', 'Send GPS of your vehicle', 'bus', 'green']].map(([val, t, s, ic, col]) => (
            <button key={val} type="button" onClick={() => setForm((f) => ({ ...f, role: val }))}
              className={`p-4 rounded-2xl border text-left transition-all ${form.role === val ? 'border-blue-500 ring-2 ring-blue-500/30 bg-blue-50/60 shadow-md' : 'border-slate-200 hover:border-blue-300 bg-white'}`}>
              <GradIcon color={col} name={ic} size="w-9 h-9 rounded-lg" className="w-4 h-4" />
              <p className="text-sm font-bold text-slate-800 mt-2">{t}</p>
              <p className="text-[11px] text-slate-500">{s}</p>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Admin accounts are created by an authorized administrator only.</p>
        {error && <div className="mt-4 flex gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs"><Icon name="alert" className="w-4 h-4 shrink-0" />{error}</div>}
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div><Label>Full name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Email *</Label><Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label>Phone (Rwanda: 078...)</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="078XXXXXXX" /></div>
          <div><Label>Password *</Label><Input required type="password" minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <Btn type="submit" className="w-full" disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</Btn>
        </form>
        <p className="text-xs text-slate-500 text-center mt-4">Already registered? <button className="text-blue-600 font-bold hover:underline" onClick={() => navigate('/login')}>Sign in</button></p>
      </Card>
    </div>
  );
}

function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [msg, setMsg] = useState(null); const [devToken, setDevToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const d = await api('/auth/forgot-password', { method: 'POST', body: { identifier } }); setMsg(d.message); setDevToken(d.devResetToken || null); }
    catch (err) { setMsg(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-100">
      <Card className="w-full max-w-md p-8 shadow-xl">
        <GradIcon color="blue" name="lock" size="w-12 h-12 rounded-xl" className="w-6 h-6" />
        <h2 className="text-xl font-extrabold text-slate-900 mt-4">Forgot password?</h2>
        <p className="text-xs text-slate-500 mt-1">Enter your email or phone and we will send a recovery link.</p>
        {msg && <div className="mt-4 flex gap-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-xl p-3 text-xs"><Icon name="info" className="w-4 h-4 shrink-0" />{msg}</div>}
        {devToken && <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl p-3 text-xs">Development mode: <button className="underline font-semibold" onClick={() => navigate('/reset-password?token=' + devToken)}>open reset link</button></div>}
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div><Label>Email or Phone</Label><Input required value={identifier} onChange={(e) => setIdentifier(e.target.value)} /></div>
          <Btn type="submit" className="w-full" disabled={busy}>{busy ? 'Sending...' : 'Send recovery link'}</Btn>
        </form>
        <p className="text-xs text-slate-500 text-center mt-4"><button className="text-blue-600 font-bold hover:underline" onClick={() => navigate('/login')}>Back to sign in</button></p>
      </Card>
    </div>
  );
}

function ResetPasswordPage({ params }) {
  const [token, setToken] = useState(params.get('token') || '');
  const [pw, setPw] = useState(''); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api('/auth/reset-password', { method: 'POST', body: { token, newPassword: pw } }); setMsg('Password updated. You can sign in now.'); setTimeout(() => navigate('/login'), 1200); }
    catch (err) { setMsg(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-100">
      <Card className="w-full max-w-md p-8 shadow-xl">
        <h2 className="text-xl font-extrabold text-slate-900">Reset password</h2>
        {msg && <div className="mt-4 bg-blue-50 border border-blue-200 text-blue-700 rounded-xl p-3 text-xs">{msg}</div>}
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div><Label>Reset token</Label><Input required value={token} onChange={(e) => setToken(e.target.value)} /></div>
          <div><Label>New password</Label><Input required type="password" minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <Btn type="submit" className="w-full" disabled={busy}>{busy ? 'Saving...' : 'Update password'}</Btn>
        </form>
      </Card>
    </div>
  );
}

function GoogleCallbackPage({ params }) {
  const { adoptToken } = useAuth();
  const [err, setErr] = useState(null);
  const token = params.get('token');
  useEffect(() => {
    if (!token) { setErr('Missing token.'); return; }
    adoptToken(token).then((u) => navigate(u.role === 'ADMIN' ? '/admin' : u.role === 'DRIVER' ? '/driver/dashboard' : '/')).catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return <div className="min-h-screen flex items-center justify-center bg-slate-100">{err ? <ErrorState message={err} retry={() => navigate('/login')} /> : <div className="flex flex-col items-center gap-3"><div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /><p className="text-sm text-slate-500">Completing Google sign in...</p></div>}</div>;
}

/* ============================== PASSENGER PAGES ============================== */
function HomePage() {
  const { vehicles, loading, error, reload, selectedId, selectVehicle } = useVehicles();
  const selected = vehicles.find((v) => v._id === selectedId) || vehicles[0];
  const [eta, setEta] = useState(null);
  const selectedKey = selected ? selected._id : null;
  const { socket } = useSocket();
  const [code, setCode] = useState('');
  const [userLoc, setUserLoc] = useState(null);
  const [nearby, setNearby] = useState([]);
  const [locErr, setLocErr] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setUserLoc({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => setLocErr(e.code === 1 ? 'Location permission denied. Nearby vehicles are unavailable.' : 'Could not read your location.'),
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }
    );
  }, []);
  useEffect(() => {
    if (!userLoc) return;
    api('/vehicles/nearby?lat=' + userLoc.lat + '&lng=' + userLoc.lng + '&radiusKm=10').then(setNearby).catch(() => setNearby([]));
  }, [userLoc]);
  useEffect(() => {
    if (!selected) { setEta(null); return; }
    setEta(selected.eta || null);
    api('/vehicles/' + selected._id).then((d) => setEta(d.eta)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);
  useEffect(() => {
    if (!socket) return;
    const h = (p) => { if (selectedKey && p.vehicleId === selectedKey) setEta(p.eta); };
    socket.on('vehicleLocationUpdated', h);
    return () => socket.off('vehicleLocationUpdated', h);
  }, [socket, selectedKey]);

  if (error) return <Card className="p-4"><ErrorState message={error} retry={reload} /></Card>;
  const route = selected ? selected.routeId : null;
  const nextStop = eta && eta.nextStop ? eta.nextStop.name : (selected ? selected.nextStopName : null);
  const nextEta = eta ? eta.etaMinutes : (selected ? selected.etaMinutes : null);
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5 flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="flex items-center gap-3.5 flex-1">
          <GradIcon color="blue" name="nav" size="w-12 h-12 rounded-xl" className="w-6 h-6" />
          <div><p className="text-base font-bold text-slate-800">Track a Vehicle or Person</p><p className="text-xs text-slate-500 mt-0.5">Enter a vehicle code or any Rwanda phone number (078, 079, +250...) to follow them live.</p></div>
        </div>
        <form className="flex gap-2 w-full lg:w-auto" onSubmit={(e) => { e.preventDefault(); navigate('/track?code=' + encodeURIComponent(normalizeRwandaPhone(code.trim()) || code.trim())); }}>
          <Input placeholder="e.g. 078XXXXXXX or RT-204" value={code} onChange={(e) => setCode(e.target.value)} className="rounded-full lg:w-72" />
          <Btn type="submit" className="rounded-full px-6"><Icon name="search" className="w-4 h-4" /> Track</Btn>
        </form>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3.5">
            <GradIcon color="green" name="pin" size="w-12 h-12 rounded-xl" className="w-6 h-6" />
            <div>
              <h3 className="text-base font-bold text-slate-800">Vehicles Near You</h3>
              <p className="text-xs text-slate-500 mt-0.5">Based on your current location.</p>
            </div>
          </div>
          <Badge color="green"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Live Tracking</Badge>
        </div>
        <div className="mt-4">
          {locErr ? <p className="text-xs text-slate-500">{locErr}</p>
            : !userLoc ? <div className="flex items-center gap-2 text-xs text-slate-500"><div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /> Reading your location…</div>
            : nearby.length === 0 ? <p className="text-xs text-slate-500">No active vehicles within 10 km of you right now.</p>
            : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {nearby.map((v) => (
                  <button key={v._id} onClick={() => selectVehicle(v._id)} className="text-left p-4 rounded-2xl border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all bg-white">
                    <div className="flex items-start gap-2.5">
                      <GradIcon color="blue" name="bus" size="w-10 h-10 rounded-lg" className="w-5 h-5" />
                      <div className="min-w-0"><p className="text-sm font-bold text-blue-600 truncate">{v.vehicleNumber}</p><p className="text-[11px] text-slate-500 truncate">{v.routeId ? v.routeId.name : 'No route'}</p></div>
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs font-semibold text-slate-600">{v.distanceKm} km away</span>
                      <LiveDot status={v.status} />
                    </div>
                  </button>
                ))}
              </div>
            )}
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 flex flex-col gap-4 min-w-0">
          <Card className="p-5">
            {loading ? <div className="flex gap-6"><Skeleton className="h-14 w-14" /><div className="flex-1"><Skeleton className="h-5 w-40 mb-2" /><Skeleton className="h-4 w-56" /></div></div> : !selected ? <EmptyState icon="bus" title="No vehicles are currently online." sub="Vehicles appear here as soon as drivers start sending GPS." /> : (
              <div className="flex flex-col md:flex-row md:items-center gap-5">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <GradIcon color="blue" name="bus" size="w-14 h-14 rounded-2xl" className="w-7 h-7" />
                  <div className="min-w-0">
                    <h2 className="text-lg font-extrabold text-slate-800">{route ? route.name : 'No route'}</h2>
                    <p className="text-xs text-slate-500 truncate">{route ? route.startPoint + ' → ' + route.destination : '—'}</p>
                    <div className="mt-1.5"><StatusBadge status={selected.status} /></div>
                  </div>
                </div>
                <div className="grid grid-cols-3 divide-x divide-slate-200 border-t md:border-t-0 md:border-l md:pl-6 pt-4 md:pt-0 w-full md:w-auto">
                  <div className="pr-4 md:pr-6"><p className="text-[11px] text-slate-400 font-medium">Bus No.</p><p className="text-sm font-extrabold text-slate-800 mt-1">{selected.vehicleNumber}</p></div>
                  <div className="px-4 md:px-6"><p className="text-[11px] text-slate-400 font-medium">Speed</p><p className="text-sm font-extrabold text-slate-800 mt-1">{Math.round(selected.speed || 0)} km/h</p></div>
                  <div className="pl-4 md:pl-6"><p className="text-[11px] text-slate-400 font-medium">Next Stop</p><p className="text-sm font-extrabold text-blue-600 mt-1">{nextStop || '—'}</p><p className="text-xs font-bold text-blue-600">{nextEta != null ? nextEta + ' min' : ''}</p></div>
                </div>
              </div>
            )}
          </Card>
          <MapView route={route} vehicles={selected ? [selected] : []} selectedVehicleId={selectedKey} onSelectVehicle={selectVehicle} userLocation={userLoc} />
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3"><GradIcon color="cyan" name="bus" size="w-9 h-9 rounded-lg" className="w-4 h-4" /><h3 className="text-sm font-bold text-slate-800">Live Vehicles</h3></div>
              <button className="text-xs font-bold text-blue-600 hover:underline" onClick={() => navigate('/live-map')}>View all →</button>
            </div>
            {loading ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}</div> : vehicles.length === 0 ? <EmptyState icon="bus" title="No vehicles are currently online." /> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {vehicles.map((v) => (
                  <button key={v._id} onClick={() => selectVehicle(v._id)} className={`text-left p-4 rounded-2xl border transition-all ${v._id === selectedId ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/40 shadow-md' : 'border-slate-200 hover:border-blue-300 hover:shadow-md bg-white'}`}>
                    <div className="flex items-start gap-3">
                      <GradIcon color="blue" name="bus" size="w-10 h-10 rounded-lg" className="w-5 h-5" />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-blue-600">{v.vehicleNumber}</p>
                        <p className="text-[11px] text-slate-500">{v.routeId ? v.routeId.name : 'No route'}</p>
                      </div>
                    </div>
                    <div className="mt-3"><LiveDot status={v.status} /></div>
                    <p className="mt-2 text-[11px] text-slate-500">Next: <span className="text-blue-600 font-bold">{v.nextStopName || '—'}</span>{v.etaMinutes != null ? <span className="text-blue-600 font-bold"> ({v.etaMinutes} min)</span> : null}</p>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4 min-w-0">
          <Card className="p-5">
            {loading ? <Skeleton className="h-24" /> : selected && (
              <div className="flex items-center gap-4">
                <GradIcon color="blue" name="bus" size="w-20 h-16 rounded-2xl" className="w-9 h-9" />
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-slate-800">{selected.vehicleNumber}</p>
                  <p className="text-[11px] text-slate-500 truncate">{selected.routeId ? selected.routeId.name + ' · ' + selected.routeId.startPoint + ' → ' + selected.routeId.destination : 'No route assigned'}</p>
                  <div className="mt-1.5"><StatusBadge status={selected.status} /></div>
                  <button className="mt-2 text-[11px] font-bold text-blue-600 hover:underline" onClick={() => navigate('/vehicles/' + selected._id)}>View details →</button>
                </div>
              </div>
            )}
          </Card>
          <Card><UpcomingStopsList eta={eta} loading={loading && !selected} /></Card>
        </div>
      </div>
    </div>
  );
}

function TrackPage({ params }) {
  const { socket } = useSocket();
  const toast = useToast();
  const initialCode = params.get('code') || '';
  const [code, setCode] = useState(initialCode);
  const [searchMode, setSearchMode] = useState('phone');
  const [vehicle, setVehicle] = useState(null);
  const [driverInfo, setDriverInfo] = useState(null);
  const [notFound, setNotFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState(null);
  const [stopId, setStopId] = useState(null);
  const [live, setLive] = useState(null);
  const [person, setPerson] = useState(null);
  const [personLocation, setPersonLocation] = useState(null);
  const [trackingPerson, setTrackingPerson] = useState(false);
  const [personOffline, setPersonOffline] = useState(false);

  const lookup = useCallback((c) => {
    if (!c) return;
    setBusy(true); setNotFound(null); setVehicle(null); setSession(null); setDriverInfo(null);
    setPerson(null); setPersonLocation(null); setTrackingPerson(false); setPersonOffline(false);
    const normalizedCode = normalizeRwandaPhone(c);
    if (searchMode === 'phone') {
      api('/track/' + encodeURIComponent(normalizedCode))
        .then((d) => {
          if (d.found && d.isDriver && d.location && d.location.isSharing) {
            api('/drivers/phone/' + encodeURIComponent(normalizedCode))
              .then((driverData) => { setDriverInfo(driverData.driver || null); setVehicle(driverData.vehicle); setLive(driverData.vehicle); })
              .catch(() => { setPerson({ phone: normalizedCode, name: d.user ? d.user.name : 'Driver', role: 'DRIVER', isDriver: true }); setPersonLocation(d.location); setTrackingPerson(true); });
          } else if (d.found) {
            setPerson({ phone: normalizedCode, name: d.user ? d.user.name : 'Person', role: d.type === 'unregistered' ? 'UNREGISTERED' : (d.user ? d.user.role : 'PASSENGER'), isDriver: false });
            if (d.location && d.location.isSharing) { setPersonLocation(d.location); setTrackingPerson(true); }
            else { setNotFound(d.location ? d.location.message : 'This person is not currently sharing their location.'); setPersonOffline(true); }
          } else { setNotFound(d.message || 'This phone number is not currently sharing location. Make sure they have enabled location sharing in their profile.'); setPersonOffline(true); }
        })
        .catch((e) => setNotFound(e.message)).finally(() => setBusy(false));
    } else {
      api('/vehicles/code/' + encodeURIComponent(c))
        .then((d) => { setVehicle(d.vehicle); setLive(d.vehicle); })
        .catch((e) => setNotFound(e.message)).finally(() => setBusy(false));
    }
  }, [searchMode]);

  useEffect(() => { if (initialCode) lookup(initialCode); }, [initialCode, lookup]);

  useEffect(() => {
    if (!socket || !vehicle) return;
    socket.emit('track:vehicle', vehicle._id);
    const h = (p) => {
      if (p.vehicleId === vehicle._id) setLive((v) => (v ? { ...v, currentLocation: { type: 'Point', coordinates: [p.longitude, p.latitude] }, speed: p.speed, heading: p.heading, status: p.status, lastUpdated: p.lastUpdated, eta: p.eta, nextStopName: p.nextStop, etaMinutes: p.etaMinutes } : v));
    };
    socket.on('vehicleLocationUpdated', h);
    return () => { socket.off('vehicleLocationUpdated', h); socket.emit('untrack:vehicle', vehicle._id); };
  }, [socket, vehicle]);

  useEffect(() => {
    if (!socket || !person || !person.phone) return;
    socket.emit('track:person', person.phone);
    const locationHandler = (p) => {
      if (p.phone === person.phone) {
        setPersonLocation({ latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy, speed: p.speed, heading: p.heading, lastUpdate: p.lastUpdate, isSharing: true });
        setTrackingPerson(true); setPersonOffline(false);
        if (p.name && p.name !== person.name) setPerson((prev) => ({ ...prev, name: p.name, isDriver: p.isDriver }));
      }
    };
    const offlineHandler = (p) => { if (p.phone === person.phone) { setTrackingPerson(false); setPersonOffline(true); toast('This person stopped sharing their location.', 'info'); } };
    socket.on('person:location', locationHandler); socket.on('person:offline', offlineHandler);
    return () => { socket.off('person:location', locationHandler); socket.off('person:offline', offlineHandler); socket.emit('untrack:person', person.phone); };
  }, [socket, person, toast]);

  const v = live || vehicle;
  const startTracking = async () => {
    try {
      const s = await api('/tracking/start', { method: 'POST', body: { vehicleId: vehicle._id, stopId: stopId || null } });
      setSession(s); toast('Tracking started. You will be notified as the vehicle approaches your stop.', 'success');
      if ('Notification' in window && Notification.permission === 'default') { const p = await Notification.requestPermission(); if (p === 'granted') toast('Browser notifications enabled.', 'success'); }
    } catch (e) { toast(e.message, 'error'); }
  };
  const stopTracking = async () => {
    try { await api('/tracking/' + session._id + '/stop', { method: 'POST' }); setSession(null); toast('Tracking stopped.', 'info'); }
    catch (e) { toast(e.message, 'error'); }
  };
  const route = v ? v.routeId : null;
  const activeDriver = driverInfo || (v && v.driverId) || null;
  const personsForMap = person && personLocation && personLocation.latitude ? [{ phone: person.phone, name: person.name, role: person.role, isDriver: person.isDriver, latitude: personLocation.latitude, longitude: personLocation.longitude, accuracy: personLocation.accuracy, speed: personLocation.speed, heading: personLocation.heading, lastUpdate: personLocation.lastUpdate, isSharing: trackingPerson }] : [];

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3.5">
            <GradIcon color="purple" name="phone" size="w-12 h-12 rounded-xl" className="w-6 h-6" />
            <div>
              <h2 className="text-base font-bold text-slate-800">Track a Vehicle or Person</h2>
              <p className="text-xs text-slate-500 mt-0.5">Search by vehicle code or any Rwanda phone number.</p>
            </div>
          </div>
          <div className="flex rounded-full overflow-hidden border border-slate-200 bg-slate-100 text-xs font-semibold p-1">
            <button onClick={() => setSearchMode('code')} className={`px-4 py-2 rounded-full flex items-center gap-1.5 transition-all ${searchMode === 'code' ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow' : 'text-slate-600 hover:text-slate-800'}`}>
              <Icon name="bus" className="w-3.5 h-3.5" /> Vehicle Code
            </button>
            <button onClick={() => setSearchMode('phone')} className={`px-4 py-2 rounded-full flex items-center gap-1.5 transition-all ${searchMode === 'phone' ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow' : 'text-slate-600 hover:text-slate-800'}`}>
              <Icon name="phone" className="w-3.5 h-3.5" /> Phone Number
            </button>
          </div>
        </div>
        <form className="flex gap-2 mt-4" onSubmit={(e) => { e.preventDefault(); lookup(code.trim()); }}>
          <div className="relative flex-1 max-w-xs">
            <Icon name={searchMode === 'phone' ? 'phone' : 'bus'} className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <Input placeholder={searchMode === 'phone' ? '078XXXXXXX / +25078...' : 'RT-204'} value={code} onChange={(e) => setCode(e.target.value)} className="pl-10 rounded-full" />
          </div>
          <Btn type="submit" className="rounded-full px-6" disabled={busy}>{busy ? 'Searching...' : <><Icon name="search" className="w-4 h-4" /> Track</>}</Btn>
        </form>
        {notFound && (
          <div className="mt-4 flex gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl p-3 text-xs">
            <Icon name="alert" className="w-4 h-4 shrink-0" /><span>{notFound}</span>
          </div>
        )}
      </Card>

      {v && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 flex flex-col gap-4 min-w-0">
            <MapView route={route} vehicles={[v]} selectedVehicleId={v._id} yourStopId={stopId} heightClass="h-[380px] md:h-[480px]" centerOnSelect />
          </div>
          <div className="flex flex-col gap-4 min-w-0">
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-base font-extrabold text-slate-800">{v.vehicleNumber}</p>
                <StatusBadge status={v.status} />
              </div>
              <p className="text-xs text-slate-500 mt-1">{route ? route.name + ' · ' + route.startPoint + ' → ' + route.destination : 'No route'}</p>
              {activeDriver && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center text-xs font-bold shadow">{initials(activeDriver.name)}</span>
                    <div className="min-w-0 flex-1"><p className="text-xs text-slate-400">Driver</p><p className="text-sm font-bold text-slate-800 truncate">{activeDriver.name}</p></div>
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow shadow-green-500/50" title="Active" />
                  </div>
                  {activeDriver.phone && <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500"><Icon name="phone" className="w-3 h-3" /><span>{activeDriver.phone}</span></div>}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Speed</p><p className="text-sm font-extrabold text-slate-800 mt-0.5">{Math.round(v.speed || 0)} km/h</p></div>
                <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Last update</p><p className="text-sm font-extrabold text-slate-800 mt-0.5">{timeAgo(v.lastUpdated)}</p></div>
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="text-sm font-bold text-slate-800 mb-3">Where are you getting on?</h3>
              <Label>Select your stop</Label>
              <Select value={stopId || ''} onChange={(e) => setStopId(e.target.value || null)}>
                <option value="">Choose a stop...</option>
                {((v.eta && v.eta.stops) || (route && route.stops) || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </Select>
              <div className="mt-4">
                {!session ? <Btn className="w-full" onClick={startTracking} disabled={!vehicle}><Icon name="play" className="w-4 h-4" /> Track Vehicle</Btn>
                  : <Btn variant="dangerOutline" className="w-full" onClick={stopTracking}><Icon name="stop" className="w-4 h-4" /> Stop Tracking</Btn>}
              </div>
              {session && <p className="text-[11px] text-green-600 font-semibold mt-3 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Tracking active — alerts at 10, 5, 2 min and on arrival.</p>}
            </Card>
            <Card><UpcomingStopsList eta={v.eta} loading={false} /></Card>
          </div>
        </div>
      )}

      {person && !vehicle && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 min-w-0">
            <MapView route={null} vehicles={[]} persons={personsForMap} selectedPersonPhone={person.phone} heightClass="h-[380px] md:h-[480px]" centerOnSelect />
          </div>
          <div className="flex flex-col gap-4 min-w-0">
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <span className={`w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold text-white shadow-md bg-gradient-to-br ${person.isDriver ? GRADS.blue : GRADS.purple}`}>{initials(person.name || 'P')}</span>
                    <span className={`absolute -bottom-1 -right-1 w-4 h-4 border-2 border-white rounded-full ${trackingPerson ? 'bg-green-500' : 'bg-red-500'}`} />
                  </div>
                  <div>
                    <p className="text-base font-extrabold text-slate-800">{person.name || 'Person'}</p>
                    <div className="flex items-center gap-1.5 mt-0.5"><Icon name="phone" className="w-3 h-3 text-slate-400" /><p className="text-xs text-slate-500">{person.phone}</p></div>
                  </div>
                </div>
                {trackingPerson ? <Badge color="green">🟢 Live</Badge> : <Badge color="red">🔴 Offline</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-50 rounded-xl p-2.5"><p className="text-[10px] uppercase text-slate-400 font-semibold">Type</p><p className="text-xs font-bold text-slate-700 mt-0.5">{person.isDriver ? '🚌 Driver' : person.role === 'UNREGISTERED' ? '👤 Person' : '👤 User'}</p></div>
                <div className="bg-slate-50 rounded-xl p-2.5"><p className="text-[10px] uppercase text-slate-400 font-semibold">Last update</p><p className="text-xs font-bold text-slate-700 mt-0.5">{personLocation && personLocation.lastUpdate ? timeAgo(personLocation.lastUpdate) : '—'}</p></div>
                <div className="bg-slate-50 rounded-xl p-2.5"><p className="text-[10px] uppercase text-slate-400 font-semibold">Speed</p><p className="text-xs font-bold text-slate-700 mt-0.5">{personLocation && personLocation.speed ? Math.round(personLocation.speed) + ' km/h' : '—'}</p></div>
                <div className="bg-slate-50 rounded-xl p-2.5"><p className="text-[10px] uppercase text-slate-400 font-semibold">Accuracy</p><p className="text-xs font-bold text-slate-700 mt-0.5">{personLocation && personLocation.accuracy ? Math.round(personLocation.accuracy) + ' m' : '—'}</p></div>
              </div>
              {personLocation && personLocation.latitude && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-[10px] uppercase text-slate-400 font-semibold">Current Location</p>
                  <p className="text-xs font-mono text-slate-600 mt-1">{personLocation.latitude.toFixed(5)}, {personLocation.longitude.toFixed(5)}</p>
                </div>
              )}
            </Card>
            <Card className="p-5">
              <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2"><GradIcon color="cyan" name="signal" size="w-8 h-8 rounded-lg" className="w-4 h-4" /> Tracking Status</h3>
              {trackingPerson ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-xl p-3 font-semibold"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live location sharing active. Marker updates automatically.</div>
                  {person.isDriver ? <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 rounded-xl p-3 font-semibold"><Icon name="bus" className="w-4 h-4" /> Registered driver — shown as bus marker.</div>
                    : <div className="flex items-center gap-2 text-xs text-purple-700 bg-purple-50 rounded-xl p-3 font-semibold"><Icon name="user" className="w-4 h-4" /> Shown as person marker (not a driver).</div>}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-xl p-3 font-semibold"><Icon name="alert" className="w-4 h-4" /> {personOffline ? 'This person stopped sharing their location.' : 'Waiting for location updates...'}</div>
              )}
              <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">Location is only shown when this person actively shares their GPS. No fake locations are created.</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function LiveMapPage() {
  const { vehicles, loading, selectedId, selectVehicle } = useVehicles();
  const [routeF, setRouteF] = useState(''); const [vehF, setVehF] = useState(''); const [liveOnly, setLiveOnly] = useState(false);
  const routes = useMemo(() => { const m = {}; vehicles.forEach((v) => { if (v.routeId) m[v.routeId._id] = v.routeId; }); return Object.values(m); }, [vehicles]);
  const filtered = vehicles.filter((v) => ((!routeF) || (v.routeId && v.routeId._id === routeF)) && ((!vehF) || (v._id === vehF)) && ((!liveOnly) || (v.status === 'LIVE')));
  const selectedRoute = (vehicles.find((v) => v._id === selectedId) || {}).routeId || null;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3 mr-2"><GradIcon color="blue" name="map" size="w-9 h-9 rounded-lg" className="w-4 h-4" /><h2 className="text-sm font-bold text-slate-800">Live Map</h2></div>
        <Select className="w-40" value={routeF} onChange={(e) => setRouteF(e.target.value)}><option value="">All Routes</option>{routes.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}</Select>
        <Select className="w-40" value={vehF} onChange={(e) => setVehF(e.target.value)}><option value="">All Vehicles</option>{vehicles.map((v) => <option key={v._id} value={v._id}>{v.vehicleNumber}</option>)}</Select>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 ml-auto cursor-pointer"><input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} className="rounded border-slate-300" style={{ accentColor: BLUE }} /> Live only</label>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 min-w-0">{loading ? <Skeleton className="h-[520px]" /> : <MapView route={selectedRoute} vehicles={filtered} selectedVehicleId={selectedId} onSelectVehicle={selectVehicle} centerOnSelect heightClass="h-[420px] md:h-[560px]" />}</div>
        <Card className="p-3 max-h-[560px] overflow-y-auto">
          <p className="text-xs font-bold text-slate-700 px-2 pb-2 pt-1">Vehicles ({filtered.length})</p>
          {filtered.length === 0 ? <EmptyState icon="bus" title="No vehicles are currently online." /> : filtered.map((v) => (
            <button key={v._id} onClick={() => selectVehicle(v._id)} className={`w-full text-left p-3 rounded-xl mb-1.5 border transition-all ${v._id === selectedId ? 'border-blue-500 bg-blue-50/60 shadow-sm' : 'border-slate-200 hover:bg-slate-50'}`}>
              <div className="flex items-center justify-between"><span className="text-sm font-bold text-slate-800">{v.vehicleNumber}</span><LiveDot status={v.status} /></div>
              <p className="text-[11px] text-slate-500 mt-1">{v.routeId ? v.routeId.name : 'No route'} · Next: {v.nextStopName || '—'}{v.etaMinutes != null ? ' (' + v.etaMinutes + ' min)' : ''}</p>
              {(v.status === 'OFFLINE' || v.status === 'TRACKING_STOPPED') && <p className="text-[10px] text-red-500 mt-1 font-semibold">Last updated {timeAgo(v.lastUpdated)}</p>}
            </button>
          ))}
        </Card>
      </div>
    </div>
  );
}

function RoutesPage() {
  const [routes, setRoutes] = useState(null); const [error, setError] = useState(null);
  const load = useCallback(() => { setError(null); api('/routes').then(setRoutes).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  return (
    <div>
      <div className="flex items-center gap-3 mb-5"><GradIcon color="purple" name="route" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">Routes</h2></div>
      {error ? <Card><ErrorState message={error} retry={load} /></Card> : !routes ? <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}</div> : routes.length === 0 ? <Card><EmptyState icon="route" title="No routes created yet." /></Card> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {routes.map((r) => (
            <Card key={r._id} className="p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <GradIcon color="blue" name="route" size="w-11 h-11 rounded-xl" className="w-5 h-5" />
                <Badge color={r.status === 'ACTIVE' ? 'green' : 'gray'}>{r.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge>
              </div>
              <h3 className="text-sm font-extrabold text-slate-800 mt-3">{r.name}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{r.startPoint} → {r.destination}</p>
              <div className="flex gap-4 mt-3 text-[11px] font-semibold text-slate-500"><span>{r.stopCount} stops</span><span>{r.activeVehicles} active vehicles</span></div>
              <Btn variant="outline" className="w-full mt-4" onClick={() => navigate('/routes/' + r._id)}>View Route</Btn>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function RouteDetailsPage({ id }) {
  const [data, setData] = useState(null); const [error, setError] = useState(null);
  const { selectedId, selectVehicle } = useVehicles();
  const { socket } = useSocket();
  const load = useCallback(() => { setError(null); api('/routes/' + id).then(setData).catch((e) => setError(e.message)); }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!socket) return;
    const h = (p) => setData((d) => (d ? { ...d, vehicles: d.vehicles.map((v) => (v._id === p.vehicleId ? { ...v, currentLocation: { type: 'Point', coordinates: [p.longitude, p.latitude] }, speed: p.speed, status: p.status, lastUpdated: p.lastUpdated, eta: p.eta } : v)) } : d));
    socket.on('vehicleLocationUpdated', h);
    return () => socket.off('vehicleLocationUpdated', h);
  }, [socket]);
  if (error) return <Card><ErrorState message={error} retry={load} /></Card>;
  if (!data) return <div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><Skeleton className="h-[480px] lg:col-span-2" /><Skeleton className="h-[480px]" /></div>;
  const { route, vehicles } = data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-blue-600 flex items-center justify-center" onClick={() => navigate('/routes')}>←</button>
        <GradIcon color="blue" name="route" size="w-10 h-10 rounded-xl" className="w-5 h-5" />
        <div><h2 className="text-base font-extrabold text-slate-800">{route.name}</h2><p className="text-xs text-slate-500">{route.startPoint} → {route.destination}</p></div>
        <Badge color={route.status === 'ACTIVE' ? 'green' : 'gray'}>{route.status}</Badge>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 min-w-0"><MapView route={route} vehicles={vehicles} selectedVehicleId={selectedId} onSelectVehicle={selectVehicle} centerOnSelect /></div>
        <div className="flex flex-col gap-4 min-w-0">
          <Card className="p-5">
            <h3 className="text-sm font-bold text-slate-800 mb-4">Stops in order</h3>
            {route.stops.map((s, i) => (
              <div key={s._id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`w-3 h-3 rounded-full mt-1 ${i === 0 ? 'bg-green-500' : i === route.stops.length - 1 ? 'bg-red-500' : 'bg-blue-500'}`} />
                  {i < route.stops.length - 1 && <div className="w-px flex-1 border-l border-dashed border-slate-300 my-1" />}
                </div>
                <p className="text-sm text-slate-700 font-semibold pb-3">{s.name}</p>
              </div>
            ))}
          </Card>
          <Card className="p-5">
            <h3 className="text-sm font-bold text-slate-800 mb-3">Active vehicles</h3>
            {vehicles.length === 0 ? <EmptyState icon="bus" title="No vehicles on this route." /> : vehicles.map((v) => (
              <button key={v._id} onClick={() => navigate('/vehicles/' + v._id)} className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:bg-slate-50 mb-2 text-left">
                <span><span className="block text-sm font-bold text-slate-800">{v.vehicleNumber}</span><span className="block text-[11px] text-slate-500">Next: {(v.eta && v.eta.nextStop) ? v.eta.nextStop.name : '—'} · {Math.round(v.speed || 0)} km/h</span></span>
                <span className="text-xs font-bold text-blue-600">{v.eta ? etaLabel(v.eta.etaMinutes) : ''}</span>
              </button>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

function BusStopsPage({ params }) {
  const [stops, setStops] = useState(null); const [error, setError] = useState(null);
  const [q, setQ] = useState(params.get('q') || '');
  const [mapStop, setMapStop] = useState(null);
  const load = useCallback(() => { setError(null); api('/stops' + (q ? '?q=' + encodeURIComponent(q) : '')).then(setStops).catch((e) => setError(e.message)); }, [q]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div className="flex items-center gap-3"><GradIcon color="orange" name="pin" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">Bus Stops</h2></div>
        <div className="relative w-64 max-w-full">
          <Icon name="search" className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <Input placeholder="Search by stop name or area..." className="pl-10 rounded-full" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {error ? <Card><ErrorState message={error} retry={load} /></Card> : !stops ? <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-44" />)}</div> : stops.length === 0 ? <Card><EmptyState icon="pin" title="No bus stops found." sub="Try a different search term." /></Card> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {stops.map((s) => (
            <Card key={s._id} className="p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <GradIcon color="orange" name="pin" size="w-10 h-10 rounded-lg" className="w-5 h-5" />
                  <div><p className="text-sm font-extrabold text-slate-800">{s.name}</p><p className="text-[11px] text-slate-500">{s.address || '—'}</p></div>
                </div>
                <button className="w-8 h-8 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 flex items-center justify-center" title="Show on map" onClick={() => setMapStop(s)}><Icon name="map" className="w-4 h-4" /></button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">{(s.routes || []).length === 0 ? <span className="text-[11px] text-slate-400">No routes</span> : s.routes.map((r) => <Badge key={r._id} color="blue">{r.name || r.routeNumber}</Badge>)}</div>
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-[11px] font-bold text-slate-600 mb-1.5">Upcoming vehicles</p>
                {(!s.upcoming || s.upcoming.length === 0) ? <p className="text-[11px] text-slate-400">No vehicles approaching.</p> : s.upcoming.slice(0, 3).map((u) => <p key={u.vehicleId} className="text-[11px] text-slate-600 flex justify-between font-semibold"><span>{u.vehicleNumber}</span><span className="text-blue-600 font-bold">{u.etaMinutes} min</span></p>)}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!mapStop} onClose={() => setMapStop(null)} title={mapStop ? mapStop.name : ''} wide>
        {mapStop && <MapView heightClass="h-[380px]" showLegend={false} fitOnRoute={false} route={{ _id: 'stop-' + mapStop._id, geometry: [], stops: [mapStop] }} vehicles={[]} />}
      </Modal>
    </div>
  );
}

function MyTripsPage() {
  const [trips, setTrips] = useState(null); const [error, setError] = useState(null);
  const load = useCallback(() => { setError(null); api('/trips').then(setTrips).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  return (
    <div>
      <div className="flex items-center gap-3 mb-5"><GradIcon color="cyan" name="clock" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">My Trips</h2></div>
      {error ? <Card><ErrorState message={error} retry={load} /></Card> : !trips ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div> : trips.length === 0 ? <Card><EmptyState icon="clock" title="You haven't tracked any trips yet." sub="Track a vehicle from the Track page or a vehicle details page." /></Card> : (
        <div className="space-y-3">
          {trips.map((t) => (
            <Card key={t._id} className="p-5 flex flex-wrap items-center gap-4">
              <GradIcon color="blue" name="bus" size="w-11 h-11 rounded-xl" className="w-5 h-5" />
              <div className="flex-1 min-w-[160px]"><p className="text-sm font-extrabold text-slate-800">{t.routeId ? t.routeId.name : 'Route'}</p><p className="text-xs text-slate-500">{t.startStop} → {t.destinationStop}</p></div>
              <div className="text-xs text-slate-500"><p className="flex items-center gap-1.5 font-semibold"><Icon name="calendar" className="w-3.5 h-3.5" /> {fmtDate(t.startTime)}</p><p className="flex items-center gap-1.5 mt-0.5"><Icon name="clock" className="w-3.5 h-3.5" /> {fmtTime(t.startTime)}{t.endTime ? ' – ' + fmtTime(t.endTime) : ''}</p></div>
              <div className="text-xs text-slate-500">{t.distanceKm != null ? <span className="block font-bold text-slate-700">{t.distanceKm} km</span> : null}{t.vehicleId ? <span className="block">{t.vehicleId.vehicleNumber}</span> : null}</div>
              <Badge color={t.status === 'COMPLETED' ? 'green' : 'blue'}>{t.status === 'COMPLETED' ? 'Completed' : 'Ongoing'}</Badge>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationsPage() {
  const [items, setItems] = useState(null); const [error, setError] = useState(null);
  const { socket } = useSocket();
  const load = useCallback(() => { setError(null); api('/notifications').then(setItems).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  useEffect(() => { if (!socket) return; const h = () => load(); socket.on('notificationCreated', h); return () => socket.off('notificationCreated', h); }, [socket, load]);
  const markAll = async () => { await api('/notifications/read-all', { method: 'PATCH' }); load(); };
  const colors = { INFO: 'blue', SUCCESS: 'green', WARNING: 'orange', DANGER: 'red' };
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3"><GradIcon color="orange" name="bell" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">Notifications</h2></div>
        <Btn variant="outline" onClick={markAll}>Mark all as read</Btn>
      </div>
      {error ? <Card><ErrorState message={error} retry={load} /></Card> : !items ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div> : items.length === 0 ? <Card><EmptyState icon="bell" title="You're all caught up." sub="Real tracking events will appear here." /></Card> : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card key={n._id} className={`p-4 flex items-start gap-3 ${n.read ? '' : 'border-blue-300 bg-blue-50/40'}`}>
              <GradIcon color={colors[n.type] || 'blue'} name={n.type === 'SUCCESS' ? 'check' : (n.type === 'WARNING' || n.type === 'DANGER') ? 'alert' : 'info'} size="w-9 h-9 rounded-lg" className="w-4 h-4" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800">{n.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{n.message}{n.eta != null ? ' · ETA ' + n.eta + ' min' : ''}{n.distance != null ? ' · ' + n.distance + ' km' : ''}</p>
                <p className="text-[10px] text-slate-400 mt-1">{timeAgo(n.createdAt)}</p>
              </div>
              {!n.read && <button className="text-[11px] font-bold text-blue-600 hover:underline shrink-0" onClick={async () => { await api('/notifications/' + n._id + '/read', { method: 'PATCH' }); load(); }}>Mark read</button>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function usePersonLocation() {
  const toast = useToast();
  const { user } = useAuth();
  const [sharing, setSharing] = useState(false);
  const [gpsState, setGpsState] = useState('off');
  const [gpsError, setGpsError] = useState(null);
  const [lastLocation, setLastLocation] = useState(null);
  const watchRef = useRef(null);
  const lastSentRef = useRef(0);
  const stop = useCallback(async () => {
    if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
    setSharing(false); setGpsState('off');
    if (user) { try { await api('/location/stop', { method: 'POST' }); } catch (e) { /* ignore */ } }
    toast('Location sharing stopped.', 'info');
  }, [user, toast]);
  const start = useCallback(async () => {
    if (!navigator.geolocation) { setGpsError('Geolocation is not supported by this browser.'); setGpsState('lost'); return; }
    setGpsError(null);
    if (user) { try { await api('/location/start', { method: 'POST' }); } catch (e) { toast('Failed to start location sharing: ' + e.message, 'error'); return; } }
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const payload = { latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy, speed: c.speed != null ? Math.round((c.speed || 0) * 3.6) : 0, heading: c.heading || 0 };
        setGpsState('active'); setLastLocation(payload);
        const now = Date.now();
        if (now - lastSentRef.current > 3000) { lastSentRef.current = now; api('/location/update', { method: 'POST', body: payload }).catch(() => setGpsState('lost')); }
      },
      (err) => {
        setGpsState('lost');
        if (err.code === 1) setGpsError('Location permission denied. Please enable location access in your browser settings.');
        else if (err.code === 2) setGpsError('GPS unavailable. Please check your device location settings.');
        else setGpsError('GPS signal lost. Trying to reconnect...');
      },
      { enableHighAccuracy: true, maximumAge: 2000, distanceFilter: 3, timeout: 15000 }
    );
    setSharing(true);
    toast('Location sharing started. Others can track you by your Rwanda phone number.', 'success');
  }, [user, toast]);
  useEffect(() => () => { if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current); }, []);
  return { sharing, gpsState, gpsError, lastLocation, start, stop };
}

function ProfilePage() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user.name); const [phone, setPhone] = useState(user.phone || '');
  const toast = useToast(); const [saving, setSaving] = useState(false);
  const loc = usePersonLocation();
  const save = async (e) => {
    e.preventDefault(); setSaving(true);
    try { const d = await api('/users/me', { method: 'PUT', body: { name, phone } }); setUser(d.user); toast('Profile updated.', 'success'); }
    catch (err) { toast(err.message, 'error'); } finally { setSaving(false); }
  };
  const gpsLabel = loc.gpsState === 'active' ? ['bg-green-500', 'Location sharing active'] : loc.gpsState === 'lost' ? ['bg-amber-500', 'GPS signal lost'] : ['bg-slate-400', 'Not sharing location'];
  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-3 mb-5"><GradIcon color="blue" name="user" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">My Profile</h2></div>
      <Card className="p-6">
        <div className="flex items-center gap-4 mb-6">
          <span className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center text-xl font-bold shadow-md">{initials(user.name)}</span>
          <div><p className="text-sm font-extrabold text-slate-800">{user.name}</p><p className="text-xs text-slate-500">{user.email}</p><div className="mt-1"><Badge color="blue">{user.role}</Badge></div></div>
        </div>
        <form onSubmit={save} className="space-y-4">
          <div><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div><Label>Phone (Rwanda format)</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="078XXXXXXX" /></div>
          <div><Label>Email (cannot be changed)</Label><Input value={user.email} disabled className="bg-slate-50 text-slate-500" /></div>
          <Btn type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</Btn>
        </form>
      </Card>
      <Card className="p-6 mt-4">
        <div className="flex items-center gap-3 mb-3"><GradIcon color="green" name="share" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h3 className="text-sm font-bold text-slate-800">Share My Location</h3></div>
        <p className="text-xs text-slate-500 mb-4">When enabled, others can track your real-time location by entering your Rwanda phone number ({user.phone || 'add phone in profile'}). Your location is only visible while sharing is active.</p>
        <div className="flex items-center gap-2 mb-3 text-xs font-semibold"><span className={`w-2.5 h-2.5 rounded-full ${gpsLabel[0]}`} /><span className="text-slate-600">{gpsLabel[1]}</span></div>
        {loc.lastLocation && (
          <div className="bg-slate-50 rounded-xl p-3 mb-3 text-xs text-slate-600">
            <p className="font-semibold">📍 {loc.lastLocation.latitude.toFixed(5)}, {loc.lastLocation.longitude.toFixed(5)}</p>
            <p className="text-slate-400 mt-1">Accuracy: {loc.lastLocation.accuracy ? Math.round(loc.lastLocation.accuracy) + ' m' : '—'}</p>
          </div>
        )}
        {loc.gpsError && <div className="mb-3 flex gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl p-3 text-xs"><Icon name="alert" className="w-4 h-4 shrink-0" /><span>{loc.gpsError}</span></div>}
        <div className="grid grid-cols-2 gap-2">
          <Btn onClick={loc.start} disabled={loc.sharing}><Icon name="play" className="w-4 h-4" /> Start Sharing</Btn>
          <Btn variant="dangerOutline" onClick={loc.stop} disabled={!loc.sharing}><Icon name="stop" className="w-4 h-4" /> Stop Sharing</Btn>
        </div>
      </Card>
    </div>
  );
}

function SettingsPage() {
  const toast = useToast();
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [saving, setSaving] = useState(false);
  const change = async (e) => {
    e.preventDefault(); setSaving(true);
    try { await api('/users/me/password', { method: 'PUT', body: { currentPassword: cur, newPassword: nw } }); setCur(''); setNw(''); toast('Password changed.', 'success'); }
    catch (err) { toast(err.message, 'error'); } finally { setSaving(false); }
  };
  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-3 mb-5"><GradIcon color="slate" name="settings" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">Settings</h2></div>
      <Card className="p-6 mb-4">
        <h3 className="text-sm font-bold text-slate-800 mb-4">Change password</h3>
        <form onSubmit={change} className="space-y-4">
          <div><Label>Current password</Label><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required /></div>
          <div><Label>New password</Label><Input type="password" value={nw} onChange={(e) => setNw(e.target.value)} required minLength={6} /></div>
          <Btn type="submit" disabled={saving}>{saving ? 'Saving...' : 'Update password'}</Btn>
        </form>
      </Card>
      <Card className="p-6">
        <h3 className="text-sm font-bold text-slate-800 mb-2">About CarTracker</h3>
        <p className="text-xs text-slate-500 leading-relaxed">Real-time public transport and person tracking for Rwanda. Vehicle and user locations update live via GPS + Socket.IO. Locations are only visible when actively shared.</p>
      </Card>
    </div>
  );
}

function VehicleDetailsPage({ id }) {
  const [data, setData] = useState(null); const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const { socket } = useSocket();
  const load = useCallback(() => {
    setError(null);
    api('/vehicles/' + id).then(setData).catch((e) => setError(e.message));
    api('/vehicles/' + id + '/history?limit=50').then(setHistory).catch(() => {});
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!socket) return;
    const h = (p) => {
      if (p.vehicleId !== id) return;
      setData((d) => (d ? { ...d, vehicle: { ...d.vehicle, currentLocation: { type: 'Point', coordinates: [p.longitude, p.latitude] }, speed: p.speed, heading: p.heading, status: p.status, lastUpdated: p.lastUpdated }, eta: p.eta } : d));
      setHistory((hs) => [{ latitude: p.latitude, longitude: p.longitude, speed: p.speed, heading: p.heading, timestamp: new Date().toISOString(), source: p.via }, ...hs].slice(0, 50));
    };
    socket.on('vehicleLocationUpdated', h);
    return () => socket.off('vehicleLocationUpdated', h);
  }, [socket, id]);
  if (error) return <Card><ErrorState message={error} retry={load} /></Card>;
  if (!data) return <div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><Skeleton className="h-40 lg:col-span-3" /><Skeleton className="h-[420px] lg:col-span-2" /><Skeleton className="h-[420px]" /></div>;
  const { vehicle: v, eta } = data;
  const info = [
    ['Vehicle number', v.vehicleNumber], ['License plate', v.licensePlate || '—'], ['Type', v.type], ['Driver', v.driverId ? v.driverId.name : 'Unassigned'],
    ['Route', v.routeId ? v.routeId.name : '—'], ['Current speed', Math.round(v.speed || 0) + ' km/h'], ['Status', sMeta(v.status).label], ['Last update', timeAgo(v.lastUpdated)],
    ['Current location', v.currentLocation && v.currentLocation.coordinates ? v.currentLocation.coordinates[1].toFixed(4) + ', ' + v.currentLocation.coordinates[0].toFixed(4) : '—'],
    ['Next stop', eta && eta.nextStop ? eta.nextStop.name : '—'], ['ETA', eta ? etaLabel(eta.etaMinutes) : '—'], ['Heading', Math.round(v.heading || 0) + '°'],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-blue-600 flex items-center justify-center" onClick={() => navigate('/live-map')}>←</button>
        <GradIcon color="blue" name="bus" size="w-10 h-10 rounded-xl" className="w-5 h-5" />
        <h2 className="text-base font-extrabold text-slate-800">{v.vehicleNumber}</h2>
        <StatusBadge status={v.status} />
        <button className="ml-auto text-xs font-bold text-blue-600 hover:underline" onClick={() => navigate('/track?code=' + encodeURIComponent(v.vehicleNumber))}>Track as passenger →</button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 min-w-0"><MapView route={v.routeId} vehicles={[v]} selectedVehicleId={v._id} heightClass="h-[380px] md:h-[460px]" /></div>
        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-4">Vehicle information</h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            {info.map(([k, val]) => <div key={k}><p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{k}</p><p className="text-xs font-bold text-slate-700 mt-0.5">{String(val)}</p></div>)}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><UpcomingStopsList eta={eta} loading={false} /></Card>
        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-3">GPS update history</h3>
          <div className="max-h-80 overflow-y-auto">
            {history.length === 0 ? <EmptyState icon="clock" title="No GPS data yet." sub="History appears once the driver sends real GPS updates." /> : (
              <table className="w-full text-[11px] text-slate-600">
                <thead className="sticky top-0 bg-white"><tr className="text-left text-slate-400"><th className="py-1.5 pr-2">Time</th><th className="pr-2">Lat</th><th className="pr-2">Lng</th><th className="pr-2">Speed</th><th>Source</th></tr></thead>
                <tbody>{history.map((h, i) => <tr key={i} className="border-t border-slate-100"><td className="py-1.5 pr-2">{fmtTime(h.timestamp)}</td><td className="pr-2">{h.latitude.toFixed(4)}</td><td className="pr-2">{h.longitude.toFixed(4)}</td><td className="pr-2">{Math.round(h.speed || 0)} km/h</td><td className="capitalize">{h.source}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ============================== DRIVER PAGES ============================== */
function useDriverTracking(vehicleId) {
  const toast = useToast();
  const [tracking, setTracking] = useState(false);
  const [gpsState, setGpsState] = useState('off');
  const [gps, setGps] = useState(null);
  const [gpsError, setGpsError] = useState(null);
  const watchRef = useRef(null); const lastSentRef = useRef(0);
  const stop = useCallback(async () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null; setTracking(false); setGpsState('off');
    if (vehicleId) { try { await api('/driver/tracking/stop', { method: 'POST' }); } catch (e) { /* ignore */ } }
    toast('GPS tracking stopped. Trip saved.', 'info');
  }, [vehicleId, toast]);
  const start = useCallback(() => {
    if (!vehicleId) { toast('No vehicle is assigned to your account.', 'error'); return; }
    if (!navigator.geolocation) { setGpsError('Geolocation is not supported by this browser.'); setGpsState('lost'); return; }
    setGpsError(null);
    api('/driver/tracking/start', { method: 'POST' }).catch(() => {});
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const payload = { latitude: c.latitude, longitude: c.longitude, speed: c.speed != null ? Math.round((c.speed || 0) * 3.6) : 0, heading: c.heading || 0, accuracy: c.accuracy, timestamp: new Date(pos.timestamp).toISOString() };
        setGps(payload); setGpsState('active');
        const now = Date.now();
        if (now - lastSentRef.current > 2500) { lastSentRef.current = now; api('/vehicles/' + vehicleId + '/location', { method: 'POST', body: payload }).catch(() => setGpsState((s) => (s === 'active' ? 'lost' : s))); }
      },
      (err) => { setGpsState('lost'); setGpsError(err.code === 1 ? 'Location permission is required. Enable location access in your browser settings to start vehicle tracking.' : 'GPS signal lost — trying to reconnect to your GPS location...'); },
      { enableHighAccuracy: true, maximumAge: 1000, distanceFilter: 0 }
    );
    setTracking(true);
    toast('GPS tracking started.', 'success');
  }, [vehicleId, toast]);
  useEffect(() => () => { if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current); }, []);
  return { tracking, gpsState, gps, gpsError, start, stop };
}

function DriverDashboard() {
  const { user } = useAuth();
  const { socket, connected } = useSocket();
  const [dash, setDash] = useState(null);
  const [error, setError] = useState(null);
  const now = useNow();
  const vehicleId = dash && dash.vehicle ? dash.vehicle._id : null;
  const trk = useDriverTracking(vehicleId);
  const load = useCallback(() => { api('/driver/dashboard').then(setDash).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!socket || !vehicleId) return;
    const h = (p) => {
      if (p.vehicleId !== vehicleId) return;
      setDash((d) => (d ? { ...d, vehicle: { ...d.vehicle, currentLocation: { type: 'Point', coordinates: [p.longitude, p.latitude] }, speed: p.speed, heading: p.heading, status: p.status, lastUpdated: p.lastUpdated }, eta: p.eta, recentGps: [{ time: p.timestamp, speed: p.speed, lat: p.latitude, lng: p.longitude }, ...(d.recentGps || [])].slice(0, 8) } : d));
    };
    socket.on('vehicleLocationUpdated', h);
    return () => socket.off('vehicleLocationUpdated', h);
  }, [socket, vehicleId]);

  if (error) return <Card className="p-4"><ErrorState message={error} retry={load} /></Card>;
  if (!dash) return <div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><Skeleton className="h-28 lg:col-span-3" /><Skeleton className="h-[440px] lg:col-span-2" /><Skeleton className="h-[440px]" /></div>;
  const { vehicle, eta, route, stats, recentGps } = dash;
  const gpsLive = trk.gpsState === 'active';
  const loc = vehicle && vehicle.currentLocation && vehicle.currentLocation.coordinates;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <GradIcon color="blue" name="bus" size="w-12 h-12 rounded-2xl" className="w-6 h-6" />
        <div className="flex-1 min-w-[200px]">
          <h2 className="text-lg font-extrabold text-slate-800">Driver Dashboard</h2>
          <p className="text-xs text-slate-500">Track your vehicle, send GPS updates and keep your route on time.</p>
        </div>
        <span className={`flex items-center gap-2 text-xs font-bold px-3.5 py-2 rounded-full text-white shadow-md bg-gradient-to-r ${gpsLive ? 'from-green-600 to-emerald-500' : trk.gpsState === 'lost' ? 'from-amber-500 to-orange-500' : 'from-slate-500 to-slate-600'}`}>
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> {gpsLive ? 'GPS LIVE — Trip in progress' : trk.gpsState === 'lost' ? 'GPS signal lost' : 'Trip not started'}
        </span>
        <span className="text-xs text-slate-500 font-semibold flex items-center gap-1.5"><Icon name="calendar" className="w-3.5 h-3.5" /> {now.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        <span className="text-xs text-slate-500 font-semibold flex items-center gap-1.5"><Icon name="clock" className="w-3.5 h-3.5" /> {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      {!vehicle ? (
        <Card><EmptyState icon="bus" title="No vehicle assigned" sub="Please contact an administrator before starting GPS tracking." /></Card>
      ) : (
        <>
          <Card className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 divide-slate-200 md:divide-x gap-4">
              <div className="flex items-center gap-3">
                <GradIcon color="blue" name="bus" size="w-12 h-12 rounded-xl" className="w-6 h-6" />
                <div><p className="text-sm font-extrabold text-slate-800">{vehicle.vehicleNumber}</p><p className="text-[11px] text-slate-500">{route ? route.name : 'No route'}</p><div className="mt-1"><StatusBadge status={vehicle.status} /></div></div>
              </div>
              <div className="flex items-center gap-3 md:pl-4"><GradIcon color="cyan" name="gauge" size="w-10 h-10 rounded-lg" className="w-5 h-5" /><div><p className="text-[11px] text-slate-400 font-medium">Current Speed</p><p className="text-sm font-extrabold text-slate-800">{Math.round(vehicle.speed || 0)} km/h</p></div></div>
              <div className="flex items-center gap-3 md:pl-4"><GradIcon color="orange" name="pin" size="w-10 h-10 rounded-lg" className="w-5 h-5" /><div><p className="text-[11px] text-slate-400 font-medium">Next Stop</p><p className="text-sm font-extrabold text-slate-800">{eta && eta.nextStop ? eta.nextStop.name : '—'}</p><p className="text-[11px] text-blue-600 font-bold">{eta ? etaLabel(eta.etaMinutes) : ''}</p></div></div>
              <div className="flex items-center gap-3 md:pl-4"><GradIcon color="green" name="locate" size="w-10 h-10 rounded-lg" className="w-5 h-5" /><div><p className="text-[11px] text-slate-400 font-medium">Current Location</p><p className="text-sm font-extrabold text-slate-800">{loc ? loc[1].toFixed(4) + ', ' + loc[0].toFixed(4) : 'No GPS yet'}</p><p className="text-[10px] text-slate-400">Updated {timeAgo(vehicle.lastUpdated)}</p></div></div>
            </div>
          </Card>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 flex flex-col gap-4 min-w-0">
              <MapView route={route} vehicles={[vehicle]} selectedVehicleId={vehicle._id} centerOnSelect heightClass="h-[360px] md:h-[440px]" />
              <Card className="p-5">
                <h3 className="text-sm font-bold text-slate-800 mb-4">Trip Statistics Today</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[['Total Distance', stats.distanceKm + ' km', 'blue'], ['Trip Duration', Math.floor(stats.durationMin / 60) + 'h ' + stats.durationMin % 60 + 'm', 'cyan'], ['Stops Completed', stats.stopsCompleted + ' / ' + stats.stopsTotal, 'green'], ['On Time', stats.onTime == null ? 'N/A' : stats.onTime + '%', 'orange']].map(([l, val, col]) => (
                    <div key={l} className="bg-slate-50 rounded-xl p-4 text-center"><GradIcon color={col} name="chart" size="w-8 h-8 rounded-lg mx-auto" className="w-4 h-4" /><p className="text-[10px] uppercase text-slate-400 font-semibold mt-2">{l}</p><p className="text-lg font-extrabold text-slate-800 mt-0.5">{val}</p></div>
                  ))}
                </div>
              </Card>
              <Card className="p-5">
                <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-slate-800">Upcoming Stops</h3><button className="text-[11px] font-bold text-blue-600 hover:underline" onClick={() => navigate('/driver/live-map')}>View all stops →</button></div>
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-400 border-b border-slate-100"><th className="py-2 font-semibold">Stop Name</th><th className="py-2 font-semibold">ETA</th><th className="py-2 font-semibold">Distance</th><th className="py-2 font-semibold">Status</th></tr></thead>
                  <tbody>
                    {(eta && eta.stops ? eta.stops.filter((s) => s.status !== 'DEPARTED') : []).map((s) => (
                      <tr key={s._id} className="border-b border-slate-50">
                        <td className={`py-3 font-bold ${s.status === 'NEXT' ? 'text-blue-600' : 'text-slate-700'}`}>{s.name}</td>
                        <td className="py-3 text-slate-600 font-semibold">{etaLabel(s.etaMinutes)}</td>
                        <td className="py-3 text-slate-600 font-semibold">{s.distanceKm != null ? s.distanceKm + ' km' : '—'}</td>
                        <td className="py-3">{s.status === 'NEXT' ? <Badge color="blue">Next stop</Badge> : <span className="inline-flex items-center gap-1.5 text-slate-500 font-semibold"><span className="w-2 h-2 rounded-full bg-slate-300" />Upcoming</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
            <div className="flex flex-col gap-4 min-w-0">
              <Card className="p-5">
                <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2"><GradIcon color="blue" name="bus" size="w-8 h-8 rounded-lg" className="w-4 h-4" /> Vehicle Information</h3>
                <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
                  <GradIcon color="blue" name="bus" size="w-12 h-12 rounded-xl" className="w-6 h-6" />
                  <div><p className="text-sm font-extrabold text-slate-800">{vehicle.vehicleNumber}</p><p className="text-[11px] text-slate-500">{route ? route.name + ' · ' + route.startPoint + ' → ' + route.destination : 'No route'}</p></div>
                </div>
                {[['Driver', user.name], ['Vehicle Type', vehicle.type], ['License Plate', vehicle.licensePlate || '—'], ['Status', sMeta(vehicle.status).label], ['Last Update', timeAgo(vehicle.lastUpdated)]].map(([k, v2]) => (
                  <div key={k} className="flex justify-between py-2.5 border-b border-slate-50 text-xs"><span className="text-slate-500 font-medium">{k}</span><span className="font-bold text-slate-700">{v2}</span></div>
                ))}
              </Card>
              <Card className="p-5">
                <h3 className="text-sm font-bold text-slate-800 mb-3">Current Route Progress</h3>
                <RouteProgress eta={eta} />
              </Card>
              <Card className="p-5">
                <h3 className="text-sm font-bold text-slate-800 mb-4">GPS Tracking Controls</h3>
                <div className="grid grid-cols-2 gap-2">
                  <Btn onClick={trk.start} disabled={trk.tracking}><Icon name="play" className="w-4 h-4" /> Start Trip</Btn>
                  <Btn variant="dangerOutline" onClick={trk.stop} disabled={!trk.tracking}><Icon name="stop" className="w-4 h-4" /> End Trip</Btn>
                </div>
                <div className="mt-4 space-y-2 text-[11px] font-semibold text-slate-600">
                  <p className="flex items-center gap-2"><span className={`w-2.5 h-2.5 rounded-full ${trk.gpsState === 'active' ? 'bg-green-500' : trk.gpsState === 'lost' ? 'bg-amber-500' : 'bg-slate-300'}`} /> GPS: {trk.gpsState === 'active' ? 'Connected' : trk.gpsState === 'lost' ? 'Signal lost' : 'Not started'}</p>
                  <p className="flex items-center gap-2"><span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} /> Server: {connected ? 'Live connection' : 'Disconnected'}</p>
                  {trk.gps && <p className="text-slate-400">Accuracy ±{Math.round(trk.gps.accuracy || 0)} m {(trk.gps.accuracy || 0) > 30 ? '· ⚠ Low GPS accuracy' : ''}</p>}
                </div>
                {trk.gpsError && <div className="mt-3 flex gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl p-3 text-xs"><Icon name="alert" className="w-4 h-4 shrink-0" />{trk.gpsError}</div>}
              </Card>
              <Card className="p-5">
                <h3 className="text-sm font-bold text-slate-800 mb-3">Recent GPS Updates</h3>
                {(!recentGps || recentGps.length === 0) ? <p className="text-xs text-slate-400">No GPS updates yet. Start tracking to send your location.</p> : recentGps.map((g, i) => (
                  <div key={i} className="flex items-center gap-3 py-2.5 border-t border-slate-50 text-xs">
                    <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><Icon name="pin" className="w-3.5 h-3.5" /></span>
                    <span className="text-slate-500 w-16 font-semibold">{fmtTime(g.time)}</span>
                    <span className="flex-1 text-slate-600 truncate font-medium">{g.lat.toFixed(4)}, {g.lng.toFixed(4)}</span>
                    <span className="text-slate-700 font-bold">{Math.round(g.speed || 0)} km/h</span>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DriverTripHistoryPage() {
  const [trips, setTrips] = useState(null); const [error, setError] = useState(null);
  const load = useCallback(() => { setError(null); api('/trips').then(setTrips).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  const th = 'text-left text-[11px] uppercase tracking-wide text-slate-400 font-semibold py-2.5 pr-3';
  const td = 'py-3 pr-3 text-xs text-slate-700 font-medium';
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3"><GradIcon color="cyan" name="clock" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">Trip History</h2></div>
        <Btn variant="outline" onClick={() => exportCsv('driver-trips.csv', (trips || []).map((t) => ({ date: fmtDate(t.startTime), start: t.startStop, end: t.destinationStop, distance_km: t.distanceKm || '', status: t.status })))}><Icon name="down" className="w-4 h-4" /> Export CSV</Btn>
      </div>
      {error ? <Card><ErrorState message={error} retry={load} /></Card> : !trips ? <Skeleton className="h-40" /> : trips.length === 0 ? <Card><EmptyState icon="clock" title="No trips yet." sub="Press Start Trip on the dashboard to begin broadcasting your GPS." /></Card> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-slate-50/80"><tr className="border-b border-slate-100"><th className={th + ' pl-4'}>Date</th><th className={th}>Route</th><th className={th}>From → To</th><th className={th}>Start</th><th className={th}>End</th><th className={th}>Distance</th><th className={th}>Stops</th><th className={th}>Status</th></tr></thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t._id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className={td + ' pl-4'}>{fmtDate(t.startTime)}</td>
                  <td className={td + ' font-bold'}>{t.routeId ? t.routeId.name : '—'}</td>
                  <td className={td}>{t.startStop} → {t.destinationStop}</td>
                  <td className={td}>{fmtTime(t.startTime)}</td>
                  <td className={td}>{t.endTime ? fmtTime(t.endTime) : '—'}</td>
                  <td className={td}>{t.distanceKm != null ? t.distanceKm + ' km' : '—'}</td>
                  <td className={td}>{t.completedStops || 0}</td>
                  <td className={td}><Badge color={t.status === 'COMPLETED' ? 'green' : 'blue'}>{t.status === 'COMPLETED' ? 'Completed' : 'In progress'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/* ============================== ADMIN PAGES ============================== */
function useAdminData(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => { setError(null); api(path).then(setData).catch((e) => setError(e.message)); }, [path]);
  useEffect(() => { load(); }, [load]);
  return [data, setData, load, error];
}
const TH = 'text-left text-[11px] uppercase tracking-wide text-slate-400 font-semibold py-2.5 pr-3';
const TD = 'py-3 pr-3 text-xs text-slate-700 font-medium';

function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState(null);
  const { vehicles, loading, selectedId, selectVehicle } = useVehicles();
  const now = useNow();
  const load = useCallback(() => { api('/admin/dashboard/stats').then(setStats).catch(() => {}); api('/admin/activity').then(setActivity).catch(() => {}); }, []);
  useEffect(load, [load]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 className="text-xl font-extrabold text-slate-800">Dashboard</h2><p className="text-xs text-slate-500 mt-0.5">Welcome back! Here's what's happening with your transport system today.</p></div>
        <div className="flex gap-4 text-xs text-slate-500 font-semibold">
          <span className="flex items-center gap-1.5"><Icon name="calendar" className="w-4 h-4" /> {now.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          <span className="flex items-center gap-1.5"><Icon name="clock" className="w-4 h-4" /> {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard loading={!stats} color="blue" icon="bus" label="Total Vehicles" value={stats ? stats.totalVehicles : 0} sub={stats ? '↑ ' + stats.week.vehicles + ' this week' : ''} />
        <StatCard loading={!stats} color="green" icon="nav" label="Live Vehicles" value={stats ? stats.liveVehicles : 0} sub={stats ? stats.livePercent + '% online' : ''} subColor="text-slate-500" />
        <StatCard loading={!stats} color="purple" icon="user" label="Total Drivers" value={stats ? stats.totalDrivers : 0} sub={stats ? '↑ ' + stats.week.drivers + ' this week' : ''} />
        <StatCard loading={!stats} color="cyan" icon="route" label="Total Routes" value={stats ? stats.totalRoutes : 0} sub={stats ? '↑ ' + stats.week.routes + ' this week' : ''} />
        <StatCard loading={!stats} color="orange" icon="pin" label="Bus Stops" value={stats ? stats.totalBusStops : 0} sub={stats ? '↑ ' + stats.week.stops + ' this week' : ''} />
        <StatCard loading={!stats} color="red" icon="users" label="Registered Users" value={stats ? stats.totalUsers.toLocaleString() : 0} sub={stats ? '↑ ' + stats.week.users + ' this week' : ''} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 p-5 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-800">Live Fleet Map</h3>
            <div className="flex gap-4 text-[11px] font-semibold text-slate-500"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" />Live</span><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" />Offline</span><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" />In Service</span></div>
          </div>
          {loading ? <Skeleton className="h-[380px]" /> : <MapView vehicles={vehicles} selectedVehicleId={selectedId} onSelectVehicle={(id) => { selectVehicle(id); navigate('/vehicles/' + id); }} heightClass="h-[340px] md:h-[400px]" showLegend={false} />}
        </Card>
        <Card className="p-5 min-w-0">
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-slate-800">Live Vehicles</h3><button className="text-[11px] font-bold text-blue-600 hover:underline" onClick={() => navigate('/admin/vehicles')}>View all</button></div>
          {loading ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div> : (
            <table className="w-full">
              <thead><tr className="border-b border-slate-100"><th className={TH}>Vehicle</th><th className={TH}>Route</th><th className={TH}>Speed</th><th className={TH}>Status</th><th className={TH}>Update</th></tr></thead>
              <tbody>
                {vehicles.slice(0, 6).map((v) => (
                  <tr key={v._id} className="border-b border-slate-50 hover:bg-slate-50/60 cursor-pointer" onClick={() => navigate('/admin/vehicles')}>
                    <td className={TD}><span className="flex items-center gap-2"><GradIcon color="blue" name="bus" size="w-7 h-7 rounded-lg" className="w-3.5 h-3.5" /><button className="font-bold text-slate-800 hover:text-blue-600" onClick={(e) => { e.stopPropagation(); navigate('/vehicles/' + v._id); }}>{v.vehicleNumber}</button></span></td>
                    <td className={TD}>{v.routeId ? v.routeId.name : '—'}</td>
                    <td className={TD}>{Math.round(v.speed || 0)} km/h</td>
                    <td className={TD}><LiveDot status={v.status} /></td>
                    <td className={TD}>{timeAgo(v.lastUpdated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-4 flex gap-2 bg-blue-50/70 rounded-xl p-3 text-[11px] text-slate-600"><Icon name="info" className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" /><p>Real-time vehicle tracking helps you monitor your fleet, ensure on-time arrivals and improve passenger experience.</p></div>
        </Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 p-5 min-w-0">
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-slate-800">Recent Vehicles</h3><button className="text-[11px] font-bold text-blue-600 hover:underline" onClick={() => navigate('/admin/vehicles')}>View all</button></div>
          {loading ? <Skeleton className="h-40" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead><tr className="border-b border-slate-100"><th className={TH}>Vehicle</th><th className={TH}>Route</th><th className={TH}>Driver</th><th className={TH}>Location</th><th className={TH}>Speed</th><th className={TH}>Status</th><th className={TH}>Update</th></tr></thead>
                <tbody>
                  {vehicles.slice(0, 5).map((v) => (
                    <tr key={v._id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className={TD}><button className="font-bold text-blue-600 hover:underline" onClick={() => navigate('/vehicles/' + v._id)}>{v.vehicleNumber}</button></td>
                      <td className={TD}>{v.routeId ? v.routeId.name : '—'}</td>
                      <td className={TD}>{v.driverId ? v.driverId.name : 'Unassigned'}</td>
                      <td className={TD}>{v.nextStopName || '—'}</td>
                      <td className={TD}>{Math.round(v.speed || 0)} km/h</td>
                      <td className={TD}><LiveDot status={v.status} /></td>
                      <td className={TD}>{timeAgo(v.lastUpdated)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="flex flex-col gap-4 min-w-0">
          <Card className="p-5">
            <h3 className="text-sm font-bold text-slate-800 mb-4">Quick Actions</h3>
            <div className="grid grid-cols-3 gap-2">
              {[['bus', 'Add Vehicle', '/admin/vehicles?new=1', 'blue'], ['user', 'Add Driver', '/admin/drivers?new=1', 'green'], ['route', 'Create Route', '/admin/routes?new=1', 'purple'], ['pin', 'Add Bus Stop', '/admin/bus-stops?new=1', 'orange'], ['chart', 'View Reports', '/admin/reports', 'cyan'], ['settings', 'Settings', '/admin/settings', 'slate']].map(([ic, label, to, color]) => (
                <button key={label} onClick={() => navigate(to)} className="flex flex-col items-center gap-2 p-3 rounded-2xl border border-slate-200 hover:border-blue-300 hover:shadow-md hover:bg-slate-50 transition-all">
                  <GradIcon color={color} name={ic} size="w-10 h-10 rounded-xl" className="w-5 h-5" />
                  <span className="text-[11px] font-bold text-slate-700 text-center">{label}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-slate-800">Recent Activity</h3><button className="text-[11px] font-bold text-blue-600 hover:underline" onClick={() => navigate('/admin/audit-logs')}>View all</button></div>
            {!activity ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div> : activity.length === 0 ? <p className="text-xs text-slate-400">No activity yet.</p> : activity.map((a, i) => (
              <div key={i} className="flex items-start gap-3 py-2.5 border-t border-slate-50">
                <GradIcon color={a.kind === 'event' ? 'green' : 'blue'} name={a.kind === 'event' ? 'bell' : 'edit'} size="w-8 h-8 rounded-lg" className="w-4 h-4" />
                <div className="min-w-0"><p className="text-xs text-slate-700 font-medium">{a.text}</p><p className="text-[10px] text-slate-400">{timeAgo(a.time)}</p></div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

function AdminVehicles({ params }) {
  const toast = useToast();
  const [vehicles, , load] = useAdminData('/vehicles');
  const [opts, setOpts] = useState({ drivers: [], routes: [] });
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [saving, setSaving] = useState(false);
  const wantNew = params.get('new');
  useEffect(() => { Promise.all([api('/admin/drivers'), api('/routes')]).then(([d, r]) => setOpts({ drivers: d, routes: r })).catch(() => {}); }, []);
  useEffect(() => { if (wantNew) setModal({}); }, [wantNew]);
  const save = async (vals) => {
    setSaving(true);
    try {
      if (modal && modal._id) { await api('/vehicles/' + modal._id, { method: 'PUT', body: vals }); toast('Vehicle updated successfully.', 'success'); }
      else { await api('/vehicles', { method: 'POST', body: vals }); toast('Vehicle added successfully.', 'success'); }
      setModal(null); load();
    } catch (e) { toast(e.message || 'Unable to save vehicle.', 'error'); } finally { setSaving(false); }
  };
  const doDelete = async () => {
    try { await api('/vehicles/' + del._id, { method: 'DELETE' }); toast('Vehicle deleted successfully.', 'success'); setDel(null); load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3"><GradIcon color="blue" name="bus" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">Vehicles</h2></div>
        <Btn onClick={() => setModal({})}><Icon name="plus" className="w-4 h-4" /> Add Vehicle</Btn>
      </div>
      <Card className="overflow-x-auto">
        {!vehicles ? <div className="p-4"><Skeleton className="h-48" /></div> : (
          <table className="w-full min-w-[760px]">
            <thead className="bg-slate-50/80"><tr className="border-b border-slate-100"><th className={TH + ' pl-4'}>Vehicle</th><th className={TH}>Plate</th><th className={TH}>Route</th><th className={TH}>Driver</th><th className={TH}>Speed</th><th className={TH}>Status</th><th className={TH}>Last update</th><th className={TH}>Actions</th></tr></thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v._id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className={TD + ' pl-4'}><button className="font-bold text-blue-600 hover:underline" onClick={() => navigate('/vehicles/' + v._id)}>{v.vehicleNumber}</button></td>
                  <td className={TD}>{v.licensePlate || '—'}</td>
                  <td className={TD}>{v.routeId ? v.routeId.name : '—'}</td>
                  <td className={TD}>{v.driverId ? v.driverId.name : 'Unassigned'}</td>
                  <td className={TD}>{Math.round(v.speed || 0)} km/h</td>
                  <td className={TD}><LiveDot status={v.status} /></td>
                  <td className={TD}>{timeAgo(v.lastUpdated)}</td>
                  <td className={TD}>
                    <div className="flex gap-1">
                      <button className="w-8 h-8 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 flex items-center justify-center" title="Edit" onClick={() => setModal(v)}><Icon name="edit" className="w-4 h-4" /></button>
                      <button className="w-8 h-8 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 flex items-center justify-center" title="Delete" onClick={() => setDel(v)}><Icon name="trash" className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <FormModal open={modal !== null} onClose={() => setModal(null)} title={(modal && modal._id ? 'Edit ' : 'Add ') + 'Vehicle'} saving={saving} onSubmit={save} initial={modal || {}}
        fields={[
          { key: 'vehicleNumber', label: 'Vehicle Number', required: true, placeholder: 'RT-100' },
          { key: 'licensePlate', label: 'License Plate', placeholder: 'RAC 100J' },
          { key: 'type', label: 'Vehicle Type', type: 'select', options: [{ value: 'BUS', label: 'Bus' }, { value: 'MINIBUS', label: 'Minibus' }, { value: 'CAR', label: 'Car' }] },
          { key: 'driverId', label: 'Driver', type: 'select', options: opts.drivers.map((d) => ({ value: d._id, label: d.name })) },
          { key: 'routeId', label: 'Route', type: 'select', options: opts.routes.map((r) => ({ value: r._id, label: r.name })) },
          { key: 'status', label: 'Status', type: 'select', options: [{ value: 'OFFLINE', label: 'Offline' }, { value: 'IN_SERVICE', label: 'In Service' }, { value: 'TRACKING_STOPPED', label: 'Tracking stopped' }] },
        ]} />
      <Confirm open={!!del} title="Delete vehicle" message={del ? `Are you sure you want to delete ${del.vehicleNumber}?` : ''} onConfirm={doDelete} onClose={() => setDel(null)} />
    </div>
  );
}

function AdminDrivers({ params }) {
  const toast = useToast();
  const [drivers, , load] = useAdminData('/admin/drivers');
  const [vehicles, setVehicles] = useState([]);
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [saving, setSaving] = useState(false);
  const wantNew = params.get('new');
  useEffect(() => { api('/vehicles').then(setVehicles).catch(() => {}); }, []);
  useEffect(() => { if (wantNew) setModal({}); }, [wantNew]);
  const save = async (vals) => {
    setSaving(true);
    try {
      if (modal && modal._id) { await api('/admin/drivers/' + modal._id, { method: 'PUT', body: vals }); toast('Driver updated successfully.', 'success'); }
      else { await api('/admin/drivers', { method: 'POST', body: vals }); toast('Driver added successfully.', 'success'); }
      setModal(null); load();
    } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  };
  const doDelete = async (force) => {
    try { await api('/admin/drivers/' + del._id, { method: 'DELETE', body: { force: !!force } }); toast('Driver deleted successfully.', 'success'); setDel(null); load(); }
    catch (e) { if (e.payload && e.payload.needConfirm) { if (window.confirm(e.error + ' Unassign and delete anyway?')) doDelete(true); } else toast(e.message, 'error'); }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3"><GradIcon color="green" name="user" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">Drivers</h2></div>
        <Btn onClick={() => setModal({})}><Icon name="plus" className="w-4 h-4" /> Add Driver</Btn>
      </div>
      <Card className="overflow-x-auto">
        {!drivers ? <div className="p-4"><Skeleton className="h-48" /></div> : (
          <table className="w-full min-w-[820px]">
            <thead className="bg-slate-50/80"><tr className="border-b border-slate-100"><th className={TH + ' pl-4'}>Name</th><th className={TH}>Email</th><th className={TH}>Phone</th><th className={TH}>Assigned Vehicle</th><th className={TH}>Route</th><th className={TH}>Last Location</th><th className={TH}>Status</th><th className={TH}>Last GPS</th><th className={TH}>Actions</th></tr></thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d._id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className={TD + ' font-bold pl-4'}>{d.name}</td>
                  <td className={TD}>{d.email}</td>
                  <td className={TD}>{d.phone || '—'}</td>
                  <td className={TD}>{d.vehicle ? d.vehicle.vehicleNumber : '—'}</td>
                  <td className={TD}>{d.vehicle && d.vehicle.route ? d.vehicle.route.name : '—'}</td>
                  <td className={TD}>
                    {d.vehicle && d.vehicle.currentLocation && d.vehicle.currentLocation.coordinates ? (
                      <div className="text-[10px]"><div>{d.vehicle.currentLocation.coordinates[1].toFixed(4)}, {d.vehicle.currentLocation.coordinates[0].toFixed(4)}</div><div className="text-slate-400">{timeAgo(d.vehicle.lastUpdated)}</div></div>
                    ) : '—'}
                  </td>
                  <td className={TD}>{d.active ? <Badge color="green">Active</Badge> : <Badge color="red">Deactivated</Badge>}{d.vehicle ? <span className="ml-2"><LiveDot status={d.vehicle.status} /></span> : null}</td>
                  <td className={TD}>{d.vehicle && d.vehicle.lastUpdated ? timeAgo(d.vehicle.lastUpdated) : '—'}</td>
                  <td className={TD}>
                    <div className="flex gap-1">
                      <button className="w-8 h-8 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 flex items-center justify-center" title="Edit / assign" onClick={() => setModal(d)}><Icon name="edit" className="w-4 h-4" /></button>
                      <button className="w-8 h-8 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 flex items-center justify-center" title="Delete" onClick={() => setDel(d)}><Icon name="trash" className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <FormModal open={modal !== null} onClose={() => setModal(null)} title={(modal && modal._id ? 'Edit ' : 'Add ') + 'Driver'} saving={saving} onSubmit={save} initial={modal || {}}
        fields={(modal && modal._id) ? [
          { key: 'name', label: 'Full name', required: true },
          { key: 'phone', label: 'Phone' },
          { key: 'licenseNumber', label: 'License number' },
          { key: 'assignedVehicleId', label: 'Assigned vehicle', type: 'select', options: vehicles.map((v) => ({ value: v._id, label: v.vehicleNumber })) },
          { key: 'active', label: 'Active (1 = active)', type: 'number' },
        ] : [
          { key: 'name', label: 'Full name', required: true },
          { key: 'email', label: 'Email', required: true, type: 'email' },
          { key: 'password', label: 'Password', required: true, type: 'password' },
          { key: 'phone', label: 'Phone' },
          { key: 'licenseNumber', label: 'License number' },
        ]} />
      <Confirm open={!!del} title="Delete driver" message={del ? `Are you sure you want to delete ${del.name}?` : ''} onConfirm={() => doDelete(false)} onClose={() => setDel(null)} />
    </div>
  );
}

function AdminRoutes({ params }) {
  const toast = useToast();
  const [routes, , load] = useAdminData('/routes');
  const [stops, setStops] = useState([]);
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [saving, setSaving] = useState(false);
  const wantNew = params.get('new');
  useEffect(() => { api('/stops').then(setStops).catch(() => {}); }, []);
  useEffect(() => { if (wantNew) setModal({ item: {}, stops: [] }); }, [wantNew]);
  const openEdit = async (r) => { const d = await api('/routes/' + r._id); setModal({ item: d.route, stops: d.route.stops.map((s) => s._id) }); };
  const toggle = (id) => setModal((m) => ({ ...m, stops: m.stops.includes(id) ? m.stops.filter((x) => x !== id) : [...m.stops, id] }));
  const move = (i, dir) => setModal((m) => { const arr = [...m.stops]; const j = i + dir; if (j < 0 || j >= arr.length) return m; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; return { ...m, stops: arr }; });
  const save = async (e) => {
    e.preventDefault(); setSaving(true);
    const body = { name: modal.item.name, routeNumber: modal.item.routeNumber, startPoint: modal.item.startPoint, destination: modal.item.destination, stops: modal.stops };
    try {
      if (modal.item._id) { await api('/routes/' + modal.item._id, { method: 'PUT', body }); toast('Route updated successfully.', 'success'); }
      else { await api('/routes', { method: 'POST', body }); toast('Route created successfully.', 'success'); }
      setModal(null); load();
    } catch (err) { toast(err.message, 'error'); } finally { setSaving(false); }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3"><GradIcon color="purple" name="route" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">Routes</h2></div>
        <Btn onClick={() => setModal({ item: {}, stops: [] })}><Icon name="plus" className="w-4 h-4" /> Create Route</Btn>
      </div>
      <Card className="overflow-x-auto">
        {!routes ? <div className="p-4"><Skeleton className="h-48" /></div> : (
          <table className="w-full min-w-[720px]">
            <thead className="bg-slate-50/80"><tr className="border-b border-slate-100"><th className={TH + ' pl-4'}>Route</th><th className={TH}>Start → Destination</th><th className={TH}>Stops</th><th className={TH}>Active vehicles</th><th className={TH}>Status</th><th className={TH}>Actions</th></tr></thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r._id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className={TD + ' pl-4'}><button className="font-bold text-blue-600 hover:underline" onClick={() => navigate('/routes/' + r._id)}>{r.name}</button></td>
                  <td className={TD}>{r.startPoint} → {r.destination}</td>
                  <td className={TD}>{r.stopCount}</td>
                  <td className={TD}>{r.activeVehicles}</td>
                  <td className={TD}><Badge color={r.status === 'ACTIVE' ? 'green' : 'gray'}>{r.status}</Badge></td>
                  <td className={TD}>
                    <div className="flex gap-1">
                      <button className="w-8 h-8 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 flex items-center justify-center" onClick={() => openEdit(r)}><Icon name="edit" className="w-4 h-4" /></button>
                      <button className="w-8 h-8 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 flex items-center justify-center" onClick={() => setDel(r)}><Icon name="trash" className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Modal open={!!modal} onClose={() => setModal(null)} title={(modal && modal.item._id ? 'Edit ' : 'Create ') + 'Route'} wide>
        {modal && (
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Route number *</Label><Input required value={modal.item.routeNumber || ''} onChange={(e) => setModal({ ...modal, item: { ...modal.item, routeNumber: e.target.value } })} placeholder="Route 7" /></div>
              <div><Label>Name *</Label><Input required value={modal.item.name || ''} onChange={(e) => setModal({ ...modal, item: { ...modal.item, name: e.target.value } })} /></div>
              <div><Label>Start point</Label><Input value={modal.item.startPoint || ''} onChange={(e) => setModal({ ...modal, item: { ...modal.item, startPoint: e.target.value } })} /></div>
              <div><Label>Destination</Label><Input value={modal.item.destination || ''} onChange={(e) => setModal({ ...modal, item: { ...modal.item, destination: e.target.value } })} /></div>
            </div>
            <div>
              <Label>Bus stops (check to include, reorder with arrows)</Label>
              <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-xl p-2 space-y-1">
                {stops.map((s) => <label key={s._id} className="flex items-center gap-2 text-xs text-slate-700 font-medium"><input type="checkbox" checked={modal.stops.includes(s._id)} onChange={() => toggle(s._id)} /> {s.name}</label>)}
              </div>
              <div className="mt-2 space-y-1">
                {modal.stops.map((id, i) => {
                  const s = stops.find((x) => x._id === id);
                  return (
                    <div key={id} className="flex items-center gap-2 text-xs bg-slate-50 rounded-lg px-2 py-1.5">
                      <span className="w-5 h-5 rounded bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                      <span className="flex-1 font-semibold">{s ? s.name : id}</span>
                      <button type="button" className="text-slate-400 hover:text-blue-600" onClick={() => move(i, -1)}><Icon name="up" className="w-3.5 h-3.5" /></button>
                      <button type="button" className="text-slate-400 hover:text-blue-600" onClick={() => move(i, 1)}><Icon name="down" className="w-3.5 h-3.5" /></button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Btn type="button" variant="outline" onClick={() => setModal(null)}>Cancel</Btn>
              <Btn type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Btn>
            </div>
          </form>
        )}
      </Modal>
      <Confirm open={!!del} title="Delete route" message={del ? `Are you sure you want to delete ${del.name}?` : ''} onConfirm={async () => { try { await api('/routes/' + del._id, { method: 'DELETE' }); toast('Route deleted successfully.', 'success'); setDel(null); load(); } catch (e) { toast(e.message, 'error'); } }} onClose={() => setDel(null)} />
    </div>
  );
}

function AdminStops({ params }) {
  const toast = useToast();
  const [stops, , load] = useAdminData('/stops');
  const [routes, setRoutes] = useState([]);
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [saving, setSaving] = useState(false);
  const wantNew = params.get('new');
  useEffect(() => { api('/routes').then(setRoutes).catch(() => {}); }, []);
  useEffect(() => { if (wantNew) setModal({}); }, [wantNew]);
  const save = async (vals) => {
    setSaving(true);
    const body = { ...vals, latitude: +vals.latitude, longitude: +vals.longitude, routes: vals.routes || [] };
    try {
      if (modal && modal._id) { await api('/stops/' + modal._id, { method: 'PUT', body }); toast('Bus stop updated successfully.', 'success'); }
      else { await api('/stops', { method: 'POST', body }); toast('Bus stop added successfully.', 'success'); }
      setModal(null); load();
    } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3"><GradIcon color="orange" name="pin" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">Bus Stops</h2></div>
        <Btn onClick={() => setModal({})}><Icon name="plus" className="w-4 h-4" /> Add Bus Stop</Btn>
      </div>
      <Card className="overflow-x-auto">
        {!stops ? <div className="p-4"><Skeleton className="h-48" /></div> : (
          <table className="w-full min-w-[640px]">
            <thead className="bg-slate-50/80"><tr className="border-b border-slate-100"><th className={TH + ' pl-4'}>Stop</th><th className={TH}>Address</th><th className={TH}>Coordinates</th><th className={TH}>Routes</th><th className={TH}>Geofence</th><th className={TH}>Actions</th></tr></thead>
            <tbody>
              {stops.map((s) => (
                <tr key={s._id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className={TD + ' font-bold pl-4'}>{s.name}</td>
                  <td className={TD}>{s.address || '—'}</td>
                  <td className={TD}>{s.location.coordinates[1].toFixed(4)}, {s.location.coordinates[0].toFixed(4)}</td>
                  <td className={TD}>{(s.routes || []).map((r) => r.name || r.routeNumber).join(', ') || '—'}</td>
                  <td className={TD}>{s.geofenceRadius || 100} m</td>
                  <td className={TD}>
                    <div className="flex gap-1">
                      <button className="w-8 h-8 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 flex items-center justify-center" onClick={() => setModal(s)}><Icon name="edit" className="w-4 h-4" /></button>
                      <button className="w-8 h-8 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 flex items-center justify-center" onClick={() => setDel(s)}><Icon name="trash" className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <StopModal open={modal !== null} onClose={() => setModal(null)} initial={modal || {}} routes={routes} saving={saving} onSubmit={save} />
      <Confirm open={!!del} title="Delete bus stop" message={del ? `Are you sure you want to delete ${del.name}?` : ''} onConfirm={async () => { try { await api('/stops/' + del._id, { method: 'DELETE' }); toast('Bus stop deleted successfully.', 'success'); setDel(null); load(); } catch (e) { toast(e.message, 'error'); } }} onClose={() => setDel(null)} />
    </div>
  );
}

function StopModal({ open, onClose, initial, routes, saving, onSubmit }) {
  const [vals, setVals] = useState({});
  useEffect(() => {
    if (!open) return;
    setVals({ name: initial.name || '', address: initial.address || '', geofenceRadius: initial.geofenceRadius || 100, routes: (initial.routes || []).map((r) => r._id || r), latitude: initial.location ? initial.location.coordinates[1] : '', longitude: initial.location ? initial.location.coordinates[0] : '' });
  }, [open, initial]);
  if (!open) return null;
  const toggleRoute = (id) => setVals((v) => ({ ...v, routes: v.routes.includes(id) ? v.routes.filter((x) => x !== id) : [...v.routes, id] }));
  return (
    <Modal open onClose={onClose} title={(initial._id ? 'Edit ' : 'Add ') + 'Bus Stop'} wide>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(vals); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Name *</Label><Input required value={vals.name} onChange={(e) => setVals({ ...vals, name: e.target.value })} /></div>
          <div><Label>Address / area</Label><Input value={vals.address} onChange={(e) => setVals({ ...vals, address: e.target.value })} /></div>
          <div><Label>Geofence radius (m)</Label><Input type="number" value={vals.geofenceRadius} onChange={(e) => setVals({ ...vals, geofenceRadius: e.target.value })} /></div>
        </div>
        <div><Label>Location (click map) *</Label><MapPick lat={vals.latitude === '' ? null : +vals.latitude} lng={vals.longitude === '' ? null : +vals.longitude} onChange={(la, ln) => setVals({ ...vals, latitude: la, longitude: ln })} /></div>
        <div><Label>Served by routes</Label>
          <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-xl p-2 space-y-1">
            {routes.map((r) => <label key={r._id} className="flex items-center gap-2 text-xs text-slate-700 font-medium"><input type="checkbox" checked={vals.routes.includes(r._id)} onChange={() => toggleRoute(r._id)} /> {r.name}</label>)}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Btn type="button" variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function AdminUsers() {
  const toast = useToast();
  const [users, , load] = useAdminData('/admin/users');
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [saving, setSaving] = useState(false);
  const save = async (vals) => {
    setSaving(true);
    try {
      if (modal && modal._id) { await api('/admin/users/' + modal._id, { method: 'PUT', body: vals }); toast('User updated successfully.', 'success'); }
      else { await api('/users', { method: 'POST', body: vals }); toast('User created successfully.', 'success'); }
      setModal(null); load();
    } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3"><GradIcon color="red" name="users" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">Users</h2></div>
        <Btn onClick={() => setModal({})}><Icon name="plus" className="w-4 h-4" /> Add User</Btn>
      </div>
      <Card className="overflow-x-auto">
        {!users ? <div className="p-4"><Skeleton className="h-48" /></div> : (
          <table className="w-full min-w-[720px]">
            <thead className="bg-slate-50/80"><tr className="border-b border-slate-100"><th className={TH + ' pl-4'}>Name</th><th className={TH}>Email</th><th className={TH}>Role</th><th className={TH}>Status</th><th className={TH}>Registered</th><th className={TH}>Last login</th><th className={TH}>Actions</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className={TD + ' font-bold pl-4'}>{u.name}</td>
                  <td className={TD}>{u.email}</td>
                  <td className={TD}><Badge color={u.role === 'ADMIN' ? 'amber' : u.role === 'DRIVER' ? 'blue' : 'gray'}>{u.role}</Badge></td>
                  <td className={TD}>{u.active ? <Badge color="green">Active</Badge> : <Badge color="red">Disabled</Badge>}</td>
                  <td className={TD}>{fmtDate(u.createdAt)}</td>
                  <td className={TD}>{u.lastLogin ? timeAgo(u.lastLogin) : 'Never'}</td>
                  <td className={TD}>
                    <div className="flex gap-1">
                      <button className="w-8 h-8 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 flex items-center justify-center" onClick={() => setModal(u)}><Icon name="edit" className="w-4 h-4" /></button>
                      <button className="w-8 h-8 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 flex items-center justify-center" onClick={() => setDel(u)}><Icon name="trash" className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <FormModal open={modal !== null} onClose={() => setModal(null)} title={(modal && modal._id ? 'Edit ' : 'Add ') + 'User'} saving={saving} onSubmit={save} initial={modal || {}}
        fields={(modal && modal._id) ? [
          { key: 'role', label: 'Role', type: 'select', options: [{ value: 'PASSENGER', label: 'Passenger' }, { value: 'DRIVER', label: 'Driver' }, { value: 'ADMIN', label: 'Admin' }] },
          { key: 'active', label: 'Active (1 = active, 0 = disabled)', type: 'number' },
        ] : [
          { key: 'name', label: 'Full name', required: true },
          { key: 'email', label: 'Email', required: true, type: 'email' },
          { key: 'password', label: 'Password', required: true, type: 'password' },
          { key: 'role', label: 'Role', type: 'select', options: [{ value: 'PASSENGER', label: 'Passenger' }, { value: 'DRIVER', label: 'Driver' }, { value: 'ADMIN', label: 'Admin' }] },
        ]} />
      <Confirm open={!!del} title="Delete account" message={del ? `Are you sure you want to delete ${del.email}?` : ''} onConfirm={async () => { try { await api('/admin/users/' + del._id, { method: 'DELETE' }); toast('User deleted.', 'success'); setDel(null); load(); } catch (e) { toast(e.message, 'error'); } }} onClose={() => setDel(null)} />
    </div>
  );
}

function AdminNotifications() {
  const toast = useToast();
  const [items, , load] = useAdminData('/admin/notifications');
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ title: '', message: '', type: 'INFO', target: 'ALL' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/admin/users').then(setUsers).catch(() => {}); }, []);
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api('/admin/notifications', { method: 'POST', body: form }); toast('Notification sent.', 'success'); setForm({ title: '', message: '', type: 'INFO', target: 'ALL' }); load(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="p-5">
        <div className="flex items-center gap-3 mb-4"><GradIcon color="orange" name="bell" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-sm font-bold text-slate-800">Create notification</h2></div>
        <form onSubmit={send} className="space-y-3">
          <div><Label>Title *</Label><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div><Label>Message *</Label><Input required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></div>
          <div><Label>Type</Label><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="INFO">Information</option><option value="WARNING">Warning</option><option value="SUCCESS">Route update</option><option value="DANGER">Service interruption</option></Select></div>
          <div><Label>Target audience</Label><Select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}><option value="ALL">All users</option><option value="DRIVERS">Drivers</option><option value="PASSENGERS">Passengers</option>{users.map((u) => <option key={u._id} value={u._id}>{u.name} (specific user)</option>)}</Select></div>
          <Btn type="submit" className="w-full" disabled={busy}>{busy ? 'Sending...' : 'Send notification'}</Btn>
        </form>
      </Card>
      <Card className="lg:col-span-2 p-5">
        <h2 className="text-sm font-bold text-slate-800 mb-4">Sent notifications</h2>
        {!items ? <Skeleton className="h-40" /> : items.length === 0 ? <EmptyState icon="bell" title="No notifications sent yet." /> : (
          <div className="space-y-2 max-h-[520px] overflow-y-auto">
            {items.map((n) => (
              <div key={n._id} className="flex items-start gap-3 p-3 border border-slate-100 rounded-xl">
                <GradIcon color="blue" name="bell" size="w-8 h-8 rounded-lg" className="w-4 h-4" />
                <div className="flex-1 min-w-0"><p className="text-xs font-bold text-slate-800">{n.title}</p><p className="text-[11px] text-slate-500">{n.message}</p><p className="text-[10px] text-slate-400 mt-0.5">{n.audience} · {timeAgo(n.createdAt)}</p></div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function AdminReports() {
  const [rep, setRep] = useState(null);
  const [filters, setFilters] = useState({ from: '', to: '', vehicleId: '', routeId: '' });
  const [vehicles, setVehicles] = useState([]); const [routes, setRoutes] = useState([]);
  useEffect(() => { api('/vehicles').then(setVehicles).catch(() => {}); api('/routes').then(setRoutes).catch(() => {}); }, []);
  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (filters.from) q.set('from', filters.from); if (filters.to) q.set('to', filters.to);
    if (filters.vehicleId) q.set('vehicleId', filters.vehicleId); if (filters.routeId) q.set('routeId', filters.routeId);
    api('/admin/reports?' + q.toString()).then(setRep).catch(() => {});
  }, [filters]);
  useEffect(load, [load]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><GradIcon color="cyan" name="chart" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">Reports</h2></div>
        <Btn variant="outline" onClick={() => exportCsv('cartracker-report.csv', rep ? rep.routes.map((r) => ({ route: r.name, stops: r.stops, vehicles: r.vehicles })) : [])}><Icon name="down" className="w-4 h-4" /> Export CSV</Btn>
      </div>
      <Card className="p-4 flex flex-wrap gap-3 items-end">
        <div><Label>From</Label><Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
        <div><Label>To</Label><Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
        <div><Label>Vehicle</Label><Select className="w-40" value={filters.vehicleId} onChange={(e) => setFilters({ ...filters, vehicleId: e.target.value })}><option value="">All</option>{vehicles.map((v) => <option key={v._id} value={v._id}>{v.vehicleNumber}</option>)}</Select></div>
        <div><Label>Route</Label><Select className="w-40" value={filters.routeId} onChange={(e) => setFilters({ ...filters, routeId: e.target.value })}><option value="">All</option>{routes.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}</Select></div>
      </Card>
      {!rep ? <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}</div> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard color="blue" icon="bus" label="Fleet total / active" value={rep.fleet.total + ' / ' + rep.fleet.active} sub={rep.fleet.offline + ' offline'} subColor="text-red-500" />
            <StatCard color="green" icon="user" label="Drivers active" value={rep.drivers.active + ' / ' + rep.drivers.total} sub={rep.drivers.inactive + ' inactive'} subColor="text-slate-500" />
            <StatCard color="purple" icon="route" label="Routes" value={rep.routes.length} sub="see table below" subColor="text-slate-500" />
            <StatCard color="cyan" icon="clock" label="Trips completed" value={rep.trips.completed + ' / ' + rep.trips.total} sub={'avg ' + rep.trips.avgDurationMin + ' min'} subColor="text-slate-500" />
            <StatCard color="orange" icon="nav" label="GPS updates" value={rep.gps.updates.toLocaleString()} sub={rep.gps.offlineVehicles + ' offline vehicles'} subColor="text-red-500" />
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead className="bg-slate-50/80"><tr className="border-b border-slate-100"><th className={TH + ' pl-4'}>Route</th><th className={TH}>Stops</th><th className={TH}>Vehicles</th></tr></thead>
              <tbody>{rep.routes.map((r) => <tr key={r._id} className="border-b border-slate-50"><td className={TD + ' font-bold pl-4'}>{r.name}</td><td className={TD}>{r.stops}</td><td className={TD}>{r.vehicles}</td></tr>)}</tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

function AdminGpsHistory() {
  const [rows, setRows] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [filters, setFilters] = useState({ vehicleId: '', from: '', to: '' });
  useEffect(() => { api('/vehicles').then(setVehicles).catch(() => {}); }, []);
  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (filters.vehicleId) q.set('vehicleId', filters.vehicleId);
    if (filters.from) q.set('from', new Date(filters.from).toISOString());
    if (filters.to) q.set('to', new Date(filters.to + 'T23:59:59').toISOString());
    api('/admin/gps-history?' + q.toString()).then(setRows).catch(() => {});
  }, [filters]);
  useEffect(load, [load]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3"><GradIcon color="green" name="clock" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">GPS History</h2></div>
      <Card className="p-4 flex flex-wrap gap-3 items-end">
        <div><Label>Vehicle</Label><Select className="w-40" value={filters.vehicleId} onChange={(e) => setFilters({ ...filters, vehicleId: e.target.value })}><option value="">All vehicles</option>{vehicles.map((v) => <option key={v._id} value={v._id}>{v.vehicleNumber}</option>)}</Select></div>
        <div><Label>From</Label><Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
        <div><Label>To</Label><Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
        <Btn variant="outline" onClick={() => exportCsv('gps-history.csv', (rows || []).map((r) => ({ time: r.timestamp, vehicle: r.vehicleId ? r.vehicleId.vehicleNumber : '', lat: r.latitude, lng: r.longitude, speed: r.speed, heading: r.heading })))}>Export CSV</Btn>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5 min-w-0">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Historical movement</h3>
          {rows && rows.length > 1 ? <MapView historyPoints={[...rows].reverse()} heightClass="h-[360px]" showLegend={false} fitOnRoute={false} /> : <div className="h-[360px] flex items-center justify-center text-xs text-slate-400">Select a vehicle with GPS data to see its path.</div>}
        </Card>
        <Card className="overflow-auto max-h-[400px]">
          {!rows ? <div className="p-4"><Skeleton className="h-40" /></div> : rows.length === 0 ? <EmptyState icon="clock" title="No GPS records for this filter." /> : (
            <table className="w-full min-w-[420px]">
              <thead className="sticky top-0 bg-white"><tr className="border-b border-slate-100"><th className={TH + ' pl-4'}>Time</th><th className={TH}>Vehicle</th><th className={TH}>Lat</th><th className={TH}>Lng</th><th className={TH}>Speed</th><th className={TH}>Heading</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r._id} className="border-b border-slate-50"><td className={TD + ' pl-4'}>{fmtTime(r.timestamp)}</td><td className={TD}>{r.vehicleId ? r.vehicleId.vehicleNumber : '—'}</td><td className={TD}>{r.latitude.toFixed(4)}</td><td className={TD}>{r.longitude.toFixed(4)}</td><td className={TD}>{Math.round(r.speed || 0)} km/h</td><td className={TD}>{Math.round(r.heading || 0)}°</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

function AdminAuditLogs() {
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ q: '', category: '', from: '', to: '', page: 1 });
  const load = useCallback(() => {
    setError(null);
    const q = new URLSearchParams();
    if (filters.q) q.set('q', filters.q);
    if (filters.category) q.set('category', filters.category);
    if (filters.from) q.set('from', new Date(filters.from).toISOString());
    if (filters.to) q.set('to', new Date(filters.to + 'T23:59:59').toISOString());
    q.set('page', String(filters.page)); q.set('limit', '50');
    api('/admin/audit-logs?' + q.toString()).then(setData).catch((e) => setError(e.message));
  }, [filters]);
  useEffect(load, [load]);
  useEffect(() => { api('/admin/audit-logs/stats').then(setStats).catch(() => {}); }, []);
  const catColor = { AUTH: 'blue', ADMIN: 'amber', SYSTEM: 'gray', SECURITY: 'red' };
  const rows = data ? data.rows : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3"><GradIcon color="slate" name="file" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><div><h2 className="text-lg font-extrabold text-slate-800">Admin Logs</h2><p className="text-xs text-slate-500 mt-0.5">Record of sign-ins, admin actions, security and system events.</p></div></div>
        <Btn variant="outline" onClick={() => exportCsv('admin-logs.csv', (rows || []).map((l) => ({ time: l.timestamp, category: l.category, action: l.action, user: l.userName || '', resource: l.resource, resource_id: l.resourceId || '', details: l.details, ip: l.ip || '' })))}><Icon name="down" className="w-4 h-4" /> Export CSV</Btn>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard loading={!stats} color="blue" icon="file" label="Total log entries" value={stats ? stats.total.toLocaleString() : 0} />
        <StatCard loading={!stats} color="cyan" icon="clock" label="Last 24 hours" value={stats ? stats.today : 0} subColor="text-slate-500" />
        <StatCard loading={!stats} color="green" icon="login" label="Auth events" value={stats ? stats.auth : 0} subColor="text-blue-600" />
        <StatCard loading={!stats} color="orange" icon="edit" label="Admin actions" value={stats ? stats.admin : 0} subColor="text-amber-600" />
        <StatCard loading={!stats} color="purple" icon="nav" label="System events" value={stats ? stats.system : 0} subColor="text-slate-500" />
        <StatCard loading={!stats} color="red" icon="shield" label="Security events" value={stats ? stats.security : 0} subColor="text-red-500" />
      </div>
      <Card className="p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]"><Label>Search</Label><Input placeholder="Search user, action, details..." value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value, page: 1 })} /></div>
        <div><Label>Category</Label><Select className="w-36" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value, page: 1 })}><option value="">All</option><option value="AUTH">Auth</option><option value="ADMIN">Admin</option><option value="SYSTEM">System</option><option value="SECURITY">Security</option></Select></div>
        <div><Label>From</Label><Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value, page: 1 })} /></div>
        <div><Label>To</Label><Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value, page: 1 })} /></div>
        <Btn variant="outline" onClick={() => setFilters({ q: '', category: '', from: '', to: '', page: 1 })}>Reset</Btn>
      </Card>
      {error ? <Card><ErrorState message={error} retry={load} /></Card> : !rows ? <Card className="p-4"><Skeleton className="h-64" /></Card> : rows.length === 0 ? <Card><EmptyState icon="file" title="No log entries match your filters." /></Card> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="bg-slate-50/80"><tr className="border-b border-slate-100"><th className={TH + ' pl-4'}>Time</th><th className={TH}>Category</th><th className={TH}>Action</th><th className={TH}>User</th><th className={TH}>Resource</th><th className={TH}>Details</th><th className={TH}>IP</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l._id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className={TD + ' whitespace-nowrap pl-4'}>{fmtDate(l.timestamp)}<span className="block text-slate-400">{fmtTime(l.timestamp)}</span></td>
                  <td className={TD}><Badge color={catColor[l.category] || 'gray'}>{l.category}</Badge></td>
                  <td className={TD}><span className="font-bold text-slate-800">{l.action}</span></td>
                  <td className={TD}>{l.userName || 'system'}</td>
                  <td className={TD}>{l.resource}{l.resourceId ? <span className="block text-slate-400">#{String(l.resourceId).slice(-6)}</span> : null}</td>
                  <td className={TD + ' max-w-[320px]'}><span className="block truncate" title={l.details}>{l.details}</span></td>
                  <td className={TD}>{l.ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <p className="text-xs text-slate-500 font-semibold">{data.total} entries · page {data.page} of {data.pages}</p>
            <div className="flex gap-2">
              <Btn variant="outline" disabled={data.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>Previous</Btn>
              <Btn variant="outline" disabled={data.page >= data.pages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Next</Btn>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function AdminSettings() {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api('/admin/settings').then(setS).catch(() => {}); }, []);
  const save = async (e) => {
    e.preventDefault(); setSaving(true);
    try { await api('/admin/settings', { method: 'PUT', body: s }); toast('Settings saved.', 'success'); }
    catch (err) { toast(err.message, 'error'); } finally { setSaving(false); }
  };
  if (!s) return <Skeleton className="h-64" />;
  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-5"><GradIcon color="slate" name="settings" size="w-10 h-10 rounded-xl" className="w-5 h-5" /><h2 className="text-lg font-extrabold text-slate-800">System Settings</h2></div>
      <Card className="p-6">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>System name</Label><Input value={s.systemName} onChange={(e) => setS({ ...s, systemName: e.target.value })} /></div>
            <div><Label>Timezone</Label><Input value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} /></div>
            <div><Label>GPS update interval (sec)</Label><Input type="number" value={s.gpsUpdateIntervalSec} onChange={(e) => setS({ ...s, gpsUpdateIntervalSec: +e.target.value })} /></div>
            <div><Label>GPS delayed after (sec)</Label><Input type="number" value={s.delayedAfterSec} onChange={(e) => setS({ ...s, delayedAfterSec: +e.target.value })} /></div>
            <div><Label>Offline after (sec)</Label><Input type="number" value={s.offlineAfterSec} onChange={(e) => setS({ ...s, offlineAfterSec: +e.target.value })} /></div>
            <div><Label>Arrival geofence radius (m)</Label><Input type="number" value={s.arrivalRadiusM} onChange={(e) => setS({ ...s, arrivalRadiusM: +e.target.value })} /></div>
            <div><Label>Notify at minutes (comma separated)</Label><Input value={(s.notifyMinutes || []).join(',')} onChange={(e) => setS({ ...s, notifyMinutes: e.target.value.split(',').map((x) => +x.trim()).filter((x) => x > 0) })} /></div>
            <div><Label>Notify at distances (m, comma separated)</Label><Input value={(s.notifyDistanceM || []).join(',')} onChange={(e) => setS({ ...s, notifyDistanceM: e.target.value.split(',').map((x) => +x.trim()).filter((x) => x > 0) })} /></div>
            <div><Label>Session length (hours)</Label><Input type="number" value={s.sessionHours} onChange={(e) => setS({ ...s, sessionHours: +e.target.value })} /></div>
            <div><Label>Minimum password length</Label><Input type="number" value={s.passwordMinLength} onChange={(e) => setS({ ...s, passwordMinLength: +e.target.value })} /></div>
          </div>
          <Btn type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save settings'}</Btn>
        </form>
        {process.env.NODE_ENV !== 'production' && <DevSimulatorPanel />}
      </Card>
    </div>
  );
}

function DevSimulatorPanel() {
  const toast = useToast();
  const [vehicles, setVehicles] = useState([]);
  const [vid, setVid] = useState('');
  const [lat, setLat] = useState('-1.9441');
  const [lng, setLng] = useState('30.0619');
  const speed = '30';
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/vehicles').then(setVehicles).catch(() => {}); }, []);
  const send = async (e) => {
    e.preventDefault(); if (!vid) return;
    setBusy(true);
    try {
      await api('/admin/simulate/' + vid, { method: 'POST', body: { latitude: +lat, longitude: +lng, speed: +speed, heading: 0 } });
      toast('Simulated GPS point sent to ' + (vehicles.find((v) => v._id === vid) || {}).vehicleNumber, 'success');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="mt-6 pt-5 border-t border-amber-200">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wider">Dev Only</span>
        <h3 className="text-sm font-bold text-slate-800">GPS Simulator</h3>
      </div>
      <p className="text-[11px] text-slate-500 mb-3">Development mode only. Push fake GPS points to a vehicle to test the real-time pipeline. In production this endpoint returns 403.</p>
      <form onSubmit={send} className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Select value={vid} onChange={(e) => setVid(e.target.value)}><option value="">Pick vehicle…</option>{vehicles.map((v) => <option key={v._id} value={v._id}>{v.vehicleNumber}</option>)}</Select>
        <Input type="number" step="0.00001" placeholder="lat" value={lat} onChange={(e) => setLat(e.target.value)} />
        <Input type="number" step="0.00001" placeholder="lng" value={lng} onChange={(e) => setLng(e.target.value)} />
        <Btn type="submit" disabled={busy || !vid}>{busy ? 'Sending…' : 'Send fake point'}</Btn>
      </form>
    </div>
  );
}

/* ================================ SHELL ================================ */
function SidebarInner({ nav, path, onClose }) {
  const { logout } = useAuth();
  return (
    <div className={`flex flex-col h-full w-64 text-slate-300 ${NAVY}`}>
      {/* Logo */}
      <div className="h-16 flex items-center gap-2.5 px-5 shrink-0">
        <LogoMark className="w-9 h-9" />
        <div>
          <span className="text-lg font-extrabold text-white leading-none">Car<span className="text-blue-400">Tracker</span></span>
          <p className="text-[10px] text-slate-400 tracking-wide mt-0.5">Track • Ride • Arrive</p>
        </div>
        <button className="ml-auto lg:hidden text-slate-400 hover:text-white" onClick={onClose}><Icon name="x" className="w-5 h-5" /></button>
      </div>

      {/* Navigation — scrollable but scrollbar hidden */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto no-scrollbar">
        {nav.map(([to, ic, label]) => {
          const active = to === '/' ? path === '/' : path.startsWith(to);
          return (
            <button key={to} onClick={() => { navigate(to); onClose(); }}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all ${active ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-950/50' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
              <Icon name={ic} className="w-5 h-5" /> {label}
            </button>
          );
        })}
      </nav>

      {/* Logout pinned as the very last item */}
      <div className="px-3 pb-4 shrink-0">
        <div className="border-t border-white/10 pt-3">
          <button onClick={() => { onClose(); logout(); }}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-all">
            <Icon name="logout" className="w-5 h-5" /> Logout
          </button>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const hash = useRoute();
  const { path, params } = parseHash(hash);
  const { user, loading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    const home = user.role === 'ADMIN' ? '/admin' : user.role === 'DRIVER' ? '/driver/dashboard' : '/';
    const isAdminArea = path.startsWith('/admin');
    const isDriverArea = path.startsWith('/driver');
    if (isAdminArea && user.role !== 'ADMIN') navigate(home);
    else if (isDriverArea && user.role === 'PASSENGER') navigate(home);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, user]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500 font-semibold">Loading CarTracker...</p>
      </div>
    </div>
  );

  if (!user) {
    if (path === '/register') return <RegisterPage />;
    if (path === '/forgot-password') return <ForgotPasswordPage />;
    if (path === '/reset-password') return <ResetPasswordPage params={params} />;
    if (path === '/google-callback') return <GoogleCallbackPage params={params} />;
    return <LoginPage />;
  }
  if (path === '/google-callback') return <GoogleCallbackPage params={params} />;

  const isAdmin = user.role === 'ADMIN';
  const isDriver = user.role === 'DRIVER';
    let nav;

  if (isAdmin) {
    nav = [
      ['/admin', 'home', 'Dashboard'], ['/admin/live-map', 'map', 'Live Map'],
      ['/admin/vehicles', 'bus', 'Vehicles'], ['/admin/drivers', 'user', 'Drivers'],
      ['/admin/routes', 'route', 'Routes'], ['/admin/bus-stops', 'pin', 'Bus Stops'],
      ['/admin/users', 'users', 'Users'], ['/admin/notifications', 'bell', 'Notifications'],
      ['/admin/reports', 'chart', 'Reports'], ['/admin/gps-history', 'clock', 'GPS History'],
      ['/admin/audit-logs', 'file', 'Audit Logs'], ['/admin/settings', 'settings', 'Settings'],
    ];
    
  } else if (isDriver) {
    nav = [
      ['/driver/dashboard', 'home', 'Dashboard'],
      ['/driver/live-map', 'map', 'Live Location'],
      ['/driver/trips', 'clock', 'Trip History'],
      ['/driver/notifications', 'bell', 'Notifications'],
      ['/driver/profile', 'user', 'Profile'],
      ['/driver/settings', 'settings', 'Settings'],
    ];
    
  } else {
    nav = [
      ['/', 'home', 'Home'], ['/live-map', 'map', 'Live Map'],
      ['/track', 'nav', 'Track Vehicle'], ['/routes', 'route', 'Routes'],
      ['/bus-stops', 'pin', 'Bus Stops'], ['/my-trips', 'clock', 'My Trips'],
      ['/notifications', 'bell', 'Notifications'], ['/settings', 'settings', 'Settings'],
    ];
    
  }

  let page;
  const rp = matchPath('/routes/:id', path);
  const vp = matchPath('/vehicles/:id', path);

  if (isAdmin) {
    if (path === '/admin') page = <AdminDashboard />;
    else if (path === '/admin/live-map') page = <LiveMapPage />;
    else if (path === '/admin/vehicles') page = <AdminVehicles params={params} />;
    else if (path === '/admin/drivers') page = <AdminDrivers params={params} />;
    else if (path === '/admin/routes') page = <AdminRoutes params={params} />;
    else if (path === '/admin/bus-stops') page = <AdminStops params={params} />;
    else if (path === '/admin/users') page = <AdminUsers />;
    else if (path === '/admin/notifications') page = <AdminNotifications />;
    else if (path === '/admin/reports') page = <AdminReports />;
    else if (path === '/admin/gps-history') page = <AdminGpsHistory />;
    else if (path === '/admin/audit-logs') page = <AdminAuditLogs />;
    else if (path === '/admin/settings') page = <AdminSettings />;
    else if (rp) page = <RouteDetailsPage id={rp.id} />;
    else if (vp) page = <VehicleDetailsPage id={vp.id} />;
    else page = <Card><EmptyState icon="search" title="Page not found" /></Card>;
  } else if (isDriver) {
    if (path === '/driver/dashboard') page = <DriverDashboard />;
    else if (path === '/driver/live-map') page = <LiveMapPage />;
    else if (path === '/driver/trips') page = <DriverTripHistoryPage />;
    else if (path === '/driver/notifications') page = <NotificationsPage />;
    else if (path === '/driver/profile') page = <ProfilePage />;
    else if (path === '/driver/settings') page = <SettingsPage />;
    else page = <Card><EmptyState icon="search" title="Page not found" /></Card>;
  } else {
    if (path === '/') page = <HomePage />;
    else if (path === '/live-map') page = <LiveMapPage />;
    else if (path === '/track') page = <TrackPage params={params} />;
    else if (path === '/routes') page = <RoutesPage />;
    else if (rp) page = <RouteDetailsPage id={rp.id} />;
    else if (path === '/bus-stops') page = <BusStopsPage params={params} />;
    else if (path === '/my-trips') page = <MyTripsPage />;
    else if (path === '/notifications') page = <NotificationsPage />;
    else if (path === '/profile') page = <ProfilePage />;
    else if (path === '/settings') page = <SettingsPage />;
    else if (vp) page = <VehicleDetailsPage id={vp.id} />;
    else page = <Card><EmptyState icon="search" title="Page not found" sub={'No page matches ' + path} /></Card>;
  }

  const placeholder = isAdmin ? 'Search vehicles, routes, stops, drivers or users...' : 'Search route, bus number or Rwanda phone...';

  return (
    <div className="min-h-screen bg-slate-100">
      <aside className="hidden lg:block fixed inset-y-0 left-0 z-[800]">
        <SidebarInner nav={nav} path={path} onClose={() => setMenuOpen(false)} />
      </aside>
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-[1000]">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0"><SidebarInner nav={nav} path={path} onClose={() => setMenuOpen(false)} /></div>
        </div>
      )}
      <div className="lg:pl-64 flex flex-col min-h-screen">
        <Header onMenu={() => setMenuOpen(true)} placeholder={placeholder} />
        <ConnectionBanner />
        <main className="flex-1 p-4 md:p-6 max-w-[1600px] w-full mx-auto">{page}</main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <SocketProvider>
          <VehiclesProvider>
            <Shell />
          </VehiclesProvider>
        </SocketProvider>
      </AuthProvider>
    </ToastProvider>
  );
}