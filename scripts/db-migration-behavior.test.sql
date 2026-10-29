BEGIN;

DO $casaora_test$
DECLARE
  customer_id UUID;
  broker_id UUID;
  queue_one UUID;
  queue_two UUID;
  queue_three UUID;
  broker_queue UUID;
  version_one UUID;
  version_two UUID;
  version_count INTEGER;
  version_one_status casaora_queue_status;
BEGIN
  -- Create isolated test users.
  INSERT INTO app_users (email, role, display_name)
  VALUES ('day29-customer@example.test', 'customer', 'Test Customer')
  RETURNING id INTO customer_id;

  INSERT INTO app_users (email, role, display_name)
  VALUES ('day29-broker@example.test', 'broker', 'Test Broker')
  RETURNING id INTO broker_id;

  RAISE NOTICE 'PASS: customer and broker test users created';

  -- Test case-insensitive email uniqueness.
  BEGIN
    INSERT INTO app_users (email, role, display_name)
    VALUES ('DAY29-CUSTOMER@EXAMPLE.TEST', 'customer', 'Duplicate');

    RAISE EXCEPTION USING
      ERRCODE = 'ZX001',
      MESSAGE = 'FAIL: case-insensitive email duplicate was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: duplicate email with different case rejected';
  END;

  -- Create three queues for the customer and one for the broker.
  INSERT INTO customer_requirement_queues (customer_id, created_by)
  VALUES (customer_id, customer_id)
  RETURNING id INTO queue_one;

  INSERT INTO customer_requirement_queues (customer_id, created_by)
  VALUES (customer_id, customer_id)
  RETURNING id INTO queue_two;

  INSERT INTO customer_requirement_queues (customer_id, created_by)
  VALUES (customer_id, customer_id)
  RETURNING id INTO queue_three;

  INSERT INTO customer_requirement_queues (customer_id, created_by)
  VALUES (broker_id, broker_id)
  RETURNING id INTO broker_queue;

  -- First two active queues should be allowed.
  INSERT INTO queue_versions
    (queue_id, version_number, status, listing_type, locality)
  VALUES
    (queue_one, 1, 'active', 'rent', 'Salt Lake');

  INSERT INTO queue_versions
    (queue_id, version_number, status, listing_type, locality)
  VALUES
    (queue_two, 1, 'active', 'sale', 'New Town');

  RAISE NOTICE 'PASS: first two active customer queues accepted';

  -- Third active queue must be rejected.
  BEGIN
    INSERT INTO queue_versions
      (queue_id, version_number, status, listing_type, locality)
    VALUES
      (queue_three, 1, 'active', 'rent', 'Howrah');

    RAISE EXCEPTION USING
      ERRCODE = 'ZX001',
      MESSAGE = 'FAIL: third active customer queue was accepted';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN
      RAISE NOTICE 'PASS: third active customer queue rejected';
  END;

  -- A broker-owned queue must not accept a requirement version.
  BEGIN
    INSERT INTO queue_versions
      (queue_id, version_number, status, listing_type, locality)
    VALUES
      (broker_queue, 1, 'active', 'rent', 'Ballygunge');

    RAISE EXCEPTION USING
      ERRCODE = 'ZX001',
      MESSAGE = 'FAIL: broker-owned requirement queue was accepted';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      RAISE NOTICE 'PASS: broker-owned requirement queue rejected';
  END;

  -- Preserve version 1, pause it, and create active version 2.
  SELECT id INTO version_one
  FROM queue_versions
  WHERE queue_id = queue_one
    AND version_number = 1;

  UPDATE queue_versions
  SET status = 'paused'
  WHERE id = version_one;

  INSERT INTO queue_versions
    (queue_id, version_number, status, listing_type, locality)
  VALUES
    (queue_one, 2, 'active', 'rent', 'New Town')
  RETURNING id INTO version_two;

  SELECT COUNT(*) INTO version_count
  FROM queue_versions
  WHERE queue_id = queue_one;

  SELECT status INTO version_one_status
  FROM queue_versions
  WHERE id = version_one;

  IF version_count <> 2 OR version_one_status <> 'paused' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'ZX001',
      MESSAGE = 'FAIL: previous queue version was not preserved';
  END IF;

  RAISE NOTICE 'PASS: version 1 preserved and version 2 created';

  -- A second active version for the same queue must be rejected.
  BEGIN
    INSERT INTO queue_versions
      (queue_id, version_number, status, listing_type, locality)
    VALUES
      (queue_one, 3, 'active', 'rent', 'Behala');

    RAISE EXCEPTION USING
      ERRCODE = 'ZX001',
      MESSAGE = 'FAIL: two active versions for one queue were accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: second active version rejected';
  END;

  -- An existing version must not be reassigned to another queue.
  BEGIN
    UPDATE queue_versions
    SET queue_id = queue_two
    WHERE id = version_two;

    RAISE EXCEPTION USING
      ERRCODE = 'ZX001',
      MESSAGE = 'FAIL: queue version was moved to another queue';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      RAISE NOTICE 'PASS: moving a version to another queue rejected';
  END;

  RAISE NOTICE 'ALL DATABASE BEHAVIOR CHECKS PASSED';
END;
$casaora_test$;

-- Discard all test users and test records.
ROLLBACK;
