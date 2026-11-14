// #137 AC-1（1-4 AC-1・AC-3）: DM の画面（S-06。DmView）から S-07 を開く。API は MSW。データは架空。
// 契約（実装前の仮置き。計画 plan-137 の「9. 画面」。実装者へ）：
//   DmView は useThreadParam で URL の ?thread=<親ID> を読み、あれば ThreadPane（S-07）を出し、RoomMessages に onOpenThread を渡す。
//   DM の相手が無効のとき、ThreadPane に retiredAuthorIds=[相手のID] を渡し、相手の返信の表示名に「（退職者）」を併記する。
//   返信できない理由（相手が無効＝partner_inactive）は、サーバーの replyBlockedReason に従って S-07 が出す。
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  dmDetail,
  dmItem,
  dmRoomId,
  partnerId,
  partnerName,
  respondDms,
} from "../../test/dm-handlers";
import {
  message,
  reply,
  respondMessages,
  respondReplies,
} from "../../test/message-handlers";
import { respondThreadReadOnly } from "../../test/thread-handlers";
import { renderInApp, respondSelf } from "../../test/thread-harness";
import { DmView } from "./index";

const ROOM = dmRoomId(1);
const PARENT = message(1, {
  roomId: ROOM,
  body: "[E2E_TEST]DMの親",
  replyCount: 1,
});
const PARTNER_REPLY = reply(PARENT, 1, {
  body: "[E2E_TEST]相手の返信",
  author: { id: partnerId(1), displayName: partnerName(1) },
});

beforeEach(() => {
  respondSelf();
  respondThreadReadOnly();
});

const pane = () => screen.getByRole("region", { name: "スレッド" });

describe("#137 AC-1（1-4 AC-3）S-06 から S-07 を開く", () => {
  it("#137 AC-1: 「返信 n 件」を押すと ?thread=<親ID> が付き、DM の画面のまま S-07 が開いて返信が出る", async () => {
    respondDms({ items: [dmItem(1)], details: [dmDetail(1)] });
    respondMessages([PARENT]);
    respondReplies({ parent: PARENT, replies: [PARTNER_REPLY] });
    const { user } = renderInApp(<DmView roomId={ROOM} />, {
      path: `/dms/${ROOM}`,
    });
    await user.click(await screen.findByRole("button", { name: /^返信 1 件/ }));
    expect(screen.getByTestId("url").textContent).toBe(
      `/dms/${ROOM}?thread=${PARENT.id}`,
    );
    await within(pane()).findByText("[E2E_TEST]相手の返信");
    expect(within(pane()).getByRole("textbox", { name: "返信" })).toBeDefined();
  });

  it("#137 AC-1: 相手が無効（退職者）の DM では、S-07 の相手の返信の表示名に「（退職者）」を併記し、サーバーの理由（partner_inactive）で入力欄を閉じる", async () => {
    respondDms({
      items: [dmItem(1)],
      details: [
        dmDetail(1, {
          partner: { isActive: false, status: null },
          canPost: false,
        }),
      ],
    });
    respondMessages([PARENT]);
    respondReplies({
      parent: PARENT,
      replies: [PARTNER_REPLY],
      replyBlockedReason: "partner_inactive",
      roomWritable: false,
    });
    renderInApp(<DmView roomId={ROOM} />, {
      path: `/dms/${ROOM}?thread=${PARENT.id}`,
    });
    const partnerReply = await within(
      await screen.findByRole("region", { name: "スレッド" }),
    ).findByText("[E2E_TEST]相手の返信");
    expect(partnerReply.closest("li")?.textContent).toContain("（退職者）");
    expect(within(pane()).queryByRole("textbox")).toBeNull();
    expect(
      within(pane()).getByText(
        "相手のアカウントが無効になっているため、返信できません",
      ),
    ).toBeDefined();
  });

  it("#137 AC-1（統括の決定）: ?thread= に別の部屋の親を指定すると「スレッドが見つかりません」を出し、返信の入力欄も既読もない", async () => {
    respondDms({ items: [dmItem(1)], details: [dmDetail(1)] });
    respondMessages([PARENT]);
    const foreign = message(7, {
      roomId: dmRoomId(2),
      body: "[E2E_TEST]別のDMの親",
      replyCount: 1,
    });
    const state = respondReplies({
      parent: foreign,
      replies: [reply(foreign, 7, { author: PARTNER_REPLY.author })],
    });
    const puts = respondThreadReadOnly();
    renderInApp(<DmView roomId={ROOM} />, {
      path: `/dms/${ROOM}?thread=${foreign.id}`,
    });
    await within(
      await screen.findByRole("region", { name: "スレッド" }),
    ).findByText("スレッドが見つかりません");
    expect(within(pane()).queryByRole("textbox")).toBeNull();
    expect(within(pane()).queryByText("[E2E_TEST]別のDMの親")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(state.posts).toEqual([]);
    expect(puts).toEqual([]);
  });

  it("#137 AC-1（1-4 AC-3）: スレッドを開いても押した「返信」ボタンの要素は同じ要素のまま、閉じるとフォーカスがその要素に戻る", async () => {
    const fresh = message(5, {
      roomId: ROOM,
      body: "[E2E_TEST]返信がまだないDMの親",
      replyCount: 0,
    });
    respondDms({ items: [dmItem(1)], details: [dmDetail(1)] });
    respondMessages([fresh]);
    respondReplies({ parent: fresh, replies: [] });
    const { user } = renderInApp(<DmView roomId={ROOM} />, {
      path: `/dms/${ROOM}`,
    });
    const opener = await screen.findByRole("button", {
      name: /テスト太郎の投稿に返信する/,
    });
    await user.click(opener);
    await within(pane()).findByText("まだ返信はありません");
    expect(opener.isConnected).toBe(true);
    await user.click(
      within(pane()).getByRole("button", { name: "スレッドを閉じる" }),
    );
    expect(document.activeElement).toBe(opener);
  });

  it("#137 AC-4（1-4 AC-4）: DM×親が削除済み×相手が無効（deleted_parent・joined 真・roomWritable 偽）では、自分の返信に「編集」「削除」を出さず、既読は送る", async () => {
    respondDms({
      items: [dmItem(1)],
      details: [
        dmDetail(1, {
          partner: { isActive: false, status: null },
          canPost: false,
        }),
      ],
    });
    respondMessages([{ ...PARENT, deleted: true, body: null }]);
    const mine = reply(PARENT, 2, {
      body: "[E2E_TEST]自分のDMの返信",
      author: { id: "01JTESTUSER000000000000001", displayName: "testuser_001" },
    });
    respondReplies({
      parent: { ...PARENT, deleted: true, body: null },
      replies: [PARTNER_REPLY, mine],
      replyBlockedReason: "deleted_parent",
      joined: true,
      roomWritable: false,
    });
    const puts = respondThreadReadOnly();
    renderInApp(<DmView roomId={ROOM} />, {
      path: `/dms/${ROOM}?thread=${PARENT.id}`,
    });
    await within(
      await screen.findByRole("region", { name: "スレッド" }),
    ).findByText("[E2E_TEST]自分のDMの返信");
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.lastReadMessageId).toBe(mine.id);
    expect(within(pane()).queryByRole("button", { name: "編集" })).toBeNull();
    expect(within(pane()).queryByRole("button", { name: "削除" })).toBeNull();
  });
});
