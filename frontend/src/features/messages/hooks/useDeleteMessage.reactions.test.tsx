// #138 AC-1（U-7）: useDeleteMessage が削除の結果として組み立てる項目は、必須の reactions を [] にする（削除済みの投稿の reactions は []。zod の項目は必須のまま）。
// 契約（計画「メッセージの項目を組み立てている箇所」・手順7）：削除に成功したら、キャッシュの該当の1件は、
//   { id, roomId, parentMessageId, replyCount, author, createdAt, editedAt: null, deleted: true, body: null, mentions: [], reactions: [] } になる（付いていたリアクションは画面から消える。サーバー側の行は残す）。
// API は MSW。データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ROOM_ID, message, reply } from "../../../test/message-handlers";
import { reaction, reactor } from "../../../test/reaction-handlers";
import { server } from "../../../test/server";
import { authKeys } from "../../auth";
import { ReauthProvider } from "../../auth/ReauthProvider";
import type { RoomMessage } from "../api/message-api";
import { messageKeys } from "../api/query-keys";
import { useDeleteMessage } from "./useDeleteMessage";
import type { ThreadRepliesData } from "./useThreadReplies";

const SESSION = {
  user: {
    id: "01JTESTUSER000000000000001",
    displayName: "testuser_001",
    loginId: "testuser_001",
  },
  permissions: [],
  mustChangePassword: false,
  reauthenticatedAt: new Date(Date.now() - 60_000).toISOString(),
};
const REACTIONS = [reaction("emoji", "👍", { others: [reactor(1)] })];

function setup(parentMessageId: string | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(authKeys.session, SESSION);
  server.use(
    http.delete(
      "/api/messages/:messageId",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReauthProvider>{children}</ReauthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const hook = renderHook(() => useDeleteMessage(ROOM_ID, parentMessageId), {
    wrapper,
  });
  return { client, ...hook };
}

describe("#138 AC-1（U-7）削除した投稿の reactions は []", () => {
  it("#138 AC-1: 部屋の一覧の投稿を削除すると、その1件は deleted: true・body: null・reactions: [] になる（ほかの項目は残る）", async () => {
    const target = message(1, { reactions: REACTIONS, replyCount: 2 });
    const { client, result } = setup(null);
    client.setQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID), [
      target,
      message(2, { reactions: REACTIONS }),
    ]);
    act(() => result.current.mutate(target.id));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const list = client.getQueryData<RoomMessage[]>(messageKeys.room(ROOM_ID));
    expect(list?.[0]).toEqual({
      id: target.id,
      roomId: target.roomId,
      parentMessageId: null,
      replyCount: 2,
      author: target.author,
      createdAt: target.createdAt,
      editedAt: null,
      deleted: true,
      body: null,
      mentions: [],
      reactions: [],
      // #140：削除済みの投稿の添付は空
      attachments: [],
    });
    expect(list?.[1]?.reactions).toEqual(REACTIONS);
  });

  it("#138 AC-1: スレッドの返信を削除すると、その返信の reactions も []", async () => {
    const parent = message(1, { replyCount: 1 });
    const target = reply(parent, 1, { reactions: REACTIONS });
    const { client, result } = setup(parent.id);
    const data: ThreadRepliesData = {
      parent,
      replies: [target],
      replyBlockedReason: null,
      caseRoom: false,
      joined: true,
      roomWritable: true,
    };
    client.setQueryData(messageKeys.thread(parent.id), data);
    act(() => result.current.mutate(target.id));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const after = client.getQueryData<ThreadRepliesData>(
      messageKeys.thread(parent.id),
    );
    expect(after?.replies[0]).toMatchObject({
      deleted: true,
      body: null,
      reactions: [],
    });
  });
});
