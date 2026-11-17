// #156 0-6 AC-1・AC-4（S-25）: /audit-logs の直接アクセスと、管理メニューからの入口を、App を通して確かめる。表示の制御であり、認可はサーバー（API）が行う。
// 契約：権限 perm.audit_log.view を持つ人だけが画面（h1「監査ログ」）を開ける。持たない人は NotFoundPage（「ページが見つかりません」）で、検索 API を呼ばない。
// セッション確認中は誤って拒否せず「確認中です」を出す。データは架空（testuser_156f_・[E2E_TEST]）。
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SHELL_USER,
  installDomStubs,
  renderApp,
  type DomStubs,
} from "./test/app-shell-harness";
import {
  AUDIT_PERMISSION,
  auditItem,
  auditTargetName,
  respondAuditSearch,
  respondAuditSession,
} from "./test/audit-log-handlers";
import { server } from "./test/server";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
});

describe("#156 0-6 AC-1: /audit-logs の直接アクセス", () => {
  it("#156 0-6 AC-1: セッション確認中は誤って拒否せず「確認中です」を出し、権限が確定したら監査ログを表示する", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("/api/auth/session", async () => {
        await gate;
        return HttpResponse.json({
          user: SHELL_USER,
          permissions: [AUDIT_PERMISSION],
          mustChangePassword: false,
          reauthenticatedAt: null,
        });
      }),
    );
    respondAuditSearch(() => ({ items: [auditItem(1)], nextCursor: null }));
    renderApp("/audit-logs");
    expect(await screen.findByText("確認中です")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "ページが見つかりません" }),
    ).toBeNull();
    release?.();
    expect(
      await screen.findByRole("heading", { name: "監査ログ" }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("row", {
        name: new RegExp(auditTargetName(1)),
      }),
    ).toBeTruthy();
  });

  it.each([
    ["一般メンバー（権限なし）", []],
    [
      "部署のオーナー",
      ["perm.channel.request.approve.owner", "perm.workspace.manage"],
    ],
    [
      "監査ログ以外の管理権限だけ",
      ["perm.client.manage", "perm.account.create", "perm.workspace.create"],
    ],
  ])(
    "#156 0-6 AC-1: %sは、直接 URL を開いても見つからない表示になり、検索 API を呼ばない",
    async (_label, permissions) => {
      respondAuditSession(permissions);
      const calls = respondAuditSearch(() => ({ items: [], nextCursor: null }));
      renderApp("/audit-logs");
      expect(
        await screen.findByRole("heading", { name: "ページが見つかりません" }),
      ).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "監査ログ" })).toBeNull();
      expect(calls).toHaveLength(0);
    },
  );

  it("#156 0-6 AC-1: 全体管理者（perm.audit_log.view）は開ける", async () => {
    respondAuditSession([AUDIT_PERMISSION]);
    respondAuditSearch(() => ({ items: [auditItem(1)], nextCursor: null }));
    renderApp("/audit-logs");
    expect(
      await screen.findByRole("heading", { name: "監査ログ" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "ページが見つかりません" }),
    ).toBeNull();
  });
});

describe("#156 0-6 AC-1: 管理メニューからの入口", () => {
  it("#156 0-6 AC-1: 全体管理者のサイドバーには「管理＞マスタ・記録＞監査ログ」のリンクが出る", async () => {
    respondAuditSession([AUDIT_PERMISSION]);
    renderApp("/");
    expect((await screen.findAllByText("管理")).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("link", { name: "監査ログ" })[0]
          ?.getAttribute("href"),
      ).toBe("/audit-logs"),
    );
  });

  it("#156 0-6 AC-1: 権限のない人には、管理メニューにも「監査ログ」を出さない", async () => {
    respondAuditSession([]);
    renderApp("/");
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "チャンネルを探す" }),
      ).not.toBeNull(),
    );
    expect(screen.queryByRole("link", { name: "監査ログ" })).toBeNull();
  });
});
