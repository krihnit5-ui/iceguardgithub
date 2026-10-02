# IceGuard AI Model Card

## Active AI components

### 1. k-nearest-neighbour anomaly detector
**Type:** unsupervised ML.

**Purpose:** flag unusual combinations of observed iceberg/environment features for operator review. Missing environmental fields are not replaced with zero; incomplete records are excluded from feature vectors.

### 2. Degree-2 polynomial trajectory regression
**Type:** supervised ML.

**Features:** wind speed -> polynomial basis `[1, wind, wind²]`.
**Target:** observed historical iceberg drift speed.
**Training:** `trainTrajectoryModel(samples)` accepts real historical samples containing `windSpeedKmh` and `driftSpeedKmh`. Ridge regularization is used for numerical stability.

The browser does **not** ship fabricated training samples. A model must be trained from a real historical dataset and loaded as `window.IGTrajectoryModel` before trajectory forecasts are enabled. If no trained model is loaded, the engine returns `MODEL_NOT_TRAINED` instead of inventing a forecast.

The BYU Antarctic Iceberg Tracking Database provides historical iceberg positions from multiple scatterometer missions, including a statistical database with daily averaged position, size and related fields. It covers multiple decades, making it a candidate source for building historical tracks. Operational use still requires matching environmental forcing, independent validation and expert review.

## Trajectory geometry
Predicted displacement is projected on a sphere using a great-circle destination calculation. The engine does not use a flat-earth longitude scaling approximation, which is especially important in Antarctic high latitudes.

## Route decision support
Candidate route corridors are sampled at multiple points along every segment, including segment endpoints. This prevents a midpoint-only blind spot where a hazard near a segment endpoint could otherwise be missed. The output is explicitly `DECISION_SUPPORT_ONLY`.

## Operational boundary
AI output is decision support only. It must not be treated as a certified navigation instruction. Production routing requires validated spatial sea-ice concentration, vessel ice class/resistance, ocean-current forcing, route constraints, uncertainty calibration, historical backtesting and expert/operational validation.
