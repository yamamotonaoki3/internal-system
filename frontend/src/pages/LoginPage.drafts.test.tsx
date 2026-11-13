// #239 AC-4：ログアウトで端末の下書きを消せなかったときの、ログイン画面（S-02）の案内。
// 契約（実装前の仮置き）：pages/LoginPage.tsx が features/auth の DraftCleanupNotice を置く（画面は部品を置くだけ。C-06）。
//   location.state.draftCleanupFailed が true のときだけ、
//   「この端末の下書きを消せませんでした。共用の端末では、ブラウザのサイトデータを削除してください。」を出す（role="alert" にしない）。
// データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { respondLoggedOut, respondPublicStatus } from "../test/auth-handlers";

const CLEANUP_NOTICE =
  "この端末の下書きを消せませんでした。共用の端末では、ブラウザのサイトデータを削除してください。";

function renderLogin(state: unknown) {
  respondLoggedOut();
  respondPublicStatus();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: "/login", state }]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("#239 AC-4 S-02 の下書きの消去の失敗の案内", () => {
  it("#239 AC-4: ログアウトから draftCleanupFailed: true で来たときは、ログイン画面に案内を出す（alert にしない）", async () => {
    renderLogin({ draftCleanupFailed: true });
    await screen.findByRole("button", { name: "ログイン" });
    const notice = screen.getByText(CLEANUP_NOTICE);
    expect(notice.closest('[role="alert"]')).toBeNull();
  });

  it("#239 AC-4: state を付けない普通の /login では案内を出さない", async () => {
    renderLogin(null);
    await screen.findByRole("button", { name: "ログイン" });
    expect(screen.queryByText(CLEANUP_NOTICE)).toBeNull();
  });
});
