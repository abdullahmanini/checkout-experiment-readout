SELECT variant AS variant,
       COUNT(*) AS n,
       SUM(express_orders) AS sx,
       SUM(orders) AS sy,
       SUM((express_orders) * (express_orders)) AS sxx,
       SUM((orders) * (orders)) AS syy,
       SUM((express_orders) * (orders)) AS sxy
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant;
