-- Authorization rate: Authorized attempts over all attempts, retries included.
SELECT variant AS variant,
       SUM(authorized_attempts) AS authorized_attempts,
       SUM(attempts) AS attempts,
       1.0 * SUM(authorized_attempts) / NULLIF(SUM(attempts), 0) AS authorization_rate
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant
ORDER BY variant;
