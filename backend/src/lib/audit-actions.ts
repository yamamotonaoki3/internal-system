// 監査ログの操作の種類の一覧（本番）。機能のIssueが、操作を足すときにここへ足す。
export const AUDIT_ACTIONS = [
  "setup.initial_admin.create",
  "setup.rate_limited",
  "auth.login",
  "auth.logout",
  "auth.rate_limited",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
