// #323 #308：参加者でなくなった人のキャッシュに、参加者だけの中身（詳細・やり取り・スレッド・TODO の一覧・履歴・削除済み・添付の一覧）が残らないこと。
// 資格を失うきっかけ (a) 中身の拒否（403）→ 概要の取り直しで非参加、(b) 概要の取り直しが先に非参加、の両方で確かめる。
// あわせて、取りすぎ（参加者のまま・ほかの案件・ほかの利用者・全員に見える概要と一覧）と、参加者に戻ったときの取り直しも確かめる。
// 否定の確認が空振りしないよう、外される前に、その中身がキャッシュにあることを先に確かめる。
// キーは期待の独立のため、配列で直接書く。データは架空（testuser_323_・[UNIT_TEST]）。
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useCaseAccessLoss } from "./useCaseAccessLoss";

const USER = "01JTESTUSER323000000000AU1";
const OTHER_USER = "01JTESTUSER323000000000AU2";
const CASE = "01JTESTCASE323000000000001";
const OTHER_CASE = "01JTESTCASE323000000000002";
const ROOM = "01JTESTROOM323000000000001";
const TODO_1 = "01JTESTTODO323000000000001";
const PARENT = "01JTESTMSG3230000000000001";

const SECRET = "[UNIT_TEST]323参加者だけの中身";

/** 参加者だけの中身を持つキー（この案件・この利用者） */
const PARTICIPANT_ONLY = {
  detail: ["cases", "detail", USER, CASE],
  todos: ["cases", "todos", USER, CASE],
  attachments: ["cases", "attachments", USER, CASE],
  todoEvents: ["cases", "todoEvents", USER, CASE, TODO_1],
  deletedTodos: ["cases", "deletedTodos", USER, CASE],
  roomMessages: ["messages", "room", ROOM],
  thread: ["messages", "thread", PARENT],
} as const;

const SUMMARY = ["cases", "summary", USER, CASE] as const;
const LIST_ALL = ["cases", "list", USER, "all", "active"] as const;

/** 取り除いてはいけないキー（ほかの案件・ほかの利用者の中身） */
const UNRELATED = {
  otherCaseDetail: ["cases", "detail", USER, OTHER_CASE],
  otherCaseTodos: ["cases", "todos", USER, OTHER_CASE],
  otherCaseAttachments: ["cases", "attachments", USER, OTHER_CASE],
  otherUserDetail: ["cases", "detail", OTHER_USER, CASE],
  otherUserTodos: ["cases", "todos", OTHER_USER, CASE],
  otherUserAttachments: ["cases", "attachments", OTHER_USER, CASE],
} as const;

const forbidden = { status: 403, code: "FORBIDDEN", message: "forbidden" };

function summary(isParticipant: boolean, canManage = false) {
  return {
    id: CASE,
    title: "[UNIT_TEST]323件名",
    isParticipant,
    canManage,
    canEditDueDate: canManage,
    participantCount: 3,
    lastActivityAt: isParticipant ? "2026-11-20T00:00:00.000Z" : null,
    channelId: isParticipant ? ROOM : null,
  };
}

const content = (label: string) => ({ label, secret: SECRET });

function setup({ canManage = false }: { canManage?: boolean } = {}) {
  const server = { participant: true };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // 概要の取り直し（確かめ）が、サーバーの今の参加の状態を返す
  client.setQueryDefaults([...SUMMARY], {
    queryFn: () => Promise.resolve(summary(server.participant, canManage)),
  });
  client.setQueryData([...SUMMARY], summary(true, canManage));
  client.setQueryData([...LIST_ALL], {
    pages: [{ items: [summary(true, canManage)] }],
    pageParams: [null],
  });
  for (const [label, key] of Object.entries(PARTICIPANT_ONLY))
    client.setQueryData([...key], content(label));
  client.setQueryData(
    ["message-mention-candidates", ROOM, ""],
    content("mention"),
  );
  for (const [label, key] of Object.entries(UNRELATED))
    client.setQueryData([...key], content(label));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const onLost = () => undefined;
  const view = renderHook(
    ({ isParticipant }: { isParticipant: boolean }) =>
      useCaseAccessLoss({
        caseId: CASE,
        userId: USER,
        roomId: ROOM,
        isParticipant,
        onLost,
      }),
    { wrapper, initialProps: { isParticipant: true } },
  );
  return { client, server, ...view };
}

const dataOf = (client: QueryClient, key: readonly string[]) =>
  client.getQueryData([...key]);

/** 中身が取り出せるキーの名前 */
const leftovers = (client: QueryClient) =>
  Object.entries(PARTICIPANT_ONLY)
    .filter(([, key]) => dataOf(client, key) !== undefined)
    .map(([label]) => label);

function expectPresentBeforeRemoval(client: QueryClient) {
  expect(leftovers(client)).toEqual(Object.keys(PARTICIPANT_ONLY));
}

function expectUnrelatedKept(client: QueryClient) {
  for (const key of Object.values(UNRELATED))
    expect(dataOf(client, key)).toEqual(
      expect.objectContaining({ secret: SECRET }),
    );
}

/** (a) 中身（TODO の一覧）の取り直しが 403 で拒否される */
async function rejectTodos(client: QueryClient) {
  await client
    .fetchQuery({
      queryKey: [...PARTICIPANT_ONLY.todos],
      queryFn: () => Promise.reject(forbidden),
      staleTime: 0,
    })
    .catch(() => undefined);
}

describe("#323 #308 (b) 概要の取り直しが先に非参加を返したとき、参加者だけの中身のキャッシュを取り除く", () => {
  it("#323 AC-1 (b): 詳細・TODO の一覧・添付の一覧・履歴・削除済み・部屋のメッセージ・スレッドの中身が、キャッシュから取り出せない", () => {
    const { client, rerender } = setup();
    expectPresentBeforeRemoval(client);

    client.setQueryData([...SUMMARY], summary(false));
    rerender({ isParticipant: false });

    expect(leftovers(client)).toEqual([]);
  });

  it("#323 AC-1 (b): 部屋の参加者の名前（メンションの候補）も、キャッシュから取り出せない", () => {
    const { client, rerender } = setup();
    const mention = ["message-mention-candidates", ROOM, ""];
    expect(dataOf(client, mention)).toBeDefined();

    client.setQueryData([...SUMMARY], summary(false));
    rerender({ isParticipant: false });

    expect(dataOf(client, mention)).toBeUndefined();
  });

  it("#323 AC-2 (b) 取りすぎの防止: ほかの案件・ほかの利用者の中身と、全員に見える概要・一覧は残る", () => {
    const { client, rerender } = setup();

    client.setQueryData([...SUMMARY], summary(false));
    rerender({ isParticipant: false });

    expectUnrelatedKept(client);
    expect(dataOf(client, SUMMARY)).toEqual(
      expect.objectContaining({ id: CASE, isParticipant: false }),
    );
    expect(dataOf(client, LIST_ALL)).toBeDefined();
  });

  it("#323 AC-3 (b) 管理の資格が残る人（担当部署のオーナー）: 参加者だけの中身は残らず、概要（管理者に見える項目）は残る", () => {
    const { client, rerender } = setup({ canManage: true });
    expectPresentBeforeRemoval(client);

    client.setQueryData([...SUMMARY], summary(false, true));
    rerender({ isParticipant: false });

    expect(leftovers(client)).toEqual([]);
    expect(dataOf(client, SUMMARY)).toEqual(
      expect.objectContaining({
        canManage: true,
        canEditDueDate: true,
        participantCount: 3,
      }),
    );
  });
});

describe("#323 #308 (a) の後に、開いていた部品の描き直しでキーが作り直されても、前の中身を残さない", () => {
  it("#323 AC-1 (a) 作り直し: 拒否の後に取り除いた TODO の一覧が、描き直しで作り直されて前の中身を受け取っても、非参加の描画の後には取り出せない", async () => {
    const server = {
      participant: true,
      todos: "forbidden" as "forbidden" | "old",
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryDefaults([...SUMMARY], {
      queryFn: () => Promise.resolve(summary(server.participant)),
    });
    client.setQueryData([...SUMMARY], summary(true));
    const todosKey = [...PARTICIPANT_ONLY.todos];
    // 外される前：TODO の一覧の中身がキャッシュにある
    client.setQueryData(todosKey, content("todos"));
    expect(dataOf(client, todosKey)).toBeDefined();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const onLost = () => undefined;
    const { rerender, unmount } = renderHook(
      ({ isParticipant }: { isParticipant: boolean }) => {
        // 開いていた TODO の一覧の部品（参加者の間だけ取りにいく）
        useQuery({
          queryKey: todosKey,
          queryFn: () =>
            server.todos === "forbidden"
              ? Promise.reject(forbidden)
              : Promise.resolve(content("todos")),
          enabled: isParticipant,
          staleTime: 0,
        });
        return useCaseAccessLoss({
          caseId: CASE,
          userId: USER,
          roomId: ROOM,
          isParticipant,
          onLost,
        });
      },
      { wrapper, initialProps: { isParticipant: true } },
    );
    server.participant = false;
    // 最初の取得が 403 → 確かめ → 非参加 → 取り除く（(a) が動いたことを先に確かめる）
    await waitFor(() =>
      expect(dataOf(client, SUMMARY)).toEqual(
        expect.objectContaining({ isParticipant: false }),
      ),
    );
    // 部品が付いているため、キー自体はすぐに作り直されうる。前の中身が取り出せないことを確かめる
    expect(dataOf(client, todosKey)).toBeUndefined();

    // 概要の更新が画面に届く前に、まだ参加者として描かれている部品が取り直し（ポーリング等）、作り直されたキーに前の中身が入る
    server.todos = "old";
    rerender({ isParticipant: true });
    await client.refetchQueries({ queryKey: todosKey, exact: true });
    await waitFor(() =>
      expect(dataOf(client, todosKey)).toEqual(
        expect.objectContaining({ secret: SECRET }),
      ),
    );

    rerender({ isParticipant: false });

    await waitFor(() => expect(dataOf(client, todosKey)).toBeUndefined());
    unmount();
  });
});

describe("#323 #308 取りすぎの防止と、参加者に戻ったとき", () => {
  it("#323 AC-2 参加者のまま: 再描画と、参加者のままの 403（概要の取り直しで参加者）では、何も取り除かない", async () => {
    const { client, rerender } = setup();
    rerender({ isParticipant: true });
    await rejectTodos(client);
    await waitFor(() =>
      expect(client.isFetching({ queryKey: [...SUMMARY] })).toBe(0),
    );

    expectPresentBeforeRemoval(client);
    expectUnrelatedKept(client);
  });

  it("#323 AC-2 (a) 取りすぎの防止: 拒否から非参加と分かったとき、ほかの案件・ほかの利用者の中身は残り、この案件の中身は取り出せない", async () => {
    const { client, server } = setup();
    server.participant = false;
    await rejectTodos(client);
    await waitFor(() => expect(leftovers(client)).toEqual([]));
    expectUnrelatedKept(client);
  });

  it("#323 AC-4 参加者に戻った（外されて、もう一度足された）: 中身を取り直せて、戻った後の描画で取り除かれない", () => {
    const { client, rerender } = setup();
    client.setQueryData([...SUMMARY], summary(false));
    rerender({ isParticipant: false });

    client.setQueryData([...SUMMARY], summary(true));
    rerender({ isParticipant: true });
    for (const [label, key] of Object.entries(PARTICIPANT_ONLY))
      client.setQueryData([...key], content(label));
    rerender({ isParticipant: true });

    expectPresentBeforeRemoval(client);
  });
});

describe("#323 #308 実際の呼び出し方（roomId を詳細の channelId から求める）で、部屋の中身を取り除く", () => {
  it("#323 AC-1 (b) 呼び出し方どおり: 非参加に変わる描画でも、roomId は詳細のキャッシュから求まり、部屋のメッセージ・スレッド・メンションの候補が取り出せない", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData([...SUMMARY], summary(true));
    client.setQueryData([...PARTICIPANT_ONLY.detail], {
      ...content("detail"),
      channelId: ROOM,
    });
    const roomKeys = [
      PARTICIPANT_ONLY.roomMessages,
      PARTICIPANT_ONLY.thread,
      ["message-mention-candidates", ROOM, ""],
      ["message-mention-candidates", ROOM, "testuser"],
    ] as const;
    for (const key of roomKeys) client.setQueryData([...key], content("room"));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const onLost = () => undefined;
    const roomIdsWhenOutsider: (string | null)[] = [];
    const { rerender } = renderHook(
      ({ isParticipant }: { isParticipant: boolean }) => {
        // CaseDetailView と同じ：詳細は参加者の間だけ取りにいき、部屋の ID は詳細の channelId（概要の channelId ではない）
        const detail = useQuery<{ channelId: string }>({
          queryKey: [...PARTICIPANT_ONLY.detail],
          queryFn: () => new Promise(() => undefined),
          enabled: isParticipant,
        });
        const roomId = detail.data?.channelId ?? null;
        if (!isParticipant) roomIdsWhenOutsider.push(roomId);
        return useCaseAccessLoss({
          caseId: CASE,
          userId: USER,
          roomId,
          isParticipant,
          onLost,
        });
      },
      { wrapper, initialProps: { isParticipant: true } },
    );
    // 外される前：部屋の中身がキャッシュにある
    for (const key of roomKeys) expect(dataOf(client, key)).toBeDefined();

    // 概要が先に非参加（channelId も null）を返す
    client.setQueryData([...SUMMARY], summary(false));
    rerender({ isParticipant: false });

    // 非参加に変わった描画でも、部屋の ID は保たれていた（詳細のデータは、取得を止めてもキャッシュに残るため）
    expect(roomIdsWhenOutsider[0]).toBe(ROOM);
    expect(roomKeys.filter((key) => dataOf(client, key) !== undefined)).toEqual(
      [],
    );
  });
});
