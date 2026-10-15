/* Z Router access gate (v0.10.0): Basic mode for visitors, Owner mode with a code, owner panel for choosing what visitors see.
 * - Desktop app (no window.ZR_BUILD): everything on, no owner entry (add ?preview=basic to the URL to look at the Basic version).
 * - Pages build: visitors get Basic unless features.json (committed in the site repo) turns features on. The owner enters a code
 *   (open the page with #owner, or click the version text 5 times); only a salted PBKDF2 hash of the code is in the site (owner.json).
 * HONEST LIMIT: this is soft protection. Everything the browser loads is public, so a determined visitor can read the page code
 * and fetch the hash-named feature files directly. It keeps casual testers out of features; it is not a security boundary. */
(function () {
  'use strict';
  var Fx = window.ZRFeatures, B = window.ZR_BUILD || null, OWNER_KEY = 'zr.owner', PREVIEW_KEY = 'zr.preview';
  var $ = function (s, el) { return (el || document).querySelector(s); }, $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var qPreview = /[?&]preview=basic\b/.test(location.search), sPreview = false;
  try { sPreview = sessionStorage.getItem(PREVIEW_KEY) === 'basic'; } catch (e) { /* private mode */ }
  var preview = qPreview || sPreview;
  var G = { mode: B ? 'basic' : preview ? 'basic' : 'desktop', sel: null, ownerCfg: null, published: null, owner: false, preview: preview };
  G.sel = Fx.resolve(null, !B && !preview); // Basic defaults at once on Pages (no flash of locked features); desktop = everything
  G.can = function (id) { return G.sel[id] !== false; };
  document.documentElement.dataset.mode = G.mode;

  /** Show/hide the pieces tagged data-feat="<id>". data-feat-any containers hide when none of their tagged children is visible. */
  G.apply = function () {
    $$('[data-feat]').forEach(function (el) { el.classList.toggle('feat-off', !G.can(el.getAttribute('data-feat'))); });
    $$('[data-feat-any]').forEach(function (el) { var box = el.getAttribute('data-feat-any') ? $(el.getAttribute('data-feat-any')) : el, kids = box ? $$('[data-feat]', box) : []; el.classList.toggle('feat-off', kids.length > 0 && kids.every(function (k) { return k.classList.contains('feat-off'); })); });
    document.documentElement.dataset.mode = G.mode;
  };
  function getJson(url) {
    var done = false;
    return new Promise(function (resolve) {
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 4000);
      fetch(url, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { if (!done) { done = true; clearTimeout(t); resolve(j); } });
    });
  }
  function loadScript(src) {
    return new Promise(function (resolve) {
      var s = document.createElement('script'); s.src = src; s.async = false;
      s.onload = function () { resolve(true); }; s.onerror = function () { resolve(false); }; document.head.appendChild(s);
    });
  }
  function storedOwner() { try { return localStorage.getItem(OWNER_KEY) || ''; } catch (e) { return ''; } }
  function ownerOk(cfg) { var v = storedOwner(); return !!(cfg && cfg.hash && v && v === cfg.hash.slice(0, 16)); }

  G.ready = !B ? Promise.resolve().then(function () { G.apply(); }) : Promise.all([getJson('features.json'), getJson('owner.json')]).then(function (r) {
    G.published = Fx.parseJson(JSON.stringify(r[0] || {})) || null; G.ownerCfg = r[1];
    G.owner = ownerOk(G.ownerCfg) && !preview;
    G.mode = G.owner ? 'owner' : 'basic';
    G.sel = Fx.resolve(G.published, G.owner);
    G.apply();
    var need = Fx.modulesFor(G.sel).filter(function (m) { return B.mods && B.mods[m]; });
    return Promise.all(need.map(function (m) { return loadScript(B.mods[m]); }));
  });
  G.isOwnerUnlocked = function () { return ownerOk(G.ownerCfg) && !!B; };

  // ---------------------------------------------------------------- owner dialog + panel
  var dlg = null;
  function el(tag, attrs, html) { var e = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ensureDlg() {
    if (dlg) return dlg;
    dlg = el('dialog', { id: 'ownerDlg', class: 'dlg', 'aria-labelledby': 'ownerTitle' });
    document.body.appendChild(dlg);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDlg(); });
    return dlg;
  }
  function closeDlg() { if (!dlg) return; if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  function showDlg() { if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', ''); }
  function toastMsg(t) { var b = $('#toast'); if (!b) return; b.textContent = t; b.classList.remove('hidden'); clearTimeout(toastMsg.t); toastMsg.t = setTimeout(function () { b.classList.add('hidden'); }, 2200); }

  function codeForm() {
    ensureDlg();
    dlg.innerHTML = '<div class="dlghd"><b id="ownerTitle">Owner</b><button type="button" class="ibtn" id="ownerClose" aria-label="Close">×</button></div>' +
      '<form id="ownerForm" autocomplete="off"><div class="dlgrow"><input type="password" id="ownerCode" name="ownerCode" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="Owner code" aria-label="Owner code">' +
      '<button type="submit" class="btn run sm" id="ownerGo">Unlock</button></div><label class="ck ownshow"><input type="checkbox" id="ownerShow">Show the code</label><div class="ownmsg" id="ownerMsg" role="status"></div></form>';
    $('#ownerShow', dlg).onchange = function () { $('#ownerCode', dlg).type = this.checked ? 'text' : 'password'; };
    $('#ownerClose', dlg).onclick = closeDlg;
    $('#ownerForm', dlg).onsubmit = function (e) {
      e.preventDefault();
      var code = $('#ownerCode', dlg).value, msg = $('#ownerMsg', dlg), btn = $('#ownerGo', dlg);
      if (!Fx.normalize(code)) return;
      btn.disabled = true; msg.textContent = 'Checking…'; msg.className = 'ownmsg';
      // owner.json is normally loaded at startup; if that failed (offline, blocked, slow), try once more now
      (G.ownerCfg ? Promise.resolve(G.ownerCfg) : getJson('owner.json?t=' + Date.now()).then(function (c) { G.ownerCfg = c; return c; })).then(function (cfg) {
        if (!cfg) throw new Error('Could not load owner.json (offline or blocked?). Reload the page and try again.');
        return Fx.verify(code, cfg);
      }).then(function (ok) {
        if (ok) { try { localStorage.setItem(OWNER_KEY, G.ownerCfg.hash.slice(0, 16)); sessionStorage.removeItem(PREVIEW_KEY); } catch (x) { /* ignore */ } location.hash = ''; history.replaceState(null, '', location.pathname + location.search); location.reload(); return; }
        setTimeout(function () { msg.textContent = 'That code is not right.'; msg.className = 'ownmsg bad'; btn.disabled = false; $('#ownerCode', dlg).select(); }, 700);
      }, function (err) { msg.textContent = err.message || 'Could not check the code.'; msg.className = 'ownmsg bad'; btn.disabled = false; });
    };
    showDlg(); setTimeout(function () { var i = $('#ownerCode', dlg); if (i) i.focus(); }, 30);
  }

  function panel() {
    ensureDlg();
    var cur = Fx.resolve(G.published, false), h = '<div class="dlghd"><b id="ownerTitle">Owner panel</b><button type="button" class="ibtn" id="ownerClose" aria-label="Close">×</button></div>' +
      '<div class="ownscroll"><div class="ownnote">You see everything. Tick what <b>visitors</b> should see, then copy or download the new <b>features.json</b>, replace it in the site repo and push.</div><div class="ownlist" id="ownerList">';
    Fx.GROUPS.forEach(function (g) {
      h += '<div class="cap">' + esc(g[1]) + '</div>';
      Fx.FEATURES.filter(function (f) { return f.group === g[0]; }).forEach(function (f) {
        h += '<label class="ck"><input type="checkbox" data-id="' + f.id + '"' + (cur[f.id] ? ' checked' : '') + '>' + esc(f.label) + '</label>';
      });
    });
    h += '</div></div><div class="ownfoot"><div class="ownstat" id="ownerStat"></div><div class="dact"><button type="button" class="btn run sm" id="ownCopy">Copy features.json</button><button type="button" class="btn gry sm" id="ownDown">Download</button>' +
      '<button type="button" class="btn gry sm" id="ownBasic">All off</button><button type="button" class="btn gry sm" id="ownAll">All on</button></div>' +
      '<div class="dact"><button type="button" class="btn gry sm" id="ownPrev">View as visitor</button><button type="button" class="btn gry sm" id="ownLock">Lock owner mode</button></div>' +
      '<div class="tdisc">Visitors get the file when it is committed as <b>features.json</b> in the site repo (a minute after the push). Soft protection only: the page code is public.</div></div>';
    dlg.innerHTML = h;
    var boxes = $$('#ownerList input', dlg);
    function selNow() { var s = {}; boxes.forEach(function (b) { s[b.dataset.id] = b.checked; }); return s; }
    function stat() {
      var s = selNow(), on = Fx.ids.filter(function (i) { return s[i]; }).length, same = Fx.toJson(s) === Fx.toJson(cur);
      $('#ownerStat', dlg).textContent = on + ' of ' + Fx.ids.length + ' features on for visitors · ' + (same ? 'same as the published features.json' : 'changed: save and push the new file');
    }
    boxes.forEach(function (b) { b.addEventListener('change', stat); }); stat();
    $('#ownerClose', dlg).onclick = closeDlg;
    $('#ownCopy', dlg).onclick = function () {
      var t = Fx.toJson(selNow());
      var ok = function () { toastMsg('features.json copied'); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(ok, function () { fallback(t); }); else fallback(t);
      function fallback(x) { var ta = el('textarea'); ta.value = x; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch (e) { toastMsg('Copy failed: use Download'); } ta.remove(); }
    };
    $('#ownDown', dlg).onclick = function () {
      var a = el('a'); a.href = URL.createObjectURL(new Blob([Fx.toJson(selNow())], { type: 'application/json' })); a.download = 'features.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };
    $('#ownBasic', dlg).onclick = function () { boxes.forEach(function (b) { b.checked = false; }); stat(); };
    $('#ownAll', dlg).onclick = function () { boxes.forEach(function (b) { b.checked = true; }); stat(); };
    $('#ownPrev', dlg).onclick = function () { try { sessionStorage.setItem(PREVIEW_KEY, 'basic'); } catch (e) { /* ignore */ } location.reload(); };
    $('#ownLock', dlg).onclick = function () { try { localStorage.removeItem(OWNER_KEY); sessionStorage.removeItem(PREVIEW_KEY); } catch (e) { /* ignore */ } location.reload(); };
    showDlg();
  }
  /** Open the Owner dialog: the code form, or the panel once unlocked. Not available in the desktop app. */
  G.openOwner = function () {
    if (!B) return;
    if (G.isOwnerUnlocked() && !preview) panel();
    else if (G.isOwnerUnlocked() && preview) { try { sessionStorage.removeItem(PREVIEW_KEY); } catch (e) { /* ignore */ } location.reload(); }
    else codeForm();
  };
  // entry points: #owner in the URL, or 5 clicks on the version text within 3 seconds
  function checkHash() { if (/^#owner$/i.test(location.hash)) { history.replaceState(null, '', location.pathname + location.search); G.ready.then(G.openOwner); } }
  window.addEventListener('hashchange', checkHash);
  document.addEventListener('DOMContentLoaded', function () { checkHash(); });
  if (document.readyState !== 'loading') checkHash();
  // a tiny "Owner" link next to the version text (the 5-click trick is easy to miss on a phone); not in the desktop app
  function addOwnerLink() {
    var v = $('#verTxt'); if (!B || !v || $('#ownerLink')) return;
    var a = el('a', { id: 'ownerLink', class: 'own-link', href: '#owner', role: 'button' }, 'Owner');
    v.parentNode.insertBefore(a, v); v.parentNode.classList.add('has-own');
    a.addEventListener('click', function (e) { e.preventDefault(); G.ready.then(G.openOwner); });
  }
  if (document.readyState !== 'loading') addOwnerLink(); else document.addEventListener('DOMContentLoaded', addOwnerLink);
  // a page copy cached from an older release (GitHub Pages caches for 10 minutes): notice the newer version and reload once
  if (B && B.version) {
    getJson('version.json?t=' + Date.now()).then(function (j) {
      if (!j || !j.version || j.version === B.version) return;
      var k = 'zr.reloaded'; try { if (sessionStorage.getItem(k) === j.version) return; sessionStorage.setItem(k, j.version); } catch (e) { return; }
      location.reload();
    });
  }
  var clicks = [];
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#verTxt')) return;
    var now = Date.now(); clicks = clicks.filter(function (t) { return now - t < 3000; }); clicks.push(now);
    if (clicks.length >= 5) { clicks = []; G.ready.then(G.openOwner); }
  });
  window.ZRGate = G;
})();
