// 監査ログの操作の種類の一覧（本番）。機能のIssueが、操作を足すときにここへ足す。
export const AUDIT_ACTIONS = [
  "setup.initial_admin.create",
  "setup.rate_limited",
  "auth.login",
  "auth.logout",
  "auth.password_change",
  "auth.reauthenticate",
  "auth.rate_limited",
  "client.create",
  "client.rename",
  "client.deactivate",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
