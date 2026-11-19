-- drizzle-kit はテーブルの作り直しを生成したため、ADR-0024 に従い ADD COLUMN に書き換えた。
ALTER TABLE `message_attachments` ADD `publication_visibility` text DEFAULT 'participants_only' NOT NULL CONSTRAINT "message_attachments_publication_visibility_check" CHECK (`publication_visibility` IN ('participants_only', 'public_archive'));
