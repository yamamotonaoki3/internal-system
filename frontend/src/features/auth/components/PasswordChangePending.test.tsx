// #120 AC-1（0-3 AC-5 の印。本体の S-03 は #123）：PasswordChangePending。準備中の案内とログアウトのボタンだけを出す。
// 公開形の仮定：<PasswordChangePending />（props なし）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { PasswordChangePending } from "./PasswordChangePending";

describe("#120 AC-1 PasswordChangePending", () => {
  it("#120 AC-1: 「パスワードの変更が必要です。変更画面は準備中です」とログアウトのボタンを出す", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <PasswordChangePending />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      screen.getByText("パスワードの変更が必要です。変更画面は準備中です"),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeDefined();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
