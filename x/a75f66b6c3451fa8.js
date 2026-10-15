/* HOS planner (FMCSA property-carrying rules): 11 h driving, 14 h on-duty window, 30-min break after 8 h of driving,
 * 10 h off-duty reset, 70 h / 8-day cycle with a 34 h restart. Simulates the trip leg by leg and returns a timeline
 * and an ETA per stop. Browser + Node. Planning aid only, not a log. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZRHos = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var H = 3600e3, M = 60e3;
  var RULES = { driveMax: 11 * H, windowMax: 14 * H, breakAfter: 8 * H, breakLen: 30 * M, rest: 10 * H, restart: 34 * H };
  /**
   * legs: [{ miles, durationSec, to }]; departMs: epoch ms; hoursUsed: on-duty hours already used in the 8-day cycle;
   * cycleHours: 70 (or 60); dwellMin: on-duty minutes at each intermediate stop; appts: [epoch ms | null] per leg end.
   */
  function plan(o) {
    var legs = o.legs || [], t = +o.departMs, cycleMax = (+o.cycleHours || 70) * H;
    var used = Math.max(0, Math.min(+o.hoursUsed || 0, cycleMax / H)) * H, dwell = Math.max(0, +o.dwellMin || 0) * M, appts = o.appts || [];
    var s = { drive: 0, sinceBreak: 0, windowStart: t, cycle: used };
    var ev = [], stops = [], mile = 0, tot = { driveSec: 0, breaks: 0, rests: 0, restarts: 0, waitSec: 0 };
    function push(type, start, end, m0, m1, note) {
      var last = ev[ev.length - 1];
      if (type === 'drive' && last && last.type === 'drive' && last.end === start) { last.end = end; last.mile1 = m1; return; }
      ev.push({ type: type, start: start, end: end, mile0: m0, mile1: m1, note: note || '' });
    }
    function offDuty(len, type, note) {
      push(type, t, t + len, mile, mile, note); t += len;
      if (len >= RULES.rest) { s.drive = 0; s.sinceBreak = 0; s.windowStart = t; }
      if (len >= RULES.breakLen) s.sinceBreak = 0;
      if (len >= RULES.restart) s.cycle = 0;
    }
    function resetFor(reason) {
      if (reason === 'cycle') { tot.restarts++; offDuty(RULES.restart, 'restart', '34-hour restart (' + Math.round(cycleMax / H) + '-hour limit)'); }
      else if (reason === 'break') { tot.breaks++; offDuty(RULES.breakLen, 'break', '30-minute break (8 h driving)'); }
      else { tot.rests++; offDuty(RULES.rest, 'rest', '10-hour off-duty (' + (reason === 'drive' ? '11 h driving' : '14 h window') + ')'); }
    }
    legs.forEach(function (leg, i) {
      var left = Math.max(0, +leg.durationSec || 0) * 1000, mph = left ? (+leg.miles || 0) / (left / H) : 0, guard = 0;
      while (left > 1000 && guard++ < 500) {
        var lim = { drive: RULES.driveMax - s.drive, window: RULES.windowMax - (t - s.windowStart), break: RULES.breakAfter - s.sinceBreak, cycle: cycleMax - s.cycle };
        var reason = null, room = left;
        Object.keys(lim).forEach(function (k) { if (lim[k] < room) { room = lim[k]; reason = k; } });
        if (room <= 1000) { resetFor(reason === 'window' ? 'window' : reason); continue; }
        var m1 = mile + room / H * mph;
        push('drive', t, t + room, mile, m1); t += room; mile = m1; left -= room;
        s.drive += room; s.sinceBreak += room; s.cycle += room; tot.driveSec += room / 1000;
      }
      mile = (legs.slice(0, i + 1).reduce(function (a, l) { return a + (+l.miles || 0); }, 0));
      var last = i === legs.length - 1, ap = appts[i] != null && appts[i] !== '' ? +appts[i] : null, eta = t;
      var st = { idx: i + 1, label: leg.to || '', etaMs: eta, apptMs: ap, mile: Math.round(mile * 10) / 10, status: null, lateMin: 0, waitMin: 0 };
      if (ap != null) {
        if (eta > ap) { st.status = 'late'; st.lateMin = Math.round((eta - ap) / M); }
        else { st.status = ap - eta <= 30 * M ? 'tight' : 'on time'; st.waitMin = Math.round((ap - eta) / M); }
      }
      if (!last) {
        if (st.waitMin > 0) { tot.waitSec += st.waitMin * 60; offDuty(st.waitMin * M, 'wait', 'Wait for appointment'); }
        if (dwell) { push('stop', t, t + dwell, mile, mile, 'On duty at stop ' + (i + 1)); t += dwell; s.cycle += dwell; if (dwell >= RULES.breakLen) s.sinceBreak = 0; }
      }
      st.departMs = t;
      stops.push(st);
    });
    return { events: ev, stops: stops, arriveMs: stops.length ? stops[stops.length - 1].etaMs : t, totals: tot,
      cycleLeftH: Math.round(Math.max(0, cycleMax - s.cycle) / H * 10) / 10, driveLeftH: Math.round(Math.max(0, RULES.driveMax - s.drive) / H * 10) / 10 };
  }
  /** "-05:00" style offset (minutes) from an ISO string; null when it has none. */
  function offsetMin(iso) {
    var m = String(iso || '').match(/(Z|[+-]\d\d:?\d\d)$/); if (!m) return null;
    if (m[1] === 'Z') return 0;
    var sg = m[1][0] === '-' ? -1 : 1, d = m[1].replace(':', '');
    return sg * (+d.slice(1, 3) * 60 + +d.slice(3, 5));
  }
  /** "2026-10-14T08:00" (wall time at a place with offset minutes) -> epoch ms. */
  function localToMs(local, offMin) {
    var m = String(local || '').match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/); if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - (offMin || 0) * M;
  }
  /** epoch ms -> wall-time parts at offset minutes. */
  function msToLocal(ms, offMin) {
    var d = new Date(ms + (offMin || 0) * M), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + 'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }
  // Main time zone per state (standard offset, hours). Split states use the zone most of the state's interstate miles are in.
  var STD = {};
  'CT DE DC FL GA IN KY ME MD MA MI NH NJ NY NC OH PA RI SC VT VA WV'.split(' ').forEach(function (c) { STD[c] = -5; });
  'AL AR IL IA KS LA MN MS MO NE ND OK SD TN TX WI'.split(' ').forEach(function (c) { STD[c] = -6; });
  'AZ CO ID MT NM UT WY'.split(' ').forEach(function (c) { STD[c] = -7; });
  'CA NV OR WA'.split(' ').forEach(function (c) { STD[c] = -8; });
  function usDst(ms) { // 2nd Sunday of March 2:00 to 1st Sunday of November 2:00 (local, approximated in UTC-6)
    var y = new Date(ms).getUTCFullYear(), sun = function (mon, n) { var f = new Date(Date.UTC(y, mon, 1)).getUTCDay(); return Date.UTC(y, mon, 1 + (7 - f) % 7 + 7 * (n - 1), 8); };
    return ms >= sun(2, 2) && ms < sun(10, 1);
  }
  /** UTC offset (minutes) for a state code at time ms; null if unknown. */
  function stateOffset(code, ms) { if (STD[code] == null) return null; return (STD[code] + (code !== 'AZ' && usDst(ms) ? 1 : 0)) * 60; }
  return { plan: plan, stateOffset: stateOffset, RULES: RULES, offsetMin: offsetMin, localToMs: localToMs, msToLocal: msToLocal };
});

;
/* Z Router feature module: HOS planner and appointment times. Loaded as a normal script on the desktop app; on the Pages build it is a hash-named file that is
 * fetched only after owner unlock or when the owner enabled the feature for visitors (see public/js/features.js, README). */
(window.ZRXQ = window.ZRXQ || []).push(['hos', function (X) {
  'use strict';
  var hosPrefs = X.hosPrefs, apptStore = X.apptStore, apptKey = X.apptKey, state = X.state, $ = X.$, $$ = X.$$, fmtAt = X.fmtAt, esc = X.esc, short = X.short, mi = X.mi, tzName = X.tzName, msIso = X.msIso, C = X.C, can = X.can;
  var HOS = window.ZRHos;
  /** Plan with the route's legs; each stop keeps its own UTC offset (from the provider's arrival times). */
  function hosRun(res) {
    var r = res.route, hp = hosPrefs(), ap = apptStore(), off0 = HOS.offsetMin(r.departureTime) || 0, offs = [];
    var appts = r.legs.map(function (l, i) { var o = HOS.offsetMin(l.arrivalTime); offs.push(o == null ? off0 : o); var v = ap[apptKey(i, l)]; return v ? HOS.localToMs(v, offs[i]) : null; });
    var plan = HOS.plan({ legs: r.legs.map(function (l) { return { miles: l.miles, durationSec: l.durationSec, to: l.to }; }), departMs: Date.parse(r.departureTime) || Date.now(),
      hoursUsed: hp.used, cycleHours: hp.cycle, dwellMin: hp.dwell, appts: appts });
    plan.offs = offs; plan.off0 = off0; plan.prefs = hp; plan.apptLocal = r.legs.map(function (l, i) { return ap[apptKey(i, l)] || ''; });
    return plan;
  }
  var EV_LABEL = { drive: 'Drive', break: '30-min break', rest: '10-h off duty', restart: '34-h restart', wait: 'Wait (appointment)', stop: 'On duty at stop' };
  function renderHos() {
    var res = state.lastResult, box = $('#hosPlan'); if (!res || !box) return;
    if (!can('hos')) { box.innerHTML = ''; return; }
    var P = hosRun(res), hp = P.prefs, r = res.route;
    var a = $('#hosArrive'); if (a) { a.textContent = fmtAt(P.arriveMs, P.offs[P.offs.length - 1]); $('#hosArriveTz').textContent = P.totals.breaks + ' break' + (P.totals.breaks === 1 ? '' : 's') + ', ' + P.totals.rests + ' rest' + (P.totals.rests === 1 ? '' : 's') + (P.totals.restarts ? ', ' + P.totals.restarts + ' restart' : ''); }
    var h = '<h5>HOS planner</h5><div class="hosin">' +
      '<label><b>Hours used</b><input type="number" id="hosUsed" min="0" max="70" step="0.5" value="' + hp.used + '"></label>' +
      '<label><b>Cycle</b><select id="hosCycle"><option value="70"' + (+hp.cycle === 70 ? ' selected' : '') + '>70 h / 8 days</option><option value="60"' + (+hp.cycle === 60 ? ' selected' : '') + '>60 h / 7 days</option></select></label>' +
      '<label><b>Min at stop</b><input type="number" id="hosDwell" min="0" max="600" step="15" value="' + hp.dwell + '"></label></div>';
    h += '<table class="tbl hosstops"><thead><tr><th>Stop</th><th>Appointment</th><th class="n">HOS ETA</th><th class="n">Status</th></tr></thead><tbody>';
    P.stops.forEach(function (st, i) {
      var off = P.offs[i], cls = st.status === 'late' ? 'over' : st.status === 'tight' ? 'tight' : st.status ? 'ok' : '';
      var txt = st.status === 'late' ? 'Late ' + C.formatDuration(st.lateMin * 60) : st.status === 'tight' ? 'Tight (' + st.waitMin + ' min early)' : st.status ? 'On time' + (st.waitMin ? ', ' + C.formatDuration(st.waitMin * 60) + ' early' : '') : '<span class="muted">—</span>';
      h += '<tr><td><b>' + (i + 1) + '. ' + esc(short(st.label)) + '</b><div class="muted tiny">Mile ' + mi(st.mile) + ' · ' + esc(tzName(msIso(st.etaMs, off))) + '</div></td>' +
        '<td><input type="datetime-local" class="appt" data-i="' + i + '" value="' + esc(P.apptLocal[i]) + '" aria-label="Appointment at stop ' + (i + 1) + ', local time"></td>' +
        '<td class="n">' + fmtAt(st.etaMs, off) + '</td><td class="n"><span class="' + cls + '">' + txt + '</span></td></tr>';
    });
    h += '</tbody></table><table class="tbl hostl"><thead><tr><th>Start</th><th>Activity</th><th class="n">Mile</th><th class="n">Length</th></tr></thead><tbody>';
    var legEnd = [], acc = 0; r.legs.forEach(function (l) { acc += l.miles; legEnd.push(acc); });
    var runs = res.states || [];
    var offAt = function (m, ms) {
      for (var j = 0; j < runs.length; j++) if (runs[j].code && m >= runs[j].startMile - 0.5 && m <= runs[j].endMile + 0.5) { var so = HOS.stateOffset(runs[j].code, ms); if (so != null) return so; }
      for (var k = 0; k < legEnd.length; k++) if (m <= legEnd[k] + 0.05) return P.offs[k]; return P.offs[P.offs.length - 1];
    };
    P.events.forEach(function (e) {
      h += '<tr' + (e.type !== 'drive' ? ' class="hosoff"' : '') + '><td>' + fmtAt(e.start, e.mile0 < 0.5 ? P.off0 : offAt(e.mile0, e.start)) + '</td><td>' + (e.type === 'drive' ? '<b>Drive</b> ' + mi(e.mile1 - e.mile0) + ' mi' : esc(e.note || EV_LABEL[e.type])) +
        '</td><td class="n">' + mi(e.mile0) + '</td><td class="n">' + C.formatDuration((e.end - e.start) / 1000) + '</td></tr>';
    });
    h += '</tbody></table><div class="tdisc">FMCSA property-carrying rules: 11 h driving, 14 h window, 30-min break after 8 h driving, 10 h off duty, ' + hp.cycle + ' h cycle (34 h restart). After this trip: ' +
      P.driveLeftH + ' h driving left in the shift, ' + P.cycleLeftH + ' h left in the cycle. Appointments are local time at the stop. Planning aid only, not a log; traffic and stops change the times.</div>';
    box.innerHTML = h;
    var save = function () {
      localStorage.setItem('zr.hos', JSON.stringify({ used: Math.max(0, Math.min(+$('#hosCycle').value, +$('#hosUsed').value || 0)), cycle: +$('#hosCycle').value, dwell: Math.max(0, +$('#hosDwell').value || 0) }));
      renderHos();
    };
    ['#hosUsed', '#hosCycle', '#hosDwell'].forEach(function (id) { $(id).addEventListener('change', save); });
    $$('input.appt', box).forEach(function (el) { el.addEventListener('change', function () {
      var ap = apptStore(), i = +el.dataset.i, k = apptKey(i, r.legs[i]); if (el.value) ap[k] = el.value; else delete ap[k];
      localStorage.setItem('zr.appts', JSON.stringify(ap)); renderHos();
    }); });
  }
  X.F.renderHos = renderHos; X.F.hosRun = hosRun;
}]);
