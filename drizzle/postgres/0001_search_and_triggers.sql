-- Search is an expression index, so no derived column leaks into JSON backups.
CREATE INDEX messages_search_pg_idx ON messages USING gin (to_tsvector('simple', coalesce(subject,'') || ' ' || coalesce(from_addr,'') || ' ' || coalesce(to_addr,'') || ' ' || coalesce(cc_addr,'') || ' ' || coalesce(text_body,'') || ' ' || coalesce(html_body,'')));
CREATE FUNCTION mailflare_trash_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF NEW.status IN ('trash','spam') THEN NEW.trashed_at := extract(epoch FROM now())::bigint; END IF;
 ELSIF (NEW.status IN ('trash','spam')) IS DISTINCT FROM (OLD.status IN ('trash','spam')) THEN
  NEW.trashed_at := CASE WHEN NEW.status IN ('trash','spam') THEN extract(epoch FROM now())::bigint ELSE NULL END;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER messages_trash_timestamp BEFORE INSERT OR UPDATE OF status ON messages FOR EACH ROW EXECUTE FUNCTION mailflare_trash_timestamp();
CREATE FUNCTION mailflare_bump_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE new_mailbox text; old_mailbox text;
BEGIN
 IF TG_OP <> 'DELETE' THEN
  IF TG_TABLE_NAME = 'mailboxes' THEN new_mailbox := NEW.id; ELSE new_mailbox := NEW.mailbox_id; END IF;
 END IF;
 IF TG_OP <> 'INSERT' THEN
  IF TG_TABLE_NAME = 'mailboxes' THEN old_mailbox := OLD.id; ELSE old_mailbox := OLD.mailbox_id; END IF;
 END IF;
 IF new_mailbox IS NOT NULL THEN
  INSERT INTO jmap_mailbox_revisions(mailbox_id,revision) VALUES(new_mailbox,1) ON CONFLICT(mailbox_id) DO UPDATE SET revision = jmap_mailbox_revisions.revision + 1;
 END IF;
 IF old_mailbox IS NOT NULL AND old_mailbox IS DISTINCT FROM new_mailbox THEN
  INSERT INTO jmap_mailbox_revisions(mailbox_id,revision) VALUES(old_mailbox,1) ON CONFLICT(mailbox_id) DO UPDATE SET revision = jmap_mailbox_revisions.revision + 1;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER jmap_messages_pg AFTER INSERT OR UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION mailflare_bump_revision();
CREATE TRIGGER jmap_folders_pg AFTER INSERT OR UPDATE OR DELETE ON folders FOR EACH ROW EXECUTE FUNCTION mailflare_bump_revision();
CREATE TRIGGER jmap_mailboxes_pg AFTER UPDATE ON mailboxes FOR EACH ROW EXECUTE FUNCTION mailflare_bump_revision();
CREATE TRIGGER jmap_aliases_pg AFTER INSERT OR UPDATE OR DELETE ON mailbox_aliases FOR EACH ROW EXECUTE FUNCTION mailflare_bump_revision();
