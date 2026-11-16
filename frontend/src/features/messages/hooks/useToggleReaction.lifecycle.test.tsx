// #138 コードレビュー2回目（軽微）: 操作が終わった後、完了した mutation（集計・付けた人の表示名を含む）を MutationCache に残さない。
// 契約（観測できる振る舞い）：操作が成功・失敗で終わった後、queryClient.getMutationCache() に、mutationKey が ["message-reaction", …] の mutation が残らない
//   （3回続けて操作しても増えない）。回収は非同期のタイマーなので、waitFor で待つ。
// API は MSW。データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
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
const TARGET = message(1);
const THUMBS = reaction("emoji", "👍", { others: [reactor(1)] });

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(authKeys.session, SESSION);
  client.setQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID), [
    message(1, { reactions: [THUMBS] }),
  ]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useToggleReaction({ roomId: ROOM_ID, parentMessageId: null }),
    { wrapper },
  );
  return { client, ...hook };
}

const remaining = (client: QueryClient) =>
  client
    .getMutationCache()
    .getAll()
    .filter(
      (mutation) => mutation.options.mutationKey?.[0] === "message-reaction",
    );

const press = (
  result: ReturnType<typeof setup>["result"],
  reactedByMe: boolean,
) =>
  act(() => {
    result.current.mutate({
      messageId: TARGET.id,
      kind: "emoji",
      value: "👍",
      reactedByMe,
    });
  });

describe("#138 コードレビュー2回目（軽微）完了した mutation を残さない", () => {
  it("#138 AC-1: 成功で終わった後、その操作の mutation（mutationKey が message-reaction）が MutationCache に残らない", async () => {
    respondReactions({ [TARGET.id]: [THUMBS] });
    const { result, client } = setup();
    press(result, false);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(remaining(client)).toHaveLength(0));
  });

  it("#138 AC-1: 失敗（拒否 409）で終わった後も、残らない", async () => {
    const api = respondReactions({ [TARGET.id]: [THUMBS] });
    api.failNext = {
      status: 409,
      code: "CONFLICT",
      message: "リアクションは20種類までです",
    };
    const { result, client } = setup();
    press(result, false);
    await waitFor(() => expect(result.current.isError).toBe(true));
    await waitFor(() => expect(remaining(client)).toHaveLength(0));
  });

  it("#138 AC-1: 3回続けて操作しても（成功・失敗・成功）、残りは増えない", async () => {
    const api = respondReactions({ [TARGET.id]: [THUMBS] });
    const { result, client } = setup();
    press(result, false);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    api.failNext = {
      status: 403,
      code: "FORBIDDEN",
      message: "権限がありません",
    };
    press(result, true);
    await waitFor(() => expect(result.current.isError).toBe(true));
    press(result, true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(remaining(client)).toHaveLength(0));
  });
});
