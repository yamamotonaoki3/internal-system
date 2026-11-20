// #323 コードレビュー1回目 重大2：本人が退出したら、その案件の部屋の、参加者だけの中身（メンションの候補＝部屋の参加者の名前・
// 部屋のメッセージ・スレッド・チャンネルの詳細）が、キャッシュから取り出せないこと。ほかの人を外した（自分は参加者のまま）ときは取り除かないこと。
// 呼び出し方は CaseDetailView と同じ：部屋の ID は詳細の channelId から求める（退出の後片付けで詳細が先に消える順を写す）。
// 否定の確認が空振りしないよう、外される前に、その中身がキャッシュにあることを先に確かめる。API は MSW。データはすべて架空（testuser_323_・[UNIT_TEST]）。
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { authKeys } from "../../auth";
import { TEST_USER } from "../../../test/auth-handlers";
import { server } from "../../../test/server";
import type { CaseParticipant } from "../api/case-api";
import { useCaseAccessLoss } from "./useCaseAccessLoss";
import { useParticipantWrites } from "./useParticipantWrites";

const USER = TEST_USER.id;
const OTHER_USER = "01JTESTUSER323000000000LV2";
const CASE = "01JTESTCASE3230000000000LV1";
const ROOM = "01JTESTROOM3230000000000LV1";
const OTHER_ROOM = "01JTESTROOM3230000000000LV2";
const PARENT = "01JTESTMSG32300000000000LV1";
const SECRET = "[UNIT_TEST]323退出の前の中身 testuser_323_member";

const SUMMARY = ["cases", "summary", USER, CASE] as const;
const DETAIL = ["cases", "detail", USER, CASE] as const;

/** この案件の部屋の、参加者だけの中身 */
const ROOM_KEYS = {
  mention: ["message-mention-candidates", ROOM, ""],
  mentionTyped: ["message-mention-candidates", ROOM, "testuser"],
  roomMessages: ["messages", "room", ROOM],
  thread: ["messages", "thread", PARENT],
  channelDetail: ["channels", "detail", ROOM],
} as const;

/** 別の部屋の中身（取り除いてはいけない） */
const OTHER_ROOM_KEYS = {
  otherMention: ["message-mention-candidates", OTHER_ROOM, ""],
  otherRoomMessages: ["messages", "room", OTHER_ROOM],
  otherChannelDetail: ["channels", "detail", OTHER_ROOM],
} as const;

function summary(isParticipant: boolean) {
  return {
    id: CASE,
    title: "[UNIT_TEST]323件名",
    isParticipant,
    canManage: false,
    canEditDueDate: false,
    participantCount: 2,
    lastActivityAt: isParticipant ? "2026-11-20T00:00:00.000Z" : null,
    channelId: isParticipant ? ROOM : null,
  };
}

const participant = (userId: string) =>
  ({
    userId,
    displayName: "testuser_323_member",
  }) as unknown as CaseParticipant;

const remaining = (
  client: QueryClient,
  keys: Record<string, readonly string[]>,
) =>
  Object.entries(keys)
    .filter(([, key]) => client.getQueryData([...key]) !== undefined)
    .map(([label]) => label);

function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(authKeys.session, {
    user: TEST_USER,
    mustChangePassword: false,
    reauthenticatedAt: null,
    permissions: [],
  });
  client.setQueryData([...SUMMARY], summary(true));
  client.setQueryData([...DETAIL], { channelId: ROOM, secret: SECRET });
  for (const key of [
    ...Object.values(ROOM_KEYS),
    ...Object.values(OTHER_ROOM_KEYS),
  ])
    client.setQueryData([...key], { secret: SECRET });
  server.use(
    http.delete(
      "/api/cases/:caseId/participants/:userId",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/cases/${CASE}`]}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  const onLost = () => undefined;
  const view = renderHook(
    () => {
      // CaseDetailView と同じ組み立て：概要で参加を決め、詳細は参加者の間だけ取り、部屋の ID は詳細の channelId
      const summaryQuery = useQuery<ReturnType<typeof summary>>({
        queryKey: [...SUMMARY],
        // 取り直し（ほかの人を外した後の取り直し）では、サーバーは今も参加者と返す
        queryFn: () => Promise.resolve(summary(true)),
      });
      const isParticipant = summaryQuery.data?.isParticipant === true;
      const detail = useQuery<{ channelId: string }>({
        queryKey: [...DETAIL],
        queryFn: () => Promise.resolve({ channelId: ROOM, secret: SECRET }),
        enabled: isParticipant,
      });
      const roomId = detail.data?.channelId ?? null;
      useCaseAccessLoss({
        caseId: CASE,
        userId: USER,
        roomId,
        isParticipant,
        onLost,
      });
      return useParticipantWrites(CASE);
    },
    { wrapper },
  );
  // 外される前：部屋の中身がキャッシュにある
  expect(remaining(client, ROOM_KEYS)).toEqual(Object.keys(ROOM_KEYS));
  return { client, ...view };
}

describe("#323 コードレビュー1回目 重大2 本人の退出の後に、その案件の部屋の参加者だけの中身を残さない", () => {
  it("#323 AC-1 退出（画面の表示中）: 退出に成功したら、メンションの候補・部屋のメッセージ・スレッド・チャンネルの詳細が取り出せない", async () => {
    const { client, result } = setup();

    act(() =>
      result.current.removeUser(participant(USER), true, () => undefined),
    );
    await waitFor(() =>
      expect(client.getQueryData([...SUMMARY])).toEqual(
        expect.objectContaining({ isParticipant: false }),
      ),
    );

    await waitFor(() => expect(remaining(client, ROOM_KEYS)).toEqual([]));
  });

  it("#323 AC-1 退出（画面を離れた後）: 退出の後に画面が外れても、部屋の参加者だけの中身が取り出せない。別の部屋の中身は残る", async () => {
    const { client, result, unmount } = setup();

    act(() =>
      result.current.removeUser(participant(USER), true, () => undefined),
    );
    await waitFor(() =>
      expect(client.getQueryData([...SUMMARY])).toEqual(
        expect.objectContaining({ isParticipant: false }),
      ),
    );
    unmount();

    expect(remaining(client, ROOM_KEYS)).toEqual([]);
    expect(remaining(client, OTHER_ROOM_KEYS)).toEqual(
      Object.keys(OTHER_ROOM_KEYS),
    );
  });

  it("#323 AC-2 取りすぎの防止: ほかの人を外した（自分は参加者のまま）ときは、部屋の中身を取り除かない", async () => {
    const { client, result } = setup();
    let done = false;

    act(() =>
      result.current.removeUser(participant(OTHER_USER), false, () => {
        done = true;
      }),
    );
    await waitFor(() => expect(done).toBe(true));

    expect(remaining(client, ROOM_KEYS)).toEqual(Object.keys(ROOM_KEYS));
    expect(client.getQueryData([...DETAIL])).toBeDefined();
  });
});
