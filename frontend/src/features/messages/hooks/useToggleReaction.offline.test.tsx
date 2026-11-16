// #138 コードレビュー3回目（軽微）: オフラインで待っている間に利用者が替わったら、接続が戻っても、待っていた操作を送らない。
// 背景：オフラインで操作を始めると、外側の useMutation が（既定のネットワークの設定のため）mutationFn に入る前に待機する。
//   待っている間にセッションが（clear() なしで）別の利用者に替わり、接続が戻ると、復帰の後に別の利用者のセッションを記録して、
//   元の利用者の操作が別の利用者の操作として送信処理に進んでいた。待機中は、送信中の共有の状態（useIsReactionPending）も偽になっていた。
// 契約（観測できる振る舞い。実現の方法は実装の役割が決める）：
//   - オフラインで待っている間、同じ投稿の useIsReactionPending(messageId) は真（どの表示でも押せない）。
//   - 待っている間にセッションの Query が別の利用者（または同じ ID の別の Query）に替わったら、接続が戻っても要求を送らない。
//     キャッシュは変えず、エラーとして出さず（isError は偽）、最後に送信中の状態が偽に戻る。
//   - 利用者が替わっていなければ、接続が戻ったあとに要求が1件送られ、応答の集計がキャッシュに反映される。
// API は MSW。データは架空。各テストの後で、必ずオンラインに戻す（ほかのテストに影響させない）。
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ROOM_ID, message } from "../../../test/message-handlers";
import {
  reaction,
  reactor,
  respondReactions,
} from "../../../test/reaction-handlers";
import { authKeys } from "../../auth";
import type { RoomMessage } from "../api/message-api";
import { messageKeys } from "../api/query-keys";
import { useIsReactionPending, useToggleReaction } from "./useToggleReaction";

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
const OTHER_USER_SESSION = {
  ...SESSION,
  user: { ...SESSION.user, id: "01JTESTUSER000000000000002" },
};
const THUMBS = reaction("emoji", "👍", { others: [reactor(1)] });
const TARGET = message(1, { reactions: [THUMBS] });

afterEach(async () => {
  onlineManager.setOnline(true);
  // 待っていた操作が残っていても、復帰で動き出した要求は、このテストの中で終わらせる（次のテストの記録に混ざらないように）
  await new Promise((resolve) => setTimeout(resolve, 150));
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(authKeys.session, SESSION);
  client.setQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID), [TARGET]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => ({
      toggle: useToggleReaction({ roomId: ROOM_ID, parentMessageId: null }),
      // 同じ投稿を出している、別の表示（送信中の状態を共有で読む）
      pending: useIsReactionPending(TARGET.id),
    }),
    { wrapper },
  );
  return { client, ...hook };
}

const start = (result: ReturnType<typeof setup>["result"]) =>
  act(() => {
    result.current.toggle.mutate({
      messageId: TARGET.id,
      kind: "emoji",
      value: "👍",
      reactedByMe: false,
    });
  });
const tick = () => new Promise((resolve) => setTimeout(resolve, 100));
const room = (client: QueryClient) =>
  client.getQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID));

describe("#138 コードレビュー3回目（軽微）オフラインで待っている間に利用者が替わる", () => {
  it("#138 AC-1: オフラインで待っている間、同じ投稿の送信中の状態（useIsReactionPending）は真で、要求は送られない", async () => {
    const api = respondReactions({ [TARGET.id]: [THUMBS] });
    const { result } = setup();
    onlineManager.setOnline(false);
    start(result);
    await tick();
    expect(api.posts).toHaveLength(0);
    expect(result.current.pending).toBe(true);
  });

  it.each([
    [
      "別の利用者に替わった",
      (client: QueryClient) =>
        client.setQueryData(authKeys.session, OTHER_USER_SESSION),
    ],
    [
      "ログアウトして同じ ID でログインし直した（セッションの Query が別の物になった）",
      (client: QueryClient) => {
        client.removeQueries({ queryKey: authKeys.session });
        client.setQueryData(authKeys.session, SESSION);
      },
    ],
  ])(
    "#138 AC-1: オフラインで待っている間に、%s。接続が戻っても要求は送られず、キャッシュは変わらず、エラーも出ず、送信中の状態は偽に戻る",
    async (_label, switchSession) => {
      const api = respondReactions({ [TARGET.id]: [THUMBS] });
      const { result, client } = setup();
      const before = room(client);
      onlineManager.setOnline(false);
      start(result);
      await tick();
      act(() => switchSession(client));
      act(() => onlineManager.setOnline(true));
      await waitFor(() => expect(result.current.pending).toBe(false));
      await tick();
      expect(api.posts).toHaveLength(0);
      expect(api.deletes).toHaveLength(0);
      expect(room(client)).toEqual(before);
      expect(result.current.toggle.isError).toBe(false);
    },
  );

  it("#138 AC-1: 利用者が替わっていなければ、接続が戻ったあとに要求が1件送られ、応答の集計がキャッシュに反映される", async () => {
    const api = respondReactions({ [TARGET.id]: [THUMBS] });
    const { result, client } = setup();
    onlineManager.setOnline(false);
    start(result);
    await tick();
    expect(api.posts).toHaveLength(0);
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    await waitFor(() =>
      expect(room(client)?.[0]?.reactions[0]).toMatchObject({
        count: 2,
        reactedByMe: true,
      }),
    );
    await waitFor(() => expect(result.current.pending).toBe(false));
  });
});
