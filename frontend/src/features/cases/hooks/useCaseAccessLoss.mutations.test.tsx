// #323 コードレビュー1回目 重大3：参加者でなくなったら、この案件の「完了した」操作の応答・変数（TODO の題名・担当者の名前・案件の説明）が、
// MutationCache から取り出せないこと。進行中の操作は取り消さず残す（ADR-0030：進行中の mutation の後処理を止めない）。ほかの案件の操作は残す。
// 資格を失うきっかけ (a) 中身の拒否（403）→ 概要の取り直しで非参加、(b) 概要の取り直しが先に非参加、の両方で確かめる。
// 否定の確認が空振りしないよう、外される前に、その中身が MutationCache にあることを先に確かめる。API は MSW。データはすべて架空（testuser_323_・[UNIT_TEST]）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "../../../test/server";
import { useCaseAccessLoss } from "./useCaseAccessLoss";
import {
  useAddCaseTodo,
  useEditCaseTodo,
  useRestoreCaseTodo,
} from "./useCaseTodoWrites";
import { useEditCase } from "./useCaseWrites";

const USER = "01JTESTUSER323000000000MU1";
const CASE = "01JTESTCASE323000000000MU1";
const OTHER_CASE = "01JTESTCASE323000000000MU2";
const ROOM = "01JTESTROOM323000000000MU1";
const TODO = "01JTESTTODO323000000000MU1";

const ADDED_TITLE = "[UNIT_TEST]323追加した題名";
const EDITED_TITLE = "[UNIT_TEST]323編集した題名";
const RESTORED_TITLE = "[UNIT_TEST]323復元した題名";
const ASSIGNEE_NAME = "testuser_323_担当者";
/** ほかの案件の応答の担当者（この案件の中身と、文字列で区別できるようにする） */
const OTHER_CASE_ASSIGNEE_NAME = "testuser_323_other_ほかの案件の担当者";
const DESCRIPTION = "[UNIT_TEST]323案件の説明";
const PENDING_TITLE = "[UNIT_TEST]323送信中の題名";
const OTHER_CASE_TITLE = "[UNIT_TEST]323ほかの案件の題名";

const SECRETS = [
  ADDED_TITLE,
  EDITED_TITLE,
  RESTORED_TITLE,
  ASSIGNEE_NAME,
  DESCRIPTION,
];

const SUMMARY = ["cases", "summary", USER, CASE] as const;
const TODOS = ["cases", "todos", USER, CASE] as const;

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

const todoResponse = (title: string, assigneeName = ASSIGNEE_NAME) => ({
  id: TODO,
  title,
  completed: false,
  version: 2,
  assignee: { userId: USER, displayName: assigneeName, isActive: true },
  previousAssignee: null,
  completedAssignee: null,
  progress: { done: 0, total: 1 },
});

/** MutationCache の全データ（応答・変数）を1つの文字列にする（DevTools で見える中身の代わり） */
function mutationText(client: QueryClient): string {
  return client
    .getMutationCache()
    .getAll()
    .map((mutation) =>
      JSON.stringify([
        mutation.state.data ?? null,
        mutation.state.variables ?? null,
      ]),
    )
    .join("\n");
}

const releases: (() => void)[] = [];
afterEach(() => {
  // 送信中のまま残した応答を返し、テストの後に処理を残さない
  for (const release of releases.splice(0)) release();
});

function setup() {
  const state = { participant: true };
  server.use(
    http.post("/api/cases/:caseId/todos", async ({ request, params }) => {
      const body = (await request.json()) as { title: string };
      if (body.title === PENDING_TITLE)
        await new Promise<void>((resolve) => releases.push(resolve));
      return HttpResponse.json(
        todoResponse(
          body.title,
          params.caseId === OTHER_CASE
            ? OTHER_CASE_ASSIGNEE_NAME
            : ASSIGNEE_NAME,
        ),
      );
    }),
    http.patch("/api/cases/:caseId/todos/:todoId", () =>
      HttpResponse.json(todoResponse(EDITED_TITLE)),
    ),
    http.post("/api/cases/:caseId/todos/:todoId/restore", () =>
      HttpResponse.json(todoResponse(RESTORED_TITLE)),
    ),
    http.patch("/api/cases/:caseId", ({ params }) =>
      HttpResponse.json({ caseId: params.caseId, titleFormatted: false }),
    ),
  );
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryDefaults([...SUMMARY], {
    queryFn: () => Promise.resolve(summary(state.participant)),
  });
  client.setQueryData([...SUMMARY], summary(true));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const onLost = () => undefined;
  const view = renderHook(
    ({ isParticipant }: { isParticipant: boolean }) => {
      useCaseAccessLoss({
        caseId: CASE,
        userId: USER,
        roomId: ROOM,
        isParticipant,
        onLost,
      });
      return {
        add: useAddCaseTodo(CASE),
        edit: useEditCaseTodo(CASE, () => undefined),
        restore: useRestoreCaseTodo(CASE, () => undefined),
        editCase: useEditCase(CASE),
        addOther: useAddCaseTodo(OTHER_CASE),
      };
    },
    { wrapper, initialProps: { isParticipant: true } },
  );
  return { client, state, ...view };
}

type View = ReturnType<typeof setup>;

/** TODO の追加・編集・復元と、案件の編集を完了させる */
async function completeWrites({ result }: View) {
  await act(async () => {
    await result.current.add.mutateAsync({
      title: ADDED_TITLE,
      assigneeUserId: USER,
    });
    await result.current.edit.mutateAsync({
      todoId: TODO,
      body: { title: EDITED_TITLE, version: 1 } as never,
    });
    await result.current.restore.mutateAsync(TODO);
    await result.current.editCase.mutateAsync({
      description: DESCRIPTION,
      version: 1,
    });
  });
}

async function lose(trigger: "a" | "b", view: View) {
  if (trigger === "b") {
    view.client.setQueryData([...SUMMARY], summary(false));
    view.rerender({ isParticipant: false });
    return;
  }
  view.state.participant = false;
  await view.client
    .fetchQuery({
      queryKey: [...TODOS],
      queryFn: () => Promise.reject(forbidden),
      staleTime: 0,
    })
    .catch(() => undefined);
  await waitFor(() =>
    expect(view.client.getQueryData([...SUMMARY])).toEqual(
      expect.objectContaining({ isParticipant: false }),
    ),
  );
  view.rerender({ isParticipant: false });
}

describe.each(["a", "b"] as const)(
  "#323 コードレビュー1回目 重大3 (%s) 完了した操作の MutationCache に、参加者だけの中身を残さない",
  (trigger) => {
    it(`#323 AC-1 (${trigger}): TODO の追加・編集・復元と案件の編集を完了させた後に外されたら、題名・担当者の名前・説明が MutationCache から取り出せない`, async () => {
      const view = setup();
      await completeWrites(view);
      // 外される前：完了した操作の応答・変数に、中身がある
      for (const text of SECRETS)
        expect(mutationText(view.client)).toContain(text);

      await lose(trigger, view);

      await waitFor(() => {
        const cached = mutationText(view.client);
        expect(SECRETS.filter((text) => cached.includes(text))).toEqual([]);
      });
    });

    it(`#323 AC-2 (${trigger}) 取りすぎの防止: 進行中の操作は取り消さず残り、ほかの案件の完了した操作も残る`, async () => {
      const view = setup();
      await act(async () => {
        await view.result.current.addOther.mutateAsync({
          title: OTHER_CASE_TITLE,
          assigneeUserId: null,
        });
      });
      let pendingSettled = false;
      act(() => {
        view.result.current.add.mutate(
          { title: PENDING_TITLE, assigneeUserId: null },
          { onSettled: () => (pendingSettled = true) },
        );
      });
      await waitFor(() => expect(releases).toHaveLength(1));
      expect(
        view.client
          .getMutationCache()
          .findAll({ mutationKey: ["caseTodoWrite", CASE], status: "pending" }),
      ).toHaveLength(1);

      await lose(trigger, view);

      expect(
        view.client
          .getMutationCache()
          .findAll({ mutationKey: ["caseTodoWrite", CASE], status: "pending" }),
      ).toHaveLength(1);
      expect(mutationText(view.client)).toContain(OTHER_CASE_TITLE);
      // 進行中の操作は、応答が届けば最後まで進む（取り消されていない）
      for (const release of releases.splice(0)) release();
      await waitFor(() => expect(pendingSettled).toBe(true));
    });
  },
);

// ---- 実装の担当の報告（経路2）：進行中だった操作が、後片付けの後に完了したとき ----

describe.each(["a", "b"] as const)(
  "#323 経路2 (%s) 後片付けの後に完了した操作の結果を、MutationCache に残さない",
  (trigger) => {
    it(`#323 AC-1 AC-2 (${trigger}) 経路2: 送信中の TODO の追加・案件の編集が、外された後に完了しても、題名・担当者の名前・説明が残らない。操作は最後まで進み、ほかの案件の操作は残る`, async () => {
      const view = setup();
      server.use(
        http.patch("/api/cases/:caseId", async ({ params }) => {
          await new Promise<void>((resolve) => releases.push(resolve));
          return HttpResponse.json({
            caseId: params.caseId,
            titleFormatted: false,
          });
        }),
      );
      await act(async () => {
        await view.result.current.addOther.mutateAsync({
          title: OTHER_CASE_TITLE,
          assigneeUserId: null,
        });
      });
      const succeeded: string[] = [];
      act(() => {
        view.result.current.add.mutate(
          { title: PENDING_TITLE, assigneeUserId: USER },
          { onSuccess: () => succeeded.push("todo") },
        );
        view.result.current.editCase.mutate(
          { description: DESCRIPTION, version: 1 },
          { onSuccess: () => succeeded.push("case") },
        );
      });
      await waitFor(() => expect(releases).toHaveLength(2));
      // 外される前：送信中の操作の変数に、中身がある
      for (const text of [PENDING_TITLE, DESCRIPTION])
        expect(mutationText(view.client)).toContain(text);

      await lose(trigger, view);
      for (const release of releases.splice(0)) release();

      // 操作は取り消されず、成功の後処理まで進む（ADR-0030）
      await waitFor(() => expect(succeeded.sort()).toEqual(["case", "todo"]));
      await waitFor(() => {
        const cached = mutationText(view.client);
        expect(
          [PENDING_TITLE, ASSIGNEE_NAME, DESCRIPTION].filter((text) =>
            cached.includes(text),
          ),
        ).toEqual([]);
      });
      expect(mutationText(view.client)).toContain(OTHER_CASE_TITLE);
      expect(mutationText(view.client)).toContain(OTHER_CASE_ASSIGNEE_NAME);
    });
  },
);
