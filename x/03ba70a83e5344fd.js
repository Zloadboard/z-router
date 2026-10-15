/* Z Router feature module: Crossdocks map layer (partner list from the Freight Board's Crossdock section). Loaded as a normal script on the desktop app; on the Pages
 * build it is a hash-named file that is NOT linked in index.html and is fetched only after owner unlock (or when features.json turns `crossdocks` on for visitors). */
(window.ZRXQ = window.ZRXQ || []).push(['crossdocks', function (X) {
  'use strict';
  var state = X.state, $ = X.$, esc = X.esc, mi = X.mi, toast = X.toast, can = X.can, api = X.api, bindPopupButtons = X.bindPopupButtons;
  // ---------- Crossdocks layer: the partner list from the Freight Board's Crossdock section ----------
  // Same website as the Freight Board, so its saved list (synced through the Google Sheet) is readable here.
  // Addresses are looked up once (TomTom search) and remembered in this browser.
  var XD_KEY = 'fcbv2_xdrop_partners', XD_GEO_KEY = 'zr.xdockGeo.v2'; // v2 (0.9.4): points checked against their city
  var xd = { list: [], geo: {}, on: false, busy: false, defaults: null };
  function xdKey(p) { return String(p.addr || p.city || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function xdLoadGeo() { try { xd.geo = JSON.parse(localStorage.getItem(XD_GEO_KEY) || '{}') || {}; } catch (e) { xd.geo = {}; } }
  function xdSaveGeo() { try { localStorage.setItem(XD_GEO_KEY, JSON.stringify(xd.geo)); } catch (e) { /* ignore */ } }
  function xdReadList() {
    var list = null;
    try { var raw = localStorage.getItem(XD_KEY); if (raw) list = JSON.parse(raw); } catch (e) { list = null; }
    if (Array.isArray(list)) return Promise.resolve({ list: list, from: 'board' });
    if (xd.defaults) return Promise.resolve({ list: xd.defaults, from: 'default' });
    return fetch('data/crossdocks-default.json?v=' + encodeURIComponent((($('#verTxt') || {}).textContent || '').replace(/^v/, ''))).then(function (r) { return r.json(); })
      .then(function (j) { xd.defaults = Array.isArray(j) ? j : []; return { list: xd.defaults, from: 'default' }; })
      .catch(function () { return { list: [], from: 'none' }; });
  }
  /* v0.9.4: 0.9.3 took the first hit of a general search, which can be a business with a similar name far away
   * (Sturtevant, WI "11201 Enterprise Way" landed off). Now: find the CITY first, then search only street
   * addresses near it, and keep the address point only if it is within 35 mi of that city; otherwise use the city. */
  function xdCityText(p) {
    var c = String(p.city || '').replace(/\(.*?\)/g, '').trim();
    if (!/,\s*[A-Z]{2}\b/.test(c)) { var m = String(p.addr || '').match(/([A-Za-z .'-]+),\s*([A-Z]{2})\b(?:\s+\d{5})?\s*$/); if (m) c = m[1].trim() + ', ' + m[2]; }
    return c;
  }
  function xdLookup(q, idx, at) {
    return api('/api/geocode?q=' + encodeURIComponent(q) + (idx ? '&idx=' + idx : '') + (at ? '&at=' + at.lat.toFixed(4) + ',' + at.lng.toFixed(4) : ''))
      .then(function (j) { return j && j.ok && j.item ? j.item : null; }, function () { return null; });
  }
  function xdMiles(a, b) {
    var R = 3958.8, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dg = (b.lng - a.lng) * r;
    var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dg / 2) * Math.sin(dg / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function xdGeocode(p) {
    var cityQ = xdCityText(p), addrQ = String(p.addr || '').trim();
    var cityP = cityQ ? xdLookup(cityQ, 'Geo').then(function (c) { return c || xdLookup(cityQ, ''); }) : Promise.resolve(null);
    return cityP.then(function (c) {
      if (!addrQ || addrQ.toLowerCase() === cityQ.toLowerCase()) return c ? { lat: c.lat, lng: c.lng, approx: false, check: 'city' } : null;
      // strip a leading company name ("Rick Cargo, 300 Brogdon Rd ...") so the street search sees the address
      var street = addrQ.replace(/^[^,\d]*[A-Za-z][^,\d]*,\s*(?=\d)/, '');
      return xdLookup(street, 'PAD,Addr,Str', c).then(function (a) {
        if (a && (!c || xdMiles(a, c) <= 35)) return { lat: a.lat, lng: a.lng, approx: false, check: c ? Math.round(xdMiles(a, c)) + ' mi from city' : 'no city' };
        if (c) return { lat: c.lat, lng: c.lng, approx: true, check: a ? 'address hit was ' + Math.round(xdMiles(a, c)) + ' mi away; city used' : 'address not found; city used' };
        return a ? { lat: a.lat, lng: a.lng, approx: false, check: 'no city check' } : null;
      });
    });
  }
  /** Look up the partners that have no map point yet, one at a time. */
  function xdLocateMissing() {
    if (xd.busy) return; var todo = xd.list.filter(function (p) { var g = xd.geo[xdKey(p)]; return xdKey(p) && !(g && (isFinite(g.lat) || g.failedAt > Date.now() - 864e5)); });
    if (!todo.length) return;
    xd.busy = true;
    var i = 0, next = function () {
      if (i >= todo.length) { xd.busy = false; xdSaveGeo(); xdDraw(); return; }
      var p = todo[i++];
      xdGeocode(p).then(function (g) { xd.geo[xdKey(p)] = g ? { lat: g.lat, lng: g.lng, approx: g.approx, check: g.check, at: Date.now() } : { failedAt: Date.now() }; if (i % 5 === 0) { xdSaveGeo(); xdDraw(); } setTimeout(next, 150); });
    };
    next();
  }
  function xdPoints() {
    return xd.list.map(function (p) { var g = xd.geo[xdKey(p)]; return g && isFinite(g.lat) ? { p: p, lat: g.lat, lng: g.lng, approx: !!g.approx } : null; }).filter(Boolean);
  }
  function xdPopup(x, off) {
    var p = x.p;
    return '<div class="xdpop"><b>' + esc(p.city || 'Crossdock') + '</b>' + (x.approx ? ' <span class="muted tiny">(city only, address not found)</span>' : '') +
      (p.addr ? '<br>' + esc(p.addr) : '') + (p.contact ? '<br>' + esc(p.contact) : '') + (p.price ? '<br><span class="xdprice">' + esc(p.price) + '</span>' : '') +
      (off ? '<br><span class="muted">' + esc(off) + '</span>' : '') +
      '<br><button data-act="start">Set as Start</button><button data-act="stop">Add as Stop</button><button data-act="end">Set as End</button></div>';
  }
  function xdDraw() {
    if (!state.xdLayer) return;
    state.xdLayer.clearLayers();
    if (!xd.on) return;
    var near = state.lastResult ? xdNearRoute(state.lastResult, 1e9) : null, byKey = {};
    (near || []).forEach(function (n) { byKey[xdKey(n.x.p)] = n; });
    xdPoints().forEach(function (x) {
      var n = byKey[xdKey(x.p)], off = n ? (n.offMi < 1 ? 'on the route' : mi(n.offMi) + ' mi off the route') + ' at mile ~' + mi(n.mile) : '';
      var item = { label: (x.p.addr || x.p.city), lat: x.lat, lng: x.lng };
      var m = L.marker([x.lat, x.lng], { pane: 'markerPane', title: x.p.city || '', icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11],
        html: '<div class="xd-marker' + (n && n.offMi <= 25 ? ' near' : '') + '">X</div>' }) })
        .bindTooltip('<b>' + esc(x.p.city || 'Crossdock') + '</b>' + (x.p.price ? '<br>' + esc(x.p.price) : '') + (off ? '<br>' + esc(off) : ''))
        .bindPopup(xdPopup(x, off));
      m.on('popupopen', function (ev) { bindPopupButtons(ev.popup.getElement(), item); });
      m.addTo(state.xdLayer);
    });
  }
  /** Crossdocks by distance from the route line; mile = where along the route they are closest. */
  function xdNearRoute(res, maxMi) {
    var pts = []; (res.route.legs || []).forEach(function (l) { (l.coordinates || []).forEach(function (c) { pts.push(c); }); });
    if (pts.length < 2) return [];
    var R = 3958.8, rad = Math.PI / 180, hav = function (a, b) {
      var dl = (b[0] - a[0]) * rad, dg = (b[1] - a[1]) * rad, h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dg / 2) * Math.sin(dg / 2);
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    };
    var cum = [0]; for (var k = 1; k < pts.length; k++) cum.push(cum[k - 1] + hav(pts[k - 1], pts[k]));
    var scale = res.route.totals.miles && cum[cum.length - 1] ? res.route.totals.miles / cum[cum.length - 1] : 1;
    var stepN = Math.max(1, Math.floor(pts.length / 4000));
    return xdPoints().map(function (x) {
      var best = Infinity, at = 0;
      for (var i = 0; i < pts.length; i += stepN) { var d = hav([x.lat, x.lng], pts[i]); if (d < best) { best = d; at = cum[i]; } }
      return { x: x, offMi: best, mile: at * scale };
    }).filter(function (n) { return n.offMi <= maxMi; }).sort(function (a, b) { return a.mile - b.mile; });
  }
  function setXdLayer(on, fit) {
    xd.on = !!on;
    try { localStorage.setItem('zr.xdLayer', on ? '1' : '0'); } catch (e) { /* ignore */ }
    var b = $('#xdLayerBtn'); if (b) { b.classList.toggle('on', xd.on); b.setAttribute('aria-pressed', xd.on ? 'true' : 'false'); }
    if (!on) { xdDraw(); return; }
    xdRefresh().then(function () {
      xdDraw();
      var pts = xdPoints();
      if (fit && pts.length) state.map.fitBounds(L.latLngBounds(pts.map(function (x) { return [x.lat, x.lng]; })), { padding: [60, 60], maxZoom: 8 });
      if (!xd.list.length) toast('No crossdock partners yet: add them in the Freight Board → Crossdock section');
    });
  }
  function xdRefresh() {
    return xdReadList().then(function (r) { xd.list = (r.list || []).filter(function (p) { return p && (p.city || p.addr); }); xd.from = r.from; xdDraw(); xdLocateMissing(); });
  }
  function initCrossdocks() {
    if (!can('crossdocks')) return; // Basic mode: no crossdock layer, button, or lookups
    xdLoadGeo();
    state.xdLayer = L.layerGroup().addTo(state.map);
    var b = $('#xdLayerBtn');
    if (b) b.addEventListener('click', function () { setXdLayer(!xd.on, !xd.on); });
    var on = true; try { on = localStorage.getItem('zr.xdLayer') !== '0'; } catch (e) { /* ignore */ }
    if (on) setXdLayer(true, false);
    // the Freight Board (another tab, or the page around this one) changed the list
    window.addEventListener('storage', function (e) { if (e.key === XD_KEY && xd.on) xdRefresh(); });
  }
  /** Trip notes line: crossdock partners within 25 mi of this route, in route order. */
  function xdTripNote(res) {
    if (!can('crossdocks') || !xd.list.length) return null;
    var near = xdNearRoute(res, 25);
    if (!near.length) return 'None within 25 mi of this route';
    return near.slice(0, 8).map(function (n) { return esc(n.x.p.city) + ' <span class="muted">(mile ~' + mi(n.mile) + (n.offMi >= 1 ? ', ' + mi(n.offMi) + ' mi off' : '') + ')</span>'; }).join(' · ') +
      (near.length > 8 ? ' · +' + (near.length - 8) + ' more' : '');
  }
  X.F.xdDraw = xdDraw; X.F.xdTripNote = xdTripNote; X.F.setXdLayer = setXdLayer;
  return { init: initCrossdocks };
}]);
