# Express Checkout Experiment Readout

An A/B test of an express wallet button at a **fictional** online retailer, Larchway Outfitters,
run end to end on synthetic data: raw data from three source systems, a SQL pipeline with data
tests, a metrics semantic layer, a sample ratio mismatch traced to two app builds, delta-method
and CUPED analysis, and a ship decision.

**Built by:** Abdullah Al Mneni, Business Technology Management, Toronto Metropolitan University

> **Synthetic data.** Every customer, payment and dispute comes from the seeded model in
> `python/experiment_model.py`. The study is not affiliated with any payments company or retailer.
> The model simulates every customer under both versions, so the true effect is known and the
> readout can be checked against it.

## Headline results (synthetic)

- Checkout conversion **+2.55 pp** (65.95% to 68.50%, 95% CI +1.46 to +3.64, p < 0.0001) on
  28,449 customers. The true effect in the model is +2.39 pp.
- The first estimate was **+4.60 pp**. Exposed customers were 49.07% treatment (SRM, p = 0.0008).
  Splitting by app build traced it to iOS 7.2.0 and Android 5.9.0, whose checkout module dropped
  analytics events from abandoned treatment sessions. Excluding both builds from both arms restores
  the split (p = 0.90).
- Authorization +0.78 pp and refunds +0.01 pp: both guardrails pass. Disputes +0.11 pp
  (CI -0.04 to +0.26) is open: about 60% of disputes have arrived and the test can only detect
  about 0.19 pp against a 0.15 pp margin.
- Average order value -3.3%; revenue per customer +$0.51, not significant. CUPED on prior spend
  cut variance by only 1.8% because half the customers are new.
- Stopping at day 4 would have reported +3.8 pp. Android's +5.46 pp segment estimate is well above
  its true +3.04.
- **Decision:** ship to 95% with a 5% holdout; re-read disputes at 90 days (Dec 26, 2026).

## Repository

| Path | What it is |
|---|---|
| `python/experiment_model.py` | Model parameters and per-customer simulation (common random numbers) |
| `python/generate_data.py` | Writes `data/raw/*.csv`, the data dictionary and `outputs/model_truth.json` |
| `python/pipeline.py` | Loads raw CSVs into SQLite, builds staging and marts, runs the data tests |
| `python/semantic_layer.py` | Compiles `metrics/semantic_layer.json` to value SQL and sufficient-statistics SQL |
| `python/ab_stats.py` | Delta method, CUPED, SRM chi-square, power, Holm (standard library only) |
| `python/analyze.py` | The readout: trust checks, metrics, guardrails, segments, daily view, truth check |
| `python/build_site_data.py` | Bundles results into `assets/site-data.js` |
| `sql/staging.sql`, `sql/marts.sql` | Cleaning and the customer-level experiment table |
| `sql/tests.sql` | 15 data tests with error or warn severity |
| `sql/compiled/` | SQL generated from the metric definitions |
| `metrics/semantic_layer.json` | Measures, dimensions, populations and metric definitions |
| `docs/experiment_plan.md` | Hypothesis, metrics, power, stopping and decision rules |
| `docs/readout.md` | The decision memo |
| `docs/assumptions.md` | Every model parameter and planted problem |
| `docs/results.md`, `docs/test_results.md` | Generated output |
| `index.html`, `assets/` | The one-page readout (Chart.js) |

## Reproduce

Python 3.9+ standard library only.

```bash
python3 python/generate_data.py
python3 python/pipeline.py
python3 python/semantic_layer.py
python3 python/analyze.py
python3 python/build_site_data.py
python3 -m http.server 8766
```

Then open http://localhost:8766. The page also works opened straight from disk.

## Limitations

Synthetic data with assumed rates, lags and effects; normal approximations (dispute counts are
small); I wrote the plan alongside the model, and the one margin changed after a first run is
disclosed in the plan. Built with AI assistance (Claude Code) for coding; the experiment design,
checks and decision are mine, and every figure was checked against the query output.
