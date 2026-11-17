// #143-a a-AC-5（3-4 AC-5・C-124(6)・重大3・D-R1）: 過去の通知を開いたときの「アーカイブされました」を、通知の一覧（S-14。NotificationList）で確かめる。
// API は MSW（test/notification-handlers.ts）。データは架空。
// 期待値は計画 #143-a「画面」の「過去の通知を開いたときの『アーカイブされました』」から決める：
//   roomArchived が真の行は、文言の後に「（アーカイブされました）」を出し、押すとチャンネルへ移らずに「このチャンネルはアーカイブされました」をその場に出す。
//   channel.archived は（roomArchived によらず）常にこの扱い。roomArchived が偽の、移動先のある通知は、今までどおり移動する。
//   理由はテキストとして出す（HTML として解釈しない）。
// 契約（実装前。報告に明記）：通知の一覧の各行に reason（string | null）と roomArchived（boolean）が足される。
//   押したときは、未読なら既読にする（既存の「開く」と同じ）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import {
  notification,
  respondNotifications,
  type TestNotification,
} from "../../test/notification-handlers";
import { NotificationList } from "./index";

const ROOM_ID = "01JTESTCHARCHLISTROOM00001";
const ARCHIVED_LABEL = "参加しているチャンネルがアーカイブされました";
const ARCHIVED_NOTE = "このチャンネルはアーカイブされました";

type ArchiveAware = TestNotification & {
  reason: string | null;
  roomArchived: boolean;
};

const archiveAware = (
  n: number,
  kind: string,
  extra: { reason?: string | null; roomArchived: boolean },
): ArchiveAware => ({
  ...notification(n, { kind, roomId: ROOM_ID }),
  reason: extra.reason ?? null,
  roomArchived: extra.roomArchived,
});

function CurrentPath() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/notifications"]}>
        <NotificationList />
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, view };
}

const currentPath = () => screen.getByTestId("path").textContent;

async function itemOf(label: string) {
  const items = await screen.findAllByRole("listitem");
  const found = items.find((item) => item.textContent?.includes(label));
  if (found === undefined) throw new Error(`通知「${label}」がありません`);
  return found;
}

describe("#143 a-AC-5（3-4 AC-5）過去の通知の「アーカイブされました」", () => {
  it("#143 a-AC-5: アーカイブの通知は理由つきの文言と「（アーカイブされました）」を出し、押しても移らずに「このチャンネルはアーカイブされました」を出す", async () => {
    const items: ArchiveAware[] = [
      archiveAware(1, "channel.archived", {
        reason: "統合のため",
        roomArchived: true,
      }),
    ];
    const world = respondNotifications({ items });
    const { user } = renderList();
    const row = await itemOf(`${ARCHIVED_LABEL}（理由：統合のため）`);
    expect(row.textContent).toContain("（アーカイブされました）");
    await user.click(within(row).getByRole("button", { name: /アーカイブ/ }));
    expect(await screen.findByText(ARCHIVED_NOTE)).toBeDefined();
    expect(currentPath()).toBe("/notifications");
    await waitFor(() => expect(world.readPosts).toEqual([items[0]?.id]));
  });

  it("#143 a-AC-5（重大3）: 申請の承認の通知も、チャンネルがアーカイブ中（roomArchived が真）なら移らずに「このチャンネルはアーカイブされました」を出す", async () => {
    const items: ArchiveAware[] = [
      archiveAware(2, "channel_request.approved", { roomArchived: true }),
    ];
    respondNotifications({ items });
    const { user } = renderList();
    const row = await itemOf("チャンネルの作成の申請が承認されました");
    expect(row.textContent).toContain("（アーカイブされました）");
    await user.click(within(row).getByRole("button"));
    expect(await screen.findByText(ARCHIVED_NOTE)).toBeDefined();
    expect(currentPath()).toBe("/notifications");
  });

  it("#143 a-AC-5: アーカイブ中でない（roomArchived が偽）申請の承認の通知は、今までどおりチャンネルへ移り、「（アーカイブされました）」を出さない", async () => {
    const items: ArchiveAware[] = [
      archiveAware(3, "channel_request.approved", { roomArchived: false }),
    ];
    respondNotifications({ items });
    const { user } = renderList();
    const row = await itemOf("チャンネルの作成の申請が承認されました");
    expect(row.textContent).not.toContain("（アーカイブされました）");
    await user.click(within(row).getByRole("button"));
    await waitFor(() => expect(currentPath()).toBe(`/channels/${ROOM_ID}`));
  });

  it("#143 a-AC-5: 復元の通知（roomArchived が偽）は、押すとチャンネルへ移る", async () => {
    const items: ArchiveAware[] = [
      archiveAware(4, "channel.restored", { roomArchived: false }),
    ];
    respondNotifications({ items });
    const { user } = renderList();
    const row = await itemOf("参加しているチャンネルが復元されました");
    await user.click(within(row).getByRole("button"));
    await waitFor(() => expect(currentPath()).toBe(`/channels/${ROOM_ID}`));
  });

  it("#143 a-AC-5（security）: 理由は文字として出し、HTML として解釈しない", async () => {
    const items: ArchiveAware[] = [
      archiveAware(5, "channel.archived", {
        reason: "<b>太字</b><img src=x>",
        roomArchived: true,
      }),
    ];
    respondNotifications({ items });
    const { view } = renderList();
    const row = await itemOf("<b>太字</b><img src=x>");
    expect(row.textContent).toContain("（理由：<b>太字</b><img src=x>）");
    expect(view.container.querySelector("b")).toBeNull();
    expect(view.container.querySelector("img")).toBeNull();
  });
});
