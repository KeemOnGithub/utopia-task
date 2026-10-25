CREATE TABLE app_private.ai_account_usage (
  account_id uuid PRIMARY KEY REFERENCES app_private.accounts(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  admitted_count integer NOT NULL CHECK(admitted_count > 0)
);

CREATE TABLE app_private.ai_daily_usage (
  myt_day date PRIMARY KEY,
  admitted_count integer NOT NULL CHECK(admitted_count > 0)
);

CREATE TABLE app_private.ai_request_leases (
  request_id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES app_private.accounts(id) ON DELETE CASCADE,
  slot integer NOT NULL UNIQUE CHECK(slot >= 1),
  expires_at timestamptz NOT NULL
);

CREATE INDEX ai_request_leases_expires_at_idx ON app_private.ai_request_leases(expires_at);
CREATE INDEX ai_account_usage_window_idx ON app_private.ai_account_usage(window_started_at);
CREATE INDEX service_orders_assigned_at_idx ON app_private.service_orders(assigned_at DESC, id DESC);

REVOKE ALL ON app_private.ai_account_usage, app_private.ai_daily_usage, app_private.ai_request_leases FROM PUBLIC, app_runtime, app_provisioner;

GRANT SELECT, INSERT ON app_private.ai_account_usage, app_private.ai_daily_usage TO app_runtime;
GRANT UPDATE(window_started_at, admitted_count) ON app_private.ai_account_usage TO app_runtime;
GRANT UPDATE(admitted_count) ON app_private.ai_daily_usage TO app_runtime;
GRANT SELECT, INSERT, DELETE ON app_private.ai_request_leases TO app_runtime;

GRANT SELECT, DELETE ON app_private.ai_account_usage, app_private.ai_daily_usage, app_private.ai_request_leases TO app_provisioner;

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON app_private.ai_account_usage, app_private.ai_daily_usage, app_private.ai_request_leases FROM %I', r);
    END IF;
  END LOOP;
END $$;

