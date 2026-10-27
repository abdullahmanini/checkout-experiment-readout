-- Dispute rate: Orders disputed by the data cutoff over all orders. Immature: disputes keep arriving for months after the order.
SELECT variant AS variant,
       SUM(disputed_orders) AS disputed_orders,
       SUM(orders) AS orders,
       1.0 * SUM(disputed_orders) / NULLIF(SUM(orders), 0) AS dispute_rate
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant
ORDER BY variant;
