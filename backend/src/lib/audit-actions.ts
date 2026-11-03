// 監査ログの操作の種類の一覧（本番）。機能のIssueが、操作を足すときにここへ足す。本Issueでは空。
export const AUDIT_ACTIONS = [] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
