/* IFTA estimate: miles per state -> taxable gallons and state fuel tax (bundled data/ifta-rates.json). Browser + Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZRIfta = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var r2 = function (v, d) { var k = Math.pow(10, d); return Math.round(v * k) / k; };
  /**
   * runs: [{code, name, miles}] (state mileage runs, may repeat a state); mpg: truck MPG; rates: ifta-rates.json.
   * Returns { rows: [{code, name, miles, gallons, rate, tax, note}], miles, gallons, tax, missing: [codes without a rate] }.
   */
  function estimate(runs, mpg, rates) {
    var m = +mpg > 0 ? +mpg : 6.5, tbl = (rates && rates.rates) || {}, by = {}, order = [];
    (runs || []).forEach(function (s) {
      var k = s.code || 'non-US';
      if (!by[k]) { by[k] = { code: k, name: s.name || (tbl[k] && tbl[k].name) || '', miles: 0 }; order.push(k); }
      by[k].miles += +s.miles || 0;
    });
    var out = { rows: [], miles: 0, gallons: 0, tax: 0, missing: [], mpg: m };
    order.forEach(function (k) {
      var row = by[k], rt = tbl[k], rate = rt && typeof rt.diesel === 'number' ? rt.diesel : null;
      row.miles = r2(row.miles, 1); row.gallons = r2(row.miles / m, 1); row.rate = rate;
      row.tax = rate == null ? null : r2(row.gallons * rate, 2);
      row.note = rt ? rt.note || '' : 'No IFTA rate (not an IFTA jurisdiction)';
      if (rate == null) out.missing.push(k);
      out.miles += row.miles; out.gallons += row.gallons; out.tax += row.tax || 0;
      out.rows.push(row);
    });
    out.miles = r2(out.miles, 1); out.gallons = r2(out.gallons, 1); out.tax = r2(out.tax, 2);
    return out;
  }
  return { estimate: estimate };
});
