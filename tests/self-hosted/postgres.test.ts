import test from 'node:test';
import assert from 'node:assert/strict';
import { postgresSql } from '../../server/runtime/postgres-sql';
test('Postgres parameters and identifiers are translated without altering literals or comments', () => {
 assert.equal(postgresSql("SELECT `name`, '?' FROM users WHERE email LIKE ? -- ?\nAND id = ?"), "SELECT \"name\", '?' FROM users WHERE email ILIKE $1 -- ?\nAND id = $2");
 assert.equal(postgresSql("SELECT MAX(created_at), MAX(0, spam_count + excluded.spam_count) FROM spam_token_stats"), "SELECT MAX(created_at), GREATEST(0, spam_count + excluded.spam_count) FROM spam_token_stats");
});
