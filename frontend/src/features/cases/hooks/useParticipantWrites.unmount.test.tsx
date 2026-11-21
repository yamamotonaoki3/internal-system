// #323（PR #328 の絞ったミューテーション診断の生き残りへの追加）：画面が外れたときの後片付け（useParticipantWrites）は、
// 本人の退出に成功したときだけ行う。退出していない（操作していない・退出に失敗した）参加者の画面が外れても、
// 概要は参加のままで、詳細・TODO・添付・部屋のキャッシュを取り除かない（取りすぎの防止）。
// 否定の確認が空振りしないよう、対照として、退出に成功した場合は取り除かれることも同じファイルで確かめる。API は MSW。データは架空（testuser_323_・[UNIT_TEST]）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { authKeys } from "../../auth";
import { TEST_USER } from "../../../test/auth-handlers";
import { server } from "../../../test/server";
import type { CaseParticipant } from "../api/case-api";
import { useParticipantWrites } from "./useParticipantWrites";

const USER = TEST_USER.id;
const CASE = "01JTESTCASE3230000000000UM1";
const ROOM = "01JTESTROOM3230000000000UM1";
const SECRET = "[UNIT_TEST]323外れる前の中身 testuser_323_member";

const SUMMARY = ["cases", "summary", USER, CASE] as const;

/** 参加者だけの中身（取りすぎてはいけない） */
const CONTENT = {
  detail: ["cases", "detail", USER, CASE],
  todos: ["cases", "todos", USER, CASE],
  attachments: ["cases", "attachments", USER, CASE],
  roomMessages: ["messages", "room", ROOM],
  mention: ["message-mention-candidates", ROOM, ""],
} as const;

const summary = () => ({
  id: CASE,
  title: "[UNIT_TEST]323件名",
  isParticipant: true,
  canManage: false,
  canEditDueDate: false,
  participantCount: 2,
  lastActivityAt: "2026-11-20T00:00:00.000Z",
  channelId: ROOM,
});

const self = {
  userId: USER,
  displayName: "testuser_323_self",
} as unknown as CaseParticipant;

const remaining = (client: QueryClient) =>
  Object.entries(CONTENT)
    .filter(([, key]) => client.getQueryData([...key]) !== undefined)
    .map(([label]) => label);

function setup(leaveStatus: number) {
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
  client.setQueryData([...SUMMARY], summary());
  client.setQueryData([...CONTENT.detail], { channelId: ROOM, secret: SECRET });
  for (const key of Object.values(CONTENT))
    if (key !== CONTENT.detail)
      client.setQueryData([...key], { secret: SECRET });
  server.use(
    http.delete("/api/cases/:caseId/participants/:userId", () =>
      leaveStatus === 204
        ? new HttpResponse(null, { status: 204 })
        : HttpResponse.json(
            {
              code: "INTERNAL_ERROR",
              message: "[UNIT_TEST]323サーバーの失敗",
            },
            { status: leaveStatus },
          ),
    ),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/cases/${CASE}`]}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = renderHook(() => useParticipantWrites(CASE), { wrapper });
  // 外れる前：中身がキャッシュにある
  expect(remaining(client)).toEqual(Object.keys(CONTENT));
  return { client, ...view };
}

const isParticipantOf = (client: QueryClient) =>
  client.getQueryData<ReturnType<typeof summary>>([...SUMMARY])?.isParticipant;

describe("#323 退出に成功していない参加者の画面が外れても、中身を取り除かない", () => {
  it("#323 AC-2 操作しないまま画面が外れた: 概要は参加のままで、詳細・TODO・添付・部屋のキャッシュが残る", () => {
    const { client, unmount } = setup(204);

    unmount();

    expect(isParticipantOf(client)).toBe(true);
    expect(remaining(client)).toEqual(Object.keys(CONTENT));
  });

  it("#323 AC-2 退出に失敗した後に画面が外れた: 概要は参加のままで、詳細・TODO・添付・部屋のキャッシュが残る", async () => {
    const { client, result, unmount } = setup(500);
    let done = false;

    act(() =>
      result.current.removeUser(self, true, () => {
        done = true;
      }),
    );
    await waitFor(() => expect(done).toBe(true));
    expect(result.current.error).toBeDefined();
    unmount();

    expect(isParticipantOf(client)).toBe(true);
    expect(remaining(client)).toEqual(Object.keys(CONTENT));
  });

  it("#323 AC-1 対照: 退出に成功した後に画面が外れたら、概要は非参加になり、中身は取り出せない", async () => {
    const { client, result, unmount } = setup(204);
    let done = false;

    act(() =>
      result.current.removeUser(self, true, () => {
        done = true;
      }),
    );
    await waitFor(() => expect(done).toBe(true));
    unmount();

    await waitFor(() => expect(remaining(client)).toEqual([]));
    expect(isParticipantOf(client)).toBe(false);
  });
});
