# Readout: express_checkout_v1

**Larchway Outfitters (fictional) · test Sep 14 to 27, 2026 · data to Oct 25 · synthetic data**

## Decision

Ship the express wallet button, keeping 5% of customers on the card form until the dispute
guardrail can be read at 90 days (orders from the test are 90 days old on Dec 26, 2026).

- Checkout conversion rose **2.55 percentage points**, from 65.95% to 68.50% (95% CI +1.46 to
  +3.64 pp, p < 0.0001). That is a 3.9% relative lift.
- Authorization rose 0.78 pp (95% CI -0.01 to +1.56). The guardrail passes: the interval rules out
  a drop of more than 0.5 pp.
- Refunds are flat (+0.01 pp, CI ±0.59). The guardrail passes against its 1.0 pp margin.
- Disputes are **inconclusive**. The observed rate is 0.34% against 0.23% (+0.11 pp, CI -0.04 to
  +0.26), but only about 60% of eventual disputes have arrived, and with roughly 9,700 orders per
  arm the test can only detect a change of about 0.19 pp. The margin is 0.15 pp.
- Revenue per customer is up $0.51 (CI -$1.02 to +$2.03), not significant: more customers order,
  but average order value fell 3.3% ($90.37 to $87.39).

## Before the results: the exposure count was wrong

The assignment service split customers evenly. Among customers who logged a `checkout_started`
event, treatment had 15,850 and control 16,451, a 49.07% share (chi-square 11.2, p = 0.0008). That is
a sample ratio mismatch, so I did not read any metric until I found the cause.

Splitting the exposed customers by app build found it. Two builds were far off 50/50 and every
other build was close:

| Build | Control | Treatment | Treatment share |
|---|---:|---:|---:|
| iOS 7.2.0 | 1,352 | 997 | 42.4% |
| Android 5.9.0 | 864 | 639 | 42.5% |
| All other builds and the web | 14,235 | 14,214 | 50.0% |

Both builds shipped the same mobile checkout module on Sep 18 and were replaced by 7.2.1 and 5.9.1
on Sep 25. In treatment, when a customer opened checkout and left without paying, the module
often lost the queued analytics events. Payments are recorded on the server, so buyers were never
lost. The exposed treatment group was therefore missing mostly non-buyers, which pushes its
conversion up.

Measured on everyone, the lift looks like **+4.60 pp**. After removing both builds from both arms,
it is **+2.55 pp**. The build is recorded when the customer is bucketed, before checkout is shown,
so excluding it removes the same kind of customer from each arm. The split after exclusion is
14,214 to 14,235 (p = 0.90).

Payment-side tests could not see this. Every session that reached the payments ledger had its
client event, because the bug only touched sessions that never reached payment. Only a balance
check on exposure found it.

## Results (analysis population, 28,449 customers)

| Metric | Control | Treatment | Difference | 95% CI | p |
|---|---:|---:|---:|---|---:|
| Checkout conversion (primary) | 65.95% | 68.50% | +2.55 pp | +1.46 to +3.64 | <0.0001 |
| Payment submission | 68.64% | 70.66% | +2.02 pp | +0.95 to +3.08 | 0.0002 |
| Authorization rate (guardrail) | 91.72% | 92.49% | +0.78 pp | -0.01 to +1.56 | 0.053 |
| Refund rate (guardrail) | 4.59% | 4.60% | +0.01 pp | -0.58 to +0.60 | 0.97 |
| Dispute rate (guardrail, immature) | 0.23% | 0.34% | +0.11 pp | -0.04 to +0.26 | 0.14 |
| Revenue per customer | $60.33 | $60.84 | +$0.51 | -$1.02 to +$2.03 | 0.51 |
| Average order value | $90.37 | $87.39 | -$2.98 | -$4.67 to -$1.29 | 0.0005 |

Most of the conversion lift comes from more customers submitting a payment (+2.0 pp); the rest
comes from express payments being authorized more often. 36% of treatment orders used the
express wallet.

CUPED on 90-day prior spend reduced the variance of revenue per customer by only 1.8%. Half the
customers are new and have no prior spend, and revenue per customer is mostly driven by whether
someone buys at all. A covariate available for everyone, such as prior sessions, would be the next
thing to try.

## Segments (exploratory, Holm-adjusted)

| Segment | Lift | 95% CI | Holm p |
|---|---:|---|---:|
| Mobile web | +3.80 pp | +2.05 to +5.54 | <0.001 |
| Android app (5.8.3, 5.9.1) | +5.46 pp | +1.54 to +9.37 | 0.019 |
| iOS app (7.1.4, 7.2.1) | +1.29 pp | -1.74 to +4.33 | 0.53 |
| Desktop web | +0.95 pp | -0.73 to +2.64 | 0.53 |
| New customers | +2.87 pp | +1.26 to +4.47 | 0.001 |
| Returning customers | +2.44 pp | +0.97 to +3.91 | 0.001 |

Small screens gain the most and desktop the least, which fits a button that saves typing card
details on a phone. The app segments are small after the exclusion, so their estimates are noisy.
The Android figure in particular should not be quoted on its own.

## The daily view

The result crossed p < 0.05 on day 3 and stayed there. Had the test stopped on day 4, when the
p-value was 0.0001, the reported lift would have been +3.8 pp, about 50% above the final +2.6 pp.
Early estimates that cross a threshold tend to be the high ones, which is why the plan fixed the
horizon at 14 days. Customers first exposed in week 1 show +3.1 pp and week 2 +2.0 pp; the
intervals overlap widely, so this is not evidence that the effect is fading.

## Check against the known answer

The model simulated every customer under both versions, so the true lift in the analysis
population is known: **+2.39 pp**. The readout's +2.55 pp is within its confidence interval; the
naive +4.60 pp is not. True platform lifts (all builds) are mobile web +3.56, Android +3.04, iOS +2.76 and
desktop +0.83, which confirms that the Android estimate (+5.46) is high and the iOS one (+1.29)
low by chance. At full maturity the model's dispute rates are 0.520% (control) and 0.537%
(treatment), so the +0.11 pp seen today is mostly noise. The readout could not have known that,
which is why the guardrail stays open.

## What I would do next

1. Roll out to 95%, keep a 5% card-form holdout, and re-read disputes on Dec 26, 2026 against the
   0.15 pp margin. Watch express orders from new customers separately, since that is where a fraud
   problem would show first.
2. Log exposure on the server when checkout renders, so a client bug cannot remove customers from
   the denominator again.
3. Keep `srm_exposed_by_build` as a standing check on every experiment that runs in the apps.
4. Look at basket composition to see whether the 3.3% drop in order value is smaller baskets or
   new, smaller buyers. The test cannot separate the two.
