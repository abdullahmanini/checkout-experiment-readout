-- Revenue per customer: Order value per customer who reached checkout, before refunds. Analyzed with CUPED on 90-day prior spend.
SELECT variant AS variant,
       SUM(revenue_cad) AS revenue_cad,
       SUM(1) AS customers,
       1.0 * SUM(revenue_cad) / NULLIF(SUM(1), 0) AS revenue_per_customer
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant
ORDER BY variant;
