# Assumptions and model parameters

Everything here is synthetic. Larchway Outfitters is fictional; no real company's data, checkout
or results are represented. Parameters live in `python/experiment_model.py`; change them there and
rerun the pipeline.

## Traffic and customers

| Parameter | Value | Why |
|---|---|---|
| Seed | 1409 | Reproducible output |
| Window | Mon Sep 14 to Sun Sep 27, 2026 (14 days) | Two full weekly cycles |
| Visitors bucketed | 5,600 a day on average, 78,400 total; Friday to Sunday heavier | Gives about 16,000 customers per arm at checkout |
| Platform mix | desktop web 34%, mobile web 38%, iOS app 17%, Android app 11% | Illustrative mobile-heavy retailer |
| Country | CA 72%, US 28% | Canadian merchant shipping to the US |
| Returning customers | 45% | |
| Reach checkout | 36%, +10 pts returning, +5 pts in the apps | Decided before checkout is shown, so it cannot depend on the arm |
| Extra sessions after abandoning | Poisson, mean 0.35 | Customers come back |
| Spending level | lognormal, sigma 0.45 per customer | Drives order size and prior orders, so prior spend carries some signal for CUPED |
| Prior orders, last 90 days | Poisson, mean 0.9 x spending level (returning only) | New customers have none |

## Checkout behaviour

| Parameter | Value |
|---|---|
| Payment submission per session | desktop 66%, mobile web 52%, iOS 62%, Android 58%; +7 pts returning; +1.5 pts per prior order (up to 3); -2 pts US |
| Planted treatment effect on submission | desktop +0.6 pts, mobile web +3.5, iOS +2.5, Android +2.5 |
| Express adoption among treatment submitters | desktop 18%, mobile web 42%, iOS 38%, Android 36%; +8 pts returning |
| Authorization, first attempt | CA 93.5%, US 90.5%; -1.2 pts new customers; +3.5 pts express wallet |
| Retries after a decline | 50% retry, up to three attempts, -15 pts per retry |
| Order value | median $74 x spending level^0.6, lognormal sigma 0.55; express orders 3% smaller |
| Refunds | 4.5% of orders, 2 to 25 days later |
| Disputes | 0.40% of orders (returning), 0.68% (new); x1.35 on express orders from new customers (planted) |
| Dispute lag | 2 days + lognormal, median 28 days, sigma 0.6. About 95% have arrived by day 80 |

## Planted problems (each has a known answer)

| Problem | Where | What should catch it |
|---|---|---|
| Duplicate analytics events | 2.2% of client events resent with the same `event_id` | `raw_event_duplicates` (warn), deduplicated in staging |
| Logging bug | A shared mobile checkout module in iOS 7.2.0 and Android 5.9.0, released Fri Sep 18, hotfixed Fri Sep 25. When a treatment session is abandoned, 85% of the time its queued `checkout_started` and `express_button_shown` events are lost. Payments are logged server-side and survive. | `srm_exposed` and `srm_exposed_by_build`; the naive lift is inflated because the lost customers are mostly non-buyers in treatment |
| Immature disputes | Disputes after Oct 25 are not in the data | Dispute maturity check; dispute guardrail re-read at 90 days |

## The known answer

Every customer is simulated under both versions with the same random draws, so the generator knows
the true effect in this sample (`outputs/model_truth.json`). The analysis never reads it; the
readout compares against it at the end.

## Simplifications

Full refunds only; no partial captures or currency conversion; no bot traffic; no interference
between customers; checkout reach does not change with the arm; authorization depends on country,
customer type and payment method only.
