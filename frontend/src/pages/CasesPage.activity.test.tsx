// #148（148-C）5-1 AC-4 の残り・5-1 AC-2・C-191(4)、画面 S-16：案件の一覧の参加の行に「最終更新」と「未読」を出す。API は MSW。データはすべて架空。
// この層で確かめるもの（計画 148-C のテストケース「S-16」）：参加の行の最終更新（日時・なければ「—」）と未読の数（未読の対応表を channelId で引く。99+）、
//   非参加の行には最終更新・未読を出さない（C-191(4)「有効な参加者にだけ出す」・S-16 のワイヤー）、未読の取得の失敗で数を出さず一覧は出す、
//   未読はポーリング（2秒ごと）で一覧を取り直さずに変わる。
// 値を返す範囲（有効な参加者だけ）はサーバー（backend の db/case.repository.activity.db.test.ts）で確かめ、ここでは重ねない。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//   参加の行（isParticipant が真）のカードに「最終更新：」と、<time dateTime={lastActivityAt}>（表示は features/messages の formatMessageTime と同じ
//   ja-JP の短い形式）。lastActivityAt が null なら「最終更新：—」。
//   未読は features/unread の UnreadCountBadge（見える印は 1〜99・「99+」、読み上げは「未読 n件」「未読 99件以上」）を、件名のリンクの外に置く
//   （件名のリンクの名前は件名のまま。既存の E2E の exact の一致を保つ）。0件・取得前・取得の失敗は何も出さない。
//   非参加の行（isParticipant が偽。lastActivityAt・channelId が null）には、「最終更新」も未読も出さない。
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  caseRoomId,
  caseSummary,
  caseTitle,
  outsiderSummary,
  respondCases,
} from "../test/case-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import { respondUnread } from "../test/unread-handlers";
import { CasesPage } from "./CasesPage";

const AT_1 = "2026-11-19T01:05:00.000Z";
const AT_2 = "2026-11-18T08:30:00.000Z";

/** 期待する日時の表示（ja-JP の短い形式。実装の関数を使わずに、ここで同じ形を作る） */
const shown = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
  });

function renderPage() {
  return renderCaseRequestScreen(<CasesPage />, {
    at: "/cases",
    path: "/cases",
  });
}

async function findCard(title: string) {
  const link = await screen.findByRole("link", { name: title });
  const card = link.closest("li");
  if (card === null) throw new Error(`${title} のカードがありません`);
  return card;
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("#148 148-C S-16 最終更新", () => {
  it("#148 148-C 5-1 AC-4・C-191(4): 参加の行に「最終更新：」と日時（time 要素。dateTime は lastActivityAt）を出す", async () => {
    respondCases({
      lists: { "joined:active": [caseSummary(1, { lastActivityAt: AT_1 })] },
    });
    respondUnread();
    renderPage();
    const card = await findCard(caseTitle(1));
    expect(within(card).getByText(/最終更新：/)).toBeTruthy();
    const time = card.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe(AT_1);
    expect(time?.textContent).toBe(shown(AT_1));
  });

  it("#148 148-C C-191(4): メッセージのない参加の行（lastActivityAt が null）は「最終更新：—」で、日時を出さない", async () => {
    respondCases({
      lists: { "joined:active": [caseSummary(1, { lastActivityAt: null })] },
    });
    respondUnread();
    renderPage();
    const card = await findCard(caseTitle(1));
    expect(within(card).getByText("最終更新：—")).toBeTruthy();
    expect(card.querySelector("time")).toBeNull();
  });

  it("#148 148-C 5-1 AC-2・C-191(4): 非参加の行（すべての案件）には「最終更新」を出さない。参加の行には出す", async () => {
    respondCases({
      lists: {
        "joined:active": [],
        "all:active": [
          caseSummary(1, { lastActivityAt: AT_1 }),
          outsiderSummary(2),
        ],
      },
    });
    respondUnread();
    const { user } = renderPage();
    await screen.findByText("参加している案件はありません");
    await user.click(screen.getByRole("radio", { name: "すべての案件" }));
    const joined = await findCard(caseTitle(1));
    const outside = await findCard(caseTitle(2));
    expect(within(joined).getByText(/最終更新：/)).toBeTruthy();
    expect(outside.textContent).not.toContain("最終更新");
    expect(outside.querySelector("time")).toBeNull();
  });

  it("#148 148-C: 終了した案件の参加の行にも、最終更新を出す", async () => {
    respondCases({
      lists: {
        "joined:active": [],
        "joined:closed": [
          caseSummary(3, { status: "closed", lastActivityAt: AT_2 }),
        ],
      },
    });
    respondUnread();
    const { user } = renderPage();
    await screen.findByText("参加している案件はありません");
    await user.click(screen.getByRole("radio", { name: "終了した案件" }));
    const card = await findCard(caseTitle(3));
    expect(card.querySelector("time")?.getAttribute("datetime")).toBe(AT_2);
  });
});

describe("#148 148-C S-16 未読", () => {
  it("#148 148-C 5-1 AC-4: 参加の行に、channelId で引いた未読の数を出す（1・99・100 は「1」「99」「99+」、読み上げは「未読 n件」「未読 99件以上」）", async () => {
    respondCases({
      lists: {
        "joined:active": [caseSummary(1), caseSummary(2), caseSummary(3)],
      },
    });
    respondUnread({
      counts: {
        [caseRoomId(1)]: 1,
        [caseRoomId(2)]: 99,
        [caseRoomId(3)]: 100,
      },
    });
    renderPage();
    const one = await findCard(caseTitle(1));
    await waitFor(() => expect(within(one).getByText("未読 1件")).toBeTruthy());
    expect(within(one).getByText("1", { exact: true })).toBeTruthy();
    const ninetyNine = await findCard(caseTitle(2));
    expect(within(ninetyNine).getByText("未読 99件")).toBeTruthy();
    expect(within(ninetyNine).getByText("99", { exact: true })).toBeTruthy();
    const many = await findCard(caseTitle(3));
    expect(within(many).getByText("未読 99件以上")).toBeTruthy();
    expect(within(many).getByText("99+", { exact: true })).toBeTruthy();
  });

  it("#148 148-C: 件名のリンクの名前は件名のまま（未読の数をリンクの中に入れない）", async () => {
    respondCases({ lists: { "joined:active": [caseSummary(1)] } });
    respondUnread({ counts: { [caseRoomId(1)]: 3 } });
    renderPage();
    const card = await findCard(caseTitle(1));
    await waitFor(() =>
      expect(within(card).getByText("未読 3件")).toBeTruthy(),
    );
    expect(within(card).getByRole("link", { name: caseTitle(1) })).toBeTruthy();
  });

  it("#148 148-C: 未読が 0 の参加の行には、未読の印を出さない", async () => {
    respondCases({
      lists: { "joined:active": [caseSummary(1), caseSummary(2)] },
    });
    const world = respondUnread({ counts: { [caseRoomId(1)]: 2 } });
    renderPage();
    const one = await findCard(caseTitle(1));
    await waitFor(() => expect(within(one).getByText("未読 2件")).toBeTruthy());
    expect(world.listRequests.length).toBeGreaterThan(0);
    const two = await findCard(caseTitle(2));
    expect(two.textContent).not.toContain("未読");
  });

  it("#148 148-C 5-1 AC-2: 非参加の行（channelId が null）には、未読の印を出さない", async () => {
    respondCases({
      lists: {
        "joined:active": [],
        "all:active": [outsiderSummary(2)],
      },
    });
    // 部屋の ID を知らないので引けない（仮に対応表に案件の部屋があっても出さない）
    respondUnread({ counts: { [caseRoomId(2)]: 5 } });
    const { user } = renderPage();
    await screen.findByText("参加している案件はありません");
    await user.click(screen.getByRole("radio", { name: "すべての案件" }));
    const card = await findCard(caseTitle(2));
    await advance(2_100);
    expect(card.textContent).not.toContain("未読");
  });

  it("#148 148-C 計画「未読の取得の失敗」: 未読の取得に失敗している間は数を出さず、一覧（件名・最終更新）は出す", async () => {
    respondCases({
      lists: { "joined:active": [caseSummary(1, { lastActivityAt: AT_1 })] },
    });
    const world = respondUnread({ counts: { [caseRoomId(1)]: 4 } });
    world.failList = { status: 500, times: 100 };
    renderPage();
    const card = await findCard(caseTitle(1));
    await waitFor(() => expect(world.listRequests.length).toBeGreaterThan(0));
    expect(card.textContent).not.toContain("未読");
    expect(card.querySelector("time")?.getAttribute("datetime")).toBe(AT_1);
  });

  it("#148 148-C 計画「未読」: 未読の数は、一覧を取り直さずに、未読のポーリング（2秒ごと）で変わる", async () => {
    const { queries } = respondCases({
      lists: { "joined:active": [caseSummary(1)] },
    });
    const world = respondUnread();
    renderPage();
    const card = await findCard(caseTitle(1));
    await waitFor(() => expect(world.listRequests.length).toBeGreaterThan(0));
    expect(card.textContent).not.toContain("未読");
    const listCalls = queries.length;
    world.counts.set(caseRoomId(1), 2);
    await advance(2_100);
    await waitFor(() =>
      expect(within(card).getByText("未読 2件")).toBeTruthy(),
    );
    expect(queries.length).toBe(listCalls);
  });
});
