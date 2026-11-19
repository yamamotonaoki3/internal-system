// #138 AC-1（1-7 AC-1〜AC-4）・AC-2（1-4 AC-6）: useToggleReaction — リアクションを付ける・取り消す。API は MSW。データは架空。
// 契約（計画「状態と反映」）：
//   useToggleReaction({ roomId, parentMessageId }) は useMutation の結果を返す。mutate({ messageId, kind, value, reactedByMe }) で、
//     reactedByMe が偽なら POST（付ける）、真なら DELETE（取り消す）を送る。reactedByMe は、押した時点の画面の表示（古くてもよい）。
//   成功（すでに付いている・すでに外れているときの冪等の成功も）：応答の { reactions } で、キャッシュのその投稿の reactions だけを書き換える（replace-message-reactions.ts）。取り直さない。
//   拒否（409・403・404）：エラーを失敗として返す（describeError で文言にできる ApiError のまま）。キャッシュは変えず、取り直しの要求（invalidate・refetch・reset）も出さない。
//   書き込む直前に、操作を始めたとき（mutate を呼んだとき）と今のセッションの同一性を確かめる（ログアウト・利用者の切り替え・同じ ID の再ログイン・clear() の後は書かない）。
//   進行中は isPending が真（画面はそのあいだ二度押しを受け付けない）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ROOM_ID, message, reply } from "../../../test/message-handlers";
import {
  reaction,
  reactor,
  respondReactions,
} from "../../../test/reaction-handlers";
import { server } from "../../../test/server";
import { authKeys } from "../../auth";
import type { RoomMessage } from "../api/message-api";
import { messageKeys } from "../api/query-keys";
import { useToggleReaction } from "./useToggleReaction";
import type { ThreadRepliesData } from "./useThreadReplies";

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

const TARGET = message(1);
const THUMBS = reaction("emoji", "👍", { others: [reactor(1)] });
const THUMBS_MINE = reaction("emoji", "👍", {
  others: [reactor(1)],
  mine: true,
});

function setup(
  options: { parentMessageId?: string | null; cache?: boolean } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(authKeys.session, SESSION);
  if (options.cache !== false)
    client.setQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID), [
      message(1, { reactions: [THUMBS] }),
      message(2, { reactions: [THUMBS] }),
    ]);
  const refetches = [
    vi.spyOn(client, "invalidateQueries"),
    vi.spyOn(client, "refetchQueries"),
    vi.spyOn(client, "resetQueries"),
  ];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useToggleReaction({
        roomId: ROOM_ID,
        parentMessageId: options.parentMessageId ?? null,
      }),
    { wrapper },
  );
  return { client, refetches, ...hook };
}

const room = (client: QueryClient) =>
  client.getQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID));
const press = (
  result: ReturnType<typeof setup>["result"],
  reactedByMe: boolean,
  value = "👍",
  messageId = TARGET.id,
) =>
  act(() => {
    result.current.mutate({ messageId, kind: "emoji", value, reactedByMe });
  });

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("#138 AC-1（1-7 AC-1・AC-3）付ける・取り消す", () => {
  it("#138 AC-1（1-7 AC-1）: reactedByMe が偽なら POST で付け、応答の集計でその投稿の reactions だけを書き換える（ほかの投稿は変えない）。取り直さない", async () => {
    const api = respondReactions({ [TARGET.id]: [THUMBS] });
    const { result, client, refetches } = setup();
    press(result, false);
    await waitFor(() =>
      expect(room(client)?.[0]?.reactions).toEqual([THUMBS_MINE]),
    );
    expect(api.posts).toEqual([
      { messageId: TARGET.id, kind: "emoji", value: "👍" },
    ]);
    expect(api.deletes).toEqual([]);
    expect(room(client)?.[1]?.reactions).toEqual([THUMBS]);
    for (const spy of refetches) expect(spy).not.toHaveBeenCalled();
  });

  it("#138 AC-1（1-7 AC-3）: reactedByMe が真なら DELETE（value は符号化）で取り消し、応答の集計に書き換える", async () => {
    const api = respondReactions({ [TARGET.id]: [THUMBS_MINE] });
    const { result, client } = setup();
    client.setQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID), [
      message(1, { reactions: [THUMBS_MINE] }),
    ]);
    press(result, true);
    await waitFor(() => expect(room(client)?.[0]?.reactions).toEqual([THUMBS]));
    expect(api.deletes).toEqual([
      { messageId: TARGET.id, kind: "emoji", value: "👍" },
    ]);
    expect(api.rawPaths[0]).toContain(encodeURIComponent("👍"));
    expect(api.posts).toEqual([]);
  });

  it("#138 AC-1（1-7 AC-3）: 最後の1人が取り消すと、その投稿の reactions は空になる", async () => {
    respondReactions({
      [TARGET.id]: [reaction("emoji", "👍", { mine: true })],
    });
    const { result, client } = setup();
    client.setQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID), [
      message(1, { reactions: [reaction("emoji", "👍", { mine: true })] }),
    ]);
    press(result, true);
    await waitFor(() => expect(room(client)?.[0]?.reactions).toEqual([]));
  });

  it("#138 AC-1（スタンプ）: kind が stamp でも付けられる（POST に kind と value をそのまま送る）", async () => {
    const api = respondReactions();
    const { result, client } = setup();
    act(() => {
      result.current.mutate({
        messageId: TARGET.id,
        kind: "stamp",
        value: "ok",
        reactedByMe: false,
      });
    });
    await waitFor(() =>
      expect(room(client)?.[0]?.reactions.map((r) => r.value)).toEqual(["ok"]),
    );
    expect(api.posts[0]).toMatchObject({ kind: "stamp", value: "ok" });
  });
});

describe("#138 AC-1（U-12）二度押し・別のタブ：古い表示から押しても、画面は最新の集計になる", () => {
  it("#138 AC-1（U-12）: 画面は「付けていない」だが、サーバーではすでに付いている。POST の応答（冪等の成功）の集計に置き換わる（件数が増えすぎない）", async () => {
    // 別のタブで、すでに自分が付けた状態（画面の表示は古い）
    respondReactions({ [TARGET.id]: [THUMBS_MINE] });
    const { result, client } = setup();
    press(result, false);
    await waitFor(() =>
      expect(room(client)?.[0]?.reactions).toEqual([THUMBS_MINE]),
    );
    expect(room(client)?.[0]?.reactions[0]?.count).toBe(2);
  });

  it("#138 AC-1（U-12）: 画面は「付けている」だが、別のタブですでに外した。DELETE の応答（冪等の成功）の集計に置き換わる", async () => {
    respondReactions({ [TARGET.id]: [THUMBS] });
    const { result, client } = setup();
    client.setQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID), [
      message(1, { reactions: [THUMBS_MINE] }),
    ]);
    press(result, true);
    await waitFor(() => expect(room(client)?.[0]?.reactions).toEqual([THUMBS]));
  });

  it("#138 AC-1（二度押しの防止）: 進行中は isPending が真で、応答が届くと偽に戻る", async () => {
    const gate = deferred();
    const api = respondReactions({ [TARGET.id]: [THUMBS] });
    api.gate = gate.promise;
    const { result } = setup();
    press(result, false);
    await waitFor(() => expect(result.current.isPending).toBe(true));
    gate.resolve();
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(api.posts).toHaveLength(1);
  });
});

describe("#138 AC-2（1-4 AC-6）スレッド", () => {
  const PARENT = message(1, { replyCount: 1, reactions: [THUMBS] });
  const REPLY = reply(PARENT, 1, { reactions: [THUMBS] });
  const data = (): ThreadRepliesData => ({
    parent: PARENT,
    replies: [REPLY],
    replyBlockedReason: null,
    caseRoom: false,
    joined: true,
    roomWritable: true,
  });

  it("#138 AC-2: 返信（parentMessageId あり）は、スレッドのキャッシュの返信の1件だけを書き換える", async () => {
    respondReactions({ [REPLY.id]: [THUMBS] });
    const { result, client } = setup({ parentMessageId: PARENT.id });
    client.setQueryData(messageKeys.thread(PARENT.id), data());
    press(result, false, "👍", REPLY.id);
    await waitFor(() =>
      expect(
        client.getQueryData<ThreadRepliesData>(messageKeys.thread(PARENT.id))
          ?.replies[0]?.reactions,
      ).toEqual([THUMBS_MINE]),
    );
    expect(
      client.getQueryData<ThreadRepliesData>(messageKeys.thread(PARENT.id))
        ?.parent.reactions,
    ).toEqual([THUMBS]);
    expect(room(client)?.[0]?.reactions).toEqual([THUMBS]);
  });

  it("#138 AC-2: 親の投稿（parentMessageId が null）は、部屋の一覧とスレッドの親の両方を書き換える", async () => {
    respondReactions({ [PARENT.id]: [THUMBS] });
    const { result, client } = setup();
    client.setQueryData(messageKeys.thread(PARENT.id), data());
    press(result, false, "👍", PARENT.id);
    await waitFor(() =>
      expect(
        client.getQueryData<ThreadRepliesData>(messageKeys.thread(PARENT.id))
          ?.parent.reactions,
      ).toEqual([THUMBS_MINE]),
    );
    expect(room(client)?.[0]?.reactions).toEqual([THUMBS_MINE]);
  });
});

describe("#138 AC-1（U-7・U-8）拒否：文言だけで、取り直さない", () => {
  it.each([
    [409, "CONFLICT", "リアクションは20種類までです"],
    [409, "CONFLICT", "このメッセージはすでに削除されています"],
    [403, "FORBIDDEN", "このチャンネルには参加していません"],
    [404, "NOT_FOUND", "チャンネルが見つかりません"],
  ])(
    "#138 AC-1: %i %s（%s）は ApiError のまま失敗になり、キャッシュは変わらず、取り直しの要求は出ない",
    async (status, code, text) => {
      const api = respondReactions({ [TARGET.id]: [THUMBS] });
      api.failNext = { status, code, message: text };
      const { result, client, refetches } = setup();
      const before = room(client);
      press(result, false);
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toMatchObject({
        status,
        code,
        message: text,
      });
      expect(room(client)).toEqual(before);
      for (const spy of refetches) expect(spy).not.toHaveBeenCalled();
      // 取得（GET）も出ていない（このテストには GET の応答がなく、出れば未処理の通信になる）
      expect(api.posts).toHaveLength(1);
    },
  );

  it("#138 AC-1: 取り消しの拒否（403）も、同じく文言だけで、キャッシュを変えない", async () => {
    const api = respondReactions({ [TARGET.id]: [THUMBS_MINE] });
    api.failNext = {
      status: 403,
      code: "FORBIDDEN",
      message: "権限がありません",
    };
    const { result, client, refetches } = setup();
    const before = room(client);
    press(result, true);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(room(client)).toEqual(before);
    for (const spy of refetches) expect(spy).not.toHaveBeenCalled();
  });

  it("#138 AC-1: 通信の失敗（ネットワークエラー）も、もみ消さず失敗として返し、キャッシュを変えない", async () => {
    server.use(
      http.post("/api/messages/:messageId/reactions", () => Response.error()),
    );
    const { result, client } = setup();
    const before = room(client);
    press(result, false);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(room(client)).toEqual(before);
  });
});

describe("#138 AC-1（3回目の指摘2）利用者の切り替え・ログアウト", () => {
  it("#138 AC-1: 取り消しの待ち（cancelQueries）の間に別の利用者へ切り替わったら、応答が届いても書かない", async () => {
    respondReactions({ [TARGET.id]: [THUMBS] });
    const { result, client } = setup();
    const before = room(client);
    const gate = deferred();
    vi.spyOn(client, "cancelQueries").mockImplementation(() => gate.promise);
    press(result, false);
    await waitFor(() => expect(client.cancelQueries).toHaveBeenCalled());
    client.setQueryData(authKeys.session, {
      ...SESSION,
      user: { ...SESSION.user, id: "01JTESTUSER000000000000002" },
    });
    gate.resolve();
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(room(client)).toEqual(before);
  });

  it("#138 AC-1: 取り消しの待ちの間に、ログアウトして同じ ID でログインし直しても、書かない", async () => {
    respondReactions({ [TARGET.id]: [THUMBS] });
    const { result, client } = setup();
    const before = room(client);
    const gate = deferred();
    vi.spyOn(client, "cancelQueries").mockImplementation(() => gate.promise);
    press(result, false);
    await waitFor(() => expect(client.cancelQueries).toHaveBeenCalled());
    client.removeQueries({ queryKey: authKeys.session });
    client.setQueryData(authKeys.session, SESSION);
    gate.resolve();
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(room(client)).toEqual(before);
  });

  it("#138 AC-1: clear() の後に応答が遅れて届いても、キャッシュを作り直さない", async () => {
    const gate = deferred();
    const api = respondReactions({ [TARGET.id]: [THUMBS] });
    api.gate = gate.promise;
    const { result, client } = setup();
    press(result, false);
    await waitFor(() => expect(api.posts).toHaveLength(1));
    client.clear();
    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(client.getQueryData(messageKeys.room(ROOM_ID))).toBeUndefined();
    expect(
      client.getQueryCache().find({ queryKey: messageKeys.room(ROOM_ID) }),
    ).toBeUndefined();
  });

  it("#138 AC-1: 部屋の一覧のキャッシュがない（開いていない）ときは、応答が届いても作らない", async () => {
    respondReactions({ [TARGET.id]: [THUMBS] });
    const { result, client } = setup({ cache: false });
    press(result, false);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(messageKeys.room(ROOM_ID))).toBeUndefined();
  });
});
