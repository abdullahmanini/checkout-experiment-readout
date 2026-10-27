SELECT variant AS variant,
       COUNT(*) AS n,
       SUM(CASE WHEN attempts > 0 THEN 1 ELSE 0 END) AS sx,
       SUM(1) AS sy,
       SUM((CASE WHEN attempts > 0 THEN 1 ELSE 0 END) * (CASE WHEN attempts > 0 THEN 1 ELSE 0 END)) AS sxx,
       SUM((1) * (1)) AS syy,
       SUM((CASE WHEN attempts > 0 THEN 1 ELSE 0 END) * (1)) AS sxy
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant;
