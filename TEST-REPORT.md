# IceGuard validation report

Automated checks in this package verify JavaScript syntax, expected DOM references, and that synthetic map/route UI has been removed. These checks do not prove that third-party APIs are reachable from a specific host.

## Known external dependencies
- Open-Meteo must be reachable from the user's browser. If requests fail, affected values are unavailable.
- AWS Terrain Tiles must allow image loading and canvas pixel access; if not, terrain remains unavailable rather than being replaced with procedural terrain.
- NSIDC CSV may be blocked by CORS on static hosts. The included same-origin serverless proxy addresses this only on a host that executes the function.

## Not claimed as tested
No live API response was successfully verified as part of this local build process. Full browser interaction and deployment-host testing must be performed after deployment. No sea-ice forecasting model, iceberg drift model, or operational route optimizer is implemented.
