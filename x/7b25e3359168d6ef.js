/* EIA weekly retail on-highway diesel prices by PADD region (public domain, U.S. Energy Information Administration).
 * Source: the public "Gasoline and Diesel Fuel Update" RSS feed (no API key): https://www.eia.gov/petroleum/gasdiesel/includes/gas_diesel_rss.xml
 * Browser + Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZREia = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var RSS_URL = 'https://www.eia.gov/petroleum/gasdiesel/includes/gas_diesel_rss.xml';
  var LABELS = { US: 'U.S.', P1: 'East Coast', P1A: 'New England', P1B: 'Central Atlantic', P1C: 'Lower Atlantic', P2: 'Midwest', P3: 'Gulf Coast',
    P4: 'Rocky Mountain', P5: 'West Coast', P5XCA: 'West Coast less California', CA: 'California' };
  var BY_NAME = {}; Object.keys(LABELS).forEach(function (k) { BY_NAME[LABELS[k].toLowerCase()] = k; });
  var STATE_REGION = {};
  [['P1A', 'CT ME MA NH RI VT'], ['P1B', 'DE DC MD NJ NY PA'], ['P1C', 'FL GA NC SC VA WV'], ['P2', 'IL IN IA KS KY MI MN MO NE ND SD OH OK TN WI'],
    ['P3', 'AL AR LA MS NM TX'], ['P4', 'CO ID MT UT WY'], ['P5XCA', 'AK AZ HI NV OR WA'], ['CA', 'CA']].forEach(function (r) { r[1].split(' ').forEach(function (c) { STATE_REGION[c] = r[0]; }); });

  /** Parse the RSS feed: the "On-Highway Diesel Fuel Retail Price" block of the newest item. */
  function parseRss(xml) {
    var s = String(xml || ''), item = s.split(/<item>/i)[1] || '';
    var dm = item.match(/<title>\s*Data For (\d\d)\/(\d\d)\/(\d\d)\s*<\/title>/i);
    var blk = item.split(/On-Highway Diesel Fuel Retail Price/i)[1];
    if (!dm || !blk) throw new Error('EIA feed: diesel block not found');
    var prices = {}, re = /(\d+\.\d{3})\s*\.+\s*([A-Za-z][A-Za-z .]*?)\s*(?:<br|\]\]>)/g, m;
    while ((m = re.exec(blk))) { var k = BY_NAME[m[2].trim().replace(/\s+/g, ' ').toLowerCase()]; if (k && prices[k] == null) prices[k] = +m[1]; }
    ['US', 'P1A', 'P1B', 'P1C', 'P2', 'P3', 'P4', 'P5XCA', 'CA'].forEach(function (k) { if (!(prices[k] > 1 && prices[k] < 20)) throw new Error('EIA feed: missing ' + k); });
    return { source: 'U.S. Energy Information Administration, weekly retail on-highway diesel (all types, incl. taxes)', url: 'https://www.eia.gov/petroleum/gasdiesel/',
      week: '20' + dm[3] + '-' + dm[1] + '-' + dm[2], prices: prices };
  }
  function regionOf(state) { return STATE_REGION[state] || null; }
  /** { price, region, label } for a state code (falls back to the U.S. average). */
  function priceFor(state, data) {
    var p = (data && data.prices) || {}, r = regionOf(state);
    if (r && p[r] != null) return { price: p[r], region: r, label: LABELS[r] };
    return p.US != null ? { price: p.US, region: 'US', label: LABELS.US } : null;
  }
  /** Mileage-weighted route average from state runs [{code, miles}]. */
  function routeAverage(runs, data) {
    var tot = 0, sum = 0;
    (runs || []).forEach(function (s) { var q = priceFor(s.code, data); if (q && s.miles > 0) { tot += s.miles; sum += s.miles * q.price; } });
    return tot ? Math.round(sum / tot * 1000) / 1000 : (data && data.prices && data.prices.US) || null;
  }
  /** Two-letter state from a US address ("..., Perrysburg, OH 43551"). */
  function stateFromAddress(a) { var m = String(a || '').match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/) || String(a || '').match(/\b([A-Z]{2})\s+\d{5}\b/); return m ? m[1] : null; }
  function weekLabel(week) {
    var m = String(week || '').match(/^(\d{4})-(\d\d)-(\d\d)/); if (!m) return '';
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + +m[3] + ', ' + m[1];
  }
  return { RSS_URL: RSS_URL, LABELS: LABELS, parseRss: parseRss, regionOf: regionOf, priceFor: priceFor, routeAverage: routeAverage, stateFromAddress: stateFromAddress, weekLabel: weekLabel };
});

;
/* Z Router feature module: truck stops, fuel, EIA diesel averages, rest areas. Loaded as a normal script on the desktop app; on the Pages build it is a hash-named file that is
 * fetched only after owner unlock or when the owner enabled the feature for visitors (see public/js/features.js, README). */
(window.ZRXQ = window.ZRXQ || []).push(['stops', function (X) {
  'use strict';
  var state = X.state, $ = X.$, $$ = X.$$, esc = X.esc, field = X.field, saveSettings = X.saveSettings, recalcEconomics = X.recalcEconomics, toast = X.toast, mi = X.mi, can = X.can;
  var EIA = window.ZREia;
  // ---------- truck stops & fuel along the route (TomTom Search Along Route, cached) ----------
  function routeCoords(res) { var all = []; res.route.legs.forEach(function (l) { all = all.concat(l.coordinates || []); }); return all; }
  function routeKeyOf(res) {
    var c = routeCoords(res); if (!c.length) return '';
    return [0, 0.25, 0.5, 0.75, 1].map(function (f) { var p = c[Math.min(c.length - 1, Math.round(f * (c.length - 1)))]; return (+p[0]).toFixed(3) + ',' + (+p[1]).toFixed(3); }).join(';') + '|' + Math.round(res.route.totals.miles || 0);
  }
  var STOPS_TTL = 7 * 864e5;
  function loadStopsAlong() {
    var res = state.lastResult, box = $('#stopsAlong'); if (!res || !box) return;
    var key = routeKeyOf(res); if (!key) { box.innerHTML = '<div class="muted">No route geometry.</div>'; return; }
    if (state.stopsShown && state.stopsShown.key === key) return renderStops(state.stopsShown.items, state.stopsShown.note);
    var lsKey = 'zr.stops.' + key, hit = null;
    try { hit = JSON.parse(localStorage.getItem(lsKey) || 'null'); } catch (e) { hit = null; }
    if (hit && Date.now() - hit.t < STOPS_TTL) { state.stopsShown = { key: key, items: hit.items, note: 'saved list from ' + new Date(hit.t).toLocaleDateString() }; return renderStops(hit.items, state.stopsShown.note); }
    if (state.stopsLoading === key) return;
    state.stopsLoading = key;
    box.innerHTML = '<div class="muted">Searching for truck stops along the route…</div>';
    var c = routeCoords(res), step = Math.max(1, Math.ceil(c.length / 3000));
    var coords = c.filter(function (_, i) { return i % step === 0 || i === c.length - 1; }).map(function (p) { return [+(+p[0]).toFixed(5), +(+p[1]).toFixed(5)]; });
    fetch('/api/stops-along', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coords: coords, totalMiles: res.route.totals.miles }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        state.stopsLoading = null;
        if (state.lastResult !== res) return;
        if (!j.ok) { var b = $('#stopsAlong'); if (b) b.innerHTML = '<div class="warn">' + esc(j.error || 'Search failed') + '</div>'; return; }
        try { localStorage.setItem(lsKey, JSON.stringify({ t: Date.now(), items: j.items })); } catch (e) { /* storage full: fine */ }
        state.stopsShown = { key: key, items: j.items, note: j.cached ? 'cached' : j.calls + ' search call' + (j.calls === 1 ? '' : 's') };
        renderStops(j.items, state.stopsShown.note);
      }).catch(function (e) { state.stopsLoading = null; var b = $('#stopsAlong'); if (b) b.innerHTML = '<div class="warn">Search failed: ' + esc(e.message) + '</div>'; });
  }
  // ---------- EIA weekly diesel averages (/api/diesel) ----------
  function loadDiesel() {
    if (state.dieselP) return state.dieselP;
    state.dieselP = fetch('/api/diesel').then(function (r) { return r.json(); }).then(function (j) { state.diesel = j && j.ok ? j : null; return state.diesel; }, function () { state.diesel = null; return null; });
    return state.dieselP;
  }
  function dieselNote(d) { return 'EIA, week of ' + EIA.weekLabel(d.week); }
  /** "Use EIA price" (Fuel source = EIA weekly avg): set the trip fuel price to the mileage-weighted EIA average of the route's states. */
  function applyEiaFuel(res) {
    if (field('fuelSrc').value !== 'eia' || !res) return;
    loadDiesel().then(function (d) {
      if (!d || state.lastResult !== res) return;
      var avg = EIA.routeAverage(res.states || [], d); if (!avg) return;
      var v = avg.toFixed(2);
      if (field('fuelPrice').value !== v) { field('fuelPrice').value = v; saveSettings(); recalcEconomics(); toast('Fuel price set to EIA avg $' + v + ' (' + dieselNote(d) + ')'); }
    });
  }
  // ---------- rest areas (bundled OSM highway=rest_area / services, data/rest-areas.json) ----------
  function loadRestAreas() {
    if (state.restP) return state.restP;
    state.restP = fetch('data/rest-areas.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { state.restData = j; return j; }, function (e) { state.restData = { error: e.message, rows: [] }; return state.restData; });
    return state.restP;
  }
  function restItem(row) { var c = state.restData.cols, o = {}; c.forEach(function (k, i) { o[k] = row[i]; }); return o; }
  function restParking(o) {
    if (o.hgv === 'no') return 'no truck parking';
    if (o.capHgv) return o.capHgv + ' truck spaces';
    if (o.hgv === 'yes' || o.hgv === 'designated') return 'truck parking';
    return '';
  }
  /** OSM rest areas within ~0.5 mi of the route, with mile markers. */
  function restAlong(res) {
    var D = state.restData; if (!D || !D.rows || !D.rows.length) return [];
    var c = routeCoords(res); if (c.length < 2) return [];
    var step = Math.max(1, Math.ceil(c.length / 4000)), pts = c.filter(function (_, i) { return i % step === 0 || i === c.length - 1; });
    var cm = [0]; for (var i = 1; i < pts.length; i++) cm.push(cm[i - 1] + hmi(pts[i - 1], pts[i]));
    var k = res.route.totals.miles && cm[cm.length - 1] ? res.route.totals.miles / cm[cm.length - 1] : 1;
    var s = 90, w = 180, n = -90, e = -180; pts.forEach(function (p) { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); });
    var out = [], LIM = 0.5 / 69; // ~0.5 mi in degrees latitude
    D.rows.forEach(function (row) {
      var la = row[0], ln = row[1]; if (la < s - 0.02 || la > n + 0.02 || ln < w - 0.03 || ln > e + 0.03) return;
      var cos = Math.cos(la * Math.PI / 180), best = -1, bd = LIM * LIM;
      for (var j = 0; j < pts.length; j++) { var dy = pts[j][0] - la, dx = (pts[j][1] - ln) * cos, d = dy * dy + dx * dx; if (d < bd) { bd = d; best = j; } }
      if (best < 0) return;
      var o = restItem(row);
      var brand = o.kind === 'services' && TRUCK_STOP_RE.test(o.name || '');
      out.push({ id: 'osm:' + la + ',' + ln, name: o.name || (o.kind === 'services' ? 'Service plaza' : 'Rest area'), kind: brand ? 'truck stop' : o.kind === 'services' ? 'service plaza' : 'rest area', lat: la, lng: ln, st: o.st,
        address: (o.ref ? '#' + o.ref + ', ' : '') + o.st, parking: restParking(o), toilets: o.toilets, mile: Math.round(cm[best] * k * 10) / 10, detourSec: null, src: 'osm' });
    });
    return out;
  }
  function hmi(a, b) { var t = Math.PI / 180, dl = (b[0] - a[0]) * t, dg = (b[1] - a[1]) * t, h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dg / 2) * Math.sin(dg / 2); return 7917.5 * Math.asin(Math.min(1, Math.sqrt(h))); }
  var TRUCK_STOP_RE = /pilot|flying j|love'?s|\bta\b|travelcenters|petro\b|speedway|road ranger|ambest|bosselman|sapp|town pump|kenly|iowa 80|little america|buc-ee|travel (center|stop|plaza)|truck ?stop|kwik|sheetz|wawa|fuel/i;
  function stopsFilter() { try { return localStorage.getItem('zr.stopsFilter') || 'all'; } catch (e) { return 'all'; } }
  function isFuel(it) { return it.kind === 'truck stop' || it.kind === 'fuel' || it.kind === 'stop'; }
  function renderStops(items, note) {
    var box = $('#stopsAlong'); if (!box) return;
    var res = state.lastResult;
    if (!state.restData || !state.diesel && !state.dieselTried) {
      state.dieselTried = true;
      Promise.all([loadRestAreas(), loadDiesel()]).then(function () { if (state.lastResult === res) renderStops(items, note); });
      if (!state.restData) { box.innerHTML = '<div class="muted">Loading rest areas…</div>'; return; }
    }
    var osm = restAlong(res);
    // TomTom rest areas near an OSM one are the same place: keep the OSM entry (it has truck parking tags)
    var near = function (a, b) { return Math.abs(a.lat - b.lat) < 0.008 && Math.abs(a.lng - b.lng) < 0.01; };
    var tt = items.filter(function (it) { return !(it.kind === 'rest area' && osm.some(function (o) { return !isFuel(o) && near(o, it); })); });
    // OSM truck stops that TomTom also found: keep the TomTom row (address, detour) and add the OSM truck-parking tag to it
    osm = osm.filter(function (o) {
      if (!isFuel(o)) return true;
      var m = tt.find(function (it) { return isFuel(it) && near(o, it); });
      if (m) { m = Object.assign(m, { parking: m.parking || o.parking }); return false; }
      return true;
    });
    var all = tt.concat(osm).sort(function (a, b) { return a.mile - b.mile; });
    var f = stopsFilter(), shown = all.filter(function (it) { return f === 'all' || (f === 'fuel' ? isFuel(it) : !isFuel(it)); });
    var nFuel = all.filter(isFuel).length, d = state.diesel;
    state.stopsLayer.clearLayers();
    var h = '<div class="chips" role="group" aria-label="Filter">' + [['all', 'All', all.length], ['fuel', 'Fuel', nFuel], ['rest', 'Rest areas', all.length - nFuel]].map(function (c) {
      return '<button type="button" class="chip' + (f === c[0] ? ' on' : '') + '" data-f="' + c[0] + '" aria-pressed="' + (f === c[0]) + '">' + c[1] + ' <span>' + c[2] + '</span></button>';
    }).join('') + '</div>';
    if (d) {
      var seen = {}, regs = [];
      (res.states || []).forEach(function (r) { var q = EIA.priceFor(r.code, d); if (q && !seen[q.region]) { seen[q.region] = 1; regs.push(q); } });
      h += '<div class="eiabar"><b>Avg diesel</b> ' + regs.map(function (q) { return esc(q.label) + ' <b>$' + q.price.toFixed(2) + '</b>'; }).join(' · ') + ' <span class="muted">(' + dieselNote(d) + (d.live ? '' : ', saved copy') + ')</span></div>';
    }
    h += '<table class="tbl stops"><thead><tr><th class="n">Mile</th><th>Stop</th><th>Address / parking</th><th class="n">Avg diesel</th><th class="n">Detour</th></tr></thead><tbody>';
    if (!shown.length) h += '<tr><td colspan="5" class="muted">Nothing found for this filter.</td></tr>';
    shown.forEach(function (it) {
      var fuel = isFuel(it), st = fuel ? (it.st || EIA.stateFromAddress(it.address)) : null, q = fuel && d ? EIA.priceFor(st || stateAtMile(res, it.mile), d) : null, rest = !fuel;
      h += '<tr class="clk" data-lat="' + it.lat + '" data-lng="' + it.lng + '"><td class="n"><b>' + mi(it.mile) + '</b></td><td><b>' + esc(it.name) + '</b> <span class="muted">' + esc(it.kind) + '</span></td><td>' + esc(it.address) +
        (it.parking ? (it.address ? '<br>' : '') + '<span class="park' + (/no truck/.test(it.parking) ? ' nopark' : '') + '">' + esc(it.parking) + '</span>' : '') +
        '</td><td class="n">' + (q ? '~$' + q.price.toFixed(2) + '<div class="muted tiny">' + esc(q.label) + '</div>' : '<span class="muted">—</span>') +
        '</td><td class="n">' + (it.detourSec != null ? Math.max(1, Math.round(it.detourSec / 60)) + ' min' : it.src === 'osm' ? 'near route' : '–') + '</td></tr>';
      var tip = '<b>' + esc(it.name) + '</b><br>Mile ' + mi(it.mile) + (q ? ' · avg diesel ~$' + q.price.toFixed(2) : '') + (it.parking ? '<br>' + esc(it.parking) : '');
      L.marker([it.lat, it.lng], { pane: 'markerPane', icon: L.divIcon({ className: '', html: '<div class="fuel-marker' + (rest ? ' rest' : '') + '">' + ICON(rest ? 'bed' : 'fuel') + '</div>', iconSize: [20, 20], iconAnchor: [10, 10] }) })
        .bindTooltip(tip).bindPopup(tip + (it.address ? '<br>' + esc(it.address) : '') + (it.phone ? '<br>' + esc(it.phone) : '')).addTo(state.stopsLayer);
    });
    box.innerHTML = h + '</tbody></table><div class="tdisc">' + items.length + ' truck stops / fuel from TomTom search within a 5-min detour (' + esc(note || '') + '); ' + osm.length +
      ' rest areas and service plazas from OpenStreetMap (bundled; truck parking where tagged). Mile = distance from the start along the route.' +
      (d ? ' Diesel prices are EIA weekly regional averages including taxes, not the price at that station.' : '') + ' Check parking and services before you go.</div>';
    $$('[data-lat]', box).forEach(function (el) { el.addEventListener('click', function () { state.map.setView([+el.dataset.lat, +el.dataset.lng], 14); }); });
    $$('.chip', box).forEach(function (b) { b.addEventListener('click', function () { try { localStorage.setItem('zr.stopsFilter', b.dataset.f); } catch (e) { /* ignore */ } renderStops(items, note); }); });
  }
  function stateAtMile(res, m) { var r = (res.states || []).find(function (x) { return m >= x.startMile - 0.5 && m <= x.endMile + 0.5; }); return r ? r.code : null; }
  // rest areas map layer (toggle next to Tolls); markers only at zoom >= 7, redrawn on move
  function drawRestLayer() {
    if (!state.restLayer) return;
    state.restLayer.clearLayers();
    if (!state.restOn || !state.restData || !state.restData.rows) return;
    if (state.map.getZoom() < 7) return;
    var b = state.map.getBounds().pad(0.1), n = 0;
    state.restData.rows.forEach(function (row) {
      if (n > 800 || !b.contains([row[0], row[1]])) return; n++;
      var o = restItem(row), p = restParking(o), nm = o.name || (o.kind === 'services' ? 'Service plaza' : 'Rest area');
      L.marker([row[0], row[1]], { pane: 'markerPane', icon: L.divIcon({ className: '', html: '<div class="ra-marker' + (o.kind === 'services' ? ' sv' : '') + (/no truck/.test(p) ? ' np' : '') + '">' + ICON('bed') + '</div>', iconSize: [16, 16], iconAnchor: [8, 8] }) })
        .bindTooltip('<b>' + esc(nm) + '</b>' + (p ? '<br>' + esc(p) : '') + (o.toilets ? '<br>toilets' : '')).addTo(state.restLayer);
    });
  }
  function setRestLayer(on) {
    state.restOn = !!on;
    try { localStorage.setItem('zr.restLayer', on ? '1' : '0'); } catch (e) { /* ignore */ }
    var b = $('#restLayerBtn'); if (b) { b.classList.toggle('on', state.restOn); b.setAttribute('aria-pressed', state.restOn ? 'true' : 'false'); }
    if (!on) { drawRestLayer(); return; }
    loadRestAreas().then(function () { drawRestLayer(); if (state.map.getZoom() < 7) toast('Zoom in to see rest areas'); });
  }
  X.F.applyEiaFuel = applyEiaFuel; X.F.loadStopsAlong = loadStopsAlong; X.F.drawRestLayer = drawRestLayer; X.F.setRestLayer = setRestLayer;
  /** After the report panel is rebuilt: draw the cached stops list again. */
  X.F.stopsRerender = function (res) { if (state.stopsShown && state.stopsShown.key === routeKeyOf(res)) renderStops(state.stopsShown.items, state.stopsShown.note); };
  return { init: function () {
    var rb = $('#restLayerBtn');
    if (rb) { rb.addEventListener('click', function () { setRestLayer(!state.restOn); }); var ron = false; try { ron = localStorage.getItem('zr.restLayer') === '1'; } catch (e) { /* ignore */ } if (ron && can('stops')) setRestLayer(true); }
  } };
}]);
