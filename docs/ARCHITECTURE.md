# IceGuard 3D Pro Architecture

```text
Official Sources
  ├─ NSIDC Sea Ice Index
  ├─ NOAA CoastWatch / VIIRS South Polar sea-ice concentration
  ├─ NASA/BYU Antarctic iceberg positions
  ├─ Open-Meteo weather model
  └─ AWS Terrarium elevation
          ↓
Data Ingestion / Serverless Proxies
          ↓
Validation + Source/Time Metadata
          ↓
┌──────────────────────────────────────────────┐
│ AI + Decision Layer                          │
│                                              │
│ kNN anomaly detector                         │
│ wind-forced iceberg nowcast                  │
│ candidate route corridor evaluation          │
└──────────────────────┬───────────────────────┘
                       ↓
              Three.js + Charts
                       ↓
      Observe / Predict / Compare / Decide
```

The frontend keeps observed measurements and modelled outputs visibly distinct. Missing sources remain unavailable rather than being replaced with generated scientific values.
