SELECT variant AS variant,
       COUNT(*) AS n,
       SUM(revenue_cad) AS sx,
       SUM(orders) AS sy,
       SUM((revenue_cad) * (revenue_cad)) AS sxx,
       SUM((orders) * (orders)) AS syy,
       SUM((revenue_cad) * (orders)) AS sxy
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant;
