-- Checkout conversion: Share of customers who reached checkout and placed at least one order.
SELECT variant AS variant,
       platform AS platform,
       SUM(converted) AS converted_customers,
       SUM(1) AS customers,
       1.0 * SUM(converted) / NULLIF(SUM(1), 0) AS checkout_conversion
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant, platform
ORDER BY variant, platform;
