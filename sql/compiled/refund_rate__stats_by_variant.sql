SELECT variant AS variant,
       COUNT(*) AS n,
       SUM(refunded_orders) AS sx,
       SUM(orders) AS sy,
       SUM((refunded_orders) * (refunded_orders)) AS sxx,
       SUM((orders) * (orders)) AS syy,
       SUM((refunded_orders) * (orders)) AS sxy
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant;
