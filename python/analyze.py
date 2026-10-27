"""Experiment readout: trust checks, primary and guardrail metrics, CUPED, segments and the daily view.

Usage: python3 python/analyze.py   (run after pipeline.py)
Writes outputs/results.json and docs/results.md. Every metric comes from the semantic layer.
"""
import json
import math
import sqlite3
from datetime import timedelta
from pathlib import Path
from statistics import NormalDist

import ab_stats as st
import experiment_model as m
import semantic_layer as sl

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "outputs"

# Pre-registered plan (docs/experiment_plan.md), fixed before launch.
PLAN = {"baseline_conversion": 0.66, "mde_pp": 1.5, "alpha": 0.05, "power": 0.8, "days": 14,
        "expected_exposed_per_arm": 16000}
GUARDRAIL_METRICS = ["authorization_rate", "refund_rate", "dispute_rate"]
SECONDARY = ["payment_submission_rate", "average_order_value", "express_share_of_orders"]


def by_variant(conn, metric, population="analysis", dims=("variant",), extra_where=None):
    rows = sl.query(conn, sl.stats_sql(metric, dims, population, extra_where))
    return rows


def split(rows, key=None):
    """Group stats rows into {segment: {variant: stats}}."""
    out = {}
    for r in rows:
        seg = r[key] if key else "all"
        out.setdefault(seg, {})[r["variant"]] = r
    return out


def effect(conn, metric, population="analysis", extra_where=None):
    g = split(by_variant(conn, metric, population, extra_where=extra_where))["all"]
    return st.compare(g["control"], g["treatment"])


def guardrail_verdict(metric, res):
    spec = sl.SPEC["metrics"][metric]
    margin = spec["guardrail"]["max_harm_pp"] / 100
    harm_hi = -res["ci_low"] if spec["desired_direction"] == "increase" else res["ci_high"]
    harm_point = -res["diff"] if spec["desired_direction"] == "increase" else res["diff"]
    if harm_hi < margin:
        verdict = "pass"
    elif harm_point > 0 and res["p_value"] < 0.05:
        verdict = "fail"
    else:
        verdict = "inconclusive"
    return {"margin_pp": margin * 100, "worst_plausible_harm_pp": harm_hi * 100, "verdict": verdict}


def daily_view(conn):
    """How the primary result would have looked at the end of each day (cumulative)."""
    rows = conn.execute(f"""
        SELECT variant, exposure_date, converted, first_order_at
        FROM exp_customers WHERE {sl.SPEC['populations']['analysis']['where']}""").fetchall()
    out = []
    for k in range(1, m.DAYS + 1):
        cutoff = m.START + timedelta(days=k)
        day = (cutoff - timedelta(days=1)).strftime("%Y-%m-%d")
        stats = {}
        for variant in ("control", "treatment"):
            n = x = 0
            for v, d, conv, first_order in rows:
                if v == variant and d <= day:
                    n += 1
                    x += 1 if conv and first_order < cutoff.strftime("%Y-%m-%d %H:%M:%S") else 0
            stats[variant] = {"n": n, "sx": x, "sy": n, "sxx": x, "syy": n, "sxy": x}
        r = st.compare(stats["control"], stats["treatment"])
        out.append({"day": k, "date": day, "n": r["n_control"] + r["n_treatment"],
                    "control_pct": 100 * r["control"], "treatment_pct": 100 * r["treatment"],
                    "lift_pp": 100 * r["diff"], "ci_low_pp": 100 * r["ci_low"], "ci_high_pp": 100 * r["ci_high"],
                    "p_value": r["p_value"]})
    return out


def dispute_maturity(conn):
    """Orders' observation windows, and the share of eventual disputes expected to have arrived,
    using the assumed historical lag curve (lognormal, docs/assumptions.md)."""
    days = [r[0] for r in conn.execute(
        f"""SELECT o.days_observed FROM fct_orders o JOIN exp_customers c ON c.customer_id = o.customer_id
            WHERE {sl.SPEC['populations']['analysis']['where'].replace('exposed', 'c.exposed').replace('excluded_reason', 'c.excluded_reason')}""")]
    z = NormalDist()

    def arrived(d):
        return 0.0 if d <= 2 else z.cdf(math.log((d - 2) / m.DISPUTE_LAG_MEDIAN_DAYS) / m.DISPUTE_LAG_SIGMA)

    curve = [{"day": d, "share_arrived_pct": round(100 * arrived(d), 1)} for d in range(0, 121, 5)]
    return {"min_days_observed": round(min(days), 1), "max_days_observed": round(max(days), 1),
            "expected_share_arrived_pct": round(100 * sum(arrived(d) for d in days) / len(days), 1),
            "days_for_95pct": next(c["day"] for c in curve if c["share_arrived_pct"] >= 95), "lag_curve": curve}


def pct(v, d=2):
    return round(100 * v, d)


def summarize(metric, res):
    fmt = sl.SPEC["metrics"][metric]["format"]
    k = 100 if fmt == "percent" else 1
    keep = {"control": res["control"] * k, "treatment": res["treatment"] * k, "diff": res["diff"] * k,
            "ci_low": res["ci_low"] * k, "ci_high": res["ci_high"] * k, "p_value": res["p_value"],
            "n_control": res["n_control"], "n_treatment": res["n_treatment"]}
    if "rel_lift" in res:
        keep.update(rel_lift_pct=100 * res["rel_lift"], rel_ci_low_pct=100 * res["rel_ci_low"],
                    rel_ci_high_pct=100 * res["rel_ci_high"])
    for extra in ("theta", "variance_reduction"):
        if extra in res:
            keep[extra] = res[extra]
    keep = {a: (round(b, 6) if isinstance(b, float) and a in ("p_value",) else round(b, 4) if isinstance(b, float) else b)
            for a, b in keep.items()}
    keep.update(label=sl.SPEC["metrics"][metric]["label"], format=fmt, role=sl.SPEC["metrics"][metric]["role"])
    return keep


def main():
    conn = sqlite3.connect(OUT / "experiment.db")
    R = {"experiment_id": m.EXPERIMENT_ID, "window": {"start": m.START.strftime("%Y-%m-%d"),
         "end": (m.END - timedelta(days=1)).strftime("%Y-%m-%d"), "data_cutoff": m.DATA_CUTOFF.strftime("%Y-%m-%d")}}

    # ---- plan and power ------------------------------------------------------------------------
    n_plan = st.sample_size_per_arm(PLAN["baseline_conversion"], PLAN["mde_pp"] / 100, PLAN["alpha"], PLAN["power"])
    R["plan"] = dict(PLAN, required_per_arm=n_plan)

    # ---- trust checks: sample ratio mismatch -----------------------------------------------------
    srm = {}
    for pop in ("assigned", "exposed", "analysis"):
        c = split(by_variant(conn, "checkout_conversion", pop))["all"]
        srm[pop] = st.srm(c["control"]["n"], c["treatment"]["n"])
    by_build = []
    for r in sl.query(conn, f"""SELECT platform, app_version, SUM(variant = 'control') AS c, SUM(variant = 'treatment') AS t
                               FROM exp_customers WHERE exposed = 1 GROUP BY platform, app_version
                               ORDER BY platform, app_version"""):
        s = st.srm(r["c"], r["t"])
        bad = conn.execute("SELECT 1 FROM known_bad_builds WHERE app_version = ?", (r["app_version"],)).fetchone()
        by_build.append({"platform": r["platform"], "app_version": r["app_version"], "control": r["c"], "treatment": r["t"],
                         "treatment_share_pct": round(100 * s["treatment_share"], 1), "chi_square": round(s["chi_square"], 2),
                         "p_value": s["p_value"], "excluded": bool(bad)})
    R["srm"] = {k: {**v, "treatment_share": round(100 * v["treatment_share"], 2), "chi_square": round(v["chi_square"], 2)}
                for k, v in srm.items()}
    R["srm_by_build"] = by_build

    # ---- primary metric: naive (biased) vs corrected ----------------------------------------------
    naive = effect(conn, "checkout_conversion", "exposed")
    primary = effect(conn, "checkout_conversion", "analysis")
    R["primary_naive"] = summarize("checkout_conversion", naive)
    R["primary"] = summarize("checkout_conversion", primary)
    n_arm = (primary["n_control"] + primary["n_treatment"]) / 2
    R["plan"]["achieved_per_arm"] = round(n_arm)
    R["plan"]["achieved_mde_pp"] = round(100 * st.mde_per_arm(primary["control"], n_arm), 2)

    # ---- secondary, diagnostic and guardrail metrics ---------------------------------------------
    R["metrics"] = {}
    for metric in SECONDARY + GUARDRAIL_METRICS:
        R["metrics"][metric] = summarize(metric, effect(conn, metric))
    g = split(by_variant(conn, "revenue_per_customer"))["all"]
    R["metrics"]["revenue_per_customer"] = summarize("revenue_per_customer", st.compare(g["control"], g["treatment"]))
    R["metrics"]["revenue_per_customer_cuped"] = summarize("revenue_per_customer", st.cuped_compare(g["control"], g["treatment"]))
    R["guardrails"] = {}
    for metric in GUARDRAIL_METRICS:
        R["guardrails"][metric] = guardrail_verdict(metric, effect(conn, metric))
    dr = R["metrics"]["dispute_rate"]
    orders_arm = sum(conn.execute(sl.value_sql("dispute_rate").replace(";", "")).fetchall()[i][2] for i in (0, 1)) / 2
    R["dispute"] = dispute_maturity(conn)
    R["dispute"]["orders_per_arm"] = round(orders_arm)
    R["dispute"]["mde_pp_now"] = round(100 * st.mde_per_arm(dr["control"] / 100, orders_arm), 3)

    # ---- segments (exploratory, Holm-adjusted within each family) ----------------------------------
    R["segments"] = {}
    for dim in ("platform", "customer_type"):
        groups = split(by_variant(conn, "checkout_conversion", dims=("variant", dim)), dim)
        rows = [dict(segment=seg, **summarize("checkout_conversion", st.compare(v["control"], v["treatment"])))
                for seg, v in sorted(groups.items())]
        for row, adj in zip(rows, st.holm([r["p_value"] for r in rows])):
            row["p_holm"] = round(adj, 6)
        R["segments"][dim] = rows

    # ---- novelty: first-week vs second-week exposure cohorts -------------------------------------
    second_week = (m.START + timedelta(days=7)).strftime("%Y-%m-%d")
    R["cohorts"] = {
        "week_1": summarize("checkout_conversion", effect(conn, "checkout_conversion", extra_where=f"exposure_date < '{second_week}'")),
        "week_2": summarize("checkout_conversion", effect(conn, "checkout_conversion", extra_where=f"exposure_date >= '{second_week}'")),
    }
    R["daily"] = [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in d.items()} for d in daily_view(conn)]
    R["early_significant_days"] = [d["day"] for d in R["daily"] if d["p_value"] < 0.05 and d["day"] < m.DAYS]

    # ---- funnel ---------------------------------------------------------------------------------
    R["funnel"] = {
        variant: {
            "reached_checkout": R["primary"][f"n_{variant}"],
            "submitted_payment_pct": R["metrics"]["payment_submission_rate"][variant],
            "converted_pct": R["primary"][variant],
        } for variant in ("control", "treatment")}

    # ---- check against the model's known answer --------------------------------------------------
    truth = json.loads((OUT / "model_truth.json").read_text())["populations"]
    R["truth_check"] = {
        "true_lift_pp_analysis_population": truth["analysis_population"]["true_conversion_lift_pp"],
        "estimated_lift_pp": R["primary"]["diff"],
        "naive_lift_pp": R["primary_naive"]["diff"],
        "true_revenue_diff_cad": truth["analysis_population"]["true_revenue_per_customer_diff_cad"],
        "true_dispute_rate_full_maturity_pct": {
            "control": truth["analysis_population"]["dispute_rate_full_maturity_control_pct"],
            "treatment": truth["analysis_population"]["dispute_rate_full_maturity_treatment_pct"]},
        "true_lift_pp_by_platform": {k.split(":")[1]: v["true_conversion_lift_pp"] for k, v in truth.items() if k.startswith("platform:")},
    }
    R["compiled_sql_example"] = sl.value_sql("checkout_conversion")

    (OUT / "results.json").write_text(json.dumps(R, indent=2))
    (ROOT / "docs" / "results.md").write_text(to_markdown(R))
    p = R["primary"]
    print(f"SRM exposed p={R['srm']['exposed']['p_value']:.5f}  analysis p={R['srm']['analysis']['p_value']:.3f}")
    print(f"naive lift {R['primary_naive']['diff']:+.2f} pp | corrected {p['diff']:+.2f} pp "
          f"[{p['ci_low']:+.2f}, {p['ci_high']:+.2f}] p={p['p_value']:.2g} | truth {R['truth_check']['true_lift_pp_analysis_population']:+.2f}")
    for k, v in R["metrics"].items():
        print(f"  {k:<28} {v['control']:>9.3f} {v['treatment']:>9.3f} {v['diff']:+8.3f} [{v['ci_low']:+.3f}, {v['ci_high']:+.3f}] p={v['p_value']:.3g}")
    print("guardrails", {k: v["verdict"] for k, v in R["guardrails"].items()})
    print("dispute", {k: v for k, v in R["dispute"].items() if k != "lag_curve"})
    print("cohorts", {k: (round(v["diff"], 2), round(v["p_value"], 4)) for k, v in R["cohorts"].items()})
    print("early significant days", R["early_significant_days"])
    for dim, rows in R["segments"].items():
        for r in rows:
            print(f"  {dim}:{r['segment']:<12} {r['diff']:+.2f} [{r['ci_low']:+.2f}, {r['ci_high']:+.2f}] p={r['p_value']:.3g} holm={r['p_holm']:.3g}")
    print("plan", R["plan"])


def to_markdown(R):
    def row(cells):
        return "| " + " | ".join(str(c) for c in cells) + " |"

    L = ["# Results", "", "Generated by `python/analyze.py` from `outputs/experiment.db`. Synthetic data.", "",
         "## Sample ratio checks", "", row(["Population", "Control", "Treatment", "Treatment share", "Chi-square", "p"]),
         "|---|---:|---:|---:|---:|---:|"]
    for k, v in R["srm"].items():
        L.append(row([k, f"{v['control']:,}", f"{v['treatment']:,}", f"{v['treatment_share']}%", v["chi_square"], f"{v['p_value']:.2g}"]))
    L += ["", "### Exposed customers by app build", "", row(["Platform", "Build", "Control", "Treatment", "Treatment share", "Chi-square", "Excluded"]),
          "|---|---|---:|---:|---:|---:|---|"]
    for b in R["srm_by_build"]:
        L.append(row([b["platform"], b["app_version"], f"{b['control']:,}", f"{b['treatment']:,}", f"{b['treatment_share_pct']}%",
                       b["chi_square"], "yes" if b["excluded"] else ""]))
    L += ["", "## Metrics (analysis population)", "", row(["Metric", "Role", "Control", "Treatment", "Difference", "95% CI", "p"]),
          "|---|---|---:|---:|---:|---|---:|"]
    allm = {"checkout_conversion (naive, exposed)": R["primary_naive"], "checkout_conversion": R["primary"], **R["metrics"]}
    for k, v in allm.items():
        L.append(row([k, v["role"], round(v["control"], 3), round(v["treatment"], 3), f"{v['diff']:+.3f}",
                      f"[{v['ci_low']:+.3f}, {v['ci_high']:+.3f}]", f"{v['p_value']:.2g}"]))
    L += ["", "Percent metrics are in percentage points; currency metrics in CAD.", "", "## Guardrails", "",
          row(["Metric", "Margin (pp)", "Worst plausible harm (pp)", "Verdict"]), "|---|---:|---:|---|"]
    for k, v in R["guardrails"].items():
        L.append(row([k, v["margin_pp"], round(v["worst_plausible_harm_pp"], 3), v["verdict"]]))
    d = R["dispute"]
    L += ["", f"Dispute window: orders observed for {d['min_days_observed']} to {d['max_days_observed']} days; "
              f"about {d['expected_share_arrived_pct']}% of eventual disputes expected to have arrived; "
              f"95% arrive by day {d['days_for_95pct']}. Detectable change today: {d['mde_pp_now']} pp.", "",
          "## Segments (exploratory, Holm-adjusted)", "", row(["Segment", "Control", "Treatment", "Lift (pp)", "95% CI", "p", "Holm p"]),
          "|---|---:|---:|---:|---|---:|---:|"]
    for dim, rows in R["segments"].items():
        for r in rows:
            L.append(row([f"{dim}: {r['segment']}", round(r["control"], 2), round(r["treatment"], 2), f"{r['diff']:+.2f}",
                          f"[{r['ci_low']:+.2f}, {r['ci_high']:+.2f}]", f"{r['p_value']:.2g}", f"{r['p_holm']:.2g}"]))
    L += ["", "## Exposure cohorts", "", row(["Cohort", "Lift (pp)", "95% CI", "p"]), "|---|---:|---|---:|"]
    for k, v in R["cohorts"].items():
        L.append(row([k, f"{v['diff']:+.2f}", f"[{v['ci_low']:+.2f}, {v['ci_high']:+.2f}]", f"{v['p_value']:.2g}"]))
    L += ["", "## Daily cumulative view", "", row(["Day", "Date", "Customers", "Lift (pp)", "95% CI", "p"]), "|---:|---|---:|---:|---|---:|"]
    for x in R["daily"]:
        L.append(row([x["day"], x["date"], f"{x['n']:,}", f"{x['lift_pp']:+.2f}", f"[{x['ci_low_pp']:+.2f}, {x['ci_high_pp']:+.2f}]", f"{x['p_value']:.2g}"]))
    t = R["truth_check"]
    L += ["", "## Check against the model's known answer", "",
          f"True lift in the analysis population: {t['true_lift_pp_analysis_population']:+.2f} pp. "
          f"Estimate: {t['estimated_lift_pp']:+.2f} pp. Naive estimate on the exposed population: {t['naive_lift_pp']:+.2f} pp.", "",
          "## Plan and power", "", "```json", json.dumps(R["plan"], indent=2), "```", ""]
    return "\n".join(L)


if __name__ == "__main__":
    main()
