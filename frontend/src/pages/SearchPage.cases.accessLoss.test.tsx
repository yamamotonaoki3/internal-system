// #155（155-C）F-3：資格の喪失・利用者の切り替えで、案件の区画の取得済みのページ・表示中の結果が消えること（計画 7章 F-3・R1-6・ADR-0030）。
// 期待は、計画 5章の画面（クエリのキーは searchKeys.user と同じ先頭 ['search', 利用者の ID, 'cases', …] で、資格の喪失の後片付け
//   〔forgetSearchResults：利用者の検索の全体〕・利用者の切り替えで、メッセージの結果と一緒に消える。通常の後始末〔画面を離れる〕は区画のキーだけ）から決める。
// 固定の待ち時間に頼らず、要求の数・中断の観測で確かめる（155-A の3回目の軽微）。件名は強調の <mark> で要素が分かれるため、画面全体の文字のつながりで確かめる。
// 画面の契約は SearchPage.cases.test.tsx の冒頭と同じ。データはすべて架空（[E2E_TEST]・testuser_）。
import { act, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authKeys } from "../features/auth";
import {
  forgetCaseAfterLeave,
  forgetCaseContent,
} from "../features/cases/hooks/useCaseWrites";
import {
  installDomStubs,
  renderApp,
  respondShellUser,
  SHELL_USER,
  type DomStubs,
} from "../test/app-shell-harness";
import { respondPublicStatus } from "../test/auth-handlers";
import {
  caseSearchItem,
  deferred,
  respondCaseSearchPages,
  respondSearch,
  searchItem,
} from "../test/search-handlers";
import { server } from "../test/server";
import {
  disposeUserSwitchApps,
  renderUserSwitchApp,
} from "../test/user-switch-harness";

const OLD_TITLE = "[E2E_TEST]155C資格を失う前の案件";
const NEW_TITLE = "[E2E_TEST]155C取り直した後の案件";

const bodyText = () => document.body.textContent ?? "";

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
const caseRows = (main: HTMLElement) =>
  Array.from(
    within(caseRegion(main))
      .queryByRole("list", { name: "案件の検索結果の一覧" })
      ?.querySelectorAll(":scope > li") ?? [],
  );

describe("#155 4-2 AC-2 F-3 資格の喪失の後片付けで、案件の区画の表示中の結果が消える", () => {
  let stubs: DomStubs;
  beforeEach(() => {
    stubs = installDomStubs();
    respondShellUser();
    // メッセージの区画の既定（0件）。各試験で上書きする
    respondSearch([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    stubs.restore();
  });

  const CASE_ID = "01JTESTCASE155C00000000077";
  for (const [label, run] of [
    [
      "退出の後片付け（forgetCaseAfterLeave）",
      (client: QueryClient, userId: string) =>
        forgetCaseAfterLeave(client, userId, CASE_ID),
    ],
    [
      "中身の後片付け（forgetCaseContent）",
      (client: QueryClient, userId: string) =>
        forgetCaseContent(client, userId, CASE_ID),
    ],
  ] as const)
    it(`#155 F-3: ${label}が走ると、取り直しの保留の間も、取得済みの2ページ分の案件の行を出さず、取り直した結果だけが出る`, async () => {
      respondSearch([searchItem(1)]);
      const world = respondCaseSearchPages([
        {
          items: [caseSearchItem(1, { title: OLD_TITLE, isParticipant: true })],
          nextCursor: "C1",
        },
        {
          items: [caseSearchItem(2, { title: `${OLD_TITLE}二` })],
          nextCursor: null,
        },
      ]);
      const app = renderApp("/search?q=155C");
      const main = await pageMain();
      await waitFor(() => expect(caseRows(main)).toHaveLength(1));
      await app.user.click(
        within(caseRegion(main)).getByRole("button", { name: "さらに表示" }),
      );
      await waitFor(() => expect(caseRows(main)).toHaveLength(2));
      // サーバーの側では、資格が変わった後の結果になる。取り直しを保留する
      world.pages = new Map([
        [
          null,
          {
            items: [
              caseSearchItem(1, { title: NEW_TITLE, isParticipant: false }),
            ],
            nextCursor: null,
          },
        ],
      ]);
      const gate = deferred();
      world.hold = gate.promise;
      const before = world.requests.length;
      await act(async () => {
        await run(app.client, SHELL_USER.id);
      });
      await waitFor(() =>
        expect(world.requests.length).toBeGreaterThan(before),
      );
      // 保留中：取得済みの行（1ページ目・2ページ目とも）は画面のどこにもない
      expect(bodyText()).not.toContain(OLD_TITLE);
      gate.release();
      await waitFor(() => expect(bodyText()).toContain(NEW_TITLE));
      expect(bodyText()).not.toContain(OLD_TITLE);
    });

  it("#155 F-3: 取り直しの途中で語を変えたら、取り消した古い取得は、残りのページ（cursor つき）を取りにいかない", async () => {
    const world = respondCaseSearchPages([
      {
        items: [caseSearchItem(11, { title: "[E2E_TEST]頁一の案件" })],
        nextCursor: "P1",
      },
      {
        items: [caseSearchItem(12, { title: "[E2E_TEST]頁二の案件" })],
        nextCursor: "P2",
      },
      {
        items: [caseSearchItem(13, { title: "[E2E_TEST]頁三の案件" })],
        nextCursor: null,
      },
    ]);
    const app = renderApp("/search?q=頁");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    await app.user.click(
      within(caseRegion(main)).getByRole("button", { name: "さらに表示" }),
    );
    await waitFor(() => expect(caseRows(main)).toHaveLength(2));
    // 3ページ目までの取り直しの、1ページ目の応答を保留し、その要求の中断を見張る
    const gate = deferred();
    const held = { arrived: false, aborted: false };
    const urls = new WeakMap<XMLHttpRequest, string>();
    const open = XMLHttpRequest.prototype.open;
    const abort = XMLHttpRequest.prototype.abort;
    vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(function (
      this: XMLHttpRequest,
      ...args: Parameters<XMLHttpRequest["open"]>
    ) {
      urls.set(this, String(args[1]));
      return (open as (...a: unknown[]) => void).apply(this, args);
    });
    vi.spyOn(XMLHttpRequest.prototype, "abort").mockImplementation(function (
      this: XMLHttpRequest,
    ) {
      const url = new URL(urls.get(this) ?? "/", "http://localhost");
      if (
        url.pathname === "/api/search/cases" &&
        url.searchParams.get("q") === "頁" &&
        url.searchParams.get("cursor") === null
      )
        held.aborted = true;
      abort.call(this);
    });
    server.use(
      http.get("/api/search/cases", async ({ request }) => {
        const url = new URL(request.url);
        if (
          held.arrived ||
          url.searchParams.get("q") !== "頁" ||
          url.searchParams.get("cursor") !== null
        )
          return undefined;
        held.arrived = true;
        await gate.promise;
        return undefined;
      }),
    );
    const before = world.requests.length;
    await app.user.click(
      within(caseRegion(main)).getByRole("button", { name: "さらに表示" }),
    );
    await waitFor(() => expect(held.arrived).toBe(true));
    const input = within(main).getByRole("searchbox", { name: "検索する言葉" });
    await app.user.clear(input);
    await app.user.type(input, "別語");
    await app.user.click(within(main).getByRole("button", { name: "検索" }));
    await waitFor(() =>
      expect(world.requests.some((r) => r.q === "別語")).toBe(true),
    );
    await waitFor(() => expect(held.aborted).toBe(true));
    gate.release();
    expect(
      world.requests
        .slice(before)
        .filter((r) => r.q === "頁" && r.cursor !== null),
    ).toEqual([]);
  });

  it("#155 F-3 R1-6: 検索の画面を離れると、案件の結果もキャッシュに残らない（セッションは残る）", async () => {
    respondCaseSearchPages([
      { items: [caseSearchItem(1, { title: OLD_TITLE })], nextCursor: null },
    ]);
    const app = renderApp("/search?q=155C");
    const main = await pageMain();
    await waitFor(() => expect(caseRows(main)).toHaveLength(1));
    expect(
      app.client.getQueryCache().findAll({
        queryKey: ["search", SHELL_USER.id, "cases"],
      }).length,
    ).toBeGreaterThan(0);
    await app.user.click(
      within(screen.getByRole("banner")).getByRole("link", {
        name: "internal-system",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { level: 1, name: "検索結果" }),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(
        app.client.getQueryCache().findAll({ queryKey: ["search"] }),
      ).toEqual([]),
    );
    expect(app.client.getQueryData(authKeys.session)).toBeDefined();
  });
});

// ---- 利用者の切り替え（ADR-0030・#284） ----

const USER_A = {
  id: "01JTEST155CSESSA0000000001",
  displayName: "testuser_155c_a",
  loginId: "testuser_155c_a",
};
const USER_B = {
  id: "01JTEST155CSESSB0000000001",
  displayName: "testuser_155c_b",
  loginId: "testuser_155c_b",
};
type TestUser = typeof USER_A;
const A_MARK = "[E2E_TEST]155C利用者Aの案件";
const B_MARK = "[E2E_TEST]155C利用者Bの案件";

const sessionOf = (user: TestUser) => ({
  user,
  permissions: [],
  mustChangePassword: false,
  reauthenticatedAt: null,
});

function respondSwitchWorld() {
  const world: { user: TestUser; hold: Promise<void> | null } = {
    user: USER_A,
    hold: null,
  };
  respondPublicStatus();
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json(sessionOf(world.user)),
    ),
    http.get("/api/search/messages", () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
    http.get("/api/search/cases", async () => {
      const user = world.user;
      const hold = world.hold;
      if (hold !== null) await hold;
      return HttpResponse.json({
        items: [
          caseSearchItem(1, {
            title: `${user === USER_A ? A_MARK : B_MARK}の共通語`,
          }),
        ],
        nextCursor: null,
      });
    }),
  );
  return world;
}

describe("#155 4-2 AC-2 F-3 利用者の切り替え（案件の区画）", () => {
  let stubs: DomStubs;
  beforeEach(() => {
    stubs = installDomStubs();
  });
  afterEach(() => {
    disposeUserSwitchApps();
    stubs.restore();
  });

  it("#155 F-3: A の案件の結果を出したまま B に替わると、B の取り直しの保留中も含め、A の件名をどの確定にも出さず、A のキャッシュも残らない", async () => {
    const world = respondSwitchWorld();
    const app = renderUserSwitchApp("/search?q=共通語", {
      needles: [A_MARK],
    });
    await waitFor(() => expect(bodyText()).toContain(A_MARK));
    const gate = deferred();
    world.hold = gate.promise;
    world.user = USER_B;
    app.watch.arm();
    act(() => {
      app.client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    expect(app.watch.hits).toEqual([]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(app.watch.hits).toEqual([]);
    gate.release();
    await waitFor(() => expect(bodyText()).toContain(B_MARK));
    expect(app.watch.hits).toEqual([]);
    expect(bodyText()).not.toContain(A_MARK);
    await waitFor(() =>
      expect(
        app.client.getQueryCache().findAll({ queryKey: ["search", USER_A.id] }),
      ).toEqual([]),
    );
  });
});
