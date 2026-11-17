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
  "account.deactivate",
  "account.reactivate",
  "account.transfer",
  "channel.join",
  "channel.invite",
  "channel.company_general_backfill",
  "status.proxy_set",
  "profile.display_name_change",
  "channel_request.create",
  "channel_request.approve",
  "channel_request.reject",
  "channel_request.withdraw",
  "case_request.create",
  "case_request.withdraw",
  "retirement_request.create",
  "retirement_request.reject",
  "retirement_request.withdraw",
  "case_request.approve",
  "case_request.reject",
  "message.delete",
  "audit_log.view",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// 監査ログの対象の種類（target_type）の一覧。画面の絞り込み・検索の入力の検証の定義元。
// 各書き込みの targetType の型をこの一覧に絞ることは、いまはしない（最小の変更）。
export const AUDIT_TARGET_TYPES = [
  "user",
  "department",
  "client",
  "channel",
  "channel_request",
  "case_request",
  "retirement_request",
  "message",
  "source",
  "audit_log",
] as const;

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];
