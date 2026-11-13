// #237 AC-1（3-1 AC-1・C-169 (1)(4)）：サイドバーの「参加中のチャンネル」（JoinedChannelsSection）に、チャンネルごとの未読の件数を出す。API は MSW。データは架空。
// 契約（実装者へ。計画「5. 画面」）：
//   各チャンネルのリンクの中に UnreadCountBadge を置く。件数があれば、リンクの名前は「{チャンネル名} 未読 n件」（100件以上は「未読 99件以上」）、
//   見える印は 1〜99 の数字か「99+」。未読があれば名前を太字（font-bold のクラス。固定のクラスから選ぶ）にする。
//   未読 0・未読の取得前・取得の失敗は件数を出さず、リンクの名前はチャンネル名のまま（誤った件数を出さない）。チャンネルの一覧の表示は壊さない。
//   件数は useUnreadCounts（GET /api/me/unread を 2 秒ごと）から roomId で引く。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channelItem, respondChannels } from "../../test/channel-handlers";
import { respondUnread } from "../../test/unread-handlers";
import { JoinedChannelsSection } from "./index";

const ALPHA = channelItem("1", {
  name: "[E2E_TEST]未読アルファ",
  joined: true,
});
const BETA = channelItem("2", { name: "[E2E_TEST]未読ベータ", joined: true });
const GAMMA = channelItem("3", { name: "[E2E_TEST]未読ガンマ", joined: true });

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const linkName = (name: string, spoken: string) =>
  new RegExp(`^${escape(name)}\\s+${escape(spoken)}$`);

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <nav aria-label="テスト用サイドバー">
          <JoinedChannelsSection linkClassName={() => ""} />
        </nav>
      </MemoryRouter>
    </QueryClientProvider>,
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

describe("#237 AC-1（3-1 AC-1）サイドバーの参加中のチャンネルの未読の件数", () => {
  it("#237 AC-1: 件数 1・99・100 は「1」「99」「99+」と出し、リンクの名前は「… 未読 1件」「… 未読 99件」「… 未読 99件以上」", async () => {
    respondChannels([ALPHA, BETA, GAMMA]);
    respondUnread({
      counts: { [ALPHA.roomId]: 1, [BETA.roomId]: 99, [GAMMA.roomId]: 100 },
    });
    const nav = await renderSection();
    const alpha = await within(nav).findByRole("link", {
      name: linkName(ALPHA.name, "未読 1件"),
    });
    const beta = within(nav).getByRole("link", {
      name: linkName(BETA.name, "未読 99件"),
    });
    const gamma = within(nav).getByRole("link", {
      name: linkName(GAMMA.name, "未読 99件以上"),
    });
    expect(within(alpha).getByText("1", { exact: true })).toBeDefined();
    expect(within(beta).getByText("99", { exact: true })).toBeDefined();
    expect(within(gamma).getByText("99+", { exact: true })).toBeDefined();
  });

  it("#237 AC-1: 未読があるチャンネルは名前を太字にし、未読がないチャンネルは太字にしない（色だけに頼らない）", async () => {
    respondChannels([ALPHA, BETA]);
    respondUnread({ counts: { [ALPHA.roomId]: 2 } });
    const nav = await renderSection();
    const alpha = await within(nav).findByRole("link", {
      name: linkName(ALPHA.name, "未読 2件"),
    });
    const beta = within(nav).getByRole("link", { name: BETA.name });
    expect(alpha.querySelector(".font-bold")?.textContent ?? "").toContain(
      ALPHA.name,
    );
    expect(beta.querySelector(".font-bold")).toBeNull();
    expect(beta.classList.contains("font-bold")).toBe(false);
  });

  it("#237 AC-1: 未読 0 のチャンネルは件数を出さず、リンクの名前はチャンネル名のまま", async () => {
    respondChannels([ALPHA]);
    const world = respondUnread({ counts: { [ALPHA.roomId]: 0 } });
    const nav = await renderSection();
    await waitFor(() => expect(world.listRequests.length).toBeGreaterThan(0));
    const link = await within(nav).findByRole("link", { name: ALPHA.name });
    expect(link.textContent).toBe(ALPHA.name);
  });

  it("#237 AC-1: 未読の取得に失敗している間は件数を出さず、チャンネルの一覧はそのまま出す", async () => {
    respondChannels([ALPHA]);
    const world = respondUnread({ counts: { [ALPHA.roomId]: 5 } });
    world.failList = { status: 500, times: 100 };
    const nav = await renderSection();
    await waitFor(() => expect(world.listRequests.length).toBeGreaterThan(0));
    const link = await within(nav).findByRole("link", { name: ALPHA.name });
    expect(link.textContent).toBe(ALPHA.name);
    expect(within(nav).queryByText("5")).toBeNull();
  });

  it("#237 AC-1: 未読の取得に失敗している間は role=status で「未読の件数を取得できません。しばらくすると自動で取り直します」を出し、取得に成功したら消える", async () => {
    respondChannels([ALPHA]);
    const world = respondUnread({ counts: { [ALPHA.roomId]: 5 } });
    world.failList = { status: 500, times: 100 };
    const nav = await renderSection();
    const status = await within(nav).findByRole("status");
    expect(status.textContent).toContain(
      "未読の件数を取得できません。しばらくすると自動で取り直します",
    );
    expect(within(nav).queryByText("5")).toBeNull();
    world.failList = { status: 500, times: 0 };
    await advance(2500);
    await within(nav).findByRole("link", {
      name: linkName(ALPHA.name, "未読 5件"),
    });
    expect(within(nav).queryByRole("status")).toBeNull();
    expect(
      within(nav).queryByText(
        "未読の件数を取得できません。しばらくすると自動で取り直します",
      ),
    ).toBeNull();
  });

  it("#237 AC-1: 未読の取得に成功している間は、取得失敗の表示（role=status）を出さない", async () => {
    respondChannels([ALPHA]);
    const world = respondUnread({ counts: { [ALPHA.roomId]: 2 } });
    const nav = await renderSection();
    await within(nav).findByRole("link", {
      name: linkName(ALPHA.name, "未読 2件"),
    });
    expect(world.listRequests.length).toBeGreaterThan(0);
    expect(within(nav).queryByRole("status")).toBeNull();
  });

  it("#237 AC-1・AC-2: 2秒ごとの取り直しで、件数が再読み込みなしで増え、既読（サーバーで 0）になると消える", async () => {
    respondChannels([ALPHA]);
    const world = respondUnread({ counts: { [ALPHA.roomId]: 1 } });
    const nav = await renderSection();
    await within(nav).findByRole("link", {
      name: linkName(ALPHA.name, "未読 1件"),
    });
    world.counts.set(ALPHA.roomId, 4);
    await advance(2500);
    await within(nav).findByRole("link", {
      name: linkName(ALPHA.name, "未読 4件"),
    });
    world.counts.delete(ALPHA.roomId);
    await advance(2500);
    await within(nav).findByRole("link", { name: ALPHA.name });
  });

  it("#237 AC-1（C-94）: 一覧にない部屋（未参加の公開など）の件数は、サイドバーに出さない", async () => {
    respondChannels([ALPHA]);
    respondUnread({ counts: { "01JTESTXNREADNJ0000000000X": 7 } });
    const nav = await renderSection();
    await within(nav).findByRole("link", { name: ALPHA.name });
    expect(within(nav).queryByText("7")).toBeNull();
  });
});
