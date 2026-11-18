// Service：メッセージの添付のアップロードと配信（#140）。HTTP は知らない。実体は R2（env.ATTACHMENTS）、行は D1。
// アップロードの判定の順（この順を変えない。本文はすべての判定の後に読む）：
//   部屋（通常の投稿用は message.service の requirePostable、返信用は requireReplyable）→ perm.attachment.upload（403）
//   → 名前・Content-Length・種類の上限（422）→ 本文を読んで形式を検査（422）→ R2 に保存 → D1 に未投稿の行を登録
//   画像・文書はメモリに読み込んで検査し、画像は Exif を除いてから保存する。動画は先頭を検査し、FixedLengthStream で流して保存する。
//   受信したバイト数が Content-Length と違えば 422 で、保存物を残さない。
//   D1 の登録が失敗したら、保存した実体の削除を試みてから元のエラーを投げ直す（削除の失敗は error ログに残す）。
//   登録は保存の時点の資格を条件にする（#148。attachment.repository.ts の insertPending）。0行なら、保存した実体を消し、
//   部屋の判定を最初と同じ順で読み直して 404／403／409 にする。どれにも当たらなければ成功にしない（409）。
// 配信の判定の順：見えるか（attachment-visibility.sql.ts。見えなければ存在しない添付と同じ 404）
//   → DM なら perm.dm.message.view（一覧と同じ）・案件専用チャンネルなら perm.case.view（#148。R-64）
//   → perm.attachment.download（403）→ R2 から読む（実体がなければ 404）。
// ログにファイル名・保存先のキーを出さない。
import { withAttachments } from "../db/attachment.repository";
import { withMessages } from "../db/message.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { inspectAttachment } from "../lib/attachment-inspection";
import { parseByteRange } from "../lib/byte-range";
import { stripExif, type ImageContentType } from "../lib/exif-strip";
import { createLogger, type Logger } from "../lib/logger/logger";
import { newUlid } from "../lib/ulid";
import {
  ATTACHMENT_SIZE_LIMITS,
  MAX_ATTACHMENT_UPLOAD_BYTES,
  attachmentKindFromName,
  isValidAttachmentName,
  type AttachmentKind,
} from "../../../shared/attachment-rules";
import type { CronJob } from "../scheduled";
import { createAppAuthorizer } from "./authorizer";
import { createMessageService, type RoomWriteKind } from "./message.service";

export type AttachmentActor = { userId: string; traceId: string };

export type AttachmentUpload = {
  /** 元の名前。ない・読めない場合は null（422 にする） */
  name: string | null;
  contentLength: number | null;
  body: ReadableStream<Uint8Array> | null;
};

export type UploadedAttachment = {
  id: string;
  name: string;
  kind: AttachmentKind;
  contentType: string;
  size: number;
};

type Dependencies = {
  authorizer: Pick<ReturnType<typeof createAppAuthorizer>, "authorize">;
};

/** 動画の形式の判定に使う先頭のバイト数 */
const VIDEO_HEAD_BYTES = 4096;
const STORAGE_PREFIX = "attachments/";
/** 未投稿の添付を残す時間（24時間） */
const PENDING_LIFETIME_MS = 24 * 60 * 60 * 1000;

const invalid = (field: string, message: string) =>
  new AppError("VALIDATION_ERROR", message, { fields: [field] });

/** 受信したバイト数が Content-Length と合わない */
const lengthMismatch = () =>
  invalid("Content-Length", "ファイルを最後まで受け取れませんでした");
const unsupported = () => invalid("file", "このファイルの形式は添付できません");

function bucketOf(env: Env): R2Bucket {
  return env.ATTACHMENTS;
}

/** 本文を全部読む。Content-Length を超えたら途中で止める */
async function readAll(
  body: ReadableStream<Uint8Array> | null,
  expected: number,
): Promise<Uint8Array> {
  const out = new Uint8Array(expected);
  let total = 0;
  if (body !== null) {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > expected) {
        await reader.cancel();
        throw lengthMismatch();
      }
      out.set(value, total);
      total += value.length;
    }
  }
  if (total !== expected) throw lengthMismatch();
  return out;
}

export function createAttachmentService(
  env: Env,
  { authorizer }: Dependencies,
) {
  const bucket = bucketOf(env);

  const withMessageRules = <T>(
    run: (service: ReturnType<typeof createMessageService>) => Promise<T>,
  ) =>
    withMessages(env, (repository) =>
      run(createMessageService(repository, { authorizer })),
    );

  // 後始末の削除。失敗しても主の処理の結果を変えず、error ログに残す（キーは出さない）
  async function removeStored(key: string, logger: Logger) {
    try {
      await bucket.delete(key);
    } catch (error) {
      logger.error("添付の保存物の削除に失敗した", { error });
    }
  }

  function checkHeaders(upload: AttachmentUpload) {
    const { name, contentLength } = upload;
    if (name === null || !isValidAttachmentName(name))
      throw invalid("X-File-Name", "ファイル名を確かめてください");
    const kind = attachmentKindFromName(name);
    if (kind === null) throw unsupported();
    if (
      contentLength === null ||
      !Number.isSafeInteger(contentLength) ||
      contentLength <= 0
    )
      throw invalid("Content-Length", "ファイルの大きさを確かめてください");
    if (
      contentLength > MAX_ATTACHMENT_UPLOAD_BYTES ||
      contentLength > ATTACHMENT_SIZE_LIMITS[kind]
    )
      throw invalid("Content-Length", "ファイルが大きすぎます");
    return { name, contentLength };
  }

  /** 画像・文書：全体を読み、検査し（画像は Exif を除き）、保存する */
  async function storeWhole(
    key: string,
    name: string,
    upload: AttachmentUpload,
    contentLength: number,
  ) {
    const bytes = await readAll(upload.body, contentLength);
    const inspected = await inspectAttachment(name, bytes);
    if (!inspected.ok || inspected.kind === "video") throw unsupported();
    let stored = bytes;
    if (inspected.kind === "image") {
      try {
        stored = stripExif(bytes, inspected.contentType as ImageContentType);
      } catch (error) {
        throw new AppError("VALIDATION_ERROR", "画像を読み取れませんでした", {
          fields: ["file"],
          cause: error,
        });
      }
    }
    await bucket.put(key, stored);
    return { inspected, size: stored.length };
  }

  /** 動画：先頭を検査し、残りを FixedLengthStream で流して保存する。バイト数が合わなければ保存物を残さない */
  async function storeVideo(
    key: string,
    name: string,
    upload: AttachmentUpload,
    contentLength: number,
    logger: Logger,
  ) {
    if (upload.body === null) throw lengthMismatch();
    const reader = upload.body.getReader();
    const head: Uint8Array[] = [];
    let total = 0;
    let finished = false;
    while (total < Math.min(VIDEO_HEAD_BYTES, contentLength)) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      head.push(value);
      total += value.length;
    }
    if (total > contentLength || (finished && total !== contentLength)) {
      await reader.cancel();
      throw lengthMismatch();
    }
    const headBytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of head) {
      headBytes.set(chunk, offset);
      offset += chunk.length;
    }
    const inspected = await inspectAttachment(name, headBytes);
    if (!inspected.ok || inspected.kind !== "video") {
      await reader.cancel();
      throw unsupported();
    }

    const { readable, writable } = new FixedLengthStream(contentLength);
    const writer = writable.getWriter();
    // 片方が失敗したら、もう片方を止めて待ち続けないようにする。止める操作自体の失敗は、元の失敗の応答を変えずに error ログに残す
    const stopBoth = async (reason: unknown) => {
      const results = await Promise.allSettled([
        writer.abort(reason),
        reader.cancel(reason),
      ]);
      for (const result of results)
        if (result.status === "rejected")
          logger.error("添付の受信・保存を止める操作に失敗した", {
            error: result.reason,
          });
    };
    const pump = async () => {
      try {
        await writer.write(headBytes);
        let received = total;
        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.length;
          if (received > contentLength) {
            await reader.cancel();
            break;
          }
          await writer.write(value);
        }
        if (received !== contentLength) {
          await writer.abort(lengthMismatch());
          return false;
        }
        await writer.close();
        return true;
      } catch (error) {
        await stopBoth(error);
        throw error;
      }
    };
    const put = bucket.put(key, readable).catch(async (error: unknown) => {
      await stopBoth(error);
      throw error;
    });
    const [stored, pumped] = await Promise.allSettled([put, pump()]);
    if (pumped.status === "fulfilled" && !pumped.value) {
      await removeStored(key, logger);
      throw lengthMismatch();
    }
    if (pumped.status === "rejected") {
      await removeStored(key, logger);
      throw pumped.reason;
    }
    if (stored.status === "rejected") {
      await removeStored(key, logger);
      throw stored.reason;
    }
    return { inspected, size: contentLength };
  }

  // 部屋の判定（アップロードの前と、登録が0行のときの読み直しで同じ順）
  async function requireRoom(
    actor: AttachmentActor,
    context: { roomId: string; threadParentId: string | null },
  ): Promise<void> {
    const kind: RoomWriteKind = "upload";
    const { threadParentId } = context;
    await withMessageRules(async (service) => {
      if (threadParentId === null)
        await service.requirePostable(actor, context.roomId, kind);
      else await service.requireReplyable(actor, threadParentId, kind);
    });
  }

  async function store(
    actor: AttachmentActor,
    context: { roomId: string; threadParentId: string | null },
    upload: AttachmentUpload,
  ): Promise<UploadedAttachment> {
    const logger = createLogger({
      traceId: actor.traceId,
      userId: actor.userId,
    });
    const { name, contentLength } = checkHeaders(upload);
    const key = `${STORAGE_PREFIX}${newUlid()}`;
    const { inspected, size } =
      attachmentKindFromName(name) === "video"
        ? await storeVideo(key, name, upload, contentLength, logger)
        : await storeWhole(key, name, upload, contentLength);
    if (!inspected.ok) throw unsupported();
    const id = newUlid();
    let inserted: number;
    try {
      inserted = await withAttachments(env, (repository) =>
        repository.insertPending({
          id,
          roomId: context.roomId,
          threadParentId: context.threadParentId,
          uploaderId: actor.userId,
          storageKey: key,
          originalName: name,
          kind: inspected.kind,
          contentType: inspected.contentType,
          sizeBytes: size,
        }),
      );
    } catch (error) {
      await removeStored(key, logger);
      throw error;
    }
    if (inserted === 0) {
      await removeStored(key, logger);
      await requireRoom(actor, context);
      throw new AppError(
        "CONFLICT",
        "状態が変わったため、添付できませんでした。読み込み直してからお試しください",
      );
    }
    return {
      id,
      name,
      kind: inspected.kind,
      contentType: inspected.contentType,
      size,
    };
  }

  const authorizeUpload = (actor: AttachmentActor) =>
    authorizer.authorize({ userId: actor.userId }, "perm.attachment.upload", {
      type: "company",
    });

  return {
    async uploadToRoom(
      actor: AttachmentActor,
      roomId: string,
      upload: AttachmentUpload,
    ) {
      const context = { roomId, threadParentId: null };
      await requireRoom(actor, context);
      await authorizeUpload(actor);
      return store(actor, context, upload);
    },
    async uploadToReply(
      actor: AttachmentActor,
      parentId: string,
      upload: AttachmentUpload,
    ) {
      const parent = await withMessageRules((service) =>
        service.requireReplyable(actor, parentId, "upload"),
      );
      await authorizeUpload(actor);
      return store(
        actor,
        { roomId: parent.roomId, threadParentId: parentId },
        upload,
      );
    },
    async download(
      actor: AttachmentActor,
      attachmentId: string,
      rangeHeader: string | null,
    ) {
      const attachment = await withAttachments(env, (repository) =>
        repository.findVisible(attachmentId, actor.userId),
      );
      if (attachment === null)
        throw new AppError("NOT_FOUND", "添付が見つかりません");
      if (attachment.isDirect)
        await authorizer.authorize(
          { userId: actor.userId },
          "perm.dm.message.view",
          { type: "company" },
        );
      if (attachment.isCase)
        await authorizer.authorize({ userId: actor.userId }, "perm.case.view", {
          type: "company",
        });
      await authorizer.authorize(
        { userId: actor.userId },
        "perm.attachment.download",
        { type: "company" },
      );
      const range = parseByteRange(rangeHeader, attachment.sizeBytes);
      const object = await bucket.get(
        attachment.storageKey,
        range === null
          ? undefined
          : {
              range: {
                offset: range.start,
                length: range.end - range.start + 1,
              },
            },
      );
      // 行はあるが実体がない（後始末の途中など）。存在しない添付と同じ扱いにする
      if (object === null)
        throw new AppError("NOT_FOUND", "添付が見つかりません");
      return {
        name: attachment.originalName,
        kind: attachment.kind,
        contentType: attachment.contentType,
        size: attachment.sizeBytes,
        range,
        body: object.body,
      };
    },
  };
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;

export function withAttachmentService<T>(
  env: Env,
  actor: AttachmentActor,
  run: (service: AttachmentService) => Promise<T>,
): Promise<T> {
  return withRoleAssignments(env, (roles) =>
    run(
      createAttachmentService(env, {
        authorizer: createAppAuthorizer(roles, {
          logger: createLogger({
            traceId: actor.traceId,
            userId: actor.userId,
          }),
        }),
      }),
    ),
  );
}

/** 未投稿の添付の掃除（Cron。既存の毎日の式に相乗りする）。行を先に消し、消せた行の実体だけを R2 から消す */
export function attachmentCleanupJob(): CronJob {
  return {
    cron: "17 18 * * *",
    name: "attachment-cleanup",
    run: async (env) => {
      const logger = createLogger();
      const boundary = new Date(Date.now() - PENDING_LIFETIME_MS).toISOString();
      const keys = await withAttachments(env, (repository) =>
        repository.deletePendingBefore(boundary),
      );
      let failed = 0;
      for (const key of keys) {
        try {
          await bucketOf(env).delete(key);
        } catch (error) {
          failed += 1;
          logger.error("attachment-cleanup：保存物の削除に失敗した", { error });
        }
      }
      logger.info("attachment-cleanup：掃除を終了", {
        deletedRows: keys.length,
        failedObjects: failed,
      });
    },
  };
}
