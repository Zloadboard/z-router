/* Z Router feature flags (v0.10.0) - the ONE place that lists what can be switched on or off for visitors.
 * Basic (the default for every visitor of the Pages site) = the features with visitor:true are shown; visitor:false stay hidden.
 * The owner unlocks everything and chooses what visitors see; that choice is saved in features.json (repo file the site loads at startup).
 * The desktop app is always fully unlocked. Pure code: works in the browser (window.ZRFeatures) and in Node tests/tools.
 *
 * module: the code that powers the feature lives in js/feat/<module>.js. On the Pages build those files get hash names, are not linked
 * in index.html and are fetched only when the feature is on for the current person (owner unlock, or enabled in features.json). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('crypto').webcrypto);
  else root.ZRFeatures = factory(root.crypto);
})(typeof self !== 'undefined' ? self : this, function (webcrypto) {
  'use strict';
  var GROUPS = [['reports', 'Trip reports (buttons in the results view)'], ['planner', 'Planner extras'], ['map', 'Map'], ['truck', 'Truck & Settings']];
  var FEATURES = [
    { id: 'legs', group: 'reports', label: 'Legs Itinerary', visitor: false },
    { id: 'states', group: 'reports', label: 'State Mileage', visitor: false },
    { id: 'tandem', group: 'reports', label: 'Tandem Rules', visitor: false },
    { id: 'directions', group: 'reports', label: 'Directions', visitor: false },
    { id: 'tolls', group: 'reports', label: 'Tolls & Warnings', visitor: true },
    { id: 'costs', group: 'reports', label: 'Load Economics', visitor: false },
    { id: 'settings', group: 'reports', label: 'Trip Settings', visitor: false },
    { id: 'note', group: 'reports', label: 'Driver Note', visitor: false },
    { id: 'stops', group: 'reports', label: 'Truck Stops & Fuel (+ rest areas layer, EIA diesel)', visitor: true, module: 'stops' },
    { id: 'ifta', group: 'reports', label: 'IFTA Estimate', visitor: false, module: 'ifta' },
    { id: 'send', group: 'reports', label: 'Send to Driver (link, QR)', visitor: false, module: 'share' },
    { id: 'full', group: 'reports', label: 'Print / Full Report', visitor: false },
    { id: 'hos', group: 'planner', label: 'HOS planner + appointment times', visitor: false, module: 'hos' },
    { id: 'trips', group: 'planner', label: 'Saved trips (save, export, import)', visitor: false, module: 'share' },
    { id: 'tollMap', group: 'map', label: 'Toll map layer (Tolls button, rates, legend)', visitor: true },
    { id: 'traffic', group: 'map', label: 'Live traffic layer (TomTom flow + incident tiles)', visitor: true },
    { id: 'crossdocks', group: 'map', label: 'Crossdocks map layer (Freight Board partners)', visitor: false },
    { id: 'tandemUi', group: 'truck', label: 'Tandem settings, alerts and map labels', visitor: false },
    { id: 'routePrefs', group: 'truck', label: 'Routing preferences (avoid tolls, ferries, ...)', visitor: true },
    { id: 'costsAdv', group: 'truck', label: 'Advanced costs (load rate, per hour, fuel source/type, profit)', visitor: false }
  ];
  /** module -> modules that must load with it */
  var MODULES = { hos: [], stops: [], ifta: [], share: ['hos'] };
  var ids = FEATURES.map(function (f) { return f.id; });

  function defaults() { var o = {}; FEATURES.forEach(function (f) { o[f.id] = !!f.visitor; }); return o; }
  /** What one person gets. json = parsed features.json (or null); owner = unlocked and not previewing -> everything. Unknown ids are ignored. */
  function resolve(json, owner) {
    var o = defaults(), v = json && typeof json === 'object' && json.visitors && typeof json.visitors === 'object' ? json.visitors : {};
    FEATURES.forEach(function (f) { o[f.id] = owner ? true : typeof v[f.id] === 'boolean' ? v[f.id] : !!f.visitor; });
    return o;
  }
  /** Module names (with dependencies) needed for a resolved selection. */
  function modulesFor(sel) {
    var need = {};
    FEATURES.forEach(function (f) { if (sel[f.id] && f.module) { need[f.module] = 1; (MODULES[f.module] || []).forEach(function (d) { need[d] = 1; }); } });
    return Object.keys(need);
  }
  /** features.json text for a selection {id: bool} (stable order, all ids). */
  function toJson(sel) {
    var v = {}; FEATURES.forEach(function (f) { v[f.id] = !!sel[f.id]; });
    return JSON.stringify({ v: 1, note: 'Which features regular visitors see. Edit with the Owner panel or tools/set-features.js; see README.', visitors: v }, null, 2) + '\n';
  }
  function parseJson(text) { try { var j = JSON.parse(text); return j && typeof j === 'object' && j.visitors ? j : null; } catch (e) { return null; } }

  // ---- owner code check: salted PBKDF2-SHA256, only the hash is stored (data/owner.json) ----
  /** Forgiving on purpose: case, spaces, any dash (smart dashes from phones, non-breaking hyphen), zero-width/paste junk and stray punctuation
   *  all collapse to the same text: lowercase letters and digits joined by single hyphens. */
  function normalize(code) {
    var s = String(code == null ? '' : code);
    try { s = s.normalize('NFKC'); } catch (e) { /* old engines */ }
    return s.replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function toB64(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return (typeof btoa === 'function' ? btoa(s) : Buffer.from(u8).toString('base64')); }
  function fromB64(b) { if (typeof atob === 'function') { var s = atob(b), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; } return new Uint8Array(Buffer.from(b, 'base64')); }
  function hashCode(code, saltB64, iter) {
    var subtle = webcrypto && webcrypto.subtle;
    if (!subtle) return Promise.reject(new Error('This browser blocks secure hashing here (needs https).'));
    return subtle.importKey('raw', new TextEncoder().encode(normalize(code)), 'PBKDF2', false, ['deriveBits']).then(function (k) {
      return subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: iter }, k, 256);
    }).then(function (bits) { return toB64(new Uint8Array(bits)); });
  }
  function verify(code, cfg) {
    if (!cfg || !cfg.hash || !cfg.salt || !cfg.iter) return Promise.resolve(false);
    return hashCode(code, cfg.salt, cfg.iter).then(function (h) { var d = h.length ^ cfg.hash.length; for (var i = 0; i < h.length && i < cfg.hash.length; i++) d |= h.charCodeAt(i) ^ cfg.hash.charCodeAt(i); return d === 0; });
  }

  return { FEATURES: FEATURES, GROUPS: GROUPS, MODULES: MODULES, ids: ids, defaults: defaults, resolve: resolve, modulesFor: modulesFor, toJson: toJson, parseJson: parseJson,
    normalize: normalize, hashCode: hashCode, verify: verify, toB64: toB64 };
});
