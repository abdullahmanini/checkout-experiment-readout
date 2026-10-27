-- Payment submission: Share of customers who reached checkout and submitted a payment. Separates intent from authorization.
SELECT variant AS variant,
       SUM(CASE WHEN attempts > 0 THEN 1 ELSE 0 END) AS submitting_customers,
       SUM(1) AS customers,
       1.0 * SUM(CASE WHEN attempts > 0 THEN 1 ELSE 0 END) / NULLIF(SUM(1), 0) AS payment_submission_rate
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant
ORDER BY variant;
