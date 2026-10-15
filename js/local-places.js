/* Built-in US city + ZIP lookup (team build, added 2026-10-15).
 * Turns "Romeoville, IL", "Romeoville IL", "Romeoville, Illinois" or "60446" into map points without calling
 * TomTom Search, so the router keeps working when the TomTom key's Search credits run out. Street addresses
 * still go to TomTom. Data: data/us-places.txt (29,738 cities, ~28,000 ZIPs), loaded on first use.
 * Lines: C|City|ST|lat|lng   and   Z|zip|lat|lng|City|ST */
(function () {
  'use strict';
  var STATES = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
    delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN',
    iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
    minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
    'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
    oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
    utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY' };
  var ABBR = {}; Object.keys(STATES).forEach(function (k) { ABBR[STATES[k]] = true; });

  var cities = [], byKey = {}, zips = {}, loadP = null;

  /** Canonical form used for matching: lower case, no dots/commas, "saint"->"st", "fort"->"ft", "mount"->"mt". */
  function canon(s) {
    return String(s || '').toLowerCase().replace(/[.,']/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/\bsaint\b/g, 'st').replace(/\bsainte\b/g, 'ste').replace(/\bfort\b/g, 'ft').replace(/\bmount\b/g, 'mt');
  }
  function parse(text) {
    text.split('\n').forEach(function (l) {
      var p = l.split('|');
      if (p[0] === 'C' && p.length >= 5) {
        var c = { name: p[1], st: p[2], lat: +p[3], lng: +p[4], key: canon(p[1]) };
        cities.push(c);
        var k = c.key + '|' + c.st;
        if (!byKey[k]) byKey[k] = c;
      } else if (p[0] === 'Z' && p.length >= 6) {
        zips[p[1]] = { zip: p[1], lat: +p[2], lng: +p[3], name: p[4], st: p[5] };
      }
    });
  }
  function load() {
    if (!loadP) loadP = fetch('data/us-places.txt?v=1').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (t) { parse(t); return true; })
      .catch(function (e) { loadP = null; throw e; });
    return loadP;
  }

  /** Split typed text into { zip } or { city, st } (st may be null). Returns null for street addresses. */
  function split(q) {
    var s = String(q || '').trim().replace(/\s+/g, ' ').replace(/,?\s*(usa|us|united states)$/i, '');
    var z = s.match(/^(\d{5})(-\d{4})?$/);
    if (z) return { zip: z[1] };
    if (/^\d+\s+\S/.test(s)) return null; // "123 Main St, ..." is a street address: leave it to TomTom
    s = s.replace(/\s+\d{5}(-\d{4})?$/, ''); // "Romeoville, IL 60446" -> "Romeoville, IL"
    var parts = s.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    var city = parts[0] || '', st = null;
    if (parts.length >= 2) {
      var tail = parts[parts.length - 1].toLowerCase();
      if (tail.length === 2 && ABBR[tail.toUpperCase()]) st = tail.toUpperCase();
      else if (STATES[tail]) st = STATES[tail];
      else return null;
      city = parts.slice(0, -1).join(' ');
    } else {
      var m = city.match(/^(.*\S)\s+([A-Za-z]{2})$/); // "Romeoville IL"
      if (m && ABBR[m[2].toUpperCase()]) { city = m[1]; st = m[2].toUpperCase(); }
      else {
        var lower = city.toLowerCase();
        Object.keys(STATES).some(function (full) { // "Romeoville Illinois"
          if (lower.length > full.length + 1 && lower.slice(-full.length - 1) === ' ' + full) { city = city.slice(0, -full.length - 1); st = STATES[full]; return true; }
          return false;
        });
      }
    }
    if (/\d/.test(city)) return null;
    return { city: city, st: st };
  }
  function item(c, extra) {
    var label = c.name + ', ' + c.st + (extra || '');
    return { id: 'local:' + c.st + ':' + c.key, title: label, label: label, resultType: 'Geography', lat: c.lat, lng: c.lng, local: true };
  }
  function distKm(a, lat, lng) { var dx = (a.lng - lng) * Math.cos(lat * Math.PI / 180), dy = a.lat - lat; return Math.sqrt(dx * dx + dy * dy) * 111; }

  /** Exact lookup: a ZIP, or a city with its state, or a city name that exists in only one state. */
  function lookup(q) {
    var s = split(q);
    if (!s) return Promise.resolve(null);
    return load().then(function () {
      if (s.zip) { var z = zips[s.zip]; return z ? { label: (z.name ? z.name + ', ' + z.st + ' ' : '') + z.zip, lat: z.lat, lng: z.lng } : null; }
      var key = canon(s.city);
      if (!key) return null;
      if (s.st) { var c = byKey[key + '|' + s.st]; return c ? { label: c.name + ', ' + c.st, lat: c.lat, lng: c.lng } : null; }
      var all = cities.filter(function (x) { return x.key === key; });
      return all.length === 1 ? { label: all[0].name + ', ' + all[0].st, lat: all[0].lat, lng: all[0].lng } : null;
    });
  }
  /** Suggestions while typing: cities whose name starts with what was typed (and matching state, if typed),
   * exact names first, then nearest to the map centre "at" ("lat,lng"). Street addresses -> null (use TomTom). */
  function suggest(q, at) {
    var s = split(q);
    if (!s) return Promise.resolve(null);
    return load().then(function () {
      if (s.zip) { var z = zips[s.zip]; return z ? [{ id: 'local:zip:' + z.zip, title: z.name + ', ' + z.st + ' ' + z.zip, label: z.name + ', ' + z.st + ' ' + z.zip, resultType: 'Geography', lat: z.lat, lng: z.lng, local: true }] : []; }
      var key = canon(s.city);
      if (key.length < 2) return [];
      var c0 = String(at || '').split(','), lat = +c0[0], lng = +c0[1], hasAt = isFinite(lat) && isFinite(lng) && c0.length === 2;
      var hits = cities.filter(function (c) { return c.key.indexOf(key) === 0 && (!s.st || c.st === s.st || c.st.indexOf(s.st) === 0); });
      hits.sort(function (a, b) {
        var ea = a.key === key ? 0 : 1, eb = b.key === key ? 0 : 1;
        if (ea !== eb) return ea - eb;
        if (hasAt) return distKm(a, lat, lng) - distKm(b, lat, lng);
        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      });
      return hits.slice(0, 8).map(function (c) { return item(c); });
    });
  }
  /** Best-effort city point for any text that ends in "City, ST" (used when TomTom cannot place a street address). */
  function cityOf(q) {
    var m = String(q || '').match(/([A-Za-z .'\-]+),\s*([A-Za-z]{2})\b(?:\s+\d{5})?\s*(?:,\s*(?:usa|us))?\s*$/i);
    if (!m) return Promise.resolve(null);
    return lookup(m[1].trim() + ', ' + m[2]);
  }

  window.ZRPlaces = { lookup: lookup, suggest: suggest, cityOf: cityOf, split: split, canon: canon, load: load };
})();
