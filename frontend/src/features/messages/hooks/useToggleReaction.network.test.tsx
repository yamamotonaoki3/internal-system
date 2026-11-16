// #138 AC-1（1-7 AC-1）: useToggleReaction — 外側の useMutation の networkMode は "always"。データは架空。
// ミューテーションの生き残り（useToggleReaction.ts:46 `networkMode: "always"` の文字列を "" にする変異）を検出するための補強。
// 既存の useToggleReaction.offline.test.tsx で検出できない理由：TanStack Query は、networkMode が "online" 以外のどんな値でも
//   「オフラインでも待たない」と同じに扱う（canFetch が `(networkMode ?? "online") === "online"` で判定するため、"" も "always" と同じ動きになる）。
//   そのため、オフラインでの動き（待たずに mutationFn に入る）を見る既存のテストでは、"" と "always" を区別できない。
// 設計書（reactions.md「書き戻しの安全」）の定め：外側の useMutation は networkMode: "always" で、オフラインでも待たずに入り、
//   オフラインの待機と順番待ちは内側（投稿の ID ごとの scope の mutation）に集める。ここでは、その2つの mutation の設定を直接確かめる。
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
const TARGET = message(1, { reactions: [THUMBS] });

// 失敗してもほかのテストへオンライン状態を持ち越さない（要求の完了待ちは、テストの中の finally で条件を待って行う）
afterEach(() => {
  onlineManager.setOnline(true);
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
    () => useToggleReaction({ roomId: ROOM_ID, parentMessageId: null }),
    { wrapper },
  );
  return { client, ...hook };
}

describe("#138 AC-1 外側の mutation の networkMode", () => {
  it("#138 AC-1: オフラインで始めた操作でも、外側の mutation は待たずに実行に入り（paused にならず）、設定は always。内側（投稿ごとの mutation）が待機する", async () => {
    respondReactions({ [TARGET.id]: [THUMBS] });
    const { client, result } = setup();
    onlineManager.setOnline(false);
    let operation: Promise<unknown> = Promise.resolve();
    act(() => {
      operation = result.current.mutateAsync({
        messageId: TARGET.id,
        kind: "emoji",
        value: "👍",
        reactedByMe: false,
      });
    });
    try {
      await waitFor(() => {
        const inner = client
          .getMutationCache()
          .getAll()
          .find((mutation) => mutation.options.mutationKey !== undefined);
        expect(inner).toBeDefined();
      });
      const all = client.getMutationCache().getAll();
      const outer = all.find(
        (mutation) => mutation.options.mutationKey === undefined,
      );
      const inner = all.find(
        (mutation) => mutation.options.mutationKey !== undefined,
      );
      expect(outer?.options.networkMode).toBe("always");
      expect(outer?.state.isPaused).toBe(false);
      // 内側は既定の（online の）設定で、オフラインの間は待機する
      expect(inner?.options.networkMode).not.toBe("always");
      expect(inner?.state.isPaused).toBe(true);
    } finally {
      // 復帰した要求を、条件で待って完了させてから終える（固定の待ちにしない）
      act(() => onlineManager.setOnline(true));
      await operation;
      await waitFor(() => expect(client.isMutating()).toBe(0));
    }
  });
});
