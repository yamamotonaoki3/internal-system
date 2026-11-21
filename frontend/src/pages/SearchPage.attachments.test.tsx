// #155（155-B）S-15：添付ファイル名で一致した結果の見せ方（利用者の決定 B-4）。計画（155-B）7章 F-1・F-2・F-4。
// 期待は、B-4（メッセージの結果と同じ一覧に「ファイル名で一致」の印と、一致したファイル名〔語を強調。複数なら全部〕。押すと、そのメッセージへ移る。
//   ファイルを直接開かせない）、計画 5章（応答は zod で検証。matchedIn は列挙の配列で1つ以上。強調は抜粋と同じ findSearchMatches。名前は文字として描く）、
//   155-A の取得の規則（失敗したら取得済みの行も出さない）から決める。
//
// 契約（実装前の仮置き。画面の文言と構造。実装の担当へ）：
//   結果の行（<ul aria-label="検索結果の一覧"> の直下の <li>）のうち、matchedIn に "attachment" を含む行だけに：
//     印の文字「ファイル名で一致」（その文字だけの要素）と、
//     <ul aria-label="一致したファイル名"> の <li>（matchedAttachments の並びのまま1件ずつ。名前の中の一致は <mark>。名前は文字として描く）。
//     ファイル名はリンクにしない（行のリンクは今と同じ1つ。移り先も今と同じ）。
//   本文だけの一致の行（matchedIn が ["body"]）には、印も名前の一覧も出さない。
//   応答の検証：matchedIn が空・未知の値・欠落、matchedAttachments の欠落は、失敗（role=alert「検索できませんでした」）として扱い、取得済みの行も出さない。
// 画面の文言のほかの部分は SearchPage.test.tsx の冒頭と同じ。データはすべて架空（[E2E_TEST]・testuser_）。
import { screen, waitFor, within } from "@testing-library/react";
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
  type DomStubs,
} from "../test/app-shell-harness";
import {
  respondSearch,
  respondSearchPages,
  searchItem,
} from "../test/search-handlers";

const MARKER = "ファイル名で一致";

let stubs: DomStubs;
let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  stubs = installDomStubs();
  respondShellUser();
  consoleError = vi.spyOn(console, "error");
});
afterEach(() => {
  consoleError.mockRestore();
  stubs.restore();
});

const errorMessages = () =>
  consoleError.mock.calls.map((args) => args.map(String).join(" "));

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

/** 結果の一覧の直下の行（名前の一覧の <li> を含めない） */
function resultRows(main: HTMLElement): HTMLElement[] {
  const list = within(main).getByRole("list", { name: "検索結果の一覧" });
  return Array.from(list.children).filter(
    (child): child is HTMLElement => child.tagName === "LI",
  );
}

/** 行の文字（強調 <mark> で要素が分かれても、文字のつながりで確かめる） */
const textOf = (element: Element) => element.textContent ?? "";
const bodyText = () => document.body.textContent ?? "";

const nameRow = searchItem(1, {
  excerpt: "[E2E_TEST]添付の行の本文の先頭",
  matchedIn: ["attachment"],
  matchedAttachments: [
    { id: "01JTESTATT155B00000000001", name: "見積_v2.pdf" },
    { id: "01JTESTATT155B00000000002", name: "<b>太字</b>の見積.txt" },
  ],
});
const bodyRow = searchItem(2, {
  excerpt: "[E2E_TEST]本文だけの見積の行",
  matchedIn: ["body"],
  matchedAttachments: [],
});

describe("#155 AC-1 B-4 155-B F-1 印と一致したファイル名", () => {
  it("#155 AC-1 F-1: ファイル名で一致した行に、印「ファイル名で一致」と、一致した名前の一覧（並びのまま。語は <mark>）が出る。console.error は出ない", async () => {
    respondSearch([nameRow]);
    renderApp("/search?q=見積");
    const main = await pageMain();
    await waitFor(() => expect(resultRows(main)).toHaveLength(1));
    const [row] = resultRows(main);
    if (row === undefined) throw new Error("行がありません");
    expect(within(row).getByText(MARKER)).toBeDefined();
    const names = within(row).getByRole("list", { name: "一致したファイル名" });
    const items = within(names).getAllByRole("listitem");
    expect(items.map(textOf)).toEqual(["見積_v2.pdf", "<b>太字</b>の見積.txt"]);
    for (const item of items)
      expect(Array.from(item.querySelectorAll("mark")).map(textOf)).toEqual([
        "見積",
      ]);
    // 本文の抜粋も出る
    expect(textOf(row)).toContain("[E2E_TEST]添付の行の本文の先頭");
    expect(errorMessages()).toEqual([]);
  });

  it("#155 AC-1 F-1: HTML を含む名前は、文字として出る（要素として解釈しない）", async () => {
    respondSearch([nameRow]);
    renderApp("/search?q=見積");
    const main = await pageMain();
    await waitFor(() => expect(bodyText()).toContain("<b>太字</b>の見積.txt"));
    const [row] = resultRows(main);
    if (row === undefined) throw new Error("行がありません");
    expect(row.querySelector("b")).toBeNull();
  });

  it("#155 AC-1 F-1: 行のリンクは今と同じ1つで、移り先はそのメッセージのスレッド。ファイル名はリンクにしない", async () => {
    respondSearch([nameRow]);
    renderApp("/search?q=見積");
    const main = await pageMain();
    await waitFor(() => expect(resultRows(main)).toHaveLength(1));
    const [row] = resultRows(main);
    if (row === undefined) throw new Error("行がありません");
    const links = within(row).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      `/channels/${nameRow.roomId}?thread=${nameRow.messageId}`,
    ]);
    const names = within(row).getByRole("list", { name: "一致したファイル名" });
    expect(within(names).queryAllByRole("link")).toEqual([]);
  });

  it("#155 AC-1 F-1: 1件のメッセージの添付が最大の10件・長い名前（255文字）でも、10件すべてが出る", async () => {
    const longNames = Array.from(
      { length: 10 },
      (_, i) => `見積${String(i).padStart(2, "0")}${"長".repeat(247)}.txt`,
    );
    expect(longNames.every((n) => n.length === 255)).toBe(true);
    respondSearch([
      searchItem(3, {
        matchedIn: ["attachment"],
        matchedAttachments: longNames.map((name, i) => ({
          id: `01JTESTATT155B0000000010${i}`,
          name,
        })),
      }),
    ]);
    renderApp("/search?q=見積");
    const main = await pageMain();
    await waitFor(() => expect(resultRows(main)).toHaveLength(1));
    const names = within(main).getByRole("list", {
      name: "一致したファイル名",
    });
    expect(within(names).getAllByRole("listitem").map(textOf)).toEqual(
      longNames,
    );
  });
});

describe("#155 AC-1 B-4 155-B F-2 本文だけの一致", () => {
  it("#155 AC-1 F-2: 本文だけの一致の行には、印も名前の一覧も出ない（同じ画面に印のある行が出ていることを先に確かめる）", async () => {
    respondSearch([nameRow, bodyRow]);
    renderApp("/search?q=見積");
    const main = await pageMain();
    await waitFor(() => expect(resultRows(main)).toHaveLength(2));
    const [withName, bodyOnly] = resultRows(main);
    if (withName === undefined || bodyOnly === undefined)
      throw new Error("行がありません");
    expect(textOf(withName)).toContain("添付の行の本文の先頭");
    expect(within(withName).getByText(MARKER)).toBeDefined();
    expect(textOf(bodyOnly)).toContain("本文だけの見積の行");
    expect(within(bodyOnly).queryByText(MARKER)).toBeNull();
    expect(
      within(bodyOnly).queryByRole("list", { name: "一致したファイル名" }),
    ).toBeNull();
    expect(errorMessages()).toEqual([]);
  });

  it("#155 AC-1 F-2: 本文と名前の両方の一致の行には、印と名前が出る", async () => {
    respondSearch([
      searchItem(4, {
        excerpt: "[E2E_TEST]両方の見積の本文",
        matchedIn: ["body", "attachment"],
        matchedAttachments: [
          { id: "01JTESTATT155B00000000041", name: "両方の見積.xlsx" },
        ],
      }),
    ]);
    renderApp("/search?q=見積");
    const main = await pageMain();
    await waitFor(() => expect(resultRows(main)).toHaveLength(1));
    const [row] = resultRows(main);
    if (row === undefined) throw new Error("行がありません");
    expect(within(row).getByText(MARKER)).toBeDefined();
    const names = within(row).getByRole("list", { name: "一致したファイル名" });
    expect(within(names).getAllByRole("listitem").map(textOf)).toEqual([
      "両方の見積.xlsx",
    ]);
  });
});

describe("#155 AC-4 155-B F-4 応答の検証（zod）", () => {
  const broken: [string, Record<string, unknown>][] = [
    ["matchedIn が空", { matchedIn: [] }],
    ["matchedIn に未知の値", { matchedIn: ["title"] }],
    ["matchedIn が欠落", { matchedIn: undefined }],
    ["matchedAttachments が欠落", { matchedAttachments: undefined }],
    [
      "matchedIn に attachment を含むのに matchedAttachments が空",
      { matchedIn: ["attachment"], matchedAttachments: [] },
    ],
    [
      "matchedIn に attachment を含まないのに matchedAttachments が空でない",
      {
        matchedIn: ["body"],
        matchedAttachments: [
          { id: "01JTESTATT155B00000000092", name: "食い違いの見積.txt" },
        ],
      },
    ],
    [
      "matchedAttachments の要素に id がない",
      {
        matchedIn: ["attachment"],
        matchedAttachments: [{ name: "id のない見積.txt" }],
      },
    ],
    [
      "matchedAttachments の要素の id が空",
      {
        matchedIn: ["attachment"],
        matchedAttachments: [{ id: "", name: "id が空の見積.txt" }],
      },
    ],
    [
      "matchedAttachments の要素に name がない",
      {
        matchedIn: ["attachment"],
        matchedAttachments: [{ id: "01JTESTATT155B00000000093" }],
      },
    ],
    [
      "matchedAttachments が配列でない",
      {
        matchedIn: ["attachment"],
        matchedAttachments: {
          id: "01JTESTATT155B00000000094",
          name: "配列でない見積.txt",
        },
      },
    ],
    ["matchedIn が配列でない", { matchedIn: "body" }],
    ["roomKind に未知の値", { roomKind: "thread" }],
    [
      "matchedAttachments の名前が文字列でない",
      {
        matchedIn: ["attachment"],
        matchedAttachments: [{ id: "01JTESTATT155B00000000091", name: 1 }],
      },
    ],
  ];
  for (const [label, patch] of broken)
    it(`#155 AC-4 F-4: ${label}の応答は、失敗（role=alert「検索できませんでした」と「再試行」）として扱い、行を出さない`, async () => {
      const item: Record<string, unknown> = {
        ...searchItem(5, { excerpt: "[E2E_TEST]検証で拒む行の本文" }),
        ...patch,
      };
      for (const key of Object.keys(patch))
        if (patch[key] === undefined) delete item[key];
      respondSearch([item as never]);
      renderApp("/search?q=見積");
      const main = await pageMain();
      const alert = await within(main).findByRole("alert");
      expect(textOf(alert)).toContain("検索できませんでした");
      expect(
        within(main).getByRole("button", { name: "再試行" }),
      ).toBeDefined();
      expect(bodyText()).not.toContain("検証で拒む行の本文");
    });

  it("#155 AC-4 F-4: 1ページ目は正しく、「さらに表示」の応答が検証に失敗したら、取得済みの行も出さず、失敗の文言を出す", async () => {
    const world = respondSearchPages([
      { items: [nameRow], nextCursor: "CURSOR1" },
      { items: [], nextCursor: null },
    ]);
    world.pages.set("CURSOR1", {
      items: [{ ...searchItem(6), matchedIn: [] }],
      nextCursor: null,
    });
    const { user } = renderApp("/search?q=見積");
    const main = await pageMain();
    await waitFor(() => expect(bodyText()).toContain("見積_v2.pdf"));
    await user.click(within(main).getByRole("button", { name: "さらに表示" }));
    expect(await within(main).findByRole("alert")).toBeDefined();
    expect(bodyText()).not.toContain("見積_v2.pdf");
    expect(bodyText()).not.toContain("添付の行の本文の先頭");
  });
});
