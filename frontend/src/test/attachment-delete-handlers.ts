// #270（270-A）：添付の削除（EP-1-11 DELETE /api/attachments/:attachmentId → 204）の MSW の応答（架空のデータのみ）。
// 届いた要求の添付の ID を記録する。failWith を入れると、その応答で失敗させる。hold を真にすると release() まで応答しない（送信中の確認）。
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。
import { HttpResponse, http } from "msw";
import { apiErrorResponse } from "./message-handlers";
import { server } from "./server";

export type AttachmentDeleteServer = {
  /** DELETE の要求の添付の ID（届いた順） */
  deletes: string[];
  /** 次からの応答をこのエラーにする（null なら 204） */
  failWith: { status: number; code: string; message: string } | null;
  hold: boolean;
  release: () => void;
};

export function respondAttachmentDeletes(): AttachmentDeleteServer {
  let releaseHeld: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    releaseHeld = resolve;
  });
  const state: AttachmentDeleteServer = {
    deletes: [],
    failWith: null,
    hold: false,
    release: () => releaseHeld(),
  };
  server.use(
    http.delete("/api/attachments/:attachmentId", async ({ params }) => {
      state.deletes.push(String(params.attachmentId));
      if (state.hold) await held;
      if (state.failWith !== null)
        return apiErrorResponse(
          state.failWith.status,
          state.failWith.code,
          state.failWith.message,
        );
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return state;
}

/** 再認証（POST /api/auth/reauthenticate）の応答。入力されたパスワードを記録する */
export function respondReauthentication() {
  const passwords: string[] = [];
  server.use(
    http.post("/api/auth/reauthenticate", async ({ request }) => {
      passwords.push(((await request.json()) as { password: string }).password);
      return HttpResponse.json({ reauthenticatedAt: new Date().toISOString() });
    }),
  );
  return passwords;
}
