-- PostgreSQL baseline corresponding to the current SQLite migrations.
-- Integer booleans and epoch seconds preserve the shared D1 data contract.

CREATE TABLE "agent_chat_messages" (
  "id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "tool_name" text,
  "created_at" bigint NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "agent_conversations" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "mailbox_id" text NOT NULL,
  "title" text NOT NULL DEFAULT 'New conversation',
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "agent_draft_metadata" (
  "draft_id" text NOT NULL,
  "mailbox_id" text NOT NULL,
  "origin" text NOT NULL,
  "source_message_id" text,
  "revision" bigint NOT NULL DEFAULT 1,
  "human_edited_at" bigint,
  "created_at" bigint NOT NULL,
  "scheduled_at" bigint,
  PRIMARY KEY ("draft_id")
);

CREATE TABLE "agent_jobs" (
  "id" text NOT NULL,
  "mailbox_id" text NOT NULL,
  "source_message_id" text NOT NULL,
  "reviewer_user_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" bigint NOT NULL DEFAULT 0,
  "next_attempt_at" bigint NOT NULL,
  "lease_until" bigint,
  "draft_id" text,
  "reason" text,
  "created_at" bigint NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "agent_send_approvals" (
  "id" text NOT NULL,
  "draft_id" text NOT NULL,
  "mailbox_id" text NOT NULL,
  "user_id" text NOT NULL,
  "request_key_id" text,
  "revision" bigint NOT NULL,
  "payload_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "claimed_at" bigint,
  "message_id" text,
  "expires_at" bigint NOT NULL,
  "created_at" bigint NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "ai_usage" (
  "id" text NOT NULL,
  "created_at" bigint NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "source" text NOT NULL,
  "input_tokens" bigint,
  "output_tokens" bigint,
  "cost_usd_micros" bigint,
  PRIMARY KEY ("id")
);

CREATE TABLE "api_keys" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "scopes" text NOT NULL,
  "created_at" bigint NOT NULL,
  "last_used_at" bigint,
  "kind" text NOT NULL DEFAULT 'legacy',
  "mailbox_scope_enabled" bigint NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);

CREATE TABLE "app_settings" (
  "id" text NOT NULL,
  "app_name" text NOT NULL DEFAULT 'Mailflare',
  "icon_key" text,
  "updated_at" bigint NOT NULL,
  "agent_provider" text,
  "agent_preset" text,
  "agent_base_url" text,
  "agent_api_key" text,
  "agent_model" text,
  "agent_enabled" bigint NOT NULL DEFAULT 1,
  "agent_model_rates" text,
  "resend_api_key" text,
  "aws_config" text,
  "ses_receiving" text,
  "resend_webhook_id" text,
  "resend_webhook_secret" text,
  "drive_storage_limit_bytes" bigint,
  "outbound_attachment_max_mb" bigint NOT NULL DEFAULT 25,
  PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" text NOT NULL,
  "actor_user_id" text,
  "target_user_id" text,
  "mailbox_id" text,
  "message_id" text,
  "action" text NOT NULL,
  "metadata" text,
  "created_at" bigint NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "auto_reply_deliveries" (
  "id" text NOT NULL,
  "mailbox_id" text NOT NULL,
  "recipient" text NOT NULL,
  "sent_at" bigint NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "backup_settings" (
  "id" text NOT NULL,
  "enabled" bigint NOT NULL DEFAULT 0,
  "schedule_type" text NOT NULL DEFAULT 'daily',
  "schedule_value" bigint,
  "retention_enabled" bigint NOT NULL DEFAULT 0,
  "retention_days" bigint NOT NULL DEFAULT 30,
  "updated_at" bigint NOT NULL,
  "excluded_table_groups" text NOT NULL DEFAULT '[]',
  PRIMARY KEY ("id")
);

CREATE TABLE "backups" (
  "id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "trigger" text NOT NULL,
  "r2_key" text,
  "filename" text,
  "size" bigint,
  "error" text,
  "created_by_user_id" text,
  "created_at" bigint NOT NULL,
  "started_at" bigint,
  "completed_at" bigint,
  PRIMARY KEY ("id")
);

CREATE TABLE "booking_events" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "color" text NOT NULL DEFAULT '#2563eb',
  "host_ids" text NOT NULL DEFAULT '[]',
  "duration_minutes" bigint NOT NULL,
  "location" text NOT NULL DEFAULT '',
  "weekdays" text NOT NULL DEFAULT '[1,2,3,4,5]',
  "start_time" text NOT NULL DEFAULT '09:00',
  "end_time" text NOT NULL DEFAULT '17:00',
  "time_ranges" text NOT NULL DEFAULT '[{"startTime":"09:00","endTime":"17:00"}]',
  "time_zone" text NOT NULL DEFAULT 'UTC',
  "enabled" bigint NOT NULL DEFAULT 1,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "calendar_events" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "mailbox_id" text,
  "title" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "location" text NOT NULL DEFAULT '',
  "attendees" text NOT NULL DEFAULT '[]',
  "starts_at" bigint NOT NULL,
  "ends_at" bigint NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "color" text NOT NULL DEFAULT 'blue',
  "repeat" text NOT NULL DEFAULT 'none',
  "repeat_until" bigint,
  "repeat_days" text NOT NULL DEFAULT '[]',
  "repeat_anchor_day" bigint,
  "excluded_occurrences" text NOT NULL DEFAULT '[]',
  "time_zone" text,
  PRIMARY KEY ("id")
);

CREATE TABLE "contacts" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "email" text NOT NULL,
  "display_name" text,
  "source" text NOT NULL DEFAULT 'inbound',
  "last_seen_at" bigint,
  "created_at" bigint NOT NULL,
  "blocked" bigint NOT NULL DEFAULT 0,
  "avatar_key" text,
  PRIMARY KEY ("id")
);

CREATE TABLE "domains" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "hostname" text NOT NULL,
  "zone_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "routing_status" text,
  "sending_subdomain_tag" text,
  "sending_enabled" bigint NOT NULL DEFAULT 0,
  "routing_enabled" bigint NOT NULL DEFAULT 0,
  "created_at" bigint NOT NULL,
  "sending_requested" bigint NOT NULL DEFAULT 0,
  "sending_provider" text NOT NULL DEFAULT 'none',
  "receiving_provider" text NOT NULL DEFAULT 'cloudflare',
  PRIMARY KEY ("id")
);

CREATE TABLE "drive_items" (
  "id" text NOT NULL,
  "owner_id" text NOT NULL,
  "parent_id" text,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "r2_key" text,
  "size" bigint NOT NULL DEFAULT 0,
  "content_type" text NOT NULL DEFAULT 'application/octet-stream',
  "link_token" text,
  "trashed_at" bigint,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "upload_id" text,
  "upload_part_size" bigint,
  "upload_fingerprint" text,
  PRIMARY KEY ("id")
);

CREATE TABLE "drive_shares" (
  "id" text NOT NULL,
  "item_id" text NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL DEFAULT 'view',
  "created_at" bigint NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "drive_upload_parts" (
  "item_id" text NOT NULL,
  "part_number" bigint NOT NULL,
  "etag" text NOT NULL
);

CREATE TABLE "email_templates" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "subject" text NOT NULL DEFAULT '',
  "text_body" text NOT NULL DEFAULT '',
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "folders" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "mailbox_id" text NOT NULL,
  "name" text NOT NULL,
  "created_at" bigint NOT NULL,
  "color" text NOT NULL DEFAULT '#2563eb',
  PRIMARY KEY ("id")
);

CREATE TABLE "jmap_mailbox_revisions" (
  "mailbox_id" text NOT NULL,
  "revision" bigint NOT NULL DEFAULT 0,
  PRIMARY KEY ("mailbox_id")
);

CREATE TABLE "license_settings" (
  "id" text NOT NULL,
  "instance_id" text NOT NULL,
  "instance_url" text,
  "license_key_hash" text,
  "plan" text NOT NULL DEFAULT 'community',
  "state" text NOT NULL DEFAULT 'inactive',
  "features" text NOT NULL DEFAULT '[]',
  "activated_at" bigint,
  "validated_at" bigint,
  "updated_at" bigint NOT NULL,
  "seat_limit" bigint DEFAULT 1,
  PRIMARY KEY ("id")
);

CREATE TABLE "login_challenges" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" bigint NOT NULL,
  "created_at" bigint NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("token_hash")
);

CREATE TABLE "mailbox_access" (
  "id" text NOT NULL,
  "mailbox_id" text NOT NULL,
  "user_id" text NOT NULL,
  "permission" text NOT NULL DEFAULT 'read_only',
  "created_by_user_id" text,
  "created_at" bigint NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "mailbox_agent_settings" (
  "mailbox_id" text NOT NULL,
  "enabled" bigint NOT NULL DEFAULT 1,
  "auto_draft_enabled" bigint NOT NULL DEFAULT 0,
  "reviewer_user_id" text,
  "instructions" text NOT NULL DEFAULT '',
  "daily_limit" bigint NOT NULL DEFAULT 25,
  "updated_at" bigint NOT NULL,
  "model_id" text,
  PRIMARY KEY ("mailbox_id")
);

CREATE TABLE "mailbox_aliases" (
  "id" text NOT NULL,
  "mailbox_id" text NOT NULL,
  "domain_id" text NOT NULL,
  "local_part" text NOT NULL,
  "created_at" bigint NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "mailboxes" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "domain_id" text NOT NULL,
  "local_part" text NOT NULL,
  "display_name" text,
  "created_at" bigint NOT NULL,
  "type" text NOT NULL DEFAULT 'personal',
  "disabled" bigint NOT NULL DEFAULT 0,
  "avatar_key" text,
  "use_all_domains" bigint NOT NULL DEFAULT 1,
  "signature" text,
  "auto_reply_enabled" bigint NOT NULL DEFAULT 0,
  "auto_reply_subject" text NOT NULL DEFAULT 'Out of office',
  "auto_reply_body" text NOT NULL DEFAULT '',
  PRIMARY KEY ("id")
);

CREATE TABLE "mcp_key_mailboxes" (
  "key_id" text NOT NULL,
  "mailbox_id" text NOT NULL
);

CREATE TABLE "message_attachments" (
  "id" text NOT NULL,
  "message_id" text NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size" bigint NOT NULL,
  "disposition" text NOT NULL DEFAULT 'attachment',
  "content_id" text,
  "r2_key" text NOT NULL,
  "created_at" bigint NOT NULL,
  "trashed_at" bigint,
  PRIMARY KEY ("id")
);

CREATE TABLE "messages" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "mailbox_id" text,
  "direction" text NOT NULL,
  "provider_message_id" text,
  "from_addr" text NOT NULL,
  "to_addr" text NOT NULL,
  "subject" text,
  "snippet" text,
  "status" text NOT NULL DEFAULT 'received',
  "thread_id" text,
  "created_at" bigint NOT NULL,
  "read" bigint NOT NULL DEFAULT 0,
  "folder_id" text,
  "snoozed_until" bigint,
  "starred" bigint NOT NULL DEFAULT 0,
  "text_body" text,
  "html_body" text,
  "raw_r2_key" text,
  "cc_addr" text,
  "bcc_addr" text,
  "in_reply_to" text,
  "references_header" text,
  "spam_score" bigint,
  "spam_verdict" text,
  "spam_signals" text,
  "spam_analyzed_at" bigint,
  "spam_analysis_error" text,
  "trashed_at" bigint,
  PRIMARY KEY ("id")
);

CREATE TABLE "mfa_recovery_codes" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "code_hash" text NOT NULL,
  "used_at" bigint,
  "created_at" bigint NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("code_hash")
);

CREATE TABLE "outbound_jobs" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "message_id" text,
  "status" text NOT NULL DEFAULT 'queued',
  "payload" text NOT NULL,
  "error" text,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  "scheduled_at" bigint,
  PRIMARY KEY ("id")
);

CREATE TABLE "password_reset_tokens" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" bigint NOT NULL,
  "used_at" bigint,
  "created_at" bigint NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("token_hash")
);

CREATE TABLE "push_subscriptions" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "session_id" text NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "routing_rules" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "domain_id" text NOT NULL,
  "pattern" text NOT NULL,
  "mailbox_id" text,
  "action" text NOT NULL DEFAULT 'store',
  "forward_to" text,
  "priority" bigint NOT NULL DEFAULT 0,
  "created_at" bigint NOT NULL,
  "folder_id" text,
  "match_field" text NOT NULL DEFAULT 'email',
  "match_operator" text NOT NULL DEFAULT 'contains',
  "match_value" text NOT NULL DEFAULT '',
  "scope" text NOT NULL DEFAULT 'mailbox',
  "name" text,
  "enabled" bigint NOT NULL DEFAULT 1,
  "keep_copy" bigint NOT NULL DEFAULT 0,
  "reject_reason" text,
  "last_matched_at" bigint,
  "match_count" bigint NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" bigint NOT NULL,
  "created_at" bigint NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "shared_attachment_links" (
  "id" text NOT NULL,
  "attachment_id" text NOT NULL,
  "expires_at" bigint NOT NULL,
  "created_at" bigint NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("attachment_id")
);

CREATE TABLE "spam_feedback" (
  "message_id" text NOT NULL,
  "mailbox_id" text NOT NULL,
  "actor_user_id" text,
  "classification" text NOT NULL,
  "training_tokens" text NOT NULL,
  "reputation_keys" text NOT NULL,
  "tokenizer_version" bigint NOT NULL DEFAULT 1,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  PRIMARY KEY ("message_id")
);

CREATE TABLE "spam_reputation" (
  "mailbox_id" text NOT NULL,
  "type" text NOT NULL,
  "key" text NOT NULL,
  "messages_seen" bigint NOT NULL DEFAULT 0,
  "spam_count" bigint NOT NULL DEFAULT 0,
  "ham_count" bigint NOT NULL DEFAULT 0,
  "first_seen_at" bigint NOT NULL,
  "last_seen_at" bigint NOT NULL
);

CREATE TABLE "spam_token_stats" (
  "mailbox_id" text NOT NULL,
  "token" text NOT NULL,
  "spam_count" bigint NOT NULL DEFAULT 0,
  "ham_count" bigint NOT NULL DEFAULT 0,
  "updated_at" bigint NOT NULL
);

CREATE TABLE "users" (
  "id" text NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "name" text NOT NULL,
  "created_at" bigint NOT NULL,
  "reset_email" text,
  "role" text NOT NULL DEFAULT 'user',
  "created_by_user_id" text,
  "disabled" bigint NOT NULL DEFAULT 0,
  "avatar_key" text,
  "can_manage_mailboxes" bigint NOT NULL DEFAULT 0,
  "forwarding_email" text,
  "keyboard_shortcuts_enabled" bigint NOT NULL DEFAULT 1,
  "spam_protection_enabled" bigint NOT NULL DEFAULT 1,
  "totp_secret" text,
  "totp_enabled" bigint NOT NULL DEFAULT 0,
  "totp_confirmed_at" bigint,
  "show_full_recipient_addresses" bigint NOT NULL DEFAULT 0,
  "trash_retention_days" bigint,
  "time_zone" text,
  "booking_username" text,
  "is_primary_admin" bigint NOT NULL DEFAULT 0,
  "can_manage_domains" bigint NOT NULL DEFAULT 0,
  "can_manage_users" bigint NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);

CREATE TABLE "webhook_deliveries" (
  "id" text NOT NULL,
  "webhook_id" text NOT NULL,
  "event_type" text NOT NULL,
  "payload" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" bigint NOT NULL DEFAULT 0,
  "created_at" bigint NOT NULL,
  "response_status" bigint,
  "error" text,
  "duration_ms" bigint,
  "last_attempt_at" bigint,
  "next_retry_at" bigint,
  PRIMARY KEY ("id")
);

CREATE TABLE "webhooks" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "url" text NOT NULL,
  "secret" text NOT NULL,
  "events" text NOT NULL,
  "enabled" bigint NOT NULL DEFAULT 1,
  "created_at" bigint NOT NULL,
  "description" text,
  "max_attempts" bigint NOT NULL DEFAULT 5,
  PRIMARY KEY ("id")
);

ALTER TABLE "agent_chat_messages" ADD FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agent_conversations" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agent_conversations" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agent_draft_metadata" ADD FOREIGN KEY ("source_message_id") REFERENCES "messages" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agent_draft_metadata" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agent_draft_metadata" ADD FOREIGN KEY ("draft_id") REFERENCES "messages" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agent_jobs" ADD FOREIGN KEY ("draft_id") REFERENCES "messages" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agent_jobs" ADD FOREIGN KEY ("reviewer_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agent_jobs" ADD FOREIGN KEY ("source_message_id") REFERENCES "messages" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agent_jobs" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agent_send_approvals" ADD FOREIGN KEY ("request_key_id") REFERENCES "api_keys" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agent_send_approvals" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agent_send_approvals" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "agent_send_approvals" ADD FOREIGN KEY ("draft_id") REFERENCES "messages" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "api_keys" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "audit_logs" ADD FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "audit_logs" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "audit_logs" ADD FOREIGN KEY ("target_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "audit_logs" ADD FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "auto_reply_deliveries" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "backups" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "booking_events" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "calendar_events" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "calendar_events" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "contacts" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "domains" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "drive_items" ADD FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "drive_shares" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "drive_shares" ADD FOREIGN KEY ("item_id") REFERENCES "drive_items" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "drive_upload_parts" ADD FOREIGN KEY ("item_id") REFERENCES "drive_items" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "email_templates" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "folders" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "folders" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "login_challenges" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "mailbox_access" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "mailbox_access" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "mailbox_access" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "mailbox_agent_settings" ADD FOREIGN KEY ("reviewer_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "mailbox_agent_settings" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "mailbox_aliases" ADD FOREIGN KEY ("domain_id") REFERENCES "domains" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "mailbox_aliases" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "mailboxes" ADD FOREIGN KEY ("domain_id") REFERENCES "domains" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "mailboxes" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "mcp_key_mailboxes" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "mcp_key_mailboxes" ADD FOREIGN KEY ("key_id") REFERENCES "api_keys" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "message_attachments" ADD FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "messages" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "messages" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "messages" ADD FOREIGN KEY ("folder_id") REFERENCES "folders" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "mfa_recovery_codes" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "outbound_jobs" ADD FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "outbound_jobs" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "password_reset_tokens" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "push_subscriptions" ADD FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "push_subscriptions" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "routing_rules" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "routing_rules" ADD FOREIGN KEY ("domain_id") REFERENCES "domains" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "routing_rules" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "routing_rules" ADD FOREIGN KEY ("folder_id") REFERENCES "folders" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "sessions" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "shared_attachment_links" ADD FOREIGN KEY ("attachment_id") REFERENCES "message_attachments" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "spam_feedback" ADD FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "spam_feedback" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "spam_feedback" ADD FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "spam_reputation" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "spam_token_stats" ADD FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "users" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "webhook_deliveries" ADD FOREIGN KEY ("webhook_id") REFERENCES "webhooks" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "webhooks" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX "domains_hostname_idx" ON "domains" ("hostname");

CREATE INDEX "domains_user_idx" ON "domains" ("user_id");

CREATE UNIQUE INDEX "mailboxes_address_idx" ON "mailboxes" ("domain_id","local_part");

CREATE INDEX "messages_user_created_idx" ON "messages" ("user_id","created_at");

CREATE INDEX "messages_mailbox_idx" ON "messages" ("mailbox_id");

CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" ("token_hash");

CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");

CREATE UNIQUE INDEX "contacts_user_email_idx" ON "contacts" ("user_id","email");

CREATE INDEX "contacts_user_idx" ON "contacts" ("user_id");

CREATE INDEX "users_created_by_idx" ON "users" ("created_by_user_id");

CREATE UNIQUE INDEX "folders_mailbox_name_idx" ON "folders" ("mailbox_id","name");

CREATE INDEX "folders_user_idx" ON "folders" ("user_id");

CREATE INDEX "folders_mailbox_idx" ON "folders" ("mailbox_id");

CREATE INDEX "messages_folder_idx" ON "messages" ("folder_id");

CREATE UNIQUE INDEX "mailbox_access_mailbox_user_idx" ON "mailbox_access" ("mailbox_id","user_id");

CREATE INDEX "mailbox_access_user_idx" ON "mailbox_access" ("user_id");

CREATE INDEX "mailbox_access_mailbox_idx" ON "mailbox_access" ("mailbox_id");

CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" ("actor_user_id");

CREATE INDEX "audit_logs_mailbox_idx" ON "audit_logs" ("mailbox_id");

CREATE INDEX "audit_logs_created_idx" ON "audit_logs" ("created_at");

CREATE UNIQUE INDEX "message_attachments_r2_key_unique" ON "message_attachments" ("r2_key");

CREATE INDEX "message_attachments_message_idx" ON "message_attachments" ("message_id");

CREATE INDEX "backups_created_idx" ON "backups" ("created_at");

CREATE INDEX "backups_status_idx" ON "backups" ("status");

CREATE UNIQUE INDEX "license_settings_instance_id_unique" ON "license_settings" ("instance_id");

CREATE INDEX "email_templates_user_idx" ON "email_templates" ("user_id");

CREATE INDEX "calendar_events_user_starts_idx" ON "calendar_events" ("user_id", "starts_at");

CREATE UNIQUE INDEX "auto_reply_deliveries_mailbox_recipient_idx" ON "auto_reply_deliveries" ("mailbox_id", "recipient");

CREATE INDEX "auto_reply_deliveries_sent_idx" ON "auto_reply_deliveries" ("sent_at");

CREATE UNIQUE INDEX "mailbox_aliases_address_idx" ON "mailbox_aliases" ("domain_id", "local_part");

CREATE INDEX "mailbox_aliases_mailbox_idx" ON "mailbox_aliases" ("mailbox_id");

CREATE INDEX "routing_rules_domain_scope_idx" ON "routing_rules" ("domain_id","scope","enabled");

CREATE INDEX "routing_rules_mailbox_idx" ON "routing_rules" ("mailbox_id");

CREATE INDEX "routing_rules_priority_idx" ON "routing_rules" ("priority");

CREATE INDEX "webhook_deliveries_webhook_idx" ON "webhook_deliveries" ("webhook_id","created_at");

CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" ("status");

CREATE INDEX "messages_thread_idx" ON "messages" ("mailbox_id","thread_id");

CREATE INDEX "messages_provider_message_idx" ON "messages" ("mailbox_id","provider_message_id");

CREATE INDEX "messages_raw_r2_key_idx" ON "messages" ("raw_r2_key");

CREATE UNIQUE INDEX "spam_token_stats_mailbox_token_idx" ON "spam_token_stats" ("mailbox_id", "token");

CREATE INDEX "spam_token_stats_mailbox_idx" ON "spam_token_stats" ("mailbox_id");

CREATE UNIQUE INDEX "spam_reputation_mailbox_type_key_idx" ON "spam_reputation" ("mailbox_id", "type", "key");

CREATE INDEX "spam_reputation_mailbox_idx" ON "spam_reputation" ("mailbox_id");

CREATE INDEX "spam_feedback_mailbox_idx" ON "spam_feedback" ("mailbox_id");

CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" ("user_id");

CREATE INDEX "mfa_recovery_codes_user_idx" ON "mfa_recovery_codes" ("user_id");

CREATE INDEX "agent_conversations_owner_idx" ON "agent_conversations" ("user_id", "mailbox_id", "updated_at");

CREATE INDEX "agent_chat_messages_conversation_idx" ON "agent_chat_messages" ("conversation_id", "created_at");

CREATE UNIQUE INDEX "agent_jobs_source_idx" ON "agent_jobs" ("mailbox_id", "source_message_id");

CREATE INDEX "agent_jobs_due_idx" ON "agent_jobs" ("status", "next_attempt_at");

CREATE INDEX "agent_send_approvals_user_idx" ON "agent_send_approvals" ("user_id", "status");

CREATE UNIQUE INDEX "agent_send_approvals_delivery_idx" ON "agent_send_approvals" ("draft_id") WHERE "status" IN ('claimed', 'sent', 'unknown');

CREATE UNIQUE INDEX "mcp_key_mailbox_idx" ON "mcp_key_mailboxes" ("key_id", "mailbox_id");

CREATE INDEX "ai_usage_created_idx" ON "ai_usage" ("created_at");

CREATE INDEX "messages_inbox_page_idx" ON "messages" ("mailbox_id", "status", "folder_id", "created_at" DESC, "id" DESC);

CREATE INDEX "messages_thread_key_idx" ON "messages" ("mailbox_id", "status", "folder_id", coalesce("thread_id", "id"), "created_at");

CREATE INDEX "messages_mailbox_thread_key_idx" ON "messages" ("mailbox_id", coalesce("thread_id", "id"));

CREATE INDEX "messages_trashed_at_idx" ON "messages" ("trashed_at");

CREATE UNIQUE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" ("endpoint");

CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");

CREATE INDEX "push_subscriptions_session_idx" ON "push_subscriptions" ("session_id");

CREATE INDEX "drive_items_owner_parent_idx" ON "drive_items" ("owner_id","parent_id");

CREATE UNIQUE INDEX "drive_items_link_token_idx" ON "drive_items" ("link_token");

CREATE UNIQUE INDEX "drive_shares_item_user_idx" ON "drive_shares" ("item_id","user_id");

CREATE INDEX "drive_shares_user_idx" ON "drive_shares" ("user_id");

CREATE UNIQUE INDEX "drive_upload_parts_idx" ON "drive_upload_parts" ("item_id","part_number");

CREATE INDEX idx_api_keys_prefix ON api_keys(prefix);

CREATE INDEX "mailboxes_user_idx" ON "mailboxes" ("user_id");

CREATE INDEX "booking_events_user_idx" ON "booking_events" ("user_id");

CREATE UNIQUE INDEX "booking_events_user_slug_idx" ON "booking_events" ("user_id", "slug");

CREATE UNIQUE INDEX "users_booking_username_idx" ON "users" ("booking_username");

INSERT INTO "app_settings" ("id", "app_name", "icon_key", "updated_at", "agent_provider", "agent_preset", "agent_base_url", "agent_api_key", "agent_model", "agent_enabled", "agent_model_rates", "resend_api_key", "aws_config", "ses_receiving", "resend_webhook_id", "resend_webhook_secret", "drive_storage_limit_bytes", "outbound_attachment_max_mb") VALUES ('default', 'Mailflare', NULL, 1791654359, NULL, NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 25);

INSERT INTO "backup_settings" ("id", "enabled", "schedule_type", "schedule_value", "retention_enabled", "retention_days", "updated_at", "excluded_table_groups") VALUES ('default', 0, 'daily', NULL, 0, 30, 1791654359, '[]');
