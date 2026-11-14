// #137 AC-1（1-4 AC-1・AC-3）: チャンネルの詳細（S-05。ChannelDetailView）から S-07 を開く。API は MSW。データは架空。
// 契約（実装前の仮置き。計画 plan-137 の「9. 画面」。実装者へ）：
//   ChannelDetailView は useThreadParam（features/threads）で URL の ?thread=<親ID> を読み、あれば ThreadPane（S-07）を、チャンネルの本体の隣（同じ画面の中）に出す。
//   RoomMessages に onOpenThread（useThreadParam の open）を渡し、各メッセージに「返信 n 件」のボタンを出す。参加していない公開チャンネルにも出す（読める。返信は理由 not_joined で閉じる）。
//   スレッドの既読は、S-07 が送る（参加している場合だけ）。部屋の既読（PUT /api/rooms/:roomId/read-position）は今までどおり。
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import {
  OTHER_AUTHOR,
  message,
  reply,
  respondMessages,
  respondReplies,
} from "../../test/message-handlers";
import { server } from "../../test/server";
import { respondThreadReadOnly } from "../../test/thread-handlers";
import { renderInApp, respondSelf } from "../../test/thread-harness";
import { ChannelDetailView } from "./index";

const ID = "01JTESTROOM00000000000R001";
const PARENT = message(1, {
  body: "[E2E_TEST]チャンネルの親",
  replyCount: 1,
});
const REPLY = reply(PARENT, 1, {
  body: "[E2E_TEST]チャンネルの返信",
  author: OTHER_AUTHOR,
});

function respondDetail(joined: boolean) {
  server.use(
    http.get("/api/channels/:channelId", () =>
      HttpResponse.json({
        id: ID,
        roomId: ID,
        name: "[E2E_TEST]スレッドのチャンネル",
        description: "",
        visibility: "public",
        departmentId: null,
        isCaseChannel: false,
        readOnly: false,
        joined,
        canPost: joined,
        ...(joined
          ? {
              memberCount: 1,
              members: [
                { id: "01JTESTUSER000000000000001", displayName: "テスト太郎" },
              ],
            }
          : {}),
      }),
    ),
  );
}

beforeEach(() => {
  respondSelf();
});

const pane = () => screen.getByRole("region", { name: "スレッド" });

describe("#137 AC-1（1-4 AC-3）S-05 から S-07 を開く", () => {
  it("#137 AC-1: スレッドを開いていない（?thread= なし）ときは、S-07 を出さない", async () => {
    respondDetail(true);
    respondMessages([PARENT]);
    renderInApp(<ChannelDetailView channelId={ID} />, {
      path: `/channels/${ID}`,
    });
    await screen.findByText("[E2E_TEST]チャンネルの親");
    expect(screen.queryByRole("region", { name: "スレッド" })).toBeNull();
  });

  it("#137 AC-1: 「返信 n 件」を押すと、?thread=<親ID> が付き、チャンネルの画面のまま S-07 が開き、返信が出る", async () => {
    respondDetail(true);
    respondMessages([PARENT]);
    respondReplies({ parent: PARENT, replies: [REPLY] });
    const puts = respondThreadReadOnly();
    const { user } = renderInApp(<ChannelDetailView channelId={ID} />, {
      path: `/channels/${ID}`,
    });
    await user.click(
      await screen.findByRole("button", { name: /^返信 1 件.*テスト太郎/ }),
    );
    expect(screen.getByTestId("url").textContent).toBe(
      `/channels/${ID}?thread=${PARENT.id}`,
    );
    await within(pane()).findByText("[E2E_TEST]チャンネルの返信");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "[E2E_TEST]スレッドのチャンネル",
      }),
    ).toBeDefined();
    // 参加者として開いたので、スレッドの既読が送られる
    await within(pane()).findByRole("textbox", { name: "返信" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(puts).toEqual([
      { parentMessageId: PARENT.id, lastReadMessageId: REPLY.id },
    ]);
  });

  it("#137 AC-1: ?thread=<親ID> のあるアドレスを開くと、最初から S-07 が開く", async () => {
    respondDetail(true);
    respondMessages([PARENT]);
    respondReplies({ parent: PARENT, replies: [REPLY] });
    respondThreadReadOnly();
    renderInApp(<ChannelDetailView channelId={ID} />, {
      path: `/channels/${ID}?thread=${PARENT.id}`,
    });
    await within(
      await screen.findByRole("region", { name: "スレッド" }),
    ).findByText("[E2E_TEST]チャンネルの返信");
  });

  it("#137 AC-1（1-1 AC-2・C-94）: 参加していない公開チャンネルでも、スレッドを読める。返信の入力欄は出さず、既読も送らない", async () => {
    respondDetail(false);
    respondMessages([PARENT]);
    respondReplies({
      parent: PARENT,
      replies: [REPLY],
      replyBlockedReason: "not_joined",
      joined: false,
      roomWritable: false,
    });
    const puts = respondThreadReadOnly();
    const { user } = renderInApp(<ChannelDetailView channelId={ID} />, {
      path: `/channels/${ID}`,
    });
    await user.click(await screen.findByRole("button", { name: /^返信 1 件/ }));
    await within(pane()).findByText("[E2E_TEST]チャンネルの返信");
    expect(within(pane()).queryByRole("textbox")).toBeNull();
    expect(
      within(pane()).getByText("このチャンネルに参加すると、返信できます"),
    ).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(puts).toEqual([]);
  });

  it("#137 AC-1（統括の決定）: ?thread= に別の部屋の親を指定すると、その部屋のスレッドとして開かず「スレッドが見つかりません」を出し、返信の入力欄も既読もない", async () => {
    respondDetail(true);
    respondMessages([PARENT]);
    const foreign = message(7, {
      roomId: "01JTESTROOM00000000000R999",
      body: "[E2E_TEST]別の部屋の親",
      replyCount: 1,
    });
    const state = respondReplies({
      parent: foreign,
      replies: [reply(foreign, 7, { author: OTHER_AUTHOR })],
    });
    const puts = respondThreadReadOnly();
    renderInApp(<ChannelDetailView channelId={ID} />, {
      path: `/channels/${ID}?thread=${foreign.id}`,
    });
    await within(
      await screen.findByRole("region", { name: "スレッド" }),
    ).findByText("スレッドが見つかりません");
    expect(within(pane()).queryByRole("textbox")).toBeNull();
    expect(within(pane()).queryByText("[E2E_TEST]別の部屋の親")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(state.posts).toEqual([]);
    expect(puts).toEqual([]);
  });

  describe("開閉で部屋の本体を作り直さない（E2E ① の原因を jsdom で捕まえる）", () => {
    const FRESH = message(1, {
      body: "[E2E_TEST]返信がまだない親",
      replyCount: 0,
    });

    it("#137 AC-1（1-4 AC-3）: スレッドを開いても、押した「返信」ボタンの要素は同じ要素のまま（切り離されない）", async () => {
      respondDetail(true);
      respondMessages([FRESH]);
      respondReplies({ parent: FRESH, replies: [] });
      respondThreadReadOnly();
      const { user } = renderInApp(<ChannelDetailView channelId={ID} />, {
        path: `/channels/${ID}`,
      });
      const opener = await screen.findByRole("button", {
        name: /テスト太郎の投稿に返信する/,
      });
      await user.click(opener);
      await within(pane()).findByText("まだ返信はありません");
      expect(opener.isConnected).toBe(true);
    });

    it("#137 AC-1（1-4 AC-3）: 閉じると、フォーカスは押した「返信」ボタンの要素に戻る", async () => {
      respondDetail(true);
      respondMessages([FRESH]);
      respondReplies({ parent: FRESH, replies: [] });
      respondThreadReadOnly();
      const { user } = renderInApp(<ChannelDetailView channelId={ID} />, {
        path: `/channels/${ID}`,
      });
      const opener = await screen.findByRole("button", {
        name: /テスト太郎の投稿に返信する/,
      });
      await user.click(opener);
      await within(pane()).findByText("まだ返信はありません");
      await user.click(
        within(pane()).getByRole("button", { name: "スレッドを閉じる" }),
      );
      expect(screen.queryByRole("region", { name: "スレッド" })).toBeNull();
      expect(document.activeElement).toBe(opener);
    });

    it("#137 AC-1（1-4 AC-3）: 返信して件数が増え、名前が「返信 1 件（…）」に替わっても、同じ要素のまま。閉じるとその要素にフォーカスが戻る", async () => {
      respondDetail(true);
      respondMessages([FRESH]);
      respondReplies({ parent: FRESH, replies: [] });
      respondThreadReadOnly();
      const { user } = renderInApp(<ChannelDetailView channelId={ID} />, {
        path: `/channels/${ID}`,
      });
      const opener = await screen.findByRole("button", {
        name: /テスト太郎の投稿に返信する/,
      });
      await user.click(opener);
      await user.type(
        await within(pane()).findByRole("textbox", { name: "返信" }),
        "[[E2E_TEST]最初の返信",
      );
      await user.click(within(pane()).getByRole("button", { name: "送信" }));
      await waitFor(() =>
        expect(opener.getAttribute("aria-label")).toMatch(/^返信 1 件（/),
      );
      expect(opener.isConnected).toBe(true);
      await user.click(
        within(pane()).getByRole("button", { name: "スレッドを閉じる" }),
      );
      expect(document.activeElement).toBe(opener);
    });

    it("#137 AC-1（1-4 AC-3）: スレッドを開閉しても、部屋の投稿用の入力欄は作り直されず、未送信の本文が残る", async () => {
      respondDetail(true);
      respondMessages([FRESH]);
      respondReplies({ parent: FRESH, replies: [] });
      respondThreadReadOnly();
      const { user } = renderInApp(<ChannelDetailView channelId={ID} />, {
        path: `/channels/${ID}`,
      });
      const roomBox = await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "メッセージ",
      });
      await user.type(roomBox, "[[E2E_TEST]部屋の書きかけ");
      await user.click(
        screen.getByRole("button", { name: /テスト太郎の投稿に返信する/ }),
      );
      await within(pane()).findByText("まだ返信はありません");
      expect(roomBox.isConnected).toBe(true);
      expect(roomBox.value).toBe("[E2E_TEST]部屋の書きかけ");
      await user.click(
        within(pane()).getByRole("button", { name: "スレッドを閉じる" }),
      );
      expect(roomBox.isConnected).toBe(true);
      expect(roomBox.value).toBe("[E2E_TEST]部屋の書きかけ");
    });
  });
});
