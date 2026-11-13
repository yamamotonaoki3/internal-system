// #237 AC-1（3-1 AC-1・C-169 (1)(4)）：DM の一覧の中身（DmItems。サイドバーの DmSection と、一覧の画面 /dms の DmList で共用）に、DM ごとの未読の件数を出す。
// API は MSW。データは架空。
// 契約（実装者へ。計画「5. 画面」）：
//   各 DM のリンクの中に UnreadCountBadge を置く。件数があれば、リンクの名前は「{相手の表示名} 未読 n件」（100件以上は「未読 99件以上」）、
//   相手が無効なら「{相手の表示名}（退職者） 未読 n件」。未読があれば名前を太字（font-bold）にする。
//   未読 0・取得前・取得の失敗は件数を出さない。DmSection と DmList の両方に出る（DmItems の共用）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  dmItem,
  partnerId,
  partnerName,
  respondDms,
} from "../../test/dm-handlers";
import { respondUnread } from "../../test/unread-handlers";
import { DmList, DmSection } from "./index";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const linkName = (name: string, spoken: string) =>
  new RegExp(`^${escape(name)}\\s+${escape(spoken)}$`);

function renderWith(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const errorText = (element: HTMLElement) =>
  (element.textContent ?? "").includes(
    "未読の件数を取得できません。しばらくすると自動で取り直します",
  );

const sidebar = () =>
  screen.findByRole("navigation", { name: "テスト用サイドバー" });

describe("#237 AC-1（3-1 AC-1）DM の未読の件数", () => {
  it("#237 AC-1: サイドバーの DM の欄に、件数 1・99・100 を「1」「99」「99+」と出し、リンクの名前に「未読 n件」を含める", async () => {
    const one = dmItem(1);
    const many = dmItem(2);
    const over = dmItem(3);
    respondDms({ items: [one, many, over] });
    respondUnread({
      counts: { [one.roomId]: 1, [many.roomId]: 99, [over.roomId]: 100 },
    });
    renderWith(
      <nav aria-label="テスト用サイドバー">
        <DmSection linkClassName={() => ""} />
      </nav>,
    );
    const nav = await sidebar();
    const first = await within(nav).findByRole("link", {
      name: linkName(partnerName(1), "未読 1件"),
    });
    expect(within(first).getByText("1", { exact: true })).toBeDefined();
    const second = within(nav).getByRole("link", {
      name: linkName(partnerName(2), "未読 99件"),
    });
    expect(within(second).getByText("99", { exact: true })).toBeDefined();
    const third = within(nav).getByRole("link", {
      name: linkName(partnerName(3), "未読 99件以上"),
    });
    expect(within(third).getByText("99+", { exact: true })).toBeDefined();
  });

  it("#237 AC-1: 一覧の画面（/dms の DmList）にも同じ件数を出す", async () => {
    const item = dmItem(1);
    respondDms({ items: [item] });
    respondUnread({ counts: { [item.roomId]: 3 } });
    renderWith(<DmList />);
    expect(
      await screen.findByRole("link", {
        name: linkName(partnerName(1), "未読 3件"),
      }),
    ).toBeDefined();
  });

  it("#237 AC-1: 相手が無効な DM は「（退職者）」の後ろに件数を出す", async () => {
    const retired = dmItem(1, {
      partner: {
        id: partnerId(1),
        displayName: partnerName(1),
        isActive: false,
        status: null,
      },
    });
    respondDms({ items: [retired] });
    respondUnread({ counts: { [retired.roomId]: 2 } });
    renderWith(<DmList />);
    expect(
      await screen.findByRole("link", {
        name: linkName(`${partnerName(1)}（退職者）`, "未読 2件"),
      }),
    ).toBeDefined();
  });

  it("#237 AC-1: 未読がある DM は名前を太字にし、未読がない DM は太字にしない", async () => {
    const unread = dmItem(1);
    const read = dmItem(2);
    respondDms({ items: [unread, read] });
    respondUnread({ counts: { [unread.roomId]: 1 } });
    renderWith(<DmList />);
    const unreadLink = await screen.findByRole("link", {
      name: linkName(partnerName(1), "未読 1件"),
    });
    expect(unreadLink.querySelector(".font-bold")?.textContent ?? "").toContain(
      partnerName(1),
    );
    const readLink = screen.getByRole("link", { name: partnerName(2) });
    expect(readLink.querySelector(".font-bold")).toBeNull();
  });

  it("#237 AC-1: 未読の取得に失敗している間は件数を出さず、DM の一覧はそのまま出す", async () => {
    const item = dmItem(1);
    respondDms({ items: [item] });
    const world = respondUnread({ counts: { [item.roomId]: 6 } });
    world.failList = { status: 500, times: 100 };
    renderWith(<DmList />);
    await waitFor(() => expect(world.listRequests.length).toBeGreaterThan(0));
    const link = await screen.findByRole("link", { name: partnerName(1) });
    expect(within(link).queryByText("6")).toBeNull();
  });

  it("#237 AC-1: 未読の取得に失敗している間は role=status で「未読の件数を取得できません。しばらくすると自動で取り直します」を出し（サイドバーも /dms の一覧も）、取得に成功したら消える", async () => {
    const item = dmItem(1);
    respondDms({ items: [item] });
    const world = respondUnread({ counts: { [item.roomId]: 6 } });
    world.failList = { status: 500, times: 100 };
    renderWith(
      <>
        <nav aria-label="テスト用サイドバー">
          <DmSection linkClassName={() => ""} />
        </nav>
        <DmList />
      </>,
    );
    const nav = await sidebar();
    await waitFor(() =>
      expect(within(nav).getAllByRole("status").map(errorText)).toContain(true),
    );
    await waitFor(() =>
      expect(screen.getAllByRole("status").filter(errorText).length).toBe(2),
    );
    expect(screen.queryByText("6")).toBeNull();
    world.failList = { status: 500, times: 0 };
    await waitFor(
      () => {
        expect(screen.queryAllByRole("status").filter(errorText)).toEqual([]);
        expect(
          screen.getAllByRole("link", {
            name: linkName(partnerName(1), "未読 6件"),
          }).length,
        ).toBe(2);
      },
      { timeout: 6000 },
    );
    expect(
      screen.queryByText(
        "未読の件数を取得できません。しばらくすると自動で取り直します",
      ),
    ).toBeNull();
  }, 15000);

  it("#237 AC-1: 未読の取得に成功している間は、取得失敗の表示（role=status）を出さない", async () => {
    const item = dmItem(1);
    respondDms({ items: [item] });
    respondUnread({ counts: { [item.roomId]: 2 } });
    renderWith(<DmList />);
    await screen.findByRole("link", {
      name: linkName(partnerName(1), "未読 2件"),
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
