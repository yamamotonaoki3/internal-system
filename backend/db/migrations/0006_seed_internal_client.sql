-- 予約取引先 INT の固定初期行。ID は有効な ULID 形式の予約値とする。
INSERT INTO `clients` (`id`, `code`, `name`, `name_normalized`, `is_active`, `version`)
VALUES ('00000000000000000000000000', 'INT', '社内', '社内', 1, 1);
