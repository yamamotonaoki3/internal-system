// #149（149-B）計画レビュー2回目の軽微2・5-4 AC-6：プロフィールカード（S-27。ProfileCardTrigger）を、同じ人について同じ画面に複数置いても
// （TODO の一覧で、同じ人が複数の行の担当になる）、カード（popover）の ID が重ならないこと（useId で作る）。
// ID が重なると、2つ目の名前のボタンが1つ目の行のカードを開き、aria-controls も別の要素を指す。
// 契約（実装前の仮置き）：<ProfileCardTrigger userId displayName actions? /> の popovertarget・aria-controls は、カードの要素の id と同じで、
//   部品ごとに一意（利用者の ID だけから作らない）。
// jsdom には popover がないため、カードの開閉は toggle イベント（fireToggle）で再現する。API は MSW。データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fireToggle } from "../../test/app-shell-harness";
import { member, respondProfileWorld } from "../../test/profile-handlers";
import { ProfileCardTrigger } from "./index";

function renderTwice() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ul>
        <li>
          <ProfileCardTrigger
            userId={member(1).id}
            displayName="テスト社員001"
            actions={<button type="button">1行目の操作</button>}
          />
        </li>
        <li>
          <ProfileCardTrigger
            userId={member(1).id}
            displayName="テスト社員001"
            actions={<button type="button">2行目の操作</button>}
          />
        </li>
      </ul>
    </QueryClientProvider>,
  );
  return screen.getAllByRole("button", { name: "テスト社員001" });
}

describe("#149 AC-1 149-B ProfileCardTrigger の ID", () => {
  it("#149 AC-1 計画レビュー2回目（軽微2）: 同じ人の ProfileCardTrigger を2つ置くと、popovertarget は別々で、それぞれ文書の中に1つだけの要素を指す", () => {
    respondProfileWorld({ members: [member(1)] });
    const triggers = renderTwice();
    expect(triggers).toHaveLength(2);
    const targets = triggers.map((t) => t.getAttribute("popovertarget"));
    expect(targets[0]).not.toBeNull();
    expect(targets[0]).not.toBe(targets[1]);
    for (const [i, trigger] of triggers.entries()) {
      const id = targets[i] ?? "";
      expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
      expect(trigger.getAttribute("aria-controls")).toBe(id);
    }
  });

  it("#149 AC-1 計画レビュー2回目（軽微2）: 2つ目の名前のボタンのカードを開くと、2つ目の行の操作だけが出る（1つ目のカードではない）", async () => {
    respondProfileWorld({ members: [member(1)] });
    const triggers = renderTwice();
    const id = triggers[1]?.getAttribute("popovertarget") ?? "";
    const panel = document.getElementById(id);
    if (panel === null) throw new Error("カードの popover がありません");
    fireToggle(panel, "open");
    await within(panel).findByText("テスト本名001");
    expect(
      within(panel).getByRole("button", { name: "2行目の操作" }),
    ).toBeDefined();
    expect(
      within(panel).queryByRole("button", { name: "1行目の操作" }),
    ).toBeNull();
  });
});
