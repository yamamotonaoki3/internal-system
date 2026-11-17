// #146（146-B）S-29・frontend-build：案件作成の承認一覧のルート。
//  - /case-approvals（S-29）は、セッションの permissions に perm.case.request.approve がある人だけに画面を出し、ない人には「ページが見つかりません」
//    （ChannelApprovals と同じ形の表示の制御。認可はサーバーが行う）
// データは架空。
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { renderApp, SHELL_USER } from "../test/app-shell-harness";
import { server } from "../test/server";

function respondSession(permissions: string[]) {
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({
        user: SHELL_USER,
        permissions,
        mustChangePassword: false,
        reauthenticatedAt: null,
      }),
    ),
    http.get("/api/case-requests", () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
  );
}

describe("#146 S-29 のルート", () => {
  it("#146 5-3 AC-3（S-29）: perm.case.request.approve のない人（メンバー）が /case-approvals を開くと「ページが見つかりません」", async () => {
    respondSession([]);
    renderApp("/case-approvals");
    expect(
      await screen.findByRole("heading", { name: "ページが見つかりません" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "案件作成の承認" }),
    ).toBeNull();
  });

  it("#146 5-3 AC-3（S-29）: チャンネル承認の権限だけでは /case-approvals を開けない（権限を取り違えない）", async () => {
    respondSession(["perm.channel.request.approve.owner"]);
    renderApp("/case-approvals");
    expect(
      await screen.findByRole("heading", { name: "ページが見つかりません" }),
    ).toBeTruthy();
  });

  it("#146 5-3 AC-3（S-29）: perm.case.request.approve のある人は /case-approvals で承認一覧を開ける", async () => {
    respondSession(["perm.case.request.approve"]);
    renderApp("/case-approvals");
    expect(
      await screen.findByRole("heading", { level: 1, name: "案件作成の承認" }),
    ).toBeTruthy();
  });
});
