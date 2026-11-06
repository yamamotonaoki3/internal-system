// #123 0-3 AC-5：初回変更 S-03 は共通レイアウトなしで、変更の入力欄とログアウトだけを示す。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../../App";
import { respondLoggedIn } from "../../../test/auth-handlers";

describe("#123 0-3 AC-5 初回変更 S-03", () => {
  it("#123 0-3 AC-5: 変更フォームとログアウトのボタンを出し、業務へのリンクを出さない", async () => {
    respondLoggedIn(true);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText("現在のパスワード")).toBeDefined();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeDefined();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
