SELECT variant AS variant,
       COUNT(*) AS n,
       SUM(disputed_orders) AS sx,
       SUM(orders) AS sy,
       SUM((disputed_orders) * (disputed_orders)) AS sxx,
       SUM((orders) * (orders)) AS syy,
       SUM((disputed_orders) * (orders)) AS sxy
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant;
