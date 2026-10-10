-- Match SQLite FTS punctuation separation and accent-insensitive words without
-- requiring extensions or superuser privileges on the shared PostgreSQL server.
CREATE FUNCTION mailflare_search_text(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
 SELECT regexp_replace(regexp_replace(normalize(value, NFKD), U&'[\0300-\036F]', '', 'g'), '[[:punct:]]+', ' ', 'g')
$$;
DROP INDEX messages_search_pg_idx;
CREATE INDEX messages_search_pg_idx ON messages USING gin (to_tsvector('simple', mailflare_search_text(coalesce(subject,'') || ' ' || coalesce(from_addr,'') || ' ' || coalesce(to_addr,'') || ' ' || coalesce(cc_addr,'') || ' ' || coalesce(text_body,'') || ' ' || coalesce(html_body,''))));
