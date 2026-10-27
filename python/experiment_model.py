"""Synthetic A/B test of an express checkout at a fictional online retailer, Larchway Outfitters.

Each visitor's random draws are made up front from a per-visitor seed (common random numbers),
so every visitor can be simulated under both versions of checkout with the same luck. The
observed data uses the assigned version; the other version gives the true effect in this sample,
which the readout can then be checked against. All parameters are illustrative assumptions,
documented in docs/assumptions.md.
"""
import hashlib
import math
import random
from datetime import datetime, timedelta

SEED = 1409
EXPERIMENT_ID = "express_checkout_v1"
START = datetime(2026, 9, 14)  # Monday
DAYS = 14
END = START + timedelta(days=DAYS)  # exclusive
DATA_CUTOFF = datetime(2026, 10, 25, 23, 59, 59)  # last day of data available at readout

VISITORS_PER_DAY = 5600
DAY_OF_WEEK_WEIGHT = [0.96, 0.94, 0.95, 0.98, 1.04, 1.08, 1.05]  # Monday first
HOUR_WEIGHT = [1, 1, 1, 1, 1, 2, 3, 5, 6, 6, 6, 6, 7, 7, 6, 6, 6, 7, 8, 9, 10, 9, 6, 3]

PLATFORMS = [("desktop_web", 0.34), ("mobile_web", 0.38), ("ios_app", 0.17), ("android_app", 0.11)]
COUNTRIES = [("CA", 0.72), ("US", 0.28)]
RETURNING_SHARE = 0.45

# Who reaches checkout during the test (decided before any checkout is shown).
REACH_BASE = 0.36
REACH_RETURNING = 0.10
REACH_APP = 0.05
EXTRA_SESSIONS_MEAN = 0.35  # extra checkout sessions after an abandoned one
REPEAT_PURCHASE = 0.10  # chance a further session happens after a purchase

# Chance a checkout session submits a payment.
SUBMIT_BASE = {"desktop_web": 0.66, "mobile_web": 0.52, "ios_app": 0.62, "android_app": 0.58}
SUBMIT_RETURNING = 0.07
SUBMIT_PER_PRIOR_ORDER = 0.015  # up to three prior orders in the last 90 days
SUBMIT_US = -0.02
# Planted treatment effect: showing the express button lifts submission, most on small screens.
EXPRESS_SUBMIT_LIFT = {"desktop_web": 0.006, "mobile_web": 0.035, "ios_app": 0.025, "android_app": 0.025}
EXPRESS_ADOPTION = {"desktop_web": 0.18, "mobile_web": 0.42, "ios_app": 0.38, "android_app": 0.36}
EXPRESS_ADOPTION_RETURNING = 0.08

# Authorization.
AUTH_BASE = {"CA": 0.935, "US": 0.905}
AUTH_NEW_CUSTOMER = -0.012
EXPRESS_AUTH_LIFT = 0.035  # stored, tokenized credentials: fewer typos and expired cards
RETRY_PROB = 0.5
RETRY_AUTH_PENALTY = 0.15
MAX_ATTEMPTS = 3
DECLINE_CODES = {
    "card_form": [("insufficient_funds", 0.34), ("generic_decline", 0.30), ("incorrect_cvc", 0.18),
                  ("expired_card", 0.10), ("do_not_honor", 0.08)],
    "express_wallet": [("insufficient_funds", 0.45), ("generic_decline", 0.40), ("do_not_honor", 0.15)],
}

# Orders, refunds and disputes.
AOV_MEDIAN = 74.0
AOV_SIGMA = 0.55
AOV_SPEND_ELASTICITY = 0.6
EXPRESS_AOV_FACTOR = 0.97  # slightly smaller baskets
SPEND_SIGMA = 0.45  # spread of each customer's latent spending level
PRIOR_ORDERS_MEAN = 0.9  # returning customers, last 90 days, scaled by spending level
REFUND_RATE = 0.045
DISPUTE_RATE = {"returning": 0.0040, "new": 0.0068}
EXPRESS_NEW_DISPUTE_FACTOR = 1.35  # planted: more disputes on express orders from new customers
DISPUTE_LAG_MEDIAN_DAYS = 28
DISPUTE_LAG_SIGMA = 0.6
DISPUTE_REASONS = [("fraudulent", 0.52), ("product_not_received", 0.24), ("product_unacceptable", 0.14),
                   ("duplicate", 0.05), ("subscription_canceled", 0.05)]

# Planted logging bug: a shared mobile checkout module, shipped in iOS 7.2.0 and Android 5.9.0,
# drops queued analytics events when a treatment session is abandoned (opening the wallet sheet
# resets the event queue). Payments are logged server-side and survive. Hotfixed in 7.2.1 / 5.9.1.
APP_BUILDS = {
    "ios_app": ("7.1.4", "7.2.0", "7.2.1"),
    "android_app": ("5.8.3", "5.9.0", "5.9.1"),
}
BUGGY_APP_VERSIONS = ("7.2.0", "5.9.0")
BUG_RELEASE_DAY = 4  # Friday Sep 18
HOTFIX_DAY = 11  # Friday Sep 25
BUG_DROP_RATE = 0.85
CLIENT_DUPLICATE_RATE = 0.022  # analytics SDK retries that resend the same event_id

MAX_SESSIONS = 5


def pick(rng, options):
    r, acc = rng.random(), 0.0
    for value, weight in options:
        acc += weight
        if r < acc:
            return value
    return options[-1][0]


def pick_u(u, options):
    acc = 0.0
    for value, weight in options:
        acc += weight
        if u < acc:
            return value
    return options[-1][0]


def poisson(rng, mean):
    l, k, p = math.exp(-mean), 0, 1.0
    while True:
        p *= rng.random()
        if p <= l:
            return k
        k += 1


def variant_for(customer_id):
    """Deterministic 50/50 bucketing on a salted hash, as an assignment service would do it."""
    h = int(hashlib.sha256(f"{EXPERIMENT_ID}:{customer_id}".encode()).hexdigest()[:8], 16)
    return "treatment" if h % 10000 < 5000 else "control"


def app_version(rng, platform, day):
    """Build at bucketing. Most app users update within a day of a release; a tail stays behind."""
    if platform not in APP_BUILDS:
        return ""
    old, buggy, fixed = APP_BUILDS[platform]
    if day < BUG_RELEASE_DAY:
        return old
    if day < HOTFIX_DAY:
        return pick(rng, [(buggy, 0.80), (old, 0.20)])
    return pick(rng, [(fixed, 0.70), (buggy, 0.12), (old, 0.18)])


def make_visitor(i):
    """Visitor attributes plus every random draw the simulation will need."""
    rng = random.Random(f"{SEED}-{i}")
    v = {"idx": i, "customer_id": f"cu_{rng.getrandbits(40):010x}"}
    weights = [DAY_OF_WEEK_WEIGHT[d % 7] for d in range(DAYS)]
    day = rng.choices(range(DAYS), weights=weights)[0]
    hour = rng.choices(range(24), weights=HOUR_WEIGHT)[0]
    v["assigned_at"] = START + timedelta(days=day, hours=hour, seconds=rng.randrange(3600))
    v["platform"] = pick(rng, PLATFORMS)
    v["app_version"] = app_version(rng, v["platform"], day)
    v["country"] = pick(rng, COUNTRIES)
    v["returning"] = rng.random() < RETURNING_SHARE
    mult = math.exp(rng.gauss(0, SPEND_SIGMA))
    v["prior_orders_90d"], v["prior_spend_90d"] = 0, 0.0
    if v["returning"]:
        v["prior_orders_90d"] = poisson(rng, PRIOR_ORDERS_MEAN * mult)
        for _ in range(v["prior_orders_90d"]):
            v["prior_spend_90d"] += order_amount(mult, rng.gauss(0, 1), False)
    v["spend_mult"] = mult
    reach = REACH_BASE + REACH_RETURNING * v["returning"] + REACH_APP * v["platform"].endswith("app")
    v["reaches_checkout"] = rng.random() < reach
    v["n_sessions"] = min(MAX_SESSIONS, 1 + poisson(rng, EXTRA_SESSIONS_MEAN))
    v["first_delay_min"] = rng.expovariate(1 / 25)
    v["sessions"] = [{
        "gap_hours": rng.uniform(0.2, 72), "u_submit": rng.random(), "u_method": rng.random(),
        "u_auth": [rng.random() for _ in range(MAX_ATTEMPTS)], "u_retry": [rng.random() for _ in range(MAX_ATTEMPTS)],
        "u_code": [rng.random() for _ in range(MAX_ATTEMPTS)], "submit_min": rng.uniform(2, 9),
        "retry_min": [rng.uniform(0.5, 3) for _ in range(MAX_ATTEMPTS)], "z_amount": rng.gauss(0, 1),
        "u_refund": rng.random(), "refund_days": rng.uniform(2, 25), "u_dispute": rng.random(),
        "z_lag": rng.gauss(0, 1), "u_reason": rng.random(), "u_repeat": rng.random(), "u_bug": rng.random(),
        "u_dup": rng.random(), "id_bits": rng.getrandbits(40),
    } for _ in range(MAX_SESSIONS)]
    v["variant"] = variant_for(v["customer_id"])
    return v


def order_amount(mult, z, express):
    amount = AOV_MEDIAN * mult ** AOV_SPEND_ELASTICITY * math.exp(AOV_SIGMA * z)
    return round(amount * (EXPRESS_AOV_FACTOR if express else 1.0), 2)


def simulate(v, arm):
    """Checkout sessions, payment attempts, refunds and disputes for one visitor under one arm."""
    out = {"sessions": [], "attempts": [], "refunds": [], "disputes": [], "converted": False, "revenue": 0.0}
    if not v["reaches_checkout"]:
        return out
    treat = arm == "treatment"
    ctype = "returning" if v["returning"] else "new"
    t = v["assigned_at"] + timedelta(minutes=v["first_delay_min"])
    for k in range(v["n_sessions"]):
        s = v["sessions"][k]
        if k > 0:
            if out["converted"] and s["u_repeat"] > REPEAT_PURCHASE:
                break
            t = t + timedelta(hours=s["gap_hours"])
        if t >= END:
            break
        sid = f"cs_{s['id_bits']:010x}"
        sess = {"session_id": sid, "started_at": t, "attempted": False}
        p_submit = (SUBMIT_BASE[v["platform"]] + SUBMIT_RETURNING * v["returning"]
                    + SUBMIT_PER_PRIOR_ORDER * min(v["prior_orders_90d"], 3)
                    + SUBMIT_US * (v["country"] == "US") + (EXPRESS_SUBMIT_LIFT[v["platform"]] if treat else 0))
        if s["u_submit"] < p_submit:
            sess["attempted"] = True
            adopt = EXPRESS_ADOPTION[v["platform"]] + EXPRESS_ADOPTION_RETURNING * v["returning"]
            method = "express_wallet" if treat and s["u_method"] < adopt else "card_form"
            p_auth = AUTH_BASE[v["country"]] + (AUTH_NEW_CUSTOMER if not v["returning"] else 0) + (
                EXPRESS_AUTH_LIFT if method == "express_wallet" else 0)
            amount = order_amount(v["spend_mult"], s["z_amount"], method == "express_wallet")
            at = t + timedelta(minutes=s["submit_min"])
            for j in range(MAX_ATTEMPTS):
                if j > 0:
                    if s["u_retry"][j] >= RETRY_PROB:
                        break
                    at = at + timedelta(minutes=s["retry_min"][j])
                ok = s["u_auth"][j] < p_auth - (RETRY_AUTH_PENALTY if j > 0 else 0)
                att = {"attempt_id": f"pa_{s['id_bits']:010x}{j}", "session_id": sid, "created_at": at,
                       "payment_method": method, "amount_cad": amount, "outcome": "authorized" if ok else "declined",
                       "decline_code": "" if ok else pick_u(s["u_code"][j], DECLINE_CODES[method])}
                out["attempts"].append(att)
                if ok:
                    out["converted"] = True
                    out["revenue"] += amount
                    if s["u_refund"] < REFUND_RATE:
                        out["refunds"].append({"refund_id": f"re_{s['id_bits']:010x}", "attempt_id": att["attempt_id"],
                                               "refunded_at": at + timedelta(days=s["refund_days"]), "amount_cad": amount})
                    else:
                        rate = DISPUTE_RATE[ctype] * (
                            EXPRESS_NEW_DISPUTE_FACTOR if method == "express_wallet" and ctype == "new" else 1)
                        if s["u_dispute"] < rate:
                            lag = 2 + DISPUTE_LAG_MEDIAN_DAYS * math.exp(DISPUTE_LAG_SIGMA * s["z_lag"])
                            out["disputes"].append({"dispute_id": f"dp_{s['id_bits']:010x}", "attempt_id": att["attempt_id"],
                                                    "created_at": at + timedelta(days=lag), "amount_cad": amount,
                                                    "reason": pick_u(s["u_reason"], DISPUTE_REASONS)})
                    break
        # The logging bug only bites abandoned treatment sessions on the buggy app builds.
        sess["client_logged"] = not (treat and v["app_version"] in BUGGY_APP_VERSIONS
                                     and not sess["attempted"] and s["u_bug"] < BUG_DROP_RATE)
        sess["duplicate_event"] = s["u_dup"] < CLIENT_DUPLICATE_RATE
        out["sessions"].append(sess)
    return out


def visitor_count():
    return round(VISITORS_PER_DAY * DAYS)
