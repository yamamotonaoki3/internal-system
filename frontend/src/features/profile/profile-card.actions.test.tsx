// #136 AC-1（1-2 AC-4）: プロフィールカード（S-27。ProfileCardTrigger）に足す任意の actions。社員一覧から「DMを送る」を差し込むのに使う。API は MSW。データは架空。
// 契約（実装前の仮置き。引き継ぎに明記）：
//   <ProfileCardTrigger userId displayName actions? /> の actions（ReactNode）は、カード（popover）の中に出す。渡さなければ今のまま（閉じるボタンだけ）。
// jsdom には popover がないため、カードの開閉は toggle イベント（fireToggle）で再現する。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { fireToggle } from "../../test/app-shell-harness";
import { member, respondProfileWorld } from "../../test/profile-handlers";
import { ProfileCardTrigger } from "./index";

function renderTrigger(actions?: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProfileCardTrigger
        userId={member(1).id}
        displayName="テスト社員001"
        actions={actions}
      />
    </QueryClientProvider>,
  );
  const trigger = screen.getByRole("button", { name: "テスト社員001" });
  const panelId = trigger.getAttribute("popovertarget");
  const panel = panelId === null ? null : document.getElementById(panelId);
  if (panel === null) throw new Error("カードの popover がありません");
  return panel;
}

describe("#136 AC-1（1-2 AC-4）ProfileCardTrigger の actions", () => {
  it("#136 AC-1（1-2 AC-4）: actions を渡すと、カードの中に出る", async () => {
    respondProfileWorld({ members: [member(1)] });
    const panel = renderTrigger(<button type="button">テストの操作</button>);
    fireToggle(panel, "open");
    await within(panel).findByText("テスト本名001");
    expect(
      within(panel).getByRole("button", { name: "テストの操作" }),
    ).toBeDefined();
    expect(within(panel).getByRole("button", { name: "閉じる" })).toBeDefined();
  });

  it("#136 AC-1（1-2 AC-4）: actions を渡さなければ、カードの操作は「閉じる」だけのまま", async () => {
    respondProfileWorld({ members: [member(1)] });
    const panel = renderTrigger();
    fireToggle(panel, "open");
    await within(panel).findByText("テスト本名001");
    expect(
      within(panel)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["閉じる"]);
  });
});
