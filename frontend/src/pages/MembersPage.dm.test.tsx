// #136 AC-1（1-2 AC-4）: 社員一覧（S-20。pages/MembersPage.tsx）で、セッションの読み込み中（自分の ID が未定）は「DMを送る」を出さない（コードレビュー1回目の指摘）。
// App を通すとセッションが届くまで画面全体が出ないため、ページを直接描画し、セッションの応答だけを止める。API は MSW。データは架空。
// 契約：セッションが届くまでは、どの行にも「DMを送る」（名前「<表示名> さんに DMを送る」）を出さない。届いたら、他人の行にだけ出す。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { SHELL_USER } from "../test/app-shell-harness";
import { ANY_DM_BUTTON, dmButtonName, holdSession } from "../test/dm-handlers";
import { member, respondProfileWorld } from "../test/profile-handlers";
import { MembersPage } from "./MembersPage";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/members"]}>
        <MembersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function rowOf(name: string) {
  const table = await screen.findByRole("table");
  const button = await within(table).findByRole("button", { name });
  const row = button.closest("tr");
  if (row === null) throw new Error(`${name} の行がありません`);
  return row as HTMLElement;
}

describe("#136 AC-1（1-2 AC-4）S-20 のセッションの読み込み中", () => {
  it("#136 AC-1（1-2 AC-4）: セッションの読み込み中は、どの行にも「DMを送る」を出さない。届いたら他人の行にだけ出す", async () => {
    respondProfileWorld({
      members: [
        member(1),
        member(9, { id: SHELL_USER.id, displayName: SHELL_USER.displayName }),
      ],
    });
    const session = holdSession(SHELL_USER);
    renderPage();
    // 一覧は出ているが、自分が誰かはまだ分からない
    const other = await rowOf("テスト社員001");
    await rowOf(SHELL_USER.displayName);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryAllByRole("button", { name: ANY_DM_BUTTON })).toEqual(
      [],
    );
    session.release();
    await waitFor(() =>
      expect(
        within(other).getByRole("button", {
          name: dmButtonName("テスト社員001"),
        }),
      ).toBeDefined(),
    );
    const self = await rowOf(SHELL_USER.displayName);
    expect(
      within(self).queryByRole("button", { name: ANY_DM_BUTTON }),
    ).toBeNull();
  });
});
