// #138 コードレビュー1回目（軽微）: 同じ投稿へのリアクションの操作は、投稿の ID ごとに直列になり、応答の順が入れ替わっても、最後の表示はサーバーの最新の集計になる。
// 背景：同じ親の投稿は部屋の一覧とスレッドの両方に出る。それぞれの表示が別々に useToggleReaction を持つため、別の種類を同時に操作でき、
//   先に出した要求の古い応答が後から届くと、新しい集計を古い集計で上書きしていた。
// 契約（観測できる振る舞い。実現の方法は実装の役割が決める。第一候補は useMutation の scope: { id: 投稿の ID }）：
//   - 同じ投稿への2つ目の要求は、1つ目の応答が届くまで送られない。1つ目が終わると、2つ目が送られる。
//   - 別の投稿の要求は、待たずに送られる（直列にするのは投稿の ID ごと）。
//   - 最後の表示（部屋の一覧とスレッドの親の両方）は、サーバーが最後に処理した集計（後から始めた操作の結果）になる。応答を後から始めた方から先に返しても同じ。
// API は MSW（応答を、テストが release するまで返さない模擬）。データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ROOM_ID, message } from "../../../test/message-handlers";
import {
  reaction,
  reactor,
  respondReactionsHeld,
} from "../../../test/reaction-handlers";
import { authKeys } from "../../auth";
import type { RoomMessage } from "../api/message-api";
import { messageKeys } from "../api/query-keys";
import type { ThreadRepliesData } from "./useThreadReplies";
import { useToggleReaction } from "./useToggleReaction";

const SESSION = {
  user: {
    id: "01JTESTUSER000000000000001",
    displayName: "testuser_001",
    loginId: "testuser_001",
  },
  permissions: [],
  mustChangePassword: false,
  reauthenticatedAt: null,
};

const THUMBS = reaction("emoji", "👍", { others: [reactor(1)] });
const CLAP = reaction("emoji", "👏", { others: [reactor(2)] });
const PARENT = message(1, { replyCount: 1, reactions: [THUMBS, CLAP] });
const OTHER = message(2, { reactions: [THUMBS] });

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(authKeys.session, SESSION);
  client.setQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID), [
    PARENT,
    OTHER,
  ]);
  const thread: ThreadRepliesData = {
    parent: PARENT,
    replies: [],
    replyBlockedReason: null,
    caseRoom: false,
    joined: true,
    roomWritable: true,
  };
  client.setQueryData(messageKeys.thread(PARENT.id), thread);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  // 部屋の一覧の表示と、スレッドの表示は、それぞれ別の useToggleReaction を持つ
  const hook = renderHook(
    () => ({
      room: useToggleReaction({ roomId: ROOM_ID, parentMessageId: null }),
      thread: useToggleReaction({ roomId: ROOM_ID, parentMessageId: null }),
    }),
    { wrapper },
  );
  return { client, ...hook };
}

const roomReactions = (client: QueryClient, id: string) =>
  client
    .getQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID))
    ?.find((m) => m.id === id)?.reactions;
const threadParent = (client: QueryClient) =>
  client.getQueryData<ThreadRepliesData>(messageKeys.thread(PARENT.id))?.parent
    .reactions;
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("#138 コードレビュー1回目（軽微）同じ投稿の操作は直列", () => {
  it("#138 AC-1: 同じ投稿への2つ目の要求は、1つ目の応答が届くまで送られない。届いた後に送られる", async () => {
    const api = respondReactionsHeld({ [PARENT.id]: [THUMBS, CLAP] });
    const { result } = setup();
    act(() => {
      result.current.room.mutate({
        messageId: PARENT.id,
        kind: "emoji",
        value: "👍",
        reactedByMe: false,
      });
    });
    await waitFor(() => expect(api.requests).toHaveLength(1));
    act(() => {
      result.current.thread.mutate({
        messageId: PARENT.id,
        kind: "emoji",
        value: "👏",
        reactedByMe: false,
      });
    });
    await tick();
    expect(api.requests).toHaveLength(1);
    act(() => api.requests[0]?.release());
    await waitFor(() => expect(api.requests).toHaveLength(2));
    expect(api.requests.map((r) => r.value)).toEqual(["👍", "👏"]);
    act(() => api.requests[1]?.release());
    await waitFor(() => expect(result.current.thread.isSuccess).toBe(true));
  });

  it("#138 AC-1: 別の投稿の要求は、待たずに送られる（直列にするのは投稿の ID ごと）", async () => {
    const api = respondReactionsHeld({
      [PARENT.id]: [THUMBS, CLAP],
      [OTHER.id]: [THUMBS],
    });
    const { result } = setup();
    act(() => {
      result.current.room.mutate({
        messageId: PARENT.id,
        kind: "emoji",
        value: "👍",
        reactedByMe: false,
      });
      result.current.thread.mutate({
        messageId: OTHER.id,
        kind: "emoji",
        value: "👍",
        reactedByMe: false,
      });
    });
    await waitFor(() => expect(api.requests).toHaveLength(2));
    for (const request of api.requests) act(() => request.release());
  });

  it("#138 AC-1: 部屋側とスレッド側で別の種類を続けて操作し、応答を後から始めた方から先に返しても、最後の表示（両方）はサーバーの最新の集計になる", async () => {
    const api = respondReactionsHeld({ [PARENT.id]: [THUMBS, CLAP] });
    const { result, client } = setup();
    act(() => {
      result.current.room.mutate({
        messageId: PARENT.id,
        kind: "emoji",
        value: "👍",
        reactedByMe: false,
      });
    });
    act(() => {
      result.current.thread.mutate({
        messageId: PARENT.id,
        kind: "emoji",
        value: "👏",
        reactedByMe: false,
      });
    });
    // 届いている要求を、後に届いたものから先に返す。1つも残らず、すべて返るまで繰り返す
    await waitFor(() => expect(api.requests.length).toBeGreaterThan(0));
    for (let round = 0; round < 10; round += 1) {
      await tick();
      const waiting = api.requests.filter((r) => !r.released);
      if (waiting.length === 0) break;
      act(() => waiting.at(-1)?.release());
    }
    await waitFor(() => {
      expect(result.current.room.isPending).toBe(false);
      expect(result.current.thread.isPending).toBe(false);
    });
    const latest = api.reactions.get(PARENT.id);
    expect(latest?.every((r) => r.reactedByMe)).toBe(true);
    expect(latest).toHaveLength(2);
    expect(roomReactions(client, PARENT.id)).toEqual(latest);
    expect(threadParent(client)).toEqual(latest);
    // 別の投稿は変わらない
    expect(roomReactions(client, OTHER.id)).toEqual([THUMBS]);
  });
});

describe("#138 コードレビュー2回目（軽微）順番待ちの間に利用者が替わる", () => {
  // 契約（観測できる振る舞い。実現の方法は実装の役割が決める）：
  //   同じ投稿の操作の順番待ちの間に、clear() を伴わずにセッションの Query が別の利用者（または同じ ID の別の Query）に替わったら、
  //   待っていた操作の要求は送らない（別の利用者の Cookie でリアクションを変更しない）。キャッシュは書き換えない。
  //   送信を取りやめたことは、画面にエラーとして出さない（正しい動作のため。mutate の結果の形は実装が決める）。
  const OTHER_USER_SESSION = {
    ...SESSION,
    user: { ...SESSION.user, id: "01JTESTUSER000000000000002" },
  };

  async function startTwoThenSwitch(
    switchSession: (client: QueryClient) => void,
  ) {
    const api = respondReactionsHeld({ [PARENT.id]: [THUMBS, CLAP] });
    const { result, client } = setup();
    const before = {
      room: client.getQueryData(messageKeys.room(ROOM_ID)),
      thread: client.getQueryData(messageKeys.thread(PARENT.id)),
    };
    act(() => {
      result.current.room.mutate({
        messageId: PARENT.id,
        kind: "emoji",
        value: "👍",
        reactedByMe: false,
      });
    });
    await waitFor(() => expect(api.requests).toHaveLength(1));
    // 1つ目の応答を止めている間に、2つ目の操作を始める（順番待ち）
    act(() => {
      result.current.thread.mutate({
        messageId: PARENT.id,
        kind: "emoji",
        value: "👏",
        reactedByMe: false,
      });
    });
    await tick();
    expect(api.requests).toHaveLength(1);
    act(() => switchSession(client));
    act(() => api.requests[0]?.release());
    await tick();
    // 2つ目の要求が送られていれば（別の利用者の Cookie で送られる）、ここで件数が増える
    expect(api.requests).toHaveLength(1);
    await waitFor(() => expect(result.current.thread.isPending).toBe(false));
    return { api, result, client, before };
  }

  it("#138 AC-1: 待っている間にセッションが別の利用者に替わったら、2つ目の要求は送られず、キャッシュは書き換わらず、エラーも出ない", async () => {
    const { api, result, client, before } = await startTwoThenSwitch((c) =>
      c.setQueryData(authKeys.session, OTHER_USER_SESSION),
    );
    expect(api.requests).toHaveLength(1);
    expect(client.getQueryData(messageKeys.room(ROOM_ID))).toEqual(before.room);
    expect(client.getQueryData(messageKeys.thread(PARENT.id))).toEqual(
      before.thread,
    );
    expect(result.current.thread.isError).toBe(false);
  });

  it("#138 AC-1: 待っている間に、ログアウトして同じ ID でログインし直し（セッションの Query が別の物になり）ても、2つ目の要求は送られず、キャッシュは書き換わらず、エラーも出ない", async () => {
    const { api, result, client, before } = await startTwoThenSwitch((c) => {
      c.removeQueries({ queryKey: authKeys.session });
      c.setQueryData(authKeys.session, SESSION);
    });
    expect(api.requests).toHaveLength(1);
    expect(client.getQueryData(messageKeys.room(ROOM_ID))).toEqual(before.room);
    expect(client.getQueryData(messageKeys.thread(PARENT.id))).toEqual(
      before.thread,
    );
    expect(result.current.thread.isError).toBe(false);
  });

  it("#138 AC-1: 利用者が替わっていなければ、1つ目の応答の後に2つ目の要求が送られる（既存の直列の動き）", async () => {
    const api = respondReactionsHeld({ [PARENT.id]: [THUMBS, CLAP] });
    const { result } = setup();
    act(() => {
      result.current.room.mutate({
        messageId: PARENT.id,
        kind: "emoji",
        value: "👍",
        reactedByMe: false,
      });
    });
    await waitFor(() => expect(api.requests).toHaveLength(1));
    act(() => {
      result.current.thread.mutate({
        messageId: PARENT.id,
        kind: "emoji",
        value: "👏",
        reactedByMe: false,
      });
    });
    act(() => api.requests[0]?.release());
    await waitFor(() => expect(api.requests).toHaveLength(2));
    act(() => api.requests[1]?.release());
    await waitFor(() => expect(result.current.thread.isSuccess).toBe(true));
  });
});
