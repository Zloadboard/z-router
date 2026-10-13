/* Z Router stop-list logic (pure, no DOM). Shared by the browser (window.TRStops) and node tests.
 * A stop list is the visible rows in order: [Start, ...intermediate stops, End].
 * Each item is {label, lat, lng} (lat/lng only when geocoded) or null for an empty row. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TRStops = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MAX_STOPS = 5; // intermediate stops (Start and End are extra)

  function isEmpty(v) { return !v || !String(v.label || '').trim(); }

  /** Move item `from` to position `to` (both indexes in the final list). Returns a new array. */
  function move(list, from, to) {
    var out = list.slice();
    if (from < 0 || from >= out.length) return out;
    to = Math.max(0, Math.min(out.length - 1, to));
    var it = out.splice(from, 1)[0];
    out.splice(to, 0, it);
    return out;
  }

  /** Insertion slot (0..n) for pointer y, given the vertical midpoints of the rows in order. */
  function insertIndex(mids, y) {
    var i = 0;
    while (i < mids.length && y > mids[i]) i++;
    return i;
  }

  /** Final index for a dragged row: insertion slot `insert` counted with the row still in the list. */
  function dropTarget(from, insert) { return insert > from ? insert - 1 : insert; }

  /** Split a list into slots: first = Start (origin), last = End, the rest = intermediate stops. */
  function toSlots(list) {
    var l = list.length ? list.slice() : [null, null];
    if (l.length === 1) l.push(null);
    return { start: l[0] || null, stops: l.slice(1, -1), end: l[l.length - 1] || null };
  }

  /** "Add stop": a new empty row at the very bottom. It becomes End; the previous End becomes the last intermediate stop. */
  function append(list) {
    if (list.length - 2 >= MAX_STOPS) return list.slice();
    return list.concat([null]);
  }

  /** "Add stop" (v0.9.1): a new empty intermediate stop just above End. */
  function insertBeforeEnd(list) {
    var l = list.length >= 2 ? list.slice() : [list[0] || null, null];
    if (l.length - 2 >= MAX_STOPS) return l;
    l.splice(l.length - 1, 0, null);
    return l;
  }

  /** Tab target after box `from` (v0.9.2). filled[i]: box i has text; last = End.
   * Skip empty middle boxes; go to the next filled middle box, else End; -1 (Run Trip) when End is filled or from End. */
  function nextTab(filled, from) {
    var last = filled.length - 1;
    if (from >= last) return -1;
    for (var i = from + 1; i < last; i++) if (filled[i]) return i;
    return filled[last] ? -1 : last;
  }

  /** Remove an intermediate stop (Start/End rows are only cleared, never removed). */
  function removeAt(list, idx) {
    if (idx <= 0 || idx >= list.length - 1) { var c = list.slice(); c[idx] = null; return c; }
    return list.slice(0, idx).concat(list.slice(idx + 1));
  }

  /** Reverse the filled rows (empty rows are dropped). */
  function reverse(list) {
    var f = list.filter(function (v) { return !isEmpty(v); }).reverse();
    while (f.length < 2) f.push(null);
    return f;
  }

  /** First selectable suggestion: the highlighted one if it is selectable, else the first non-muted item (-1 if none). */
  function pickIndex(items, active) {
    items = items || [];
    if (active >= 0 && items[active] && !items[active].muted) return active;
    for (var i = 0; i < items.length; i++) if (items[i] && !items[i].muted) return i;
    return -1;
  }

  /** Keyboard flow in a stop input. o = { key, shift, open, items, active, resolved, isLast, pending, text }.
   * Returns { pick: suggestion index or -1, move: 'next' | 'run' | null, prevent: bool, wait: bool }.
   * Tab (no Shift): accept the highlighted/first suggestion (unless the box already holds a selected location), then go to the
   * next stop input, or to Run Trip from the last stop. Enter: accept a suggestion (otherwise the form's default applies).
   * wait: suggestions are still loading, so accept the first one when it arrives. Shift+Tab and other keys: browser default. */
  function keyAction(o) {
    var none = { pick: -1, move: null, prevent: false, wait: false };
    var sel = o.open ? pickIndex(o.items, o.active) : -1;
    if (o.key === 'Enter') return sel >= 0 ? { pick: sel, move: null, prevent: true, wait: false } : none;
    if (o.key !== 'Tab' || o.shift) return none;
    var pick = o.resolved ? -1 : sel;
    var wait = !o.resolved && pick < 0 && !!o.pending && String(o.text || '').trim().length >= 3;
    return { pick: pick, move: o.isLast ? 'run' : 'next', prevent: true, wait: wait };
  }

  return { MAX_STOPS: MAX_STOPS, pickIndex: pickIndex, keyAction: keyAction, isEmpty: isEmpty, move: move, insertIndex: insertIndex, dropTarget: dropTarget, toSlots: toSlots, append: append, insertBeforeEnd: insertBeforeEnd, nextTab: nextTab, removeAt: removeAt, reverse: reverse };
});
