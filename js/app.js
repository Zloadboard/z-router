/* Z Router (formerly TruckRouter) frontend v0.7 (no build step): two views in the left panel, like a simple trip planner.
 * Planning view: Trip Waypoints + depart row + Run Trip / Reset Trip + ONE collapsed "Truck & Settings" bar.
 * Results view: Trip Summary table + Trip Reports grid (reports open in the docked panel) + Go Back / Reset Trip.
 * STATIC BUILD (GitHub Pages): /api/* is answered in the browser by js/static-api.js, which calls TomTom directly
 * with the key from config.js. Shared math lives in calc.js (TRCalc) and tandem.js (TRTandem). */
(function () {
  'use strict';
  var C = window.TRCalc, T = window.TRTandem, S = window.TRStops;
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  var ICON = window.ICON || function () { return ''; };
  var STORE_KEY = 'truckrouter.settings.v2', OLD_STORE_KEY = 'truckrouter.settings.v1', PROFILE_KEY = 'truckrouter.profiles.v1';
  var ROUTE_COLOR = '#184a7e';
  var NON_SEMI = { straight: 1, bobtail: 1, light: 1 };

  var state = { config: null, view: 'map', baseLayer: null, labelLayer: null, routeLayer: null, markerLayer: null, warnLayer: null,
    searchMarker: null, lastResult: null, rules: null, rulesInfo: null, filledRows: [], tileFailed: {}, lastNote: '' };

  /** Feature hooks filled in by the modules in js/feat/ (see "feature modules" below). */
  var F = {};
  /** Is this feature on for the current visitor? (js/gate.js decides: desktop = everything, Pages = owner choices, Basic by default.) */
  function can(id) { return !window.ZRGate || window.ZRGate.can(id); }
  var MODS = {}, booted = false;
  function modCtx() {
    return { F: F, can: can, state: state, $: $, $$: $$, esc: esc, mi: mi, money: money, short: short, tzName: tzName, C: C, TRIPS: TRIPS, SHARE_URL: SHARE_URL,
      PROFILE_FIELDS: PROFILE_FIELDS, TRUCK_FIELDS: TRUCK_FIELDS, field: field, saveSettings: saveSettings, recalcEconomics: recalcEconomics, toast: toast,
      readTruck: readTruck, readPrefs: readPrefs, readStopList: readStopList, hosPrefs: hosPrefs, apptStore: apptStore, apptKey: apptKey, fmtAt: fmtAt, msIso: msIso,
      toggleMenu: toggleMenu, api: api, bindPopupButtons: bindPopupButtons, localISO: localISO, applyTrip: applyTrip, copyText: copyText, renderTandemSection: renderTandemSection };
  }
  /** Feature modules (js/feat/*.js) push [name, factory] onto window.ZRXQ; the factory gets the context above and returns {init}. */
  function defineMod(name, factory) {
    if (MODS[name]) return;
    MODS[name] = factory(modCtx()) || {};
    if (booted && MODS[name].init) MODS[name].init();
  }

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }
  function localISO(d) { d = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); }
  var TRIPS = window.ZRTrips, SHARE_URL = 'https://zloadboard.github.io/z-router/';
  function mi(v, d) { return (+v || 0).toLocaleString('en-US', { maximumFractionDigits: d == null ? 0 : d }); }
  function fmtMiles(m) { return mi(m, 1) + ' mi'; }
  function mi1(v) { return (+v || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function money(v, dec) { return dec === 0 ? (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US') : C.formatMoney(v, 'USD'); }
  function short(s) { return String(s || '').split(',').slice(0, 2).join(',').trim(); }
  function city(s) { return String(s || '').split(',')[0].trim(); }
  function ftIn(ft, inch) {
    var f = parseFloat(ft), i = parseFloat(inch);
    if (!isFinite(f) && !isFinite(i)) return null;
    var v = (isFinite(f) ? f : 0) + (isFinite(i) ? i : 0) / 12;
    return v > 0 ? v : null;
  }
  function api(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'Bad response from server (HTTP ' + r.status + ')' }; })
        .then(function (j) { j.httpStatus = r.status; return j; });
    });
  }
  /** ISO local time -> { time: '7:45 PM', day: 'Fri Oct 9', tz: 'UTC−4' } using the ISO string's own offset. */
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function isoParts(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/);
    if (!m) return null;
    var h = +m[4], d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    var tz = !m[6] ? '' : m[6] === 'Z' ? 'UTC' : 'UTC' + (m[6][0] === '-' ? '−' : '+') + parseInt(m[6].slice(1, 3), 10) + (m[6].slice(-2) !== '00' ? ':' + m[6].slice(-2) : '');
    return { time: (h % 12 || 12) + ':' + m[5] + ' ' + (h >= 12 ? 'PM' : 'AM'), day: DOW[d.getUTCDay()] + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCDate(), tz: tz };
  }
  function showMessage(html, kind) {
    var m = $('#message');
    if (!html) { m.classList.add('hidden'); m.innerHTML = ''; return; }
    m.className = 'message ' + (kind || 'error');
    m.innerHTML = html;
    $('#panelBody').scrollTop = 0;
  }
  var toastTimer;
  function toast(text) {
    var t = $('#toast'); t.textContent = text; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2200);
  }
  function showBanner(html) {
    var b = $('#keyBanner');
    b.innerHTML = html + '<button type="button" title="Dismiss">&times;</button>';
    b.classList.remove('hidden');
    $('button', b).onclick = function () { b.classList.add('hidden'); };
  }

  // ---------- form ----------
  function field(name) { return $('#tripForm').elements[name]; }
  var TRUCK_FIELDS = ['fuelSrc', 'type', 'axleCount', 'hazmat', 'heightFt', 'heightIn', 'lengthFt', 'lengthIn', 'widthFt', 'widthIn', 'weightLbs',
    'maxSpeedMph', 'trailerFt', 'kpraFt', 'kpraIn', 'spreadFt', 'spreadIn', 'fuel', 'mpg', 'fuelPrice', 'costPerMile', 'costPerHour', 'loadRate', 'deadhead'];
  // Per-trip fields: never saved in the browser, so one load's rate never shows up as the next trip's profit.
  var TRIP_ONLY = { loadRate: 1, deadhead: 1 };
  var PROFILE_FIELDS = ['type', 'axleCount', 'hazmat', 'heightFt', 'heightIn', 'lengthFt', 'lengthIn', 'widthFt', 'widthIn', 'weightLbs', 'maxSpeedMph',
    'trailerFt', 'kpraFt', 'kpraIn', 'spreadFt', 'spreadIn', 'mpg'];
  var PREF_CHECKS = ['avoidTolls', 'avoidFerries', 'avoidTunnels', 'avoidDirtRoads', 'reorderStops', 'considerTraffic', 'seasonalClosures', 'avoidSharpTurns'];
  var ECON_FIELDS = { mpg: 1, fuelPrice: 1, costPerMile: 1, costPerHour: 1, loadRate: 1, fuel: 1, deadhead: 1 };
  var TANDEM_FIELDS = { kpraFt: 1, kpraIn: 1, spreadFt: 1, spreadIn: 1, trailerFt: 1, type: 1 };

  function readTruck() {
    var t = {}; TRUCK_FIELDS.forEach(function (n) { var f = field(n); if (f) t[n] = String(f.value).replace(/,/g, '').trim(); });
    return t;
  }
  function readPrefs() {
    var p = {}; PREF_CHECKS.forEach(function (n) { p[n] = field(n).checked; });
    p.departDate = field('departDate').value; p.departTime = field('departTime').value; p.routeType = field('routeType').value;
    return p;
  }
  function setRouteType(v) {
    field('routeType').value = v === 'short' ? 'short' : 'fast';
    $$('#routeTypeSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === field('routeType').value); });
  }
  function fillSelects(cfg) {
    var tt = $('#truckType');
    (cfg.truckTypes || [{ id: 'semi', label: 'Truck Semi' }]).forEach(function (t) { tt.add(new Option(t.label.replace('Truck Semi', 'Tractor + trailer'), t.id)); });
    var ax = $('#axleCount');
    for (var i = 2; i <= 9; i++) ax.add(new Option(String(i), String(i)));
    ax.value = '5';
    var hz = $('#hazmat');
    hz.add(new Option('None', ''));
    (cfg.hazmat && cfg.hazmat.length ? cfg.hazmat : C.HAZMAT).forEach(function (h) { hz.add(new Option(h.label, h.id)); });
    var ms = $('#maxSpeed');
    for (var s = 45; s <= 80; s += 5) ms.add(new Option(s + ' mph', String(s)));
    ms.value = '65';
    // Depart: 09:00 today, or the next quarter hour once 09:00 has passed (no routes for a past time).
    var now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
    $('#departDate').value = localISO(now);
    if (mins > 9 * 60) {
      var q = Math.ceil((mins + 1) / 15) * 15;
      if (q >= 24 * 60) { $('#departDate').value = localISO(new Date(now.getTime() + 864e5)); q = 0; }
      $('#departTime').value = ('0' + Math.floor(q / 60)).slice(-2) + ':' + ('0' + q % 60).slice(-2);
    }
  }
  function saveSettings() {
    try {
      var p = readPrefs(); delete p.departDate; delete p.departTime;
      var t = readTruck(); Object.keys(TRIP_ONLY).forEach(function (k) { delete t[k]; });
      localStorage.setItem(STORE_KEY, JSON.stringify({ truck: t, prefs: p, preset: $('#preset').value }));
    } catch (e) { /* storage unavailable */ }
  }
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || JSON.parse(localStorage.getItem(OLD_STORE_KEY) || 'null');
      if (!s) return;
      if (s.truck && s.truck.hazmat && C.HAZMAT_LEGACY && C.HAZMAT_LEGACY[s.truck.hazmat]) s.truck.hazmat = C.HAZMAT_LEGACY[s.truck.hazmat];
      TRUCK_FIELDS.forEach(function (n) { if (s.truck && s.truck[n] != null && field(n)) field(n).value = s.truck[n]; });
      PREF_CHECKS.forEach(function (n) { if (s.prefs && n in s.prefs) field(n).checked = !!s.prefs[n]; });
      if (s.prefs && s.prefs.routeType) setRouteType(s.prefs.routeType);
      if (s.preset != null) $('#preset').value = s.preset;
    } catch (e) { /* ignore */ }
  }

  // ---------- truck presets / saved profiles ----------
  var PRESETS = {
    dryvan53: { label: '53′ Dry Van', v: { type: 'semi', axleCount: '5', heightFt: 13, heightIn: 6, lengthFt: 53, lengthIn: 0, widthFt: 8, widthIn: 6, weightLbs: 80000, trailerFt: 53 } },
    reefer53: { label: '53′ Reefer', v: { type: 'semi', axleCount: '5', heightFt: 13, heightIn: 6, lengthFt: 53, lengthIn: 0, widthFt: 8, widthIn: 6, weightLbs: 80000, trailerFt: 53 } },
    flatbed48: { label: '48′ Flatbed', v: { type: 'semi', axleCount: '5', heightFt: 13, heightIn: 6, lengthFt: 48, lengthIn: 0, widthFt: 8, widthIn: 6, weightLbs: 80000, trailerFt: 48 } },
    straight26: { label: '26′ Straight Truck', v: { type: 'straight', axleCount: '2', heightFt: 13, heightIn: 0, lengthFt: 26, lengthIn: 0, widthFt: 8, widthIn: 6, weightLbs: 26000, trailerFt: '' } },
    bobtail: { label: 'Bobtail', v: { type: 'bobtail', axleCount: '3', heightFt: 13, heightIn: 6, lengthFt: 22, lengthIn: 0, widthFt: 8, widthIn: 6, weightLbs: 20000, trailerFt: '' } }
  };
  var PRESET_KEYS = Object.keys(PRESETS.dryvan53.v);
  function savedProfiles() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function buildPresetSelect(selected) {
    var sel = $('#preset'), saved = savedProfiles();
    sel.innerHTML = '<option value="">Custom profile</option>';
    var g1 = document.createElement('optgroup'); g1.label = 'Presets';
    Object.keys(PRESETS).forEach(function (k) { g1.appendChild(new Option(PRESETS[k].label, 'p:' + k)); });
    sel.appendChild(g1);
    var names = Object.keys(saved);
    if (names.length) {
      var g2 = document.createElement('optgroup'); g2.label = 'Saved';
      names.forEach(function (n) { g2.appendChild(new Option(n + ' (saved)', 's:' + n)); });
      sel.appendChild(g2);
    }
    sel.add(new Option('＋ Save current as…', '__save'));
    if (names.length) sel.add(new Option('Delete a saved profile…', '__del'));
    sel.value = selected || '';
    if (sel.value !== (selected || '')) sel.value = '';
  }
  function applyProfile(v) {
    Object.keys(v).forEach(function (k) { if (field(k) != null && v[k] != null) field(k).value = v[k]; });
  }
  function onPresetChange() {
    var sel = $('#preset'), val = sel.value, saved = savedProfiles();
    if (val === '__save') {
      var name = (window.prompt('Name for this truck profile (saved in this browser):', 'Unit ') || '').trim();
      if (name) {
        var p = {}; PROFILE_FIELDS.forEach(function (f) { p[f] = field(f).value; });
        saved[name] = p; localStorage.setItem(PROFILE_KEY, JSON.stringify(saved));
        buildPresetSelect('s:' + name); toast('Saved profile “' + name + '”');
      } else buildPresetSelect(sel.dataset.prev || '');
    } else if (val === '__del') {
      var dn = (window.prompt('Delete which saved profile? ' + Object.keys(saved).join(', ')) || '').trim();
      if (dn && saved[dn]) { delete saved[dn]; localStorage.setItem(PROFILE_KEY, JSON.stringify(saved)); toast('Deleted “' + dn + '”'); }
      buildPresetSelect('');
    } else if (val.indexOf('p:') === 0 && PRESETS[val.slice(2)]) applyProfile(PRESETS[val.slice(2)].v);
    else if (val.indexOf('s:') === 0 && saved[val.slice(2)]) applyProfile(saved[val.slice(2)]);
    sel.dataset.prev = sel.value;
    saveSettings(); onTandemInput();
  }

  // ---------- waypoints + autosuggest ----------
  var WP_DEFS = [{ role: 'start', label: 'Start' }];
  for (var i = 1; i <= 5; i++) WP_DEFS.push({ role: 'stop', label: 'Stop ' + i });
  WP_DEFS.push({ role: 'end', label: 'End' });

  var LETTERS = 'ABCDEFG';
  function wpRow(idx) { return $('#waypoints .wp-row[data-idx="' + idx + '"]'); }
  function buildWaypointRows() {
    var box = $('#waypoints');
    box.innerHTML = '';
    WP_DEFS.forEach(function (d, idx) {
      var row = document.createElement('div');
      row.className = 'wp-row ' + d.role + (d.role === 'stop' ? ' shown' : ''); // v0.9.2: all 7 boxes always show
      row.dataset.role = d.role; row.dataset.idx = idx;
      var ph = d.role === 'start' ? 'Start: address, city, ZIP or lat,lng' : d.role === 'end' ? 'Destination: address, city or ZIP' : d.label + ': address, city or ZIP';
      // The grip and the remove (x) button are out of the Tab order (tabindex="-1") so Tab goes stop input -> next stop input -> Run Trip.
      // Keyboard: click the grip, then Up/Down; or Alt+Up/Down and Alt+Delete inside the stop box.
      row.innerHTML = '<span class="grip" tabindex="-1" role="button" title="Drag to reorder (or click it, then ↑/↓; Alt+↑/↓ in the box)" aria-label="Reorder ' + d.label + '">' + ICON('grip') + '</span>' +
        '<span class="badge"></span><span class="wl"></span>' +
        '<div class="wi"><input type="text" aria-label="' + d.label + '" placeholder="' + ph + '">' +
        '<button type="button" class="wp-clear" tabindex="-1" title="Remove (Alt+Delete in the box)" aria-label="Remove ' + d.label + '">' + ICON('close') + '</button>' +
        '<ul class="suggest hidden"></ul></div>';
      box.appendChild(row);
      var input = $('input', row);
      attachSuggest(input, $('ul', row), function (item) { setWaypoint(idx, item); }, { stopRow: row });
      input.addEventListener('input', function () { delete input.dataset.lat; delete input.dataset.lng; input.classList.remove('resolved'); });
      input.addEventListener('keydown', function (e) {
        if (!e.altKey) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          var rows = visibleRows(), from = rows.indexOf(row), to = from + (e.key === 'ArrowUp' ? -1 : 1);
          if (to < 0 || to >= rows.length) return;
          applyReorder(from, to);
          $('input', visibleRows()[to]).focus();
        } else if (e.key === 'Delete') { e.preventDefault(); removeRow(row); }
      });
      $('.wp-clear', row).addEventListener('click', function () { removeRow(row); });
      initStopDrag(row);
    });
    var ind = document.createElement('div'); ind.className = 'drop-ind hidden'; ind.id = 'dropIndicator';
    box.appendChild(ind);
    updateAddStop();
  }
  function removeRow(row) {
    if (row.dataset.role === 'stop') { var rows = visibleRows(); writeStopList(S.removeAt(readStopList(), rows.indexOf(row))); }
    else setWaypoint(+row.dataset.idx, null);
  }
  /** Visible rows in screen order: Start, shown intermediate stops, End. */
  function visibleRows() { return [wpRow(0)].concat($$('#waypoints .wp-row.stop.shown'), [wpRow(WP_DEFS.length - 1)]); }
  function isLastRow(row) { var rows = visibleRows(); return rows.indexOf(row) === rows.length - 1; }
  /** Keyboard flow: after a stop input go to the next visible stop input, or to Run Trip from the last one. */
  function focusAfter(row, move) {
    var rows = visibleRows(), next = move === 'run' ? null : nextTabRow(row);
    if (next) $('input', next).focus(); else $('#runBtn').focus();
  }
  /** v0.9.5 Tab order: next box down; from an empty stop box, End (or Run Trip when End is filled). */
  function nextTabRow(row) {
    var rows = visibleRows(), vals = rows.map(function (r) { return !!$('input', r).value.trim(); });
    var k = S.nextTab(vals, rows.indexOf(row));
    return k < 0 ? null : rows[k];
  }
  function rowValue(row) {
    var inp = $('input', row), label = inp.value;
    if (!label.trim()) return null;
    var v = { label: label };
    if (inp.dataset.lat) { v.lat = parseFloat(inp.dataset.lat); v.lng = parseFloat(inp.dataset.lng); }
    return v;
  }
  function readStopList() { return visibleRows().map(rowValue); }
  function putValue(row, v) {
    var inp = $('input', row);
    inp.value = v ? v.label : '';
    if (v && isFinite(v.lat) && isFinite(v.lng)) { inp.dataset.lat = v.lat; inp.dataset.lng = v.lng; inp.classList.add('resolved'); }
    else { delete inp.dataset.lat; delete inp.dataset.lng; inp.classList.remove('resolved'); }
  }
  /** Write a stop list back into the fixed slots: first = Start, last = End, the rest fill Stop 1..n (geocoded points are kept, no re-geocoding). */
  function writeStopList(list) {
    var s = S.toSlots(list), last = WP_DEFS.length - 1;
    putValue(wpRow(0), s.start);
    for (var k = 1; k < last; k++) {
      var row = wpRow(k), has = k - 1 < s.stops.length;
      putValue(row, has ? s.stops[k - 1] : null);
    }
    putValue(wpRow(last), s.end);
    updateAddStop();
    drawPlanMarkers(null);
  }
  function updateAddStop() {
    var rows = visibleRows();
    rows.forEach(function (r, i) {
      var b = $('.badge', r), last = i === rows.length - 1;
      b.textContent = LETTERS[i] || ''; b.classList.toggle('end', last);
      $('.wl', r).textContent = i === 0 ? 'Start' : last ? 'End' : 'Stop ' + i;
    });
  }
  /** v0.9.2: no Add stop button (all 7 boxes show); focuses the first empty middle box. */
  function addStopRow(focus) { // kept for older callers: focuses the first empty middle box
    var free = $$('#waypoints .wp-row.stop').filter(function (r) { return !$('input', r).value.trim(); })[0];
    if (free && focus) $('input', free).focus();
    return free || null;
  }
  function setWaypoint(idx, item) {
    var row = wpRow(idx); if (!row) return;
    if (row.dataset.role === 'stop' && item) row.classList.add('shown');
    putValue(row, item);
    updateAddStop();
    drawPlanMarkers(item && isFinite(item.lat) ? row : null);
  }
  /** Planning markers (before Run Trip): one labelled pin per located stop box (Start / Stop N / End).
   * focusRow: the box just picked; with one point the map flies to it, with 2+ it fits all markers. */
  function drawPlanMarkers(focusRow) {
    if (!state.map || !state.planLayer) return;
    state.planLayer.clearLayers();
    if (state.lastResult && $('#viewResults') && !$('#viewResults').classList.contains('hidden')) return;
    var rows = visibleRows(), pts = [];
    rows.forEach(function (r, i) {
      var inp = $('input', r); if (!inp.dataset.lat) return;
      var ll = [parseFloat(inp.dataset.lat), parseFloat(inp.dataset.lng)], last = i === rows.length - 1;
      var role = i === 0 ? 'start' : last ? 'end' : 'stop', name = i === 0 ? 'Start' : last ? 'End' : 'Stop ' + i;
      pts.push(ll);
      L.marker(ll, { title: name, icon: L.divIcon({ className: 'pmk-wrap', iconSize: [24, 24], iconAnchor: [12, 12],
        html: '<div class="pmk" data-name="' + name + '"><div class="mk mk-' + role + '">' + (LETTERS[i] || '') + '</div><b>' + esc(name) + '</b></div>' }) })
        .bindPopup('<b>' + esc(name) + '</b> ' + esc(inp.value)).addTo(state.planLayer);
    });
    if (!focusRow || !pts.length) return;
    if (pts.length === 1) state.map.flyTo(pts[0], 10, { duration: 0.8 });
    else {
      var dr = $('#detailsDrawer'), side = $('#tripForm'), wide = window.innerWidth > 900;
      var left = wide && side ? side.getBoundingClientRect().right : 0;
      state.map.flyToBounds(L.latLngBounds(pts), { paddingTopLeft: [left + 50, 60], paddingBottomRight: [90, 40], maxZoom: 10, duration: 0.8 });
    }
  }
  function readWaypoints() {
    return $$('#waypoints .wp-row').map(function (row) {
      var inp = $('input', row);
      var w = { role: row.dataset.role, label: inp.getAttribute('aria-label'), text: inp.value.trim(), idx: +row.dataset.idx };
      if (inp.dataset.lat) { w.lat = parseFloat(inp.dataset.lat); w.lng = parseFloat(inp.dataset.lng); w.label = inp.value.trim(); }
      return w;
    });
  }
  /** Apply a manual reorder (planning view only; v0.7: no automatic re-run, press Run Trip). */
  function applyReorder(from, to) {
    if (from === to) return false;
    writeStopList(S.move(readStopList(), from, to));
    return true;
  }
  function initStopDrag(row) {
    var grip = $('.grip', row), drag = null;
    function indicator(insert) {
      var ind = $('#dropIndicator'), rows = drag.rows;
      var target = S.dropTarget(drag.from, insert);
      if (target === drag.from) { ind.classList.add('hidden'); return; }
      var top = insert < rows.length ? rows[insert].offsetTop - 6 : rows[rows.length - 1].offsetTop + rows[rows.length - 1].offsetHeight + 5;
      ind.style.top = top + 'px'; ind.classList.remove('hidden');
    }
    function end(commit, e) {
      if (!drag) return;
      var d = drag; drag = null;
      row.classList.remove('dragging'); row.style.transform = '';
      document.body.classList.remove('dragging-stop');
      $('#dropIndicator').classList.add('hidden');
      try { grip.releasePointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      if (commit) applyReorder(d.from, S.dropTarget(d.from, S.insertIndex(d.mids, e.clientY)));
    }
    grip.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.focus(); // focus by click, so Up/Down can reorder from the keyboard
      var rows = visibleRows();
      drag = { from: rows.indexOf(row), rows: rows, startY: e.clientY,
        mids: rows.map(function (r) { var b = r.getBoundingClientRect(); return b.top + b.height / 2; }) };
      try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      row.classList.add('dragging'); document.body.classList.add('dragging-stop');
    });
    grip.addEventListener('pointermove', function (e) {
      if (!drag) return;
      row.style.transform = 'translateY(' + (e.clientY - drag.startY) + 'px)';
      indicator(S.insertIndex(drag.mids, e.clientY));
    });
    grip.addEventListener('pointerup', function (e) { end(true, e); });
    grip.addEventListener('pointercancel', function (e) { end(false, e); });
    grip.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      var rows = visibleRows(), from = rows.indexOf(row), to = from + (e.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= rows.length) return;
      applyReorder(from, to);
      $('.grip', visibleRows()[to]).focus();
    });
  }

  var NO_KEY_SUGGEST = 'Address suggestions need a routing API key (TomTom or HERE, not configured yet). You can still type lat,lng.';
  /** Autosuggest for an input. opts.stopRow turns on the stop keyboard flow (Tab/Enter accept, Tab moves to the next stop / Run Trip). */
  function attachSuggest(input, list, onPick, opts) {
    opts = opts || {};
    var items = [], active = -1, seq = 0, pending = false, autopick = false;
    function close() { list.classList.add('hidden'); list.innerHTML = ''; items = []; active = -1; }
    function pick(it) { onPick(it); close(); }
    function render() {
      list.innerHTML = '';
      items.forEach(function (it, i) {
        var li = document.createElement('li');
        if (it.muted) { li.className = 'muted'; li.textContent = it.label; }
        else li.innerHTML = esc(it.title) + (it.label && it.label !== it.title ? '<small>' + esc(it.label) + '</small>' : '');
        if (i === active) li.classList.add('active');
        li.addEventListener('mousedown', function (e) { e.preventDefault(); if (!it.muted) pick(it); });
        list.appendChild(li);
      });
      list.classList.toggle('hidden', !items.length);
    }
    var lookup = debounce(function () {
      var q = input.value.trim();
      if (q.length < 3 || /^-?\d+(\.\d+)?\s*,\s*-?\d/.test(q)) { pending = false; autopick = false; close(); return; }
      var my = ++seq;
      if (state.config && !state.config.configured) {
        pending = false; autopick = false; items = [{ muted: true, label: NO_KEY_SUGGEST }]; active = -1;
        if (document.activeElement === input) render(); return;
      }
      var c = state.map ? state.map.getCenter() : { lat: 39.5, lng: -98.35 };
      api('/api/autosuggest?q=' + encodeURIComponent(q) + '&at=' + c.lat.toFixed(4) + ',' + c.lng.toFixed(4)).then(function (j) {
        if (my !== seq) return;
        pending = false;
        if (j.code === 'API_KEY_MISSING') items = [{ muted: true, label: NO_KEY_SUGGEST }];
        else if (!j.ok) items = [{ muted: true, label: 'Suggestions unavailable: ' + (j.error || 'error') }];
        else items = j.items.length ? j.items : [{ muted: true, label: 'No matches' }];
        active = -1;
        if (autopick) { // Tab was pressed while suggestions were loading: take the first one if the box is unchanged
          autopick = false;
          var k = S.pickIndex(items, -1);
          if (k >= 0 && !input.classList.contains('resolved') && input.value.trim() === q) pick(items[k]); else close();
          return;
        }
        if (document.activeElement === input) render(); else close();
      }).catch(function () { pending = false; autopick = false; close(); });
    }, 250);
    input.addEventListener('input', function () { pending = true; autopick = false; lookup(); });
    input.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== input) { list.classList.add('hidden'); list.innerHTML = ''; } }, 150); });
    input.addEventListener('keydown', function (e) {
      var open = !list.classList.contains('hidden');
      if (opts.stopRow && (e.key === 'Tab' || e.key === 'Enter') && !e.altKey && !e.ctrlKey && !e.metaKey) {
        var act = S.keyAction({ key: e.key, shift: e.shiftKey, open: open, items: items, active: active,
          resolved: input.classList.contains('resolved'), isLast: isLastRow(opts.stopRow), pending: pending, text: input.value });
        if (act.prevent) e.preventDefault();
        if (act.pick >= 0) pick(items[act.pick]);
        if (act.wait) autopick = true;
        if (act.move) focusAfter(opts.stopRow, act.move);
        if (act.prevent) return;
      }
      if (!open) return;
      var sel = items.filter(function (x) { return !x.muted; });
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter' && sel.length) { var it = items[S.pickIndex(items, active)]; if (it) { pick(it); e.preventDefault(); } }
      else if (e.key === 'Escape') { close(); e.stopPropagation(); }
    });
  }

  // Mark routing preferences the active provider supports only partly / not at all.
  var CAP_LABELS = { avoidTolls: 'Avoid tolls', avoidFerries: 'Avoid ferries', avoidTunnels: 'Avoid tunnels', avoidDirtRoads: 'Avoid dirt roads',
    reorderStops: 'Re-order stops', considerTraffic: 'Traffic', seasonalClosures: 'Seasonal closures', avoidSharpTurns: 'Avoid sharp turns' };
  function applyCapabilities(cfg) {
    var caps = cfg.capabilities, note = $('#capNote');
    if (!caps) { note.classList.add('hidden'); return; }
    var partial = [], none = [];
    Object.keys(CAP_LABELS).forEach(function (k) {
      var inp = field(k); if (!inp || !caps[k]) return;
      var lab = inp.closest('label'), tag = $('.ctag', lab);
      lab.classList.remove('cap-partial', 'cap-none');
      lab.title = cfg.providerLabel + ': ' + caps[k].note;
      if (tag) tag.textContent = '';
      if (caps[k].support === 'partial') { lab.classList.add('cap-partial'); partial.push(CAP_LABELS[k]); if (tag) tag.textContent = 'partial'; }
      if (caps[k].support === 'none') { lab.classList.add('cap-none'); none.push(CAP_LABELS[k]); if (tag) tag.textContent = 'n/a'; }
    });
    if (caps.truckType) {
      var tl = $('#truckTypeLbl'); tl.title = cfg.providerLabel + ': ' + caps.truckType.note; $('#truckType').title = tl.title;
      if (caps.truckType.support !== 'full') tl.classList.add('cap-partial-text');
    }
    if (!partial.length && !none.length) { note.classList.add('hidden'); return; }
    var html = esc(cfg.providerLabel) + ': ';
    if (partial.length) html += esc(partial.join(', ')) + ' only partly supported. ';
    if (none.length) html += esc(none.join(', ')) + ' not supported (ignored). ';
    if (caps.tolls && caps.tolls.support === 'estimate') html += 'Toll cost is estimated from average per-mile truck rates. ';
    else if (caps.tolls && caps.tolls.support !== 'full') html += 'No toll prices (toll miles shown instead). ';
    note.innerHTML = html + 'Hover an option for details.';
    note.classList.remove('hidden');
  }
  // ---------- tandem: evaluation, truck drawing, status ----------
  function truckNums() {
    var t = readTruck();
    var tr = ftIn(t.trailerFt, 0);
    var sp = ftIn(t.spreadFt, t.spreadIn);
    return { type: t.type, kpra: ftIn(t.kpraFt, t.kpraIn), spread: sp != null && sp <= 12 ? sp : T.DEFAULT_SPREAD_FT, trailer: tr };
  }
  /** Current tandem evaluation: a previewed state wins, else the last route, else nothing. */
  function currentTandem() {
    var n = truckNums(), code = $('#tandemPreview').value;
    var opts = { rules: state.rules, kpraFt: n.kpra, spreadFt: n.spread, trailerLengthFt: n.trailer };
    if (code) return { mode: 'preview', code: code, n: n, ev: state.rules ? T.previewState(state.rules, code, n.kpra, n.trailer, n.spread) : T.evaluate(opts) };
    if (state.lastResult && state.lastResult.states) return { mode: 'route', n: n, ev: T.evaluate(Object.assign({ runs: state.lastResult.states }, opts)) };
    return { mode: 'none', n: n, ev: null };
  }

  function drawTruck(cur) {
    var n = cur.n, ev = cur.ev, svg = $('#truckSvg');
    if (!svg) return; // the drawing lives in the Tandem Rules report
    var nonSemi = !!NON_SEMI[n.type];
    var X0 = 118, X1 = 430, TOP = 26, BOT = 78, GROUND = 98, WY = 89;
    var LINE = '#9ca3af', LIGHT = '#d1d5db', BODY = '#f3f4f6', TIRE = '#4b5563', RED = '#b91c1c';
    var trailer = n.trailer && n.trailer >= 20 && n.trailer <= 65 ? n.trailer : 53;
    var sc = (X1 - X0) / trailer, kp = X0 + 3 * sc; // ~36 in kingpin setback
    var o = [];
    o.push('<line x1="36" y1="' + GROUND + '" x2="446" y2="' + GROUND + '" stroke="' + LIGHT + '"/>');
    o.push('<g opacity="' + (nonSemi ? .4 : 1) + '"><rect x="' + X0 + '" y="' + TOP + '" width="' + (X1 - X0) + '" height="' + (BOT - TOP) + '" rx="2" fill="' + BODY + '" stroke="' + LINE + '"/>' +
      '<rect x="' + X0 + '" y="' + BOT + '" width="' + (X1 - X0) + '" height="3" fill="' + LINE + '"/></g>');
    o.push('<path d="M50 ' + (BOT + 2) + ' V58 Q50 51 57 49 L82 45 Q88 35 95 31 L112 29 Q118 29 118 35 V' + (BOT + 2) + ' Z" fill="#e5e7eb" stroke="' + LINE + '"/>' +
      '<path d="M90 37 L111 34.5 V53 H86 Z" fill="#fff" stroke="' + LIGHT + '"/>' +
      '<rect x="50" y="' + (BOT + 1) + '" width="' + (kp + 20 - 50) + '" height="3" fill="' + LINE + '"/>');
    o.push('<path d="M' + (kp - 3.5) + ' ' + (BOT + 3) + 'h7l-3.5 4.5z" fill="' + TIRE + '"/>');
    var wheel = function (x, fill) { return '<circle cx="' + x + '" cy="' + WY + '" r="8" fill="' + (fill || TIRE) + '"/><circle cx="' + x + '" cy="' + WY + '" r="2.5" fill="#e5e7eb"/>'; };
    o.push(wheel(70) + wheel(kp - 11) + wheel(kp + 11));
    var limits = [];
    if (ev && ev.loaded && !nonSemi) { var seen = {}; ev.rows.forEach(function (row) { if (row.limit && !seen[row.code]) { seen[row.code] = 1; limits.push(row); } }); }
    var strict = ev && ev.strictest && !nonSemi ? ev.strictest : null;
    var violation = strict && ev.settingOk === false;
    var hasK = n.kpra != null && n.kpra > 5 && n.kpra < trailer;
    var center = hasK ? kp + n.kpra * sc : X1 - 6 * sc, half = n.spread / 2 * sc;
    if (!nonSemi) {
      o.push('<rect x="' + (center - half - 11) + '" y="' + (BOT + 3) + '" width="' + (2 * half + 22) + '" height="4" fill="' + LINE + '"/>');
      o.push('<g' + (hasK ? '' : ' opacity=".45"') + '>' + wheel(center - half, violation ? RED : TIRE) + wheel(center + half, violation ? RED : TIRE) + '</g>');
    }
    limits.forEach(function (row) {
      if (strict && row.code === strict.code) return;
      var x = kp + row.limitFt * sc;
      o.push('<line x1="' + x + '" y1="' + (TOP - 2) + '" x2="' + x + '" y2="' + GROUND + '" stroke="' + LIGHT + '" stroke-dasharray="3 3"/>' +
        '<text x="' + x + '" y="' + (TOP - 5) + '" font-size="10" fill="#111" text-anchor="middle">' + esc(row.code) + '</text>');
    });
    if (strict) {
      var sx = kp + strict.limitFt * sc, right = sx > 300;
      var lab = strict.code + ' max ' + T.fmtFt(strict.limitFt) + ' kingpin\u2192' + (strict.point === 'rearmost' ? 'rearmost axle' : 'rear tandem');
      o.push('<line x1="' + sx + '" y1="8" x2="' + sx + '" y2="' + (GROUND + 1) + '" stroke="' + RED + '" stroke-width="1.5"/>' +
        '<text x="' + (right ? sx - 4 : sx + 4) + '" y="17" font-size="11.5" fill="' + RED + '" text-anchor="' + (right ? 'end' : 'start') + '">' + esc(lab) + '</text>');
      if (strict.point === 'rearmost' && !nonSemi)
        o.push('<circle cx="' + (center + half) + '" cy="' + WY + '" r="10.5" fill="none" stroke="' + (violation ? RED : LINE) + '" stroke-dasharray="2 2"/>');
    }
    var DY = 107;
    if (nonSemi) o.push('<text x="275" y="' + (DY + 8) + '" font-size="10.5" text-anchor="middle" fill="#111">KPRA rules apply to semitrailers</text>');
    else if (hasK) {
      o.push('<line x1="' + kp + '" y1="' + DY + '" x2="' + center + '" y2="' + DY + '" stroke="#6b7280"/>' +
        '<line x1="' + kp + '" y1="' + (DY - 4) + '" x2="' + kp + '" y2="' + (DY + 4) + '" stroke="#6b7280"/><line x1="' + center + '" y1="' + (DY - 4) + '" x2="' + center + '" y2="' + (DY + 4) + '" stroke="#6b7280"/>' +
        '<text x="' + ((kp + center) / 2) + '" y="' + (DY + 10) + '" font-size="10.5" text-anchor="middle" fill="' + (violation ? RED : '#111') + '">kingpin \u2192 tandem center ' + T.fmtFt(n.kpra) +
        (strict && strict.point === 'rearmost' ? '  \u00b7  rear axle ' + T.fmtFt(n.kpra + n.spread / 2) : '') + '</text>');
    } else o.push('<text x="' + ((kp + X1) / 2) + '" y="' + (DY + 8) + '" font-size="10.5" text-anchor="middle" fill="#111">enter kingpin \u2192 tandem center to check state limits</text>');
    svg.innerHTML = o.join('');
  }
  /** One-line tandem alert (or null) for the collapsed truck header and the results bar. */
  function tandemAlert(cur) {
    var ev = cur.ev, n = cur.n;
    if (!ev || !ev.loaded || NON_SEMI[n.type] || ev.settingOk !== false) return null;
    var act = ev.actions.filter(function (a) { return a.centerLimitFt < n.kpra - 1e-9; })[0] || ev.actions[0];
    if (!act) return null;
    var where = cur.mode === 'preview' ? 'for ' + act.code : act.startMile < 1 ? 'before departure (' + act.code + ')' : 'before ' + act.code;
    return { text: 'Tandems: slide to \u2264 ' + T.fmtFt(act.centerLimitFt, 'floor') + ' ' + where, mile: cur.mode === 'route' && act.startMile >= 1 ? act.startMile : null, act: act };
  }
  function renderTandemStatus(cur) {
    var box = $('#tandemStatus'), ev = cur.ev, n = cur.n, html = '', cls = '', ic = 'alert';
    var pre = cur.mode === 'preview' ? esc(cur.code) + ' preview: ' : '';
    var info = state.rulesInfo || {};
    if (NON_SEMI[n.type]) html = 'KPRA (kingpin → rear tandem) rules apply to semitrailers; not applicable to this truck type.';
    else if (!state.rules && !(ev && ev.loaded)) html = 'Tandem rules data not loaded.<small>' + esc(info.error || 'data/tandem-rules.json is missing') + '. No state limits are shown.</small>';
    else if (!ev) html = '<span class="muted">Run a trip to check every state on the route, or preview one state.</span>';
    else {
      var extra = [];
      ev.altRules.forEach(function (a) { extra.push(esc(a.text)); });
      if (ev.unknown.length) extra.push('No/uncertain KPRA data for ' + esc(ev.unknown.join(', ')) + ' — check those states.');
      if (ev.verify.length) extra.push('Verify (secondary/uncertain source): ' + esc(ev.verify.join(', ')) + '.');
      ev.trailerWarnings.forEach(function (w) { extra.push(esc(w)); });
      var s = ev.strictest;
      if (s) {
        ev.rows.filter(function (row) { return row.limit && row.others.length; }).forEach(function (row) {
          var also = row.others.filter(function (o) { return o.applies !== false; });
          if (also.length && !extra.some(function (x) { return x.indexOf(row.code + ' also') === 0; }))
            extra.unshift(esc(row.code) + ' also: ' + also.map(function (o) { return T.fmtFt(o.limitFt) + (o.appliesTo ? ' (' + esc(o.appliesTo) + ')' : ''); }).join('; ') + ' — the stricter limit is used.');
        });
        var eq = s.point === 'rearmost' ? ' (≤' + T.fmtFt(s.centerLimitFt, 'floor') + ' to tandem center with ' + T.fmtFt(n.spread) + ' spread)' : '';
        if (ev.settingOk === false) {
          var al = tandemAlert(cur);
          cls = 'red';
          html = pre + '<b>Slide tandems forward to ≤ ' + T.fmtFt(al.act.centerLimitFt, 'floor') + ' kingpin → tandem center ' +
            (cur.mode === 'preview' ? 'for ' + esc(al.act.code) : al.act.startMile < 1 ? 'before departure (route starts in ' + esc(al.act.code) + ')' : 'before entering ' + esc(al.act.code) + ' (mile ~' + mi(al.act.startMile) + ')') + '.</b>' +
            '<small>' + esc(s.label) + eq + '. Your setting ' + T.fmtFt(n.kpra) + ' is over the limit in ' + esc(ev.violations.join(', ')) + '.</small>';
        } else if (ev.settingOk) {
          ic = 'check';
          html = pre + 'Tandems OK: ' + T.fmtFt(n.kpra) + ' to tandem center is within ' + (cur.mode === 'route' ? 'every state limit on this route' : 'the limit') + '.<small>Strictest: ' + esc(s.label) + eq + '.</small>';
        } else html = pre + esc(s.label) + '.<small>' + (eq ? 'That is' + eq + '. ' : '') + 'Enter your kingpin → tandem center setting to check it.</small>';
      } else if (!ev.unknown.length && !ev.altRules.length) {
        ic = 'check';
        html = pre + 'No state KPRA limit ' + (cur.mode === 'route' ? 'on this route' : 'in ' + esc(cur.code)) + (n.trailer ? ' for ' + T.fmtFt(n.trailer) + ' trailers' : '') + '.<small>Verify local/route restrictions.</small>';
      } else html = pre + 'No KPRA number in the data' + (cur.mode === 'route' ? ' for this route' : '') + ', but check:';
      if (extra.length) html += '<small>' + extra.join('<br>') + '</small>';
    }
    box.className = 'tstatus r2 ' + cls;
    box.innerHTML = ICON(ic) + '<div>' + html + '</div>';
  }
  function truckSummary() {
    var t = readTruck(), pv = $('#preset').value, name;
    if (pv.indexOf('p:') === 0 && PRESETS[pv.slice(2)]) name = PRESETS[pv.slice(2)].label;
    else if (pv.indexOf('s:') === 0) name = pv.slice(2);
    else { var o = $('#truckType').selectedOptions[0]; name = (+t.trailerFt && !NON_SEMI[t.type] ? t.trailerFt + '′ ' : '') + (o ? o.textContent : 'Truck'); }
    var parts = [name, (t.heightFt || 0) + '′' + (+t.heightIn ? t.heightIn + '″' : ''), +t.weightLbs ? (+t.weightLbs).toLocaleString('en-US') + ' lb' : '', t.axleCount + ' axles'];
    var k = ftIn(t.kpraFt, t.kpraIn);
    if (k != null && !NON_SEMI[t.type]) parts.push('tandem ' + T.fmtFt(k));
    if (t.hazmat) parts.push('hazmat');
    return parts.filter(Boolean).join(' · ');
  }
  function prefSummary() {
    var p = readPrefs(), parts = [p.routeType === 'short' ? 'Shortest' : 'Fastest', 'Traffic ' + (p.considerTraffic ? 'on' : 'off')];
    var av = [['avoidTolls', 'tolls'], ['avoidFerries', 'ferries'], ['avoidTunnels', 'tunnels'], ['avoidDirtRoads', 'dirt roads']].filter(function (x) { return p[x[0]]; }).map(function (x) { return x[1]; });
    if (av.length) parts.push('Avoid ' + av.join(', '));
    if (p.reorderStops) parts.push('Re-order stops');
    if (p.seasonalClosures) parts.push('Seasonal closures');
    if (p.avoidSharpTurns) parts.push('No sharp turns');
    return parts.join(' · ');
  }
  /** "Tractor semi-trailer, 5 axles" for the Vehicle row of the Trip Summary. */
  var VEHICLE = { semi: 'Tractor semi-trailer', double: 'Tractor with double trailers', triple: 'Tractor with triple trailers', bobtail: 'Bobtail tractor',
    straight: 'Straight truck', straightTrailer: 'Straight truck with trailer', light: 'Light truck / cargo van' };
  function vehicleText(t) {
    t = t || readTruck();
    return (VEHICLE[t.type] || 'Truck') + ', ' + t.axleCount + ' axles' + (t.hazmat ? ' · hazmat' : '');
  }
  // the bar summary must never be cut off: step down to shorter forms until it fits (full text stays in the tooltip)
  function fitTruckSum() {
    var el = $('#truckSum'), full = truckSummary();
    var s2 = full.replace(/ axles\b/, '-axle'), s3 = s2.replace(/(\d+),000 lb/, '$1k lb'), s4 = s3.replace(/^(\d+′ )Dry /, '$1');
    var steps = [full, s2, s3, s4, s4.replace(/^[^·]+· /, '')];
    for (var i = 0; i < steps.length; i++) { el.textContent = steps[i]; if (!el.clientWidth || el.scrollWidth <= el.clientWidth) break; }
  }
  function updateSummaries(cur) {
    fitTruckSum();
    $('#setToggle').title = truckSummary() + ' · ' + prefSummary();
    var al = tandemAlert(cur || currentTandem()), box = $('#truckAlert');
    var txt = al ? al.text + (al.mile ? ' (mile ~' + mi(al.mile) + ')' : '') : '';
    box.textContent = txt; box.classList.toggle('hidden', !al);
  }
  // ---------- views: Planning <-> Results; "Truck & Settings" collapsed bar (expanded state remembered) ----------
  var UI_KEY = 'truckrouter.ui.v2';
  function uiLoad() { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function showView(name) {
    state.view2 = name === 'results' && state.lastResult ? 'results' : 'plan';
    $('#viewPlan').classList.toggle('hidden', state.view2 !== 'plan');
    $('#viewResults').classList.toggle('hidden', state.view2 !== 'results');
    if (state.view2 === 'plan') { closeDetails(); fitTruckSum(); }
    $('#panelBody').scrollTop = 0;
  }
  function setSettingsOpen(open, save) {
    $('#setBody').classList.toggle('hidden', !open);
    $('#cardSettings').classList.toggle('open', !!open);
    $('#setToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (save !== false) { try { localStorage.setItem(UI_KEY, JSON.stringify({ settingsOpen: !!open })); } catch (e) { /* ignore */ } }
  }
  /** Settings menu / older callers: open the planning view with Truck & Settings expanded at a sub-section. */
  var SUBS = { truck: 'subTruck', tandem: 'subTandem', route: 'subRoute', costs: 'subCosts' };
  function goSetting(name) {
    if (name === 'trip') { showView('results'); return; }
    showView('plan'); setSettingsOpen(true);
    var sub = $('#' + (SUBS[name] || 'subTruck')), pane = $('#panelBody');
    if (sub) pane.scrollTop = Math.max(0, sub.offsetTop - pane.offsetTop - 4);
  }
  function onTandemInput() {
    var cur = currentTandem();
    drawTruck(cur); renderTandemStatus(cur); updateSummaries(cur);
    if (state.lastResult) { renderAlertLine(state.lastResult); renderDetails(state.lastResult); drawActionMarkers(); }
  }
  function loadRules() {
    return api('/api/tandem-rules').then(function (j) {
      state.rulesInfo = j;
      state.rules = j && j.ok && j.loaded ? T.normalizeRules({ lastChecked: j.lastChecked, disclaimer: j.disclaimer, measurementNote: j.measurementNote, states: j.states }).data : null;
      var sel = $('#tandemPreview'), keep = sel.value;
      sel.innerHTML = '<option value="">' + (state.rules ? 'Route states' : 'Rules not loaded') + '</option>';
      sel.disabled = !state.rules;
      if (state.rules) Object.keys(state.rules.states).sort().forEach(function (c) {
        var r = state.rules.states[c];
        var tag = r.kpraMaxFt != null ? ' · ' + T.fmtFt(r.kpraMaxFt) : r.altAxleRule ? ' · special' : '';
        sel.add(new Option(c + tag, c));
      });
      sel.value = keep && state.rules && state.rules.states[keep] ? keep : '';
    }).catch(function () { state.rulesInfo = { error: 'could not load /api/tandem-rules' }; state.rules = null; });
  }

  // ---------- map ----------
  var OSM_LAYERS = {
    map: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }],
    terrain: ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, subdomains: 'abc', attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Style &copy; OpenTopoMap (CC-BY-SA)' }],
    satellite: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }]
  };
  function initMap() {
    var map = L.map('map', { zoomControl: false, worldCopyJump: true }).setView([39.5, -98.35], 5);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.scale({ imperial: true, metric: false, position: 'bottomright' }).addTo(map);
    state.map = map;
    state.routeLayer = L.layerGroup().addTo(map);
    state.markerLayer = L.layerGroup().addTo(map);
    state.planLayer = L.layerGroup().addTo(map);
    state.warnLayer = L.layerGroup().addTo(map);
    state.stopsLayer = L.layerGroup().addTo(map);
    state.restLayer = L.layerGroup().addTo(map);
    map.on('moveend', function () { if (state.restOn && F.drawRestLayer) F.drawRestLayer(); });
    state.actionLayer = L.layerGroup().addTo(map);
    setView('map');
    $$('.view-btn').forEach(function (b) { b.addEventListener('click', function () { setView(b.dataset.view); }); });
    $('#fitBtn').addEventListener('click', fitRoute);
    map.createPane('tollPane'); map.getPane('tollPane').style.zIndex = 390; // under the route line (overlayPane 400)
    var tb = $('#tollLayerBtn');
    if (tb && can('tollMap')) {
      var on = true; try { on = localStorage.getItem('zr.tollLayer') !== 'off'; } catch (e) { /* private mode */ }
      tb.addEventListener('click', function () { setTollLayer(!state.tollOn); });
      setTollLayer(on);
    }
    map.on('zoomend', function () { if (state.lastResult) drawActionMarkers(); });
  }
  // ---------- Toll roads layer (bundled OSM geometry, coloured by 5-axle $/mile tier) ----------
  var TOLL_STYLE = {
    top: { color: '#7a0019', weight: 6, opacity: 0.95 }, red: { color: '#d7191c', weight: 4, opacity: 0.85 },
    orange: { color: '#f08a24', weight: 4, opacity: 0.85 }, yellow: { color: '#e0b800', weight: 3.5, opacity: 0.9 },
    grey: { color: '#8a8a8a', weight: 2, opacity: 0.7, dashArray: '4 4' }
  };
  var TOLL_LEGEND = [['top', 'Highest: Skyway, bridges, tunnels'], ['red', '$0.55+ per mile'], ['orange', '$0.30–0.55 per mile'], ['yellow', 'Under $0.30 per mile'], ['grey', 'Other toll road']];
  function tollPopup(pr) {
    var rate = pr.fee != null ? 'Flat toll about ' + money(pr.fee) + ' (5 axles)' : pr.rate != null ? 'About $' + (+pr.rate).toFixed(2) + ' per mile (5 axles)' : 'Rate not in our table (estimate uses $0.35/mi)';
    return '<div class="tpop"><b>' + esc(pr.name) + '</b>' + (pr.state ? ' <span>' + esc(pr.state) + '</span>' : '') +
      (pr.top ? '<div class="ttop">' + esc(pr.top) + '</div>' : '') + '<div>' + rate + ', electronic tag. Cash / toll-by-plate cost more.</div>' +
      (pr.source ? '<div><a href="' + esc(pr.source) + '" target="_blank" rel="noopener">Rate source</a></div>' : '') + '</div>';
  }
  function loadTollLayer() {
    if (state.tollLayerP) return state.tollLayerP;
    state.tollLayerP = fetch('data/toll-roads.geojson').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (gj) {
      state.tollMeta = gj.meta || {};
      return L.geoJSON(gj, {
        pane: 'tollPane',
        style: function (f) { return TOLL_STYLE[f.properties.tier] || TOLL_STYLE.grey; },
        onEachFeature: function (f, layer) {
          var pr = f.properties;
          layer.bindTooltip(esc(pr.name) + ' · ' + (pr.fee != null ? 'flat ~' + money(pr.fee, 0) : pr.rate != null ? '~$' + (+pr.rate).toFixed(2) + '/mi' : 'toll'), { sticky: true, className: 'ttip' });
          layer.bindPopup(tollPopup(pr));
        }
      });
    }).catch(function (e) { state.tollLayerP = null; toast('Toll roads layer not loaded (' + e.message + ')'); throw e; });
    return state.tollLayerP;
  }
  function tollLegendControl() {
    if (state.tollLegend) return state.tollLegend;
    var C2 = L.Control.extend({ options: { position: 'bottomleft' }, onAdd: function () {
      var d = L.DomUtil.create('div', 'tlegend');
      d.innerHTML = '<div class="tl-h">Toll roads, 5-axle estimate</div>' + TOLL_LEGEND.map(function (x) {
        var s = TOLL_STYLE[x[0]];
        return '<div class="tl-r"><i style="background:' + s.color + (x[0] === 'grey' ? ';height:2px' : '') + '"></i>' + esc(x[1]) + '</div>';
      }).join('') + '<div class="tl-n">Tag rates; click a road for details. Map data © OpenStreetMap</div>';
      L.DomEvent.disableClickPropagation(d);
      return d;
    } });
    state.tollLegend = new C2();
    return state.tollLegend;
  }
  function setTollLayer(on) {
    state.tollOn = !!on;
    var b = $('#tollLayerBtn'); if (b) { b.classList.toggle('on', state.tollOn); b.setAttribute('aria-pressed', state.tollOn ? 'true' : 'false'); }
    try { localStorage.setItem('zr.tollLayer', state.tollOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
    if (!state.tollOn) { if (state.tollLayer) state.map.removeLayer(state.tollLayer); if (state.tollLegend) state.map.removeControl(state.tollLegend); return; }
    loadTollLayer().then(function (layer) {
      state.tollLayer = layer;
      if (!state.tollOn) return;
      layer.addTo(state.map); tollLegendControl().addTo(state.map);
    }, function () { setTollLayer(false); });
  }
  // ---------- Live traffic layer (TomTom Traffic API raster tiles: flow + incidents; tiles only, no other Traffic calls) ----------
  var TRAFFIC_LEGEND = [['#1a9a3a', 'Free flowing'], ['#f2c200', 'Slower than usual'], ['#e8590c', 'Slow'], ['#b00020', 'Heavy / stopped']];
  function trafficTileUrl(view) { return (window.ZR_TILE_URL && window.ZR_TILE_URL(view)) || '/api/tiles/' + view + '/{z}/{x}/{y}'; }
  function trafficUnavailable(why, quiet) {
    state.trafficNA = true;
    if (state.trafficOn) setTrafficLayer(false, true);
    var b = $('#trafficLayerBtn'); if (!b) return;
    b.disabled = true; b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); b.classList.add('trf-na');
    b.title = 'Live traffic is unavailable: ' + (why || 'the Traffic API is not enabled on this key') + '. Tick Traffic on the key in the TomTom developer portal.';
    if (!quiet && state.trafficOn !== false) toast('Traffic layer is not available: ' + (why || 'Traffic API not enabled on this key'));
  }
  function trafficTiles() {
    if (state.trafficLayers) return state.trafficLayers;
    var errors = 0, ok = 0, tileOpts = { pane: 'trafficPane', minZoom: 5, maxZoom: 19, maxNativeZoom: 18, attribution: 'Traffic &copy; TomTom' };
    var flow = L.tileLayer(trafficTileUrl('traffic'), Object.assign({ opacity: 0.85 }, tileOpts));
    var inc = L.tileLayer(trafficTileUrl('incidents'), Object.assign({}, tileOpts, { attribution: '' }));
    flow.on('tileload', function () { ok++; });
    flow.on('tileerror', function () { errors++; if (errors >= 4 && ok === 0) trafficUnavailable('the Traffic API is not enabled on this key (TomTom answered 401/403)'); });
    state.trafficLayers = [flow, inc];
    return state.trafficLayers;
  }
  function trafficLegendControl() {
    if (state.trafficLegend) return state.trafficLegend;
    var C2 = L.Control.extend({ options: { position: 'bottomleft' }, onAdd: function () {
      var d = L.DomUtil.create('div', 'tlegend trlegend');
      d.innerHTML = '<div class="tl-h">Live traffic</div>' + TRAFFIC_LEGEND.map(function (x) {
        return '<div class="tl-r"><i style="background:' + x[0] + '"></i>' + esc(x[1]) + '</div>';
      }).join('') + '<div class="tl-n">Icons show incidents and closures. Traffic © TomTom</div>';
      L.DomEvent.disableClickPropagation(d);
      return d;
    } });
    state.trafficLegend = new C2();
    return state.trafficLegend;
  }
  function setTrafficLayer(on, quiet) {
    state.trafficOn = !!on && !state.trafficNA;
    var b = $('#trafficLayerBtn'); if (b && !state.trafficNA) { b.classList.toggle('on', state.trafficOn); b.setAttribute('aria-pressed', state.trafficOn ? 'true' : 'false'); }
    if (!quiet) { try { localStorage.setItem('zr.trafficLayer', state.trafficOn ? 'on' : 'off'); } catch (e) { /* ignore */ } }
    if (!state.trafficOn) { if (state.trafficLayers) state.trafficLayers.forEach(function (l) { state.map.removeLayer(l); }); if (state.trafficLegend) state.map.removeControl(state.trafficLegend); return; }
    trafficTiles().forEach(function (l) { l.addTo(state.map); }); trafficLegendControl().addTo(state.map);
  }
  function initTraffic() {
    var b = $('#trafficLayerBtn'); if (!b || !can('traffic')) return;
    state.map.createPane('trafficPane'); state.map.getPane('trafficPane').style.zIndex = 380; state.map.getPane('trafficPane').style.pointerEvents = 'none'; // above the base map, under toll roads and the route
    var cfg = state.config || {};
    if (!cfg.traffic) { trafficUnavailable(cfg.configured === false ? 'needs a routing key' : 'the Traffic API is not enabled on this key', true); return; }
    b.addEventListener('click', function () { setTrafficLayer(!state.trafficOn); });
    var on = false; try { on = localStorage.getItem('zr.trafficLayer') === 'on'; } catch (e) { /* private mode */ }
    if (on) setTrafficLayer(true, true);
  }
  function providerTiles(view) {
    var cfg = state.config || {};
    return cfg.tiles && cfg.tiles !== 'osm' && cfg.tileViews && cfg.tileViews[view] && !state.tileFailed[view];
  }
  function providerLayer(view, opts) {
    var errors = 0, ok = 0;
    var layer = L.tileLayer((window.ZR_TILE_URL && window.ZR_TILE_URL(view)) || '/api/tiles/' + view + '/{z}/{x}/{y}', Object.assign({ maxZoom: 19, attribution: 'Map tiles &copy; ' + esc(state.config.providerLabel) }, opts || {}));
    layer.on('tileload', function () { ok++; });
    layer.on('tileerror', function () {
      errors++;
      if (errors >= 4 && ok === 0 && !state.tileFailed[view]) {
        state.tileFailed[view] = true;
        showBanner(esc(state.config.providerLabel) + ' ' + view + ' tiles are not available with this API key; showing free tiles instead.');
        setView(state.view);
      }
    });
    return layer;
  }
  function setView(view) {
    state.view = view;
    $$('.view-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.view === view); b.classList.toggle('active', b.dataset.view === view); });
    ['map', 'terrain', 'satellite'].forEach(function (v) { document.body.classList.toggle('view-' + v, v === view); });
    if (state.baseLayer) state.map.removeLayer(state.baseLayer);
    if (state.labelLayer) { state.map.removeLayer(state.labelLayer); state.labelLayer = null; }
    if (providerTiles(view)) {
      state.baseLayer = providerLayer(view);
      if (view === 'satellite' && providerTiles('satlabels')) state.labelLayer = providerLayer('satlabels', { attribution: '' });
    } else {
      var def = OSM_LAYERS[view];
      state.baseLayer = L.tileLayer(def[0], def[1]);
    }
    state.baseLayer.addTo(state.map);
    if (state.labelLayer) state.labelLayer.addTo(state.map);
  }
  function markerIcon(role, text) {
    return L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12],
      html: '<div class="mk mk-' + role + '">' + esc(text) + '</div>' });
  }
  function fitRoute() {
    var b = null;
    state.routeLayer.eachLayer(function (l) { if (l.getBounds) { var lb = l.getBounds(); b = b ? b.extend(lb) : L.latLngBounds(lb.getSouthWest(), lb.getNorthEast()); } });
    if (!b) state.markerLayer.eachLayer(function (m) { b = b ? b.extend(m.getLatLng()) : L.latLngBounds(m.getLatLng(), m.getLatLng()); });
    if (!b || !b.isValid()) return;
    var dr = $('#detailsDrawer'), wide = window.innerWidth > 900;
    var dw = wide && !dr.classList.contains('hidden') ? dr.offsetWidth : 0;
    state.map.fitBounds(b, { paddingTopLeft: [40, 60], paddingBottomRight: [dw + 40, 36] });
  }
  function clearRoute() {
    state.routeLayer.clearLayers(); state.markerLayer.clearLayers(); state.warnLayer.clearLayers(); state.actionLayer.clearLayers(); state.stopsLayer.clearLayers(); state.stopsShown = null;
    state.lastResult = null;
    if (F.xdDraw && state.xdLayer) F.xdDraw();
  }
  /** Point at `mile` along the route polyline (scaled to the provider's total miles). */
  function pointAtMile(res, mile) {
    var pts = []; res.route.legs.forEach(function (l) { (l.coordinates || []).forEach(function (c) { pts.push(c); }); });
    if (pts.length < 2) return null;
    var d = [0], R = 3958.8, rad = Math.PI / 180;
    for (var k = 1; k < pts.length; k++) {
      var a = pts[k - 1], b = pts[k], dl = (b[0] - a[0]) * rad, dg = (b[1] - a[1]) * rad;
      var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dg / 2) * Math.sin(dg / 2);
      d.push(d[k - 1] + 2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
    }
    var target = mile * d[d.length - 1] / (res.route.totals.miles || d[d.length - 1]);
    for (var j = 1; j < d.length; j++) if (d[j] >= target) {
      var f = (target - d[j - 1]) / ((d[j] - d[j - 1]) || 1);
      return [pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f];
    }
    return pts[pts.length - 1];
  }
  function drawActionMarkers() {
    state.actionLayer.clearLayers();
    var res = state.lastResult, cur = currentTandem();
    if (!res || !can('tandemUi') || cur.mode !== 'route' || !cur.ev || !cur.ev.loaded || NON_SEMI[cur.n.type]) return;
    var placed = []; // label boxes in screen px: stack labels that would overlap (state lines close together)
    cur.ev.actions.forEach(function (a) {
      if (cur.n.kpra != null && a.centerLimitFt >= cur.n.kpra - 1e-9) return;
      var p = pointAtMile(res, a.startMile); if (!p) return;
      var txt = esc(a.code) + ' tandems ≤' + T.fmtFt(a.centerLimitFt, 'floor');
      var pt = state.map.latLngToContainerPoint(p), w = 30 + txt.length * 5.6, h = 18, lift = 0;
      var hit = function (y) { return placed.some(function (b) { return pt.x + 6 < b.x + b.w && pt.x + 6 + w > b.x && y - h < b.y && y > b.y - b.h; }); };
      while (lift < 6 && hit(pt.y - 4 - lift * (h + 2))) lift++;
      placed.push({ x: pt.x + 6, y: pt.y - 4 - lift * (h + 2), w: w, h: h });
      L.marker(p, { icon: L.divIcon({ className: '', iconSize: [0, 0], html: '<span class="sm-dot"></span><span class="state-marker' + (lift ? ' lifted' : '') + '" style="bottom:' + (4 + lift * (h + 2)) + 'px">' + ICON('warn') + txt + '</span>' }) })
        .bindPopup(esc(a.text)).addTo(state.actionLayer);
    });
  }

  function initMapSearch() {
    var input = $('#mapSearchInput');
    function drop(item) {
      if (state.searchMarker) state.map.removeLayer(state.searchMarker);
      var m = L.marker([item.lat, item.lng]).addTo(state.map);
      m.bindPopup('<b>' + esc(item.label) + '</b><br><button data-act="start">Set as Start</button><button data-act="stop">Add as Stop</button><button data-act="end">Set as End</button>').openPopup();
      m.on('popupopen', function (ev) { bindPopupButtons(ev.popup.getElement(), item); });
      bindPopupButtons(m.getPopup().getElement(), item);
      state.searchMarker = m;
      state.map.setView([item.lat, item.lng], Math.max(state.map.getZoom(), 11));
    }
    attachSuggest(input, $('#mapSearchSuggest'), function (item) { input.value = item.label; drop(item); });
    $('#mapSearch').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = input.value.trim(); if (!q) return;
      api('/api/geocode?q=' + encodeURIComponent(q)).then(function (j) { if (j.ok) drop(j.item); else showBanner(esc(j.error || 'Search failed')); });
    });
  }
  function bindPopupButtons(el, item) {
    if (!el) return;
    $$('button[data-act]', el).forEach(function (b) {
      b.onclick = function () {
        var act = b.dataset.act;
        if (act === 'start') setWaypoint(0, item);
        else if (act === 'end') setWaypoint(6, item);
        else {
          var free = $$('#waypoints .wp-row.stop').filter(function (r) { return !$('input', r).value.trim(); })[0];
          if (free) setWaypoint(+free.dataset.idx, item); else showBanner('All 5 stops are used.');
        }
        state.map.closePopup();
      };
    });
  }

  // ---------- run trip ----------
  function runTrip(e) {
    if (e) e.preventDefault();
    showMessage(null);
    saveSettings();
    var wps = readWaypoints();
    if (!wps[0].text) { showMessage('Enter a Start location.', 'warn'); return; }
    if (!wps[wps.length - 1].text) { showMessage('Enter a destination (End).', 'warn'); return; }
    var filled = wps.filter(function (w) { return w.text || isFinite(w.lat); });
    if (state.config && !state.config.configured) {
      showMessage('<b>Routing API key not configured.</b> Routing is off: this site was built without a TomTom key in <code>config.js</code>. Rebuild it with <code>TOMTOM_WEB_API_KEY</code> set.', 'error');
      return;
    }
    var btn = $('#runBtn'), lbl = $('span', btn);
    btn.disabled = true; lbl.textContent = 'Routing…';
    state.filledRows = filled.map(function (w) { return w.idx; });
    var runInputs = { truck: readTruck(), prefs: readPrefs(), summary: truckSummary(), vehicle: vehicleText(), prefText: prefSummary() };
    api('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ truck: readTruck(), prefs: readPrefs(), waypoints: filled.map(function (w) { var c = Object.assign({}, w); delete c.idx; return c; }) }) })
      .then(function (j) {
        if (!j.ok) {
          if (j.code === 'API_KEY_MISSING') showMessage('<b>Routing API key not configured.</b> ' + esc(j.error), 'error');
          else {
            var extra = (j.details || []).map(function (n) { return '<li>' + esc(n.title || n.code) + '</li>'; }).join('');
            showMessage(esc(j.error || 'Routing failed.') + (extra ? '<ul>' + extra + '</ul>' : ''), 'error');
          }
          return;
        }
        var after = j.tandem && j.tandem.loaded && !state.rules ? loadRules() : Promise.resolve();
        return after.then(function () { state.runInputs = runInputs; renderResult(j); });
      })
      .catch(function (err) { showMessage('Could not reach the Z Router server: ' + esc(err.message), 'error'); })
      .then(function () {
        btn.disabled = false; lbl.textContent = 'Run Trip';
      });
  }

  function renderResult(res) {
    clearRoute();
    state.lastResult = res;
    if (state.planLayer) state.planLayer.clearLayers();
    if (F.applyEiaFuel) F.applyEiaFuel(res);
    $('#tandemPreview').value = '';
    var r = res.route;
    r.legs.forEach(function (leg, i) {
      if (!leg.coordinates.length) return;
      L.polyline(leg.coordinates, { color: '#ffffff', weight: 6.5, opacity: 0.9 }).addTo(state.routeLayer);
      L.polyline(leg.coordinates, { color: ROUTE_COLOR, weight: 3.5, opacity: 0.95 })
        .bindTooltip(esc(leg.from) + ' → ' + esc(leg.to) + '<br>' + fmtMiles(leg.miles) + ', ' + C.formatDuration(leg.durationSec), { sticky: true })
        .addTo(state.routeLayer);
    });
    res.waypoints.forEach(function (w, i) {
      var role = i === 0 ? 'start' : (i === res.waypoints.length - 1 ? 'end' : 'stop');
      var text = String.fromCharCode(65 + i);
      L.marker([w.lat, w.lng], { icon: markerIcon(role, text) }).bindPopup('<b>' + text + '</b> ' + esc(w.label)).addTo(state.markerLayer);
    });
    r.notices.forEach(function (n) {
      if (!n.location) return;
      L.marker(n.location, { icon: L.divIcon({ className: '', html: '<div class="warn-marker">!</div>', iconSize: [14, 14], iconAnchor: [7, 7] }) })
        .bindPopup('<b>' + esc(n.title) + '</b>' + (n.details.length ? '<br>' + n.details.map(esc).join('<br>') : '')).addTo(state.warnLayer);
    });
    renderSummary(res);
    renderDetails(res);
    onTandemInput();
    showView('results'); // the results view replaces the planning view
    if (F.xdDraw) F.xdDraw(); // crossdock markers: distance from this route (Crossdocks module only)
    fitRoute();
  }

  /** US time-zone abbreviation for an ISO time (offset + US DST dates); falls back to "UTC−h" when ambiguous. */
  function tzName(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d\d)-(\d\d)T[\d:.]+([+-]\d\d):?(\d\d)$/);
    if (!m) { var p = isoParts(iso); return p ? p.tz : ''; }
    var y = +m[1], day = Date.UTC(y, +m[2] - 1, +m[3]), off = String(+m[4] + (m[5] === '00' ? 0 : (m[4][0] === '-' ? -1 : 1) * (+m[5]) / 60));
    var nthSun = function (mon, n) { var f = new Date(Date.UTC(y, mon, 1)).getUTCDay(); return Date.UTC(y, mon, 1 + (7 - f) % 7 + 7 * (n - 1)); };
    var dst = day >= nthSun(2, 2) && day < nthSun(10, 1);
    var map = dst ? { '-4': 'EDT', '-5': 'CDT', '-6': 'MDT', '-8': 'PDT' } : { '-5': 'EST', '-6': 'CST', '-7': 'MST', '-8': 'PST' };
    return map[off] || isoParts(iso).tz;
  }
  /** "5 hours 10 minutes" (Trip Summary wording). */
  function longDur(sec) {
    var m = Math.round((+sec || 0) / 60), h = Math.floor(m / 60); m %= 60;
    if (window.matchMedia && window.matchMedia('(max-width:600px)').matches) return (h ? h + ' h ' : '') + m + ' min'; // phones: short form fits the column
    return (h ? h + (h === 1 ? ' hour ' : ' hours ') : '') + m + (m === 1 ? ' minute' : ' minutes');
  }
  /** "5:10 h" cumulative time for the Start / Stop / End rows. */
  function hmm(sec) { var m = Math.round((+sec || 0) / 60); return Math.floor(m / 60) + ':' + ('0' + m % 60).slice(-2) + ' h'; }
  /** Trip Summary (results view): Vehicle; Start / Stops / End with cumulative miles + time; Dist, Time, Driving | Tolls, Fuel, Fixed, Total;
   * one green "Net profit" line when a load rate is entered; one red "Tandems" line when a state rule is broken. Nothing else. */
  function renderSummary(res) {
    var r = res.route, t = r.totals, c = res.costs, ec = res.economics, pl = res.providerLabel || 'the provider';
    var run = state.runInputs || { truck: readTruck(), summary: truckSummary(), vehicle: vehicleText() }, tk = run.truck;
    var noToll = r.tolls.available === false, zeroToll = !noToll && r.tolls.sections === 0, estToll = !noToll && r.tolls.estimated && r.tolls.items.some(function (x) { return x.road; });
    var HR = '<tr class="sep"><td colspan="5"><div></div></td></tr>'; // divider rows: content rows stay exactly 28px
    var rowsHtml = '<tr><td class="i">' + ICON('truck') + '</td><td class="l">Vehicle</td><td class="v" colspan="3" title="' + esc(run.summary) + '">' + esc(run.vehicle) + '</td></tr>' + HR;
    var cumMi = 0, cumSec = 0, n = res.waypoints.length;
    var badge = function (i) { return '<span class="badge' + (i === n - 1 ? ' end' : '') + '">' + LETTERS[i] + '</span>'; };
    res.waypoints.forEach(function (w, i) {
      var leg = i > 0 ? r.legs[i - 1] : null;
      if (leg) { cumMi += leg.miles; cumSec += leg.durationSec; }
      var iso = i === 0 ? r.departureTime : (leg && leg.arrivalTime) || (i === n - 1 ? r.arrivalTime : null), ap = isoParts(iso);
      var when = ap ? (i === 0 ? 'Depart ' : 'Arrive ') + ap.day + ' ' + ap.time + ' ' + tzName(iso) + (i === 0 ? '' : ' (driving only)') : '';
      var label = i === 0 ? 'Start' : i === n - 1 ? 'End' : 'Stop ' + i;
      if (i === n - 1 && n === 2) rowsHtml += '<tr><td class="i"><span class="dia"></span></td><td class="l">Stops</td><td class="v" colspan="3">There are no stops</td></tr>';
      rowsHtml += '<tr title="' + esc(w.label + (when ? ' · ' + when : '')) + '"><td class="i">' + badge(i) + '</td><td class="l">' + label + '</td><td class="v">' + esc(short(w.label)) +
        '</td><td class="r m">' + mi1(cumMi) + ' mi</td><td class="r t">' + hmm(cumSec) + '</td></tr>';
    });
    rowsHtml += HR;
    $('#resTop').innerHTML = rowsHtml;
    var set = function (id, html, title) { var el = $('#' + id); el.innerHTML = html; el.title = title || ''; };
    var base = t.baseDurationSec > 0 && t.baseDurationSec <= t.durationSec ? t.baseDurationSec : Math.max(0, t.durationSec - (t.trafficDelaySec || 0));
    set('resDist', mi1(t.miles) + (window.matchMedia && window.matchMedia('(max-width:600px)').matches ? ' mi' : ' miles'), r.legs.length + (r.legs.length === 1 ? ' leg' : ' legs'));
    set('resTime', longDur(t.durationSec), 'Total time including traffic' + (t.trafficDelaySec > 60 ? ' (' + C.formatDuration(t.trafficDelaySec) + ' traffic delay)' : ''));
    set('resDrive', longDur(base), 'Driving time with free-flowing traffic');
    set('resTolls', noToll ? 'n/a*' : zeroToll ? '$0' : estToll ? (r.tolls.total > 0 ? '~' + money(r.tolls.total, 0) + ' est.' : '$0') : money(r.tolls.total) + (r.tolls.estimated ? '*' : ''),
      noToll ? mi(r.tolls.miles || 0, 1) + ' toll miles; no toll prices from ' + pl : zeroToll ? 'No toll roads on this route' : estToll ? 'Estimate: ' + mi(r.tolls.miles || 0, 1) + ' toll mi at average per-mile truck rates (' + (r.tolls.axles || 5) + ' axles); see the Tolls & warnings report' : '');
    set('resFuel', money(c.fuelCost), c.gallons + ' gal × ' + money(+tk.fuelPrice || 0) + '/gal');
    set('resFixed', money(c.mileageCost + (c.hourlyCost || 0)), mi(c.miles, 1) + ' mi × ' + money(+tk.costPerMile || 0) + (c.hourlyCost ? ' + ' + c.hours + ' h × ' + money(+tk.costPerHour || 0) : '') + ' (per-mile + per-hour cost)');
    set('resTotal', money(c.totalCost), '$' + c.totalPerMile.toFixed(2) + '/mi' + (noToll ? ', excluding tolls' : ''));
    var pf = $('#resProfit');
    pf.classList.toggle('hidden', !ec);
    if (ec) { pf.className = 'xline ' + (ec.profit >= 0 ? 'pos' : 'red'); pf.innerHTML = ICON('chart') + '<span>Net profit ' + money(ec.profit) + '</span>'; pf.title = ec.margin + '% margin · $' + ec.ratePerMile.toFixed(2) + '/mi rate' + (ec.ratePerLoadedMile != null ? ' · $' + ec.ratePerLoadedMile.toFixed(2) + '/loaded mi (' + mi(ec.deadheadMiles) + ' mi empty)' : '') + ' (Load Economics report)'; }
    $('#resNote').textContent = noToll ? '* ' + pl + ' has no toll prices (' + mi(r.tolls.miles || 0, 1) + ' toll mi); Total excludes tolls.' : estToll ? (r.tolls.total > 0 ? '* Toll estimate: ' + mi(r.tolls.miles || 0, 0) + ' toll mi at avg truck rates; cash may differ.' : '') : r.tolls.estimated && !zeroToll ? '* Toll cost is an estimate.' : '';
    renderAlertLine(res);
  }
  /** The one red "Tandems: slide to ≤ 40′11″ before IN" line (only when the setting breaks a state rule on the route). */
  function renderAlertLine(res) {
    var cur = currentTandem(), ev = cur.mode === 'route' ? cur.ev : null;
    var al = ev ? tandemAlert(cur) : null, box = $('#resAlert');
    box.innerHTML = al ? ICON('warn') + '<span>' + esc(al.text) + '</span>' : '';
    box.title = al ? al.act.text : '';
    box.classList.toggle('hidden', !al);
  }
  // ---------- report panel (docked over the map) ----------
  var REPORTS = { legs: ['list', 'Legs itinerary'], states: ['map', 'State mileage'], tandem: ['axle', 'Tandem rules on this route'],
    directions: ['turn', 'Turn-by-turn directions'], tolls: ['warn', 'Tolls & warnings'], costs: ['receipt', 'Load economics'],
    settings: ['sliders', 'Trip settings'], note: ['note', 'Driver note'], stops: ['fuel', 'Truck stops & fuel along the route'], send: ['share', 'Send route to driver'], ifta: ['receipt', 'IFTA estimate'], full: ['print', 'Full trip report'] };
  function openReport(id) {
    if (!state.lastResult) { toast('Run a trip first'); return; }
    if (id === 'print') id = 'full';
    if (!REPORTS[id]) id = 'legs';
    if (!can(id)) { id = Object.keys(REPORTS).filter(can)[0]; if (!id) return; }
    state.report = id;
    $('#drawerIcon').innerHTML = ICON(REPORTS[id][0]);
    $('#drawerTitle').textContent = REPORTS[id][1];
    showReport();
    var dr = $('#detailsDrawer'), was = dr.classList.contains('hidden');
    dr.classList.remove('hidden');
    $('#resDetails').scrollTop = 0;
    $$('#reportGrid .rb').forEach(function (b) { b.classList.toggle('on', b.dataset.report === id); b.setAttribute('aria-pressed', b.dataset.report === id ? 'true' : 'false'); });
    if ((id === 'stops' || id === 'full') && F.loadStopsAlong) F.loadStopsAlong();
    if ((id === 'ifta' || id === 'full') && F.loadIfta) F.loadIfta();
    if ((id === 'send' || id === 'full') && F.renderSend) F.renderSend();
    if (was) fitRoute();
  }
  /** Show the chosen report; "full" shows every report one after another (that is also what Print prints). */
  function showReport() {
    var full = state.report === 'full';
    $('#resDetails').classList.toggle('full', full);
    $$('#resDetails .rep').forEach(function (sec) { sec.classList.toggle('hidden', !can(sec.dataset.rep) || (!full && sec.dataset.rep !== state.report)); });
  }
  /** Older API name: open the report panel (tandem section -> Tandem rules report). */
  function openDetails(sectionId) { openReport(sectionId === 'tandemSection' ? 'tandem' : sectionId === 'noticeSection' ? 'tolls' : sectionId || 'legs'); }
  function closeDetails() {
    var was = !$('#detailsDrawer').classList.contains('hidden');
    $('#detailsDrawer').classList.add('hidden');
    $$('#reportGrid .rb').forEach(function (b) { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); });
    if (was && state.lastResult) fitRoute();
  }
  function row3(a, b, c) { return '<tr><td>' + a + '</td><td>' + b + '</td><td class="num">' + c + '</td></tr>'; }
  function tripNotes(res) {
    var r = res.route, t = r.totals, hos = res.hos || C.hosEstimate(t.durationSec), out = [];
    var li = function (k, v, warn) { out.push('<li' + (warn ? ' class="warn"' : '') + '><span>' + k + '</span><span>' + v + '</span></li>'); };
    if (res.demo) li('Data', 'Demo mode: synthetic route, not real ' + esc(res.providerLabel) + ' data.', true);
    var traffic = res.request && res.request.effectiveSettings && res.request.effectiveSettings.considerTraffic != null ? res.request.effectiveSettings.considerTraffic : readPrefs().considerTraffic;
    li('Traffic', traffic === false ? 'Not considered' : t.trafficDelaySec > 60 ? C.formatDuration(t.trafficDelaySec) + ' delay included in drive time' : 'No delay on this route');
    var HP = can('hos') && F.hosRun ? F.hosRun(res) : null;
    if (HP) { var lastOff = HP.offs[HP.offs.length - 1], late = HP.stops.filter(function (x) { return x.status === 'late'; }).length;
    li('HOS plan', 'Arrive ' + fmtAt(HP.arriveMs, lastOff) + ' · ' + (HP.totals.restarts ? HP.totals.restarts + ' × 34 h restart, ' : '') + (HP.totals.rests ? HP.totals.rests + ' × 10 h off, ' : '') +
      HP.totals.breaks + ' × 30 min break' + (HP.totals.breaks === 1 ? '' : 's') + (late ? ' · <b>' + late + ' appointment' + (late === 1 ? '' : 's') + ' late</b>' : ''), late > 0); }
    var cur = currentTandem(), ev = cur.mode === 'route' ? cur.ev : T.evaluate({ runs: res.states || [], rules: state.rules, kpraFt: cur.n.kpra, spreadFt: cur.n.spread, trailerLengthFt: cur.n.trailer });
    if (!NON_SEMI[cur.n.type]) {
      if (!ev.loaded) li('Tandems', 'Rules data not loaded — check each state', true);
      else if (ev.settingOk === false) { var al = tandemAlert({ mode: 'route', ev: ev, n: cur.n }); li('Tandems', esc(al.act.text), true); }
      else if (ev.strictest && ev.settingOk) li('Tandems', 'Within every state limit (strictest: ' + esc(ev.strictest.label) + ')');
      else if (ev.strictest) li('Tandems', 'Strictest: ' + esc(ev.strictest.label) + ' — enter your kingpin → tandem setting');
      else if (!ev.unknown.length && !ev.altRules.length) li('Tandems', 'No state KPRA limit on this route — verify local/route restrictions');
      else li('Tandems', 'Check: ' + esc(ev.altRules.map(function (a) { return a.text; }).concat(ev.unknown.length ? ['no/uncertain data for ' + ev.unknown.join(', ')] : []).join(' ')));
    }
    li('Tolls', r.tolls.available === false ? mi(r.tolls.miles || 0, 1) + ' toll mi in ' + (r.tolls.sections || 0) + ' section(s) · <span class="muted">cost not available from ' + esc(res.providerLabel) + ', not in trip cost</span>'
      : r.tolls.total ? (r.tolls.estimated ? '~' + money(r.tolls.total, 0) + ' estimated · ' + mi(r.tolls.miles || 0, 1) + ' toll mi' : money(r.tolls.total)) : 'None');
    if (res.reordered) li('Stop order', 'Re-ordered for the best sequence (' + (res.provider === 'tomtom' ? 'TomTom computeBestOrder' : 'HERE Waypoints Sequence') + ')');
    var nn = r.notices.length + (res.warnings || []).length;
    li('Notices', nn ? nn + ' (see the Tolls &amp; warnings report)' : 'None');
    var xdn = F.xdTripNote && F.xdTripNote(res); if (xdn) li('Crossdocks', xdn);
    return '<ul class="plain">' + out.join('') + '</ul>';
  }
  function renderDetails(res) {
    var box = $('#resDetails'), keep = box.scrollTop;
    var r = res.route, c = res.costs, t = r.totals, tk = readTruck(), pl = esc(res.providerLabel || 'provider');
    var noToll = r.tolls.available === false, html = '';
    var sec = function (id, inner) { return '<section class="rep" data-rep="' + id + '"><h5 class="ph">' + esc(REPORTS[id][1]) + '</h5>' + inner + '</section>'; };
    // Legs & schedule
    var hos = res.hos || C.hosEstimate(t.durationSec), dp = isoParts(r.departureTime), ap = isoParts(r.arrivalTime), hp = isoParts(hos.arrivalTime);
    var lg = '<div class="dsec"><h5>Schedule</h5><table class="tbl"><tbody>' +
      row3('Depart', dp ? tzName(r.departureTime) : '', dp ? dp.day + ' ' + dp.time : '–') +
      row3('Arrive, driving only', ap ? tzName(r.arrivalTime) : '', ap ? ap.day + ' ' + ap.time : '–') +
      (can('hos') ? '<tr><td>Arrive with HOS (planner)</td><td id="hosArriveTz"></td><td class="num" id="hosArrive">–</td></tr>' : '') + '</tbody></table></div>';
    lg += '<div class="dsec"><h5>Legs</h5><table class="tbl"><thead><tr><th>Leg</th><th class="n">Miles</th><th class="n">Time</th><th class="n">Arrive</th><th class="n">' + (noToll ? 'Toll mi' : 'Tolls') + '</th><th class="n">Cost</th></tr></thead><tbody>';
    r.legs.forEach(function (l, i) {
      var la = isoParts(l.arrivalTime);
      lg += '<tr><td>' + (i + 1) + '. ' + esc(short(l.from)) + ' → ' + esc(short(l.to)) + '</td><td class="n">' + mi(l.miles, 1) + '</td><td class="n">' + C.formatDuration(l.durationSec) +
        '</td><td class="n">' + (la ? la.day.split(' ')[0] + ' ' + la.time : '–') + '</td><td class="n">' + (noToll ? mi(l.tollMiles || 0, 1) : money(l.tollCost)) + '</td><td class="n">' + money(l.costs.totalCost) + '</td></tr>';
    });
    lg += '</tbody>' + (r.legs.length > 1 ? '<tfoot><tr><td>Total</td><td class="n">' + mi(t.miles, 1) + '</td><td class="n">' + C.formatDuration(t.durationSec) + '</td><td></td><td class="n">' +
      (noToll ? mi(r.tolls.miles || 0, 1) : money(r.tolls.total)) + '</td><td class="n">' + money(c.totalCost) + '</td></tr></tfoot>' : '') + '</table></div>';
    lg += '<div class="dsec" id="hosPlan"></div>';
    lg += '<div class="dsec"><h5>Trip notes</h5>' + tripNotes(res) + '</div>';
    html += sec('legs', lg);
    // State mileage
    var runs = res.states || [], cur = currentTandem(), ev = cur.mode === 'route' ? cur.ev : null, lim = {};
    if (ev && ev.loaded) ev.rows.forEach(function (row) { if (row.limit) lim[row.code] = row; });
    var sm = '<div class="dsec"><table class="tbl"><thead><tr><th>#</th><th>State</th><th class="n">Enters</th><th class="n">Miles</th><th class="n">Share</th><th>KPRA limit</th></tr></thead><tbody>';
    if (!runs.length) sm += '<tr><td colspan="6" class="muted">State mileage not available for this route.</td></tr>';
    runs.forEach(function (s, i) {
      var l = s.code && lim[s.code];
      sm += '<tr' + (l && l.violation ? ' class="act"' : '') + '><td>' + (i + 1) + '</td><td><b>' + esc(s.code || 'non-US') + '</b> <span class="muted">' + esc(s.name || '') + '</span></td><td class="n">' + (s.startMile != null ? (s.startMile < 1 ? 'start' : 'mile ' + mi(s.startMile)) : '') +
        '</td><td class="n">' + mi(s.miles, 1) + '</td><td class="n">' + (t.miles ? Math.round(s.miles / t.miles * 1000) / 10 + '%' : '') + '</td><td>' + (l ? '<span class="' + (l.violation ? 'over' : '') + '">' + T.fmtFt(l.limitFt) + ' to ' + esc(T.POINT_LABEL[l.point]) + '</span>' : '<span class="muted">—</span>') + '</td></tr>';
    });
    var totals = {}; runs.forEach(function (s) { var k = s.code || 'non-US'; totals[k] = (totals[k] || 0) + s.miles; });
    sm += '</tbody></table></div><div class="dsec"><h5>Miles per state (for IFTA-style totals)</h5><table class="tbl"><tbody>' +
      Object.keys(totals).map(function (k) { return row3('<b>' + esc(k) + '</b>', '', mi(totals[k], 1) + ' mi'); }).join('') +
      '</tbody><tfoot>' + row3('Total', '', mi(t.miles, 1) + ' mi') + '</tfoot></table><div class="tdisc">State miles come from the route geometry and are estimates; verify against your IFTA records.</div></div>';
    html += sec('states', sm);
    // Tandem rules
    html += sec('tandem', '<div class="truck"><svg id="truckSvg" viewBox="0 0 470 118" aria-label="Truck diagram"></svg></div><div class="dsec trules" id="tandemSection"></div>');
    // Directions
    var dr = '<div class="dsec">';
    if (!r.instructions.length) dr += '<div class="muted">No turn-by-turn instructions returned.</div>';
    else {
      dr += '<ol class="directions">';
      var lastLeg = -1;
      r.instructions.forEach(function (ins) {
        if (ins.leg !== lastLeg) { lastLeg = ins.leg; var L1 = r.legs[ins.leg] || {}; dr += '<li class="leg-head">Leg ' + (ins.leg + 1) + ': ' + esc(short(L1.from)) + ' → ' + esc(short(L1.to)) + '</li>'; }
        dr += '<li' + (ins.location ? ' data-lat="' + ins.location[0] + '" data-lng="' + ins.location[1] + '"' : '') + '>' + esc(ins.text) +
          (ins.lengthMeters ? ' <small class="muted">(' + fmtMiles(C.metersToMiles(ins.lengthMeters)) + ')</small>' : '') + '</li>';
      });
      dr += '</ol><div class="tdisc">Click a step to show it on the map.</div>';
    }
    html += sec('directions', dr + '</div>');
    // Tolls & warnings
    var tw;
    if (!noToll && r.tolls.estimated && r.tolls.items.some(function (x) { return x.road; })) {
      tw = '<div class="dsec"><h5>Tolls (estimate, ' + (r.tolls.axles || 5) + ' axles)</h5><table class="tbl tolls"><thead><tr><th>Toll road</th><th>State</th><th class="n">Miles</th><th class="n">Rate/mi</th><th class="n">Est.</th></tr></thead><tbody>';
      r.tolls.items.forEach(function (ti) {
        var src = (ti.sources || [])[0];
        tw += '<tr title="' + esc((ti.confidence ? ti.confidence + ' rate' : '') + (src ? ' · ' + src : '')) + '"><td>' + (r.legs.length > 1 ? 'Leg ' + ((ti.leg || 0) + 1) + ': ' : '') + esc(ti.road) +
          '</td><td>' + esc(ti.state || '–') + '</td><td class="n">' + mi(ti.miles, 1) + '</td><td class="n">' + (ti.basis === 'flat' ? 'flat' : '$' + (+ti.ratePerMile).toFixed(3)) + '</td><td class="n">' + money(ti.est) + '</td></tr>';
      });
      tw += '</tbody><tfoot><tr><td>Total</td><td></td><td class="n">' + mi(r.tolls.items.reduce(function (s2, x) { return s2 + (x.miles || 0); }, 0), 1) + '</td><td></td><td class="n">~' + money(r.tolls.total) + '</td></tr></tfoot></table>' +
        '<div class="tdisc">Estimate only: TomTom toll sections priced at average 5-axle per-mile rates (electronic tag) from each agency\'s published schedule, scaled for axle count. Cash / toll-by-plate, time of day, exact exits and tag state may differ. Rates checked ' + esc(r.tolls.ratesChecked || '') + '.</div></div>';
    } else {
      tw = '<div class="dsec"><h5>Tolls</h5><table class="tbl"><tbody>' +
        (noToll ? row3('Toll roads', mi(r.tolls.miles || 0, 1) + ' toll mi in ' + (r.tolls.sections || 0) + ' section(s)', 'n/a') +
          '<tr><td colspan="3" class="muted">Toll cost is not available from ' + pl + ', so it is not in the trip cost.</td></tr>'
          : r.tolls.sections === 0 ? row3('Toll roads', 'None on this route', money(0)) : row3('Toll cost', r.tolls.items.length + ' item(s)' + (r.tolls.estimated ? ', estimated' : ''), money(r.tolls.total)));
      r.tolls.items.forEach(function (ti) {
        tw += row3('Leg ' + ((ti.leg || 0) + 1) + ': ' + esc(ti.system), esc((ti.paymentMethods || []).join(', ') || (noToll ? 'payment types not reported' : '')),
          noToll ? fmtMiles(ti.miles) : money(ti.price) + (ti.maxPrice ? '–' + money(ti.maxPrice) : ''));
      });
      tw += '</tbody></table></div>';
    }
    var warn = (res.warnings || []).map(function (w) { return { severity: 'info', title: w, details: [] }; });
    var all = r.notices.concat(warn);
    tw += '<div class="dsec" id="noticeSection"><h5>Restrictions &amp; notices (' + all.length + ')</h5>';
    if (!all.length) tw += '<div class="muted">No truck restriction notices returned for this route.</div>';
    all.forEach(function (n) {
      tw += '<div class="notice ' + esc(n.severity) + '"' + (n.location ? ' data-lat="' + n.location[0] + '" data-lng="' + n.location[1] + '"' : '') + '>' +
        (n.leg != null ? 'Leg ' + (n.leg + 1) + ': ' : '') + esc(n.title) + (n.details && n.details.length ? '<small>' + n.details.map(esc).join('<br>') + '</small>' : '') + '</div>';
    });
    tw += '</div><div class="dsec"><details><summary>Request details</summary><pre class="req">' + esc(JSON.stringify(res.request, null, 2)) + '</pre></details></div>';
    html += sec('tolls', tw);
    // Costs
    var co = '<div class="dsec"><table class="tbl"><tbody>' +
      row3('Fuel', c.gallons + ' gal × ' + money(+tk.fuelPrice || 0) + '/gal', money(c.fuelCost)) +
      row3('Per mile', mi(c.miles, 1) + ' mi × ' + money(+tk.costPerMile || 0), money(c.mileageCost)) +
      row3('Per hour', c.hours + ' h × ' + money(+tk.costPerHour || 0), money(c.hourlyCost)) +
      (noToll ? row3('Tolls', 'not available from ' + pl, 'not incl.') : r.tolls.sections === 0 ? row3('Tolls', 'no toll roads', money(0)) : row3('Tolls', r.tolls.items.length + ' item(s)' + (r.tolls.estimated ? ', estimate (' + mi(r.tolls.miles || 0, 1) + ' toll mi)' : ''), money(r.tolls.total))) +
      '</tbody><tfoot>' + row3('Trip cost', money(c.totalPerMile) + '/mi', money(c.totalCost));
    if (res.economics) {
      var ec = res.economics;
      co += row3('Load rate', '', money(ec.revenue));
      if (ec.ratePerLoadedMile != null) co += row3('Deadhead', mi(ec.deadheadMiles, 1) + ' empty mi (leg 1) · ' + mi(ec.loadedMiles, 1) + ' loaded mi', money(ec.ratePerLoadedMile) + '/loaded mi');
      co += row3('Net profit', ec.margin + '% margin · ' + money(ec.ratePerMile) + ' rate/mi all miles · ' + money(ec.profitPerMile) + ' profit/mi', money(ec.profit));
    }
    co += '</tfoot></table>' + (res.economics ? '' : '<div class="tdisc">Enter a load rate in Truck &amp; Settings → Costs to see profit.</div>') + '</div>';
    co = econCells(res) + co;
    html += sec('costs', co);
    html += sec('settings', settingsReport(res));
    html += sec('stops', '<div class="dsec" id="stopsAlong"><div class="muted">Open this report to find truck stops and fuel along the route.</div></div>');
    html += sec('send', '<div class="dsec" id="sendRep"></div>');
    html += sec('ifta', '<div class="dsec" id="iftaRep">' + (F.iftaHtml ? F.iftaHtml(res) : '') + '</div>');
    // Driver note
    html += sec('note', '<div class="dsec"><div class="tnote big" id="driverNoteRep"></div><div class="dact"><button type="button" class="btn gry sm" data-copy><i class="ic-note"></i>Copy driver note</button></div>' +
      '<div class="tdisc">Plain text for the driver: route states and the tandem setting to use. Verify posted signs and current state rules.</div></div>');
    box.innerHTML = html;
    $$('[data-lat]', box).forEach(function (el) { el.addEventListener('click', function () { state.map.setView([+el.dataset.lat, +el.dataset.lng], 14); }); });
    $$('[data-copy]', box).forEach(function (b) { b.onclick = copyNote; });
    $$('i.ic-note', box).forEach(function (el) { el.outerHTML = ICON('note'); });
    renderTandemSection();
    if (F.renderHos) F.renderHos();
    if ((state.report === 'send' || state.report === 'full') && F.renderSend) F.renderSend();
    drawTruck(currentTandem());
    showReport();
    box.scrollTop = keep;
    if (F.stopsRerender) F.stopsRerender(res);
  }
  // ---------- HOS planner + appointment times (public/js/hos.js) ----------
  function hosPrefs() { var d = { used: 0, cycle: 70, dwell: 60 }; try { return Object.assign(d, JSON.parse(localStorage.getItem('zr.hos') || '{}')); } catch (e) { return d; } }
  function apptStore() { try { return JSON.parse(localStorage.getItem('zr.appts') || '{}'); } catch (e) { return {}; } }
  function offStr(off) { var a = Math.abs(off); return (off < 0 ? '-' : '+') + ('0' + Math.floor(a / 60)).slice(-2) + ':' + ('0' + a % 60).slice(-2); }
  function msIso(ms, off) { return window.ZRHos.msToLocal(ms, off) + ':00' + offStr(off); }
  function fmtAt(ms, off) { var iso = msIso(ms, off), p = isoParts(iso); return p.day + ' ' + p.time + ' ' + tzName(iso); }
  function apptKey(i, leg) { return (i + 1) + '|' + (leg.to || ''); }
  // HOS planner: js/feat/hos.js
  // truck stops, EIA diesel, rest areas: js/feat/stops.js
  // IFTA estimate: js/feat/ifta.js
  function renderTandemSection() {
    var box = $('#tandemSection'); if (!box || !state.lastResult) return;
    var res = state.lastResult, n = truckNums();
    var ev = T.evaluate({ runs: res.states || [], rules: state.rules, kpraFt: n.kpra, spreadFt: n.spread, trailerLengthFt: n.trailer });
    state.lastNote = ev.driverNote;
    var h = '';
    if (NON_SEMI[n.type]) h += '<div class="tok">KPRA (kingpin → rear tandem) rules apply to semitrailers; the selected truck type has no semitrailer.</div>';
    if (!ev.loaded) {
      var info = state.rulesInfo || {};
      h += '<div class="tact">Tandem rules data not loaded. ' + esc(info.error || (res.tandem && res.tandem.dataError) || '') + ' No state limits are shown; check each state’s KPRA rule before dispatch.</div>';
    } else {
      var fixes = ev.actions.filter(function (a) { return n.kpra == null || a.centerLimitFt < n.kpra - 1e-9; });
      if (ev.settingOk === false || (n.kpra == null && fixes.length)) fixes.forEach(function (a) { h += '<div class="tact">' + esc(a.text) + '</div>'; });
      else if (ev.strictest && ev.settingOk) h += '<div class="tok">Your setting ' + T.fmtFt(n.kpra) + ' kingpin → tandem center is within every state limit on this route. Strictest: ' + esc(ev.strictest.label) + '.</div>';
      else if (!ev.strictest && !ev.unknown.length && !ev.altRules.length) h += '<div class="tok">No state KPRA limit on this route' + (n.trailer ? ' for ' + T.fmtFt(n.trailer) + ' trailers' : '') + '. Verify local/route restrictions.</div>';
      ev.altRules.forEach(function (a) { h += '<div class="tok">' + esc(a.text) + '</div>'; });
      h += '<table class="tbl"><thead><tr><th>State</th><th>Enters</th><th>KPRA limit</th><th>Measured to</th><th>Notes</th><th>Source</th></tr></thead><tbody>';
      ev.rows.forEach(function (row) {
        var rule = row.rule, lim;
        if (row.status === 'limit') {
          lim = '<span class="' + (row.violation ? 'over' : '') + '">' + T.fmtFt(row.limitFt) + (row.violation ? ' · over' : '') + '</span>' + (row.point === 'rearmost' ? '<br><small>= ≤' + T.fmtFt(row.centerLimitFt, 'floor') + ' to tandem center</small>' : '');
          row.others.forEach(function (o) { lim += '<br><small>' + (o.applies === false ? 'n/a here: ' : 'also: ') + T.fmtFt(o.limitFt) + (o.appliesTo ? ' (' + esc(o.appliesTo) + ')' : '') + '</small>'; });
        } else if (row.status === 'none') lim = 'No limit';
        else if (row.status === 'altrule') lim = 'Special rule<br><small>' + esc(T.fmtFt(rule.altAxleRule.maxFt)) + ' tractor axle → trailer axle</small>';
        else if (row.status === 'unknown') lim = 'Uncertain<br><small>check state</small>';
        else lim = 'No data<br><small>check state</small>';
        var meas = row.status === 'limit' ? esc(T.POINT_LABEL[row.point]) + (row.ambiguous ? '<br><small>statute wording ambiguous — verify</small>' : '') : '<small>' + esc((rule && rule.measuredTo) || '—') + '</small>';
        var exc = rule ? [rule.appliesTo ? 'Applies to: ' + esc(rule.appliesTo) : '', rule.exceptions ? 'Exceptions: ' + esc(rule.exceptions) : '', rule.notes ? 'Notes: ' + esc(rule.notes) : ''].filter(Boolean).join('<br>') : '';
        var verify = rule && rule.confidence !== 'verified-official';
        var src = rule ? '<span class="cf' + (verify ? ' verify' : '') + '">' + esc(T.CONFIDENCE[rule.confidence]) + '</span>' +
          (rule.statuteCitation ? '<br><small>' + (rule.sourceUrl ? '<a href="' + esc(rule.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(rule.statuteCitation) + '</a>' : esc(rule.statuteCitation)) + '</small>' : '')
          : '<span class="cf verify">No data · verify</span>';
        h += '<tr class="' + (row.violation ? 'act' : '') + '"><td>' + esc(row.code) + ' <span class="muted">' + esc(row.name) + '</span><br><small>' + mi(row.miles) + ' mi</small></td>' +
          '<td class="num nw">' + (row.startMile < 1 ? 'start' : 'mile ~' + mi(row.startMile)) + '</td><td>' + lim + '</td><td>' + meas + '</td>' +
          '<td>' + (exc ? '<details class="inline"><summary>Details</summary><small>' + exc + '</small></details>' : '<span class="muted">—</span>') + '</td><td>' + src + '</td></tr>';
      });
      h += '</tbody></table>';
      if (ev.trailerWarnings.length) h += '<div class="tdisc">' + ev.trailerWarnings.map(esc).join('<br>') + '</div>';
    }
    h += '<div class="tnote" id="driverNote">' + esc(ev.driverNote) + '</div>';
    h += '<div class="tdisc">Verify before dispatch. ' + esc(ev.disclaimer) + (ev.measurementNote ? ' ' + esc(ev.measurementNote) : '') +
      (ev.lastChecked ? ' Rules data last checked ' + esc(ev.lastChecked) + '.' : '') + ' Your setting is entered as kingpin → center of rear tandem; rearmost-axle states are converted with your tandem spread.</div>';
    box.innerHTML = h;
    var dn = $('#driverNoteRep'); if (dn) dn.textContent = ev.driverNote;
  }
  function copyNote() {
    if (!state.lastResult) { toast('Run a trip first'); return; }
    renderTandemSection();
    var res = state.lastResult, r = res.route;
    var head = (res.waypoints || []).map(function (w) { return w.label; }).join(' → ') + ': ' + mi(r.totals.miles, 1) + ' mi, ' + C.formatDuration(r.totals.durationSec) +
      (r.tolls.available === false ? '' : r.tolls.total > 0 ? ', tolls ~' + money(r.tolls.total, 0) + (r.tolls.estimated ? ' (estimate)' : '') : ', no tolls') + '.';
    var text = head + '\n' + state.lastNote;
    var done = function () { toast('Driver note copied'); };
    var fallback = function () {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { window.prompt('Copy the driver note:', text); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }

  function copyText(text, msg) {
    var done = function () { toast(msg || 'Copied'); };
    var fallback = function () {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { window.prompt('Copy:', text); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }

  // saved trips + Send to Driver live in js/feat/share.js (module "share"); applyTrip and shared-link opening stay here so links always work
  /** Put a saved / shared trip back into the form (geocoded points kept, no new geocoding). */
  function applyTrip(t, run) {
    TRUCK_FIELDS.forEach(function (n) { if (t.truck[n] != null && field(n)) field(n).value = t.truck[n]; });
    PREF_CHECKS.forEach(function (n) { field(n).checked = !!t.prefs[n]; });
    if (t.prefs.routeType) setRouteType(t.prefs.routeType);
    var when = t.prefs.departDate && t.prefs.departTime ? new Date(t.prefs.departDate + 'T' + t.prefs.departTime) : null;
    if (when && when.getTime() > Date.now()) { field('departDate').value = t.prefs.departDate; field('departTime').value = t.prefs.departTime; }
    writeStopList(t.stops); updateAddStop();
    var ap = apptStore(); Object.keys(t.appts).forEach(function (k) { ap[k] = t.appts[k]; });
    try { localStorage.setItem('zr.appts', JSON.stringify(ap)); localStorage.setItem('zr.hos', JSON.stringify(t.hos)); } catch (e) { /* ignore */ }
    $('#preset').value = '';
    saveSettings(); updateSummaries(); onTandemInput();
    showView('plan');
    if (run) runTrip();
  }
  function openFromHash() {
    var t = TRIPS.fromHash(location.hash, TRUCK_FIELDS);
    if (t) { applyTrip(t, true); toast('Trip opened from a shared link'); }
  }

  // ---------- economics ----------
  function recalcEconomics() {
    var res = state.lastResult; if (!res) return;
    var tk = readTruck(), r = res.route;
    var opts = { mpg: tk.mpg, fuelPrice: tk.fuelPrice, costPerMile: tk.costPerMile, costPerHour: tk.costPerHour };
    res.costs = C.computeCosts(Object.assign({ miles: r.totals.miles, seconds: r.totals.durationSec, tollCost: r.tolls.total }, opts));
    r.legs.forEach(function (l) { l.costs = C.computeCosts(Object.assign({ miles: l.miles, seconds: l.durationSec, tollCost: l.tollCost }, opts)); });
    res.economics = C.computeEconomics({ loadRate: tk.loadRate, miles: r.totals.miles, totalCost: res.costs.totalCost, deadheadMiles: deadheadMiles(res, tk) });
    renderSummary(res); renderDetails(res);
  }
  /** Net profit / margin / rate per mile / profit per mile cells at the top of the Load Economics report. */
  /** Empty miles inside the trip: the first leg when "1st leg empty" is chosen and the trip has more than one leg. */
  function deadheadMiles(res, tk) { return (tk || readTruck()).deadhead === 'leg1' && res.route.legs.length > 1 ? res.route.legs[0].miles : 0; }
  function econCells(res) {
    var ec = res.economics, cell = function (label, value, cls) { return '<div><span>' + label + '</span><b class="' + (cls || '') + '">' + value + '</b></div>'; };
    if (!ec) return '<div class="profit">' + cell('Net profit', '—') + cell('Margin', '—') + cell('Rate / mi', '—') + cell('Profit / mi', '—') + '</div>';
    var sign = ec.profit >= 0 ? 'pos' : 'neg';
    var rpm = ec.ratePerLoadedMile != null ? cell('Rate / loaded mi', '$' + ec.ratePerLoadedMile.toFixed(2)) : cell('Rate / mi', '$' + ec.ratePerMile.toFixed(2));
    return '<div class="profit">' + cell('Net profit', money(ec.profit, 0), sign) + cell('Margin', ec.margin + '%') + rpm +
      cell('Profit / mi', (ec.profitPerMile < 0 ? '−$' : '$') + Math.abs(ec.profitPerMile).toFixed(2), sign) + '</div>';
  }
  /** Trip Settings report: the truck, routing preferences and cost inputs this trip was run with. */
  function settingsReport(res) {
    var run = state.runInputs || { truck: readTruck(), prefs: readPrefs(), summary: truckSummary(), vehicle: vehicleText(), prefText: prefSummary() };
    var t = run.truck, p = run.prefs, r = res.route, dp = isoParts(r.departureTime);
    var ft = function (f, i) { return (f || 0) + '′' + (+i ? ' ' + i + '″' : ''); };
    var hz = $('#hazmat'), hzOpt = t.hazmat && hz ? [].slice.call(hz.options).filter(function (o) { return o.value === t.hazmat; })[0] : null;
    var k = ftIn(t.kpraFt, t.kpraIn), sp = ftIn(t.spreadFt, t.spreadIn);
    var av = [['avoidTolls', 'toll roads'], ['avoidFerries', 'ferries'], ['avoidTunnels', 'tunnels'], ['avoidDirtRoads', 'dirt roads']].filter(function (x) { return p[x[0]]; }).map(function (x) { return x[1]; });
    var op = [['reorderStops', 'Re-order stops'], ['seasonalClosures', 'Seasonal closures'], ['avoidSharpTurns', 'Avoid sharp turns']].filter(function (x) { return p[x[0]]; }).map(function (x) { return x[1]; });
    var h = '<div class="dsec"><h5>Truck</h5><table class="tbl"><tbody>' +
      row3('Vehicle', esc(run.vehicle), '') + row3('Profile', esc(run.summary), '') +
      row3('Height · Length · Width', ft(t.heightFt, t.heightIn) + ' · ' + ft(t.lengthFt, t.lengthIn) + ' · ' + ft(t.widthFt, t.widthIn), '') +
      row3('Gross weight', (+t.weightLbs || 0).toLocaleString('en-US') + ' lb', '') + row3('Axles', esc(t.axleCount), '') +
      row3('Hazmat', hzOpt ? esc(hzOpt.textContent) : 'None', '') + row3('Max speed', esc(t.maxSpeedMph) + ' mph', '') +
      row3('Tandems', (k != null ? T.fmtFt(k) + ' kingpin → tandem center' : 'not entered') + (sp != null ? ' · spread ' + T.fmtFt(sp) : '') + (+t.trailerFt ? ' · trailer ' + esc(t.trailerFt) + '′' : ''), '') +
      '</tbody></table></div>';
    h += '<div class="dsec"><h5>Routing</h5><table class="tbl"><tbody>' +
      row3('Depart', dp ? dp.day + ' ' + dp.time + ' ' + tzName(r.departureTime) : '–', '') + row3('Route type', p.routeType === 'short' ? 'Shortest' : 'Fastest', '') +
      row3('Traffic', p.considerTraffic ? 'Considered' : 'Not considered', '') + row3('Avoid', av.length ? av.join(', ') : 'Nothing', '') +
      row3('Options', op.length ? op.join(', ') : 'None', '') + row3('Provider', esc(res.providerLabel || '') + (res.demo ? ' (demo data)' : ''), '') + '</tbody></table>' +
      ((res.warnings || []).length ? '<div class="tdisc">' + res.warnings.map(esc).join('<br>') + '</div>' : '') + '</div>';
    h += '<div class="dsec"><h5>Costs</h5><table class="tbl"><tbody>' +
      row3('Load rate', +t.loadRate ? money(+t.loadRate) : 'not entered', '') + row3('MPG', esc(t.mpg), '') + row3('Fuel', money(+t.fuelPrice || 0) + '/gal · ' + esc(t.fuel), '') +
      row3('Per mile · per hour', money(+t.costPerMile || 0) + ' · ' + money(+t.costPerHour || 0), '') + '</tbody></table>' +
      '<div class="tdisc">Change these in the planning view (Go Back → Truck &amp; Settings), then Run Trip again.</div></div>';
    return h;
  }
  function resetTrip() {
    writeStopList([null, null]);
    Object.keys(TRIP_ONLY).forEach(function (k) { if (field(k)) field(k).value = ''; });
    clearRoute();
    if (state.searchMarker) { state.map.removeLayer(state.searchMarker); state.searchMarker = null; }
    showView('plan');
    $('#resDetails').innerHTML = '';
    showMessage(null); onTandemInput();
    state.map.setView([39.5, -98.35], 5);
  }

  // ---------- boot ----------
  function boot(cfg) {
    state.config = cfg;
    fillSelects(cfg);
    buildPresetSelect('p:dryvan53');
    loadSettings();
    buildWaypointRows();
    initMap();
    initMapSearch();
    var form = $('#tripForm');
    form.addEventListener('submit', runTrip);
    form.addEventListener('change', saveSettings);
    form.addEventListener('input', function (e) {
      var n = e.target.name;
      if (PRESET_KEYS.indexOf(n) >= 0 && $('#preset').value && $('#preset').value.indexOf('p:') === 0) $('#preset').value = '';
      if (TANDEM_FIELDS[n]) onTandemInput();
      if (ECON_FIELDS[n]) debouncedEcon();
    });
    form.addEventListener('change', function (e) { var n = e.target.name; if (TANDEM_FIELDS[n]) onTandemInput(); if (ECON_FIELDS[n]) recalcEconomics(); });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runTrip(e);
      else if (e.key === 'Escape') {
        if (!$('#settingsMenu').classList.contains('hidden')) toggleMenu(false);
        else if (!$('#detailsDrawer').classList.contains('hidden')) closeDetails();
      }
    });
    $('#preset').addEventListener('change', onPresetChange);
    $('#tandemPreview').addEventListener('change', onTandemInput);
    $('#resetBtn').addEventListener('click', resetTrip);
    $('#resetBtn2').addEventListener('click', resetTrip);
    $('#backBtn').addEventListener('click', function () { showView('plan'); });
    $('#setToggle').addEventListener('click', function () { setSettingsOpen($('#setBody').classList.contains('hidden')); });
    $$('#routeTypeSeg button').forEach(function (b) { b.addEventListener('click', function () { setRouteType(b.dataset.v); saveSettings(); updateSummaries(); }); });
    $$('#reportGrid .rb').forEach(function (b) { b.addEventListener('click', function () { openReport(b.dataset.report); }); });
    $('#detailsClose').addEventListener('click', closeDetails);
    $('#copyNoteBtn').addEventListener('click', copyNote);
    $('#printBtn').addEventListener('click', function () { window.print(); });
    document.addEventListener('click', function (e) {
      var go = e.target.closest && e.target.closest('[data-go]');
      if (go) { e.preventDefault(); goSetting(go.dataset.go); toggleMenu(false); }
      else if (!e.target.closest || !e.target.closest('.menuwrap')) toggleMenu(false);
    });
    $('#settingsBtn').addEventListener('click', function () { toggleMenu($('#settingsMenu').classList.contains('hidden')); });
    $('#forgetBtn').addEventListener('click', function () {
      if (!window.confirm('Forget the truck, routing and cost settings saved in this browser? (Saved truck profiles are kept.)')) return;
      [STORE_KEY, OLD_STORE_KEY, UI_KEY, 'truckrouter.ui.v1'].forEach(function (k) { try { localStorage.removeItem(k); } catch (x) { /* ignore */ } });
      window.location.reload();
    });
    setSettingsOpen(!!uiLoad().settingsOpen, false); // default collapsed
    showView('plan');
    form.addEventListener('input', function () { updateSummaries(); });
    form.addEventListener('change', function () { updateSummaries(); });
    applyCapabilities(cfg);
    // provider status
    var st = !cfg.configured ? 'bad' : cfg.keyCheck && cfg.keyCheck.status === 'rejected' ? 'bad' : cfg.demo ? 'demo' : 'ok';
    var line = !cfg.configured ? 'No routing key: routing off' : cfg.demo ? 'Demo mode (' + cfg.providerLabel + ' mock)' : st === 'bad' ? cfg.providerLabel + ' key problem' : cfg.providerLabel + ' truck routing';
    $('#provLine').innerHTML = '<span class="pdot ' + st + '">' + ICON(st === 'ok' ? 'check' : st === 'bad' ? 'warn' : 'info') + '</span>' + esc(line);
    $('#provLine').title = st === 'ok' ? 'Routes and address search from ' + cfg.providerLabel + (cfg.static ? ' (website key, locked to this site)' : ' (API key stays on the server)') : line;
    $('#settingsInfo').textContent = (cfg.configured ? 'Routing: ' + cfg.providerLabel + (cfg.demo ? ' (demo)' : '') + (cfg.static ? ', website key locked to this site.' : ', key on the server.') : 'Routing key not configured.') + ' Truck and cost settings are saved in this browser; load rate is not.';
    if (!cfg.configured) showBanner('<b>Routing API key not configured.</b> Showing OpenStreetMap; address search and truck routing turn on once the site is rebuilt with a TomTom key in config.js.');
    else if (cfg.keyCheck && cfg.keyCheck.status === 'rejected') showBanner('<b>' + esc(cfg.providerLabel) + ' API key problem.</b> ' + esc(cfg.keyCheck.message || '') + ' Check the key and its allowed domains in the TomTom developer portal.');
    else if (cfg.demo) showBanner('<b>Demo mode</b> (' + esc(cfg.providerLabel) + ' mock): routes are synthetic, for UI testing only.');
    onTandemInput();
    loadRules().then(onTandemInput);
    openFromHash();
    initTraffic();
    applyLinkParams();
    booted = true;
    Object.keys(MODS).forEach(function (k) { if (MODS[k].init) MODS[k].init(); });
    window.TruckRouter = { state: state, runTrip: runTrip, setWaypoint: setWaypoint, readTruck: readTruck, readPrefs: readPrefs, renderResult: renderResult,
      currentTandem: currentTandem, openDetails: openDetails, openReport: openReport, closeDetails: closeDetails, copyNote: copyNote, addStopRow: addStopRow,
      readStopList: readStopList, applyReorder: applyReorder, setTab: goSetting, goSetting: goSetting, showView: showView,
      setSettingsOpen: setSettingsOpen, writeStopList: writeStopList, can: can };
  }
  var debouncedEcon = debounce(recalcEconomics, 250);

  // ---------- trip links from the Freight Board: open with the stops filled in ----------
  // ?from=Romeoville, IL&stop=Joliet, IL&to=Dallas, TX&rate=3200&date=2026-10-13&time=14:00&deadhead=leg1&run=1
  // Each place is text (looked up when the trip runs) or "text@lat,lng". Truck and routing settings are left as they are.
  // ?xdock=1 turns the Crossdocks layer on and shows all of them.
  function linkPlace(v) {
    v = String(v || '').trim(); if (!v) return null;
    var m = v.match(/^(.*)@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (m && Math.abs(+m[2]) <= 90 && Math.abs(+m[3]) <= 180) return { label: m[1].trim() || m[2] + ',' + m[3], lat: +m[2], lng: +m[3] };
    return { label: v.slice(0, 200) };
  }
  function applyLinkParams() {
    var q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
    var showXd = q.get('xdock') === '1';
    var from = linkPlace(q.get('from')), to = linkPlace(q.get('to')), stops = q.getAll('stop').map(linkPlace).filter(Boolean);
    if (showXd && can('crossdocks')) setTimeout(function () { if (F.setXdLayer) F.setXdLayer(true, true); }, 0); // after the Crossdocks module's init
    if (!from && !to && !stops.length) { if (showXd) cleanUrl(); return; }
    if (stops.length > S.MAX_STOPS) { showMessage('This link has ' + stops.length + ' stops; Z Router takes ' + S.MAX_STOPS + '. The first ' + S.MAX_STOPS + ' were kept.', 'warn'); stops = stops.slice(0, S.MAX_STOPS); }
    writeStopList([from].concat(stops, [to]));
    var rate = String(q.get('rate') || '').replace(/[$,\s]/g, '');
    field('loadRate').value = /^\d+(\.\d+)?$/.test(rate) ? rate : '';
    if (field('deadhead')) field('deadhead').value = q.get('deadhead') === 'leg1' ? 'leg1' : '';
    var d = q.get('date'), t = q.get('time');
    if (/^\d{4}-\d{2}-\d{2}$/.test(d || '') && d >= localISO(new Date())) { field('departDate').value = d; if (/^\d{2}:\d{2}$/.test(t || '')) field('departTime').value = t; }
    updateSummaries();
    cleanUrl(); // applied once: a reload does not re-run it
    if (q.get('run') === '1' && from && to) runTrip();
  }
  function cleanUrl() { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ } }

  function toggleMenu(open) {
    var m = $('#settingsMenu'); if (!m) return;
    m.classList.toggle('hidden', !open); $('#settingsBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  (function drainModules() {
    var q = window.ZRXQ || [];
    window.ZRXQ = { push: function (m) { defineMod(m[0], m[1]); } };
    q.forEach(function (m) { defineMod(m[0], m[1]); });
  })();
  (window.ZRGate ? window.ZRGate.ready : Promise.resolve()).then(function () { return api('/api/config'); }).then(function (cfg) {
    if (!cfg || !cfg.ok) cfg = { configured: false, tiles: 'osm', truckTypes: null, hazmat: [] };
    if (cfg.configured == null) cfg.configured = !!cfg.hereConfigured;
    boot(cfg);
  }).catch(function () { boot({ configured: false, tiles: 'osm', hazmat: [] }); });
})();
