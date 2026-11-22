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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  noteDraftsRemain,
  requestAccessLossReload,
} from "../../access-loss/reload-after-access-loss";
import { authKeys } from "../../auth";
import { TEST_USER } from "../../../test/auth-handlers";
import { server } from "../../../test/server";
import type { CaseParticipant } from "../api/case-api";
import { useCaseAccessLoss } from "./useCaseAccessLoss";
import { useRemoveCaseParticipant } from "./useCaseWrites";
import { useParticipantWrites } from "./useParticipantWrites";

// #340：読み込み直しの入口（test/setup.ts と同じ vi.fn）に加え、消せなかったことの印 noteDraftsRemain も vi.fn にする
vi.mock(
  "../../access-loss/reload-after-access-loss",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    requestAccessLossReload: vi.fn(() => Promise.resolve()),
    noteDraftsRemain: vi.fn(),
  }),
);

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

// #340 AC-1 (c)・AC-2・AC-3・AC-5（利用者の決定 Q1：本人の退出でも消す。Q3：消せなかったら知らせる）：
// 本人の退出の成功で、操作した利用者（actorId）の、その案件の部屋の下書き（部屋への投稿・その部屋のスレッドの返信）を端末から消す。
// 表示中の (b) の経路（概要が非参加に書き換わる）と切り分けるため、useCaseAccessLoss を使わず、useRemoveCaseParticipant だけを描く。
// 前提にした口（実装の担当へ）：onSuccess（self のとき）で、入口 requestAccessLossReload と片付けの後に、
//   forgetCaseRoomDrafts(actorId, input.roomId) を呼び、failed なら noteDraftsRemain(actorId) を呼ぶ。
// キーはリテラルで独立に書く。データは架空（[UNIT_TEST]）。
describe("#340 本人の退出の成功で、その案件の部屋の下書きを消す", () => {
  const keyOf = (userId: string, scope: string) =>
    `internal-system:draft:v1:${userId}:${scope}`;
  const ERASED = [
    keyOf(USER, `room:${ROOM}`),
    keyOf(USER, `thread:${ROOM}:${PARENT}`),
    keyOf(USER, `thread:${ROOM}:01JTESTMSG34000000000000LX`),
  ];
  const KEPT = [
    keyOf(USER, `room:${OTHER_ROOM}`),
    keyOf(USER, `room:${ROOM}0`),
    keyOf(USER, "case-request:new"),
    keyOf(OTHER_USER, `room:${ROOM}`),
    keyOf(OTHER_USER, `thread:${ROOM}:${PARENT}`),
  ];
  const present = (list: string[]) =>
    list.filter((key) => window.localStorage.getItem(key) !== null);

  function failDraftRemoval(error: unknown) {
    const original = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (
        this === window.localStorage &&
        key.startsWith("internal-system:draft:")
      )
        throw error;
      original.call(this, key);
    });
  }

  function leaveSetup(response: () => Response | Promise<Response>) {
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
    server.use(
      http.delete("/api/cases/:caseId/participants/:userId", response),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useRemoveCaseParticipant(CASE), { wrapper });
    const leave = () =>
      view.result.current.mutateAsync({
        userId: USER,
        self: true,
        actorId: USER,
        roomId: ROOM,
      });
    return { client, leave, ...view };
  }

  beforeEach(() => {
    for (const key of [...ERASED, ...KEPT])
      window.localStorage.setItem(
        key,
        JSON.stringify({
          body: `[UNIT_TEST]340退出の前の書きかけ`,
          updatedAt: Date.now(),
        }),
      );
    vi.mocked(requestAccessLossReload).mockClear();
    vi.mocked(noteDraftsRemain).mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("#340 AC-1 (c) Q1: 退出に成功すると、操作した利用者の、その部屋の投稿とスレッドの返信の下書きが消える。ほかの部屋・前方一致の部屋・申請・ほかの利用者の下書きは残る", async () => {
    const { leave } = leaveSetup(() => new HttpResponse(null, { status: 204 }));
    await act(async () => {
      await leave();
    });
    expect(present(ERASED)).toEqual([]);
    expect(present(KEPT)).toEqual(KEPT);
    expect(noteDraftsRemain).not.toHaveBeenCalled();
  });

  it("#340 AC-1 (c): 退出の応答の前に画面を離れても（部品が外れても）、成功したら、その部屋の下書きが消える", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { leave, unmount } = leaveSetup(async () => {
      await gate;
      return new HttpResponse(null, { status: 204 });
    });
    const done = leave();
    unmount();
    release();
    await act(async () => {
      await done;
    });
    await waitFor(() => expect(present(ERASED)).toEqual([]));
    expect(present(KEPT)).toEqual(KEPT);
  });

  it.each([
    ["409", 409],
    ["500", 500],
  ] as const)(
    "#340 AC-3: 退出が %s で失敗したら、下書きは残る",
    async (_name, status) => {
      const { leave } = leaveSetup(() =>
        HttpResponse.json(
          { error: { code: "ERROR", message: "[UNIT_TEST]340失敗" } },
          { status },
        ),
      );
      await act(async () => {
        await leave().catch(() => undefined);
      });
      expect(present(ERASED)).toEqual(ERASED);
      expect(present(KEPT)).toEqual(KEPT);
    },
  );

  it("#340 AC-3: ほかの人を外した（self が偽）ときは、自分の下書きは残る", async () => {
    const { result } = leaveSetup(
      () => new HttpResponse(null, { status: 204 }),
    );
    await act(async () => {
      await result.current.mutateAsync({
        userId: OTHER_USER,
        self: false,
        actorId: USER,
        roomId: ROOM,
      });
    });
    expect(present(ERASED)).toEqual(ERASED);
  });

  it("#340 AC-5 D-3 (c): 削除が SecurityError になると、退出は成功のまま、入口が先に呼ばれ、noteDraftsRemain が操作した利用者の ID で呼ばれる", async () => {
    failDraftRemoval(new DOMException("denied", "SecurityError"));
    const { leave } = leaveSetup(() => new HttpResponse(null, { status: 204 }));
    await act(async () => {
      await leave();
    });
    expect(requestAccessLossReload).toHaveBeenCalledTimes(1);
    expect(noteDraftsRemain).toHaveBeenCalledWith(USER);
    const requestOrder =
      vi.mocked(requestAccessLossReload).mock.invocationCallOrder[0] ?? 0;
    const noteOrder =
      vi.mocked(noteDraftsRemain).mock.invocationCallOrder[0] ?? 0;
    expect(requestOrder).toBeLessThan(noteOrder);
  });

  it("#340 AC-5 D-4 (c): 保存先を開けない（localStorage の参照が SecurityError）と、noteDraftsRemain が操作した利用者の ID で呼ばれる", async () => {
    const { leave } = leaveSetup(() => new HttpResponse(null, { status: 204 }));
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    await act(async () => {
      await leave();
    });
    expect(requestAccessLossReload).toHaveBeenCalledTimes(1);
    expect(noteDraftsRemain).toHaveBeenCalledWith(USER);
  });
});
