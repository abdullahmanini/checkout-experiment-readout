-- Average order value: Order value per order. Not comparable as a causal effect on its own: the treatment changes who orders.
SELECT variant AS variant,
       SUM(revenue_cad) AS revenue_cad,
       SUM(orders) AS orders,
       1.0 * SUM(revenue_cad) / NULLIF(SUM(orders), 0) AS average_order_value
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant
ORDER BY variant;
