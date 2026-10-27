-- Data tests. Each query returns the failing rows; zero rows means the test passes.
-- severity error stops the pipeline; warn is reported and must be explained in the readout.
-- Chi-square cut-off 10.828 = p < 0.001 with one degree of freedom (the usual SRM alarm level).

-- test: raw_event_duplicates
-- severity: warn
-- checks: Raw analytics events with a repeated event_id (SDK retries). Expected; staging keeps the first copy.
SELECT event_id, COUNT(*) AS copies
FROM raw_checkout_events
GROUP BY event_id
HAVING COUNT(*) > 1;

-- test: stg_event_id_unique
-- severity: error
-- checks: After deduplication every event_id appears once.
SELECT event_id, COUNT(*) AS copies
FROM stg_checkout_events
GROUP BY event_id
HAVING COUNT(*) > 1;

-- test: assignment_unique_and_valid
-- severity: error
-- checks: One assignment per customer, a known variant and platform, and an assignment time inside the test window.
SELECT customer_id, variant, platform, assigned_at
FROM stg_assignments
WHERE variant NOT IN ('control', 'treatment')
   OR platform NOT IN ('desktop_web', 'mobile_web', 'ios_app', 'android_app')
   OR assigned_at < (SELECT start_at FROM params)
   OR assigned_at >= (SELECT end_at FROM params)
   OR customer_id IN (SELECT customer_id FROM stg_assignments GROUP BY customer_id HAVING COUNT(*) > 1);

-- test: customers_match_assignments
-- severity: error
-- checks: Every assigned customer has exactly one CRM row and the reverse.
SELECT a.customer_id, 'no CRM row' AS problem
FROM stg_assignments a LEFT JOIN stg_customers c ON c.customer_id = a.customer_id
WHERE c.customer_id IS NULL
UNION ALL
SELECT c.customer_id, 'not assigned'
FROM stg_customers c LEFT JOIN stg_assignments a ON a.customer_id = c.customer_id
WHERE a.customer_id IS NULL;

-- test: payment_attempts_valid
-- severity: error
-- checks: Known outcome and method, positive amount, and a decline code exactly when declined.
SELECT attempt_id, outcome, payment_method, amount_cad, decline_code
FROM stg_payment_attempts
WHERE outcome NOT IN ('authorized', 'declined')
   OR payment_method NOT IN ('card_form', 'express_wallet')
   OR amount_cad <= 0
   OR (outcome = 'declined') <> (decline_code IS NOT NULL);

-- test: activity_belongs_to_assigned_customers
-- severity: error
-- checks: No event or payment from a customer the assignment service never bucketed.
SELECT 'event' AS source, customer_id FROM stg_checkout_events
WHERE customer_id NOT IN (SELECT customer_id FROM stg_assignments)
UNION ALL
SELECT 'payment', customer_id FROM stg_payment_attempts
WHERE customer_id NOT IN (SELECT customer_id FROM stg_assignments);

-- test: activity_after_assignment
-- severity: error
-- checks: Nothing happens before the customer was bucketed or after the test closed (one hour of grace for sessions in flight).
SELECT 'event' AS source, e.event_id AS id, e.event_at AS at
FROM stg_checkout_events e JOIN stg_assignments a ON a.customer_id = e.customer_id
WHERE e.event_at < a.assigned_at OR e.event_at >= datetime((SELECT end_at FROM params), '+1 hour')
UNION ALL
SELECT 'payment', p.attempt_id, p.created_at
FROM stg_payment_attempts p JOIN stg_assignments a ON a.customer_id = p.customer_id
WHERE p.created_at < a.assigned_at OR p.created_at >= datetime((SELECT end_at FROM params), '+1 hour');

-- test: one_customer_per_session
-- severity: error
-- checks: A session_id never appears under two customers across the two sources.
SELECT session_id, COUNT(DISTINCT customer_id) AS customers
FROM (SELECT session_id, customer_id FROM stg_checkout_events
      UNION ALL SELECT session_id, customer_id FROM stg_payment_attempts)
GROUP BY session_id
HAVING COUNT(DISTINCT customer_id) > 1;

-- test: refunds_and_disputes_reference_orders
-- severity: error
-- checks: Refunds and disputes point at authorized attempts, never exceed the order, and disputes fall on or before the data cutoff.
SELECT 'refund' AS source, r.refund_id AS id
FROM stg_refunds r LEFT JOIN stg_payment_attempts p ON p.attempt_id = r.attempt_id AND p.outcome = 'authorized'
WHERE p.attempt_id IS NULL OR r.amount_cad > p.amount_cad + 0.005 OR r.refunded_at < p.created_at
UNION ALL
SELECT 'dispute', d.dispute_id
FROM stg_disputes d LEFT JOIN stg_payment_attempts p ON p.attempt_id = d.attempt_id AND p.outcome = 'authorized'
WHERE p.attempt_id IS NULL OR d.amount_cad > p.amount_cad + 0.005 OR d.created_at > (SELECT data_cutoff FROM params);

-- test: no_control_contamination
-- severity: error
-- checks: Control customers never saw the express button or paid with it.
SELECT 'button shown' AS problem, e.customer_id
FROM stg_checkout_events e JOIN stg_assignments a ON a.customer_id = e.customer_id
WHERE a.variant = 'control' AND e.event_name = 'express_button_shown'
UNION ALL
SELECT 'express payment', p.customer_id
FROM stg_payment_attempts p JOIN stg_assignments a ON a.customer_id = p.customer_id
WHERE a.variant = 'control' AND p.payment_method = 'express_wallet';

-- test: payment_sessions_have_client_event
-- severity: error
-- checks: Every session that reached the payments ledger also has a client checkout_started event.
SELECT session_id, customer_id
FROM fct_checkout_sessions
WHERE attempts > 0 AND has_client_event = 0;

-- test: srm_assignment
-- severity: error
-- checks: Bucketing split is 50/50 across all assigned customers (chi-square, p < 0.001 fails).
SELECT n, treatment, chi_square
FROM (SELECT COUNT(*) AS n,
             SUM(variant = 'treatment') AS treatment,
             1.0 * (2 * SUM(variant = 'treatment') - COUNT(*)) * (2 * SUM(variant = 'treatment') - COUNT(*)) / COUNT(*) AS chi_square
      FROM exp_customers)
WHERE chi_square > 10.828;

-- test: srm_exposed
-- severity: warn
-- checks: The exposed population (customers with a logged checkout_started) is still 50/50.
SELECT n, treatment, chi_square
FROM (SELECT COUNT(*) AS n,
             SUM(variant = 'treatment') AS treatment,
             1.0 * (2 * SUM(variant = 'treatment') - COUNT(*)) * (2 * SUM(variant = 'treatment') - COUNT(*)) / COUNT(*) AS chi_square
      FROM exp_customers WHERE exposed)
WHERE chi_square > 10.828;

-- test: srm_exposed_by_build
-- severity: warn
-- checks: Within each platform and app build, the exposed population is 50/50 (finds where an SRM comes from).
SELECT platform, app_version, n, treatment, chi_square
FROM (SELECT platform, app_version,
             COUNT(*) AS n,
             SUM(variant = 'treatment') AS treatment,
             1.0 * (2 * SUM(variant = 'treatment') - COUNT(*)) * (2 * SUM(variant = 'treatment') - COUNT(*)) / COUNT(*) AS chi_square
      FROM exp_customers WHERE exposed
      GROUP BY platform, app_version)
WHERE chi_square > 10.828;

-- test: srm_analysis_population
-- severity: error
-- checks: After excluding the faulty build (a pre-treatment attribute, so both arms lose the same kind of customer), the split is 50/50 again.
SELECT n, treatment, chi_square
FROM (SELECT COUNT(*) AS n,
             SUM(variant = 'treatment') AS treatment,
             1.0 * (2 * SUM(variant = 'treatment') - COUNT(*)) * (2 * SUM(variant = 'treatment') - COUNT(*)) / COUNT(*) AS chi_square
      FROM exp_customers WHERE exposed AND excluded_reason IS NULL)
WHERE chi_square > 10.828;
