// Office の新しい形式（docx・xlsx・pptx）の zip の構造を、Workers の標準の API だけで確かめる（#140、C-137(1)・C-153・計画 Q3）。
// 決定：エントリ数は10,000まで／[Content_Types].xml の展開後は1MBまで（ヘッダーの申告を信じず、展開しながら数える）／
//   vbaProject.bin を含むものは拒否、embeddings/ は許可／暗号化・ZIP64・複数ディスクは拒否。
// 各エントリのローカルヘッダーを中央ディレクトリと突き合わせる（名前・圧縮方式・サイズ。ZIP64 の欄・拡張情報は拒否）。
//   データ記述子（汎用フラグの bit3）を使うエントリは、ローカルのサイズ欄が 0 になるので、サイズの突き合わせだけを省く（統括の決定）。
// [Content_Types].xml は、決まった形だけを受け付ける読み取り（content-types-xml.ts）で読む。
// 壊れた zip は「形式が正しくない」という判定であり、例外にせず false を返す。
import { readContentTypes } from "./content-types-xml";

export type OoxmlExtension = "docx" | "xlsx" | "pptx";

const MAX_ENTRIES = 10_000;
const MAX_CONTENT_TYPES_BYTES = 1_000_000;

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;

const MAIN_CONTENT_TYPES: Readonly<Record<OoxmlExtension, string>> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
};

type CentralEntry = {
  name: string;
  method: number;
  compressedSize: number;
  /** ローカルヘッダーの後ろの、圧縮データの始まり */
  dataStart: number;
};

const ZIP64_EXTRA_ID = 0x0001;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP64_SIZE = 0xffffffff;

const viewOf = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function findEocd(view: DataView): number | null {
  const lowest = Math.max(
    0,
    view.byteLength - EOCD_MIN_LENGTH - MAX_COMMENT_LENGTH,
  );
  for (
    let offset = view.byteLength - EOCD_MIN_LENGTH;
    offset >= lowest;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return null;
}

type CentralDirectory = { offset: number; entries: number; eocd: number };

/** EOCD を読み、単一ディスク・ZIP64 でない・エントリ数が上限以内のときだけ中央ディレクトリの位置を返す */
function locateCentralDirectory(view: DataView): CentralDirectory | null {
  const eocd = findEocd(view);
  if (eocd === null) return null;
  // ZIP64 のロケーターは EOCD の直前20バイトに置かれる
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_LOCATOR_SIGNATURE)
    return null;
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entries = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const offset = view.getUint32(eocd + 16, true);
  const multiDisk =
    disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entries;
  const zip64 =
    entries === 0xffff || size === 0xffffffff || offset === 0xffffffff;
  if (multiDisk || zip64 || entries > MAX_ENTRIES || offset + size > eocd)
    return null;
  return { offset, entries, eocd };
}

function readCentralDirectory(bytes: Uint8Array): CentralEntry[] | null {
  const view = viewOf(bytes);
  const directory = locateCentralDirectory(view);
  if (directory === null) return null;
  const { entries, eocd } = directory;

  const decoder = new TextDecoder();
  const result: CentralEntry[] = [];
  let offset = directory.offset;
  for (let i = 0; i < entries; i += 1) {
    if (
      offset + 46 > eocd ||
      view.getUint32(offset, true) !== CENTRAL_SIGNATURE
    )
      return null;
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > eocd) return null;
    // bit0 は暗号化
    if ((flags & 0x0001) !== 0) return null;
    const nameStart = offset + 46;
    const extraStart = nameStart + nameLength;
    if (
      compressedSize === ZIP64_SIZE ||
      uncompressedSize === ZIP64_SIZE ||
      localOffset === ZIP64_SIZE ||
      hasZip64Extra(view, extraStart, extraStart + extraLength)
    )
      return null;
    const nameBytes = bytes.subarray(nameStart, extraStart);
    const dataStart = matchLocalHeader(view, bytes, localOffset, {
      flags,
      method,
      compressedSize,
      uncompressedSize,
      nameBytes,
    });
    if (dataStart === null) return null;
    result.push({
      name: decoder.decode(nameBytes),
      method,
      compressedSize,
      dataStart,
    });
    offset = next;
  }
  return result;
}

/** 拡張情報（ID・長さ・中身の並び）に ZIP64 の項目があるか。形が壊れていても true（拒否する） */
function hasZip64Extra(view: DataView, start: number, end: number): boolean {
  let offset = start;
  while (offset < end) {
    if (offset + 4 > end) return true;
    if (view.getUint16(offset, true) === ZIP64_EXTRA_ID) return true;
    offset += 4 + view.getUint16(offset + 2, true);
  }
  return offset !== end;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * ローカルヘッダーを中央ディレクトリと突き合わせ、合えば圧縮データの始まりを返す（範囲外は読まずに null）。
 * データ記述子を使うエントリ（bit3）は、ローカルのサイズ欄が 0 になるので、サイズだけ突き合わせない。
 */
function matchLocalHeader(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  central: {
    flags: number;
    method: number;
    compressedSize: number;
    uncompressedSize: number;
    nameBytes: Uint8Array;
  },
): number | null {
  if (
    offset + 30 > bytes.length ||
    view.getUint32(offset, true) !== LOCAL_SIGNATURE
  )
    return null;
  const method = view.getUint16(offset + 8, true);
  const compressedSize = view.getUint32(offset + 18, true);
  const uncompressedSize = view.getUint32(offset + 22, true);
  const nameStart = offset + 30;
  const extraStart = nameStart + view.getUint16(offset + 26, true);
  const dataStart = extraStart + view.getUint16(offset + 28, true);
  if (dataStart + central.compressedSize > bytes.length) return null;
  if (
    compressedSize === ZIP64_SIZE ||
    uncompressedSize === ZIP64_SIZE ||
    hasZip64Extra(view, extraStart, dataStart)
  )
    return null;
  if (
    method !== central.method ||
    !sameBytes(bytes.subarray(nameStart, extraStart), central.nameBytes)
  )
    return null;
  const usesDescriptor = (central.flags & DATA_DESCRIPTOR_FLAG) !== 0;
  if (
    !usesDescriptor &&
    (compressedSize !== central.compressedSize ||
      uncompressedSize !== central.uncompressedSize)
  )
    return null;
  return dataStart;
}

function entryData(bytes: Uint8Array, entry: CentralEntry): Uint8Array {
  return bytes.subarray(
    entry.dataStart,
    entry.dataStart + entry.compressedSize,
  );
}

/** 展開しながら数え、上限を超えたら途中で止めて null。壊れた圧縮データも null */
async function inflateWithLimit(
  data: Uint8Array,
  limit: number,
): Promise<Uint8Array | null> {
  const reader = new Blob([data.slice()])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch (error) {
    // 圧縮データが壊れている＝形式が正しくない、という判定。想定外の例外は投げ直す
    if (error instanceof TypeError) return null;
    throw error;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function readContentTypesEntry(bytes: Uint8Array, entry: CentralEntry) {
  const data = entryData(bytes, entry);
  if (entry.method === 0)
    return data.length > MAX_CONTENT_TYPES_BYTES ? null : data;
  if (entry.method === 8)
    return inflateWithLimit(data, MAX_CONTENT_TYPES_BYTES);
  return null;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export async function checkOoxml(
  bytes: Uint8Array,
  extension: OoxmlExtension,
): Promise<boolean> {
  const entries = readCentralDirectory(bytes);
  if (entries === null) return false;
  if (entries.some((entry) => /(^|\/)vbaProject\.bin$/i.test(entry.name)))
    return false;
  const contentTypesEntry = entries.find(
    (entry) => entry.name === "[Content_Types].xml",
  );
  if (contentTypesEntry === undefined) return false;
  const raw = await readContentTypesEntry(bytes, contentTypesEntry);
  if (raw === null) return false;
  const xml = decodeUtf8(raw);
  const elements = xml === null ? null : readContentTypes(xml);
  if (elements === null) return false;
  if (
    elements.some((element) =>
      /macroEnabled/i.test(element.attributes.get("ContentType") ?? ""),
    )
  )
    return false;
  const names = new Set(entries.map((entry) => entry.name));
  const expected = MAIN_CONTENT_TYPES[extension];
  return elements.some((element) => {
    const partName = element.attributes.get("PartName");
    return (
      element.localName === "Override" &&
      element.attributes.get("ContentType") === expected &&
      partName !== undefined &&
      names.has(partName.replace(/^\//, ""))
    );
  });
}
