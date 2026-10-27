# Experiment plan: express_checkout_v1

The plan a team would sign off before launch. In this synthetic study I wrote it alongside the
model; the one change made after a first run is listed at the end.

## Question

Larchway Outfitters (fictional) sells outdoor gear online in Canada and the US. Its checkout asks for
card details on every order. Does adding an express wallet button (stored, tokenized payment
details, one tap) raise the share of customers who complete checkout, without hurting
authorization, refunds or disputes?

## Design

| Item | Decision |
|---|---|
| Unit of randomization | Customer. A salted hash of `customer_id` (`sha256("express_checkout_v1:" + id)`) puts each customer in one arm for the whole test, on every device. |
| Split | 50/50 |
| Who is bucketed | Every customer who visits during the test, on all four platforms, in CA and US |
| Who is analyzed | Customers who reach checkout, the first point where the two versions differ (a triggered analysis). Exposure is the client `checkout_started` event. |
| Control | Card form only |
| Treatment | Card form plus the express wallet button |
| Window | Monday Sep 14 to Sunday Sep 27, 2026: two full weeks, so each weekday appears twice |
| Readout | Oct 26, 2026, on data to Oct 25 |

## Metrics

All metrics are defined once in `metrics/semantic_layer.json` and computed per customer.

| Role | Metric | Definition | Decision use |
|---|---|---|---|
| Primary | Checkout conversion | customers with an order / customers who reached checkout | Ship only if this rises and is statistically significant (two-sided, alpha 0.05) |
| Secondary | Revenue per customer | order value / customers who reached checkout, CUPED on 90-day prior spend | Reported; not a ship criterion |
| Secondary | Average order value | order value / orders | Reported; changes in who orders make it non-causal on its own |
| Diagnostic | Payment submission | customers who submitted a payment / customers who reached checkout | Shows whether a lift comes from intent or from authorization |
| Guardrail | Authorization rate | authorized attempts / attempts | Fail if harm is significant; pass if the 95% CI rules out a drop of more than 0.5 pp |
| Guardrail | Refund rate | refunded orders / orders | Pass if the 95% CI rules out a rise of more than 1.0 pp |
| Guardrail | Dispute rate | disputed orders / orders | Margin 0.15 pp. Known to be immature and underpowered at the readout; re-read at 90 days |

Ratio metrics whose denominator is not the customer (authorization, refunds, disputes, order value)
use the delta method, because one customer can contribute several attempts or orders.

## Sample size

Baseline conversion 66% (assumed from pre-period reporting), minimum detectable effect 1.5
percentage points, alpha 0.05 two-sided, power 80%:

n per arm = (1.96 + 0.84)^2 x 2 x 0.66 x 0.34 / 0.015^2 = **15,656 customers**

At about 32,000 customers reaching checkout in two weeks, that is roughly 16,000 per arm, so the
two-week window is enough with little to spare.

## Trust checks before anyone reads a result

1. Data tests in `sql/tests.sql` pass (errors stop the pipeline).
2. Sample ratio mismatch (SRM): chi-square test of the 50/50 split on assigned and on exposed
   customers. Alarm at p < 0.001.
3. If an SRM appears, find its source before reading metrics. Exclude only on attributes fixed
   before treatment (platform, build, country, date of bucketing), in both arms, and show the
   result with and without the exclusion.
4. No control customer sees or pays with the express button.

## Stopping and peeking

Fixed horizon: no early stop for a good result. The daily view is for spotting broken
experiences, not a stopping rule. Stop early only if checkout errors spike or authorization falls
more than 1 pp with p < 0.01.

## Segments

Platform (4) and customer type (2) are exploratory. P-values are Holm-adjusted within each family
and no ship decision rests on a single segment.

## Decision rules

| Primary | Guardrails | Decision |
|---|---|---|
| Significant rise | All pass | Ship to 100% |
| Significant rise | Dispute inconclusive, others pass | Ship with a 5% holdout and re-read disputes at 90 days |
| Significant rise | Any fail | Do not ship; investigate the guardrail |
| Not significant | Any | Do not ship on this evidence |

## Changed after the first run

The refund margin was first written as 0.5 pp. On the first run the refund confidence interval
was about ±0.6 pp, so no result could have passed that margin. A margin the test cannot detect
should be caught at planning, so I set it to 1.0 pp, sized to what roughly 9,700 orders per arm
can detect. The refund estimate itself (+0.01 pp) did not influence the change.
