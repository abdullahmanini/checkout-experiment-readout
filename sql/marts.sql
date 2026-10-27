-- Marts: sessions, orders, and the customer-level table every experiment metric is defined on.
-- params (one row) and known_bad_builds are written by python/pipeline.py from python/experiment_model.py.

-- One row per checkout session seen by either source: client analytics or the payments ledger.
DROP TABLE IF EXISTS fct_checkout_sessions;
CREATE TABLE fct_checkout_sessions AS
WITH client AS (
    SELECT session_id,
           customer_id,
           MIN(event_at)                              AS started_at,
           MAX(event_name = 'express_button_shown')   AS express_shown
    FROM stg_checkout_events
    GROUP BY session_id, customer_id
),
ledger AS (
    SELECT session_id,
           customer_id,
           MIN(created_at)                                                 AS first_attempt_at,
           COUNT(*)                                                        AS attempts,
           SUM(outcome = 'authorized')                                     AS authorized_attempts,
           MAX(CASE WHEN outcome = 'authorized' THEN attempt_id END)       AS order_attempt_id
    FROM stg_payment_attempts
    GROUP BY session_id, customer_id
),
ids AS (
    SELECT session_id, customer_id FROM client
    UNION
    SELECT session_id, customer_id FROM ledger
)
SELECT ids.session_id,
       ids.customer_id,
       COALESCE(client.started_at, ledger.first_attempt_at)  AS session_at,
       client.session_id IS NOT NULL                         AS has_client_event,
       COALESCE(client.express_shown, 0)                     AS express_shown,
       COALESCE(ledger.attempts, 0)                          AS attempts,
       COALESCE(ledger.authorized_attempts, 0)               AS authorized_attempts,
       ledger.order_attempt_id
FROM ids
LEFT JOIN client ON client.session_id = ids.session_id
LEFT JOIN ledger ON ledger.session_id = ids.session_id;

-- One row per order (authorized attempt), with what has happened to it by the data cutoff.
DROP TABLE IF EXISTS fct_orders;
CREATE TABLE fct_orders AS
SELECT p.attempt_id                                            AS order_id,
       p.session_id,
       p.customer_id,
       p.created_at                                            AS ordered_at,
       date(p.created_at)                                      AS order_date,
       p.payment_method,
       p.amount_cad,
       r.refund_id IS NOT NULL                                 AS is_refunded,
       d.dispute_id IS NOT NULL                                AS is_disputed,
       d.reason                                                AS dispute_reason,
       julianday(d.created_at) - julianday(p.created_at)       AS days_to_dispute,
       julianday((SELECT data_cutoff FROM params)) - julianday(p.created_at) AS days_observed
FROM stg_payment_attempts p
LEFT JOIN stg_refunds r  ON r.attempt_id = p.attempt_id
LEFT JOIN stg_disputes d ON d.attempt_id = p.attempt_id
WHERE p.outcome = 'authorized';

-- One row per assigned customer: the grain of the semantic layer.
-- "exposed" is the dashboard's definition: the client logged at least one checkout_started.
DROP TABLE IF EXISTS exp_customers;
CREATE TABLE exp_customers AS
WITH sess AS (
    SELECT customer_id,
           SUM(has_client_event)                                   AS client_sessions,
           MIN(CASE WHEN has_client_event THEN session_at END)     AS first_exposure_at,
           SUM(attempts)                                           AS attempts,
           SUM(authorized_attempts)                                AS authorized_attempts
    FROM fct_checkout_sessions
    GROUP BY customer_id
),
ord AS (
    SELECT customer_id,
           COUNT(*)                                       AS orders,
           MIN(ordered_at)                                AS first_order_at,
           SUM(amount_cad)                                AS revenue_cad,
           SUM(is_refunded)                               AS refunded_orders,
           SUM(is_disputed)                               AS disputed_orders,
           SUM(payment_method = 'express_wallet')         AS express_orders
    FROM fct_orders
    GROUP BY customer_id
)
SELECT a.customer_id,
       a.variant,
       a.assigned_at,
       a.platform,
       COALESCE(a.app_version, 'web')                     AS app_version,
       c.country,
       c.customer_type,
       c.prior_orders_90d,
       c.prior_spend_90d_cad,
       COALESCE(s.client_sessions, 0) > 0                 AS exposed,
       s.first_exposure_at,
       date(s.first_exposure_at)                          AS exposure_date,
       COALESCE(s.client_sessions, 0)                     AS sessions,
       COALESCE(s.attempts, 0)                            AS attempts,
       COALESCE(s.authorized_attempts, 0)                 AS authorized_attempts,
       COALESCE(o.orders, 0)                              AS orders,
       COALESCE(o.orders, 0) > 0                          AS converted,
       o.first_order_at,
       COALESCE(o.revenue_cad, 0)                         AS revenue_cad,
       COALESCE(o.refunded_orders, 0)                     AS refunded_orders,
       COALESCE(o.disputed_orders, 0)                     AS disputed_orders,
       COALESCE(o.express_orders, 0)                      AS express_orders,
       -- The build is fixed at bucketing, before checkout is shown, so excluding it
       -- removes the same kind of customer from both arms.
       b.reason                                           AS excluded_reason
FROM stg_assignments a
JOIN stg_customers c          ON c.customer_id = a.customer_id
LEFT JOIN sess s              ON s.customer_id = a.customer_id
LEFT JOIN ord o               ON o.customer_id = a.customer_id
LEFT JOIN known_bad_builds b  ON b.app_version = a.app_version;

CREATE UNIQUE INDEX IF NOT EXISTS ix_exp_customers ON exp_customers (customer_id);
