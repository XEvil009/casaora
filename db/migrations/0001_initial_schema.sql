BEGIN;

-- CASAORA initial relational schema.
-- PostgreSQL 13+ is required for gen_random_uuid().
-- This migration must be applied once, in order, by a migration runner.

CREATE TYPE casaora_user_role AS ENUM (
  'broker',
  'customer',
  'administrator'
);

CREATE TYPE casaora_listing_type AS ENUM (
  'sale',
  'rent'
);

CREATE TYPE casaora_listing_status AS ENUM (
  'draft',
  'published',
  'paused',
  'closed'
);

CREATE TYPE casaora_queue_status AS ENUM (
  'active',
  'paused',
  'completed',
  'superseded'
);

CREATE TYPE casaora_transaction_status AS ENUM (
  'pending',
  'under_review',
  'approved',
  'completed',
  'cancelled',
  'rejected'
);

CREATE TYPE casaora_payment_status AS ENUM (
  'pending',
  'succeeded',
  'failed',
  'refunded'
);

CREATE TYPE casaora_ledger_entry_type AS ENUM (
  'payment',
  'refund',
  'commission',
  'commission_adjustment'
);

CREATE TABLE app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT,
  role casaora_user_role NOT NULL,
  display_name TEXT NOT NULL,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_users_email_not_blank
    CHECK (length(trim(email)) > 0),
  CONSTRAINT app_users_display_name_not_blank
    CHECK (length(trim(display_name)) > 0)
);

CREATE UNIQUE INDEX app_users_email_lower_unique
  ON app_users (lower(email));

CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_key TEXT UNIQUE,
  property_type TEXT NOT NULL DEFAULT 'residential',
  address_line TEXT,
  locality TEXT NOT NULL,
  pin_code VARCHAR(6) NOT NULL,
  bhk SMALLINT,
  area_sq_ft INTEGER,
  created_by UUID REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT properties_locality_not_blank
    CHECK (length(trim(locality)) > 0),
  CONSTRAINT properties_pin_code_format
    CHECK (pin_code ~ '^[0-9]{6}$'),
  CONSTRAINT properties_bhk_range
    CHECK (bhk IS NULL OR bhk BETWEEN 1 AND 20),
  CONSTRAINT properties_area_positive
    CHECK (area_sq_ft IS NULL OR area_sq_ft > 0)
);

CREATE TABLE property_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL
    REFERENCES properties(id) ON DELETE RESTRICT,
  broker_id UUID NOT NULL
    REFERENCES app_users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  listing_type casaora_listing_type NOT NULL,
  price_in_rupees NUMERIC(14, 2) NOT NULL,
  status casaora_listing_status NOT NULL DEFAULT 'draft',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT property_listings_title_not_blank
    CHECK (length(trim(title)) > 0),
  CONSTRAINT property_listings_price_positive
    CHECK (price_in_rupees > 0)
);

CREATE INDEX property_listings_discovery_idx
  ON property_listings (status, listing_type, price_in_rupees);

CREATE INDEX property_listings_property_idx
  ON property_listings (property_id);

CREATE INDEX property_listings_broker_idx
  ON property_listings (broker_id);

-- A canonical property may be associated with multiple brokers.
CREATE TABLE property_brokers (
  property_id UUID NOT NULL
    REFERENCES properties(id) ON DELETE RESTRICT,
  broker_id UUID NOT NULL
    REFERENCES app_users(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (property_id, broker_id)
);

CREATE INDEX property_brokers_broker_idx
  ON property_brokers (broker_id, is_active);

-- The queue row is the durable identity of a customer's requirement.
-- Each reactivation or revision creates a separate queue_versions row.
CREATE TABLE customer_requirement_queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL
    REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
    REFERENCES app_users(id) ON DELETE RESTRICT
);

CREATE INDEX customer_requirement_queues_customer_idx
  ON customer_requirement_queues (customer_id);

CREATE TABLE queue_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL
    REFERENCES customer_requirement_queues(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL,
  status casaora_queue_status NOT NULL DEFAULT 'active',
  listing_type casaora_listing_type NOT NULL,
  locality TEXT NOT NULL,
  pin_code VARCHAR(6),
  minimum_bhk SMALLINT,
  maximum_budget NUMERIC(14, 2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT queue_versions_version_positive
    CHECK (version_number > 0),
  CONSTRAINT queue_versions_unique_version
    UNIQUE (queue_id, version_number),
  CONSTRAINT queue_versions_locality_not_blank
    CHECK (length(trim(locality)) > 0),
  CONSTRAINT queue_versions_pin_code_format
    CHECK (pin_code IS NULL OR pin_code ~ '^[0-9]{6}$'),
  CONSTRAINT queue_versions_bhk_range
    CHECK (minimum_bhk IS NULL OR minimum_bhk BETWEEN 1 AND 20),
  CONSTRAINT queue_versions_budget_positive
    CHECK (maximum_budget IS NULL OR maximum_budget > 0)
);

-- A queue can have no more than one active version.
CREATE UNIQUE INDEX queue_versions_one_active_per_queue
  ON queue_versions (queue_id)
  WHERE status = 'active';

CREATE INDEX queue_versions_active_search_idx
  ON queue_versions (status, listing_type, locality);

-- Serializes queue activation for a customer so concurrent requests
-- cannot bypass the two-active-queues rule.
CREATE FUNCTION enforce_customer_active_queue_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_customer_id UUID;
  target_customer_role casaora_user_role;
  active_queue_count INTEGER;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.queue_id IS DISTINCT FROM OLD.queue_id THEN
    RAISE EXCEPTION 'A queue version cannot be moved to another queue';
  END IF;
  SELECT customer_id
    INTO target_customer_id
    FROM customer_requirement_queues
    WHERE id = NEW.queue_id;

  IF target_customer_id IS NULL THEN
    RAISE EXCEPTION 'Requirement queue does not exist';
  END IF;

  SELECT role
    INTO target_customer_role
    FROM app_users
    WHERE id = target_customer_id;

  IF target_customer_role IS DISTINCT FROM 'customer'::casaora_user_role THEN
    RAISE EXCEPTION 'Requirement queues must belong to a customer';
  END IF;

  IF NEW.status = 'active' THEN
    PERFORM id
      FROM app_users
      WHERE id = target_customer_id
      FOR UPDATE;

    SELECT COUNT(*)
      INTO active_queue_count
      FROM queue_versions qv
      JOIN customer_requirement_queues q
        ON q.id = qv.queue_id
      WHERE q.customer_id = target_customer_id
        AND qv.status = 'active'
        AND qv.queue_id <> NEW.queue_id;

    IF active_queue_count >= 2 THEN
      RAISE EXCEPTION
        'A customer cannot have more than two active requirement queues'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER queue_versions_active_limit_trigger
BEFORE INSERT OR UPDATE OF status, queue_id
ON queue_versions
FOR EACH ROW
EXECUTE FUNCTION enforce_customer_active_queue_limit();

CREATE TABLE property_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL
    REFERENCES app_users(id) ON DELETE RESTRICT,
  property_id UUID NOT NULL
    REFERENCES properties(id) ON DELETE RESTRICT,
  listing_id UUID NOT NULL
    REFERENCES property_listings(id) ON DELETE RESTRICT,
  selected_broker_id UUID NOT NULL
    REFERENCES app_users(id) ON DELETE RESTRICT,
  status casaora_transaction_status NOT NULL DEFAULT 'pending',
  agreed_amount NUMERIC(14, 2) NOT NULL,
  commission_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT property_transactions_amount_positive
    CHECK (agreed_amount > 0),
  CONSTRAINT property_transactions_commission_nonnegative
    CHECK (commission_amount >= 0),
  CONSTRAINT property_transactions_idempotency_not_blank
    CHECK (length(trim(idempotency_key)) > 0)
);

CREATE INDEX property_transactions_customer_idx
  ON property_transactions (customer_id, created_at DESC);

CREATE INDEX property_transactions_broker_idx
  ON property_transactions (selected_broker_id, created_at DESC);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL
    REFERENCES property_transactions(id) ON DELETE RESTRICT,
  amount NUMERIC(14, 2) NOT NULL,
  status casaora_payment_status NOT NULL DEFAULT 'pending',
  provider_reference TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payments_amount_positive CHECK (amount > 0),
  CONSTRAINT payments_idempotency_not_blank
    CHECK (length(trim(idempotency_key)) > 0)
);

CREATE TABLE financial_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL
    REFERENCES property_transactions(id) ON DELETE RESTRICT,
  payment_id UUID REFERENCES payments(id) ON DELETE RESTRICT,
  entry_type casaora_ledger_entry_type NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_ledger_amount_nonzero CHECK (amount <> 0),
  CONSTRAINT financial_ledger_currency_inr CHECK (currency = 'INR'),
  CONSTRAINT financial_ledger_idempotency_not_blank
    CHECK (length(trim(idempotency_key)) > 0)
);

CREATE INDEX financial_ledger_transaction_idx
  ON financial_ledger_entries (transaction_id, created_at);

CREATE TABLE reward_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL
    REFERENCES app_users(id) ON DELETE RESTRICT,
  points INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  reference_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reward_events_points_nonzero CHECK (points <> 0),
  CONSTRAINT reward_events_type_not_blank
    CHECK (length(trim(event_type)) > 0),
  CONSTRAINT reward_events_reference_not_blank
    CHECK (length(trim(reference_key)) > 0)
);

CREATE INDEX reward_events_user_idx
  ON reward_events (user_id, created_at DESC);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL
    REFERENCES app_users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notifications_title_not_blank
    CHECK (length(trim(title)) > 0),
  CONSTRAINT notifications_body_not_blank
    CHECK (length(trim(body)) > 0)
);

CREATE INDEX notifications_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES app_users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_events_type_not_blank
    CHECK (length(trim(event_type)) > 0),
  CONSTRAINT audit_events_entity_type_not_blank
    CHECK (length(trim(entity_type)) > 0),
  CONSTRAINT audit_events_details_object
    CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX audit_events_entity_idx
  ON audit_events (entity_type, entity_id, created_at DESC);

CREATE INDEX audit_events_actor_idx
  ON audit_events (actor_user_id, created_at DESC);

COMMIT;
