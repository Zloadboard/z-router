# Z Router (static, GitHub Pages)

Truck route planner for dispatchers: truck-legal TomTom routes, state mileage, tandem (KPRA) rule checks, trip costs and load economics.

Live: https://zloadboard.github.io/z-router/

This is the static build of Z Router v0.7.3. There is no server: the page calls the TomTom APIs (Routing, Search, Map Display tiles) straight from the browser.

## The TomTom key

A static site cannot hide an API key. `config.js` contains the TomTom key, so anyone can read it. Protect it in the TomTom developer portal by limiting the key to this site's domain (`zloadboard.github.io`). On TomTom's free tier (no credit card), each API has a free monthly allowance shared by all keys on the account; when it is used up, further requests are blocked until the next billing cycle, not charged (see the FAQ at https://docs.tomtom.com/pricing).

## Files

- `index.html`, `css/`, `js/`: the app (same UI as the desktop version)
- `js/static-api.js`: answers the app's `/api/*` calls in the browser and calls TomTom
- `js/zr-lib.js`: TomTom request builder/parser, state lookup, tandem rules and cost math (bundled from the desktop version)
- `data/tandem-rules.json`: state tandem rules; `data/us-states.geojson`: state boundaries (US Census, public domain)
- `vendor/`: Leaflet (BSD-2-Clause) and the Inter font (SIL Open Font License)

Route results are planning estimates. Before dispatch, check posted signs, clearances, weight and hazmat limits, tandem rules, permits and road conditions.
