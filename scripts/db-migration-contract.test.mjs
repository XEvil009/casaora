import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../db/migrations/0001_initial_schema.sql', import.meta.url),
  'utf8'
);

test('migration has explicit transaction boundaries', () => {
  assert.match(sql, /^\s*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
});

test('migration creates all twelve core tables', () => {
  const tables = [
    'app_users',
    'properties',
    'property_listings',
    'property_brokers',
    'customer_requirement_queues',
    'queue_versions',
    'property_transactions',
    'payments',
    'financial_ledger_entries',
    'reward_events',
    'notifications',
    'audit_events'
  ];

  for (const table of tables) {
    assert.match(
      sql,
      new RegExp(`CREATE TABLE ${table}\\s*\\(`),
      `Missing table: ${table}`
    );
  }
});

test('user roles and listing types are constrained by enums', () => {
  assert.match(
    sql,
    /CREATE TYPE casaora_user_role AS ENUM\s*\(\s*'broker',\s*'customer',\s*'administrator'/s
  );
  assert.match(
    sql,
    /CREATE TYPE casaora_listing_type AS ENUM\s*\(\s*'sale',\s*'rent'/s
  );
});

test('email uniqueness is case-insensitive', () => {
  assert.match(
    sql,
    /CREATE UNIQUE INDEX app_users_email_lower_unique\s+ON app_users \(lower\(email\)\)/s
  );
});

test('property PIN codes and prices have database constraints', () => {
  assert.match(sql, /properties_pin_code_format/);
  assert.match(sql, /pin_code ~ '\^\[0-9\]\{6\}\$'/);
  assert.match(sql, /property_listings_price_positive/);
});

test('queue versions retain unique version numbers', () => {
  assert.match(sql, /UNIQUE \(queue_id, version_number\)/);
});

test('only one active version is allowed per queue', () => {
  assert.match(
    sql,
    /CREATE UNIQUE INDEX queue_versions_one_active_per_queue\s+ON queue_versions \(queue_id\)\s+WHERE status = 'active'/s
  );
});

test('queue trigger checks status and queue ownership changes', () => {
  assert.match(
    sql,
    /BEFORE INSERT OR UPDATE OF status, queue_id\s+ON queue_versions/s
  );
  assert.match(sql, /NEW\.queue_id IS DISTINCT FROM OLD\.queue_id/);
  assert.match(sql, /Requirement queues must belong to a customer/);
});

test('active queue limit uses a customer-row lock', () => {
  assert.match(sql, /enforce_customer_active_queue_limit\(\)/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(
    sql,
    /A customer cannot have more than two active requirement queues/
  );
});

test('financial operations have idempotency keys', () => {
  assert.match(sql, /property_transactions[\s\S]*?idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(sql, /payments[\s\S]*?idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(sql, /financial_ledger_entries[\s\S]*?idempotency_key TEXT NOT NULL UNIQUE/);
});

test('financial records use INR and prevent zero-value ledger entries', () => {
  assert.match(sql, /CHECK \(currency = 'INR'\)/);
  assert.match(sql, /CHECK \(amount <> 0\)/);
});

test('audit events use structured JSON details', () => {
  assert.match(sql, /details JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(sql, /jsonb_typeof\(details\) = 'object'/);
});

test('migration does not contain destructive drop statements', () => {
  assert.doesNotMatch(sql, /^\s*DROP\s+(TABLE|TYPE|FUNCTION|SCHEMA)\b/im);
});
