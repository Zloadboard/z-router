# Z Router (static, GitHub Pages)

Truck route planner for dispatchers: truck-legal TomTom routes, state mileage, tandem (KPRA) rule checks, trip costs and load economics.

Live: https://zloadboard.github.io/z-router/

This is the static build of Z Router. There is no server: the page calls the TomTom Routing and Search APIs straight from the browser. Map tiles come from TomTom when the key allows Map Display; otherwise the free OpenStreetMap / OpenTopoMap / Esri tiles are used.

## The TomTom key

A static site cannot hide an API key. `config.js` contains a TomTom key made only for this site and limited in the TomTom developer portal to the domain `zloadboard.github.io` (other websites get HTTP 403). On TomTom's free tier (no credit card), each API has a free monthly allowance shared by all keys on the account; when it is used up, further requests are blocked until the next billing cycle, not charged (see the FAQ at https://docs.tomtom.com/pricing).

## Files

- `index.html`, `mobile.html`, `css/`, `js/`: the app (desktop page and phone page)
- `js/static-api.js`: answers the app's `/api/*` calls in the browser and calls TomTom
- `js/zr-lib.js`: TomTom request builder/parser, state lookup, tandem rules and cost math (bundled from the desktop version)
- `data/tandem-rules.json`: state tandem rules; `data/us-states.geojson`: state boundaries (US Census, public domain)
- `vendor/`: Leaflet (BSD-2-Clause) and the Inter font (SIL Open Font License)

Route results are planning estimates. Before dispatch, check posted signs, clearances, weight and hazmat limits, tandem rules, permits and road conditions.

## Version 0.9.9 (Oct 22, 2026): same as the team router, without crossdocks

This site now runs the same code as the team router on the Freight Board site (`z-router/` in the private board repo), copied over with these differences:

- `config.js` sets `window.ZR_PUBLIC = true`: no Crossdocks button or layer (even with `?xdock=1`, and even if this browser still has an old crossdock list saved), and no usage counter.
- `data/crossdocks-default.json` and `usage.html` are not published here.
- No Basic mode: every visitor gets the full router (address and company search, drag to reroute, Street View / Satellite, 3 stop boxes + Add stop, phone page `mobile.html`).

Files from the old Basic-mode build (`js/gate.js`, `js/features.js`, `features.json`, `owner.json`, `x/*.js`) are no longer loaded by the page.

Freight Board links (`?from=…&stop=…&to=…&rate=…&date=…&run=1`) still work.
