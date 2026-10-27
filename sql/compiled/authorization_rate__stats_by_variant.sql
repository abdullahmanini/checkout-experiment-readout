SELECT variant AS variant,
       COUNT(*) AS n,
       SUM(authorized_attempts) AS sx,
       SUM(attempts) AS sy,
       SUM((authorized_attempts) * (authorized_attempts)) AS sxx,
       SUM((attempts) * (attempts)) AS syy,
       SUM((authorized_attempts) * (attempts)) AS sxy
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant;
