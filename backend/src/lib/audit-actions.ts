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
  "department.create",
  "department.rename",
  "department.owner_change",
  "department.channel_backfill",
  "account.create",
  "channel.join",
  "channel.company_general_backfill",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
