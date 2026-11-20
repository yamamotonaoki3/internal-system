// #155（155-A）S-15 検索結果（メッセージ）とヘッダーの検索欄。計画 7章 F-1〜F-6・F-8、計画 4.5。
// 期待は、screens.md の S-15（全画面。絞り込みは折りたたむ）、計画 4.5（入口はヘッダーの検索欄 → /search?q=…。検査は searchKeywordSchema を共有。
//   結果は部屋・投稿者・抜粋〔語を強調〕・日時。読み込み中・0件・エラーと再試行・さらに表示。絞り込みは部屋・期間。結果から元の場所〔返信は親のスレッド〕へ。
//   抜粋は文字として描く。キャッシュに持たない〔staleTime 0・gcTime 0・離れたら取り除く・前の結果を仮に出さない〕）と、
//   shared/search-rules.ts の文言（「検索する言葉を入力してください」「検索する言葉は100文字以内で入力してください」）から決める。
//
// 契約（実装前の仮置き。画面の文言と構造。実装の担当へ）：
//   ヘッダー（features/app-shell/Header.tsx）に <form role="search" aria-label="メッセージの検索">：入力欄（aria-label「検索する言葉」）とボタン「検索」。
//     送ると、前後の空白を除いた語で /search?q=<語> へ移る。空・空白だけ・101文字（UTF-16）は、入力欄の近くに上の文言を出し、移らない。
//   pages/SearchPage.tsx（App.tsx の /search。レイアウトの子）：main の中に h1「検索結果」。検索の欄（同じく「検索する言葉」とボタン「検索」。いまの語を入れておく）。
//     絞り込みは <details>（要約「絞り込み」）の中に、日付の入力欄「開始日」「終了日」（type=date）。値を入れて「検索」を押すと from・to を付けて取り直す。
//     部屋の絞り込みは、URL の roomId を API に渡す（部屋を選ぶ部品は、統括に確かめる事項）。
//     状態：読み込み中（role=status「読み込み中です」）／0件（「一致するメッセージはありません」）／失敗（role=alert「検索できませんでした」とボタン「再試行」。前の結果を出さない）／
//       結果（<ul aria-label="検索結果の一覧"> の <li>。部屋の名前・投稿者の表示名・<time dateTime={createdAt}>・抜粋。抜粋の中の一致は <mark>）。続きがあれば「さらに表示」。
//     q がなければ API を呼ばない。
//     行のリンク（行ごとに1つ。名前に抜粋を含む）：チャンネル・案件の部屋は /channels/<roomId>?thread=<ID>、DM は /dms/<roomId>?thread=<ID>。
//       ID は返信なら親（parentMessageId）、そうでなければそのメッセージ。案件の部屋は、既存のチャンネルの画面が案件の画面へ移す（?thread= を引き継ぐ）。
//   キャッシュのキーは ['search', 利用者の ID, 'messages', 条件]。
// 利用者の切り替えは SearchPage.userSwitch.test.tsx、資格を失ったときの取り除きは features/cases/hooks/useCaseWrites.search-forget.test.ts。
// データはすべて架空（[E2E_TEST]・testuser_）。
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installDomStubs,
  renderApp,
  respondShellUser,
  type DomStubs,
} from "../test/app-shell-harness";
import {
  deferred,
  respondSearch,
  respondSearchPages,
  searchItem,
} from "../test/search-handlers";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
  respondShellUser();
});
afterEach(() => {
  stubs.restore();
});

const main = () => screen.getByRole("main");
const headerForm = () =>
  within(screen.getByRole("banner")).getByRole("search", {
    name: "メッセージの検索",
  });
const resultList = () =>
  within(main()).getByRole("list", { name: "検索結果の一覧" });
const resultRows = () => within(resultList()).getAllByRole("listitem");
/**
 * 検索の画面の main。セッションの確認中は別の main（「ログイン状態の確認」）が出ているため、画面の見出しが出てから、その main を返す
 */
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
/** 画面全体の文字（抜粋の強調 <mark> で要素が分かれても、文字としてつながった形で確かめる） */
const bodyText = () => document.body.textContent ?? "";
const path = () => screen.getByTestId("path").textContent;

async function searchFromHeader(
  user: ReturnType<typeof renderApp>["user"],
  text: string,
) {
  const form = await waitFor(headerForm);
  const input = within(form).getByRole("searchbox", { name: "検索する言葉" });
  await user.clear(input);
  await user.type(input, text);
  await user.click(within(form).getByRole("button", { name: "検索" }));
}

describe("#155 AC-1 F-1 ヘッダーの検索欄", () => {
  it("#155 AC-1 F-1: ヘッダーから送ると /search へ移り、前後の空白を除いた語で検索する", async () => {
    const world = respondSearch([searchItem(1)]);
    const { user } = renderApp("/");
    await searchFromHeader(user, "  見積書  ");
    await waitFor(() => expect(path()).toBe("/search"));
    expect(
      await within(await pageMain()).findByRole("heading", {
        level: 1,
        name: "検索結果",
      }),
    ).toBeDefined();
    await waitFor(() => expect(resultRows()).toHaveLength(1));
    expect(world.requests.map((r) => r.q)).toEqual(["見積書"]);
  });

  it("#155 AC-3 F-3: 空・空白だけは「検索する言葉を入力してください」を出し、移らない（API も呼ばない）", async () => {
    const world = respondSearch([]);
    const { user } = renderApp("/");
    const form = await waitFor(headerForm);
    await user.click(within(form).getByRole("button", { name: "検索" }));
    expect(
      await within(form).findByText("検索する言葉を入力してください"),
    ).toBeDefined();
    await searchFromHeader(user, "   ");
    expect(
      within(headerForm()).getByText("検索する言葉を入力してください"),
    ).toBeDefined();
    expect(path()).toBe("/");
    expect(world.requests).toEqual([]);
  });

  it("#155 AC-3 F-3: 1文字は送れる。100文字は送れ、101文字は「検索する言葉は100文字以内で入力してください」で移らない", async () => {
    const world = respondSearch([]);
    const { user } = renderApp("/");
    // 入力欄に maxLength があっても確かめられるよう、値を直接入れてから送る
    const form = await waitFor(headerForm);
    fireEvent.change(
      within(form).getByRole("searchbox", { name: "検索する言葉" }),
      { target: { value: "あ".repeat(101) } },
    );
    await user.click(within(form).getByRole("button", { name: "検索" }));
    expect(
      await within(headerForm()).findByText(
        "検索する言葉は100文字以内で入力してください",
      ),
    ).toBeDefined();
    expect(path()).toBe("/");
    await searchFromHeader(user, "あ".repeat(100));
    await waitFor(() => expect(path()).toBe("/search"));
    await searchFromHeader(user, "猫");
    await waitFor(() =>
      expect(world.requests.map((r) => r.q)).toEqual(["あ".repeat(100), "猫"]),
    );
  });

  it('#155 AC-3 F-3: 記号（[ ] { } " * %）を含む語も、そのまま送る', async () => {
    const world = respondSearch([]);
    const { user } = renderApp("/");
    // user-event の type は [ と { をキーの指定として読むため、重ねて書く
    await searchFromHeader(user, '[[x]{{y} "a*b" 100%');
    await waitFor(() =>
      expect(world.requests.map((r) => r.q)).toEqual(['[x]{y} "a*b" 100%']),
    );
  });
});

describe("#155 AC-1 F-2 S-15 の状態", () => {
  it("#155 AC-1 F-2: 読み込み中は「読み込み中です」（role=status）を出す", async () => {
    const world = respondSearch([searchItem(1)]);
    const gate = deferred();
    world.hold = gate.promise;
    renderApp("/search?q=見積書");
    // セッションの確認の表示（「確認中です」）と取り違えないよう、画面の見出しを待ってから探す
    await within(await pageMain()).findByRole("heading", {
      level: 1,
      name: "検索結果",
    });
    const loading = await within(await pageMain()).findByText("読み込み中です");
    expect(loading.closest("[role='status']")).not.toBeNull();
    gate.release();
    await waitFor(() => expect(resultRows()).toHaveLength(1));
    expect(within(main()).queryByText("読み込み中です")).toBeNull();
  });

  it("#155 AC-1 F-2: 0件のときは「一致するメッセージはありません」を出す", async () => {
    respondSearch([]);
    renderApp("/search?q=見積書");
    expect(
      await within(await pageMain()).findByText(
        "一致するメッセージはありません",
      ),
    ).toBeDefined();
    expect(
      within(main()).queryByRole("button", { name: "さらに表示" }),
    ).toBeNull();
  });

  it("#155 AC-1 F-2: 失敗は role=alert「検索できませんでした」と「再試行」。0件とは出さず、再試行で結果が出る", async () => {
    const world = respondSearch([searchItem(1)]);
    world.fail = { status: 500, times: 1 };
    const { user } = renderApp("/search?q=見積書");
    const alert = await within(await pageMain()).findByRole("alert");
    expect(alert.textContent).toContain("検索できませんでした");
    expect(
      within(main()).queryByText("一致するメッセージはありません"),
    ).toBeNull();
    await user.click(within(main()).getByRole("button", { name: "再試行" }));
    await waitFor(() => expect(resultRows()).toHaveLength(1));
    expect(within(main()).queryByRole("alert")).toBeNull();
  });

  it("#155 AC-1 F-2: 続きがあれば「さらに表示」で次のページを足し、続きがなくなれば出さない", async () => {
    const world = respondSearchPages([
      { items: [searchItem(1), searchItem(2)], nextCursor: "CURSOR1" },
      { items: [searchItem(3)], nextCursor: null },
    ]);
    const { user } = renderApp("/search?q=見積書");
    await waitFor(() => expect(resultRows()).toHaveLength(2));
    await user.click(
      within(main()).getByRole("button", { name: "さらに表示" }),
    );
    await waitFor(() => expect(resultRows()).toHaveLength(3));
    expect(world.requests.map((r) => r.cursor)).toEqual([null, "CURSOR1"]);
    expect(
      within(main()).queryByRole("button", { name: "さらに表示" }),
    ).toBeNull();
  });

  it("#155 AC-1 F-2: 「さらに表示」の取得の失敗は、読み込み済みの結果を残したまま、エラーと再試行を出す", async () => {
    const world = respondSearchPages([
      { items: [searchItem(1)], nextCursor: "CURSOR1" },
      { items: [searchItem(2)], nextCursor: null },
    ]);
    const { user } = renderApp("/search?q=見積書");
    await waitFor(() => expect(resultRows()).toHaveLength(1));
    world.fail = { status: 500, times: 1 };
    await user.click(
      within(main()).getByRole("button", { name: "さらに表示" }),
    );
    expect(await within(await pageMain()).findByRole("alert")).toBeDefined();
    expect(resultRows()).toHaveLength(1);
  });

  it("#155 AC-1 F-2: q がなければ API を呼ばない", async () => {
    const world = respondSearch([searchItem(1)]);
    renderApp("/search");
    await within(await pageMain()).findByRole("heading", {
      level: 1,
      name: "検索結果",
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(world.requests).toEqual([]);
  });
});

describe("#155 AC-1 F-4 絞り込み（部屋・期間）", () => {
  it("#155 AC-3 F-4: 絞り込みは折りたたまれていて、開始日・終了日を入れて検索すると from・to を付けて取り直す", async () => {
    const world = respondSearch([searchItem(1)]);
    const { user } = renderApp("/search?q=見積書");
    await waitFor(() => expect(resultRows()).toHaveLength(1));
    const details = within(main()).getByText("絞り込み").closest("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    await user.click(within(main()).getByText("絞り込み"));
    await user.type(within(main()).getByLabelText("開始日"), "2026-11-01");
    await user.type(within(main()).getByLabelText("終了日"), "2026-11-10");
    await user.click(within(main()).getByRole("button", { name: "検索" }));
    await waitFor(() =>
      expect(world.requests.at(-1)).toMatchObject({
        q: "見積書",
        from: "2026-11-01",
        to: "2026-11-10",
      }),
    );
  });

  it("#155 AC-3 F-4: URL の roomId・from・to を API に渡す", async () => {
    const world = respondSearch([]);
    renderApp(
      "/search?q=見積書&roomId=01JTESTROOM155000000000009&from=2026-11-01&to=2026-11-02",
    );
    await within(await pageMain()).findByText("一致するメッセージはありません");
    expect(world.requests[0]).toMatchObject({
      q: "見積書",
      roomId: "01JTESTROOM155000000000009",
      from: "2026-11-01",
      to: "2026-11-02",
    });
  });
});

describe("#155 AC-1 F-5 結果から元の場所へ", () => {
  it("#155 AC-1 F-5: チャンネル・案件の部屋は /channels/<部屋>?thread=<ID>、DM は /dms/<部屋>?thread=<ID>。返信は親のスレッド", async () => {
    respondSearch([
      searchItem(1, {
        excerpt: "[E2E_TEST]行チャンネル",
        roomId: "01JTESTROOM155000000000001",
        roomKind: "channel",
      }),
      searchItem(2, {
        excerpt: "[E2E_TEST]行DM",
        roomId: "01JTESTROOM155000000000002",
        roomKind: "direct",
        roomName: "testuser_155_c",
      }),
      searchItem(3, {
        excerpt: "[E2E_TEST]行案件",
        roomId: "01JTESTROOM155000000000003",
        roomKind: "case",
        roomName: "QZA-261120-0001",
      }),
      searchItem(4, {
        excerpt: "[E2E_TEST]行返信",
        roomId: "01JTESTROOM155000000000001",
        roomKind: "channel",
        parentMessageId: "01JTESTPARENT1550000000001",
      }),
    ]);
    renderApp("/search?q=行");
    await waitFor(() => expect(resultRows()).toHaveLength(4));
    const hrefOf = (text: string) => {
      const row = resultRows().find((r) =>
        (r.textContent ?? "").includes(text),
      );
      if (row === undefined) throw new Error(`「${text}」の行がありません`);
      return within(row).getByRole("link").getAttribute("href");
    };
    expect(hrefOf("行チャンネル")).toBe(
      `/channels/01JTESTROOM155000000000001?thread=${searchItem(1).messageId}`,
    );
    expect(hrefOf("行DM")).toBe(
      `/dms/01JTESTROOM155000000000002?thread=${searchItem(2).messageId}`,
    );
    expect(hrefOf("行案件")).toBe(
      `/channels/01JTESTROOM155000000000003?thread=${searchItem(3).messageId}`,
    );
    expect(hrefOf("行返信")).toBe(
      "/channels/01JTESTROOM155000000000001?thread=01JTESTPARENT1550000000001",
    );
  });

  it("#155 AC-1 F-5: 行に、部屋の名前・投稿者の表示名・日時（time の dateTime）を出す", async () => {
    const item = searchItem(1, {
      roomName: "[E2E_TEST]営業の部屋",
      author: {
        id: "01JTESTUSER155000000000009",
        displayName: "testuser_155_writer",
      },
    });
    respondSearch([item]);
    renderApp("/search?q=見積書");
    await waitFor(() => expect(resultRows()).toHaveLength(1));
    const [row] = resultRows();
    if (row === undefined) throw new Error("行がありません");
    expect(within(row).getByText("[E2E_TEST]営業の部屋")).toBeDefined();
    expect(within(row).getByText("testuser_155_writer")).toBeDefined();
    expect(row.querySelector("time")?.getAttribute("dateTime")).toBe(
      item.createdAt,
    );
  });
});

describe("#155 AC-3 F-6 抜粋の強調と、文字としての描画", () => {
  it("#155 AC-3 F-6: 抜粋の中の一致（英字の大文字・小文字を区別しない）を mark で強調する", async () => {
    respondSearch([
      searchItem(1, { excerpt: "請求書 INVOICE と invoice の件" }),
    ]);
    renderApp("/search?q=Invoice");
    await waitFor(() => expect(resultRows()).toHaveLength(1));
    const marks = [...resultList().querySelectorAll("mark")].map(
      (m) => m.textContent,
    );
    expect(marks).toEqual(["INVOICE", "invoice"]);
  });

  it("#155 AC-3 F-6: 抜粋の HTML・マークダウンは解釈せず、文字として出す（XSS にならない）", async () => {
    const excerpt =
      '<img src=x onerror="alert(1)"><script>alert(2)</script>**太字** [リンク](https://example.com)';
    respondSearch([searchItem(1, { excerpt })]);
    renderApp("/search?q=alert");
    await waitFor(() => expect(resultRows()).toHaveLength(1));
    const list = resultList();
    expect(list.querySelector("img")).toBeNull();
    expect(list.querySelector("script")).toBeNull();
    expect(list.querySelector("strong")).toBeNull();
    expect(list.querySelector("a[href='https://example.com']")).toBeNull();
    expect(list.textContent).toContain("<script>alert(2)</script>");
    expect(list.textContent).toContain("**太字**");
  });
});

describe("#155 AC-4 F-8 検索の結果をキャッシュに持たない（戻ったときに古い抜粋を描かない）", () => {
  const OLD = "[E2E_TEST]古い抜粋の本文";
  const NEW = "[E2E_TEST]新しい抜粋の本文";

  async function searchThenLeave() {
    const world = respondSearchPages([
      { items: [searchItem(1, { excerpt: OLD })], nextCursor: "CURSOR1" },
      { items: [searchItem(2, { excerpt: `${OLD}2` })], nextCursor: null },
    ]);
    const app = renderApp("/");
    await searchFromHeader(app.user, "抜粋");
    await waitFor(() => expect(resultRows()).toHaveLength(1));
    await app.user.click(
      within(main()).getByRole("button", { name: "さらに表示" }),
    );
    await waitFor(() => expect(resultRows()).toHaveLength(2));
    // 検索の画面を離れる（ヘッダーのロゴでホームへ）
    await app.user.click(
      within(screen.getByRole("banner")).getByRole("link", {
        name: "internal-system",
      }),
    );
    await waitFor(() => expect(path()).toBe("/"));
    return { world, app };
  }

  it("#155 AC-4 F-8: 戻ったときの取り直しが遅い間も、前の結果（1ページ目・2ページ目）を出さない", async () => {
    const { world, app } = await searchThenLeave();
    const gate = deferred();
    world.hold = gate.promise;
    world.pages.set(null, {
      items: [searchItem(3, { excerpt: NEW })],
      nextCursor: null,
    });
    await searchFromHeader(app.user, "抜粋");
    await waitFor(() => expect(path()).toBe("/search"));
    expect(bodyText()).not.toContain(OLD);
    expect(
      await within(await pageMain()).findByText("読み込み中です"),
    ).toBeDefined();
    expect(bodyText()).not.toContain(OLD);
    gate.release();
    await waitFor(() => expect(resultRows()).toHaveLength(1));
    expect(resultList().textContent).toContain(NEW);
    expect(bodyText()).not.toContain(OLD);
  });

  it("#155 AC-4 F-8: 戻ったときの取り直しが失敗したら、前の結果を出さずにエラーを出す", async () => {
    const { world, app } = await searchThenLeave();
    world.fail = { status: 403, times: 1 };
    await searchFromHeader(app.user, "抜粋");
    expect(await within(await pageMain()).findByRole("alert")).toBeDefined();
    expect(bodyText()).not.toContain(OLD);
    expect(
      within(main()).queryByRole("list", { name: "検索結果の一覧" }),
    ).toBeNull();
  });

  it("#155 AC-4 F-8: 離れた後に、検索の結果がキャッシュに残らない", async () => {
    const { app } = await searchThenLeave();
    await waitFor(() =>
      expect(
        app.client.getQueryCache().findAll({ queryKey: ["search"] }),
      ).toEqual([]),
    );
  });
});
