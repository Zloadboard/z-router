/* Saved trips + share links: trip <-> compact JSON <-> base64url (#trip=...), JSON export/import, Google Maps link. Browser + Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZRTrips = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MAX_STOPS = 7, MAX_TRIPS = 50;
  function utf8b64url(str) {
    var b64 = typeof Buffer !== 'undefined' ? Buffer.from(str, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(str)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlUtf8(s) {
    var b64 = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (b64.length % 4) b64 += '=';
    return typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('utf8') : decodeURIComponent(escape(atob(b64)));
  }
  var num = function (v) { return typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null); };
  var str = function (v, n) { return typeof v === 'string' ? v.slice(0, n || 200) : ''; };
  /** Clean a trip object from anywhere (storage, link, imported file). truckFields: allowed truck keys. */
  function sanitize(t, truckFields) {
    if (!t || typeof t !== 'object') return null;
    var stops = (Array.isArray(t.stops) ? t.stops : []).slice(0, MAX_STOPS).map(function (s) {
      if (!s) return null;
      var lab = str(s.label).trim(); if (!lab) return null;
      var o = { label: lab }, la = num(s.lat), ln = num(s.lng);
      if (la != null && ln != null && Math.abs(la) <= 90 && Math.abs(ln) <= 180) { o.lat = la; o.lng = ln; }
      return o;
    }).filter(Boolean);
    if (stops.length < 2) return null;
    var truck = {}; (truckFields || Object.keys(t.truck || {})).forEach(function (k) { var v = t.truck && t.truck[k]; if (typeof v === 'string' || typeof v === 'number') truck[k] = str(String(v), 40); });
    var prefs = {}; Object.keys(t.prefs || {}).slice(0, 30).forEach(function (k) { var v = t.prefs[k]; if (typeof v === 'boolean' || typeof v === 'string') prefs[str(k, 30)] = typeof v === 'string' ? str(v, 40) : v; });
    var appts = {}; Object.keys(t.appts || {}).slice(0, MAX_STOPS).forEach(function (k) { if (/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(t.appts[k])) appts[str(k, 220)] = t.appts[k]; });
    var h = t.hos || {}, hos = { used: Math.max(0, Math.min(70, num(h.used) || 0)), cycle: num(h.cycle) === 60 ? 60 : 70, dwell: Math.max(0, Math.min(600, num(h.dwell) == null ? 60 : num(h.dwell))) };
    return { v: 1, name: str(t.name, 80).trim() || defaultName(stops), savedAt: num(t.savedAt) || Date.now(), stops: stops, truck: truck, prefs: prefs, appts: appts, hos: hos };
  }
  function defaultName(stops) {
    var c = function (s) { return s ? s.label.split(',')[0] : '?'; }, f = stops.filter(Boolean);
    return c(f[0]) + ' → ' + c(f[f.length - 1]) + (f.length > 2 ? ' (+' + (f.length - 2) + ')' : '');
  }
  /** Compact link form (short keys; coordinates rounded to 5 decimals = about 1 m). */
  function compact(o) { var r = {}; Object.keys(o || {}).forEach(function (k) { if (o[k] !== '' && o[k] !== false && o[k] != null) r[k] = o[k]; }); return r; }
  function encode(trip) {
    var c = { v: 1, s: trip.stops.map(function (s) { return s ? (s.lat != null ? [s.label, +s.lat.toFixed(5), +s.lng.toFixed(5)] : [s.label]) : null; }), t: compact(trip.truck), p: compact(trip.prefs) };
    if (Object.keys(trip.appts || {}).length) c.a = trip.appts;
    if (trip.hos) c.h = trip.hos;
    if (trip.name) c.n = trip.name;
    return utf8b64url(JSON.stringify(c));
  }
  function decode(code, truckFields) {
    try {
      var c = JSON.parse(b64urlUtf8(code));
      return sanitize({ name: c.n, stops: (c.s || []).map(function (a) { return Array.isArray(a) ? { label: a[0], lat: a[1], lng: a[2] } : null; }), truck: c.t, prefs: c.p, appts: c.a, hos: c.h }, truckFields);
    } catch (e) { return null; }
  }
  /** Share link: base URL + #trip=<code> (a hash, so it works on any static host and never reaches a server log). */
  function shareUrl(base, trip) { return String(base).split('#')[0] + '#trip=' + encode(trip); }
  function fromHash(hash, truckFields) { var m = String(hash || '').match(/[#&]trip=([A-Za-z0-9_-]+)/); return m ? decode(m[1], truckFields) : null; }
  /** Google Maps directions (car routing; up to 9 via points). points: [{lat,lng,label}] */
  function googleMapsUrl(points) {
    var p = points.filter(Boolean), q = function (x) { return x.lat != null ? (+x.lat).toFixed(5) + ',' + (+x.lng).toFixed(5) : x.label; };
    if (p.length < 2) return '';
    var u = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + encodeURIComponent(q(p[0])) + '&destination=' + encodeURIComponent(q(p[p.length - 1]));
    var mid = p.slice(1, -1).slice(0, 9).map(q);
    return mid.length ? u + '&waypoints=' + encodeURIComponent(mid.join('|')) : u;
  }
  /** Saved-trip list helpers (pure; caller does localStorage). */
  function upsert(list, trip) {
    var out = (list || []).filter(function (t) { return t.name !== trip.name; });
    out.unshift(trip); return out.slice(0, MAX_TRIPS);
  }
  function exportJson(list) { return JSON.stringify({ app: 'Z Router', kind: 'saved-trips', version: 1, exportedAt: new Date().toISOString(), trips: list }, null, 1); }
  /** Accepts an export file, a bare array or a single trip. Returns sanitized trips (bad entries dropped). */
  function importJson(text, truckFields) {
    var j = JSON.parse(text), arr = Array.isArray(j) ? j : j && Array.isArray(j.trips) ? j.trips : [j];
    return arr.slice(0, MAX_TRIPS).map(function (t) { return sanitize(t, truckFields); }).filter(Boolean);
  }
  return { sanitize: sanitize, encode: encode, decode: decode, shareUrl: shareUrl, fromHash: fromHash, googleMapsUrl: googleMapsUrl, upsert: upsert,
    exportJson: exportJson, importJson: importJson, defaultName: defaultName, MAX_TRIPS: MAX_TRIPS };
});
