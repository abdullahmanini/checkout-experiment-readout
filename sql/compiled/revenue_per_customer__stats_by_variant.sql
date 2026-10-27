SELECT variant AS variant,
       COUNT(*) AS n,
       SUM(revenue_cad) AS sx,
       SUM(1) AS sy,
       SUM((revenue_cad) * (revenue_cad)) AS sxx,
       SUM((1) * (1)) AS syy,
       SUM((revenue_cad) * (1)) AS sxy,
       SUM(prior_spend_90d_cad) AS sc,
       SUM((prior_spend_90d_cad) * (prior_spend_90d_cad)) AS scc,
       SUM((revenue_cad) * (prior_spend_90d_cad)) AS sxc
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant;
