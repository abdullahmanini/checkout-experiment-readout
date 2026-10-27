"""A small metrics semantic layer: metric definitions in metrics/semantic_layer.json, compiled to SQL.

Every metric is a ratio of two measures summed over customers (the randomization unit). Two kinds
of SQL come out of one definition:
  - value SQL: the metric by any dimensions, for dashboards and reports;
  - stats SQL: the sufficient statistics (n, sums, sums of squares and cross-products) that the
    delta method and CUPED need, so variance is computed from the same definition as the value.

Usage: python3 python/semantic_layer.py   (writes sql/compiled/*.sql for the readout's metrics)
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = json.loads((ROOT / "metrics" / "semantic_layer.json").read_text())


def _parts(metric, dims, population):
    if metric not in SPEC["metrics"]:
        raise KeyError(f"unknown metric {metric!r}")
    m = SPEC["metrics"][metric]
    for d in dims:
        if d not in SPEC["dimensions"]:
            raise KeyError(f"unknown dimension {d!r}")
    x = SPEC["measures"][m["numerator"]]["expr"]
    y = SPEC["measures"][m["denominator"]]["expr"]
    dim_cols = [f"{SPEC['dimensions'][d]['expr']} AS {d}" for d in dims]
    where = SPEC["populations"][population]["where"]
    return m, x, y, dim_cols, where


def value_sql(metric, dims=("variant",), population="analysis", extra_where=None):
    """Readable SQL for the metric value by dimensions."""
    m, x, y, dim_cols, where = _parts(metric, dims, population)
    if extra_where:
        where = f"({where}) AND ({extra_where})"
    select = dim_cols + [
        f"SUM({x}) AS {m['numerator']}",
        f"SUM({y}) AS {m['denominator']}",
        f"1.0 * SUM({x}) / NULLIF(SUM({y}), 0) AS {metric}",
    ]
    group = f"\nGROUP BY {', '.join(dims)}\nORDER BY {', '.join(dims)}" if dims else ""
    return (f"-- {m['label']}: {m['description']}\n"
            f"SELECT {(',' + chr(10) + '       ').join(select)}\n"
            f"FROM {SPEC['semantic_model']['table']}\n"
            f"WHERE {where}{group};\n")


def stats_sql(metric, dims=("variant",), population="analysis", extra_where=None):
    """Sufficient statistics per group: x is the numerator, y the denominator, c the covariate."""
    m, x, y, dim_cols, where = _parts(metric, dims, population)
    if extra_where:
        where = f"({where}) AND ({extra_where})"
    cols = dim_cols + [
        "COUNT(*) AS n",
        f"SUM({x}) AS sx", f"SUM({y}) AS sy",
        f"SUM(({x}) * ({x})) AS sxx", f"SUM(({y}) * ({y})) AS syy", f"SUM(({x}) * ({y})) AS sxy",
    ]
    if "covariate" in m:
        c = SPEC["measures"][m["covariate"]]["expr"]
        cols += [f"SUM({c}) AS sc", f"SUM(({c}) * ({c})) AS scc", f"SUM(({x}) * ({c})) AS sxc"]
    group = f"\nGROUP BY {', '.join(dims)}" if dims else ""
    return (f"SELECT {(',' + chr(10) + '       ').join(cols)}\n"
            f"FROM {SPEC['semantic_model']['table']}\n"
            f"WHERE {where}{group};\n")


def query(conn, sql):
    cur = conn.execute(sql)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def main():
    out = ROOT / "sql" / "compiled"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.sql"):
        old.unlink()
    for metric in SPEC["metrics"]:
        (out / f"{metric}__by_variant.sql").write_text(value_sql(metric))
        (out / f"{metric}__stats_by_variant.sql").write_text(stats_sql(metric))
    (out / "checkout_conversion__by_variant_platform.sql").write_text(
        value_sql("checkout_conversion", ("variant", "platform")))
    print(f"wrote {len(list(out.glob('*.sql')))} files to sql/compiled/")


if __name__ == "__main__":
    main()
