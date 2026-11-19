// #148（148-C）コードレビュー1回目（重大）、C-191(4)・5-1 AC-2・#308：本人の退出、またはほかの参加者に外された後、S-16 の一覧・サイドバーに、
// 前の最終更新・未読の数を残さない（一覧の取り直しの応答を保留している間も）。枠（App）を通して描く。API は MSW、保留は手で解決する Promise。
// 偽の時計でポーリングを進める（固定の時間の待ちを使わない）。データはすべて架空（testuser_・[UNIT_TEST]）。
// 契約（実装の担当へ）：
//   資格を失った後は、キャッシュに残る一覧・概要の行でも、その案件を非参加として扱い、lastActivityAt・channelId を描かない
//   （「参加中」の一覧・サイドバーからはその行を消す。「すべての案件」では非参加の行として2項目なしで出す）。
//   未読の対応表（["unread","counts"]）にその部屋が残っていても、数を出さない。
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_USER } from "../test/auth-handlers";
import {
  installDomStubs,
  renderApp,
  type DomStubs,
} from "../test/app-shell-harness";
import {
  PARTICIPANT_CREATOR,
  caseDetail,
  caseId,
  caseRoomId,
  caseSummary,
  caseTitle,
  outsiderSummary,
  type CaseParticipant,
  type CaseSummary,
} from "../test/case-handlers";
import { message } from "../test/message-handlers";
import { server } from "../test/server";
import { respondUnread } from "../test/unread-handlers";

const N = 31;
const TITLE = caseTitle(N);
const ROOM = caseRoomId(N);
const AT = "2026-11-19T01:05:00.000Z";
const PRIVATE_TEXT = "参加者だけが見られます（非公開）";
const SELF: CaseParticipant = {
  userId: TEST_USER.id,
  displayName: TEST_USER.displayName,
  departmentName: null,
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
};

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

type World = {
  participant: boolean;
  /** 一覧（GET /api/cases）の応答を保留する */
  listGate: Promise<void> | null;
  /** 真の間、「参加中」の一覧の要求を、届いた時点の行のまま、release まで保留する（最初の取得の途中を作る） */
  holdJoined: boolean;
  joinedHolds: { release: () => void }[];
  joinedRequests: number;
  /** 概要（GET /api/cases/:caseId）の応答を保留する（#308 の確かめの途中を作る） */
  summaryGate: Promise<void> | null;
};

/** 参加の状態で応答を変える、一覧・概要・詳細・部屋のメッセージ。退出（DELETE）で非参加になる */
function respondWorld(): World {
  const w: World = {
    participant: true,
    listGate: null,
    holdJoined: false,
    joinedHolds: [],
    joinedRequests: 0,
    summaryGate: null,
  };
  const summary = (): CaseSummary =>
    w.participant
      ? caseSummary(N, { lastActivityAt: AT, participantCount: 2 })
      : outsiderSummary(N);
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({
        user: TEST_USER,
        permissions: [],
        mustChangePassword: false,
        reauthenticatedAt: null,
      }),
    ),
    http.get("/api/cases", async ({ request }) => {
      const scope = new URL(request.url).searchParams.get("scope");
      // 届いた時点の行（保留した後に返すときも、古いまま）
      const items = scope === "joined" && !w.participant ? [] : [summary()];
      if (scope === "joined") {
        w.joinedRequests += 1;
        if (w.holdJoined) {
          const hold = deferred();
          w.joinedHolds.push(hold);
          await hold.promise;
        }
      }
      if (w.listGate !== null) await w.listGate;
      return HttpResponse.json({ items, nextCursor: null });
    }),
    http.get("/api/cases/:caseId", async () => {
      if (w.summaryGate !== null) await w.summaryGate;
      return HttpResponse.json(summary());
    }),
    http.get("/api/cases/:caseId/detail", () =>
      w.participant
        ? HttpResponse.json(
            caseDetail(N, { participants: [PARTICIPANT_CREATOR, SELF] }),
          )
        : HttpResponse.json(
            { code: "FORBIDDEN", message: PRIVATE_TEXT },
            { status: 403 },
          ),
    ),
    http.get("/api/rooms/:roomId/messages", () =>
      w.participant
        ? HttpResponse.json({
            items: [message(1, { roomId: ROOM, body: "[UNIT_TEST]148C投稿" })],
            nextCursor: null,
            hasMore: false,
          })
        : HttpResponse.json(
            { code: "FORBIDDEN", message: PRIVATE_TEXT },
            { status: 403 },
          ),
    ),
    http.delete("/api/cases/:caseId/participants/:userId", () => {
      w.participant = false;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return w;
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const menu = () => screen.findByRole("navigation", { name: "メインメニュー" });

/** 画面のどこにも、その案件の最終更新・未読の数がない（一覧の行・サイドバー） */
function expectNoActivityShown() {
  expect(document.querySelector(`time[datetime="${AT}"]`)).toBeNull();
  expect(screen.queryByText(/未読 \d+件/)).toBeNull();
  for (const card of screen.queryAllByRole("listitem"))
    if (card.textContent?.includes(TITLE))
      expect(card.textContent).not.toContain("最終更新");
}

async function expectSidebarWithoutCase() {
  const nav = await menu();
  expect(
    within(nav).queryByRole("link", {
      name: new RegExp(TITLE.replace(/[[\]]/g, "\\$&")),
    }),
  ).toBeNull();
}

/** /cases から始め、一覧とサイドバーに最終更新・未読が出たことを確かめてから、案件を開く */
async function openFromList(user: ReturnType<typeof renderApp>["user"]) {
  // ログイン状態の確認中の main は枠の main に置き換わるため、枠のメニューが出てから main を取る
  await menu();
  const main = screen.getByRole("main");
  const link = await within(main).findByRole("link", { name: TITLE });
  const card = link.closest("li") as HTMLElement;
  await waitFor(() => expect(within(card).getByText("未読 3件")).toBeTruthy());
  expect(card.querySelector(`time[datetime="${AT}"]`)).not.toBeNull();
  await user.click(link);
  expect(
    await screen.findByRole("heading", { level: 2, name: "やり取り" }),
  ).toBeTruthy();
}

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  stubs.restore();
});

describe("#148 148-C コードレビュー1回目（重大）: 資格を失った後、一覧・サイドバーに前の最終更新・未読を残さない", () => {
  it("#148 148-C C-191(4)・5-1 AC-3: 本人が退出して S-16 へ移ると、一覧の取り直しを保留している間も、参加中・すべての案件・サイドバーに、その案件の最終更新・未読が出ない（応答の後も）", async () => {
    const w = respondWorld();
    const unread = respondUnread({ counts: { [ROOM]: 3 } });
    unread.keepCountsOnPut = true;
    const { user } = renderApp("/cases");
    // 退出の前に「すべての案件」を取得しておく（その案件の行に最終更新・未読が出て、キャッシュに参加者の行が残る）
    await menu();
    await user.click(screen.getByRole("radio", { name: "すべての案件" }));
    const allCard = (
      await within(screen.getByRole("main")).findByRole("link", { name: TITLE })
    ).closest("li") as HTMLElement;
    await waitFor(() =>
      expect(within(allCard).getByText("未読 3件")).toBeTruthy(),
    );
    expect(allCard.querySelector(`time[datetime="${AT}"]`)).not.toBeNull();
    await user.click(screen.getByRole("radio", { name: "自分が参加する案件" }));
    await openFromList(user);

    const manager = await (async () => {
      await user.click(
        await screen.findByRole("button", { name: "参加者を管理" }),
      );
      return screen.findByRole("dialog", { name: "参加者を管理" });
    })();
    const selfRow = within(manager)
      .getAllByRole("listitem")
      .find((row) => row.textContent?.includes(SELF.displayName));
    if (selfRow === undefined) throw new Error("本人の行がありません");
    const gate = deferred();
    w.listGate = gate.promise;
    await user.click(within(selfRow).getByRole("button", { name: "退出する" }));
    const confirm = await screen.findByRole("dialog", {
      name: "案件からの退出",
    });
    await user.click(within(confirm).getByRole("button", { name: "退出する" }));
    await screen.findByRole("heading", { level: 1, name: "案件一覧" });

    // 取り直しの保留中：参加中の一覧・サイドバー
    expectNoActivityShown();
    await expectSidebarWithoutCase();
    expect(
      within(screen.getByRole("main")).queryByRole("link", { name: TITLE }),
    ).toBeNull();
    // 保留中：すべての案件
    await user.click(screen.getByRole("radio", { name: "すべての案件" }));
    // キャッシュにある、退出の前の参加者の行を、非参加の行として出す
    const cached = await within(screen.getByRole("main")).findByRole("link", {
      name: TITLE,
    });
    expect(cached.closest("li")?.textContent).not.toContain("最終更新");
    expectNoActivityShown();
    await advance(2_100);
    expectNoActivityShown();

    gate.release();
    w.listGate = null;
    const outside = await within(screen.getByRole("main")).findByRole("link", {
      name: TITLE,
    });
    await advance(2_100);
    expect(outside.closest("li")?.textContent).not.toContain("最終更新");
    expectNoActivityShown();
    await expectSidebarWithoutCase();
  });

  it("#148 148-C #308・C-191(4): ほかの参加者に外されて非公開の表示に切り替わった後、S-16 へ移ると、取り直しを保留している間も、一覧・サイドバーにその案件の最終更新・未読が出ない", async () => {
    const w = respondWorld();
    respondUnread({ counts: { [ROOM]: 3 } }).keepCountsOnPut = true;
    const { user } = renderApp("/cases");
    await openFromList(user);

    w.participant = false;
    await advance(2_100);
    expect(await screen.findByText(PRIVATE_TEXT)).toBeTruthy();
    // 概要の画面（非公開の表示）にも、最終更新・未読に由来するものが出ない
    const main = screen.getByRole("main");
    expect(main.textContent).not.toContain("最終更新");
    expect(main.querySelector(`time[datetime="${AT}"]`)).toBeNull();
    expect(within(main).queryByText(/未読 \d+件/)).toBeNull();
    await expectSidebarWithoutCase();

    const gate = deferred();
    w.listGate = gate.promise;
    await user.click(within(await menu()).getByRole("link", { name: "案件" }));
    await screen.findByRole("heading", { level: 1, name: "案件一覧" });
    expectNoActivityShown();
    await expectSidebarWithoutCase();
    await user.click(screen.getByRole("radio", { name: "すべての案件" }));
    expectNoActivityShown();

    gate.release();
    w.listGate = null;
    await within(screen.getByRole("main")).findByRole("link", { name: TITLE });
    expectNoActivityShown();
    await expectSidebarWithoutCase();
  });

  it("#148 148-C 5-1 AC-2: 非参加者の概要の画面（非公開の表示）に、最終更新・未読に由来するものが出ない（対応表に部屋があっても）", async () => {
    const w = respondWorld();
    w.participant = false;
    respondUnread({ counts: { [ROOM]: 3 } });
    renderApp(`/cases/${caseId(N)}`);
    expect(await screen.findByText(PRIVATE_TEXT)).toBeTruthy();
    await advance(2_100);
    const main = screen.getByRole("main");
    expect(main.textContent).not.toContain("最終更新");
    expect(within(main).queryByText(/未読 \d+件/)).toBeNull();
    await expectSidebarWithoutCase();
  });
});

describe("#148 148-C コードレビュー2回目（重大）: 最初の取得の途中の一覧を、後片付けで止めない", () => {
  /** 参加中の一覧の、新しい取得が始まり、その案件を含まない応答が出るまで待つ */
  async function expectSidebarReloaded(w: World, before: number) {
    await waitFor(() => expect(w.joinedRequests).toBeGreaterThan(before));
    const nav = await menu();
    expect(
      await within(nav).findByText("参加中の案件はありません"),
    ).toBeTruthy();
    expect(within(nav).queryByText("案件を読み込み中です")).toBeNull();
  }

  /** 保留していた古い応答（その案件を含む）を返しても、書き戻されない */
  async function releaseStale(w: World) {
    for (const hold of w.joinedHolds.splice(0)) hold.release();
    await advance(2_100);
    await expectSidebarWithoutCase();
    expect(screen.queryByText(/未読 \d+件/)).toBeNull();
    expect(document.querySelector(`time[datetime="${AT}"]`)).toBeNull();
  }

  it("#148 148-C #308: 案件を直接開き、サイドバーの最初の取得の途中でほかの参加者に外されると、サイドバーは読み込み中で止まらず、取り直してその案件を含まない一覧を出す。古い応答は書き戻されない", async () => {
    const w = respondWorld();
    respondUnread({ counts: { [ROOM]: 3 } }).keepCountsOnPut = true;
    w.holdJoined = true;
    renderApp(`/cases/${caseId(N)}`);
    expect(
      await screen.findByRole("heading", { level: 2, name: "やり取り" }),
    ).toBeTruthy();
    expect(within(await menu()).getByText("案件を読み込み中です")).toBeTruthy();
    const before = w.joinedRequests;

    w.holdJoined = false;
    w.participant = false;
    await advance(2_100);
    expect(await screen.findByText(PRIVATE_TEXT)).toBeTruthy();
    await expectSidebarReloaded(w, before);
    await releaseStale(w);
  });

  it("#148 148-C #308: 確かめの途中で S-16 へ移り、S-16 の最初の取得の途中で遅れた結果（外された）が届いても、一覧は読み込み中で止まらず、取り直して正しい一覧を出す", async () => {
    const w = respondWorld();
    respondUnread({ counts: { [ROOM]: 3 } }).keepCountsOnPut = true;
    w.holdJoined = true;
    const { user } = renderApp(`/cases/${caseId(N)}`);
    expect(
      await screen.findByRole("heading", { level: 2, name: "やり取り" }),
    ).toBeTruthy();
    const summaryGate = deferred();
    w.summaryGate = summaryGate.promise;
    w.participant = false;
    await advance(2_100);
    // 確かめ（概要の取り直し）を保留したまま、S-16 へ移る
    await user.click(within(await menu()).getByRole("link", { name: "案件" }));
    await screen.findByRole("heading", { level: 1, name: "案件一覧" });
    const before = w.joinedRequests;

    w.holdJoined = false;
    w.summaryGate = null;
    summaryGate.release();
    await waitFor(() => expect(w.joinedRequests).toBeGreaterThan(before));
    const main = () => screen.getByRole("main");
    expect(
      await within(main()).findByText("参加している案件はありません"),
    ).toBeTruthy();
    expect(within(main()).queryByText("読み込み中です")).toBeNull();
    await expectSidebarReloaded(w, before);
    await releaseStale(w);
    expect(within(main()).queryByRole("link", { name: TITLE })).toBeNull();
  });

  it("#148 148-C 5-1 AC-3: 案件を直接開き、サイドバーの最初の取得の途中で本人が退出しても、S-16・サイドバーは読み込み中で止まらず、取り直してその案件を含まない一覧を出す", async () => {
    const w = respondWorld();
    respondUnread({ counts: { [ROOM]: 3 } }).keepCountsOnPut = true;
    w.holdJoined = true;
    const { user } = renderApp(`/cases/${caseId(N)}`);
    await user.click(
      await screen.findByRole("button", { name: "参加者を管理" }),
    );
    const manager = await screen.findByRole("dialog", { name: "参加者を管理" });
    const selfRow = within(manager)
      .getAllByRole("listitem")
      .find((row) => row.textContent?.includes(SELF.displayName));
    if (selfRow === undefined) throw new Error("本人の行がありません");
    const before = w.joinedRequests;
    w.holdJoined = false;
    await user.click(within(selfRow).getByRole("button", { name: "退出する" }));
    const confirm = await screen.findByRole("dialog", {
      name: "案件からの退出",
    });
    await user.click(within(confirm).getByRole("button", { name: "退出する" }));
    await screen.findByRole("heading", { level: 1, name: "案件一覧" });
    expect(
      await within(screen.getByRole("main")).findByText(
        "参加している案件はありません",
      ),
    ).toBeTruthy();
    await expectSidebarReloaded(w, before);
    await releaseStale(w);
  });
});
