/* Renders bound numbers, tables, forest plots and charts from window.SITE_DATA. */
(function () {
  const D = window.SITE_DATA;
  const R = D.results;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sign = (v, d = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const fmtP = (p) => (p < 0.0001 ? "<0.0001" : p < 0.001 ? p.toFixed(4) : p < 0.01 ? p.toFixed(3) : p.toFixed(2));
  const int = (v) => Math.round(v).toLocaleString("en-CA");
  const FMT = {
    int, pp: (v) => sign(v) + " pp", sgn: (v) => sign(v), p: fmtP, p2: (v) => v.toFixed(2), pct: (v) => v.toFixed(2) + "%",
    1: (v) => v.toFixed(1), 2: (v) => v.toFixed(2), 3: (v) => v.toFixed(3), neg1: (v) => Math.abs(v).toFixed(1),
    share1: (v) => (100 * v).toFixed(1),
  };
  const LABELS = {
    android_app: "Android app", desktop_web: "Desktop web", ios_app: "iOS app", mobile_web: "Mobile web",
    new: "New customers", returning: "Returning customers",
  };

  // ---- bound numbers ---------------------------------------------------------------------------
  const lookup = (path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), D);
  document.querySelectorAll("[data-bind]").forEach((el) => {
    const v = lookup(el.dataset.bind);
    if (v === undefined) { el.textContent = "?"; console.warn("missing", el.dataset.bind); return; }
    el.textContent = el.dataset.fmt ? FMT[el.dataset.fmt](v) : (typeof v === "number" ? v.toLocaleString("en-CA") : v);
  });

  // ---- tooltip ---------------------------------------------------------------------------------
  const tip = document.getElementById("tip");
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.style.opacity = 1;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - r.width - 8, x + 14) + "px";
    tip.style.top = Math.max(8, y - r.height - 10) + "px";
  }
  const hideTip = () => { tip.style.opacity = 0; };

  // ---- tables ----------------------------------------------------------------------------------
  function table(id, cols, rows, rowClass) {
    document.getElementById(id).innerHTML =
      "<thead><tr>" + cols.map((c) => `<th class="${c.n ? "n" : ""}">${c.h}</th>`).join("") + "</tr></thead><tbody>" +
      rows.map((r) => `<tr class="${rowClass ? rowClass(r) : ""}">` +
        cols.map((c) => `<td class="${c.n ? "n" : ""}">${c.f(r)}</td>`).join("") + "</tr>").join("") + "</tbody>";
  }
  const status = (t) => t.status === "pass" ? '<span class="status pass">Pass</span>'
    : t.severity === "warn" ? '<span class="status warn">Warning</span>' : '<span class="status fail">Fail</span>';
  table("tests-table", [
    { h: "Test", f: (t) => `<code>${esc(t.name)}</code>` },
    { h: "Level", f: (t) => t.severity },
    { h: "Result", f: status },
    { h: "Failing rows", n: 1, f: (t) => int(t.failing_rows) },
    { h: "What it checks", f: (t) => esc(t.checks) },
  ], D.tests);

  table("build-table", [
    { h: "Platform", f: (b) => LABELS[b.platform] },
    { h: "Build", f: (b) => esc(b.app_version) },
    { h: "Control", n: 1, f: (b) => int(b.control) },
    { h: "Treatment", n: 1, f: (b) => int(b.treatment) },
    { h: "Treatment share", n: 1, f: (b) => b.treatment_share_pct.toFixed(1) + "%" },
    { h: "<span class='sr'>40% to 60%</span>", f: (b) => `<div class="track" title="${b.treatment_share_pct}%"><span class="mid"></span><span class="pt" style="left:${Math.max(0, Math.min(100, (b.treatment_share_pct - 40) * 5))}%"></span></div>` },
    { h: "χ²", n: 1, f: (b) => b.chi_square.toFixed(1) },
    { h: "Excluded", f: (b) => (b.excluded ? '<span class="status fail">Yes</span>' : "") },
  ], R.srm_by_build, (b) => (b.excluded ? "flag" : ""));

  const M = R.metrics;
  const metricRows = [
    ["Checkout conversion", "Primary", R.primary],
    ["Payment submission", "Diagnostic", M.payment_submission_rate],
    ["Express share of orders", "Diagnostic", M.express_share_of_orders],
    ["Authorization rate", "Guardrail", M.authorization_rate],
    ["Refund rate", "Guardrail", M.refund_rate],
    ["Dispute rate (immature)", "Guardrail", M.dispute_rate],
    ["Revenue per customer", "Secondary", M.revenue_per_customer],
    ["Revenue per customer, CUPED", "Secondary", M.revenue_per_customer_cuped],
    ["Average order value", "Secondary", M.average_order_value],
  ].map(([label, role, m]) => ({ label, role, m }));
  const val = (m, v) => (m.format === "currency" ? "$" + v.toFixed(2) : v.toFixed(2) + "%");
  const dif = (m, v) => (m.format === "currency" ? sign(v).replace(/^([+−])/, "$1$") : sign(v) + " pp");
  table("metrics-table", [
    { h: "Metric", f: (r) => r.label },
    { h: "Role", f: (r) => r.role },
    { h: "Control", n: 1, f: (r) => val(r.m, r.m.control) },
    { h: "Treatment", n: 1, f: (r) => val(r.m, r.m.treatment) },
    { h: "Difference", n: 1, f: (r) => dif(r.m, r.m.diff) },
    { h: "95% CI", n: 1, f: (r) => `${dif(r.m, r.m.ci_low)} to ${dif(r.m, r.m.ci_high)}` },
    { h: "p", n: 1, f: (r) => fmtP(r.m.p_value) },
  ], metricRows);

  table("daily-table", [
    { h: "Day", n: 1, f: (d) => d.day },
    { h: "Date", f: (d) => d.date },
    { h: "Customers", n: 1, f: (d) => int(d.n) },
    { h: "Lift", n: 1, f: (d) => sign(d.lift_pp) + " pp" },
    { h: "95% CI", n: 1, f: (d) => `${sign(d.ci_low_pp)} to ${sign(d.ci_high_pp)}` },
    { h: "p", n: 1, f: (d) => fmtP(d.p_value) },
  ], R.daily);

  // ---- code blocks -----------------------------------------------------------------------------
  document.getElementById("metric-def").textContent = JSON.stringify(D.metric_definition, null, 2);
  document.getElementById("sql-value").textContent = D.compiled_sql.trim();
  document.getElementById("sql-stats").textContent = D.compiled_stats_sql.trim();

  // ---- forest plots (inline SVG) ---------------------------------------------------------------
  // rows: {label, est, lo, hi, truth, margin, tip}; opts: {domain, unit, refLabel}
  function forest(id, rows, opts) {
    const el = document.getElementById(id);
    const W = el.clientWidth;
    const narrow = W < 520;
    const labelW = narrow ? 118 : 190, valueW = narrow ? 0 : 150, rowH = 38, top = 8, bottom = 30;
    const x0 = labelW, x1 = W - valueW - 12;
    const [dmin, dmax] = opts.domain;
    const sx = (v) => x0 + ((v - dmin) / (dmax - dmin)) * (x1 - x0);
    const H = top + rows.length * rowH + bottom;
    const ink = css("--ink-2"), axis = css("--axis"), grid = css("--grid"), crit = css("--critical"), card = css("--card");
    let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(opts.aria)}">`;
    const step = opts.step || 1;
    for (let t = Math.ceil(dmin / step) * step; t <= dmax + 1e-9; t += step) {
      s += `<line x1="${sx(t)}" x2="${sx(t)}" y1="${top}" y2="${H - bottom}" stroke="${t === 0 ? axis : grid}" stroke-width="1"/>`;
      s += `<text class="tick" x="${sx(t)}" y="${H - bottom + 18}" text-anchor="middle">${t > 0 ? "+" : t < 0 ? "−" : ""}${Math.abs(t)}</text>`;
    }
    if (!narrow) s += `<text class="tick" x="${x0 - 14}" y="${H - bottom + 18}" text-anchor="end">${esc(opts.unit)}</text>`;
    rows.forEach((r, i) => {
      const cy = top + i * rowH + rowH / 2;
      s += `<g class="row" data-i="${i}"><rect class="hit" x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}" rx="4"/>`;
      s += `<text class="lbl" x="0" y="${cy + 4}">${esc(r.label)}</text>`;
      if (r.margin != null) {
        s += `<line x1="${sx(r.margin)}" x2="${sx(r.margin)}" y1="${cy - 13}" y2="${cy + 13}" stroke="${crit}" stroke-width="2" stroke-dasharray="3 3"/>`;
      }
      if (r.lo != null) {
        s += `<line x1="${sx(r.lo)}" x2="${sx(r.hi)}" y1="${cy}" y2="${cy}" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`;
      }
      if (r.truth != null) {
        const tx = sx(r.truth);
        s += `<path d="M${tx} ${cy - 7} L${tx + 7} ${cy} L${tx} ${cy + 7} L${tx - 7} ${cy} Z" fill="${card}" stroke="${ink}" stroke-width="2"/>`;
      }
      if (r.est != null) s += `<circle cx="${sx(r.est)}" cy="${cy}" r="5.5" fill="${ink}" stroke="${card}" stroke-width="2"/>`;
      if (!narrow) s += `<text class="val" x="${W}" y="${cy + 4}" text-anchor="end">${esc(r.value)}</text>`;
      s += "</g>";
    });
    el.innerHTML = s + "</svg>";
    el.querySelectorAll(".row").forEach((g) => {
      const r = rows[+g.dataset.i];
      g.addEventListener("mousemove", (e) => showTip(r.tip, e.clientX, e.clientY));
      g.addEventListener("mouseleave", hideTip);
    });
  }

  const P = R.primary, N = R.primary_naive, T = R.truth_check;
  const ci = (m) => `${sign(m.ci_low)} to ${sign(m.ci_high)}`;
  function drawForests() {
    forest("forest-naive", [
      { label: "Naive (all exposed)", est: N.diff, lo: N.ci_low, hi: N.ci_high, value: `${sign(N.diff)} [${ci(N)}]`,
        tip: `<b>Naive estimate</b><br>Everyone with a logged checkout_started<br><span class="tab">${sign(N.diff)} pp, 95% CI ${ci(N)}<br>${int(N.n_control)} control · ${int(N.n_treatment)} treatment</span>` },
      { label: "Builds excluded", est: P.diff, lo: P.ci_low, hi: P.ci_high, value: `${sign(P.diff)} [${ci(P)}]`,
        tip: `<b>Corrected estimate</b><br>iOS 7.2.0 and Android 5.9.0 removed from both arms<br><span class="tab">${sign(P.diff)} pp, 95% CI ${ci(P)}<br>${int(P.n_control)} control · ${int(P.n_treatment)} treatment</span>` },
      { label: "True effect", truth: T.true_lift_pp_analysis_population, value: `${sign(T.true_lift_pp_analysis_population)}`,
        tip: `<b>True effect in the analysis population</b><br><span class="tab">${sign(T.true_lift_pp_analysis_population)} pp</span><br>From simulating every customer under both versions` },
    ], { domain: [0, 6], unit: "pp", aria: "Naive lift 4.6 points, corrected 2.6, true 2.4" });

    const G = R.guardrails;
    const harm = (key, flip) => {
      const m = M[key];
      return flip ? { est: -m.diff, lo: -m.ci_high, hi: -m.ci_low } : { est: m.diff, lo: m.ci_low, hi: m.ci_high };
    };
    const verdict = { pass: "Pass", inconclusive: "Open", fail: "Fail" };
    forest("forest-guard", [["authorization_rate", "Authorization", true], ["refund_rate", "Refunds", false], ["dispute_rate", "Disputes", false]]
      .map(([key, label, flip]) => {
        const h = harm(key, flip);
        return { label, ...h, margin: G[key].margin_pp, value: `${verdict[G[key].verdict]} · margin ${G[key].margin_pp}`,
          tip: `<b>${label}</b> · ${verdict[G[key].verdict]}<br><span class="tab">Harm ${sign(h.est)} pp, 95% CI ${sign(h.lo)} to ${sign(h.hi)}<br>Margin ${G[key].margin_pp} pp</span>${key === "dispute_rate" ? "<br>About " + R.dispute.expected_share_arrived_pct + "% of disputes have arrived" : ""}` };
      }), { domain: [-1.5, 1.5], step: 0.5, unit: "pp harm", aria: "Guardrails: authorization and refunds pass, disputes open" });

    const segs = [...R.segments.platform, ...R.segments.customer_type];
    forest("forest-seg", segs.map((s) => {
      const truth = T.true_lift_pp_by_platform[s.segment];
      return { label: LABELS[s.segment], est: s.diff, lo: s.ci_low, hi: s.ci_high, truth,
        value: `${sign(s.diff)} [${ci(s)}]`,
        tip: `<b>${LABELS[s.segment]}</b><br><span class="tab">${sign(s.diff)} pp, 95% CI ${ci(s)}<br>Holm p ${fmtP(s.p_holm)} · ${int(s.n_control + s.n_treatment)} customers</span>` +
          (truth != null ? `<br>True effect ${sign(truth)} pp` : "") };
    }), { domain: [-4, 10], step: 2, unit: "pp", aria: "Segment lifts: mobile web highest, desktop lowest" });
  }

  // ---- Chart.js charts -------------------------------------------------------------------------
  let charts = [];
  function baseOptions() {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css("--card"), titleColor: css("--ink"), bodyColor: css("--ink-2"), borderColor: css("--hairline"),
          borderWidth: 1, padding: 10, titleFont: { family: "IBM Plex Sans", weight: "600" }, bodyFont: { family: "IBM Plex Sans" },
          usePointStyle: true, boxWidth: 8, boxHeight: 8,
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: css("--axis") }, ticks: { color: css("--mute"), font: { family: "IBM Plex Sans", size: 12 } } },
        y: { grid: { color: css("--grid") }, border: { display: false }, ticks: { color: css("--mute"), font: { family: "IBM Plex Sans", size: 12 } } },
      },
    };
  }

  function drawCharts() {
    charts.forEach((c) => c.destroy());
    charts = [];
    const s1 = css("--series-1"), s2 = css("--series-2"), ink2 = css("--ink-2"), card = css("--card");

    // funnel
    const f = R.funnel;
    const fo = baseOptions();
    fo.scales.y.min = 0; fo.scales.y.max = 100;
    fo.scales.y.ticks.callback = (v) => v + "%";
    fo.plugins.tooltip.callbacks = { title: (i) => i[0].label.join(" "), label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(2)}%` };
    const barLabels = {
      id: "barLabels",
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        if (chart.width < 440) return; // values are in the tooltip and the text when bars sit too close
        ctx.save();
        ctx.font = "500 11.5px IBM Plex Sans"; ctx.fillStyle = ink2; ctx.textAlign = "center";
        chart.data.datasets.forEach((ds, i) => chart.getDatasetMeta(i).data.forEach((bar, j) => {
          if (j > 0) ctx.fillText(ds.data[j].toFixed(1) + "%", bar.x, bar.y - 6);
        }));
        ctx.restore();
      },
    };
    const bar = (label, color, d) => ({ label, data: d, backgroundColor: color, borderRadius: { topLeft: 4, topRight: 4 },
      borderSkipped: "bottom", maxBarThickness: 24, borderColor: card, borderWidth: { left: 1, right: 1 } });
    charts.push(new Chart(document.getElementById("funnel"), {
      type: "bar",
      data: {
        labels: [["Reached", "checkout"], ["Submitted", "payment"], ["Placed", "an order"]],
        datasets: [
          bar("Control", s1, [100, f.control.submitted_payment_pct, f.control.converted_pct]),
          bar("Treatment", s2, [100, f.treatment.submitted_payment_pct, f.treatment.converted_pct]),
        ],
      },
      options: { ...fo, interaction: { mode: "index", intersect: false } },
      plugins: [barLabels],
    }));

    // daily cumulative lift
    const days = R.daily;
    const dOpt = baseOptions();
    dOpt.interaction = { mode: "index", intersect: false };
    dOpt.scales.y.ticks.callback = (v) => (v > 0 ? "+" : "") + v;
    dOpt.scales.y.suggestedMin = -3; dOpt.scales.y.suggestedMax = 6;
    dOpt.scales.y.grid.color = (c) => (c.tick.value === 0 ? css("--axis") : css("--grid"));
    dOpt.scales.x.title = { display: true, text: "Day of test", color: css("--mute"), font: { family: "IBM Plex Sans", size: 12 } };
    dOpt.plugins.tooltip.filter = (item) => item.datasetIndex === 2;
    dOpt.plugins.tooltip.callbacks = {
      title: (items) => `Day ${days[items[0].dataIndex].day} · ${days[items[0].dataIndex].date}`,
      label: (c) => {
        const d = days[c.dataIndex];
        return [` Lift ${sign(d.lift_pp)} pp`, ` 95% CI ${sign(d.ci_low_pp)} to ${sign(d.ci_high_pp)}`, ` p ${fmtP(d.p_value)} · ${int(d.n)} customers`];
      },
    };
    const truth = T.true_lift_pp_analysis_population;
    charts.push(new Chart(document.getElementById("daily"), {
      type: "line",
      data: {
        labels: days.map((d) => d.day),
        datasets: [
          { label: "CI high", data: days.map((d) => d.ci_high_pp), borderWidth: 0, pointRadius: 0, fill: "+1", backgroundColor: css("--band") },
          { label: "CI low", data: days.map((d) => d.ci_low_pp), borderWidth: 0, pointRadius: 0, fill: false },
          { label: "Lift", data: days.map((d) => d.lift_pp), borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: 3.5,
            pointHoverRadius: 6, pointBorderColor: card, pointBorderWidth: 1.5 },
          { label: "True effect", data: days.map(() => truth), borderColor: ink2, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
        ],
      },
      options: dOpt,
    }));

    // dispute lag curve
    const curve = R.dispute.lag_curve;
    const lo = R.dispute.min_days_observed, hi = R.dispute.max_days_observed;
    const lOpt = baseOptions();
    lOpt.interaction = { mode: "index", intersect: false };
    lOpt.scales.x = { ...lOpt.scales.x, type: "linear", min: 0, max: 120, ticks: { ...lOpt.scales.x.ticks, stepSize: 20, callback: (v) => v + "d" } };
    lOpt.scales.y.min = 0; lOpt.scales.y.max = 100;
    lOpt.scales.y.ticks.callback = (v) => v + "%";
    lOpt.plugins.tooltip.callbacks = { title: (i) => `Order age ${i[0].parsed.x} days`, label: (c) => ` ${c.parsed.y.toFixed(1)}% of disputes arrived` };
    const windowBand = {
      id: "windowBand",
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales: { x } } = chart;
        ctx.save();
        ctx.fillStyle = css("--accent-soft");
        ctx.fillRect(x.getPixelForValue(lo), a.top, x.getPixelForValue(hi) - x.getPixelForValue(lo), a.bottom - a.top);
        ctx.fillStyle = css("--ink-2"); ctx.font = "500 11.5px IBM Plex Sans"; ctx.textAlign = "left";
        ctx.fillText("this test's orders", x.getPixelForValue(hi) + 6, a.bottom - 10);
        ctx.restore();
      },
    };
    charts.push(new Chart(document.getElementById("lag"), {
      type: "line",
      data: { datasets: [{ label: "Arrived", data: curve.map((c) => ({ x: c.day, y: c.share_arrived_pct })), borderColor: s1,
        backgroundColor: s1, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.3 }] },
      options: lOpt,
      plugins: [windowBand],
    }));
  }

  function render() { drawForests(); drawCharts(); }
  render();
  let raf;
  let lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(drawForests);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
})();
