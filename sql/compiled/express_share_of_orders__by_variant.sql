-- Express share of orders: Adoption check: share of orders paid with the express wallet. Zero in control by design.
SELECT variant AS variant,
       SUM(express_orders) AS express_orders,
       SUM(orders) AS orders,
       1.0 * SUM(express_orders) / NULLIF(SUM(orders), 0) AS express_share_of_orders
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant
ORDER BY variant;
