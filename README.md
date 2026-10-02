# IceGuard — Antarctic environmental data dashboard

![CI](https://img.shields.io/badge/tests-npm%20test-4cc9f0) ![Data](https://img.shields.io/badge/data-real%20sources%20only-0b132b)

A 3D, source-attributed dashboard of Antarctic Peninsula terrain, weather-model data, NSIDC sea-ice extent and NASA/BYU tracked icebergs. **No synthetic scientific data**: when a source is unavailable, the UI shows the gap.

> Research visualization only. Not for navigation or safety decisions.

## Quick start

```bash
git clone https://github.com/<your-username>/iceguard.git
cd iceguard
npm test            # source-integrity checks
npm run check       # JavaScript syntax checks
npm start           # static server (frontend only; serverless proxies do not run)
```

Requires Node.js 18+.

## Deploy

**Vercel (recommended):** import the repo, framework preset *Other*, no build command. `api/sea-ice.js` and `api/icebergs.js` run as same-origin proxies that avoid browser CORS limits.
GitHub Pages and other static hosts also work, but the proxies will not run and the app falls back to direct and relay requests, which may be blocked.

## Continuous integration

`.github/workflows/ci.yml` runs `npm test` and `npm run check` on every push and pull request.

## Data policy
This build does not generate synthetic scientific measurements, simulated sensor feeds, synthetic sea-ice grids, iceberg tracks, route lines, or risk scores. If a source is unavailable, its value remains unavailable and the interface reports the error.

## Live sources
- **Open-Meteo forecast API**: current and hourly model temperature, wind speed/direction/gusts and pressure at seven Antarctic Peninsula-area coordinates. These are weather-model values, not in-situ station observations. Model timestamps are displayed in UTC. The app refreshes on request and every 15 minutes; it does not invent intermediate values.
- **AWS Terrain Tiles (Terrarium)**: elevation tiles for the 3D terrain. If tiles cannot load or be decoded, no procedural terrain is drawn.
- **NSIDC Sea Ice Index**: daily Southern Hemisphere sea-ice extent CSV. Extent is a hemispheric area metric, not a spatial concentration map. The browser first tries `/api/sea-ice` and then the official NSIDC URL.

Official sources:
- Open-Meteo API docs: https://open-meteo.com/en/docs
- NSIDC Sea Ice Index: https://nsidc.org/data/seaice_index
- NSIDC daily CSV: https://noaadata.apps.nsidc.org/NOAA/G02135/south/daily/data/S_seaice_extent_daily_v4.0.csv
- AWS Terrain Tiles: https://registry.opendata.aws/terrain-tiles/

## Important deployment note
The included `api/sea-ice.js` is a Node.js serverless endpoint intended for a host that supports serverless functions. A static-only host may not execute it; in that case the browser attempts the official NSIDC URL directly, which can be blocked by CORS or network policy. If that happens, the sea-ice metric remains unavailable rather than showing invented values. Open-Meteo's browser API is used directly.

## Run locally
Use Node.js 18+ and run a static server in this directory, e.g. `npx serve .`. This starts the frontend but does not execute the serverless proxy. To test the proxy, deploy on a serverless-compatible host or run it in an appropriate Node serverless emulator.

## Features intentionally not shown
- **Iceberg trajectories:** no verified, timestamped Antarctic iceberg-position feed is configured, so no tracks or forecast positions are displayed.
- **Route planning:** no route is drawn until a real spatial sea-ice grid, iceberg observations, ocean/weather inputs, and vessel constraints are connected and validated.
- **Risk score and fuel estimates:** removed because the prior demo formula and grid costs were not scientifically validated.

## Files
- `index.html` — source-attributed dashboard
- `style.css` — dark glassmorphism theme
- `app.js` — visual shell, accessibility and motion
- `features.js` — terrain tiles and Open-Meteo model data
- `science-data.js` — NSIDC daily extent parser and status UI
- `icebergs.js` — NASA/BYU iceberg list parser, markers and proximity card
- `api/` — Vercel serverless proxies (`sea-ice.js`, `icebergs.js`)
- `edge-functions/api/` — EdgeOne Pages equivalents
- `tests/source-integrity.test.js` — guards against reintroducing synthetic data UI
- `TEST-REPORT.md` — what is and is not verified

This is a research visualization, not an operational navigation tool. The UI has not been certified for vessel routing or safety decisions.

## Visual effects (all data-driven or purely decorative)
- Map wind particles use real Open-Meteo wind speed and direction, interpolated between the seven locations (time-compressed). Marker pulse rate follows model wind speed.
- Hero aurora shader and card tilt/glow are decorative and carry no data claims.
- Sea-ice chart compares this year and last year of real NSIDC daily extent.

## Deploying the sea-ice function
- **EdgeOne Pages (Git/CLI deploy):** `edge-functions/api/sea-ice.js` is served at `/api/sea-ice`; keep the `edge-functions` folder at the project root. Plain drag-and-drop static uploads may not run it.
- **Vercel:** `api/sea-ice.js` does the same job.
- If neither runs, the page falls back to the official URL, a relay, then NOAA CoastWatch ERDDAP (concentration grid; extent is derived and labeled as such).

## Iceberg data (real)
`icebergs.js` reads the NASA/BYU Scatterometer Climate Record Pathfinder current-iceberg list (ASCAT + OSCAT-2, revised about twice a week). Routes: `/api/icebergs` (edge function / Vercel function), direct, then a relay. Icebergs inside the 3D map area appear as white markers; a proximity card lists the nearest tracked iceberg to each monitored site. The US National Ice Center remains the authoritative source. No tracks or forecasts are generated.
