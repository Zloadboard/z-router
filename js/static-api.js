/* Z Router static build (GitHub Pages): answers the app's /api/* calls in the browser and calls TomTom directly.
 * Same request builders / parsers / tandem / cost code as the Node server (bundled in js/zr-lib.js).
 * The TomTom key comes from config.js (injected at build time). Lock that key to this site's domain in the
 * TomTom developer portal, because anyone can read it from the page. */
(function () {
  'use strict';
  var R = window.ZRLib.require;
  var tomtom = R('tomtom'), common = R('./common'), calc = R('../public/js/calc'), tandem = R('tandem'), states = R('states'), tolls = R('tolls'), along = R('along');
  var stopsCache = {};
  var KEY = String((window.ZR_CONFIG && window.ZR_CONFIG.tomtomKey) || '').trim();
  var TRUCK_TYPES = [{"id":"semi","label":"Truck Semi"},{"id":"double","label":"Semi w/ Double Trailer"},{"id":"triple","label":"Semi w/ Triple Trailer"},{"id":"bobtail","label":"Bobtail (Tractor only)"},{"id":"straight","label":"Straight Truck"},{"id":"straightTrailer","label":"Straight Truck w/ Trailer"},{"id":"light","label":"Light Truck / Cargo Van"}];
  var TIMEOUT_MS = 30000;
  var LABEL = 'TomTom';
  var KEY_MISSING = 'Routing API key not configured: this static build has no TomTom key in config.js. Rebuild it with TOMTOM_WEB_API_KEY set.';
  var realFetch = window.fetch.bind(window);
  var keyCheck = { status: 'unchecked', message: null }, keyCheckP = null;

  function ProviderError(msg, status, code, details) { var e = new Error(msg); e.status = status; e.code = code; e.details = details; return e; }
  function withTimeout(url, init) {
    var o = { headers: { Accept: 'application/json' } };
    if (init && init.body) { o.method = 'POST'; o.body = init.body; o.headers['Content-Type'] = 'application/json'; }
    if (window.AbortSignal && AbortSignal.timeout) o.signal = AbortSignal.timeout(TIMEOUT_MS);
    return realFetch(url, o);
  }
  function providerGet(baseUrl, params, init) {
    if (!KEY) return Promise.reject(ProviderError(KEY_MISSING, 503, 'API_KEY_MISSING'));
    var q = new URLSearchParams(params); q.set('key', KEY);
    return withTimeout(baseUrl + '?' + q.toString(), init).catch(function (e) {
      throw ProviderError('Could not reach TomTom (' + (e.name === 'TimeoutError' ? 'timeout' : 'network error') + '). If the TomTom key is limited to certain domains, ' + location.hostname + ' must be on its list.', 502, 'PROVIDER_UNREACHABLE');
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = null; try { body = JSON.parse(text); } catch (e) { /* XML / empty */ }
        if (res.ok) return body;
        if (res.status === 403 && body && body.detailedError && body.detailedError.code === 'InsufficientFunds') {
          throw ProviderError('TomTom address search is out of credits on this key, so only built-in city and ZIP lookups work. Type "City, ST" or a ZIP, or add TomTom credits for street addresses.', 502, 'PROVIDER_CREDITS');
        }
        if (res.status === 401 || res.status === 403) {
          throw ProviderError('TomTom rejected the API key (HTTP ' + res.status + '). Check that the key is valid, has this API enabled and allows this website (' + location.origin + ').', 502, 'PROVIDER_AUTH');
        }
        var msg = tomtom.errorMessage(body, text) || 'HTTP ' + res.status;
        if (/NO_ROUTE_FOUND|MAP_MATCHING_FAILURE|COMPUTE_TIME_LIMIT/.test(msg)) {
          var friendly = /MAP_MATCHING_FAILURE/.test(msg) ? 'A stop could not be matched to a drivable road. ' :
            /COMPUTE_TIME_LIMIT/.test(msg) ? 'The route took too long to compute (try Fastest, fewer avoid options, or fewer stops). ' :
            'No truck-legal route was found for these settings. ';
          throw ProviderError(friendly + '(TomTom: ' + msg + ')', 422, 'NO_ROUTE');
        }
        throw ProviderError('TomTom error: ' + msg, res.status === 429 ? 429 : 502, 'PROVIDER_ERROR', body);
      });
    });
  }
  function checkKey() {
    if (!KEY) return Promise.resolve();
    if (!keyCheckP) {
      keyCheck.status = 'checking';
      // one tiny Search request (the Pages key is enabled for Routing + Search only), plus one probe tile:
      // TomTom map tiles are used only if that tile loads; otherwise the free tiles are used, silently.
      var s = tomtom.buildSearchRequest({ q: 'Chicago, IL', typeahead: false, limit: 1 });
      keyCheckP = Promise.all([providerGet(s.url, s.params), probeTiles(), probeTraffic()]).then(function () { keyCheck.status = 'ok'; keyCheck.message = null; })
        .catch(function (e) {
          // Out of Search credits is not a broken key: routing still works and cities/ZIPs come from the built-in list.
          if (e.code === 'PROVIDER_CREDITS') { keyCheck.status = 'ok'; keyCheck.message = null; keyCheck.searchCredits = false; return; }
          keyCheck.status = e.code === 'PROVIDER_AUTH' ? 'rejected' : 'error'; keyCheck.message = e.message;
        });
    }
    return keyCheckP;
  }

  var tomtomTiles = false, trafficTiles = false;
  // The traffic overlay needs the Traffic API ticked on the (domain-locked) web key. Probe one flow tile with an <img> (sends our Referer, no CORS needed).
  function probeTraffic() {
    return new Promise(function (resolve) {
      var im = new Image(), done = false, fin = function (ok) { if (!done) { done = true; trafficTiles = ok; resolve(); } };
      im.onload = function () { fin(true); }; im.onerror = function () { fin(false); }; setTimeout(function () { fin(false); }, 6000);
      im.src = 'https://api.tomtom.com/traffic/map/4/tile/flow/relative/4/4/5.png?tileSize=256&key=' + encodeURIComponent(KEY);
    });
  }
  function probeTiles() {
    var u = 'https://api.tomtom.com/map/1/tile/basic/main/4/4/5.png?tileSize=256&view=Unified&key=' + encodeURIComponent(KEY);
    return realFetch(u).then(function (r) { tomtomTiles = r.ok; }, function () { tomtomTiles = false; });
  }

  // ---------- data files (static) ----------
  var rulesP = null, statesP = null, tollP = null;
  function loadTollRates() {
    if (!tollP) tollP = realFetch('data/toll-rates.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { if (!j || !Array.isArray(j.roads) || !j.axleFactors) throw new Error('bad format'); return j; })
      .catch(function (e) { tollP = null; throw e; });
    return tollP;
  }
  function loadTandemRules() {
    if (!rulesP) rulesP = realFetch('data/tandem-rules.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { var res = tandem.normalizeRules(j); if (res.ok && res.data.fixture) res = { ok: false, data: null, error: 'tandem rules data not loaded (file is a test fixture, not real data)' }; return res; })
      .catch(function (e) { rulesP = null; return { ok: false, data: null, error: 'tandem rules data not loaded (' + e.message + ')' }; });
    return rulesP;
  }
  function loadStates() {
    if (!statesP) statesP = realFetch('data/us-states.geojson').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (gj) { window.__ZR_STATES_GJ = gj; return true; })
      .catch(function (e) { statesP = null; throw e; });
    return statesP;
  }

  // ---------- search ----------
  var places = window.ZRPlaces || null;
  // TomTom Geocoding API: separate free monthly allowance from Search (needs "Geocoding API" ticked on the key).
  // Used when the built-in list has no match and Search cannot answer (out of credits).
  function geocodeApi(q, limit) {
    var url = 'https://api.tomtom.com/search/2/geocode/' + encodeURIComponent(String(q).trim()) + '.json';
    return providerGet(url, { limit: String(limit || 1), countrySet: 'US,CA,MX' }).then(function (j) {
      return ((j && j.results) || []).filter(function (r) { return r.position; }).map(function (r) {
        var a = r.address || {}, label = a.freeformAddress || (a.municipality ? a.municipality + ', ' + (a.countrySubdivisionCode || a.countrySubdivision || '') : String(q));
        return { id: 'geo:' + (r.id || label), title: label, label: label, resultType: r.type, lat: r.position.lat, lng: r.position.lon };
      });
    });
  }
  function tomtomSuggest(q, at) { var r = tomtom.buildSearchRequest({ q: q, at: at }); return providerGet(r.url, r.params).then(tomtom.normalizeSearch); }
  // Cities and ZIPs come from the built-in list first (free, instant); street addresses and no-match go to TomTom.
  function suggest(q, at) {
    if (!places) return tomtomSuggest(q, at);
    return places.suggest(q, at).catch(function () { return null; }).then(function (local) {
      if (local && local.length) return local;
      return tomtomSuggest(q, at).catch(function (e) {
        return geocodeApi(q, 5).catch(function () { if (local) return []; throw e; });
      });
    });
  }
  // typed text without a picked suggestion -> TomTom fuzzy Search (the Pages key has no Geocoding API)
  // opts.idx: TomTom index set (e.g. 'Geo' = cities only, 'PAD,Addr,Str' = street addresses only, no businesses);
  // opts.at: "lat,lng" to search near (v0.9.4, used to place crossdock partners exactly)
  function geocode(q, opts) {
    opts = opts || {};
    if (!places) return tomtomGeocode(q, opts);
    var exact = !!(opts.at || opts.idx); // crossdock pins: try the street address first
    var first = exact ? Promise.resolve(null) : places.lookup(q).catch(function () { return null; });
    return first.then(function (hit) {
      if (hit) return hit;
      return tomtomGeocode(q, opts).catch(function (e) {
        // TomTom cannot answer (no credits, network): fall back to the city in the text, if there is one.
        return geocodeApi(q, 1).then(function (r) { return r[0] ? { label: r[0].label, lat: r[0].lat, lng: r[0].lng } : null; }, function () { return null; })
          .then(function (h) { return h || (exact ? places.lookup(q).catch(function () { return null; }) : null); })
          .then(function (h) { return h || places.cityOf(q).catch(function () { return null; }); })
          .then(function (h) { if (h) return h; throw e; });
      });
    });
  }
  function tomtomGeocode(q, opts) {
    opts = opts || {};
    var s = tomtom.buildSearchRequest({ q: q, typeahead: false, limit: 1, at: opts.at || null });
    if (opts.idx && /^[A-Za-z,]{2,40}$/.test(opts.idx)) s.params.set('idxSet', opts.idx);
    return providerGet(s.url, s.params).then(function (j) { var hit = tomtom.normalizeSearch(j)[0]; return common.plausibleHit(q, hit) ? { label: hit.label, lat: hit.lat, lng: hit.lng } : null; });
  }

  // ---------- route planning (same steps as server.js planTrip / planTomTom) ----------
  function ftIn(ft, inch) {
    var f = parseFloat(ft), i = parseFloat(inch);
    if (!isFinite(f) && !isFinite(i)) return null;
    var v = (isFinite(f) ? f : 0) + (isFinite(i) ? i : 0) / 12;
    return v > 0 ? Math.round(v * 1000) / 1000 : null;
  }
  function resolveWaypoints(list) {
    return Promise.all(list.map(function (w) {
      var label = String(w.label || w.text || '').trim();
      if (common.validLatLng(w)) return { label: label || w.lat + ',' + w.lng, lat: +w.lat, lng: +w.lng, role: w.role };
      var ll = common.parseLatLngText(w.text);
      if (ll) return { label: w.text.trim(), lat: ll.lat, lng: ll.lng, role: w.role };
      if (common.badLatLngText(w.text)) throw new common.InputError('"' + w.text.trim() + '" is not a valid lat,lng (latitude -90..90, longitude -180..180).');
      return geocode(w.text).then(function (g) {
        if (!g) throw new common.InputError('Could not find "' + w.text + '". Pick an address from the suggestions or enter lat,lng.');
        return { label: g.label, lat: g.lat, lng: g.lng, role: w.role };
      });
    }));
  }
  function routeStatesAndTandem(route, truck, warnings) {
    return Promise.all([loadStates().then(function () { return true; }, function (e) { return e; }), loadTandemRules()]).then(function (res) {
      var runs = [];
      try {
        if (res[0] !== true) throw res[0];
        var coords = [];
        route.legs.forEach(function (l) { (l.coordinates || []).forEach(function (c) { coords.push(c); }); });
        runs = states.statesAlong(coords, { totalMiles: route.totals.miles });
      } catch (e) { warnings.push('Could not determine the states on this route (' + e.message + ').'); }
      var rules = res[1];
      var ev = tandem.evaluate({ runs: runs, rules: rules.ok ? rules.data : null, kpraFt: ftIn(truck.kpraFt, truck.kpraIn), spreadFt: ftIn(truck.spreadFt, truck.spreadIn), trailerLengthFt: ftIn(truck.trailerFt, truck.trailerIn) });
      if (!rules.ok) ev.dataError = rules.error;
      return { runs: runs, tandem: ev };
    });
  }
  function costsFor(route, truck) {
    var opts = { mpg: truck.mpg, fuelPrice: truck.fuelPrice, costPerMile: truck.costPerMile, costPerHour: truck.costPerHour };
    var costs = calc.computeCosts(Object.assign({ miles: route.totals.miles, seconds: route.totals.durationSec, tollCost: route.tolls.total }, opts));
    route.legs.forEach(function (l) { l.costs = calc.computeCosts(Object.assign({ miles: l.miles, seconds: l.durationSec, tollCost: l.tollCost }, opts)); });
    return costs;
  }
  function planTomTom(o) {
    var truck = o.truck, prefs = o.prefs, points = o.points, warnings = o.warnings;
    var req = tomtom.buildRouteRequest({ truck: truck, prefs: prefs, points: points });
    return providerGet(req.url, req.params).catch(function (e) {
      if (e.code === 'PROVIDER_ERROR' && req.params.get('departAt') && /depart/i.test(e.message)) {
        warnings.push('TomTom rejected the depart time (' + req.params.get('departAt') + '): ' + e.message.replace(/^TomTom error: /, '') + '. Routed with departure = now.');
        req = tomtom.buildRouteRequest({ truck: truck, prefs: prefs, points: points, departAt: null });
        return providerGet(req.url, req.params);
      }
      throw e;
    }).then(function (json) {
      var order = points.map(function (_, i) { return i; }), reordered = false;
      if (req.params.get('computeBestOrder') === 'true' && json && json.routes && json.routes[0]) {
        var ord = tomtom.resolveOrder(json, points);
        if (ord) { order = ord; reordered = ord.some(function (v, i) { return v !== i; }); }
      }
      var ordered = order.map(function (i) { return points[i]; });
      var route = tomtom.normalizeRoute(json, { waypoints: ordered, prefs: prefs });
      warnings.push.apply(warnings, tomtom.preferenceWarnings(prefs, truck));
      var done = function () {
        if (prefs.avoidTolls && route.tolls.sections) warnings.push('Avoid Toll Roads was on, but TomTom still used toll roads for part of this trip.');
        return { route: route, order: order, reordered: reordered, requestParams: req.params, profile: req.profile, effectiveSettings: route.effectiveSettings };
      };
      if (!route.tolls.sections) return done();
      return Promise.all([loadStates(), loadTollRates()]).then(function (res) {
        tolls.applyToRoute(route, tolls.estimate(route._tollRaw, { rates: res[1], axles: truck.axleCount, stateAt: states.stateAt }), res[1]);
        warnings.push('Tolls are an estimate: ' + route.tolls.sections + ' toll section(s), about ' + route.tolls.miles + ' toll miles, ~$' + Math.round(route.tolls.total) + ' at average per-mile truck rates (tag vs cash may differ).');
      }).catch(function (e) {
        warnings.push('Toll cost not available (toll rates not loaded: ' + e.message + '): route has ' + route.tolls.sections + ' toll section(s), about ' + route.tolls.miles + ' toll miles. Toll cost is not included in the total.');
      }).then(done);
    });
  }
  function planTrip(body) {
    var truck = body.truck || {}, prefs = body.prefs || {};
    var raw = Array.isArray(body.waypoints) ? body.waypoints : [];
    var filled = raw.map(function (w, i) { return Object.assign({}, w, { idx: i }); })
      .filter(function (w) { return (w.text && String(w.text).trim()) || common.validLatLng(w); });
    if (!filled.length || filled[0].role !== 'start') throw new common.InputError('Enter a Start location.');
    if (filled.length < 2 || filled[filled.length - 1].role !== 'end') throw new common.InputError('Enter an End location.');
    if (filled.length > 7) throw new common.InputError('Up to 5 stops plus Start and End are supported.');
    var warnings = [], points, r, costs;
    return resolveWaypoints(filled).then(function (p) {
      points = p;
      if (points.every(function (q) { return common.haversineMeters([q.lat, q.lng], [points[0].lat, points[0].lng]) < 100; })) throw new common.InputError('Start and End are the same place. Enter a different End (or add a stop).');
      if (prefs.reorderStops && points.length < 4) warnings.push('Re-order Stops needs at least 2 intermediate stops; nothing to re-order.');
      return planTomTom({ truck: truck, prefs: prefs, points: points, warnings: warnings });
    }).then(function (res) {
      r = res;
      costs = costsFor(r.route, truck);
      return routeStatesAndTandem(r.route, truck, warnings);
    }).then(function (st) {
      var dhMiles = truck.deadhead === 'leg1' && r.route.legs.length > 1 ? r.route.legs[0].miles : 0;
      var economics = calc.computeEconomics({ loadRate: truck.loadRate, miles: r.route.totals.miles, totalCost: costs.totalCost, deadheadMiles: dhMiles });
      var hos = calc.hosEstimate(r.route.totals.durationSec);
      if (r.route.departureTime) hos.arrivalTime = calc.addSecondsIso(r.route.departureTime, hos.totalSec, r.route.arrivalTime || r.route.departureTime);
      var params = r.requestParams, pobj = {};
      Array.from(new Set(Array.from(params.keys()))).forEach(function (k) { pobj[k] = params.getAll(k).join(' | '); });
      delete r.route.effectiveSettings;
      return {
        ok: true, demo: false, provider: 'tomtom', providerLabel: LABEL,
        waypoints: r.order.map(function (i) { return Object.assign({}, points[i], { originalIndex: filled[i].idx }); }),
        reordered: r.reordered, route: r.route, costs: costs, economics: economics, hos: hos,
        states: st.runs, statesSummary: states.summary(st.runs), tandem: st.tandem, warnings: warnings,
        request: { provider: 'tomtom', truckProfile: r.profile, params: pobj, effectiveSettings: r.effectiveSettings || undefined }
      };
    });
  }

  // ---------- /api/* router ----------
  function reply(status, obj) { return new Response(JSON.stringify(obj), { status: status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
  function fail(e) { return reply(e.status || 500, { ok: false, code: e.code || 'ERROR', error: e.message || 'Unexpected error', details: e.notices || undefined }); }
  function configBody() {
    var ok = !!KEY, tiles = ok && keyCheck.status === 'ok' && tomtomTiles;
    return {
      ok: true, provider: 'tomtom', providerLabel: LABEL, configured: ok, hereConfigured: ok, demo: false, static: true,
      message: ok ? null : KEY_MISSING, keyCheck: keyCheck, capabilities: tomtom.CAPABILITIES,
      tiles: tiles ? 'tomtom' : 'osm', traffic: !!(ok && keyCheck.status === 'ok' && trafficTiles),
      tileViews: tiles ? { map: true, terrain: false, satellite: true, satlabels: true } : { map: false, terrain: false, satellite: false, satlabels: false },
      truckTypes: TRUCK_TYPES, hazmat: calc.HAZMAT.map(function (h) { return { id: h.id, label: h.label }; })
    };
  }
  function handle(url, opts) {
    var u = new URL(url, location.href), p = u.pathname.replace(/^.*?(\/api\/)/, '/api/'), method = ((opts && opts.method) || 'GET').toUpperCase();
    return Promise.resolve().then(function () {
      if (p === '/api/config') return checkKey().then(function () { return reply(200, configBody()); });
      if (p === '/api/tandem-rules') return loadTandemRules().then(function (r) {
        if (!r.ok) return reply(200, { ok: true, loaded: false, error: r.error, disclaimer: tandem.GENERIC_DISCLAIMER, states: {} });
        return reply(200, { ok: true, loaded: true, lastChecked: r.data.lastChecked, disclaimer: r.data.disclaimer || tandem.GENERIC_DISCLAIMER, measurementNote: r.data.measurementNote, fixture: r.data.fixture, states: r.data.states });
      });
      if (p === '/api/autosuggest') {
        var q = (u.searchParams.get('q') || '').trim();
        if (q.length < 2) return reply(200, { ok: true, items: [] });
        if (!KEY) return reply(503, { ok: false, code: 'API_KEY_MISSING', error: KEY_MISSING, items: [] });
        return suggest(q, u.searchParams.get('at')).then(function (items) { return reply(200, { ok: true, items: items }); });
      }
      if (p === '/api/geocode') {
        var g = (u.searchParams.get('q') || '').trim();
        if (!g) throw new common.InputError('Missing q');
        var ll = common.parseLatLngText(g);
        if (ll) return reply(200, { ok: true, item: { label: g, lat: ll.lat, lng: ll.lng } });
        if (!KEY) return reply(503, { ok: false, code: 'API_KEY_MISSING', error: KEY_MISSING });
        return geocode(g, { idx: u.searchParams.get('idx') || '', at: u.searchParams.get('at') || '' }).then(function (item) { return item ? reply(200, { ok: true, item: item }) : reply(404, { ok: false, code: 'NOT_FOUND', error: 'No match for "' + g + '"' }); });
      }
      if (p === '/api/diesel') { // eia.gov sends no CORS headers, so the static site uses the snapshot bundled at build time
        return realFetch('data/eia-diesel.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
          return d && d.prices ? reply(200, Object.assign({ ok: true, live: false }, d)) : reply(503, { ok: false, error: 'EIA diesel prices not available' });
        });
      }
      if (p === '/api/stops-along') {
        if (method !== 'POST') return reply(405, { ok: false, error: 'Use POST' });
        if (!KEY) return reply(503, { ok: false, code: 'API_KEY_MISSING', error: KEY_MISSING });
        var sb = {}; try { sb = JSON.parse((opts && opts.body) || '{}'); } catch (e) { throw new common.InputError('Invalid JSON body'); }
        var coords = Array.isArray(sb.coords) ? sb.coords.filter(function (c) { return Array.isArray(c) && common.validLatLng({ lat: c[0], lng: c[1] }); }).slice(0, 5000) : [];
        if (coords.length < 2) throw new common.InputError('Run a trip first (no route geometry).');
        var sk = along.routeKey(coords, sb.totalMiles);
        if (stopsCache[sk]) return reply(200, { ok: true, items: stopsCache[sk].items, calls: 0, cached: true });
        return along.findAlong(coords, +sb.totalMiles || null, function (u2, params, b) { return providerGet(u2, params, { body: b }); })
          .then(function (r) { stopsCache[sk] = r; return reply(200, { ok: true, items: r.items, calls: r.calls, cached: false }); });
      }
      if (p === '/api/route') {
        if (method !== 'POST') return reply(405, { ok: false, error: 'Use POST' });
        if (!KEY) return reply(503, { ok: false, code: 'API_KEY_MISSING', error: KEY_MISSING });
        var body = {}; try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) { throw common.InputError ? new common.InputError('Invalid JSON body') : e; }
        return planTrip(body).then(function (out) { return reply(200, out); });
      }
      return reply(404, { ok: false, error: 'Unknown endpoint' });
    }).catch(fail);
  }
  window.fetch = function (input, opts) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/^\/api\//.test(url) || url.indexOf(location.origin + '/api/') === 0) return handle(url, opts);
    return realFetch(input, opts);
  };
  // Map tiles straight from TomTom (Map Display API raster tiles); app.js asks for these templates.
  window.ZR_TILE_URL = function (view) {
    if (!KEY || !tomtomTiles) return null;
    var k = 'key=' + encodeURIComponent(KEY);
    if (view === 'map') return 'https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?tileSize=256&view=Unified&language=en-US&' + k;
    if (view === 'satellite') return 'https://api.tomtom.com/map/1/tile/sat/main/{z}/{x}/{y}.jpg?' + k;
    if (view === 'traffic') return trafficTiles ? 'https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png?tileSize=256&' + k : null;
    if (view === 'incidents') return trafficTiles ? 'https://api.tomtom.com/traffic/map/4/tile/incidents/s1/{z}/{x}/{y}.png?tileSize=256&' + k : null;
    if (view === 'satlabels') return 'https://api.tomtom.com/map/1/tile/hybrid/main/{z}/{x}/{y}.png?tileSize=256&view=Unified&language=en-US&' + k;
    return null;
  };
})();
