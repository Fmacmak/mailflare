import test from 'node:test';
import assert from 'node:assert/strict';
import { postgresSql } from '../../server/runtime/postgres-sql';
test('Postgres parameters and identifiers are translated without altering literals or comments', () => {
 assert.equal(postgresSql("SELECT `name`, '?' FROM users WHERE email LIKE ? -- ?\nAND id = ?"), "SELECT \"name\", '?' FROM users WHERE email ILIKE $1 -- ?\nAND id = $2");
 assert.equal(postgresSql("SELECT MAX(created_at), MAX(0, spam_count + excluded.spam_count) FROM spam_token_stats"), "SELECT MAX(created_at), GREATEST(0, spam_count + excluded.spam_count) FROM spam_token_stats");
});
test('Drizzle qualified upsert targets become PostgreSQL conflict columns without changing values',()=>{
 assert.equal(postgresSql('INSERT INTO "app_settings" ("id","resend_api_key") VALUES (?,?) ON CONFLICT ("app_settings"."id") DO UPDATE SET "resend_api_key"=?'), 'INSERT INTO "app_settings" ("id","resend_api_key") VALUES ($1,$2) ON CONFLICT ("id") DO UPDATE SET "resend_api_key"=$3');
 assert.equal(postgresSql("INSERT INTO x(a,b) VALUES ('ON CONFLICT (x.a)',?) ON CONFLICT (x.a, `x`.`b`) DO NOTHING"),"INSERT INTO x(a,b) VALUES ('ON CONFLICT (x.a)',$1) ON CONFLICT (a, \"b\") DO NOTHING");
});
