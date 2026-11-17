// #156（0-6 AC-1）: セッションの応答の検証（auth-api.ts の fetchSession）が、監査ログの閲覧の権限 perm.audit_log.view を受け入れる。
// 受け入れないと、全体管理者のセッションの取得が応答の検証で失敗し、画面が開けない（権限が画面に届く唯一の経路）。
// 未知の権限 ID は、いままでどおり拒否する。データは架空（testuser_156f_）。
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../../test/server";
import { fetchSession } from "./auth-api";

const user = {
  id: "01JTEST156FESESS0000000001",
  displayName: "testuser_156f_session",
  loginId: "testuser_156f_session",
};

function respond(permissions: string[]) {
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

describe("#156 0-6 AC-1: セッションの権限の検証", () => {
  it("#156 0-6 AC-1: perm.audit_log.view を含む応答を受け入れ、権限をそのまま返す", async () => {
    respond(["perm.client.manage", "perm.audit_log.view"]);
    const session = await fetchSession();
    expect(session.permissions).toEqual([
      "perm.client.manage",
      "perm.audit_log.view",
    ]);
  });

  it("#156 0-6 AC-1: 知らない権限 ID を含む応答は、いままでどおり拒否する", async () => {
    respond(["perm.audit_log.edit"]);
    await expect(fetchSession()).rejects.toBeDefined();
  });
});
