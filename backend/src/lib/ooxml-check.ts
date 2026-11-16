// Office の新しい形式（docx・xlsx・pptx）の zip の構造を、Workers の標準の API だけで確かめる（#140、C-137(1)・C-153・計画 Q3）。
// 決定：エントリ数は10,000まで／[Content_Types].xml の展開後は1MBまで（ヘッダーの申告を信じず、展開しながら数える）／
//   vbaProject.bin を含むものは拒否、embeddings/ は許可／暗号化・ZIP64・複数ディスクは拒否。
// 壊れた zip は「形式が正しくない」という判定であり、例外にせず false を返す。

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
  localOffset: number;
};

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
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > eocd) return null;
    // bit0 は暗号化
    if ((flags & 0x0001) !== 0) return null;
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff)
      return null;
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    result.push({ name, method, compressedSize, localOffset });
    offset = next;
  }
  return result;
}

function entryData(bytes: Uint8Array, entry: CentralEntry): Uint8Array | null {
  const view = viewOf(bytes);
  const offset = entry.localOffset;
  if (
    offset + 30 > bytes.length ||
    view.getUint32(offset, true) !== LOCAL_SIGNATURE
  )
    return null;
  const start =
    offset +
    30 +
    view.getUint16(offset + 26, true) +
    view.getUint16(offset + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.length) return null;
  return bytes.subarray(start, end);
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

async function readContentTypes(bytes: Uint8Array, entry: CentralEntry) {
  const data = entryData(bytes, entry);
  if (data === null) return null;
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

const OVERRIDE = /<Override\b[^>]*>/g;
const attribute = (element: string, name: string) =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(element)?.[1];

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
  const raw = await readContentTypes(bytes, contentTypesEntry);
  if (raw === null) return false;
  const xml = decodeUtf8(raw);
  if (xml === null || /macroEnabled/i.test(xml)) return false;
  const names = new Set(entries.map((entry) => entry.name));
  const expected = MAIN_CONTENT_TYPES[extension];
  return (xml.match(OVERRIDE) ?? []).some((element) => {
    const partName = attribute(element, "PartName");
    return (
      attribute(element, "ContentType") === expected &&
      partName !== undefined &&
      names.has(partName.replace(/^\//, ""))
    );
  });
}
