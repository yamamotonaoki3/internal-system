// #138 AC-1（1-7 AC-1・AC-3・AC-5）・AC-2（1-4 AC-6）: replaceMessageReactions — 付ける・取り消すの応答の集計で、キャッシュの該当の1件の reactions だけを書き換える。データは架空。
// 契約（計画「状態と反映」「書き戻しの手順」。replace-room-message.ts と同じ形：cancelQueries → setQueryData(更新の関数)）：
//   captureSession(queryClient): SessionSnapshot … 操作を始めたとき（onMutate）に、セッションの Query（authKeys.session）そのものと利用者 ID を覚える。
//   replaceMessageReactions(queryClient, { roomId, parentMessageId }, messageId, reactions, snapshot): Promise<void>
//     - parentMessageId が null（部屋の一覧に出る投稿＝親）：その部屋の一覧（messageKeys.room(roomId)）の messageId の1件と、
//       その投稿のスレッドのキャッシュ（messageKeys.thread(messageId)）の parent に書く。
//     - parentMessageId が親の ID（返信）：そのスレッド（messageKeys.thread(parentMessageId)）の replies のうち messageId の1件だけに書く（親・部屋の一覧は変えない）。
//     - 変えるのは reactions だけ。ほかの項目・ほかの件・並びは変えない。実行中の取得（2秒ごとの新着）は先に cancelQueries で止める。
//     - キャッシュがなければ作らない（更新の関数が undefined を返す）。
//     - 書き込む直前（更新の関数の中）に、今のセッションの Query が snapshot の Query と同じ物で、利用者 ID も同じかを確かめる。
//       違えば（ログアウト・別の利用者への切り替え・同じ ID の再ログイン・clear() の後）、何も書かない。cancelQueries を待つ間に変わった場合も書かない。
//     - 書かなかったときも、エラーにしない・ログも出さない（正しい動作）。
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ROOM_ID, message, reply } from "../../../test/message-handlers";
import { reaction, reactor } from "../../../test/reaction-handlers";
import { authKeys } from "../../auth";
import type { RoomMessage } from "../api/message-api";
import { messageKeys } from "../api/query-keys";
import {
  captureSession,
  replaceMessageReactions,
} from "./replace-message-reactions";
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
const OTHER_SESSION = {
  ...SESSION,
  user: { ...SESSION.user, id: "01JTESTUSER000000000000002" },
};

const NEW = [reaction("stamp", "ok", { others: [reactor(1)], mine: true })];
const OLD = [reaction("emoji", "👍", { others: [reactor(2)] })];

function newClient() {
  const client = new QueryClient();
  client.setQueryData(authKeys.session, SESSION);
  return client;
}

const PARENT = message(1, { reactions: OLD, replyCount: 1 });
const REPLY = reply(PARENT, 1, { reactions: OLD });
const thread = (): ThreadRepliesData => ({
  parent: PARENT,
  replies: [REPLY, reply(PARENT, 2, { reactions: OLD })],
  replyBlockedReason: null,
  caseRoom: false,
  joined: true,
  roomWritable: true,
});

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("#138 AC-1（1-7 AC-1）部屋の一覧の1件だけを書き換える", () => {
  it("#138 AC-1: 該当の1件の reactions だけを応答の集計にし、ほかの項目・ほかの件・並びは変えない", async () => {
    const client = newClient();
    const list: RoomMessage[] = [
      message(1, { reactions: OLD }),
      message(2, { reactions: OLD, body: "[E2E_TEST]別の投稿" }),
      message(3),
    ];
    client.setQueryData(messageKeys.room(ROOM_ID), list);
    await replaceMessageReactions(
      client,
      { roomId: ROOM_ID, parentMessageId: null },
      message(2).id,
      NEW,
      captureSession(client),
    );
    expect(client.getQueryData(messageKeys.room(ROOM_ID))).toEqual([
      message(1, { reactions: OLD }),
      message(2, { reactions: NEW, body: "[E2E_TEST]別の投稿" }),
      message(3),
    ]);
  });

  it("#138 AC-1: 集計が空（最後の1人が取り消した）でも、reactions を [] にする", async () => {
    const client = newClient();
    client.setQueryData(messageKeys.room(ROOM_ID), [
      message(1, { reactions: OLD }),
    ]);
    await replaceMessageReactions(
      client,
      { roomId: ROOM_ID, parentMessageId: null },
      message(1).id,
      [],
      captureSession(client),
    );
    expect(
      client.getQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID))?.[0]
        ?.reactions,
    ).toEqual([]);
  });

  it("#138 AC-1: ほかの部屋のキャッシュは変えない", async () => {
    const client = newClient();
    const otherRoom = "01JTESTROOM00000000000R002";
    const other = [message(1, { roomId: otherRoom, reactions: OLD })];
    client.setQueryData(messageKeys.room(ROOM_ID), [
      message(1, { reactions: OLD }),
    ]);
    client.setQueryData(messageKeys.room(otherRoom), other);
    await replaceMessageReactions(
      client,
      { roomId: ROOM_ID, parentMessageId: null },
      message(1).id,
      NEW,
      captureSession(client),
    );
    expect(client.getQueryData(messageKeys.room(otherRoom))).toEqual(other);
  });

  it("#138 AC-1: その部屋の実行中の取得は止め、止めた取得の結果で書き換えを上書きしない", async () => {
    const client = newClient();
    client.setQueryData(messageKeys.room(ROOM_ID), [
      message(1, { reactions: OLD }),
    ]);
    const fetching = deferred();
    const running = client
      .fetchQuery({
        queryKey: messageKeys.room(ROOM_ID),
        queryFn: async () => {
          await fetching.promise;
          return [message(1, { reactions: OLD })];
        },
        staleTime: 0,
      })
      .then(
        () => undefined,
        () => undefined,
      );
    await replaceMessageReactions(
      client,
      { roomId: ROOM_ID, parentMessageId: null },
      message(1).id,
      NEW,
      captureSession(client),
    );
    fetching.resolve();
    await running;
    expect(
      client.getQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID))?.[0]
        ?.reactions,
    ).toEqual(NEW);
  });
});

describe("#138 AC-2（1-4 AC-6）スレッド（返信・親）", () => {
  it("#138 AC-2: 返信なら、そのスレッドの replies の該当の1件だけを書き換える（親・ほかの返信・部屋の一覧は変えない）", async () => {
    const client = newClient();
    client.setQueryData(messageKeys.thread(PARENT.id), thread());
    client.setQueryData(messageKeys.room(ROOM_ID), [PARENT]);
    await replaceMessageReactions(
      client,
      { roomId: ROOM_ID, parentMessageId: PARENT.id },
      REPLY.id,
      NEW,
      captureSession(client),
    );
    const data = client.getQueryData<ThreadRepliesData>(
      messageKeys.thread(PARENT.id),
    );
    expect(data?.replies.map((r) => r.reactions)).toEqual([NEW, OLD]);
    expect(data?.parent).toEqual(PARENT);
    expect(client.getQueryData(messageKeys.room(ROOM_ID))).toEqual([PARENT]);
  });

  it("#138 AC-2: 親の投稿（parentMessageId が null）は、部屋の一覧とスレッドの親の両方に書く（返信は変えない）", async () => {
    const client = newClient();
    client.setQueryData(messageKeys.thread(PARENT.id), thread());
    client.setQueryData(messageKeys.room(ROOM_ID), [PARENT]);
    await replaceMessageReactions(
      client,
      { roomId: ROOM_ID, parentMessageId: null },
      PARENT.id,
      NEW,
      captureSession(client),
    );
    const data = client.getQueryData<ThreadRepliesData>(
      messageKeys.thread(PARENT.id),
    );
    expect(data?.parent.reactions).toEqual(NEW);
    expect(data?.replies.map((r) => r.reactions)).toEqual([OLD, OLD]);
    expect(
      client.getQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID))?.[0]
        ?.reactions,
    ).toEqual(NEW);
  });

  it("#138 AC-2: 親の投稿で、部屋の一覧のキャッシュがなくても、スレッドの親には書く（作るのはしない）", async () => {
    const client = newClient();
    client.setQueryData(messageKeys.thread(PARENT.id), thread());
    await replaceMessageReactions(
      client,
      { roomId: ROOM_ID, parentMessageId: null },
      PARENT.id,
      NEW,
      captureSession(client),
    );
    expect(
      client.getQueryData<ThreadRepliesData>(messageKeys.thread(PARENT.id))
        ?.parent.reactions,
    ).toEqual(NEW);
    expect(client.getQueryData(messageKeys.room(ROOM_ID))).toBeUndefined();
  });
});

describe("#138 AC-1（3回目の指摘2）キャッシュがなければ作らない", () => {
  it("#138 AC-1: 部屋の一覧・スレッドのキャッシュがないとき、何も作らず、失敗にもしない", async () => {
    const client = newClient();
    await replaceMessageReactions(
      client,
      { roomId: ROOM_ID, parentMessageId: null },
      message(1).id,
      NEW,
      captureSession(client),
    );
    await replaceMessageReactions(
      client,
      { roomId: ROOM_ID, parentMessageId: PARENT.id },
      REPLY.id,
      NEW,
      captureSession(client),
    );
    expect(client.getQueryData(messageKeys.room(ROOM_ID))).toBeUndefined();
    expect(client.getQueryData(messageKeys.thread(PARENT.id))).toBeUndefined();
    expect(
      client.getQueryCache().find({ queryKey: messageKeys.room(ROOM_ID) }),
    ).toBeUndefined();
  });

  it("#138 AC-1: 該当の投稿が一覧にないときは、一覧を変えない", async () => {
    const client = newClient();
    const list = [message(1, { reactions: OLD })];
    client.setQueryData(messageKeys.room(ROOM_ID), list);
    await replaceMessageReactions(
      client,
      { roomId: ROOM_ID, parentMessageId: null },
      message(9).id,
      NEW,
      captureSession(client),
    );
    expect(client.getQueryData(messageKeys.room(ROOM_ID))).toEqual(list);
  });
});

describe("#138 AC-1（3回目の指摘2）書き込む直前のセッションの同一性", () => {
  const target = { roomId: ROOM_ID, parentMessageId: null } as const;
  const seed = (client: QueryClient) =>
    client.setQueryData(messageKeys.room(ROOM_ID), [
      message(1, { reactions: OLD }),
    ]);
  const reactionsOf = (client: QueryClient) =>
    client.getQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID))?.[0]
      ?.reactions;

  it("#138 AC-1: セッションが操作を始めたときと同じなら、書き込む", async () => {
    const client = newClient();
    seed(client);
    await replaceMessageReactions(
      client,
      target,
      message(1).id,
      NEW,
      captureSession(client),
    );
    expect(reactionsOf(client)).toEqual(NEW);
  });

  it("#138 AC-1: 別の利用者に切り替わっていたら、書かない", async () => {
    const client = newClient();
    seed(client);
    const snapshot = captureSession(client);
    client.setQueryData(authKeys.session, OTHER_SESSION);
    await replaceMessageReactions(client, target, message(1).id, NEW, snapshot);
    expect(reactionsOf(client)).toEqual(OLD);
  });

  it("#138 AC-1: ログアウト（セッションの Query が消えた）後は、書かない", async () => {
    const client = newClient();
    seed(client);
    const snapshot = captureSession(client);
    client.removeQueries({ queryKey: authKeys.session });
    await replaceMessageReactions(client, target, message(1).id, NEW, snapshot);
    expect(reactionsOf(client)).toEqual(OLD);
  });

  it("#138 AC-1: ログアウトして同じ ID でログインし直した（Query が作り直された）後も、書かない", async () => {
    const client = newClient();
    seed(client);
    const snapshot = captureSession(client);
    client.removeQueries({ queryKey: authKeys.session });
    client.setQueryData(authKeys.session, SESSION);
    await replaceMessageReactions(client, target, message(1).id, NEW, snapshot);
    expect(reactionsOf(client)).toEqual(OLD);
  });

  it("#138 AC-1: cancelQueries を待つ間に別の利用者へ切り替わったら、待った後も書かない", async () => {
    const client = newClient();
    seed(client);
    const snapshot = captureSession(client);
    const gate = deferred();
    vi.spyOn(client, "cancelQueries").mockImplementation(() => gate.promise);
    const pending = replaceMessageReactions(
      client,
      target,
      message(1).id,
      NEW,
      snapshot,
    );
    client.setQueryData(authKeys.session, OTHER_SESSION);
    gate.resolve();
    await pending;
    expect(reactionsOf(client)).toEqual(OLD);
  });

  it("#138 AC-1: cancelQueries を待つ間にログアウトし、同じ ID で再ログインしても、待った後は書かない", async () => {
    const client = newClient();
    seed(client);
    const snapshot = captureSession(client);
    const gate = deferred();
    vi.spyOn(client, "cancelQueries").mockImplementation(() => gate.promise);
    const pending = replaceMessageReactions(
      client,
      target,
      message(1).id,
      NEW,
      snapshot,
    );
    client.removeQueries({ queryKey: authKeys.session });
    client.setQueryData(authKeys.session, SESSION);
    gate.resolve();
    await pending;
    expect(reactionsOf(client)).toEqual(OLD);
  });

  it("#138 AC-1: clear() の後に遅れて呼ばれても、キャッシュを作り直さない", async () => {
    const client = newClient();
    seed(client);
    const snapshot = captureSession(client);
    client.clear();
    await replaceMessageReactions(client, target, message(1).id, NEW, snapshot);
    expect(client.getQueryData(messageKeys.room(ROOM_ID))).toBeUndefined();
    expect(
      client.getQueryCache().find({ queryKey: messageKeys.room(ROOM_ID) }),
    ).toBeUndefined();
  });

  it("#138 AC-1: スレッドのキャッシュも、利用者が替わっていたら書かない（返信・親の両方）", async () => {
    const client = newClient();
    client.setQueryData(messageKeys.thread(PARENT.id), thread());
    const snapshot = captureSession(client);
    client.setQueryData(authKeys.session, OTHER_SESSION);
    await replaceMessageReactions(
      client,
      { roomId: ROOM_ID, parentMessageId: PARENT.id },
      REPLY.id,
      NEW,
      snapshot,
    );
    await replaceMessageReactions(
      client,
      { roomId: ROOM_ID, parentMessageId: null },
      PARENT.id,
      NEW,
      snapshot,
    );
    expect(client.getQueryData(messageKeys.thread(PARENT.id))).toEqual(
      thread(),
    );
  });
});
