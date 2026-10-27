/* Renders bound numbers, tables, forest plots, charts and motion from window.SITE_DATA. */
(function () {
  const D = window.SITE_DATA;
  const R = D.results;
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

  // ---- code blocks, lightly highlighted ---------------------------------------------------------
  const hlJson = (t) => esc(t)
    .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="k">$1</span>$2')
    .replace(/(:\s*)(&quot;.*?&quot;)/g, '$1<span class="s">$2</span>');
  const SQL_KW = /\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|AS|AND|IS|NULL|SUM|COUNT|NULLIF)\b/g;
  const hlSql = (t) => esc(t).split("\n").map((line) =>
    line.startsWith("--") ? `<span class="c">${line}</span>` : line.replace(SQL_KW, '<span class="kw">$1</span>')).join("\n");
  document.getElementById("metric-def").innerHTML = hlJson(JSON.stringify(D.metric_definition, null, 2));
  document.getElementById("sql-value").innerHTML = hlSql(D.compiled_sql.trim());
  document.getElementById("sql-stats").innerHTML = hlSql(D.compiled_stats_sql.trim());

  // ---- count-up numbers --------------------------------------------------------------------------
  function countUp(el, to, fmt, ms) {
    if (REDUCED) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(to * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  countUp(document.getElementById("ticker"), D.row_counts.fct_checkout_sessions, int, 1800);
  countUp(document.getElementById("hero-lift"), R.primary.diff, (v) => sign(v) + " pp", 1400);

  // ---- hero sparkline (draws itself) ------------------------------------------------------------
  (function spark() {
    const svg = document.getElementById("spark");
    const days = R.daily, W = svg.clientWidth || 300, H = 72, lo = -3, hi = 6;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const sx = (i) => (i / (days.length - 1)) * W, sy = (v) => H - ((v - lo) / (hi - lo)) * H;
    const band = days.map((d, i) => `${sx(i)},${sy(d.ci_high_pp)}`).join(" ") + " " +
      days.slice().reverse().map((d, i) => `${sx(days.length - 1 - i)},${sy(d.ci_low_pp)}`).join(" ");
    const line = days.map((d, i) => `${i ? "L" : "M"}${sx(i)},${sy(d.lift_pp)}`).join(" ");
    const t = sy(R.truth_check.true_lift_pp_analysis_population);
    const end = days[days.length - 1];
    svg.innerHTML =
      `<polygon points="${band}" fill="rgba(185,185,249,0.18)" style="opacity:${REDUCED ? 1 : 0};transition:opacity 1s .6s"/>` +
      `<line x1="0" x2="${W}" y1="${sy(0)}" y2="${sy(0)}" stroke="rgba(255,255,255,0.18)"/>` +
      `<line x1="0" x2="${W}" y1="${t}" y2="${t}" stroke="rgba(255,255,255,0.45)" stroke-dasharray="3 3"/>` +
      `<path d="${line}" fill="none" stroke="#b9b9f9" stroke-width="2" stroke-linejoin="round" pathLength="1"
         stroke-dasharray="1" stroke-dashoffset="${REDUCED ? 0 : 1}" style="transition:stroke-dashoffset 1.6s cubic-bezier(.22,1,.36,1) .2s"/>` +
      `<circle cx="${sx(days.length - 1)}" cy="${sy(end.lift_pp)}" r="3.5" fill="#fff" style="opacity:${REDUCED ? 1 : 0};transition:opacity .4s 1.6s"/>`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      svg.querySelector("path").style.strokeDashoffset = 0;
      svg.querySelector("polygon").style.opacity = 1;
      svg.querySelector("circle").style.opacity = 1;
    }));
  })();

  // ---- animated gradient ribbon (canvas) --------------------------------------------------------
  (function ribbon() {
    const canvas = document.getElementById("ribbon");
    const ctx = canvas.getContext("2d");
    const STOPS = [[245, 233, 212], [255, 179, 122], [185, 185, 249], [83, 58, 253], [234, 34, 97], [249, 107, 238]];
    const LINES = 84, SEG = 56;
    let W = 0, H = 0, running = false, phase = 0, last = 0;
    const mix = (u) => {
      const x = u * (STOPS.length - 1), i = Math.min(STOPS.length - 2, Math.floor(x)), f = x - i;
      return STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f));
    };
    const colors = Array.from({ length: LINES }, (_, i) => mix(i / (LINES - 1)));
    function size() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function point(t, u, narrow, x0, x1, thick) {
      // a band that sweeps down from the upper middle to the right edge, twisting as it goes
      const bx = x0 + (x1 - x0) * t;
      const by = H * (-0.2 + 1.12 * Math.pow(t, 1.25));
      const twist = Math.cos(t * 2.2 + phase * 0.9 + u * 0.5);
      const off = (u - 0.5) * thick * (0.3 + 0.7 * Math.abs(twist));
      const wave = Math.sin(t * 2.8 + phase + u * 1.4) * (narrow ? 12 : 22);
      return [bx + off * 0.62 + wave * 0.4, by - off * 0.78 + wave];
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      const narrow = W < 900;
      const x0 = narrow ? 0.05 * W : 0.34 * W, x1 = W * 1.15;
      const thick = narrow ? 260 : Math.min(620, W * 0.42);
      // soft filled body of the ribbon, coloured across its width
      const a = [], b = [];
      for (let s = 0; s <= SEG; s++) { a.push(point(s / SEG, 0, narrow, x0, x1, thick)); b.push(point(s / SEG, 1, narrow, x0, x1, thick)); }
      const mid = Math.floor(SEG * 0.45);
      const g = ctx.createLinearGradient(a[mid][0], a[mid][1], b[mid][0], b[mid][1]);
      STOPS.forEach((c, k) => g.addColorStop(k / (STOPS.length - 1), `rgba(${c[0]},${c[1]},${c[2]},0.78)`));
      ctx.fillStyle = g;
      ctx.beginPath();
      a.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      for (let k = b.length - 1; k >= 0; k--) ctx.lineTo(b[k][0], b[k][1]);
      ctx.closePath();
      ctx.fill();
      // fine strands on top give it a silky texture
      ctx.lineWidth = 1.2;
      for (let i = 0; i < LINES; i++) {
        const u = i / (LINES - 1);
        const [r, gg, bb] = colors[i];
        ctx.strokeStyle = `rgba(${Math.min(255, r + 30)},${Math.min(255, gg + 30)},${Math.min(255, bb + 30)},${0.18 + 0.32 * Math.sin(Math.PI * u)})`;
        ctx.beginPath();
        for (let s = 0; s <= SEG; s++) {
          const [x, y] = point(s / SEG, u, narrow, x0, x1, thick);
          if (s) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    }
    function loop(t) {
      if (!running) return;
      if (t - last > 33) { phase += 0.012; draw(); last = t; } // about 30 frames a second is plenty for a slow drift
      requestAnimationFrame(loop);
    }
    size(); draw();
    window.addEventListener("resize", () => { size(); draw(); });
    if (REDUCED) return;
    let visible = true;
    const start = () => { const was = running; running = visible && !document.hidden; if (running && !was) requestAnimationFrame(loop); };
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); }).observe(canvas);
    document.addEventListener("visibilitychange", start);
  })();

  // ---- forest plots (inline SVG) ----------------------------------------------------------------
  // rows: {label, est, lo, hi, truth, margin, value, tip}; opts: {domain, unit, step, aria}
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
      const zero = Math.abs(t) < 1e-9;
      s += `<line x1="${sx(t)}" x2="${sx(t)}" y1="${top}" y2="${H - bottom}" stroke="${zero ? axis : grid}" stroke-width="1"/>`;
      s += `<text class="tick" x="${sx(t)}" y="${H - bottom + 18}" text-anchor="middle">${zero ? "" : t > 0 ? "+" : "−"}${Math.abs(+t.toFixed(2))}</text>`;
    }
    if (!narrow) s += `<text class="tick" x="${x0 - 14}" y="${H - bottom + 18}" text-anchor="end">${esc(opts.unit)}</text>`;
    rows.forEach((r, i) => {
      const cy = top + i * rowH + rowH / 2;
      const delay = `style="transition-delay:${0.12 * i}s"`;
      s += `<g class="row" data-i="${i}"><rect class="hit" x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}" rx="6"/>`;
      s += `<text class="lbl" x="0" y="${cy + 4}">${esc(r.label)}</text>`;
      if (r.margin != null) {
        s += `<line x1="${sx(r.margin)}" x2="${sx(r.margin)}" y1="${cy - 13}" y2="${cy + 13}" stroke="${crit}" stroke-width="2" stroke-dasharray="3 3"/>`;
      }
      if (r.lo != null) {
        s += `<line class="ci" pathLength="1" ${delay} x1="${sx(r.lo)}" x2="${sx(r.hi)}" y1="${cy}" y2="${cy}" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`;
      }
      if (r.truth != null) {
        const tx = sx(r.truth);
        s += `<path class="pt" ${delay} d="M${tx} ${cy - 7} L${tx + 7} ${cy} L${tx} ${cy + 7} L${tx - 7} ${cy} Z" fill="${card}" stroke="${ink}" stroke-width="2"/>`;
      }
      if (r.est != null) s += `<circle class="pt" ${delay} cx="${sx(r.est)}" cy="${cy}" r="5.5" fill="${ink}" stroke="${card}" stroke-width="2"/>`;
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

  // ---- Chart.js charts, created when they scroll into view ---------------------------------------
  const charts = {};
  function baseOptions(animate) {
    return {
      responsive: true, maintainAspectRatio: false,
      animation: animate && !REDUCED ? { duration: 1100, easing: "easeOutQuart" } : false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css("--card"), titleColor: css("--ink"), bodyColor: css("--ink-2"), borderColor: css("--hairline"),
          borderWidth: 1, padding: 10, titleFont: { family: "Inter", weight: "500" }, bodyFont: { family: "Inter" },
          usePointStyle: true, boxWidth: 8, boxHeight: 8,
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: css("--axis") }, ticks: { color: css("--mute"), font: { family: "Inter", size: 12 } } },
        y: { grid: { color: css("--grid") }, border: { display: false }, ticks: { color: css("--mute"), font: { family: "Inter", size: 12 } } },
      },
    };
  }

  const BUILDERS = {
    funnel(animate) {
      const f = R.funnel, s1 = css("--series-1"), s2 = css("--series-2"), ink2 = css("--ink-2"), card = css("--card");
      const o = baseOptions(animate);
      o.scales.y.min = 0; o.scales.y.max = 100;
      o.scales.y.ticks.callback = (v) => v + "%";
      o.interaction = { mode: "index", intersect: false };
      o.plugins.tooltip.callbacks = { title: (i) => i[0].label.join(" "), label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(2)}%` };
      const barLabels = {
        id: "barLabels",
        afterDatasetsDraw(chart) {
          if (chart.width < 440) return; // values are in the tooltip and the text when bars sit too close
          const { ctx } = chart;
          ctx.save();
          ctx.font = "500 11.5px Inter"; ctx.fillStyle = ink2; ctx.textAlign = "center";
          chart.data.datasets.forEach((ds, i) => chart.getDatasetMeta(i).data.forEach((bar, j) => {
            if (j > 0) ctx.fillText(ds.data[j].toFixed(1) + "%", bar.x, bar.y - 6);
          }));
          ctx.restore();
        },
      };
      const bar = (label, color, d) => ({ label, data: d, backgroundColor: color, borderRadius: { topLeft: 4, topRight: 4 },
        borderSkipped: "bottom", maxBarThickness: 24, borderColor: card, borderWidth: { left: 1, right: 1 } });
      return new Chart(document.getElementById("funnel"), {
        type: "bar",
        data: {
          labels: [["Reached", "checkout"], ["Submitted", "payment"], ["Placed", "an order"]],
          datasets: [
            bar("Control", s1, [100, f.control.submitted_payment_pct, f.control.converted_pct]),
            bar("Treatment", s2, [100, f.treatment.submitted_payment_pct, f.treatment.converted_pct]),
          ],
        },
        options: o,
        plugins: [barLabels],
      });
    },
    daily(animate) {
      const days = R.daily, s1 = css("--series-1"), ink2 = css("--ink-2"), card = css("--card");
      const o = baseOptions(animate);
      o.interaction = { mode: "index", intersect: false };
      o.scales.y.ticks.callback = (v) => (v > 0 ? "+" : "") + v;
      o.scales.y.suggestedMin = -3; o.scales.y.suggestedMax = 6;
      o.scales.y.grid.color = (c) => (c.tick.value === 0 ? css("--axis") : css("--grid"));
      o.scales.x.title = { display: true, text: "Day of test", color: css("--mute"), font: { family: "Inter", size: 12 } };
      o.plugins.tooltip.filter = (item) => item.datasetIndex === 2;
      o.plugins.tooltip.callbacks = {
        title: (items) => `Day ${days[items[0].dataIndex].day} · ${days[items[0].dataIndex].date}`,
        label: (c) => {
          const d = days[c.dataIndex];
          return [` Lift ${sign(d.lift_pp)} pp`, ` 95% CI ${sign(d.ci_low_pp)} to ${sign(d.ci_high_pp)}`, ` p ${fmtP(d.p_value)} · ${int(d.n)} customers`];
        },
      };
      const truth = T.true_lift_pp_analysis_population;
      return new Chart(document.getElementById("daily"), {
        type: "line",
        data: {
          labels: days.map((d) => d.day),
          datasets: [
            { label: "CI high", data: days.map((d) => d.ci_high_pp), borderWidth: 0, pointRadius: 0, fill: "+1", backgroundColor: css("--band") },
            { label: "CI low", data: days.map((d) => d.ci_low_pp), borderWidth: 0, pointRadius: 0, fill: false },
            { label: "Lift", data: days.map((d) => d.lift_pp), borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: 3.5,
              pointHoverRadius: 6, pointBorderColor: card, pointBorderWidth: 1.5, tension: 0.25 },
            { label: "True effect", data: days.map(() => truth), borderColor: ink2, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
          ],
        },
        options: o,
      });
    },
    lag(animate) {
      const curve = R.dispute.lag_curve, s1 = css("--series-1");
      const lo = R.dispute.min_days_observed, hi = R.dispute.max_days_observed;
      const o = baseOptions(animate);
      o.interaction = { mode: "index", intersect: false };
      o.scales.x = { ...o.scales.x, type: "linear", min: 0, max: 120, ticks: { ...o.scales.x.ticks, stepSize: 20, callback: (v) => v + "d" } };
      o.scales.y.min = 0; o.scales.y.max = 100;
      o.scales.y.ticks.callback = (v) => v + "%";
      o.plugins.tooltip.callbacks = { title: (i) => `Order age ${i[0].parsed.x} days`, label: (c) => ` ${c.parsed.y.toFixed(1)}% of disputes arrived` };
      const windowBand = {
        id: "windowBand",
        beforeDatasetsDraw(chart) {
          const { ctx, chartArea: a, scales: { x } } = chart;
          ctx.save();
          ctx.fillStyle = css("--primary-soft-bg");
          ctx.fillRect(x.getPixelForValue(lo), a.top, x.getPixelForValue(hi) - x.getPixelForValue(lo), a.bottom - a.top);
          ctx.fillStyle = css("--ink-2"); ctx.font = "500 11.5px Inter"; ctx.textAlign = "left";
          ctx.fillText("this test's orders", x.getPixelForValue(hi) + 6, a.bottom - 10);
          ctx.restore();
        },
      };
      return new Chart(document.getElementById("lag"), {
        type: "line",
        data: { datasets: [{ label: "Arrived", data: curve.map((c) => ({ x: c.day, y: c.share_arrived_pct })), borderColor: s1,
          backgroundColor: s1, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.3 }] },
        options: o,
        plugins: [windowBand],
      });
    },
  };

  function build(id, animate) {
    if (charts[id]) charts[id].destroy();
    charts[id] = BUILDERS[id](animate);
  }

  // ---- scroll reveal and lazy charts ------------------------------------------------------------
  drawForests();
  const revealTargets = document.querySelectorAll(".sec > div:last-child > *, .note-strip p");
  revealTargets.forEach((el) => {
    el.classList.add("reveal");
    el.style.setProperty("--d", Math.min(0.24, 0.06 * [...el.parentElement.children].indexOf(el)) + "s");
  });
  const seen = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target;
    el.classList.add("in");
    if (el.tagName === "CANVAS" && !charts[el.id]) build(el.id, true);
    seen.unobserve(el);
  }), { rootMargin: "0px 0px -10% 0px", threshold: 0.05 });
  revealTargets.forEach((el) => seen.observe(el));
  document.querySelectorAll(".forest, canvas[id]:not(#ribbon)").forEach((el) => seen.observe(el));

  // nav: hairline once scrolled, and the current section highlighted
  const nav = document.querySelector(".nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  const links = new Map([...document.querySelectorAll(".nav li a")].map((a) => [a.getAttribute("href").slice(1), a]));
  const sectionObs = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) links.forEach((a, id) => a.classList.toggle("active", id === e.target.id));
  }), { rootMargin: "-45% 0px -50% 0px" });
  document.querySelectorAll("section.band[id], header.hero").forEach((s) => sectionObs.observe(s));

  // redraw on resize and theme change, without replaying animations
  function redrawAll() {
    drawForests();
    Object.keys(charts).forEach((id) => build(id, false));
  }
  let lastW = window.innerWidth, raf;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(drawForests);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redrawAll);
  new MutationObserver(redrawAll).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
})();
