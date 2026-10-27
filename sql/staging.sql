-- Staging: one cleaned, typed table per raw source. Raw tables are loaded as text, exactly as landed.

DROP TABLE IF EXISTS stg_assignments;
CREATE TABLE stg_assignments AS
SELECT customer_id,
       experiment_id,
       variant,
       datetime(assigned_at)    AS assigned_at,
       date(assigned_at)        AS assigned_date,
       platform,
       NULLIF(app_version, '')  AS app_version
FROM raw_assignments;

DROP TABLE IF EXISTS stg_customers;
CREATE TABLE stg_customers AS
SELECT customer_id,
       country,
       customer_type,
       CAST(prior_orders_90d AS INTEGER)  AS prior_orders_90d,
       CAST(prior_spend_90d_cad AS REAL)  AS prior_spend_90d_cad
FROM raw_customers;

-- The analytics SDK resends an event when it gets no acknowledgement, with the same event_id.
-- Keep the first copy received.
DROP TABLE IF EXISTS stg_checkout_events;
CREATE TABLE stg_checkout_events AS
SELECT event_id, event_name, customer_id, session_id, event_at, received_at, platform, app_version
FROM (
    SELECT event_id,
           event_name,
           customer_id,
           session_id,
           datetime(event_at)      AS event_at,
           datetime(received_at)   AS received_at,
           platform,
           NULLIF(app_version, '') AS app_version,
           ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY received_at) AS copy_no
    FROM raw_checkout_events
)
WHERE copy_no = 1;

DROP TABLE IF EXISTS stg_payment_attempts;
CREATE TABLE stg_payment_attempts AS
SELECT attempt_id,
       session_id,
       customer_id,
       datetime(created_at)      AS created_at,
       payment_method,
       CAST(amount_cad AS REAL)  AS amount_cad,
       outcome,
       NULLIF(decline_code, '')  AS decline_code
FROM raw_payment_attempts;

DROP TABLE IF EXISTS stg_refunds;
CREATE TABLE stg_refunds AS
SELECT refund_id, attempt_id, datetime(refunded_at) AS refunded_at, CAST(amount_cad AS REAL) AS amount_cad
FROM raw_refunds;

DROP TABLE IF EXISTS stg_disputes;
CREATE TABLE stg_disputes AS
SELECT dispute_id, attempt_id, datetime(created_at) AS created_at, CAST(amount_cad AS REAL) AS amount_cad, reason
FROM raw_disputes;

CREATE UNIQUE INDEX IF NOT EXISTS ix_stg_assignments ON stg_assignments (customer_id);
CREATE INDEX IF NOT EXISTS ix_stg_events_session ON stg_checkout_events (session_id);
CREATE INDEX IF NOT EXISTS ix_stg_attempts_session ON stg_payment_attempts (session_id);
