// Controller（ルート）：メッセージの添付のアップロードと配信（#140）。
//   POST /api/rooms/:roomId/attachments（通常の投稿用）・POST /api/messages/:messageId/replies/attachments（返信用）
//     本文はファイルのバイト列そのまま。元の名前は X-File-Name（UTF-8 のパーセントエンコード）、大きさは Content-Length（必須）。
//     ヘッダーの中身の確かめ（422）は、部屋と権限の判定の後に Service が行う（本文は判定がすべて済むまで読まない）。
//   GET /api/attachments/:attachmentId
//     Content-Type はサーバーの検査の結果だけ。画像・動画は inline、それ以外は attachment。正しい単一の Range だけ 206 で返す。
// 認証と送信元の確認は app.ts が /api/* に一括で適用する。
import { Hono, type Context } from "hono";
import { z } from "zod";
import { AppError } from "../lib/app-error";
import { contentDisposition } from "../lib/content-disposition";
import { DOWNLOAD_CONTENT_SECURITY_POLICY } from "../lib/security";
import { traceIdOf } from "../lib/trace-id";
import { validate } from "../lib/validation";
import {
  withAttachmentService,
  type AttachmentActor,
  type AttachmentUpload,
} from "../services/attachment.service";
import { ULID_PATTERN } from "../../../shared/ulid-rules";

const roomParamSchema = z.object({ roomId: z.string().min(1).max(64) });
const messageParamSchema = z.object({ messageId: z.string().min(1).max(64) });
const attachmentParamSchema = z.object({
  attachmentId: z.string().regex(ULID_PATTERN),
});

function actorOf(c: Context<{ Bindings: Env }>): AttachmentActor {
  const principal = c.get("principal");
  if (principal === null)
    throw new AppError("UNAUTHENTICATED", "ログインしてください");
  return { userId: principal.userId, traceId: traceIdOf(c) };
}

function decodeFileName(header: string | undefined): string | null {
  if (header === undefined) return null;
  try {
    return decodeURIComponent(header);
  } catch (error) {
    // パーセントエンコードとして壊れた名前は「名前がない」と同じく、Service が 422 にする
    if (error instanceof URIError) return null;
    throw error;
  }
}

function uploadOf(c: Context<{ Bindings: Env }>): AttachmentUpload {
  const length = c.req.header("Content-Length");
  return {
    name: decodeFileName(c.req.header("X-File-Name")),
    contentLength:
      length !== undefined && /^\d+$/.test(length) ? Number(length) : null,
    body: c.req.raw.body,
  };
}

/** 通常の投稿用のアップロード（/api/rooms に組み込む） */
export function roomAttachmentRoutes() {
  return new Hono<{ Bindings: Env }>().post(
    "/:roomId/attachments",
    validate("param", roomParamSchema),
    async (c) => {
      const actor = actorOf(c);
      const uploaded = await withAttachmentService(c.env, actor, (service) =>
        service.uploadToRoom(actor, c.req.valid("param").roomId, uploadOf(c)),
      );
      return c.json(uploaded, 201);
    },
  );
}

/** 返信用のアップロード（/api/messages に組み込む） */
export function replyAttachmentRoutes() {
  return new Hono<{ Bindings: Env }>().post(
    "/:messageId/replies/attachments",
    validate("param", messageParamSchema),
    async (c) => {
      const actor = actorOf(c);
      const uploaded = await withAttachmentService(c.env, actor, (service) =>
        service.uploadToReply(
          actor,
          c.req.valid("param").messageId,
          uploadOf(c),
        ),
      );
      return c.json(uploaded, 201);
    },
  );
}

/** 配信（/api/attachments に組み込む） */
export function attachmentRoutes() {
  return new Hono<{ Bindings: Env }>().get(
    "/:attachmentId",
    validate("param", attachmentParamSchema),
    async (c) => {
      const actor = actorOf(c);
      const file = await withAttachmentService(c.env, actor, (service) =>
        service.download(
          actor,
          c.req.valid("param").attachmentId,
          c.req.header("Range") ?? null,
        ),
      );
      const headers = new Headers({
        "Content-Type": file.contentType,
        "Content-Disposition": contentDisposition(
          file.name,
          file.kind === "document" ? "attachment" : "inline",
        ),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": DOWNLOAD_CONTENT_SECURITY_POLICY,
        "Cross-Origin-Resource-Policy": "same-origin",
        "Cache-Control": "private, no-store",
        "Accept-Ranges": "bytes",
      });
      if (file.range === null) {
        headers.set("Content-Length", String(file.size));
        return new Response(file.body, { status: 200, headers });
      }
      const { start, end } = file.range;
      headers.set("Content-Length", String(end - start + 1));
      headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);
      return new Response(file.body, { status: 206, headers });
    },
  );
}
