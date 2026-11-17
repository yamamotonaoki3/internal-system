// #156（0-6 AC-3・AC-5）: 監査ログの検索の API 層（audit-log-api.ts）。共通の apiClient で POST /api/admin/audit-logs/search を呼び、応答を zod で検証する。
// 契約（実装前の仮置き）：searchAuditLogs(request: { from?, to?, actorId?, action?, targetType?, targetId?, result?, cursor?, limit? }) → Promise<{ items, nextCursor }>
// 失敗は、空の一覧にせず、共通の ApiError（status・code・fields）で拒否する。応答の形が違う場合も拒否する（検証を通らないものを画面に渡さない）。
// データは架空（testuser_156f_）。
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { auditItem, respondAuditSearch } from "../../test/audit-log-handlers";
import { searchAuditLogs } from "./audit-log-api";

describe("#156 0-6 AC-3: searchAuditLogs（API 層）", () => {
  it("#156 0-6 AC-3: 指定した絞り込みと cursor・limit を、本文（JSON）で POST し、items と nextCursor を返す", async () => {
    const page = { items: [auditItem(1)], nextCursor: "cursor-1" };
    const calls = respondAuditSearch(() => page);
    const request = {
      from: "2026-11-01",
      to: "2026-11-16",
      actorId: "01JTEST156FEACT0R000000001",
      action: "account.create",
      targetType: "user",
      targetId: "01JTEST156FETARGET00000001",
      result: "failure" as const,
      cursor: "cursor-0",
      limit: 20,
    };
    await expect(searchAuditLogs(request)).resolves.toEqual(page);
    expect(calls).toEqual([request]);
  });

  it("#156 0-6 AC-3: 指定しない項目は、本文に載せない", async () => {
    const calls = respondAuditSearch(() => ({ items: [], nextCursor: null }));
    await expect(searchAuditLogs({})).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(calls).toEqual([{}]);
  });

  it("#156 0-6 AC-5: 応答の項目に detail・traceId・メールなど決めていないものが紛れていても、返さない", async () => {
    respondAuditSearch(() => ({
      items: [
        {
          ...auditItem(1),
          detail: { password: "[E2E_TEST]plain-secret-value" },
          traceId: "trace-should-not-appear",
          email: "testuser_156f@example.com",
        },
      ],
      nextCursor: null,
    }));
    const page = await searchAuditLogs({});
    expect(JSON.stringify(page)).not.toContain("plain-secret-value");
    expect(JSON.stringify(page)).not.toContain("trace-should-not-appear");
    expect(JSON.stringify(page)).not.toContain("@example.com");
  });

  it.each([
    [403, { code: "FORBIDDEN", message: "この操作を行う権限がありません" }],
    [401, { code: "UNAUTHENTICATED", message: "ログインしてください" }],
    [
      422,
      {
        code: "VALIDATION_ERROR",
        message: "入力内容を確かめてください",
        fields: ["to"],
      },
    ],
    [500, { code: "INTERNAL_ERROR", message: "失敗しました" }],
  ])(
    "#156 0-6 AC-3: %s の応答は、空の一覧にせず、status・code（422 は fields）つきで拒否する",
    async (status, body) => {
      respondAuditSearch(() => HttpResponse.json(body, { status }));
      await expect(searchAuditLogs({})).rejects.toMatchObject({
        status,
        code: body.code,
        ...("fields" in body ? { fields: body.fields } : {}),
      });
    },
  );

  it.each([
    ["items がない", { nextCursor: null }],
    ["items が配列でない", { items: "x", nextCursor: null }],
    ["nextCursor がない", { items: [] }],
    [
      "result が成功・失敗以外",
      { items: [{ ...auditItem(1), result: "unknown" }], nextCursor: null },
    ],
    [
      "日時がない",
      {
        items: [{ ...auditItem(1), occurredAt: undefined }],
        nextCursor: null,
      },
    ],
  ])(
    "#156 0-6 AC-3: 応答の形が違う（%s）ときは、拒否する（空の一覧にしない）",
    async (_label, body) => {
      respondAuditSearch(() => HttpResponse.json(body));
      await expect(searchAuditLogs({})).rejects.toBeDefined();
    },
  );
});
