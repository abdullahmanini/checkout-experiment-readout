SELECT variant AS variant,
       COUNT(*) AS n,
       SUM(converted) AS sx,
       SUM(1) AS sy,
       SUM((converted) * (converted)) AS sxx,
       SUM((1) * (1)) AS syy,
       SUM((converted) * (1)) AS sxy
FROM exp_customers
WHERE exposed = 1 AND excluded_reason IS NULL
GROUP BY variant;
