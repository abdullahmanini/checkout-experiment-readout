-- Refund rate: Orders refunded by the data cutoff over all orders.
SELECT variant AS variant,
       SUM(refunded_orders) AS refunded_orders,
       SUM(orders) AS orders,
       1.0 * SUM(refunded_orders) / NULLIF(SUM(orders), 0) AS refund_rate
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant
ORDER BY variant;
