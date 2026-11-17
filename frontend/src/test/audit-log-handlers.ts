// #156：監査ログの閲覧（S-25）のテストで使う MSW の応答（架空のデータのみ）。
// 契約（実装前の仮置き。計画 #156・backend/src/routes/audit-logs.test.ts と同じ）：
//   POST /api/admin/audit-logs/search { from?, to?, actorId?, action?, targetType?, targetId?, result?, cursor?, limit? }
//     → { items: AuditLogItem[], nextCursor: string | null }
//   AuditLogItem：{ id, occurredAt（UTC の ISO 8601）, action, result, actor: { id, displayName: string | null, isActive } | null,
//                   target: { type, id, label: string | null, isActive: boolean | null } | null, failureCategory?, affectedCount?, reason? }
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。
import { http, HttpResponse } from "msw";
import { SHELL_USER } from "./app-shell-harness";
import { server } from "./server";

export type AuditItem = {
  id: string;
  occurredAt: string;
  action: string;
  result: "success" | "failure";
  actor: { id: string; displayName: string | null; isActive: boolean } | null;
  target: {
    type: string;
    id: string;
    label: string | null;
    isActive: boolean | null;
  } | null;
  failureCategory?: string;
  affectedCount?: number;
  reason?: string;
};

export type AuditPage = { items: AuditItem[]; nextCursor: string | null };
export type AuditSearchBody = Record<string, unknown>;

export const AUDIT_PERMISSION = "perm.audit_log.view";

/** n 番目の操作者の ID・表示名（架空） */
export const auditActorId = (n: number) =>
  `01JTEST156FEACT0R000000${String(n).padStart(3, "0")}`;
export const auditActorName = (n: number) =>
  `testuser_156f_actor${String(n).padStart(3, "0")}`;
/** n 番目の対象の社員の ID・表示名（架空） */
export const auditTargetId = (n: number) =>
  `01JTEST156FETARGET00000${String(n).padStart(3, "0")}`;
export const auditTargetName = (n: number) =>
  `testuser_156f_target${String(n).padStart(3, "0")}`;

/** 一覧の1件（既定：操作者 1 が、対象の社員 1 に行ったアカウント無効化の成功） */
export function auditItem(
  n: number,
  overrides: Partial<AuditItem> = {},
): AuditItem {
  return {
    id: `01JTEST156FE1TEM0000000${String(n).padStart(3, "0")}`,
    occurredAt: "2026-11-16T01:02:03.000Z",
    action: "account.deactivate",
    result: "success",
    actor: {
      id: auditActorId(1),
      displayName: auditActorName(1),
      isActive: true,
    },
    target: {
      type: "user",
      id: auditTargetId(1),
      label: auditTargetName(1),
      isActive: true,
    },
    ...overrides,
  };
}

/** GET /api/auth/session：testuser_001 としてログイン済み。権限を選べる（既定は監査ログの閲覧のみ） */
export function respondAuditSession(
  permissions: string[] = [AUDIT_PERMISSION],
  user: { id: string; displayName: string; loginId: string } = SHELL_USER,
) {
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({
        user,
        permissions,
        mustChangePassword: false,
        reauthenticatedAt: null,
      }),
    ),
  );
}

/**
 * POST /api/admin/audit-logs/search の応答。呼ばれた本文を、呼び出しの順に calls へ記録して返す。
 * handler の戻り値が Response（HttpResponse）ならそのまま、そうでなければ 200 の JSON で返す。
 */
export function respondAuditSearch(
  handler: (
    body: AuditSearchBody,
    callNumber: number,
  ) => AuditPage | Response | Promise<AuditPage | Response>,
) {
  const calls: AuditSearchBody[] = [];
  server.use(
    http.post("/api/admin/audit-logs/search", async ({ request }) => {
      const body = (await request.json()) as AuditSearchBody;
      calls.push(body);
      const result = await handler(body, calls.length);
      return result instanceof Response ? result : HttpResponse.json(result);
    }),
  );
  return calls;
}
