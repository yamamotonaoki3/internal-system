// #136 AC-1（1-2 AC-4）・AC-3（C-168(3)）: 社員一覧（S-20）の表示名の検索と「DMを送る」、プロフィールカード（S-27）の「DMを送る」。
// MemberSearchField と useMembers(departmentId, q) は単体で、行とカードの「DMを送る」は App（/members）を通して確かめる。API は MSW。データは架空。
// 契約（実装前の仮置き。引き継ぎに明記）：
//   <MemberSearchField onSearch /> を features/members/index.ts から公開する。ラベル「表示名で検索」の入力欄と「検索」ボタンの form。
//     送信で onSearch(前後の空白を除いた語) を呼ぶ。空・空白だけなら onSearch("")。trim 後に101文字以上なら、入力欄を aria-invalid にして
//     「100」を含むエラーを出し、onSearch を呼ばない。エラーの文言は shared/search-rules.ts の searchKeywordSchema と同じ
//     （コードレビュー1回目の指摘。期待する文言は本番の定義から作らず、このテストに直接書く）。
//   「DMを送る」のアクセシブルな名前は「<表示名> さんに DMを送る」（features/dms の StartDmButton）。
//   useMembers(departmentId, q)：q が空なら GET /api/users に q を付けない。空でなければ q を付ける。部署・カーソルと組み合わせられる。
//   MembersList の renderMemberAction（行）・renderProfileActions（カード。ProfileCardTrigger の actions）に、pages/MembersPage.tsx から
//     StartDmButton を渡す。どちらも自分には出さない。S-20 にも MemberSearchField を置く。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SHELL_USER,
  fireToggle,
  installDomStubs,
  renderApp,
  type DomStubs,
} from "../../test/app-shell-harness";
import {
  ANY_DM_BUTTON,
  dmButtonName,
  dmDetail,
  dmItem,
  respondDms,
} from "../../test/dm-handlers";
import {
  DEPT_DEV,
  member,
  respondProfileWorld,
} from "../../test/profile-handlers";
import { useMembers } from "./hooks/useMembers";
import { MemberSearchField } from "./index";

describe("#136 AC-3（C-168(3)）MemberSearchField", () => {
  function renderField() {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<MemberSearchField onSearch={onSearch} />);
    const box = screen.getByLabelText("表示名で検索");
    const submit = async (text: string) => {
      fireEvent.change(box, { target: { value: text } });
      await user.click(screen.getByRole("button", { name: "検索" }));
    };
    return { onSearch, box, submit };
  }

  it("#136 AC-3（C-168(3)）: 送信すると、前後の空白を除いた語で onSearch を呼ぶ（入力のたびには呼ばない）", async () => {
    const { onSearch, box, submit } = renderField();
    fireEvent.change(box, { target: { value: "途中" } });
    expect(onSearch).not.toHaveBeenCalled();
    await submit("  テスト社員  ");
    expect(onSearch).toHaveBeenLastCalledWith("テスト社員");
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("#136 AC-3（C-168(3)）: Enter でも送信できる", async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<MemberSearchField onSearch={onSearch} />);
    await user.type(screen.getByLabelText("表示名で検索"), "社員{Enter}");
    expect(onSearch).toHaveBeenLastCalledWith("社員");
  });

  it.each([[""], ["   "], ["　"]])(
    '#136 AC-3（C-168(3)）: 空・空白だけ(%j)は onSearch("") を呼ぶ（絞り込みを外す）。エラーにしない',
    async (text) => {
      const { onSearch, box, submit } = renderField();
      await submit(text);
      expect(onSearch).toHaveBeenLastCalledWith("");
      expect(box.getAttribute("aria-invalid")).not.toBe("true");
    },
  );

  it("#136 AC-3（C-168(3)・V-34）: trim 後に100文字ちょうどは、そのまま onSearch を呼ぶ", async () => {
    const { onSearch, box, submit } = renderField();
    const hundred = "a".repeat(100);
    await submit(`  ${hundred}  `);
    expect(onSearch).toHaveBeenLastCalledWith(hundred);
    expect(box.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("#136 AC-3（C-168(3)・V-34）: trim 後に101文字ならエラーを出し、onSearch を呼ばない", async () => {
    const { onSearch, box, submit } = renderField();
    await submit(`  ${"a".repeat(101)}  `);
    await waitFor(() => expect(box.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText(/100/)).toBeDefined();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("#136 AC-3（C-168(3)・V-34）: 101文字のときのエラーの文言は、サーバー側の検索語の規則（searchKeywordSchema）と同じ", async () => {
    const { box, submit } = renderField();
    await submit("a".repeat(101));
    await waitFor(() => expect(box.getAttribute("aria-invalid")).toBe("true"));
    expect(
      screen.getByText("検索する言葉は100文字以内で入力してください"),
    ).toBeDefined();
  });

  it("#136 AC-3（C-168(3)）: エラーのあと正しい語で送り直すと、エラーが消えて onSearch を呼ぶ", async () => {
    const { onSearch, box, submit } = renderField();
    await submit("a".repeat(101));
    await waitFor(() => expect(box.getAttribute("aria-invalid")).toBe("true"));
    await submit("社員");
    await waitFor(() =>
      expect(box.getAttribute("aria-invalid")).not.toBe("true"),
    );
    expect(onSearch).toHaveBeenLastCalledWith("社員");
  });
});

describe("#136 AC-3（C-168(3)）useMembers(departmentId, q)", () => {
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  it("#136 AC-3（C-168(3)）: q が空なら q を付けずに取る", async () => {
    const world = respondProfileWorld({ members: [member(1)] });
    const { result } = renderHook(() => useMembers("", ""), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(world.listRequests[0]?.searchParams.has("q")).toBe(false);
  });

  it("#136 AC-3（C-168(3)）: q と部署を組み合わせて取り、該当する人だけを返す", async () => {
    const world = respondProfileWorld({
      members: [
        member(1),
        member(2, { department: DEPT_DEV, displayName: "テスト開発者002" }),
        member(3, { department: DEPT_DEV }),
      ],
    });
    const { result } = renderHook(() => useMembers(DEPT_DEV.id, "開発者"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = world.listRequests[0];
    expect(url?.searchParams.get("q")).toBe("開発者");
    expect(url?.searchParams.get("departmentId")).toBe(DEPT_DEV.id);
    expect(
      result.current.data?.pages.flatMap((p) => p.items).map((m) => m.id),
    ).toEqual([member(2).id]);
  });

  it("#136 AC-3（C-168(3)）: q を変えると別の一覧として取り直す（前の語の結果を使い回さない）", async () => {
    const world = respondProfileWorld({ members: [member(1), member(2)] });
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useMembers("", q),
      { wrapper, initialProps: { q: "社員001" } },
    );
    // isSuccess ではなく data そのものを最初から待つ（既定の追跡で data の変化も再描画される）
    const ids = () =>
      result.current.data?.pages.flatMap((p) => p.items).map((m) => m.id);
    await waitFor(() => expect(ids()).toEqual([member(1).id]));
    rerender({ q: "社員002" });
    await waitFor(() =>
      expect(world.listRequests.map((u) => u.searchParams.get("q"))).toContain(
        "社員002",
      ),
    );
    await waitFor(() => expect(ids()).toEqual([member(2).id]));
  });
});

describe("#136 AC-1（1-2 AC-4）・AC-3（C-168(3)）S-20・S-27 からの DM の開始", () => {
  let stubs: DomStubs;
  beforeEach(() => {
    stubs = installDomStubs();
  });
  afterEach(() => {
    stubs.restore();
  });

  async function rowOf(name: string) {
    await screen.findByRole("heading", { level: 1, name: "社員一覧" });
    const main = screen.getByRole("main");
    const table = await within(main).findByRole("table");
    const button = await within(table).findByRole("button", { name });
    const row = button.closest("tr");
    if (row === null) throw new Error(`${name} の行がありません`);
    return row as HTMLElement;
  }

  function openCard(row: HTMLElement, name: string) {
    const trigger = within(row).getByRole("button", { name });
    const panelId = trigger.getAttribute("popovertarget");
    const panel = panelId === null ? null : document.getElementById(panelId);
    if (panel === null) throw new Error("カードの popover がありません");
    fireToggle(panel, "open");
    return panel;
  }

  const selfMember = () =>
    member(9, { id: SHELL_USER.id, displayName: SHELL_USER.displayName });

  it("#136 AC-1（1-2 AC-4）: 他人の行には「DMを送る」が出て、自分の行には出ない", async () => {
    respondProfileWorld({ members: [member(1), selfMember()] });
    renderApp("/members");
    const other = await rowOf("テスト社員001");
    expect(
      within(other).getByRole("button", {
        name: dmButtonName("テスト社員001"),
      }),
    ).toBeDefined();
    const self = await rowOf(SHELL_USER.displayName);
    expect(
      within(self).queryByRole("button", { name: ANY_DM_BUTTON }),
    ).toBeNull();
  });

  it("#136 AC-1（1-2 AC-4）: 行の「DMを送る」を押すと、その相手と DM を始めて /dms/:roomId へ移る", async () => {
    respondProfileWorld({ members: [member(1)] });
    const dms = respondDms({
      items: [
        dmItem(1, {
          partner: {
            id: member(1).id,
            displayName: "テスト社員001",
            isActive: true,
            status: null,
          },
        }),
      ],
      // 移った先の DM の画面（S-06）が取る詳細も返す（想定外の要求を残さない）
      details: [
        dmDetail(1, {
          partner: { id: member(1).id, displayName: "テスト社員001" },
        }),
      ],
    });
    const { user } = renderApp("/members");
    const row = await rowOf("テスト社員001");
    await user.click(
      within(row).getByRole("button", { name: dmButtonName("テスト社員001") }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe(
        `/dms/${dmItem(1).roomId}`,
      ),
    );
    expect(dms.startBodies).toEqual([{ partnerUserId: member(1).id }]);
    // DM の画面の取得が終わってからテストを終える（次のテストに要求が持ち越されないように）
    await waitFor(() => expect(dms.detailRequests).toContain(dmItem(1).roomId));
  });

  it("#136 AC-1（1-2 AC-4）: 他人のプロフィールカード（S-27）には「DMを送る」が出て、自分のカードには出ない", async () => {
    respondProfileWorld({ members: [member(1), selfMember()] });
    renderApp("/members");
    const otherPanel = openCard(await rowOf("テスト社員001"), "テスト社員001");
    await within(otherPanel).findByText("テスト本名001");
    expect(
      within(otherPanel).getByRole("button", {
        name: dmButtonName("テスト社員001"),
      }),
    ).toBeDefined();
    const selfPanel = openCard(
      await rowOf(SHELL_USER.displayName),
      SHELL_USER.displayName,
    );
    await within(selfPanel).findByRole("button", { name: "閉じる" });
    await waitFor(() =>
      expect(within(selfPanel).queryByRole("status")).toBeNull(),
    );
    expect(
      within(selfPanel).queryByRole("button", { name: ANY_DM_BUTTON }),
    ).toBeNull();
  });

  it("#136 AC-1（1-2 AC-4）: カードの「DMを送る」を押すと、その相手と DM を始めて /dms/:roomId へ移る", async () => {
    respondProfileWorld({ members: [member(1)] });
    const dms = respondDms({ names: { [member(1).id]: "テスト社員001" } });
    const { user } = renderApp("/members");
    const panel = openCard(await rowOf("テスト社員001"), "テスト社員001");
    await within(panel).findByText("テスト本名001");
    await user.click(
      within(panel).getByRole("button", {
        name: dmButtonName("テスト社員001"),
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe(
        `/dms/${dms.items[0]?.roomId}`,
      ),
    );
    expect(dms.startBodies).toEqual([{ partnerUserId: member(1).id }]);
    // DM の画面の取得が終わってからテストを終える（次のテストに要求が持ち越されないように）
    await waitFor(() =>
      expect(dms.detailRequests).toContain(dms.items[0]?.roomId),
    );
  });

  it("#136 AC-3（C-168(3)）: S-20 で表示名を検索すると q で取り直し、該当する人だけが出る", async () => {
    const world = respondProfileWorld({ members: [member(1), member(2)] });
    const { user } = renderApp("/members");
    await rowOf("テスト社員002");
    fireEvent.change(screen.getByLabelText("表示名で検索"), {
      target: { value: " 社員001 " },
    });
    await user.click(screen.getByRole("button", { name: "検索" }));
    await waitFor(() =>
      expect(
        world.listRequests.some((u) => u.searchParams.get("q") === "社員001"),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("main")).queryByRole("button", {
          name: "テスト社員002",
        }),
      ).toBeNull(),
    );
    expect(await rowOf("テスト社員001")).toBeDefined();
  });
});
