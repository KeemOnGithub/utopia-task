-- ECMAScript trim whitespace, deliberately not the PostgreSQL default btrim set.
CREATE FUNCTION app_private.editor_trim(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog AS $$ SELECT btrim(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') $$;
REVOKE ALL ON FUNCTION app_private.editor_trim(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.editor_trim(text) TO app_runtime;
CREATE TABLE app_private.technicians (
 id uuid PRIMARY KEY, display_name text NOT NULL CHECK (char_length(display_name) <= 100 AND app_private.editor_trim(display_name) <> ''), is_active boolean NOT NULL DEFAULT true
);
INSERT INTO app_private.technicians(id,display_name) VALUES
 ('10000000-0000-4000-8000-000000000001','Ali'),
 ('10000000-0000-4000-8000-000000000002','John'),
 ('10000000-0000-4000-8000-000000000003','Bala'),
 ('10000000-0000-4000-8000-000000000004','Yusoff') ON CONFLICT(id) DO NOTHING;
CREATE TABLE app_private.service_order_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_account_id uuid NOT NULL REFERENCES app_private.accounts(id) ON DELETE RESTRICT,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 customer_name text NOT NULL CHECK(char_length(customer_name)<=200 AND position(chr(13) in customer_name)=0),
 phone text NOT NULL CHECK(char_length(phone)<=50 AND position(chr(13) in phone)=0),
 address text NOT NULL CHECK(char_length(address)<=2000 AND position(chr(13) in address)=0),
 problem_description text NOT NULL CHECK(char_length(problem_description)<=5000 AND position(chr(13) in problem_description)=0),
 service_type text CHECK(service_type IN ('installation','servicing','repair')),
 quoted_price_input text NOT NULL CHECK(char_length(quoted_price_input)<=32 AND position(chr(13) in quoted_price_input)=0),
 proposed_technician_id uuid REFERENCES app_private.technicians(id) ON DELETE RESTRICT,
 admin_notes text NOT NULL CHECK(char_length(admin_notes)<=5000 AND position(chr(13) in admin_notes)=0),
 created_at timestamptz NOT NULL DEFAULT now(), last_saved_at timestamptz NOT NULL DEFAULT now(),
 submitted_order_id uuid UNIQUE, submitted_at timestamptz,
 CHECK((submitted_order_id IS NULL)=(submitted_at IS NULL)),
 CHECK(service_type IS NOT NULL OR proposed_technician_id IS NOT NULL OR app_private.editor_trim(customer_name||phone||address||problem_description||quoted_price_input||admin_notes)<>'')
);
CREATE SEQUENCE app_private.service_order_number_seq AS bigint START 1 NO CYCLE;
CREATE TABLE app_private.service_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_number_value bigint NOT NULL DEFAULT nextval('app_private.service_order_number_seq') UNIQUE CHECK(order_number_value>0),
 customer_name text NOT NULL CHECK(char_length(customer_name)<=200 AND customer_name<>'' AND customer_name=app_private.editor_trim(customer_name) AND position(chr(13) in customer_name)=0),
 phone text NOT NULL CHECK(char_length(phone)<=50 AND phone<>'' AND phone=app_private.editor_trim(phone) AND phone ~ '[0-9]' AND position(chr(13) in phone)=0),
 address text NOT NULL CHECK(char_length(address)<=2000 AND address<>'' AND address=app_private.editor_trim(address) AND position(chr(13) in address)=0),
 problem_description text NOT NULL CHECK(char_length(problem_description)<=5000 AND problem_description<>'' AND problem_description=app_private.editor_trim(problem_description) AND position(chr(13) in problem_description)=0),
 service_type text NOT NULL CHECK(service_type IN ('installation','servicing','repair')),
 quoted_price_sen integer NOT NULL CHECK(quoted_price_sen BETWEEN 0 AND 99999999), currency text NOT NULL CHECK(currency='MYR'),
 assigned_technician_id uuid NOT NULL REFERENCES app_private.technicians(id) ON DELETE RESTRICT,
 admin_notes text CHECK(char_length(admin_notes)<=5000 AND admin_notes<>'' AND admin_notes=app_private.editor_trim(admin_notes) AND position(chr(13) in admin_notes)=0),
 status text NOT NULL DEFAULT 'assigned' CHECK(status='assigned'),
 created_by_account_id uuid NOT NULL REFERENCES app_private.accounts(id) ON DELETE RESTRICT,
 assigned_by_account_id uuid NOT NULL REFERENCES app_private.accounts(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), assigned_at timestamptz NOT NULL DEFAULT now(),
 source_draft_id uuid UNIQUE REFERENCES app_private.service_order_drafts(id) ON DELETE RESTRICT,
 CHECK(created_by_account_id=assigned_by_account_id), CHECK(created_at=assigned_at)
);
ALTER SEQUENCE app_private.service_order_number_seq OWNED BY app_private.service_orders.order_number_value;
ALTER TABLE app_private.service_order_drafts ADD FOREIGN KEY(submitted_order_id) REFERENCES app_private.service_orders(id) ON DELETE RESTRICT;
CREATE TABLE app_private.order_editor_operations (
 account_id uuid NOT NULL REFERENCES app_private.accounts(id) ON DELETE RESTRICT, operation_key uuid NOT NULL,
 operation_type text NOT NULL CHECK(operation_type IN ('createDraft','saveDraft','deleteDraft','createOrder','submitDraft')),
 target_draft_id uuid, request_fingerprint bytea NOT NULL CHECK(octet_length(request_fingerprint)=32),
 result_draft_id uuid, result_version integer, result_order_id uuid REFERENCES app_private.service_orders(id) ON DELETE RESTRICT,
 result_order_number_value bigint, result_timestamp timestamptz NOT NULL,
 PRIMARY KEY(account_id,operation_key),
 CHECK((operation_type IN ('createDraft','createOrder') AND target_draft_id IS NULL) OR (operation_type IN ('saveDraft','deleteDraft','submitDraft') AND target_draft_id IS NOT NULL)),
 CHECK(
  (operation_type IN ('createDraft','saveDraft') AND result_draft_id IS NOT NULL AND result_version>0 AND result_version IS NOT NULL AND result_order_id IS NULL AND result_order_number_value IS NULL AND (operation_type='createDraft' OR result_draft_id=target_draft_id)) OR
  (operation_type='deleteDraft' AND result_draft_id=target_draft_id AND result_draft_id IS NOT NULL AND result_version IS NULL AND result_order_id IS NULL AND result_order_number_value IS NULL) OR
  (operation_type IN ('createOrder','submitDraft') AND result_draft_id IS NULL AND result_version IS NULL AND result_order_id IS NOT NULL AND result_order_number_value IS NOT NULL AND result_order_number_value>0)
 )
);
CREATE INDEX ON app_private.service_orders(created_at DESC,id DESC);
CREATE INDEX ON app_private.service_order_drafts(creator_account_id,last_saved_at DESC,id DESC) WHERE submitted_order_id IS NULL;
CREATE INDEX ON app_private.service_orders(assigned_technician_id);
CREATE INDEX ON app_private.service_orders(created_by_account_id);
CREATE INDEX ON app_private.service_orders(assigned_by_account_id);
CREATE INDEX ON app_private.service_order_drafts(proposed_technician_id);
CREATE INDEX ON app_private.service_order_drafts(creator_account_id);
CREATE INDEX ON app_private.order_editor_operations(result_order_id);
REVOKE ALL ON app_private.technicians,app_private.service_orders,app_private.service_order_drafts,app_private.order_editor_operations FROM PUBLIC,app_runtime;
REVOKE ALL ON SEQUENCE app_private.service_order_number_seq FROM PUBLIC,app_runtime;
GRANT SELECT ON app_private.technicians TO app_runtime;
GRANT SELECT,INSERT ON app_private.service_orders,app_private.order_editor_operations TO app_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON app_private.service_order_drafts TO app_runtime;
GRANT USAGE ON SEQUENCE app_private.service_order_number_seq TO app_runtime;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_technician_lock_owner') THEN CREATE ROLE app_technician_lock_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT; END IF;
END $$;
GRANT USAGE ON SCHEMA app_private TO app_technician_lock_owner;
GRANT SELECT,UPDATE(is_active) ON app_private.technicians TO app_technician_lock_owner;
CREATE FUNCTION app_private.lock_active_technician(p_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_active boolean;
BEGIN
 SELECT t.is_active INTO v_active FROM app_private.technicians AS t WHERE t.id=p_id FOR SHARE;
 RETURN COALESCE(v_active,false);
END;
$$;
-- Ownership transfer requires the migration connection's trusted role privileges.
GRANT CREATE ON SCHEMA app_private TO app_technician_lock_owner;
GRANT app_technician_lock_owner TO CURRENT_USER;
ALTER FUNCTION app_private.lock_active_technician(uuid) OWNER TO app_technician_lock_owner;
REVOKE app_technician_lock_owner FROM CURRENT_USER;
REVOKE CREATE ON SCHEMA app_private FROM app_technician_lock_owner;
REVOKE ALL ON FUNCTION app_private.lock_active_technician(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.lock_active_technician(uuid) TO app_runtime;
-- Do not inherit extra EXECUTE grants from the migration role's default ACL.
DO $$ DECLARE grantee_name text; BEGIN
 FOR grantee_name IN
  SELECT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
  JOIN pg_roles r ON r.oid=a.grantee
  WHERE p.oid='app_private.lock_active_technician(uuid)'::regprocedure
   AND a.grantee<>p.proowner AND r.rolname<>'app_runtime'
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION app_private.lock_active_technician(uuid) FROM %I',grantee_name);
 END LOOP;
END $$;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA app_private FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION app_private.lock_active_technician(uuid),app_private.editor_trim(text) FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
