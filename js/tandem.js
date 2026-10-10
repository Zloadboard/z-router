/* Tandem (kingpin-to-rear-axle, "KPRA") rule evaluation. UMD: window.TRTandem in the browser, require() in Node.
 * Data comes from data/tandem-rules.json (see data/README.md). Nothing here invents a limit: a state missing from
 * the data, or marked 'uncertain' with no number, is reported as unknown ("check"), never as "no limit".
 * The driver's setting is entered as kingpin -> CENTER of the rear tandem plus the tandem spread; for states that
 * measure to the REARMOST axle the setting is converted (center + spread/2) before comparing. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TRTandem = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CONFIDENCE = { 'verified-official': 'Verified (official)', 'secondary-source': 'Secondary source · verify', 'uncertain': 'Uncertain · verify' };
  var GENERIC_DISCLAIMER = 'Planning aid only. Drivers must verify posted signs, current state rules and permits; ' +
    'KPRA limits, measurement points and exceptions vary by state and change over time.';
  var DEFAULT_SPREAD_FT = 49 / 12; // typical 49-inch tandem spread (4'1")

  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }

  /** 40 -> 40′, 40.5 -> 40′6″. mode 'floor' rounds DOWN to the inch (use for maximums so we never overstate a limit). */
  function fmtFt(ft, mode) {
    if (ft == null || !isFinite(ft)) return '–';
    var inches = ft * 12;
    var total = mode === 'floor' ? Math.floor(inches + 1e-6) : Math.round(inches);
    var f = Math.floor(total / 12), i = total % 12;
    return f + '\u2032' + (i ? i + '\u2033' : '');
  }
  function fmtMile(m) { return '~' + Math.round(m).toLocaleString('en-US'); }

  /** Classify a state's measuredTo text. -> { point: 'rearmost'|'tandemCenter', ambiguous } */
  function measurePoint(text, override) {
    if (override === 'rearmost' || override === 'tandemCenter') return { point: override, ambiguous: false };
    var t = String(text || '').toLowerCase();
    if (/midway|midpoint|tandem|axle group|group of axles|rear group|axle assembly/.test(t)) return { point: 'tandemCenter', ambiguous: false };
    if (/rearmost/.test(t)) return { point: 'rearmost', ambiguous: false };
    return { point: 'tandemCenter', ambiguous: true }; // e.g. "center of the rear axle": usually read as the tandem center
  }
  var POINT_LABEL = { rearmost: 'rearmost axle', tandemCenter: 'center of rear tandem' };

  function normalizeLimit(s) {
    if (!s || typeof s !== 'object') return null;
    var v = num(s.kpraMaxFt);
    if (v == null) return null;
    return { kpraMaxFt: v, measuredTo: s.measuredTo || null, appliesTo: s.appliesTo || null, measuredPoint: s.measuredPoint || null };
  }

  /** Validate the loaded JSON against the expected schema. Returns { ok, data, error }. */
  function normalizeRules(json) {
    if (!json || typeof json !== 'object' || !json.states || typeof json.states !== 'object' || Array.isArray(json.states)) {
      return { ok: false, data: null, error: 'tandem-rules.json has no "states" object' };
    }
    var states = {};
    Object.keys(json.states).forEach(function (code) {
      var r = json.states[code] || {};
      var alt = r.altAxleRule && typeof r.altAxleRule === 'object' ? {
        maxFt: num(r.altAxleRule.maxFt), from: r.altAxleRule.from || null, to: r.altAxleRule.to || null, appliesTo: r.altAxleRule.appliesTo || null } : null;
      states[code.toUpperCase()] = {
        code: code.toUpperCase(),
        name: r.name || code.toUpperCase(),
        kpraMaxFt: num(r.kpraMaxFt),
        measuredTo: r.measuredTo || null,
        measuredPoint: r.measuredPoint || null,
        appliesTo: r.appliesTo || null,
        maxTrailerLengthFt: num(r.maxTrailerLengthFt),
        exceptions: r.exceptions || null,
        statuteCitation: r.statuteCitation || null,
        sourceUrl: typeof r.sourceUrl === 'string' && /^https?:\/\//i.test(r.sourceUrl) ? r.sourceUrl : null,
        confidence: CONFIDENCE[r.confidence] ? r.confidence : 'uncertain',
        notes: r.notes || null,
        lastChecked: r.lastChecked || null,
        secondaryLimits: Array.isArray(r.secondaryLimits) ? r.secondaryLimits.map(normalizeLimit).filter(Boolean) : [],
        altAxleRule: alt && alt.maxFt != null ? alt : null
      };
    });
    return { ok: true, data: { lastChecked: json.lastChecked || null, disclaimer: json.disclaimer || null, measurementNote: json.measurementNote || null,
      fixture: !!json._fixture, states: states } };
  }

  /** Does a secondary limit apply to this truck? Single-axle / non-tandem variants never apply (we model a tandem);
   * "over/longer than N ft [M in]" applies only to longer trailers; anything else (e.g. road class) applies. */
  function secondaryApplies(sec, trailerFt) {
    var t = String(sec.appliesTo || '').toLowerCase();
    if (/single[- ]axle|not a tandem|non-tandem|spread axle/.test(t)) return false;
    var m = t.match(/(?:over|longer than|more than|exceeding)\s+(\d+(?:\.\d+)?)\s*(?:ft|feet|')(?:\s*(\d+)\s*(?:in|inches|"))?/);
    if (m) {
      var min = parseFloat(m[1]) + (m[2] ? parseInt(m[2], 10) / 12 : 0);
      return (trailerFt != null ? trailerFt : 53) > min + 1e-9;
    }
    return true;
  }

  /** limit | none | unknown | nodata | altrule (without truck-specific secondary limits) */
  function statusOf(rule) {
    if (!rule) return 'nodata';
    if (rule.kpraMaxFt != null) return 'limit';
    if (rule.altAxleRule) return 'altrule';
    return rule.confidence === 'uncertain' ? 'unknown' : 'none';
  }

  function candidate(lim, spread) {
    var mp = measurePoint(lim.measuredTo, lim.measuredPoint);
    return { limitFt: lim.kpraMaxFt, point: mp.point, ambiguous: mp.ambiguous, measuredTo: lim.measuredTo, appliesTo: lim.appliesTo,
      centerLimitFt: mp.point === 'rearmost' ? lim.kpraMaxFt - spread / 2 : lim.kpraMaxFt };
  }
  function limitText(c) { return fmtFt(c.limitFt) + ' kingpin to ' + POINT_LABEL[c.point]; }

  /** Evaluate one state rule for this truck -> row fields. */
  function evalRule(rule, trailer, spread) {
    var st = statusOf(rule);
    var out = { status: st, limit: null, others: [] };
    if (!rule) return out;
    var cands = [];
    if (rule.kpraMaxFt != null) cands.push(candidate({ kpraMaxFt: rule.kpraMaxFt, measuredTo: rule.measuredTo, appliesTo: rule.appliesTo, measuredPoint: rule.measuredPoint }, spread));
    rule.secondaryLimits.forEach(function (s) {
      var c = candidate(s, spread);
      c.applies = secondaryApplies(s, trailer);
      if (c.applies) cands.push(c); else out.others.push(c);
    });
    if (cands.length) {
      cands.sort(function (a, b) { return a.centerLimitFt - b.centerLimitFt; });
      out.limit = cands[0];
      out.status = 'limit';
      out.others = cands.slice(1).concat(out.others);
    }
    return out;
  }

  /**
   * runs: [{code,name,miles,startMile}] in route order (code null = outside the US).
   * rules: normalized data (normalizeRules(...).data) or null when not loaded.
   * kpraFt: kingpin -> center of rear tandem (ft) or null. spreadFt: tandem spread (default 49 in). trailerLengthFt: e.g. 53.
   */
  function evaluate(opts) {
    opts = opts || {};
    var runs = (opts.runs || []).filter(function (r) { return r.code; });
    var rules = opts.rules || null;
    var kpra = num(opts.kpraFt);
    var spread = num(opts.spreadFt); if (spread == null || spread < 0 || spread > 12) spread = DEFAULT_SPREAD_FT;
    var trailer = num(opts.trailerLengthFt);
    var route = runs.map(function (r) { return r.code; }).filter(function (c, i, a) { return i === 0 || a[i - 1] !== c; }).join('\u2192');
    var res = { loaded: !!rules, route: route, rows: [], strictest: null, actions: [], settingOk: null, kpraFt: kpra, spreadFt: spread,
      rearmostFt: kpra != null ? kpra + spread / 2 : null, unknown: [], altRules: [], verify: [], trailerWarnings: [], violations: [],
      disclaimer: (rules && rules.disclaimer) || GENERIC_DISCLAIMER, measurementNote: rules ? rules.measurementNote : null, lastChecked: rules ? rules.lastChecked : null };
    if (!rules) {
      res.summary = 'Tandem rules data not loaded.';
      res.driverNote = 'Route ' + route + '. Tandem rules data not loaded \u2014 check each state\u2019s KPRA rule before dispatch. Verify posted signs and current state rules.';
      return res;
    }
    var cur = kpra != null ? kpra : Infinity;
    var seen = {};
    runs.forEach(function (r) {
      var rule = rules.states[r.code] || null;
      var ev = evalRule(rule, trailer, spread);
      var lim = ev.limit;
      var row = { code: r.code, name: (rule && rule.name) || r.name, miles: r.miles, startMile: r.startMile, status: ev.status, rule: rule,
        limitFt: lim ? lim.limitFt : null, centerLimitFt: lim ? lim.centerLimitFt : null, point: lim ? lim.point : null, ambiguous: lim ? lim.ambiguous : false,
        measuredTo: lim ? lim.measuredTo : (rule && rule.measuredTo), limit: lim, others: ev.others, verify: !!rule && rule.confidence !== 'verified-official',
        violation: false, action: null, repeat: !!seen[r.code] };
      seen[r.code] = true;
      if (lim) {
        if (!res.strictest || lim.centerLimitFt < res.strictest.centerLimitFt - 1e-9) {
          res.strictest = { code: r.code, name: row.name, limitFt: lim.limitFt, centerLimitFt: lim.centerLimitFt, point: lim.point, measuredTo: lim.measuredTo,
            startMile: r.startMile, label: r.code + ' max ' + limitText(lim) };
        }
        if (kpra != null && kpra > lim.centerLimitFt + 1e-9) { row.violation = true; if (res.violations.indexOf(r.code) < 0) res.violations.push(r.code); }
        if (lim.centerLimitFt < cur - 1e-9) {
          var where = r.startMile < 1 ? 'before departure (route starts in ' + r.code + ')' : 'before entering ' + r.code + ' (mile ' + fmtMile(r.startMile) + ')';
          var target = fmtFt(lim.centerLimitFt, 'floor');
          var conv = lim.point === 'rearmost' ? ' (' + r.code + ': ' + limitText(lim) + ', with ' + fmtFt(spread) + ' spread)' : '';
          var alsoApplies = ev.others.filter(function (o) { return o.applies !== false; });
          if (alsoApplies.length) conv += ' [stricter ' + r.code + ' limit' + (lim.appliesTo ? ', ' + lim.appliesTo : '') + '; ' +
            alsoApplies.map(function (o) { return fmtFt(o.limitFt) + (o.appliesTo ? ' ' + o.appliesTo : ''); }).join('; ') + ']';
          row.action = { code: r.code, name: row.name, startMile: r.startMile, limitFt: lim.limitFt, centerLimitFt: lim.centerLimitFt, point: lim.point,
            text: (kpra == null ? 'Set tandems to' : 'Slide tandems forward to') + ' \u2264 ' + target + ' kingpin to center of rear tandem' + conv + ' ' + where + '.',
            note: (r.startMile < 1 ? 'Before departure' : 'Before ' + r.code + ' (mile ' + fmtMile(r.startMile) + ')') + ' slide tandems to \u2264' + target +
              ' kingpin to center of rear tandem' + (lim.point === 'rearmost' ? ' (' + r.code + ' measures ' + fmtFt(lim.limitFt) + ' to the rearmost axle)' : '') + '.' };
          res.actions.push(row.action);
          cur = lim.centerLimitFt;
        }
      } else if (ev.status === 'altrule') {
        if (!res.altRules.some(function (a) { return a.code === r.code; })) {
          var a = rule.altAxleRule;
          res.altRules.push({ code: r.code, rule: a, text: r.code + ': not a KPRA rule \u2014 ' + (a.appliesTo || 'long semitrailers') + ' legal only if ' + (a.from || 'tractor rear axle') +
            ' to ' + (a.to || 'trailer front axle') + ' \u2264 ' + fmtFt(a.maxFt) + '. Check tandem position.' });
        }
      } else if (ev.status === 'unknown' || ev.status === 'nodata') {
        if (res.unknown.indexOf(r.code) < 0) res.unknown.push(r.code);
      }
      if (row.verify && res.verify.indexOf(r.code) < 0) res.verify.push(r.code);
      if (rule && rule.maxTrailerLengthFt != null && trailer != null && trailer > rule.maxTrailerLengthFt + 1e-9 && !row.repeat) {
        res.trailerWarnings.push(r.code + ': listed max trailer length ' + fmtFt(rule.maxTrailerLengthFt) + ' (yours ' + fmtFt(trailer) + ') \u2014 check permits/exceptions.');
      }
      res.rows.push(row);
    });
    if (res.strictest && kpra != null) res.settingOk = kpra <= res.strictest.centerLimitFt + 1e-9;
    var tl = trailer != null ? ' for ' + fmtFt(trailer) + ' trailers' : '';
    var checks = res.altRules.map(function (a) { return a.text; });
    if (res.unknown.length) checks.push('No/uncertain KPRA data for ' + res.unknown.join(', ') + ' \u2014 check those states.');
    var chk = checks.length ? ' ' + checks.join(' ') : '';
    var ver = res.verify.length ? ' Secondary/uncertain sources (verify): ' + res.verify.join(', ') + '.' : '';
    var trailerTxt = trailer != null ? ' Trailer ' + fmtFt(trailer) + '.' : '';
    if (!res.strictest) {
      var clean = !res.unknown.length && !res.altRules.length;
      res.summary = clean ? 'No state KPRA limit on this route' + tl + '. Verify local/route restrictions.' + ver
        : 'No KPRA number in the data for this route, but some states need checking.' + chk + ver;
      res.driverNote = 'Route ' + route + '. Tandem: ' + (clean ? 'no state KPRA limit on this route' + (trailer != null ? '; trailer ' + fmtFt(trailer) + '.' : '.') : 'no KPRA number in our data.' + chk + trailerTxt);
    } else {
      var s = res.strictest;
      var eq = s.point === 'rearmost' ? ' (= \u2264' + fmtFt(s.centerLimitFt, 'floor') + ' to tandem center with ' + fmtFt(spread) + ' spread)' : '';
      res.summary = 'Strictest: ' + s.label + eq + '.' +
        (res.settingOk === false ? ' Your setting ' + fmtFt(kpra) + ' to tandem center is over the limit in ' + res.violations.join(', ') + '.'
          : res.settingOk ? ' Your setting ' + fmtFt(kpra) + ' to tandem center is within every limit.' : ' Enter your kingpin \u2192 rear tandem setting to check it.') + chk + ver;
      res.driverNote = 'Route ' + route + '. ' + (res.actions.length && res.settingOk !== true ? res.actions.map(function (a) { return a.note; }).join(' ')
        : 'Tandem setting ' + fmtFt(kpra) + ' kingpin to center of rear tandem is within every state KPRA limit on this route.') + trailerTxt + chk;
    }
    if (res.trailerWarnings.length) res.driverNote += ' ' + res.trailerWarnings.join(' ');
    res.driverNote += ' Verify posted signs and current state rules.';
    return res;
  }

  /** Preview one state's rule (before a route is run). */
  function previewState(rules, code, kpraFt, trailerLengthFt, spreadFt) {
    if (!rules || !code) return null;
    return evaluate({ runs: [{ code: code, name: code, miles: 0, startMile: 0 }], rules: rules, kpraFt: kpraFt, trailerLengthFt: trailerLengthFt, spreadFt: spreadFt });
  }

  return { CONFIDENCE: CONFIDENCE, GENERIC_DISCLAIMER: GENERIC_DISCLAIMER, DEFAULT_SPREAD_FT: DEFAULT_SPREAD_FT, POINT_LABEL: POINT_LABEL,
    fmtFt: fmtFt, measurePoint: measurePoint, secondaryApplies: secondaryApplies, normalizeRules: normalizeRules, statusOf: statusOf,
    evaluate: evaluate, previewState: previewState };
});
