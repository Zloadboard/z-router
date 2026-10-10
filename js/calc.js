/*
 * Z Router shared math: unit conversions and trip cost math.
 * Works in the browser (window.TRCalc) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TRCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CM_PER_INCH = 2.54;
  var KG_PER_LB = 0.45359237;
  var METERS_PER_MILE = 1609.344;
  var MPS_PER_MPH = 0.44704;

  function num(v, dflt) {
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, ''));
    return isFinite(n) ? n : (dflt === undefined ? 0 : dflt);
  }

  /** feet + inches -> whole centimeters, rounded UP so we never under-report a clearance. */
  function ftInToCm(ft, inch) {
    var totalIn = num(ft) * 12 + num(inch);
    if (totalIn <= 0) return 0;
    return Math.ceil(totalIn * CM_PER_INCH - 1e-9);
  }

  /** pounds -> whole kilograms, rounded UP. */
  function lbsToKg(lbs) {
    var v = num(lbs);
    return v > 0 ? Math.ceil(v * KG_PER_LB - 1e-9) : 0;
  }

  /** mph -> m/s (HERE vehicle[speedCap] range is 1..70 m/s). */
  function mphToMps(mph) {
    var v = num(mph) * MPS_PER_MPH;
    if (v <= 0) return 0;
    return Math.min(70, Math.max(1, Math.round(v * 100) / 100));
  }

  function metersToMiles(m) { return num(m) / METERS_PER_MILE; }

  function round(v, d) { var p = Math.pow(10, d || 0); return Math.round(v * p) / p; }

  /**
   * Trip cost math.
   * opts: { miles, seconds, tollCost, mpg, fuelPrice, costPerMile, costPerHour }
   * costPerMile / costPerHour are the carrier's own operating rates (driver pay, equipment, etc.).
   * Fuel is computed separately from MPG and $/gal.
   */
  function computeCosts(opts) {
    var miles = Math.max(0, num(opts.miles));
    var hours = Math.max(0, num(opts.seconds)) / 3600;
    var mpg = num(opts.mpg);
    var fuelPrice = Math.max(0, num(opts.fuelPrice));
    var cpm = Math.max(0, num(opts.costPerMile));
    var cph = Math.max(0, num(opts.costPerHour));
    var tolls = Math.max(0, num(opts.tollCost));

    var gallons = mpg > 0 ? miles / mpg : 0;
    var fuelCost = gallons * fuelPrice;
    var mileageCost = miles * cpm;
    var hourlyCost = hours * cph;
    var total = fuelCost + mileageCost + hourlyCost + tolls;

    return {
      miles: round(miles, 1),
      hours: round(hours, 2),
      gallons: round(gallons, 1),
      fuelCost: round(fuelCost, 2),
      mileageCost: round(mileageCost, 2),
      hourlyCost: round(hourlyCost, 2),
      tollCost: round(tolls, 2),
      totalCost: round(total, 2),
      totalPerMile: miles > 0 ? round(total / miles, 2) : 0,
      fuelPerMile: miles > 0 ? round(fuelCost / miles, 3) : 0
    };
  }

  /**
   * Load economics: rate (what the load pays) vs trip cost. deadheadMiles are added to the paid miles for cost.
   * Returns null when no rate is entered.
   */
  function computeEconomics(opts) {
    var rate = num(opts.loadRate);
    if (!(rate > 0)) return null;
    var miles = Math.max(0, num(opts.miles));
    var cost = Math.max(0, num(opts.totalCost));
    var profit = rate - cost;
    return {
      revenue: round(rate, 2),
      cost: round(cost, 2),
      profit: round(profit, 2),
      margin: round(profit / rate * 100, 1),
      ratePerMile: miles > 0 ? round(rate / miles, 2) : 0,
      profitPerMile: miles > 0 ? round(profit / miles, 2) : 0
    };
  }

  /**
   * Hours-of-service ESTIMATE (property-carrying, simplified): max 11 h driving then a 10 h break,
   * a 30 min break after 8 h of cumulative driving. Ignores the 14 h window, on-duty time at stops,
   * the 70 h/8-day limit and split sleeper. Driving seconds in, total elapsed seconds out.
   */
  function hosEstimate(driveSeconds) {
    var remaining = Math.max(0, num(driveSeconds)), total = 0, shift = 0, sinceBreak = 0, longBreaks = 0, shortBreaks = 0;
    var MAX_SHIFT = 11 * 3600, MAX_NO_BREAK = 8 * 3600;
    var guard = 0;
    while (remaining > 0 && guard++ < 1000) {
      var chunk = Math.min(remaining, MAX_SHIFT - shift, MAX_NO_BREAK - sinceBreak);
      total += chunk; remaining -= chunk; shift += chunk; sinceBreak += chunk;
      if (remaining <= 0) break;
      if (shift >= MAX_SHIFT) { total += 10 * 3600; longBreaks++; shift = 0; sinceBreak = 0; }
      else if (sinceBreak >= MAX_NO_BREAK) { total += 1800; shortBreaks++; sinceBreak = 0; }
    }
    return { driveSec: Math.round(num(driveSeconds)), totalSec: Math.round(total), longBreaks: longBreaks, shortBreaks: shortBreaks,
      breakSec: Math.round(total - num(driveSeconds)) };
  }

  /** ISO time + seconds, expressed in the UTC offset of `offsetFrom` (e.g. the destination's local time). */
  function addSecondsIso(iso, seconds, offsetFrom) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return null;
    var m = String(offsetFrom || iso).match(/([+-])(\d\d):?(\d\d)$|Z$/);
    var offMin = m && m[1] ? (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) : 0;
    var d = new Date(t + seconds * 1000 + offMin * 60000);
    var pad = function (n) { return ('0' + n).slice(-2); };
    var off = m && m[1] ? m[1] + m[2] + ':' + m[3] : 'Z';
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + off;
  }

  function formatDuration(seconds) {
    var s = Math.max(0, Math.round(num(seconds)));
    var h = Math.floor(s / 3600);
    var m = Math.round((s % 3600) / 60);
    if (m === 60) { h += 1; m = 0; }
    return h > 0 ? h + ' h ' + m + ' min' : m + ' min';
  }

  function formatMoney(v, currency) {
    var n = num(v);
    var c = currency || 'USD';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
    } catch (e) {
      return c + ' ' + n.toFixed(2);
    }
  }


  /*
   * Hazmat options shown in the UI (provider-neutral ids) and how each provider expresses them.
   * HERE: vehicle[shippedHazardousGoods] values. TomTom: vehicleLoadType values (repeatable).
   */
  var HAZMAT = [
    { id: 'class1', label: 'Class 1 – Explosives', here: 'explosive', tomtom: ['USHazmatClass1'] },
    { id: 'class2', label: 'Class 2 – Gases', here: 'gas', tomtom: ['USHazmatClass2'] },
    { id: 'class3', label: 'Class 3 – Flammable liquids', here: 'flammable', tomtom: ['USHazmatClass3'] },
    { id: 'class4', label: 'Class 4 – Flammable solids', here: 'flammable', tomtom: ['USHazmatClass4'] },
    { id: 'class5', label: 'Class 5 – Oxidizers / organic peroxides', here: 'organic', tomtom: ['USHazmatClass5'] },
    { id: 'class6', label: 'Class 6 – Poisons', here: 'poison', tomtom: ['USHazmatClass6'] },
    { id: 'class7', label: 'Class 7 – Radioactive', here: 'radioactive', tomtom: ['USHazmatClass7'] },
    { id: 'class8', label: 'Class 8 – Corrosives', here: 'corrosive', tomtom: ['USHazmatClass8'] },
    { id: 'class9', label: 'Class 9 – Miscellaneous', here: 'other', tomtom: ['USHazmatClass9'] },
    { id: 'combustible', label: 'Combustible liquid', here: 'combustible', tomtom: ['USHazmatClass3'] },
    { id: 'pih', label: 'Poison inhalation hazard (PIH/TIH)', here: 'poisonousInhalation', tomtom: ['USHazmatClass2', 'USHazmatClass6'] },
    { id: 'harmfulToWater', label: 'Harmful to water', here: 'harmfulToWater', tomtom: ['USHazmatClass9', 'otherHazmatHarmfulToWater'] }
  ];
  // Older saved settings used HERE's raw values; map them to the neutral ids.
  var HAZMAT_LEGACY = { explosive: 'class1', gas: 'class2', flammable: 'class3', organic: 'class5', poison: 'class6',
    radioactive: 'class7', corrosive: 'class8', other: 'class9', poisonousInhalation: 'pih' };
  function hazmatEntry(id) {
    if (!id) return null;
    var key = HAZMAT_LEGACY[id] || id;
    for (var i = 0; i < HAZMAT.length; i++) if (HAZMAT[i].id === key) return HAZMAT[i];
    return null;
  }

  return {
    HAZMAT: HAZMAT,
    HAZMAT_LEGACY: HAZMAT_LEGACY,
    hazmatEntry: hazmatEntry,
    CM_PER_INCH: CM_PER_INCH,
    KG_PER_LB: KG_PER_LB,
    METERS_PER_MILE: METERS_PER_MILE,
    num: num,
    ftInToCm: ftInToCm,
    lbsToKg: lbsToKg,
    mphToMps: mphToMps,
    metersToMiles: metersToMiles,
    computeCosts: computeCosts,
    computeEconomics: computeEconomics,
    hosEstimate: hosEstimate,
    addSecondsIso: addSecondsIso,
    formatDuration: formatDuration,
    formatMoney: formatMoney,
    round: round
  };
});
