"""Write the synthetic raw data to data/raw/*.csv and the model's known answers to outputs/model_truth.json.

Usage: python3 python/generate_data.py
"""
import csv
import hashlib
import json
from collections import defaultdict
from datetime import timedelta
from pathlib import Path

import experiment_model as m

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "outputs"

DICTIONARY = [
    ("assignments", "customer_id", "text", "Primary key. One row per customer bucketed into the experiment (server-side assignment service)."),
    ("assignments", "experiment_id", "text", "Always express_checkout_v1."),
    ("assignments", "variant", "text", "control (card form only) or treatment (card form plus an express wallet button)."),
    ("assignments", "assigned_at", "timestamp", "When the customer was bucketed, on their first visit during the test (Sep 14 to 27, 2026)."),
    ("assignments", "platform", "text", "desktop_web, mobile_web, ios_app or android_app, fixed per customer."),
    ("assignments", "app_version", "text", "App build at bucketing; blank on the web. iOS 7.2.0 and Android 5.9.0 carry the planted logging bug."),
    ("customers", "customer_id", "text", "Primary key, foreign key to assignments."),
    ("customers", "country", "text", "CA or US."),
    ("customers", "customer_type", "text", "new (no previous order) or returning."),
    ("customers", "prior_orders_90d", "integer", "Orders in the 90 days before the test. Pre-experiment covariate."),
    ("customers", "prior_spend_90d_cad", "numeric", "Spend in the 90 days before the test. Used for CUPED."),
    ("checkout_events", "event_id", "text", "Client analytics event ID. Not unique in raw: SDK retries resend the same event."),
    ("checkout_events", "event_name", "text", "checkout_started (every session) or express_button_shown (treatment sessions only)."),
    ("checkout_events", "customer_id", "text", "Foreign key to assignments."),
    ("checkout_events", "session_id", "text", "Checkout session; joins to payment_attempts."),
    ("checkout_events", "event_at", "timestamp", "Client timestamp."),
    ("checkout_events", "received_at", "timestamp", "When the analytics collector received it; differs between duplicates."),
    ("checkout_events", "platform", "text", "Client platform."),
    ("checkout_events", "app_version", "text", "Client build; blank on the web."),
    ("payment_attempts", "attempt_id", "text", "Primary key. Server-side payments ledger."),
    ("payment_attempts", "session_id", "text", "Checkout session the attempt belongs to."),
    ("payment_attempts", "customer_id", "text", "Foreign key to assignments."),
    ("payment_attempts", "created_at", "timestamp", "Attempt time."),
    ("payment_attempts", "payment_method", "text", "card_form or express_wallet (treatment only)."),
    ("payment_attempts", "amount_cad", "numeric", "Order amount in CAD."),
    ("payment_attempts", "outcome", "text", "authorized or declined."),
    ("payment_attempts", "decline_code", "text", "Blank when authorized."),
    ("refunds", "refund_id", "text", "Primary key."),
    ("refunds", "attempt_id", "text", "Foreign key to an authorized payment attempt."),
    ("refunds", "refunded_at", "timestamp", "Refund time."),
    ("refunds", "amount_cad", "numeric", "Full refunds only in this model."),
    ("disputes", "dispute_id", "text", "Primary key."),
    ("disputes", "attempt_id", "text", "Foreign key to an authorized payment attempt."),
    ("disputes", "created_at", "timestamp", "When the dispute arrived. Only disputes on or before Oct 25, 2026 (data cutoff) are present."),
    ("disputes", "amount_cad", "numeric", "Disputed amount."),
    ("disputes", "reason", "text", "fraudulent, product_not_received, product_unacceptable, duplicate or subscription_canceled."),
]


def ts(d):
    return d.strftime("%Y-%m-%d %H:%M:%S")


def write(name, header, rows):
    with open(RAW / f"{name}.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def event_id(session_id, name):
    return "ev_" + hashlib.sha256(f"{session_id}:{name}".encode()).hexdigest()[:14]


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(exist_ok=True)
    assignments, customers, events, attempts, refunds, disputes = [], [], [], [], [], []
    truth = defaultdict(lambda: defaultdict(float))

    for i in range(m.visitor_count()):
        v = m.make_visitor(i)
        cid = v["customer_id"]
        assignments.append((cid, m.EXPERIMENT_ID, v["variant"], ts(v["assigned_at"]), v["platform"], v["app_version"]))
        customers.append((cid, v["country"], "returning" if v["returning"] else "new",
                          v["prior_orders_90d"], f"{v['prior_spend_90d']:.2f}"))
        both = {arm: m.simulate(v, arm) for arm in ("control", "treatment")}
        obs = both[v["variant"]]

        if v["reaches_checkout"]:
            # Potential outcomes for every customer who reached checkout, logged or not.
            pops = ["all_exposed", f"platform:{v['platform']}",
                    f"customer_type:{'returning' if v['returning'] else 'new'}"]
            if v["app_version"] not in m.BUGGY_APP_VERSIONS:
                pops.append("analysis_population")
            for pop in pops:
                t = truth[pop]
                t["n"] += 1
                t["conv_control"] += both["control"]["converted"]
                t["conv_treatment"] += both["treatment"]["converted"]
                t["rev_control"] += both["control"]["revenue"]
                t["rev_treatment"] += both["treatment"]["revenue"]
                for arm in ("control", "treatment"):
                    orders = sum(a["outcome"] == "authorized" for a in both[arm]["attempts"])
                    t[f"orders_{arm}"] += orders
                    t[f"disputes_all_{arm}"] += len(both[arm]["disputes"])

        for s in obs["sessions"]:
            if not s["client_logged"]:
                continue
            names = ["checkout_started"] + (["express_button_shown"] if v["variant"] == "treatment" else [])
            for k, name in enumerate(names):
                at = s["started_at"] + timedelta(seconds=k * 2)
                row = [event_id(s["session_id"], name), name, cid, s["session_id"], ts(at),
                       ts(at + timedelta(seconds=3)), v["platform"], v["app_version"]]
                events.append(row)
                if s["duplicate_event"]:
                    events.append(row[:5] + [ts(at + timedelta(seconds=41))] + row[6:])
        for a in obs["attempts"]:
            attempts.append((a["attempt_id"], a["session_id"], cid, ts(a["created_at"]), a["payment_method"],
                             f"{a['amount_cad']:.2f}", a["outcome"], a["decline_code"]))
        for r in obs["refunds"]:
            refunds.append((r["refund_id"], r["attempt_id"], ts(r["refunded_at"]), f"{r['amount_cad']:.2f}"))
        for d in obs["disputes"]:
            if d["created_at"] <= m.DATA_CUTOFF:
                disputes.append((d["dispute_id"], d["attempt_id"], ts(d["created_at"]), f"{d['amount_cad']:.2f}", d["reason"]))

    assignments.sort(key=lambda r: r[3])
    events.sort(key=lambda r: (r[5], r[0]))
    attempts.sort(key=lambda r: r[3])
    refunds.sort(key=lambda r: r[2])
    disputes.sort(key=lambda r: r[2])
    write("assignments", ["customer_id", "experiment_id", "variant", "assigned_at", "platform", "app_version"], assignments)
    write("customers", ["customer_id", "country", "customer_type", "prior_orders_90d", "prior_spend_90d_cad"],
          sorted(customers))
    write("checkout_events", ["event_id", "event_name", "customer_id", "session_id", "event_at", "received_at",
                              "platform", "app_version"], events)
    write("payment_attempts", ["attempt_id", "session_id", "customer_id", "created_at", "payment_method",
                               "amount_cad", "outcome", "decline_code"], attempts)
    write("refunds", ["refund_id", "attempt_id", "refunded_at", "amount_cad"], refunds)
    write("disputes", ["dispute_id", "attempt_id", "created_at", "amount_cad", "reason"], disputes)
    with open(ROOT / "data" / "data_dictionary.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["table", "column", "type", "description"])
        w.writerows(DICTIONARY)

    out = {}
    for pop, t in sorted(truth.items()):
        n = t["n"]
        out[pop] = {
            "customers": int(n),
            "conversion_control_pct": round(100 * t["conv_control"] / n, 2),
            "conversion_treatment_pct": round(100 * t["conv_treatment"] / n, 2),
            "true_conversion_lift_pp": round(100 * (t["conv_treatment"] - t["conv_control"]) / n, 2),
            "true_revenue_per_customer_diff_cad": round((t["rev_treatment"] - t["rev_control"]) / n, 2),
            "dispute_rate_full_maturity_control_pct": round(100 * t["disputes_all_control"] / t["orders_control"], 3),
            "dispute_rate_full_maturity_treatment_pct": round(100 * t["disputes_all_treatment"] / t["orders_treatment"], 3),
        }
    (OUT / "model_truth.json").write_text(json.dumps({
        "note": "Each customer simulated under both versions with the same random draws. Not used by the analysis; "
                "only for checking the readout against the known answer.",
        "populations": out}, indent=2))
    print(f"assignments {len(assignments):,}  checkout_events {len(events):,}  payment_attempts {len(attempts):,}  "
          f"refunds {len(refunds):,}  disputes {len(disputes):,}")
    print(json.dumps(out.get("all_exposed"), indent=2))
    print(json.dumps(out.get("analysis_population"), indent=2))


if __name__ == "__main__":
    main()
