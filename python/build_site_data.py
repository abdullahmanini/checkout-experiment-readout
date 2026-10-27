"""Bundle the readout for index.html into assets/site-data.js.

Usage: python3 python/build_site_data.py  (run after analyze.py)
A .js file (not .json) so the page also works when opened straight from disk.
"""
import json
from pathlib import Path

import semantic_layer as sl

ROOT = Path(__file__).resolve().parent.parent


def main():
    results = json.loads((ROOT / "outputs" / "results.json").read_text())
    tests = json.loads((ROOT / "outputs" / "test_results.json").read_text())
    for t in tests["tests"]:
        t.pop("sample", None)
    data = {
        "results": results,
        "tests": tests["tests"],
        "row_counts": tests["row_counts"],
        "metric_definition": {"checkout_conversion": sl.SPEC["metrics"]["checkout_conversion"]},
        "compiled_sql": sl.value_sql("checkout_conversion"),
        "compiled_stats_sql": sl.stats_sql("checkout_conversion"),
    }
    (ROOT / "assets").mkdir(exist_ok=True)
    (ROOT / "assets" / "site-data.js").write_text("window.SITE_DATA = " + json.dumps(data, separators=(",", ":")) + ";\n")
    print(f"wrote assets/site-data.js ({(ROOT / 'assets' / 'site-data.js').stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
