// #140 のテストで使う、添付ファイルの架空・無害なバイト列を組み立てる部品。実在の文書・画像は使わない。
// zip は自前で組む（新しいライブラリは足さない）。圧縮は標準の CompressionStream("deflate-raw") を使う。
// このファイルは、まだない本番のコード（添付の検査・保存）を読み込まない。
// 期待値（形式・上限）は受け入れ条件・計画から決める。本番の定数からは作らない。

const encoder = new TextEncoder();

export const ascii = (text: string) => encoder.encode(text);

export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const u16le = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
const u32le = (n: number) =>
  new Uint8Array([
    n & 0xff,
    (n >>> 8) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 24) & 0xff,
  ]);
const u32be = (n: number) =>
  new Uint8Array([
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ]);
const u64le = (n: number) => concat(u32le(n), u32le(0));

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes)
    c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function compressWith(
  format: "deflate" | "deflate-raw",
  data: Uint8Array,
): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const deflateRaw = (data: Uint8Array) =>
  compressWith("deflate-raw", data);

// ---- zip ----

export type ZipEntry = {
  name: string;
  data: Uint8Array;
  /** true なら deflate（方式8）で圧縮する。既定は無圧縮（方式0） */
  compress?: boolean;
  /** 一般目的のフラグ（bit0 = 暗号化） */
  flags?: number;
  /** ヘッダーに書く展開後のサイズを偽る（実際の展開後のサイズを信じない検査の確認用） */
  declaredSize?: number;
};

export type ZipOptions = {
  /** EOCD のディスク番号（0 以外は複数ディスク） */
  diskNumber?: number;
  /** ZIP64 の EOCD とロケーターを付け、EOCD の値を 0xFFFF / 0xFFFFFFFF にする */
  zip64?: boolean;
};

/** 中央ディレクトリと EOCD を持つ zip を組む */
export async function buildZip(
  entries: readonly ZipEntry[],
  options: ZipOptions = {},
): Promise<Uint8Array> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const stored = entry.compress ? await deflateRaw(entry.data) : entry.data;
    const method = entry.compress ? 8 : 0;
    const flags = entry.flags ?? 0;
    const crc = crc32(entry.data);
    const size = entry.declaredSize ?? entry.data.length;
    const local = concat(
      u32le(0x04034b50),
      u16le(20),
      u16le(flags),
      u16le(method),
      u16le(0),
      u16le(0),
      u32le(crc),
      u32le(stored.length),
      u32le(size),
      u16le(name.length),
      u16le(0),
      name,
      stored,
    );
    centrals.push(
      concat(
        u32le(0x02014b50),
        u16le(20),
        u16le(20),
        u16le(flags),
        u16le(method),
        u16le(0),
        u16le(0),
        u32le(crc),
        u32le(stored.length),
        u32le(size),
        u16le(name.length),
        u16le(0),
        u16le(0),
        u16le(0),
        u16le(0),
        u32le(0),
        u32le(offset),
        name,
      ),
    );
    locals.push(local);
    offset += local.length;
  }
  const central = concat(...centrals);
  const disk = options.diskNumber ?? 0;
  const parts: Uint8Array[] = [...locals, central];
  if (options.zip64) {
    const zip64EocdOffset = offset + central.length;
    parts.push(
      concat(
        u32le(0x06064b50),
        u64le(44),
        u16le(45),
        u16le(45),
        u32le(0),
        u32le(0),
        u64le(entries.length),
        u64le(entries.length),
        u64le(central.length),
        u64le(offset),
      ),
      concat(u32le(0x07064b50), u32le(0), u64le(zip64EocdOffset), u32le(1)),
      concat(
        u32le(0x06054b50),
        u16le(0xffff),
        u16le(0xffff),
        u16le(0xffff),
        u16le(0xffff),
        u32le(0xffffffff),
        u32le(0xffffffff),
        u16le(0),
      ),
    );
  } else {
    parts.push(
      concat(
        u32le(0x06054b50),
        u16le(disk),
        u16le(disk),
        u16le(entries.length),
        u16le(entries.length),
        u32le(central.length),
        u32le(offset),
        u16le(0),
      ),
    );
  }
  return concat(...parts);
}

// ---- Office の新しい形式（docx・xlsx・pptx）----

export const OOXML_MAIN = {
  docx: {
    part: "/word/document.xml",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  },
  xlsx: {
    part: "/xl/workbook.xml",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  },
  pptx: {
    part: "/ppt/presentation.xml",
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  },
  docm: {
    part: "/word/document.xml",
    type: "application/vnd.ms-word.document.macroEnabled.main+xml",
  },
  xlsm: {
    part: "/xl/workbook.xml",
    type: "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
  },
} as const;

export type OoxmlFlavor = keyof typeof OOXML_MAIN;

export function contentTypesXml(flavor: OoxmlFlavor, padding = 0): string {
  const main = OOXML_MAIN[flavor];
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="${main.part}" ContentType="${main.type}"/>` +
    " ".repeat(padding) +
    `</Types>`
  );
}

/**
 * 正しい形の Office ファイル（[Content_Types].xml は圧縮）。
 * extra でエントリを足す（vbaProject.bin・embeddings/ 等）。contentTypes を渡すと [Content_Types].xml の中身を差し替える。
 */
export async function buildOoxml(
  flavor: OoxmlFlavor,
  options: {
    extra?: readonly ZipEntry[];
    contentTypes?: Uint8Array;
    omitContentTypes?: boolean;
    contentTypesEntry?: Partial<ZipEntry>;
    zip?: ZipOptions;
  } = {},
): Promise<Uint8Array> {
  const main = OOXML_MAIN[flavor];
  const entries: ZipEntry[] = [];
  if (!options.omitContentTypes)
    entries.push({
      name: "[Content_Types].xml",
      data: options.contentTypes ?? ascii(contentTypesXml(flavor)),
      compress: true,
      ...options.contentTypesEntry,
    });
  entries.push(
    {
      name: "_rels/.rels",
      data: ascii(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main.part.slice(1)}"/></Relationships>`,
      ),
      compress: true,
    },
    {
      name: main.part.slice(1),
      data: ascii(
        `<?xml version="1.0" encoding="UTF-8"?><root>[UNIT_TEST]</root>`,
      ),
      compress: true,
    },
    ...(options.extra ?? []),
  );
  return buildZip(entries, options.zip);
}

// ---- 画像 ----

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = ascii(type);
  return concat(
    u32be(data.length),
    typeBytes,
    data,
    u32be(crc32(concat(typeBytes, data))),
  );
}

export const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** 1x1 の PNG。exif を渡すと eXIf チャンクを IHDR の後に入れる */
export async function buildPng(options: { exif?: Uint8Array } = {}) {
  const ihdr = concat(u32be(1), u32be(1), new Uint8Array([8, 2, 0, 0, 0]));
  const idat = await compressWith("deflate", new Uint8Array([0, 255, 0, 0]));
  return concat(
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    ...(options.exif ? [pngChunk("eXIf", options.exif)] : []),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array()),
  );
}

/** 位置情報を含むことを示す、架空の Exif の中身（TIFF ヘッダーと目印の文字列だけ） */
export const FAKE_EXIF_TIFF = concat(
  ascii("MM"),
  new Uint8Array([0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]),
  ascii("[UNIT_TEST]GPS-35.0000N-139.0000E"),
);

const jpegSegment = (marker: number, data: Uint8Array) =>
  concat(new Uint8Array([0xff, marker]), u16be(data.length + 2), data);
function u16be(n: number) {
  return new Uint8Array([(n >>> 8) & 0xff, n & 0xff]);
}

/** JPEG 画像の本体（SOS 以降）。中身は架空のバイト列 */
export const JPEG_SCAN = concat(
  jpegSegment(0xda, new Uint8Array([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])),
  new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a]),
  new Uint8Array([0xff, 0xd9]),
);
export const JPEG_APP0 = jpegSegment(
  0xe0,
  concat(ascii("JFIF\0"), new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0])),
);
export const JPEG_DQT = jpegSegment(
  0xdb,
  concat(new Uint8Array([0]), new Uint8Array(64).fill(1)),
);
export const JPEG_APP1_EXIF = jpegSegment(
  0xe1,
  concat(ascii("Exif\0\0"), FAKE_EXIF_TIFF),
);

/** JPEG。exif が true なら APP1（Exif）を APP0 の後に入れる */
export function buildJpeg(options: { exif?: boolean } = {}) {
  return concat(
    new Uint8Array([0xff, 0xd8]),
    JPEG_APP0,
    ...(options.exif ? [JPEG_APP1_EXIF] : []),
    JPEG_DQT,
    JPEG_SCAN,
  );
}

export const GIF_BYTES = concat(
  ascii("GIF89a"),
  new Uint8Array([
    1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255, 0x2c, 0, 0, 0, 0, 1, 0, 1,
    0, 0, 2, 2, 0x44, 0x01, 0, 0x3b,
  ]),
);

function riffChunk(type: string, data: Uint8Array) {
  const pad = data.length % 2 === 1 ? new Uint8Array([0]) : new Uint8Array();
  return concat(ascii(type), u32le(data.length), data, pad);
}

/** WebP。exif が true なら VP8X（EXIF のフラグあり）と EXIF チャンクを付ける */
export function buildWebp(options: { exif?: boolean } = {}) {
  const vp8 = riffChunk(
    "VP8 ",
    new Uint8Array([
      0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00,
      0x34, 0x25, 0xa4, 0x00, 0x03, 0x70, 0x00, 0xfe, 0xfb, 0x94, 0x00, 0x00,
    ]),
  );
  const chunks = options.exif
    ? [
        riffChunk("VP8X", new Uint8Array([0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
        vp8,
        riffChunk("EXIF", FAKE_EXIF_TIFF),
      ]
    : [vp8];
  const body = concat(ascii("WEBP"), ...chunks);
  return concat(ascii("RIFF"), u32le(body.length), body);
}

// ---- 文書・動画・そのほか ----

export const PDF_BYTES = ascii(
  "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%[UNIT_TEST]\n%%EOF\n",
);

/** ftyp ボックスから始まる MP4（ブランドは isom） */
export const MP4_BYTES = concat(
  u32be(24),
  ascii("ftyp"),
  ascii("isom"),
  u32be(0x200),
  ascii("isom"),
  ascii("mp41"),
  u32be(8),
  ascii("free"),
);

function ebmlHeader(docType: string) {
  const doc = ascii(docType);
  const docTypeElement = concat(
    new Uint8Array([0x42, 0x82, 0x80 | doc.length]),
    doc,
  );
  return concat(
    new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80 | docTypeElement.length]),
    docTypeElement,
    new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x80]),
  );
}

export const WEBM_BYTES = ebmlHeader("webm");
export const MATROSKA_BYTES = ebmlHeader("matroska");

export const TEXT_BYTES = encoder.encode("[UNIT_TEST] テストの文章です。\n");
export const CSV_BYTES = encoder.encode("名前,値\n[UNIT_TEST]テスト太郎,1\n");
export const TEXT_WITH_NUL = concat(ascii("[UNIT_TEST]"), new Uint8Array([0]));
export const INVALID_UTF8 = concat(
  ascii("[UNIT_TEST]"),
  new Uint8Array([0xc3, 0x28, 0xff]),
);
export const SVG_BYTES = ascii(
  '<svg xmlns="http://www.w3.org/2000/svg"><text>[UNIT_TEST]</text></svg>',
);
export const HTML_BYTES = ascii(
  "<!DOCTYPE html><html><body>[UNIT_TEST]</body></html>",
);
/** 実行形式の先頭（MZ）を真似た、中身のないバイト列 */
export const EXE_LIKE_BYTES = concat(ascii("MZ"), new Uint8Array(62));
/** 旧形式の Office（OLE2 の先頭） */
export const OLE2_BYTES = concat(
  new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  new Uint8Array(504),
);

/** バイト列のどこかに needle があるか */
export function includesBytes(haystack: Uint8Array, needle: Uint8Array) {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1)
      if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
