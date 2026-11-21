// #323 経路1（PR #328 の絞ったミューテーション診断の生き残りへの追加）：拒否（403）を受けて概要を取り直して確かめている途中に画面を離れ、
// その後に確かめの結果が届いたときの片付けを、結果ごとに分ける（docs/design/cases.md「資格の喪失の後片付け」）。
// - 非参加（lost）：概要と一覧を非参加の形にし、中身を取り除く（既存の useCaseAccessLoss.forget.test.tsx の経路1）
// - 404・確かめられない：概要と一覧は変えず（既存の表示に任せる）、中身だけを取り除く
// - 参加者のまま：何も取り除かない
// 否定の確認が空振りしないよう、先に中身があることを確かめる。キーは期待の独立のため、配列で直接書く。データは架空（testuser_323_・[UNIT_TEST]）。
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useCaseAccessLoss } from "./useCaseAccessLoss";

const USER = "01JTESTUSER323000000000AF1";
const CASE = "01JTESTCASE323000000000AF1";
const ROOM = "01JTESTROOM323000000000AF1";
const PARENT = "01JTESTMSG3230000000000AF1";
const SECRET = "[UNIT_TEST]323参加者だけの中身 testuser_323_member";

const SUMMARY = ["cases", "summary", USER, CASE] as const;
const LIST_ALL = ["cases", "list", USER, "all", "active"] as const;
const LIST_JOINED = ["cases", "list", USER, "joined", "active"] as const;

const CONTENT = {
  detail: ["cases", "detail", USER, CASE],
  todos: ["cases", "todos", USER, CASE],
  attachments: ["cases", "attachments", USER, CASE],
  roomMessages: ["messages", "room", ROOM],
  thread: ["messages", "thread", PARENT],
  mention: ["message-mention-candidates", ROOM, ""],
  channelDetail: ["channels", "detail", ROOM],
} as const;

const forbidden = { status: 403, code: "FORBIDDEN", message: "forbidden" };

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

type Row = ReturnType<typeof summary>;

const remaining = (client: QueryClient) =>
  Object.entries(CONTENT)
    .filter(([, key]) => client.getQueryData([...key]) !== undefined)
    .map(([label]) => label);

const rows = (client: QueryClient, key: readonly string[]) =>
  (
    client.getQueryData<InfiniteData<{ items: Row[] }>>([...key])?.pages ?? []
  ).flatMap((page) => page.items);

/** 確かめ（概要の取り直し）の途中で画面を離れ、answer で結果を返せる状態にする */
async function leaveWhileVerifying() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  let answer: (outcome: { data: Row } | { error: unknown }) => void = () =>
    undefined;
  client.setQueryDefaults([...SUMMARY], {
    queryFn: () =>
      new Promise((resolve, reject) => {
        answer = (outcome) =>
          "data" in outcome ? resolve(outcome.data) : reject(outcome.error);
      }),
  });
  client.setQueryData([...SUMMARY], summary(true));
  for (const key of [LIST_ALL, LIST_JOINED])
    client.setQueryData([...key], {
      pages: [{ items: [summary(true)] }],
      pageParams: [null],
    });
  for (const [label, key] of Object.entries(CONTENT))
    client.setQueryData([...key], {
      label,
      secret: SECRET,
      parent: { id: PARENT, roomId: ROOM },
    });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const onLost = () => undefined;
  const view = renderHook(
    () =>
      useCaseAccessLoss({
        caseId: CASE,
        userId: USER,
        roomId: ROOM,
        isParticipant: true,
        onLost,
      }),
    { wrapper },
  );
  expect(remaining(client)).toEqual(Object.keys(CONTENT));
  // TODO の一覧の取り直しが 403 → 概要の取り直し（確かめ）が始まる
  await client
    .fetchQuery({
      queryKey: [...CONTENT.todos],
      queryFn: () => Promise.reject(forbidden),
      staleTime: 0,
    })
    .catch(() => undefined);
  await waitFor(() =>
    expect(client.isFetching({ queryKey: [...SUMMARY] })).toBe(1),
  );
  view.unmount();
  return {
    client,
    answer: (outcome: Parameters<typeof answer>[0]) => answer(outcome),
  };
}

const expectSummaryAndListsUnchanged = (client: QueryClient) => {
  expect(client.getQueryData([...SUMMARY])).toEqual(summary(true));
  expect(rows(client, LIST_ALL)).toEqual([summary(true)]);
  expect(rows(client, LIST_JOINED)).toEqual([summary(true)]);
};

describe("#323 経路1 画面を離れた後に届いた確かめの結果で、片付けを分ける", () => {
  it("#323 AC-1 / AC-2 404: 概要と一覧（参加中・すべて）は変えず、中身（詳細・TODO・添付・部屋のメッセージ・スレッド・メンションの候補・チャンネルの詳細）だけが取り出せない", async () => {
    const { client, answer } = await leaveWhileVerifying();

    answer({
      error: { status: 404, code: "NOT_FOUND", message: "not found" },
    });

    await waitFor(() => expect(remaining(client)).toEqual([]));
    expectSummaryAndListsUnchanged(client);
  });

  it("#323 AC-1 / AC-2 確かめられない（5xx）: 概要と一覧は変えず、中身だけが取り出せない", async () => {
    const { client, answer } = await leaveWhileVerifying();

    answer({
      error: { status: 503, code: "UNAVAILABLE", message: "unavailable" },
    });

    await waitFor(() => expect(remaining(client)).toEqual([]));
    expectSummaryAndListsUnchanged(client);
  });

  it("#323 AC-2 参加者のまま: 案件・部屋のキャッシュは、何も取り除かない", async () => {
    const { client, answer } = await leaveWhileVerifying();

    answer({ data: summary(true) });

    await waitFor(() =>
      expect(client.isFetching({ queryKey: [...SUMMARY] })).toBe(0),
    );
    expect(client.getQueryState([...SUMMARY])?.status).toBe("success");
    // 取り直しの完了の後に、判定（settle）が走り終わるまで、マイクロタスクを流し切る
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(remaining(client)).toEqual(Object.keys(CONTENT));
    expectSummaryAndListsUnchanged(client);
  });

  it("#323 AC-1 対照 非参加: 概要と一覧を非参加の形にし、中身が取り出せない", async () => {
    const { client, answer } = await leaveWhileVerifying();

    answer({ data: summary(false) });

    await waitFor(() => expect(remaining(client)).toEqual([]));
    expect(client.getQueryData([...SUMMARY])).toEqual(
      expect.objectContaining({ isParticipant: false, channelId: null }),
    );
    expect(rows(client, LIST_JOINED)).toEqual([]);
  });
});
