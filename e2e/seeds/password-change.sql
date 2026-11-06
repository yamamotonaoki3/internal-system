-- #123専用の架空データ。既存loginシナリオの利用者を変更しない。
-- passwordは固定テスト値TestPass123!、後始末はpassword-change-cleanup.sql。
INSERT INTO users (id, login_id, login_id_normalized, display_name, legal_name, email, email_normalized, password_hash, must_change_password, is_active)
VALUES
  ('01JTE2E1230000000000000001', 'e2euser_password_001', 'e2euser_password_001', 'testuser_password_001', 'testuser_password_001', 'e2euser_password_001@example.com', 'e2euser_password_001@example.com', '$scrypt$ln=16,r=8,p=2$dF/oe+D7nsT+Ym0wQkXBGQ$Ehhw0tdVmO9jnWFXgGU8/TR+j4cswzbHqT2ZgSooTO8', 0, 1),
  ('01JTE2E1230000000000000002', 'e2euser_password_002', 'e2euser_password_002', 'testuser_password_002', 'testuser_password_002', 'e2euser_password_002@example.com', 'e2euser_password_002@example.com', '$scrypt$ln=16,r=8,p=2$dF/oe+D7nsT+Ym0wQkXBGQ$Ehhw0tdVmO9jnWFXgGU8/TR+j4cswzbHqT2ZgSooTO8', 1, 1)
ON CONFLICT (login_id_normalized) DO NOTHING;
