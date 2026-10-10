CREATE TABLE buzz_connections (
 user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 team_name text NOT NULL,
 relay_url text NOT NULL,
 web_url text NOT NULL,
 updated_at bigint NOT NULL
);
