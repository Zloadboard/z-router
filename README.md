# Z Router (static, GitHub Pages)

Truck route planner for dispatchers: truck-legal TomTom routes, state mileage, tandem (KPRA) rule checks, trip costs and load economics.

Live: https://zloadboard.github.io/z-router/

This is the static build of Z Router. There is no server: the page calls the TomTom Routing and Search APIs straight from the browser. Map tiles come from TomTom when the key allows Map Display; otherwise the free OpenStreetMap / OpenTopoMap / Esri tiles are used.

## The TomTom key

A static site cannot hide an API key. `config.js` contains a TomTom key made only for this site and limited in the TomTom developer portal to the domain `zloadboard.github.io` (other websites get HTTP 403). On TomTom's free tier (no credit card), each API has a free monthly allowance shared by all keys on the account; when it is used up, further requests are blocked until the next billing cycle, not charged (see the FAQ at https://docs.tomtom.com/pricing).

## Files

- `index.html`, `css/`, `js/`: the app (same UI as the desktop version)
- `js/static-api.js`: answers the app's `/api/*` calls in the browser and calls TomTom
- `js/zr-lib.js`: TomTom request builder/parser, state lookup, tandem rules and cost math (bundled from the desktop version)
- `features.json`: which features regular visitors see (edit with the Owner panel; see the main README, "Owner mode"). `owner.json`: salted hash of the owner code (never the code). `x/*.js`: hash-named feature files, loaded only when allowed
- `data/tandem-rules.json`: state tandem rules; `data/us-states.geojson`: state boundaries (US Census, public domain)
- `vendor/`: Leaflet (BSD-2-Clause) and the Inter font (SIL Open Font License)

Route results are planning estimates. Before dispatch, check posted signs, clearances, weight and hazmat limits, tandem rules, permits and road conditions.
