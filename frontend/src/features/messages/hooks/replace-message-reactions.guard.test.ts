// #138 AC-1（1-7 AC-1）: replaceMessageReactions・captureSession — セッションの確かめ方と cancelQueries の対象。データは架空。
// ミューテーションの生き残り（replace-message-reactions.ts:12・35・36・59・60・79）を検出するための補強。期待値は設計書（reactions.md「書き戻しの安全」）から書く：
//   - 覚えるセッションのクエリは authKeys.session に完全一致するものだけ（前方一致する別のクエリ・無関係なクエリは、同じセッションと扱わない）。
//   - 操作を始めたときにセッションのクエリがない、または利用者 ID が分からないときは、後からセッションが入っても書かない。
//   - 書き込む前に止める実行中の取得は、その投稿が出ている部屋の一覧・スレッドのキャッシュだけ（ほかのキャッシュを止めない）。
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
  type SessionSnapshot,
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

const NEW = [reaction("stamp", "ok", { others: [reactor(1)], mine: true })];
const OLD = [reaction("emoji", "👍", { others: [reactor(2)] })];
const TARGET = { roomId: ROOM_ID, parentMessageId: null } as const;

const seedRoom = (client: QueryClient) =>
  client.setQueryData(messageKeys.room(ROOM_ID), [
    message(1, { reactions: OLD }),
  ]);
const roomReactions = (client: QueryClient) =>
  client.getQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID))?.[0]?.reactions;
const sessionQuery = (client: QueryClient) =>
  client.getQueryCache().find({ queryKey: authKeys.session, exact: true });

describe("#138 AC-1 覚えるセッションのクエリは authKeys.session に完全一致するものだけ", () => {
  it("#138 AC-1: 無関係なクエリが先にキャッシュにあっても、覚えるのは authKeys.session のクエリそのもの", () => {
    const client = new QueryClient();
    client.setQueryData(["unrelated", "first"], { a: 1 });
    client.setQueryData(authKeys.session, SESSION);
    const snapshot = captureSession(client);
    expect(snapshot.query).toBeDefined();
    expect(snapshot.query).toBe(sessionQuery(client));
    expect(snapshot.userId).toBe(SESSION.user.id);
  });

  it("#138 AC-1: authKeys.session で始まる別のクエリが先にあっても、覚えるのは完全一致のクエリ（前方一致の別のクエリではない）", () => {
    const client = new QueryClient();
    client.setQueryData([...authKeys.session, "detail"], { b: 2 });
    client.setQueryData(authKeys.session, SESSION);
    const snapshot = captureSession(client);
    expect(snapshot.query).toBe(sessionQuery(client));
    expect(snapshot.query?.queryKey).toEqual(authKeys.session);
  });

  it("#138 AC-1: セッションのクエリがなく、前方一致する別のクエリだけがあるときは、覚えるクエリは無く、書かない", async () => {
    const client = new QueryClient();
    client.setQueryData([...authKeys.session, "detail"], SESSION);
    seedRoom(client);
    const snapshot = captureSession(client);
    expect(snapshot.query).toBeUndefined();
    expect(snapshot.userId).toBeUndefined();
    await replaceMessageReactions(client, TARGET, message(1).id, NEW, snapshot);
    expect(roomReactions(client)).toEqual(OLD);
  });
});

describe("#138 AC-1 操作を始めたときにセッションを確かめられなかったら、後から入っても書かない", () => {
  it("#138 AC-1: 操作を始めたときにセッションのクエリがなく、その後にセッションが入っても、書かない", async () => {
    const client = new QueryClient();
    seedRoom(client);
    const snapshot = captureSession(client);
    client.setQueryData(authKeys.session, SESSION);
    await replaceMessageReactions(client, TARGET, message(1).id, NEW, snapshot);
    expect(roomReactions(client)).toEqual(OLD);
  });

  it("#138 AC-1: 覚えたクエリが無い（query が undefined）記録は、利用者 ID が今のセッションと同じでも書かない", async () => {
    const client = new QueryClient();
    client.setQueryData(authKeys.session, SESSION);
    seedRoom(client);
    const snapshot: SessionSnapshot = {
      query: undefined,
      userId: SESSION.user.id,
    };
    await replaceMessageReactions(client, TARGET, message(1).id, NEW, snapshot);
    expect(roomReactions(client)).toEqual(OLD);
  });

  it("#138 AC-1: セッションのクエリはあるが利用者 ID が分からない（データが無い）まま始めた操作は、書かない", async () => {
    const client = new QueryClient();
    // データを持たないセッションのクエリ（取得前など）。利用者 ID は undefined になる
    client
      .getQueryCache()
      .build(client, { queryKey: authKeys.session, queryFn: () => SESSION });
    seedRoom(client);
    const snapshot = captureSession(client);
    expect(snapshot.query).toBeDefined();
    expect(snapshot.userId).toBeUndefined();
    await replaceMessageReactions(client, TARGET, message(1).id, NEW, snapshot);
    expect(roomReactions(client)).toEqual(OLD);
  });

  it("#138 AC-1: 利用者 ID が分からないまま始めた操作は、同じクエリにあとから同じ利用者のデータが入っても書かない", async () => {
    const client = new QueryClient();
    client
      .getQueryCache()
      .build(client, { queryKey: authKeys.session, queryFn: () => SESSION });
    seedRoom(client);
    const snapshot = captureSession(client);
    client.setQueryData(authKeys.session, SESSION);
    await replaceMessageReactions(client, TARGET, message(1).id, NEW, snapshot);
    expect(roomReactions(client)).toEqual(OLD);
  });
});

describe("#138 AC-1 cancelQueries は、その投稿の部屋・スレッドのキャッシュだけを対象にする", () => {
  const PARENT = message(1, { reactions: OLD, replyCount: 1 });
  const REPLY = reply(PARENT, 1, { reactions: OLD });
  const thread = (): ThreadRepliesData => ({
    parent: PARENT,
    replies: [REPLY],
    replyBlockedReason: null,
    joined: true,
    roomWritable: true,
  });

  function newClient() {
    const client = new QueryClient();
    client.setQueryData(authKeys.session, SESSION);
    return client;
  }

  it("#138 AC-1: 親の投稿では、その部屋の一覧とその投稿のスレッドの2つだけを、queryKey を指定して止める", async () => {
    const client = newClient();
    client.setQueryData(messageKeys.room(ROOM_ID), [PARENT]);
    client.setQueryData(messageKeys.thread(PARENT.id), thread());
    const cancel = vi.spyOn(client, "cancelQueries");
    await replaceMessageReactions(
      client,
      TARGET,
      PARENT.id,
      NEW,
      captureSession(client),
    );
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledWith({
      queryKey: messageKeys.room(ROOM_ID),
    });
    expect(cancel).toHaveBeenCalledWith({
      queryKey: messageKeys.thread(PARENT.id),
    });
  });

  it("#138 AC-1: 返信では、親のスレッドだけを、queryKey を指定して止める（部屋の一覧は止めない）", async () => {
    const client = newClient();
    client.setQueryData(messageKeys.room(ROOM_ID), [PARENT]);
    client.setQueryData(messageKeys.thread(PARENT.id), thread());
    const cancel = vi.spyOn(client, "cancelQueries");
    await replaceMessageReactions(
      client,
      { roomId: ROOM_ID, parentMessageId: PARENT.id },
      REPLY.id,
      NEW,
      captureSession(client),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith({
      queryKey: messageKeys.thread(PARENT.id),
    });
  });

  it("#138 AC-1: 関係のないキャッシュ（別の部屋・セッション）の実行中の取得は止めない", async () => {
    const client = newClient();
    const otherRoom = "01JTESTROOM00000000000R002";
    client.setQueryData(messageKeys.room(ROOM_ID), [PARENT]);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const other = client.fetchQuery({
      queryKey: messageKeys.room(otherRoom),
      queryFn: async () => {
        await gate;
        return [message(5)];
      },
    });
    await replaceMessageReactions(
      client,
      TARGET,
      PARENT.id,
      NEW,
      captureSession(client),
    );
    release();
    await expect(other).resolves.toEqual([message(5)]);
  });
});
