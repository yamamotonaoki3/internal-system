// #140 AC-1（1-6 AC-5、security「Exif を除く」）: 画像の Exif（位置情報を含みうる）の除去（backend/src/lib/exif-strip.ts）を確かめる。
// 架空の Exif（目印の文字列 [UNIT_TEST]GPS-…）を入れた画像から、Exif だけが消え、ほかの部分は変わらないことを見る。
// 壊れた画像は例外を投げる（握りつぶさない。Service が 422 にする。計画「リスク」）。
//
// 実装が前提とする約束（このテストが固定する）：
//   stripExif(bytes: Uint8Array, contentType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"): Uint8Array | Promise<Uint8Array>
import { describe, expect, it } from "vitest";
import {
  FAKE_EXIF_TIFF,
  GIF_BYTES,
  JPEG_APP13,
  JPEG_APP1_XMP,
  RAW_PROFILE_EXIF_TEXT,
  FAKE_XMP,
  buildPngWithText,
  JPEG_APP0,
  JPEG_DQT,
  JPEG_SCAN,
  ascii,
  buildJpeg,
  buildPng,
  buildWebp,
  concat,
  includesBytes,
} from "../../test/attachment-files";
import { stripExif } from "./exif-strip";

const MARKER = ascii("[UNIT_TEST]GPS");

describe("#140 AC-1 Exif の除去", () => {
  it("#140 AC-1: JPEG の APP1（Exif）を除き、ほかのセグメントと画像の本体はそのまま残す", async () => {
    const result = await stripExif(buildJpeg({ exif: true }), "image/jpeg");
    expect(includesBytes(result, MARKER)).toBe(false);
    expect(includesBytes(result, ascii("Exif\0\0"))).toBe(false);
    expect(Array.from(result)).toEqual(
      Array.from(
        concat(new Uint8Array([0xff, 0xd8]), JPEG_APP0, JPEG_DQT, JPEG_SCAN),
      ),
    );
  });

  it("#140 AC-1: Exif のない JPEG は変えない", async () => {
    const original = buildJpeg();
    expect(Array.from(await stripExif(original, "image/jpeg"))).toEqual(
      Array.from(original),
    );
  });

  it("#140 AC-1: PNG の eXIf チャンクを除き、Exif のない PNG と同じバイト列になる", async () => {
    const withExif = await buildPng({ exif: FAKE_EXIF_TIFF });
    const without = await buildPng();
    const result = await stripExif(withExif, "image/png");
    expect(includesBytes(result, MARKER)).toBe(false);
    expect(Array.from(result)).toEqual(Array.from(without));
  });

  it("#140 AC-1: WebP の EXIF チャンクを除き、RIFF のサイズを直し、VP8X の EXIF のフラグを下ろす", async () => {
    const result = await stripExif(buildWebp({ exif: true }), "image/webp");
    expect(includesBytes(result, MARKER)).toBe(false);
    expect(includesBytes(result, ascii("EXIF"))).toBe(false);
    const view = new DataView(result.buffer, result.byteOffset, result.length);
    expect(view.getUint32(4, true)).toBe(result.length - 8);
    // VP8X のフラグ（チャンクの中身の先頭1バイト）の bit3 が EXIF
    const vp8x = 12;
    expect(new TextDecoder().decode(result.slice(vp8x, vp8x + 4))).toBe("VP8X");
    expect((result[vp8x + 8] as number) & 0x08).toBe(0);
  });

  it("#140 AC-1: GIF（Exif を持たない）は変えない", async () => {
    expect(Array.from(await stripExif(GIF_BYTES, "image/gif"))).toEqual(
      Array.from(GIF_BYTES),
    );
  });

  it.each([
    [
      "JPEG の途中で切れた",
      () => buildJpeg({ exif: true }).slice(0, 12),
      "image/jpeg",
    ],
    [
      "PNG のチャンクの長さが壊れた",
      async () => {
        const png = await buildPng({ exif: FAKE_EXIF_TIFF });
        const broken = png.slice();
        broken.set([0x7f, 0xff, 0xff, 0xff], 8);
        return broken;
      },
      "image/png",
    ],
  ] as const)(
    "#140 AC-1: %s画像は例外を投げる（握りつぶさない）",
    async (_label, make, contentType) => {
      const bytes = await make();
      await expect(
        (async () => stripExif(bytes, contentType))(),
      ).rejects.toThrow();
    },
  );
});

// #140 コードレビュー1回目（重大1）：Exif・位置情報は、eXIf・APP1（Exif）以外の入れ物にも入る。
// 決めた期待（原則「位置情報を含みうるメタデータは残さない」）：
//   PNG：tEXt・zTXt・iTXt はキーワードによらずすべて除く（Comment・Software も除く）。除いた後は、テキストのない PNG と同じバイト列（IHDR・IDAT・IEND と各 CRC が保たれる）。
//   JPEG：APP1 の XMP と APP13（Photoshop の IPTC）も除く。ほかのセグメントと画像の本体はそのまま。
//   WebP：XMP チャンクも除き、VP8X の XMP のフラグ（bit2）を下ろし、RIFF のサイズを直す。
describe("#140 AC-1 Exif の除去（ほかの入れ物）", () => {
  const MARKER_TEXT = ascii("[UNIT_TEST]GPS");

  it.each([
    ["tEXt", "Raw profile type exif"],
    ["zTXt", "Raw profile type exif"],
    ["iTXt", "Raw profile type exif"],
    ["tEXt", "Raw profile type APP1"],
    ["zTXt", "Raw profile type APP1"],
  ] as const)(
    "#140 AC-1: PNG の %s「%s」に入れた Exif を除き、テキストのない PNG と同じバイト列になる",
    async (type, keyword) => {
      const png = await buildPngWithText([
        { type, keyword, text: RAW_PROFILE_EXIF_TEXT },
      ]);
      const result = await stripExif(png, "image/png");
      expect(includesBytes(result, ascii(keyword))).toBe(false);
      expect(includesBytes(result, MARKER_TEXT)).toBe(false);
      expect(Array.from(result)).toEqual(Array.from(await buildPng()));
    },
  );

  it("#140 AC-1: PNG の iTXt「XML:com.adobe.xmp」（XMP の位置情報）を除く", async () => {
    const png = await buildPngWithText([
      { type: "iTXt", keyword: "XML:com.adobe.xmp", text: FAKE_XMP },
    ]);
    const result = await stripExif(png, "image/png");
    expect(includesBytes(result, MARKER_TEXT)).toBe(false);
    expect(Array.from(result)).toEqual(Array.from(await buildPng()));
  });

  it("#140 AC-1（決めた期待）: PNG の関係のないテキスト（Comment・Software）も除き、テキストのない PNG と同じバイト列になる", async () => {
    const png = await buildPngWithText([
      { type: "tEXt", keyword: "Comment", text: "[UNIT_TEST]コメント" },
      { type: "iTXt", keyword: "Software", text: "[UNIT_TEST]ソフト" },
      {
        type: "zTXt",
        keyword: "Raw profile type exif",
        text: RAW_PROFILE_EXIF_TEXT,
      },
    ]);
    const result = await stripExif(png, "image/png");
    expect(Array.from(result)).toEqual(Array.from(await buildPng()));
  });

  it.each([
    ["APP1 の XMP", JPEG_APP1_XMP],
    ["APP13（Photoshop の IPTC）", JPEG_APP13],
  ])(
    "#140 AC-1: JPEG の %s を除き、ほかのセグメントと画像の本体はそのまま残す",
    async (_label, segment) => {
      const result = await stripExif(
        buildJpeg({ exif: true, segments: [segment] }),
        "image/jpeg",
      );
      expect(includesBytes(result, MARKER_TEXT)).toBe(false);
      expect(Array.from(result)).toEqual(Array.from(buildJpeg()));
    },
  );

  it("#140 AC-1: WebP の XMP チャンクと EXIF チャンクを除き、VP8X の XMP・EXIF のフラグを下ろし、RIFF のサイズを直す", async () => {
    const result = await stripExif(
      buildWebp({ exif: true, xmp: true }),
      "image/webp",
    );
    expect(includesBytes(result, MARKER_TEXT)).toBe(false);
    expect(includesBytes(result, ascii("XMP "))).toBe(false);
    const view = new DataView(result.buffer, result.byteOffset, result.length);
    expect(view.getUint32(4, true)).toBe(result.length - 8);
    const vp8x = 12;
    expect(new TextDecoder().decode(result.slice(vp8x, vp8x + 4))).toBe("VP8X");
    expect((result[vp8x + 8] as number) & 0x0c).toBe(0);
  });
});

// #140 ミューテーション（絞った診断）への対応：画像のチャンク・セグメントが順番どおり・内容どおりに残ること、壊れた入力の境界（1バイト前後）。
// 期待は各形式の仕様（JPEG のセグメントの長さは長さ欄自身の2バイトを含む／PNG のチャンクは長さ4・種類4・中身・CRC4／
//   WebP は RIFF のサイズ＝全体−8、チャンクは種類4・長さ4・中身・奇数なら1バイトの詰め物）から決める。
const u32 = (n: number) =>
  new Uint8Array([
    n & 0xff,
    (n >>> 8) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 24) & 0xff,
  ]);
const riff = (...chunks: Uint8Array[]) => {
  const body = concat(ascii("WEBP"), ...chunks);
  return concat(ascii("RIFF"), u32(body.length), body);
};
const chunk = (type: string, data: Uint8Array) =>
  concat(
    ascii(type),
    u32(data.length),
    data,
    data.length % 2 === 1 ? new Uint8Array([0]) : new Uint8Array(),
  );
const vp8x = (flags: number) =>
  chunk("VP8X", new Uint8Array([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

const brokenName = async (run: () => unknown) => {
  try {
    await run();
  } catch (error) {
    return (error as Error).name;
  }
  return "成功した";
};

describe("#140 AC-1 WebP の画像のチャンクを残す", () => {
  it("#140 AC-1: EXIF・XMP だけを除き、VP8X（ほかのフラグは保つ）・ANIM・ALPH・VP8L・未知のチャンクは順番どおり・内容どおりに残る", async () => {
    const anim = chunk("ANIM", ascii("[UNIT_TEST]anim"));
    const alph = chunk("ALPH", ascii("[UNIT_TEST]alph."));
    const vp8l = chunk("VP8L", ascii("[UNIT_TEST]vp8l"));
    const unknown = chunk("UNKN", ascii("[UNIT_TEST]x"));
    const input = riff(
      vp8x(0x10 | 0x08 | 0x04 | 0x02),
      anim,
      chunk("EXIF", FAKE_EXIF_TIFF),
      alph,
      vp8l,
      chunk("XMP ", ascii(FAKE_XMP)),
      unknown,
    );
    const expected = riff(vp8x(0x10 | 0x02), anim, alph, vp8l, unknown);
    expect(Array.from(await stripExif(input, "image/webp"))).toEqual(
      Array.from(expected),
    );
  });

  it("#140 AC-1: 中身が空のチャンクで RIFF がちょうど終わる WebP はそのまま返す", async () => {
    const input = riff(chunk("VP8 ", new Uint8Array()));
    expect(Array.from(await stripExif(input, "image/webp"))).toEqual(
      Array.from(input),
    );
  });

  it("#140 AC-1: 先頭の12バイト（RIFF・サイズ・WEBP）だけの WebP はそのまま返す", async () => {
    const input = riff();
    expect(Array.from(await stripExif(input, "image/webp"))).toEqual(
      Array.from(input),
    );
  });
});

describe("#140 AC-1 壊れた画像の境界（BrokenImageError）", () => {
  it("#140 AC-1: SOI と長さ2の SOS だけの JPEG（長さがちょうど終わる）はそのまま返す", async () => {
    const input = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]);
    expect(Array.from(await stripExif(input, "image/jpeg"))).toEqual(
      Array.from(input),
    );
  });

  it.each([
    ["1バイト目が 0xff でない", [0x00, 0xd8, 0xff, 0xda, 0x00, 0x02]],
    ["2バイト目が 0xd8 でない", [0xff, 0x00, 0xff, 0xda, 0x00, 0x02]],
    ["セグメントの先頭が 0xff でない", [0xff, 0xd8, 0x00, 0xda, 0x00, 0x02]],
    [
      "セグメントの見出しが4バイトに1バイト足りない",
      [0xff, 0xd8, 0xff, 0xda, 0x00],
    ],
    ["セグメントの長さが1（2未満）", [0xff, 0xd8, 0xff, 0xda, 0x00, 0x01]],
    [
      "セグメントの長さが残りを1バイト超える",
      [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x03, 0x00],
    ],
  ])("#140 AC-1: JPEG の%sと BrokenImageError", async (_label, bytes) => {
    expect(
      await brokenName(() => stripExif(new Uint8Array(bytes), "image/jpeg")),
    ).toBe("BrokenImageError");
  });

  it("#140 AC-1: PNG の署名の最後の1バイトが違うと BrokenImageError", async () => {
    const png = await buildPng();
    const broken = png.slice();
    broken[7] = 0x0b;
    expect(await brokenName(() => stripExif(broken, "image/png"))).toBe(
      "BrokenImageError",
    );
  });

  it("#140 AC-1: PNG の署名の最初の1バイトが違うと BrokenImageError", async () => {
    const png = await buildPng();
    const broken = png.slice();
    broken[0] = 0x88;
    expect(await brokenName(() => stripExif(broken, "image/png"))).toBe(
      "BrokenImageError",
    );
  });

  it("#140 AC-1: PNG のチャンクの見出し（12バイト）が1バイト足りないと BrokenImageError", async () => {
    const png = await buildPng();
    expect(
      await brokenName(() => stripExif(png.slice(0, 8 + 11), "image/png")),
    ).toBe("BrokenImageError");
  });

  it("#140 AC-1: PNG の IEND の長さが残りを1バイト超えると BrokenImageError", async () => {
    const png = await buildPng();
    const broken = png.slice();
    // IEND は最後の12バイト。長さ欄（先頭4バイト）を1にする
    broken.set([0, 0, 0, 1], broken.length - 12);
    expect(await brokenName(() => stripExif(broken, "image/png"))).toBe(
      "BrokenImageError",
    );
  });

  it.each([
    ["11バイトしかない", () => riff().slice(0, 11)],
    ["RIFF でない", () => concat(ascii("RIFX"), riff().slice(4))],
    ["WEBP でない", () => concat(riff().slice(0, 8), ascii("WEBQ"))],
    [
      "RIFF のサイズが実際より1バイト大きい",
      () => {
        const input = riff(chunk("VP8 ", new Uint8Array(2)));
        const out = input.slice();
        new DataView(out.buffer).setUint32(4, input.length - 8 + 1, true);
        return out;
      },
    ],
    [
      "チャンクの見出しが8バイトに足りない",
      () => {
        const body = concat(ascii("WEBP"), ascii("VP8 "));
        return concat(ascii("RIFF"), u32(body.length), body);
      },
    ],
    [
      "チャンクの長さが RIFF の終わりを1バイト超える",
      () => {
        const body = concat(
          ascii("WEBP"),
          ascii("VP8 "),
          u32(4),
          new Uint8Array(3),
        );
        return concat(ascii("RIFF"), u32(body.length), body);
      },
    ],
  ])("#140 AC-1: WebP が%sと BrokenImageError", async (_label, make) => {
    expect(await brokenName(() => stripExif(make(), "image/webp"))).toBe(
      "BrokenImageError",
    );
  });
});
