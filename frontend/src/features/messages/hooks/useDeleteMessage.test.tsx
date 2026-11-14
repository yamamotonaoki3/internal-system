// #134 AC-1（1-3 AC-4）: useDeleteMessage(roomId) — 再認証（必要なら）を挟んでメッセージを削除する。API は MSW。データは架空。
// 契約（計画 plan-134 の「8. 画面」・設計書 message-edit-markdown.md・describe-error.ts の NotSentError）：
//   mutate(messageId) は withReauth("メッセージの削除", …) の中で DELETE /api/messages/:messageId を送る（再認証のダイアログの見出しは「メッセージの削除の再認証」）。
//   再認証が完了しなかった（キャンセル）ときは、要求を送らず、NotSentError（cause に再認証の失敗の原因）で失敗にする。
//   要求を送った後の失敗（サーバーのエラー）は、NotSentError に包まず、そのまま（ApiError）伝える。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { TEST_PASSWORD } from "../../../test/auth-handlers";
import {
  ROOM_ID,
  apiErrorResponse,
  message,
} from "../../../test/message-handlers";
import { server } from "../../../test/server";
import { authKeys } from "../../auth";
import { ReauthProvider } from "../../auth/ReauthProvider";
import { NotSentError } from "../describe-error";
import { useDeleteMessage } from "./useDeleteMessage";

const MESSAGE_ID = message(1).id;

function setup(reauthenticatedAt: string | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(authKeys.session, {
    user: {
      id: "01JTESTUSER000000000000001",
      displayName: "testuser_001",
      loginId: "testuser_001",
    },
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReauthProvider>{children}</ReauthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => useDeleteMessage(ROOM_ID), { wrapper });
}

/** DELETE の要求を記録し、指定の応答を返す */
function respondDelete(respond: () => Response) {
  const deletes: string[] = [];
  server.use(
    http.delete("/api/messages/:messageId", ({ params }) => {
      deletes.push(String(params.messageId));
      return respond();
    }),
  );
  return deletes;
}

/** mutateAsync の失敗を受け取る（成功したらテストを失敗にする） */
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  const outcome = await promise.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  if (outcome.ok) throw new Error("失敗するはずの削除が成功しました");
  return outcome.error;
}

const recently = () => new Date(Date.now() - 60_000).toISOString();

describe("#134 AC-1（1-3 AC-4）useDeleteMessage", () => {
  it("#134 AC-1（1-3 AC-4）: 再認証のダイアログを「メッセージの削除の再認証」の見出しで出し、キャンセルすると要求を送らず、cause 付きの NotSentError で失敗にする", async () => {
    const deletes = respondDelete(
      () => new HttpResponse(null, { status: 204 }),
    );
    const { result } = setup(null);
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = failureOf(result.current.mutateAsync(MESSAGE_ID));
    });
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    expect(within(reauth).getByRole("heading", { level: 2 }).textContent).toBe(
      "メッセージの削除の再認証",
    );
    await userEvent
      .setup()
      .click(within(reauth).getByRole("button", { name: "キャンセル" }));

    const error = await pending;
    expect(error).toBeInstanceOf(NotSentError);
    // 再認証の失敗の原因を、cause に残す（もみ消さない）
    const cause = (error as NotSentError).cause;
    expect(cause).toBeInstanceOf(Error);
    expect(cause).not.toBeInstanceOf(NotSentError);
    expect(deletes).toEqual([]);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(error);
  });

  it("#134 AC-1（1-3 AC-4）: 再認証が済んでいて要求を送った後にサーバーが失敗したら、NotSentError に包まず、その失敗（ApiError）をそのまま伝える", async () => {
    const deletes = respondDelete(() =>
      apiErrorResponse(
        500,
        "INTERNAL",
        "一時的に削除できませんでした（テスト）",
      ),
    );
    const { result } = setup(recently());
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = failureOf(result.current.mutateAsync(MESSAGE_ID));
    });
    const error = await pending;
    expect(deletes).toEqual([MESSAGE_ID]);
    expect(error).not.toBeInstanceOf(NotSentError);
    expect(error).toMatchObject({
      status: 500,
      message: "一時的に削除できませんでした（テスト）",
    });
  });

  it("#134 AC-1（1-3 AC-4）: 再認証を経て要求を送った後にサーバーが失敗したときも、NotSentError に包まず、その失敗をそのまま伝える", async () => {
    server.use(
      http.post("/api/auth/reauthenticate", () =>
        HttpResponse.json({ reauthenticatedAt: new Date().toISOString() }),
      ),
    );
    const deletes = respondDelete(() =>
      apiErrorResponse(
        403,
        "FORBIDDEN",
        "このメッセージは削除できません（テスト）",
      ),
    );
    const { result } = setup(null);
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = failureOf(result.current.mutateAsync(MESSAGE_ID));
    });
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    const user = userEvent.setup();
    await user.type(within(reauth).getByLabelText("パスワード"), TEST_PASSWORD);
    await user.click(within(reauth).getByRole("button", { name: "再認証" }));

    const error = await pending;
    expect(deletes).toEqual([MESSAGE_ID]);
    expect(error).not.toBeInstanceOf(NotSentError);
    expect(error).toMatchObject({ status: 403 });
  });
});
