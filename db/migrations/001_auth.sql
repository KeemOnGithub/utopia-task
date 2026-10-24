DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
    CREATE ROLE app_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_provisioner') THEN
    CREATE ROLE app_provisioner NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime' AND
    (rolsuper OR rolbypassrls OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR NOT rolcanlogin))
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='app_runtime')) THEN
    RAISE EXCEPTION 'app_runtime must be a restricted standalone login role';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS app_private;
DO $$ BEGIN
  IF (SELECT nspowner FROM pg_namespace WHERE nspname='app_private')=(SELECT oid FROM pg_roles WHERE rolname='app_runtime') THEN
    RAISE EXCEPTION 'app_runtime must not own app_private';
  END IF;
END $$;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
CREATE TABLE app_private.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK(email=lower(btrim(email,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) AND char_length(email) BETWEEN 1 AND 254),
  password_hash text NOT NULL,
  role text NOT NULL CHECK(role IN ('admin','technician','manager')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.sessions (
  token_hash bytea PRIMARY KEY CHECK(octet_length(token_hash)=32),
  account_id uuid NOT NULL REFERENCES app_private.accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK(expires_at>created_at)
);
CREATE TABLE app_private.login_limits (
  kind text NOT NULL CHECK(kind IN ('email','ip')),
  key_hash bytea NOT NULL CHECK(octet_length(key_hash)=32),
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK(attempt_count>0),
  PRIMARY KEY(kind,key_hash)
);
CREATE INDEX sessions_account_id_idx ON app_private.sessions(account_id);
CREATE INDEX sessions_expires_at_idx ON app_private.sessions(expires_at);
CREATE INDEX login_limits_window_idx ON app_private.login_limits(window_started_at);
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC,app_runtime;
GRANT USAGE ON SCHEMA app_private TO app_runtime;
GRANT SELECT ON app_private.accounts TO app_runtime;
GRANT UPDATE(password_hash) ON app_private.accounts TO app_runtime;
GRANT SELECT,INSERT,DELETE ON app_private.sessions TO app_runtime;
GRANT SELECT,INSERT ON app_private.login_limits TO app_runtime;
GRANT UPDATE(window_started_at,attempt_count) ON app_private.login_limits TO app_runtime;
GRANT USAGE ON SCHEMA app_private TO app_provisioner;
GRANT SELECT,INSERT ON app_private.accounts TO app_provisioner;
GRANT UPDATE(password_hash,is_active,updated_at) ON app_private.accounts TO app_provisioner;
GRANT SELECT,DELETE ON app_private.sessions,app_private.login_limits TO app_provisioner;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA app_private FROM %I',r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM %I',r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA app_private FROM %I',r);
    END IF;
  END LOOP;
END $$;
