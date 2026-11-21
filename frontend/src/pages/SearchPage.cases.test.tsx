// #155（155-C）S-15 検索結果の「案件」の区画（4-2 AC-1〜AC-3）。計画 7章 F-1・F-2・F-4・F-5（R1-6）・console.error。
// 期待は、screens.md の S-15（メッセージと案件の検索結果）・S-17（押すと案件の画面。非参加者には既存の非公開の案内）、計画 5章の画面
//   （区画は「案件」。4つの状態。行に件名〔語を強調。文字として描く〕・案件番号・状態・取引先・担当部署・納期。押すと /cases/:id。「さらに表示」。
//   取得は useMessageSearch と同じ決まり：毎回1ページ目から pageCount ページ・失敗したら取得済みも出さない・前の結果を仮に出さない）、
//   R1-6（区画の後始末はその区画のキーだけ。片方の再マウント・取得・失敗と再試行で、もう片方が止まらない・消えない）から決める。
//
// 契約（実装前の仮置き。画面の文言と構造。実装の担当へ）：
//   pages/SearchPage.tsx の main に、メッセージの結果とは別に、案件の区画（features/search/components/CaseSearchResults.tsx）を置く。
//     区画は <section> で、見出し h2「案件」に結び付けた名前つきの region（role=region・名前「案件」）。検索の条件のうち q だけで取得する
//     （部屋・期間を変えても、案件の区画は作り直さない）。q がなければ API を呼ばない。
//   状態：読み込み中（role=status「案件を読み込み中です」）／0件（「一致する案件はありません」）／
//     失敗（role=alert「案件を検索できませんでした」とボタン「再試行」。前の結果を出さない）／
//     結果（<ul aria-label="案件の検索結果の一覧"> の直下の <li>。行ごとに /cases/<id> へのリンク1つ〔名前に件名を含む。件名の中の一致は <mark>〕、
//       案件番号・状態〔進行中／終了〕・取引先の名前・担当部署の名前・納期）。続きがあれば区画の中に「さらに表示」。
//   文言は、メッセージの区画（「読み込み中です」「一致するメッセージはありません」「検索できませんでした」・一覧の名前「検索結果の一覧」）と重ならない。
//   API：GET /api/search/cases?q=&cursor=（features/search/api/search-api.ts の searchCases。応答は zod で検証し、合わなければ失敗の表示）。
// データはすべて架空（[E2E_TEST]・testuser_）。
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  installDomStubs,
  renderApp,
  respondShellUser,
  SHELL_USER,
  type DomStubs,
} from "../test/app-shell-harness";
import {
  caseSearchItem,
  deferred,
  respondCaseSearch,
  respondCaseSearchPages,
  respondSearch,
  respondSearchPages,
  searchItem,
} from "../test/search-handlers";
import { server } from "../test/server";

let stubs: DomStubs;
let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  stubs = installDomStubs();
  respondShellUser();
  // メッセージの区画の既定（0件）。各試験で上書きする
  respondSearch([]);
  consoleError = vi.spyOn(console, "error");
});
afterEach(() => {
  // 描画を片付けてから（失敗しても次の試験に画面を残さない）、各試験の間に console.error（React の警告・未処理の通信を含む）が出ていないこと
  cleanup();
  const messages = consoleError.mock.calls.map((args) =>
    args.map(String).join(" "),
  );
  consoleError.mockRestore();
  stubs.restore();
  expect(messages).toEqual([]);
});

/** 検索の画面の main（セッションの確認中の別の main と取り違えないよう、見出しが出てから取る） */
async function pageMain(): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", {
    level: 1,
    name: "検索結果",
  });
  const found = heading.closest("main");
  if (found === null)
    throw new Error("検索結果の見出しが main の中にありません");
  return found;
}

const caseRegion = (main: HTMLElement) =>
  within(main).getByRole("region", { name: "案件" });
const caseList = (main: HTMLElement) =>
  within(caseRegion(main)).queryByRole("list", {
    name: "案件の検索結果の一覧",
  });
/** 案件の行（一覧の直下の li だけ） */
const caseRows = (main: HTMLElement) =>
  Array.from(caseList(main)?.querySelectorAll(":scope > li") ?? []);
const messageList = (main: HTMLElement) =>
  within(main).queryByRole("list", { name: "検索結果の一覧" });
const messageRows = (main: HTMLElement) =>
  Array.from(messageList(main)?.querySelectorAll(":scope > li") ?? []);
const textOf = (element: Element | null) => element?.textContent ?? "";
const path = () => screen.getByTestId("path").textContent;

describe("#155 4-2 AC-1 F-1 案件の区画の表示", () => {
  it("#155 4-2 AC-1 F-1: 区画「案件」に、件名・案件番号・状態・取引先・担当部署・納期の行が出て、件名の中の語は <mark> で強調される", async () => {
    respondSearch([searchItem(1)]);
    respondCaseSearch([
      caseSearchItem(1, {
        title: "[E2E_TEST]若草会館の改修",
        caseNumber: "QSC-261121-0001",
        status: "active",
        client: {
          id: "01JTESTCLNT155C00000000002",
          name: "[E2E_TEST]若草商事",
          isActive: true,
        },
        departments: [
          {
            id: "01JTESTDEPT155C00000000002",
            name: "[E2E_TEST]営業部155C",
            isActive: true,
          },
          {
            id: "01JTESTDEPT155C00000000003",
            name: "[E2E_TEST]開発部155C",
            isActive: true,
          },
        ],
        dueDate: "2026-12-24",
      }),
      caseSearchItem(2, {
        title: "[E2E_TEST]若草会館の終了分",
        status: "closed",
      }),
    ]);
    renderApp("/search?q=若草");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(2));
    const [first, second] = caseRows(main);
    expect(textOf(first ?? null)).toContain("[E2E_TEST]若草会館の改修");
    expect(textOf(first ?? null)).toContain("QSC-261121-0001");
    expect(textOf(first ?? null)).toContain("進行中");
    expect(textOf(first ?? null)).toContain("[E2E_TEST]若草商事");
    expect(textOf(first ?? null)).toContain("[E2E_TEST]営業部155C");
    expect(textOf(first ?? null)).toContain("[E2E_TEST]開発部155C");
    expect(textOf(first ?? null)).toContain("2026-12-24");
    expect(textOf(second ?? null)).toContain("終了");
    const marks = Array.from(first?.querySelectorAll("mark") ?? []).map(
      (m) => m.textContent,
    );
    expect(marks).toContain("若草");
    // メッセージの区画も出ている（別の区画）
    await waitFor(() => expect(messageRows(main)).toHaveLength(1));
  });

  it("#155 4-2 AC-1 F-1: 行は /cases/<id> へのリンク1つで、押すと案件の画面へ移る", async () => {
    respondCaseSearch([caseSearchItem(7, { title: "[E2E_TEST]移動先の案件" })]);
    // 移った先の案件の画面（S-17）の取得は、この試験の対象外（存在しない案件として応える）
    server.use(
      http.get("/api/cases/:caseId", () =>
        HttpResponse.json(
          { code: "NOT_FOUND", message: "案件が見つかりません" },
          { status: 404 },
        ),
      ),
    );
    const { user } = renderApp("/search?q=移動先");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    const [row] = caseRows(main);
    const links = within(row as HTMLElement).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(
      `/cases/${caseSearchItem(7).id}`,
    );
    expect(textOf(links[0] ?? null)).toContain("[E2E_TEST]移動先の案件");
    await user.click(links[0] as HTMLElement);
    await waitFor(() => expect(path()).toBe(`/cases/${caseSearchItem(7).id}`));
  });

  it("#155 4-2 AC-1 F-1: HTML を含む件名は、要素として解釈せず文字として出す", async () => {
    const title = '<img src="x" alt="[E2E_TEST]注入"><b>[E2E_TEST]太字</b>';
    respondCaseSearch([caseSearchItem(3, { title })]);
    renderApp("/search?q=E2E");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    const region = caseRegion(main);
    expect(region.querySelector("img")).toBeNull();
    expect(region.querySelector("b")).toBeNull();
    expect(textOf(region)).toContain(title);
  });

  it("#155 4-2 AC-1 F-1: q を送ると、案件の API にも前後の空白を除いた同じ語を送る。cursor は最初は無い", async () => {
    const world = respondCaseSearch([caseSearchItem(1)]);
    renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    expect(world.requests[0]).toMatchObject({ q: "見積書", cursor: null });
  });

  it("#155 4-2 AC-1 F-2: q がなければ、案件の API を呼ばない", async () => {
    const world = respondCaseSearch([caseSearchItem(1)]);
    renderApp("/search");
    await pageMain();
    expect(world.requests).toEqual([]);
  });
});

describe("#155 4-2 AC-1 F-2 案件の区画の状態", () => {
  it("#155 F-2: 読み込み中は区画の中に role=status「案件を読み込み中です」。届いたら消える", async () => {
    const world = respondCaseSearch([caseSearchItem(1)]);
    const gate = deferred();
    world.hold = gate.promise;
    renderApp("/search?q=見積書");
    const main = await pageMain();
    const loading = await within(caseRegion(main)).findByText(
      "案件を読み込み中です",
    );
    expect(loading.closest("[role='status']")).not.toBeNull();
    gate.release();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    expect(
      within(caseRegion(main)).queryByText("案件を読み込み中です"),
    ).toBeNull();
  });

  it("#155 F-2: 0件は「一致する案件はありません」。否定の確認の前に、同じ画面でメッセージの結果が出ていることを確かめる", async () => {
    respondSearch([searchItem(1)]);
    respondCaseSearch([]);
    renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(messageRows(main)).toHaveLength(1));
    expect(
      await within(caseRegion(main)).findByText("一致する案件はありません"),
    ).toBeDefined();
    expect(caseList(main)).toBeNull();
    expect(
      within(caseRegion(main)).queryByRole("button", { name: "さらに表示" }),
    ).toBeNull();
  });

  it("#155 F-2: 続きがあれば区画の中の「さらに表示」で次のページを足す（重複・欠落なく順に）。続きがなくなれば出さない", async () => {
    const world = respondCaseSearchPages([
      { items: [caseSearchItem(1), caseSearchItem(2)], nextCursor: "C1" },
      { items: [caseSearchItem(3)], nextCursor: null },
    ]);
    const { user } = renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(2));
    await user.click(
      within(caseRegion(main)).getByRole("button", { name: "さらに表示" }),
    );
    await waitFor(() => expect(caseRows(main)).toHaveLength(3));
    expect(
      caseRows(main).map((row) => row.querySelector("a")?.getAttribute("href")),
    ).toEqual([1, 2, 3].map((n) => `/cases/${caseSearchItem(n).id}`));
    expect(world.requests.at(-1)?.cursor).toBe("C1");
    expect(
      within(caseRegion(main)).queryByRole("button", { name: "さらに表示" }),
    ).toBeNull();
  });
});

describe("#155 4-2 AC-1 F-4 案件の区画の失敗", () => {
  const malformed = [
    { name: "matchedIn が空", item: { ...caseSearchItem(1), matchedIn: [] } },
    {
      name: "matchedIn に未知の値",
      item: { ...caseSearchItem(1), matchedIn: ["description"] },
    },
    {
      name: "departments の形が違う（名前が無い）",
      item: {
        ...caseSearchItem(1),
        departments: [{ id: "x", isActive: true }],
      },
    },
    {
      name: "status が未知の値",
      item: { ...caseSearchItem(1), status: "archived" },
    },
    {
      name: "progress の形が違う（total が無い）",
      item: { ...caseSearchItem(1), progress: { done: 1 } },
    },
  ];

  it.each(malformed)(
    "#155 F-4: 応答の形が合わない（$name）とき、区画は失敗の表示で、取得済みの行も出さない。メッセージの区画は表示が続く",
    async ({ item }) => {
      respondSearch([searchItem(1)]);
      const world = respondCaseSearch([]);
      world.pages.set(null, { items: [item], nextCursor: null });
      renderApp("/search?q=見積書");
      const main = await pageMain();
      const alert = await within(caseRegion(main)).findByRole("alert");
      expect(alert.textContent).toContain("案件を検索できませんでした");
      expect(caseList(main)).toBeNull();
      await waitFor(() => expect(messageRows(main)).toHaveLength(1));
      // 形が合わない応答の中身（件名）を、画面のどこにも出さない
      expect(document.body.textContent).not.toContain(caseSearchItem(1).title);
    },
  );

  it("#155 F-4: null の progress・dueDate は正しい形として受け入れる（失敗にしない）", async () => {
    respondCaseSearch([caseSearchItem(1, { progress: null, dueDate: null })]);
    renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    expect(within(caseRegion(main)).queryByRole("alert")).toBeNull();
  });

  it("#155 F-4: 「さらに表示」が 500 で失敗したら、取得済みの行も出さずに失敗の表示。再試行で1ページ目から取り直す。メッセージの区画は続く", async () => {
    respondSearch([searchItem(1)]);
    const world = respondCaseSearchPages([
      { items: [caseSearchItem(1)], nextCursor: "C1" },
      { items: [caseSearchItem(2)], nextCursor: null },
    ]);
    const { user } = renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    world.fail = { status: 500, times: 1 };
    await user.click(
      within(caseRegion(main)).getByRole("button", { name: "さらに表示" }),
    );
    expect(await within(caseRegion(main)).findByRole("alert")).toBeDefined();
    expect(document.body.textContent).not.toContain(caseSearchItem(1).title);
    expect(messageRows(main)).toHaveLength(1);
    const before = world.requests.length;
    await user.click(
      within(caseRegion(main)).getByRole("button", { name: "再試行" }),
    );
    await waitFor(() => expect(caseRows(main)).toHaveLength(2));
    expect(world.requests[before]?.cursor).toBeNull();
  });

  it("#155 F-4（逆の方向）: メッセージの区画だけが失敗しても、案件の区画は表示が続く", async () => {
    const messages = respondSearch([searchItem(1)]);
    messages.fail = { status: 500, times: 10 };
    respondCaseSearch([caseSearchItem(1)]);
    renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    const alerts = await within(main).findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toContain("検索できませんでした");
    expect(within(caseRegion(main)).queryByRole("alert")).toBeNull();
    expect(caseRows(main)).toHaveLength(1);
  });
});

describe("#155 4-2 AC-1 F-5 区画の状態の独立（計画 R1-6）", () => {
  it("#155 F-5: 案件の取得の最中に期間を変えて（メッセージの区画が作り直されても）、案件の取得は止まらず、保留を解くと1回の要求のまま行が出る", async () => {
    const messages = respondSearch([searchItem(1)]);
    const cases = respondCaseSearch([caseSearchItem(1)]);
    const gate = deferred();
    cases.hold = gate.promise;
    const { user } = renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(messageRows(main)).toHaveLength(1));
    await waitFor(() => expect(cases.requests).toHaveLength(1));
    const messageBefore = messages.requests.length;
    fireEvent.change(within(main).getByLabelText("開始日"), {
      target: { value: "2026-11-01" },
    });
    await user.click(within(main).getByRole("button", { name: "検索" }));
    await waitFor(() =>
      expect(messages.requests.length).toBeGreaterThan(messageBefore),
    );
    expect(messages.requests.at(-1)?.from).toBe("2026-11-01");
    const afterChange = await pageMain();
    gate.release();
    await waitFor(() => expect(caseRows(afterChange)).toHaveLength(1));
    expect(cases.requests).toHaveLength(1);
  });

  it("#155 F-5: 案件の行が出た後に期間を変えても、案件の行は消えず、読み込み中にも戻らない", async () => {
    const messages = respondSearch([searchItem(1)]);
    respondCaseSearch([caseSearchItem(1)]);
    const { user } = renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    const gate = deferred();
    messages.hold = gate.promise;
    fireEvent.change(within(main).getByLabelText("開始日"), {
      target: { value: "2026-11-01" },
    });
    await user.click(within(main).getByRole("button", { name: "検索" }));
    const afterChange = await pageMain();
    // メッセージの区画は読み込み中（作り直し）。その間も案件の行は出ている
    expect(
      await within(afterChange).findByText("読み込み中です"),
    ).toBeDefined();
    expect(caseRows(afterChange)).toHaveLength(1);
    expect(
      within(caseRegion(afterChange)).queryByText("案件を読み込み中です"),
    ).toBeNull();
    gate.release();
    await waitFor(() => expect(messageRows(afterChange)).toHaveLength(1));
    expect(caseRows(afterChange)).toHaveLength(1);
  });

  it("#155 F-5: メッセージの区画の失敗と再試行の間も、保留中の案件の取得は止まらない（要求は1回のまま、保留を解くと行が出る）", async () => {
    const messages = respondSearch([searchItem(1)]);
    messages.fail = { status: 500, times: 1 };
    const cases = respondCaseSearch([caseSearchItem(1)]);
    const gate = deferred();
    cases.hold = gate.promise;
    const { user } = renderApp("/search?q=見積書");
    const main = await pageMain();
    await within(main).findByRole("alert");
    await user.click(within(main).getByRole("button", { name: "再試行" }));
    await waitFor(() => expect(messageRows(main)).toHaveLength(1));
    gate.release();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    expect(cases.requests).toHaveLength(1);
  });

  it("#155 F-5（逆の方向）: 案件の区画の失敗と再試行の間も、保留中のメッセージの取得は止まらない（要求は1回のまま、保留を解くと行が出る）", async () => {
    const messages = respondSearch([searchItem(1)]);
    const gate = deferred();
    messages.hold = gate.promise;
    const cases = respondCaseSearch([caseSearchItem(1)]);
    cases.fail = { status: 500, times: 1 };
    const { user } = renderApp("/search?q=見積書");
    const main = await pageMain();
    await within(caseRegion(main)).findByRole("alert");
    await waitFor(() => expect(messages.requests).toHaveLength(1));
    await user.click(
      within(caseRegion(main)).getByRole("button", { name: "再試行" }),
    );
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    gate.release();
    await waitFor(() => expect(messageRows(main)).toHaveLength(1));
    expect(messages.requests).toHaveLength(1);
  });

  it("#155 F-5: メッセージの「さらに表示」で、案件の区画は取り直さず、行も消えない", async () => {
    const messages = respondSearchPages([
      { items: [searchItem(1)], nextCursor: "M1" },
      { items: [searchItem(2)], nextCursor: null },
    ]);
    const cases = respondCaseSearch([caseSearchItem(1)]);
    const { user } = renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    await waitFor(() => expect(messageRows(main)).toHaveLength(1));
    const caseBefore = cases.requests.length;
    const moreButtons = within(main)
      .getAllByRole("button", { name: "さらに表示" })
      .filter((button) => !caseRegion(main).contains(button));
    expect(moreButtons).toHaveLength(1);
    await user.click(moreButtons[0] as HTMLElement);
    await waitFor(() => expect(messageRows(main)).toHaveLength(2));
    expect(cases.requests.length).toBe(caseBefore);
    expect(caseRows(main)).toHaveLength(1);
    void messages;
  });

  it("#155 F-5: 語を変えると、案件の区画も新しい語で取り直し、前の語の行は出さない", async () => {
    const cases = respondCaseSearch([
      caseSearchItem(1, { title: "[E2E_TEST]前の語の案件" }),
    ]);
    const { user } = renderApp("/search?q=前の語");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    cases.pages.set(null, {
      items: [caseSearchItem(2, { title: "[E2E_TEST]後の語の案件" })],
      nextCursor: null,
    });
    const gate = deferred();
    cases.hold = gate.promise;
    const input = within(main).getByRole("searchbox", { name: "検索する言葉" });
    await user.clear(input);
    await user.type(input, "後の語");
    await user.click(within(main).getByRole("button", { name: "検索" }));
    const afterChange = await pageMain();
    expect(
      await within(caseRegion(afterChange)).findByText("案件を読み込み中です"),
    ).toBeDefined();
    expect(document.body.textContent).not.toContain("[E2E_TEST]前の語の案件");
    gate.release();
    await waitFor(() =>
      expect(textOf(caseList(afterChange))).toContain("[E2E_TEST]後の語の案件"),
    );
    expect(cases.requests.at(-1)?.q).toBe("後の語");
  });

  it('#155 F-5: 記号（[ ] { } " * %）を含む語も、案件の API にそのまま送る', async () => {
    const cases = respondCaseSearch([]);
    const { user } = renderApp("/search?q=a");
    const main = await pageMain();
    await waitFor(() => expect(cases.requests).toHaveLength(1));
    const input = within(main).getByRole("searchbox", { name: "検索する言葉" });
    await user.clear(input);
    // user-event の type は [ と { をキーの指定として読むため、重ねて書く
    await user.type(input, '[[x]{{y} "a*b" 100%');
    await user.click(within(main).getByRole("button", { name: "検索" }));
    await waitFor(() =>
      expect(cases.requests.at(-1)?.q).toBe('[x]{y} "a*b" 100%'),
    );
  });
});

// ---- 4-2 AC-2・C-84・5-4 AC-4：結果の概要の進捗（S-16 の一覧の行と同じ見せ方。features/cases の CaseTodoProgress を使い回す前提） ----
// 「完了数/全体数」の数字と進捗バー（role=progressbar・名前「{全体}項目中{完了}項目が完了」）。パーセントは出さない。0件（null）は「項目なし」でバーを出さない。

describe("#155 4-2 AC-2 F-1 案件の結果の行の進捗", () => {
  it("#155 4-2 AC-2: 進捗のある行は「1/3」と進捗バー（3項目中1項目が完了）を出し、パーセントは出さない", async () => {
    respondCaseSearch([
      caseSearchItem(1, {
        progress: { done: 1, total: 3 },
        isParticipant: true,
      }),
    ]);
    renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    const row = caseRows(main)[0] as HTMLElement;
    expect(
      within(row).getByRole("progressbar", { name: "3項目中1項目が完了" }),
    ).toBeDefined();
    expect(textOf(row)).toContain("1/3");
    expect(textOf(row)).not.toContain("%");
  });

  it("#155 4-2 AC-2: 参加していない案件の行にも、進捗（2/2 と進捗バー）を出す", async () => {
    respondCaseSearch([
      caseSearchItem(2, {
        progress: { done: 2, total: 2 },
        isParticipant: false,
      }),
    ]);
    renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    const row = caseRows(main)[0] as HTMLElement;
    expect(
      within(row).getByRole("progressbar", { name: "2項目中2項目が完了" }),
    ).toBeDefined();
    expect(textOf(row)).toContain("2/2");
  });

  it("#155 4-2 AC-2: 進捗が null（TODO が0件）の行は「項目なし」で、進捗バーを出さず「0/0」も出さない", async () => {
    respondCaseSearch([
      caseSearchItem(3, { progress: null }),
      caseSearchItem(4, { progress: { done: 0, total: 4 } }),
    ]);
    renderApp("/search?q=見積書");
    const main = await pageMain();
    // 進捗の部品を足しても、行は一覧の直下の li で数えて2件のまま
    await waitFor(() => expect(caseRows(main)).toHaveLength(2));
    const [empty, some] = caseRows(main) as HTMLElement[];
    expect(within(empty as HTMLElement).getByText("項目なし")).toBeDefined();
    expect(within(empty as HTMLElement).queryByRole("progressbar")).toBeNull();
    expect(textOf(empty ?? null)).not.toContain("0/0");
    expect(
      within(some as HTMLElement).getByRole("progressbar", {
        name: "4項目中0項目が完了",
      }),
    ).toBeDefined();
    expect(within(some as HTMLElement).queryByText("項目なし")).toBeNull();
  });
});

// ---- ミューテーション診断の生き残りへの対応（期待は計画 5章・docs/design/search.md の画面の決まりから） ----

describe("#155 4-2 AC-1 F-2 案件の区画の出し分けと作り直し（SearchPage）", () => {
  it("#155 F-2: q がなければ、案件の区画（見出し「案件」）を出さず、案件の API も呼ばない", async () => {
    const world = respondCaseSearch([caseSearchItem(1)]);
    renderApp("/search");
    const main = await pageMain();
    expect(within(main).queryByRole("region", { name: "案件" })).toBeNull();
    expect(
      within(main).queryByRole("heading", { level: 2, name: "案件" }),
    ).toBeNull();
    expect(world.requests).toEqual([]);
  });

  it("#155 F-5: 「さらに表示」の後に語を変えると、案件の区画は作り直され、新しい語は1ページ目だけを取る（cursor つきの要求を出さない）", async () => {
    const cases = respondCaseSearchPages([
      { items: [caseSearchItem(1)], nextCursor: "C1" },
      { items: [caseSearchItem(2)], nextCursor: "C2" },
      { items: [caseSearchItem(3)], nextCursor: null },
    ]);
    const { user } = renderApp("/search?q=前の語");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    await user.click(
      within(caseRegion(main)).getByRole("button", { name: "さらに表示" }),
    );
    await waitFor(() => expect(caseRows(main)).toHaveLength(2));
    const input = within(main).getByRole("searchbox", { name: "検索する言葉" });
    await user.clear(input);
    await user.type(input, "後の語");
    await user.click(within(main).getByRole("button", { name: "検索" }));
    const afterChange = await pageMain();
    await waitFor(() => expect(caseRows(afterChange)).toHaveLength(1));
    expect(
      within(caseRegion(afterChange)).getByRole("button", {
        name: "さらに表示",
      }),
    ).toBeDefined();
    expect(
      cases.requests.filter((r) => r.q === "後の語").map((r) => r.cursor),
    ).toEqual([null]);
  });
});

describe("#155 4-2 AC-1 F-3 案件の区画を外したときの後始末（useCaseSearch。R1-6：区画のキーだけ）", () => {
  it("#155 F-3: 検索の画面を離れると、案件の検索のキャッシュ（取得していない条件のものを含む）が取り除かれ、検索でないキャッシュは残る", async () => {
    respondCaseSearch([caseSearchItem(1)]);
    const { user, client } = renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    // 見張り：この利用者の、表示していない案件の検索の結果と、検索でないキャッシュ
    const caseSentinel = ["search", SHELL_USER.id, "cases", { q: "見張り" }, 1];
    const otherSentinel = ["155c-sentinel"];
    client.setQueryData(caseSentinel, { items: [], hasMore: false });
    client.setQueryData(otherSentinel, "kept");
    await user.click(
      within(screen.getByRole("banner")).getByRole("link", {
        name: "internal-system",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { level: 1, name: "検索結果" }),
      ).toBeNull(),
    );
    expect(client.getQueryData(caseSentinel)).toBeUndefined();
    expect(client.getQueryData(otherSentinel)).toBe("kept");
  });

  it("#155 F-3: 離れて戻ると、案件の区画は前の結果を仮に出さず、読み込み中を出す", async () => {
    const world = respondCaseSearch([
      caseSearchItem(1, { title: "[E2E_TEST]戻る前の案件" }),
    ]);
    const { user } = renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    await user.click(
      within(screen.getByRole("banner")).getByRole("link", {
        name: "internal-system",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { level: 1, name: "検索結果" }),
      ).toBeNull(),
    );
    const gate = deferred();
    world.hold = gate.promise;
    const form = within(screen.getByRole("banner")).getByRole("search", {
      name: "メッセージの検索",
    });
    await user.type(
      within(form).getByRole("searchbox", { name: "検索する言葉" }),
      "見積書",
    );
    await user.click(
      within(form).getByRole("button", { name: "メッセージを検索" }),
    );
    const back = await pageMain();
    expect(
      await within(caseRegion(back)).findByText("案件を読み込み中です"),
    ).toBeDefined();
    expect(document.body.textContent).not.toContain("[E2E_TEST]戻る前の案件");
    gate.release();
    await waitFor(() => expect(caseRows(back)).toHaveLength(1));
  });
});

describe("#155 4-2 AC-2 F-1 案件の行の、無い項目の表示", () => {
  it("#155 F-1: 担当部署が0件の行に、空の項目の区切り（「・」の続き）が出ない", async () => {
    respondCaseSearch([caseSearchItem(1, { departments: [] })]);
    renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    const text = textOf(caseRows(main)[0] ?? null);
    expect(text).toContain("[E2E_TEST]検索の取引先");
    expect(text).not.toMatch(/・\s*・/);
  });

  it("#155 F-1: 納期が無い（null）行に「納期」が出ない（対照：納期がある行には出る）", async () => {
    respondCaseSearch([
      caseSearchItem(1, { dueDate: null }),
      caseSearchItem(2, { dueDate: "2026-12-24" }),
    ]);
    renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(2));
    const [none, some] = caseRows(main);
    expect(textOf(some ?? null)).toContain("2026-12-24");
    expect(textOf(some ?? null)).toContain("納期");
    expect(textOf(none ?? null)).not.toContain("納期");
    expect(textOf(none ?? null)).not.toMatch(/・\s*・/);
  });
});

// #337 AC-6：q が空白だけ（半角・全角・混在）のときは、q がないときと同じ（案内の文。区画なし・API なし・エラーなし）。
// 共通の検証（searchKeywordSchema）は前後の空白を除いて空なら拒否する。URL からの読み取りだけが空白を除かず、案内が出ずに検索が行われ 422 になっていた。
describe("#337 AC-6 q が空白だけのとき", () => {
  const GUIDE = "検索する言葉を入れて、『検索』を押してください。";
  const BLANKS = [
    ["半角の空白だけ", "%20"],
    ["全角の空白だけ", "%E3%80%80%E3%80%80"],
    ["半角と全角の混在", "%20%E3%80%80%20"],
  ] as const;

  async function expectAsNoKeyword(path: string) {
    const messages = respondSearch([searchItem(1)]);
    const cases = respondCaseSearch([caseSearchItem(1)]);
    renderApp(path);
    const body = await pageMain();
    expect(await within(body).findAllByText(GUIDE)).toHaveLength(1);
    expect(within(body).queryByRole("region", { name: "案件" })).toBeNull();
    expect(
      within(body).queryByRole("list", { name: "検索結果の一覧" }),
    ).toBeNull();
    expect(within(body).queryByRole("alert")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(messages.requests).toEqual([]);
    expect(cases.requests).toEqual([]);
  }

  for (const [label, encoded] of BLANKS) {
    it(`#337 AC-6: q が${label}のとき、案内の文が1つだけ出て、案件・メッセージの区画も API の呼び出しもエラーの表示もない`, async () => {
      await expectAsNoKeyword(`/search?q=${encoded}`);
    });
  }

  it("#337 AC-6: 期間だけの指定＋空白だけの q も、言葉なしと同じ", async () => {
    await expectAsNoKeyword(
      "/search?q=%20%E3%80%80&from=2026-11-01&to=2026-11-02",
    );
  });

  it("#337 AC-6（対照）: 前後に空白のある語は言葉ありとして扱われ、案内の文は出ず、前後の空白を除いた語で検索が行われる", async () => {
    const messages = respondSearch([searchItem(1)]);
    const cases = respondCaseSearch([caseSearchItem(1)]);
    renderApp("/search?q=%20%E8%AA%9E%E3%80%80");
    const body = await pageMain();
    await waitFor(() => expect(messages.requests.length).toBeGreaterThan(0));
    await waitFor(() => expect(cases.requests.length).toBeGreaterThan(0));
    expect(within(body).queryByText(GUIDE)).toBeNull();
    // API に渡る q が除いた語かそのままかは、いまの動きを固定しない（サーバーが前後の空白を除く）。除いた後の語が同じであること
    expect(messages.requests.map((r) => r.q?.trim())).toEqual(["語"]);
    expect(cases.requests.map((r) => r.q?.trim())).toEqual(["語"]);
  });
});
