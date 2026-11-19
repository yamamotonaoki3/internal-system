// メッセージの添付の共通規則（#140）。画面とサーバーで同じ意味の定義を1か所に置く（サーバーは画面の検査に頼らず、中身の検査と合わせて必ず確かめる）。
// サイズの MB は 10^6 バイト（要件 1-6 AC-1）。
import { z } from "zod";
import { ULID_PATTERN } from "./ulid-rules";

export const ATTACHMENT_KINDS = ["image", "document", "video"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/**
 * サーバーの形式の検査が付ける Content-Type の一覧（申告・拡張子からは付けない）。
 * テキストと CSV は、どちらも text/plain で配信する（ブラウザに解釈させない）。
 */
export const ATTACHMENT_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain; charset=utf-8",
  "video/mp4",
  "video/webm",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;
export type AttachmentContentType = (typeof ATTACHMENT_CONTENT_TYPES)[number];

/**
 * 案件の添付の公開範囲（要件 5-2 AC-8）。参加者限定と、全社員公開アーカイブで公開できる、の2値。
 * 公開できるの選択は即時公開を意味せず、全社員公開が承認されるまでは参加者だけが見られる（読み取りの資格には使わない）。
 */
export const PUBLICATION_VISIBILITIES = [
  "participants_only",
  "public_archive",
] as const;
export type PublicationVisibility = (typeof PUBLICATION_VISIBILITIES)[number];
export const DEFAULT_PUBLICATION_VISIBILITY: PublicationVisibility =
  "participants_only";

/** 1メッセージに付けられる添付の数 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/** 種類ごとの1ファイルの上限（バイト） */
export const ATTACHMENT_SIZE_LIMITS: Readonly<Record<AttachmentKind, number>> =
  {
    image: 10_000_000,
    document: 25_000_000,
    video: 100_000_000,
  };

/** 1メッセージの添付の合計の上限（バイト） */
export const MAX_ATTACHMENT_TOTAL_BYTES = 200_000_000;

/** 1回のアップロードで受信する上限（最大の種類＝動画と同じ） */
export const MAX_ATTACHMENT_UPLOAD_BYTES = ATTACHMENT_SIZE_LIMITS.video;

/** 元の名前の長さの上限（文字） */
export const MAX_ATTACHMENT_NAME_LENGTH = 255;

/** 受け付ける拡張子と種類。ここにない拡張子（SVG・HTML・zip・マクロつき・旧形式の Office 等）は受け付けない */
const EXTENSION_KINDS: Readonly<Record<string, AttachmentKind>> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  pdf: "document",
  docx: "document",
  xlsx: "document",
  pptx: "document",
  txt: "document",
  csv: "document",
  mp4: "video",
  webm: "video",
};

/** 名前の拡張子（小文字）。拡張子がなければ null */
export function attachmentExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** 拡張子だけで決める種類。許可しない拡張子は null */
export function attachmentKindFromName(name: string): AttachmentKind | null {
  const extension = attachmentExtension(name);
  if (extension === null) return null;
  return Object.hasOwn(EXTENSION_KINDS, extension)
    ? (EXTENSION_KINDS[extension] ?? null)
    : null;
}

// 改行・「"」・制御文字（C0・DEL）は、配信のヘッダーを壊しうるため受け付けない
function hasForbiddenChar(name: string): boolean {
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || char === '"') return true;
  }
  return false;
}

export function isValidAttachmentName(name: string): boolean {
  const length = [...name].length;
  return (
    length >= 1 &&
    length <= MAX_ATTACHMENT_NAME_LENGTH &&
    !hasForbiddenChar(name)
  );
}

export type AttachmentRejection = "type" | "name" | "size" | "count" | "total";

/** 画面が選んだ直後に使う確認。受け付けるなら null、拒否なら理由 */
export function validateAttachmentCandidate(
  current: readonly { size: number }[],
  file: { name: string; size: number },
): AttachmentRejection | null {
  const kind = attachmentKindFromName(file.name);
  if (kind === null) return "type";
  if (!isValidAttachmentName(file.name)) return "name";
  // メッセージ全体の制限（件数・合計）を、1ファイルの上限より先に伝える
  if (current.length >= MAX_ATTACHMENTS_PER_MESSAGE) return "count";
  const total = current.reduce((sum, item) => sum + item.size, 0);
  if (total + file.size > MAX_ATTACHMENT_TOTAL_BYTES) return "total";
  if (file.size <= 0 || file.size > ATTACHMENT_SIZE_LIMITS[kind]) return "size";
  return null;
}

/** 投稿・返信に付ける添付の ID（最大10件・重複なし・ULID） */
export const attachmentIdsSchema = z
  .array(z.string().regex(ULID_PATTERN))
  .max(MAX_ATTACHMENTS_PER_MESSAGE)
  .refine((ids) => new Set(ids).size === ids.length, { message: "duplicate" });
