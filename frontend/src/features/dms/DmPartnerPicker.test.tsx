// #136 AC-1（1-2 AC-5）・AC-2（6-1 AC-4）・AC-3（C-168(3)）: DM の相手の選択（/dms/new の DmPartnerPicker）。API は MSW（test/profile-handlers.ts・dm-handlers.ts）。データは架空。
// 契約（実装前の仮置き。引き継ぎに明記）：
//   <DmPartnerPicker /> を features/dms/index.ts から公開する。props なし（自分はセッションから分かる）。
//   検索欄はラベル「表示名で検索」の入力欄と「検索」ボタン（members の MemberSearchField）。送信で確定し、前後の空白を除く。空なら q を送らない。
//     trim 後に101文字以上なら、画面でもエラーにして（入力欄を aria-invalid にし、「100」を含む文を出す）送らない。
//   部署の絞り込みはラベル「部署」の選択（先頭は「すべての部署」）。q と組み合わせて GET /api/users に送る。
//   候補の1件は li か tr。表示名・部署名・ステータスの文字（StatusBadge）・「DMを送る」のボタン（名前は「<表示名> さんに DMを送る」）を持つ。
//   自分は出さない。セッションの読み込み中（自分が未定）は候補を出さず、届いてから自分を除いた候補を出す。
//   4つの状態：読み込み中は role=status（「読み込み中」）、失敗は role=alert、0件は「該当する社員がいません」。「さらに表示」で続きを足す。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { SHELL_USER } from "../../test/app-shell-harness";
import {
  ANY_DM_BUTTON,
  dmButtonName,
  holdSession,
  respondDms,
} from "../../test/dm-handlers";
import {
  DEPT_DEV,
  DEPT_SALES,
  member,
  respondProfileWorld,
} from "../../test/profile-handlers";
import { server } from "../../test/server";
import { DmPartnerPicker } from "./index";

// 今の場所の表示。output は暗黙に role=status を持ち、読み込み中の role=status と重なるため、role のない span にする
function CurrentPath() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

function renderPicker() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/dms/new"]}>
        <Routes>
          <Route path="/dms/new" element={<DmPartnerPicker />} />
          <Route path="/dms/:roomId" element={<p>DMの画面</p>} />
        </Routes>
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, container: view.container };
}

async function candidateOf(name: string) {
  const label = await screen.findByText(name);
  const row = label.closest("li, tr");
  if (row === null) throw new Error(`${name} の候補の行がありません`);
  return row as HTMLElement;
}

const searchBox = () => screen.getByLabelText("表示名で検索");

async function search(user: ReturnType<typeof userEvent.setup>, text: string) {
  // 長い文字列の入力を速くするため、値は change で入れる
  fireEvent.change(searchBox(), { target: { value: text } });
  await user.click(screen.getByRole("button", { name: "検索" }));
}

const lastRequest = (urls: URL[]) => urls[urls.length - 1];

describe("#136 AC-1（1-2 AC-5）・AC-2（6-1 AC-4）候補の表示", () => {
  it("#136 AC-2（6-1 AC-4）: 候補ごとに表示名・部署・ステータス（文字）と「DMを送る」が出る", async () => {
    respondProfileWorld({
      members: [
        member(2, {
          status: {
            kind: "meeting",
            returnAt: "2099-01-02T06:30:00.000Z",
            message: null,
          },
        }),
        member(3, { department: DEPT_DEV }),
      ],
    });
    renderPicker();
    const second = within(await candidateOf("テスト社員002"));
    expect(second.getByText(DEPT_SALES.name)).toBeDefined();
    expect(second.getByText("会議中")).toBeDefined();
    expect(second.getByText(/戻り予定/)).toBeDefined();
    expect(
      second.getByRole("button", { name: dmButtonName("テスト社員002") }),
    ).toBeDefined();
    const third = within(await candidateOf("テスト社員003"));
    expect(third.getByText(DEPT_DEV.name)).toBeDefined();
    expect(third.getByText("在席")).toBeDefined();
  });

  it("#136 AC-1（1-2 AC-5）: 自分は候補に出ない", async () => {
    respondProfileWorld({
      members: [
        member(1, { id: SHELL_USER.id, displayName: SHELL_USER.displayName }),
        member(2),
      ],
    });
    renderPicker();
    await candidateOf("テスト社員002");
    expect(screen.queryByText(SHELL_USER.displayName)).toBeNull();
    expect(screen.getAllByRole("button", { name: ANY_DM_BUTTON })).toHaveLength(
      1,
    );
  });

  it("#136 AC-1（1-2 AC-5）: セッションの読み込み中（自分が未定）は候補も「DMを送る」も出さず、届いてから自分を除いた候補を出す", async () => {
    const world = respondProfileWorld({
      members: [
        member(1, { id: SHELL_USER.id, displayName: SHELL_USER.displayName }),
        member(2),
      ],
    });
    const session = holdSession(SHELL_USER);
    renderPicker();
    // 一覧は届いているが、セッションはまだ
    await waitFor(() => expect(world.listRequests.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(SHELL_USER.displayName)).toBeNull();
    expect(screen.queryByText("テスト社員002")).toBeNull();
    expect(screen.queryByRole("button", { name: ANY_DM_BUTTON })).toBeNull();
    session.release();
    await candidateOf("テスト社員002");
    expect(screen.queryByText(SHELL_USER.displayName)).toBeNull();
    expect(screen.getAllByRole("button", { name: ANY_DM_BUTTON })).toHaveLength(
      1,
    );
  });

  it("#136 AC-1（1-2 AC-4・AC-5）: 候補の「DMを送る」を押すと、その相手と DM を始めて /dms/:roomId へ移る", async () => {
    respondProfileWorld({ members: [member(2)] });
    const dms = respondDms({ names: { [member(2).id]: "テスト社員002" } });
    const { user } = renderPicker();
    const row = within(await candidateOf("テスト社員002"));
    await user.click(
      row.getByRole("button", { name: dmButtonName("テスト社員002") }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe(
        `/dms/${dms.items[0]?.roomId}`,
      ),
    );
    expect(dms.startBodies).toEqual([{ partnerUserId: member(2).id }]);
  });

  it("#136 AC-1（1-2 AC-5）: script タグを含む表示名は文字として出す", async () => {
    respondProfileWorld({
      members: [member(2, { displayName: "<script>window.__dm=1</script>" })],
    });
    const { container } = renderPicker();
    await candidateOf("<script>window.__dm=1</script>");
    expect(container.querySelector("script")).toBeNull();
  });
});

describe("#136 AC-3（C-168(3)）表示名の検索", () => {
  it("#136 AC-3（C-168(3)）: 前後の空白を除いた語を q に入れて取り直し、該当する人だけが出る", async () => {
    const world = respondProfileWorld({
      members: [member(2), member(3)],
    });
    const { user } = renderPicker();
    await candidateOf("テスト社員003");
    await search(user, "  社員002  ");
    await waitFor(() =>
      expect(lastRequest(world.listRequests)?.searchParams.get("q")).toBe(
        "社員002",
      ),
    );
    await waitFor(() => expect(screen.queryByText("テスト社員003")).toBeNull());
    expect(await candidateOf("テスト社員002")).toBeDefined();
  });

  it.each([[""], ["   "]])(
    "#136 AC-3（C-168(3)）: 空・空白だけ(%j)で検索すると q を送らない（全員に戻る）",
    async (text) => {
      const world = respondProfileWorld({ members: [member(2), member(3)] });
      const { user } = renderPicker();
      await search(user, "社員002");
      await waitFor(() =>
        expect(screen.queryByText("テスト社員003")).toBeNull(),
      );
      await search(user, text);
      await candidateOf("テスト社員003");
      expect(lastRequest(world.listRequests)?.searchParams.has("q")).toBe(
        false,
      );
    },
  );

  it("#136 AC-3（C-168(3)・V-34）: trim 後に101文字なら画面でエラーにし、その語では取りに行かない", async () => {
    const world = respondProfileWorld({ members: [member(2)] });
    const { user } = renderPicker();
    await candidateOf("テスト社員002");
    await search(user, `  ${"あ".repeat(101)}  `);
    await waitFor(() =>
      expect(searchBox().getAttribute("aria-invalid")).toBe("true"),
    );
    expect(screen.getByText(/100/)).toBeDefined();
    expect(world.listRequests.some((url) => url.searchParams.has("q"))).toBe(
      false,
    );
  });

  it("#136 AC-3（C-168(3)・V-34）: 前後に空白のある100文字は、空白を除いた100文字で検索する", async () => {
    const world = respondProfileWorld({ members: [member(2)] });
    const { user } = renderPicker();
    await candidateOf("テスト社員002");
    const hundred = "あ".repeat(100);
    await search(user, ` ${hundred} `);
    await waitFor(() =>
      expect(lastRequest(world.listRequests)?.searchParams.get("q")).toBe(
        hundred,
      ),
    );
    expect(searchBox().getAttribute("aria-invalid")).not.toBe("true");
  });

  it("#136 AC-3（C-168(3)）: 部署の絞り込みと検索を組み合わせて送る", async () => {
    const world = respondProfileWorld({
      members: [
        member(2),
        member(3, { department: DEPT_DEV, displayName: "テスト開発者003" }),
      ],
    });
    const { user } = renderPicker();
    const select = await screen.findByRole("combobox", { name: "部署" });
    await within(select).findByRole("option", { name: DEPT_DEV.name });
    await user.selectOptions(select, DEPT_DEV.id);
    await search(user, "開発者");
    await waitFor(() => {
      const url = lastRequest(world.listRequests);
      expect(url?.searchParams.get("departmentId")).toBe(DEPT_DEV.id);
      expect(url?.searchParams.get("q")).toBe("開発者");
    });
    expect(await candidateOf("テスト開発者003")).toBeDefined();
    expect(screen.queryByText("テスト社員002")).toBeNull();
  });
});

describe("#136 AC-1（1-2 AC-5）4つの状態とページング", () => {
  it("#136 AC-1（1-2 AC-5）: 読み込み中は role=status で「読み込み中」を出す", async () => {
    respondProfileWorld({ members: [member(2)] });
    server.use(http.get("/api/users", () => new Promise(() => {})));
    renderPicker();
    expect((await screen.findByRole("status")).textContent).toContain(
      "読み込み中",
    );
  });

  it("#136 AC-1（1-2 AC-5）: 取得に失敗したら role=alert を出し、0件とは出さない", async () => {
    respondProfileWorld({ members: [member(2)] });
    server.use(
      http.get("/api/users", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "一時的なエラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    renderPicker();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "一時的なエラーが発生しました",
    );
    expect(screen.queryByText("該当する社員がいません")).toBeNull();
  });

  it("#136 AC-1（1-2 AC-5）: 0件（検索で誰も当たらない）なら「該当する社員がいません」を出す", async () => {
    respondProfileWorld({ members: [member(2)] });
    const { user } = renderPicker();
    await candidateOf("テスト社員002");
    await search(user, "存在しない名前");
    expect(await screen.findByText("該当する社員がいません")).toBeDefined();
    expect(screen.queryByRole("button", { name: ANY_DM_BUTTON })).toBeNull();
  });

  it("#136 AC-1（1-2 AC-5）: nextCursor があれば「さらに表示」で続きを足し、重複しない", async () => {
    const world = respondProfileWorld({
      members: Array.from({ length: 21 }, (_v, i) => member(i + 2)),
    });
    const { user } = renderPicker();
    await candidateOf("テスト社員021");
    expect(screen.queryByText("テスト社員022")).toBeNull();
    await user.click(screen.getByRole("button", { name: "さらに表示" }));
    expect(await candidateOf("テスト社員022")).toBeDefined();
    expect(
      world.listRequests.some(
        (url) => url.searchParams.get("cursor") === "c20",
      ),
    ).toBe(true);
    expect(screen.getAllByText("テスト社員002")).toHaveLength(1);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "さらに表示" })).toBeNull(),
    );
  });
});
