// #134 AC-1（1-3 AC-3・AC-4）: replaceRoomMessage — 編集・削除の結果を、その部屋の一覧のキャッシュの該当の1件だけに反映する。データは架空。
// 契約（計画 plan-134 の「8. 画面」：成功したら cancelQueries で実行中のポーリングを止めてから setQueryData で該当の行を置き換える）：
//   その部屋のキー（messageKeys.room(roomId)）の実行中の取得だけを止める。ほかの部屋の取得は止めない（その部屋の一覧を壊さない）。
//   一覧のうち messageId の1件だけを replace の結果に替え、ほかの件と順は変えない。
//   その部屋の一覧がキャッシュにないときは、何もせずに終える（一覧を作らない・失敗にしない）。
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ROOM_ID, message } from "../../../test/message-handlers";
import type { RoomMessage } from "../api/message-api";
import { messageKeys } from "../api/query-keys";
import { replaceRoomMessage } from "./replace-room-message";

const OTHER_ROOM_ID = "01JTESTROOM00000000000R002";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const asDeleted = (target: RoomMessage): RoomMessage => ({
  ...target,
  editedAt: null,
  deleted: true,
  body: null,
});

describe("#134 AC-1 replaceRoomMessage", () => {
  it("#134 AC-1（1-3 AC-4）: その部屋の該当の1件だけを替え、ほかの件と順は変えない", async () => {
    const client = new QueryClient();
    const list: RoomMessage[] = [message(1), message(2), message(3)];
    client.setQueryData(messageKeys.room(ROOM_ID), list);
    await replaceRoomMessage(client, ROOM_ID, message(2).id, asDeleted);
    expect(client.getQueryData(messageKeys.room(ROOM_ID))).toEqual([
      message(1),
      asDeleted(message(2)),
      message(3),
    ]);
  });

  it("#134 AC-1（1-3 AC-4）: その部屋の実行中の取得は止め、ほかの部屋の実行中の取得は止めずに、その結果を一覧に入れる", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(messageKeys.room(ROOM_ID), [message(1)]);
    const ownFetch = deferred<RoomMessage[]>();
    const otherFetch = deferred<RoomMessage[]>();
    const own = client.fetchQuery({
      queryKey: messageKeys.room(ROOM_ID),
      queryFn: () => ownFetch.promise,
      staleTime: 0,
    });
    const otherList: RoomMessage[] = [message(9, { roomId: OTHER_ROOM_ID })];
    const other = client.fetchQuery({
      queryKey: messageKeys.room(OTHER_ROOM_ID),
      queryFn: () => otherFetch.promise,
    });
    // 止められた取得の結果（約束の成否）は契約にしない。未処理の失敗にしないよう受け止めて、終わるまで待つ
    const ownSettled = own.then(
      () => undefined,
      () => undefined,
    );

    await replaceRoomMessage(client, ROOM_ID, message(1).id, asDeleted);
    // 止めた取得が、反映の前の一覧を返しても、反映の結果を上書きしない
    ownFetch.resolve([message(1)]);
    otherFetch.resolve(otherList);

    await expect(other).resolves.toEqual(otherList);
    expect(client.getQueryData(messageKeys.room(OTHER_ROOM_ID))).toEqual(
      otherList,
    );
    await ownSettled;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.getQueryData(messageKeys.room(ROOM_ID))).toEqual([
      asDeleted(message(1)),
    ]);
  });

  it("#134 AC-1: その部屋の一覧がキャッシュにないときは、失敗にせず、一覧を作らず、置き換えの関数も呼ばない", async () => {
    const client = new QueryClient();
    const replace = vi.fn(asDeleted);
    await expect(
      replaceRoomMessage(client, ROOM_ID, message(1).id, replace),
    ).resolves.toBeUndefined();
    expect(client.getQueryData(messageKeys.room(ROOM_ID))).toBeUndefined();
    expect(replace).not.toHaveBeenCalled();
  });
});
