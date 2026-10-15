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

;
/* Z Router feature module: IFTA estimate. Loaded as a normal script on the desktop app; on the Pages build it is a hash-named file that is
 * fetched only after owner unlock or when the owner enabled the feature for visitors (see public/js/features.js, README). */
(window.ZRXQ = window.ZRXQ || []).push(['ifta', function (X) {
  'use strict';
  var state = X.state, $ = X.$, esc = X.esc, readTruck = X.readTruck, mi = X.mi, money = X.money;
  // ---------- IFTA estimate (bundled IFTA rate matrix) ----------
  function loadIfta() {
    if (state.iftaRates || state.iftaP) return;
    state.iftaP = fetch('data/ifta-rates.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { state.iftaRates = j; }, function (e) { state.iftaRates = { error: e.message }; })
      .then(function () { state.iftaP = null; var b = $('#iftaRep'); if (b && state.lastResult) b.innerHTML = iftaHtml(state.lastResult); });
  }
  function iftaHtml(res) {
    var R = state.iftaRates;
    if (!R) return '<div class="muted">Loading IFTA rates…</div>';
    if (R.error) return '<div class="warn">IFTA rates not loaded (' + esc(R.error) + ')</div>';
    var tk = readTruck(), est = window.ZRIfta.estimate(res.states || [], tk.mpg, R);
    var h = '<table class="tbl"><thead><tr><th>State</th><th class="n">Miles</th><th class="n">Gallons</th><th class="n">Rate</th><th class="n">Tax</th></tr></thead><tbody>';
    if (!est.rows.length) h += '<tr><td colspan="5" class="muted">State mileage not available for this route.</td></tr>';
    est.rows.forEach(function (r) {
      h += '<tr><td><b>' + esc(r.code) + '</b> <span class="muted">' + esc(r.name) + '</span></td><td class="n">' + mi(r.miles, 1) + '</td><td class="n">' + r.gallons.toFixed(1) +
        '</td><td class="n">' + (r.rate == null ? '<span class="muted" title="' + esc(r.note) + '">n/a</span>' : '$' + r.rate.toFixed(3)) + '</td><td class="n">' + (r.tax == null ? '–' : money(r.tax)) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td>Total</td><td class="n">' + mi(est.miles, 1) + '</td><td class="n">' + est.gallons.toFixed(1) + '</td><td></td><td class="n">' + money(est.tax) + '</td></tr></tfoot></table>';
    return h + '<div class="tdisc">Gallons = state miles ÷ ' + est.mpg + ' MPG. Rates: ' + esc(R.quarter) + ' diesel, ' + esc(R.status) + ', from the IFTA tax matrix (iftach.org).' +
      (est.missing.length ? ' No IFTA rate for ' + esc(est.missing.join(', ')) + (est.missing.indexOf('OR') >= 0 ? ' (Oregon uses a weight-mile tax)' : '') + '.' : '') +
      ' This is the tax due on fuel used per state; net IFTA owed depends on where you buy fuel (tax paid at the pump is credited).</div>';
  }
  X.F.loadIfta = loadIfta; X.F.iftaHtml = iftaHtml;
}]);
