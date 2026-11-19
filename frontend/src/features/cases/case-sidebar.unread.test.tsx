// #148（148-C）C-184(1)「サイドバーの案件の未読の印」・5-1 AC-4 の残り：サイドバーの「案件」の下の参加中の案件（CaseSidebarSection）に、
// 案件ごとの未読の数を出す。API は MSW。データはすべて架空（testuser_・[UNIT_TEST]）。
// この層で確かめるもの（計画 148-C のテストケース「サイドバー」）：未読ありの項目に数（99+）、なしは出ない、取得の失敗で数を出さず項目は出す、
//   読み込み中・案件の取得の失敗の既存の表示を壊さない、ポーリングで数が変わる。
// 画面の契約（実装の担当へ。テストが決めたもの。チャンネルの欄 JoinedChannelsSection と同じ表現）：
//   各案件のリンクの中身を features/unread の RoomLinkLabel にし、件数は useUnreadCounts の対応表を channelId で引く。
//   未読があれば、リンクの名前は「{件名} 未読 n件」（100件以上は「未読 99件以上」）、見える印は 1〜99 か「99+」、件名を太字（font-bold）。
//   未読 0・取得前・取得の失敗は件数を出さず、リンクの名前は件名のまま。
import { act, screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  caseRoomId,
  caseSummary,
  caseTitle,
  respondCases,
} from "../../test/case-handlers";
import { renderCaseRequestScreen } from "../../test/case-request-handlers";
import { server } from "../../test/server";
import { respondUnread } from "../../test/unread-handlers";
import { CaseSidebarSection } from "./index";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const linkName = (name: string, spoken: string) =>
  new RegExp(`^${escape(name)}\\s+${escape(spoken)}$`);

function renderSection() {
  renderCaseRequestScreen(
    <nav aria-label="テスト用サイドバー">
      <CaseSidebarSection linkClassName={() => ""} />
    </nav>,
    { at: "/", path: "/" },
  );
  return screen.findByRole("navigation", { name: "テスト用サイドバー" });
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

describe("#148 148-C C-184(1) サイドバーの案件の未読の印", () => {
  it("#148 148-C C-184(1): 件数 1・99・100 は「1」「99」「99+」と出し、リンクの名前は「… 未読 1件」「… 未読 99件」「… 未読 99件以上」", async () => {
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
    const nav = await renderSection();
    const one = await within(nav).findByRole("link", {
      name: linkName(caseTitle(1), "未読 1件"),
    });
    const two = within(nav).getByRole("link", {
      name: linkName(caseTitle(2), "未読 99件"),
    });
    const three = within(nav).getByRole("link", {
      name: linkName(caseTitle(3), "未読 99件以上"),
    });
    expect(within(one).getByText("1", { exact: true })).toBeTruthy();
    expect(within(two).getByText("99", { exact: true })).toBeTruthy();
    expect(within(three).getByText("99+", { exact: true })).toBeTruthy();
  });

  it("#148 148-C C-184(1): 未読がある案件は件名を太字にし、未読がない案件はリンクの名前が件名のままで、印を出さない", async () => {
    respondCases({
      lists: { "joined:active": [caseSummary(1), caseSummary(2)] },
    });
    respondUnread({ counts: { [caseRoomId(1)]: 2 } });
    const nav = await renderSection();
    const one = await within(nav).findByRole("link", {
      name: linkName(caseTitle(1), "未読 2件"),
    });
    expect(within(one).getByText(caseTitle(1)).className).toContain(
      "font-bold",
    );
    const two = within(nav).getByRole("link", { name: caseTitle(2) });
    expect(two.textContent).toBe(caseTitle(2));
    expect(two.querySelector(".font-bold")).toBeNull();
  });

  it("#148 148-C 計画「未読の取得の失敗」: 未読の取得に失敗している間は数を出さず、案件の項目は出す", async () => {
    respondCases({ lists: { "joined:active": [caseSummary(1)] } });
    const world = respondUnread({ counts: { [caseRoomId(1)]: 4 } });
    world.failList = { status: 500, times: 100 };
    const nav = await renderSection();
    const link = await within(nav).findByRole("link", { name: caseTitle(1) });
    await waitFor(() => expect(world.listRequests.length).toBeGreaterThan(0));
    await advance(2_100);
    expect(link.textContent).toBe(caseTitle(1));
    expect(within(nav).queryByText(/未読 \d+件/)).toBeNull();
  });

  it("#148 148-C 計画「未読」: ほかの参加者の投稿で増えた未読は、サイドバーを取り直さずに、ポーリング（2秒ごと）で出る", async () => {
    const { queries } = respondCases({
      lists: { "joined:active": [caseSummary(1)] },
    });
    const world = respondUnread();
    const nav = await renderSection();
    await within(nav).findByRole("link", { name: caseTitle(1) });
    await waitFor(() => expect(world.listRequests.length).toBeGreaterThan(0));
    const listCalls = queries.length;
    world.counts.set(caseRoomId(1), 3);
    await advance(2_100);
    expect(
      await within(nav).findByRole("link", {
        name: linkName(caseTitle(1), "未読 3件"),
      }),
    ).toBeTruthy();
    expect(queries.length).toBe(listCalls);
  });

  it("#148 148-C（退行なし）: 案件の読み込み中は「案件を読み込み中です」を出し、未読があっても数を出さない", async () => {
    server.use(
      http.get("/api/cases", async () => {
        await delay("infinite");
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    respondUnread({ counts: { [caseRoomId(1)]: 2 } });
    const nav = await renderSection();
    expect(await within(nav).findByText("案件を読み込み中です")).toBeTruthy();
    expect(within(nav).queryByText(/未読 \d+件/)).toBeNull();
  });
});
