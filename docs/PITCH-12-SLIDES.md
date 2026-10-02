# IceGuard 3D Pro — SIH26059 Pitch Structure

1. **Title** — AI-Powered Antarctic Ice Intelligence & Route Decision Support
2. **Problem** — fragmented sea-ice, iceberg, weather and terrain information
3. **Users** — polar research vessels, Antarctic logistics operators, national programmes, maritime planners
4. **Solution** — observe → understand → predict → decide
5. **AI/ML** — kNN anomaly detection + transparent wind-forced trajectory nowcast
6. **Architecture & Data Flow** — official data → validation → AI → route DSS → Three.js
7. **Data Integrity** — observed / modelled / unavailable states separated
8. **Navigation Decision Support** — candidate corridor comparison, not autonomous navigation
9. **Feasibility** — working browser prototype and progressive validation roadmap
10. **Impact** — specific vessel, agency and logistics use cases
11. **Financial Viability** — low-cost prototype → institutional/API/grant model
12. **Roadmap & Closing** — historical backtesting → expert validation → pilot → scale

## Judge-safe language
- Say **decision support**, not autonomous navigation.
- Say **modelled nowcast**, not observed trajectory.
- Say **candidate corridor**, not safe route, until vessel/ice/ocean validation exists.
- Never invent accuracy percentages. Report measured backtest metrics only.
