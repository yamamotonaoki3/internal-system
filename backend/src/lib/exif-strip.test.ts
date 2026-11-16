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
