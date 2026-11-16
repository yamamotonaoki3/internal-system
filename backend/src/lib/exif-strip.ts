// 画像の Exif（位置情報を含みうる）を除く（#140、security「Exif を除く」）。画素は変えず、Exif を入れる区画だけを取り除く。
// 構造が壊れた画像は例外を投げる（握りつぶさない。呼び出し側が 422 にする）。

export type ImageContentType =
  "image/jpeg" | "image/png" | "image/gif" | "image/webp";

class BrokenImageError extends Error {
  constructor(format: string) {
    super(`${format} の構造が壊れています`);
    this.name = "BrokenImageError";
  }
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

function startsWith(bytes: Uint8Array, offset: number, prefix: number[]) {
  return prefix.every((value, i) => bytes[offset + i] === value);
}

function concatParts(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// JPEG：SOS（画像の本体）までのセグメントを順に読み、Exif の APP1 だけを落とす
function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new BrokenImageError("JPEG");
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  for (;;) {
    if (offset + 4 > bytes.length || bytes[offset] !== 0xff)
      throw new BrokenImageError("JPEG");
    const marker = bytes[offset + 1] as number;
    const length =
      ((bytes[offset + 2] as number) << 8) | (bytes[offset + 3] as number);
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) throw new BrokenImageError("JPEG");
    if (marker === 0xda) {
      parts.push(bytes.subarray(offset));
      return concatParts(parts);
    }
    const isExif =
      marker === 0xe1 && startsWith(bytes, offset + 4, EXIF_HEADER);
    if (!isExif) parts.push(bytes.subarray(offset, end));
    offset = end;
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// PNG：チャンクを順に読み、eXIf を落とす（IEND まで）
function stripPng(bytes: Uint8Array): Uint8Array {
  if (!startsWith(bytes, 0, PNG_SIGNATURE)) throw new BrokenImageError("PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  for (;;) {
    if (offset + 12 > bytes.length) throw new BrokenImageError("PNG");
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new BrokenImageError("PNG");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type !== "eXIf") parts.push(bytes.subarray(offset, end));
    offset = end;
    if (type === "IEND") return concatParts(parts);
  }
}

// WebP：RIFF のチャンクを順に読み、EXIF を落とし、RIFF のサイズと VP8X の EXIF のフラグ（bit3）を直す
function stripWebp(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WEBP")
    throw new BrokenImageError("WebP");
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > bytes.length) throw new BrokenImageError("WebP");
  const parts: Uint8Array[] = [];
  let offset = 12;
  while (offset < riffEnd) {
    if (offset + 8 > riffEnd) throw new BrokenImageError("WebP");
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    if (end > riffEnd) throw new BrokenImageError("WebP");
    const type = tag(offset);
    if (type === "VP8X") {
      const chunk = bytes.slice(offset, end);
      chunk[8] = (chunk[8] as number) & ~0x08;
      parts.push(chunk);
    } else if (type !== "EXIF") {
      parts.push(bytes.subarray(offset, end));
    }
    offset = end;
  }
  const body = concatParts(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(bytes.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  out.set(body, 12);
  return out;
}

export function stripExif(
  bytes: Uint8Array,
  contentType: ImageContentType,
): Uint8Array {
  switch (contentType) {
    case "image/jpeg":
      return stripJpeg(bytes);
    case "image/png":
      return stripPng(bytes);
    case "image/webp":
      return stripWebp(bytes);
    case "image/gif":
      // GIF は Exif を持たない
      return bytes;
  }
}
