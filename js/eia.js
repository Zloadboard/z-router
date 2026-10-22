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
