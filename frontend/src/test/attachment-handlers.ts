// #140：添付のアップロード・投稿・返信のテストで使う MSW の応答（架空のデータのみ）。サーバーの状態を持つ簡易な模擬。
// 契約（計画 plan-140「方式」1・2・4、「API」）：
//   POST /api/rooms/:roomId/attachments（通常の投稿用）・POST /api/messages/:messageId/replies/attachments（返信用）
//     本文はファイルのバイト列、元の名前は X-File-Name（UTF-8 のパーセントエンコード）→ 201 { id, name, kind, contentType, size }
//   POST /api/rooms/:roomId/messages・POST /api/messages/:messageId/replies の本文に attachmentIds を付ける
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。
import { HttpResponse, http, type HttpResponseResolver } from "msw";
import { apiErrorResponse } from "./message-handlers";
import { server } from "./server";

export type UploadRecord = {
  /** "room" か "reply" */
  entry: "room" | "reply";
  /** 部屋の ID か親の ID */
  targetId: string;
  /** X-File-Name を復号した名前 */
  name: string;
  contentType: string | null;
};

export type AttachmentServer = {
  uploads: UploadRecord[];
  /** 投稿・返信の本文（JSON のまま。届いた順） */
  messagePosts: { entry: "room" | "reply"; body: Record<string, unknown> }[];
  /** 名前を指定すると、そのファイルのアップロードを 422 で失敗させる */
  failNames: Set<string>;
  /** 名前を指定すると、そのファイルのアップロードは release() まで応答しない */
  holdNames: Set<string>;
  release: () => void;
};

export const uploadedId = (n: number) =>
  `01JTESTATT${String(n).padStart(16, "0")}`;

export function respondAttachments(): AttachmentServer {
  let releaseHeld: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    releaseHeld = resolve;
  });
  const state: AttachmentServer = {
    uploads: [],
    messagePosts: [],
    failNames: new Set(),
    holdNames: new Set(),
    release: () => releaseHeld(),
  };
  const upload =
    (
      entry: "room" | "reply",
      param: "roomId" | "messageId",
    ): HttpResponseResolver =>
    async ({ params, request }) => {
      const name = decodeURIComponent(request.headers.get("X-File-Name") ?? "");
      state.uploads.push({
        entry,
        targetId: String(params[param]),
        name,
        contentType: request.headers.get("Content-Type"),
      });
      const size = (await request.arrayBuffer()).byteLength;
      if (state.holdNames.has(name)) await held;
      if (state.failNames.has(name))
        return apiErrorResponse(
          422,
          "VALIDATION_ERROR",
          "このファイルは添付できません",
        );
      return HttpResponse.json(
        {
          id: uploadedId(state.uploads.length),
          name,
          kind: "document",
          contentType: "application/pdf",
          size,
        },
        { status: 201 },
      );
    };
  server.use(
    http.post("/api/rooms/:roomId/attachments", upload("room", "roomId")),
    http.post(
      "/api/messages/:messageId/replies/attachments",
      upload("reply", "messageId"),
    ),
    http.post("/api/rooms/:roomId/messages", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.messagePosts.push({ entry: "room", body });
      return HttpResponse.json(
        {
          id: "01JTESTMSG0000000000009999",
          roomId: "01JTESTROOM00000000000R001",
          createdAt: "2026-11-16T00:00:00.000Z",
        },
        { status: 201 },
      );
    }),
  );
  return state;
}

/** 返信の投稿の本文も記録する（respondReplies の後に呼ぶ。その親への返信だけ） */
export function recordReplyPosts(state: AttachmentServer, parentId: string) {
  server.use(
    http.post(
      "/api/messages/:messageId/replies",
      async ({ params, request }) => {
        if (params.messageId !== parentId) return undefined;
        const body = (await request.clone().json()) as Record<string, unknown>;
        state.messagePosts.push({ entry: "reply", body });
        return undefined;
      },
    ),
  );
}

/** 指定したサイズに見えるファイル（中身は小さい。大きなデータを作らずに上限を確かめる） */
export function sizedFile(name: string, size: number, type = "") {
  const file = new File(["[E2E_TEST]"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}
