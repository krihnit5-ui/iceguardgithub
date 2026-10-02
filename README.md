# IceGuard — AI-enabled Antarctic ice decision support

A browser dashboard that combines **sea ice, iceberg positions, weather, ocean currents and terrain** from real public sources, adds a transparent AI/ML layer, and compares navigation routes. Every value is labelled *observed*, *modelled* or *unavailable*; nothing is synthesised.

> **Decision support only.** Not a certified navigation system, ECDIS or substitute for qualified mariners and the US National Ice Center.

## Features
| Area | What it does |
|---|---|
| 3D map | Antarctic Peninsula terrain from AWS Terrarium tiles, weather markers, wind particles, observed icebergs |
| Weather and currents | Open-Meteo forecast + Marine API at 7 sites (temperature, wind, pressure, ocean current) |
| Sea ice | NSIDC daily extent, learned 7/30-day extent forecast scored on held-out years, NOAA/NSIDC concentration grid |
| Icebergs | NASA/BYU scatterometer list, proximity to sites, kNN anomaly percentile, 24 h drift range (current + 1-3 % wind drag) |
| Routing | A* search over the 25 km ice-concentration grid by vessel class, plus 5 comparison corridors |

## Quick start
```bash
npm start          # static server (needs Node 18+)
npm test           # unit + source-integrity tests
npm run check      # syntax check of every script
```
The frontend runs on any static host. Same-origin proxies improve reliability (CORS):
- **Vercel:** `api/*.js` are deployed automatically.
- **EdgeOne Pages:** keep `edge-functions/` at the project root; served at `/api/sea-ice` and `/api/icebergs`.
Without a proxy the page falls back to the official URLs; if blocked, the value stays *unavailable*.

## Data sources
| Source | Used for | Terms |
|---|---|---|
| [Open-Meteo](https://open-meteo.com/en/docs) Forecast and [Marine](https://open-meteo.com/en/docs/marine-weather-api) | weather, ocean current | CC BY 4.0, attribute Open-Meteo |
| [NSIDC Sea Ice Index](https://nsidc.org/data/seaice_index) | daily extent | NSIDC data use terms |
| [NOAA CoastWatch ERDDAP](https://coastwatch.pfeg.noaa.gov/erddap/griddap/nsidcG10016v3sh1day.html) | CDR concentration grid (lags days to weeks) | NOAA/NSIDC terms |
| [BYU/NASA SCP](https://www.scp.byu.edu/current_icebergs.html) | observed large iceberg positions | check BYU terms; NIC is authoritative |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | elevation | open data |

Libraries (Three.js, GSAP, Chart.js) load from CDNs.

## Project layout
```
index.html, style.css          UI
app.js                         loader, motion, hero shader
features.js                    terrain, weather, ocean currents, 3D map
science-data.js                NSIDC extent, chart, extent forecast
icebergs.js                    BYU iceberg feed parser
ai-engine.js                   kNN, drift models, projections, forecaster, backtest harness
decision-support.js            AI panel, A* optimiser, corridors
api/, edge-functions/          same-origin proxies
tests/                         node tests
docs/                          architecture, model card, pitch notes
```

## AI components and honest limits
- **kNN anomaly ranking:** unsupervised; labels are percentiles within the tracked set, not validated thresholds.
- **Extent forecaster:** fitted in-browser on NSIDC history; final 3 years held out and scored against persistence and climatology (shown live). Extent only.
- **Drift nowcast:** physics baseline, **not validated or backtested**. `IceGuardAI.backtestDrift` is provided; it needs historical BYU tracks plus wind/current. A trained regression can be loaded via `window.IGTrajectoryModel`.
- **Routing:** vessel ice limits are planning assumptions (WMO concentration classes), not an ice class. Terrain tiles are coarse (about 2 km).
- Details: [docs/MODEL-CARD.md](docs/MODEL-CARD.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Roadmap
Drift backtest on archived BYU lists, concentration forecast, vessel resistance model, bathymetry, expert validation.

## License
MIT, see [LICENSE](LICENSE). Data remain under their providers' terms.
