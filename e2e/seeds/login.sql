-- #120 E2E（login.spec.ts・sample-users.spec.ts）用の架空の利用者（C-05・C-37）。社員IDは e2euser_ で始め、後始末（e2e/seeds/login-cleanup.sql・backend/db/seeds/cleanup.sql）で識別して消す。
-- パスワードはテスト専用の固定値 TestPass123! のハッシュ（backend/src/lib/password.ts の hashPassword と同じ PHC 形式。scrypt ln=16,r=8,p=2）。本物の認証情報ではない。
-- ハッシュは hashPassword("TestPass123!") を一度実行して得た固定値（ソルトは乱数のため、作り直すと文字列は変わるが検証の結果は同じ）。
-- 初代管理者（全体管理者のロールの割り当て）は入れない。setup.spec.ts の「未設定」の前提を崩さないため。社員ID・メールも setup.spec.ts（e2euser_001・e2euser_002）と重ならない値にする。
-- 何回流しても同じ結果になるようにする（すでにあれば何もしない）。
INSERT INTO users (id, login_id, login_id_normalized, display_name, legal_name, email, email_normalized, password_hash, must_change_password, is_active)
VALUES
  ('01JTE2E0000000000000000001', 'e2euser_login_001', 'e2euser_login_001', 'テスト一郎', 'テスト一郎', 'e2euser_login_001@example.com', 'e2euser_login_001@example.com', '$scrypt$ln=16,r=8,p=2$dF/oe+D7nsT+Ym0wQkXBGQ$Ehhw0tdVmO9jnWFXgGU8/TR+j4cswzbHqT2ZgSooTO8', 0, 1),
  ('01JTE2E0000000000000000002', 'e2euser_login_002', 'e2euser_login_002', 'テスト二郎', 'テスト二郎', 'e2euser_login_002@example.com', 'e2euser_login_002@example.com', '$scrypt$ln=16,r=8,p=2$dF/oe+D7nsT+Ym0wQkXBGQ$Ehhw0tdVmO9jnWFXgGU8/TR+j4cswzbHqT2ZgSooTO8', 1, 1)
ON CONFLICT (login_id_normalized) DO NOTHING;
