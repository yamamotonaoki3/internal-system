// 添付の形式の検査（#140、1-6 AC-5・C-126(5)・C-137(1)・C-153）。形式は拡張子ではなく中身で判定し、
// 拡張子の種類と中身が一致するものだけを受け付ける。Content-Type は、ここで決めた固定の値だけを使う（申告・拡張子から付けない）。
// 動画は先頭だけを渡して判定する（本体はストリームのまま保存するため）。
import {
  attachmentExtension,
  type AttachmentContentType,
  type AttachmentKind,
} from "../../../shared/attachment-rules";
import { checkOoxml, type OoxmlExtension } from "./ooxml-check";

export type InspectionResult =
  | { ok: true; kind: AttachmentKind; contentType: AttachmentContentType }
  | { ok: false };

const TEXT_CONTENT_TYPE: AttachmentContentType = "text/plain; charset=utf-8";

const toCodes = (text: string) => [...text].map((c) => c.charCodeAt(0));
const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0) =>
  bytes.length >= offset + prefix.length &&
  prefix.every((value, i) => bytes[offset + i] === value);

const isJpeg = (b: Uint8Array) => startsWith(b, [0xff, 0xd8, 0xff]);
const isPng = (b: Uint8Array) =>
  startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isGif = (b: Uint8Array) =>
  startsWith(b, toCodes("GIF87a")) || startsWith(b, toCodes("GIF89a"));
const isWebp = (b: Uint8Array) =>
  startsWith(b, toCodes("RIFF")) && startsWith(b, toCodes("WEBP"), 8);
const isPdf = (b: Uint8Array) => startsWith(b, toCodes("%PDF-"));
const isMp4 = (b: Uint8Array) => startsWith(b, toCodes("ftyp"), 4);
const isZip = (b: Uint8Array) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]);

// EBML の可変長整数。要素の ID は先頭の印を残し、長さは外す
function readVint(bytes: Uint8Array, offset: number, keepMarker: boolean) {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (offset + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  for (let i = 1; i < length; i += 1)
    value = value * 256 + (bytes[offset + i] as number);
  return { value, length };
}

const EBML_ID = 0x1a45dfa3;
const DOC_TYPE_ID = 0x4282;

/** EBML ヘッダーの DocType が webm か（Matroska 等は受け付けない） */
function isWebm(bytes: Uint8Array): boolean {
  const id = readVint(bytes, 0, true);
  if (id === null || id.value !== EBML_ID) return false;
  const size = readVint(bytes, id.length, false);
  if (size === null) return false;
  let offset = id.length + size.length;
  const end = Math.min(bytes.length, offset + size.value);
  while (offset < end) {
    const childId = readVint(bytes, offset, true);
    if (childId === null) return false;
    const childSize = readVint(bytes, offset + childId.length, false);
    if (childSize === null) return false;
    const start = offset + childId.length + childSize.length;
    if (childId.value === DOC_TYPE_ID)
      return (
        new TextDecoder().decode(
          bytes.subarray(start, start + childSize.value),
        ) === "webm"
      );
    offset = start + childSize.value;
  }
  return false;
}

/** UTF-8 として正しく、NUL を含まないテキスト */
function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

type Format = {
  kind: AttachmentKind;
  contentType: AttachmentContentType;
  matches: (bytes: Uint8Array) => boolean | Promise<boolean>;
};

const ooxml = (
  extension: OoxmlExtension,
  contentType: AttachmentContentType,
): Format => ({
  kind: "document",
  contentType,
  matches: async (bytes) => isZip(bytes) && checkOoxml(bytes, extension),
});

const JPEG: Format = {
  kind: "image",
  contentType: "image/jpeg",
  matches: isJpeg,
};
const TEXT: Format = {
  kind: "document",
  contentType: TEXT_CONTENT_TYPE,
  matches: isPlainText,
};

/** 拡張子ごとの、中身の判定と付ける種類。ここにない拡張子は受け付けない */
const FORMATS: Readonly<Record<string, Format>> = {
  jpg: JPEG,
  jpeg: JPEG,
  png: { kind: "image", contentType: "image/png", matches: isPng },
  gif: { kind: "image", contentType: "image/gif", matches: isGif },
  webp: { kind: "image", contentType: "image/webp", matches: isWebp },
  pdf: { kind: "document", contentType: "application/pdf", matches: isPdf },
  txt: TEXT,
  csv: TEXT,
  mp4: { kind: "video", contentType: "video/mp4", matches: isMp4 },
  webm: { kind: "video", contentType: "video/webm", matches: isWebm },
  docx: ooxml(
    "docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ),
  xlsx: ooxml(
    "xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ),
  pptx: ooxml(
    "pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ),
};

export async function inspectAttachment(
  name: string,
  bytes: Uint8Array,
): Promise<InspectionResult> {
  const extension = attachmentExtension(name);
  const format =
    extension !== null && Object.hasOwn(FORMATS, extension)
      ? FORMATS[extension]
      : undefined;
  if (format === undefined || !(await format.matches(bytes)))
    return { ok: false };
  return { ok: true, kind: format.kind, contentType: format.contentType };
}
