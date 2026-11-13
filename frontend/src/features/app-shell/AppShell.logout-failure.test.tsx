// #239 AC-4（改訂3）：ログアウトの失敗の案内（auth の LogoutFailureNotice）を、共通レイアウトのヘッダーの直下・本文の上に置く。
// アバターメニュー（popover）の中の既存の表示は残す。実ブラウザで見える位置にあることは e2e/message-drafts.spec.ts で確かめる。
// データは架空。
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  findHome,
  renderApp,
  respondShellUser,
} from "../../test/app-shell-harness";
import { server } from "../../test/server";

const FAILURE = /ログアウトできませんでした/;

describe("#239 AC-4 共通レイアウトのログアウトの失敗の案内", () => {
  it("#239 AC-4: ログアウトが失敗したら、アバターメニューの外（ヘッダーの直下・本文の上）にも失敗を出し、メニューの中の表示も残す", async () => {
    respondShellUser();
    server.use(
      http.post("/api/auth/logout", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "エラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    const { user } = renderApp("/");
    const main = await findHome();
    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("alert")
          .filter((a) => FAILURE.test(a.textContent ?? "")),
      ).toHaveLength(2),
    );
    const alerts = screen
      .getAllByRole("alert")
      .filter((a) => FAILURE.test(a.textContent ?? ""));
    const menu = document.getElementById("avatar-menu");
    if (menu === null) throw new Error("アバターメニューがありません");
    const inMenu = alerts.filter((a) => menu.contains(a));
    const outside = alerts.filter((a) => !menu.contains(a));
    expect(inMenu).toHaveLength(1);
    expect(outside).toHaveLength(1);
    const notice = outside[0];
    if (notice === undefined) throw new Error("共通の案内がありません");
    const header = screen.getByRole("banner");
    expect(
      header.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(header.contains(notice)).toBe(false);
    expect(
      notice.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(main.contains(notice)).toBe(false);
  });
});
