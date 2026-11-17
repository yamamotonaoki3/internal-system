// #140 AC-1（1-6 AC-5、C-126(5)・C-137(1)・C-153）: 添付の形式の検査（backend/src/lib/attachment-inspection.ts）を、架空・無害なバイト列で確かめる。
// 形式は拡張子ではなく中身で判定し、拡張子と中身の種類が一致するものだけ受け付ける（偽装の拒否）。SVG・HTML・実行形式・一般の zip・旧形式の Office は受け付けない。
// zip の構造の細部（暗号化・ZIP64・エントリ数・展開後のサイズ・vbaProject.bin）は ooxml-check.test.ts で確かめ、ここでは拡張子との組み合わせだけを見る（#271：同じ性質を重ねない）。
//
// 実装が前提とする約束（このテストが固定する）：
//   inspectAttachment(name: string, bytes: Uint8Array): Promise<
//     { ok: true; kind: "image" | "document" | "video"; contentType: string } | { ok: false }>
//   contentType はサーバーの判定結果から付ける固定の値（下の表）。
import { describe, expect, it } from "vitest";
import {
  CSV_BYTES,
  EXE_LIKE_BYTES,
  GIF_BYTES,
  HTML_BYTES,
  INVALID_UTF8,
  MATROSKA_BYTES,
  MP4_BYTES,
  OLE2_BYTES,
  PDF_BYTES,
  SVG_BYTES,
  TEXT_BYTES,
  TEXT_WITH_NUL,
  WEBM_BYTES,
  ascii,
  buildJpeg,
  buildOoxml,
  buildPng,
  buildWebp,
  buildZip,
} from "../../test/attachment-files";
import { inspectAttachment } from "./attachment-inspection";

const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

describe("#140 AC-1（1-6 AC-5）許可する形式", () => {
  it.each([
    ["photo.jpg", () => buildJpeg(), "image", "image/jpeg"],
    ["photo.JPEG", () => buildJpeg(), "image", "image/jpeg"],
    ["image.png", () => buildPng(), "image", "image/png"],
    ["anime.gif", () => GIF_BYTES, "image", "image/gif"],
    ["pic.webp", () => buildWebp(), "image", "image/webp"],
    ["report.pdf", () => PDF_BYTES, "document", "application/pdf"],
    ["memo.txt", () => TEXT_BYTES, "document", "text/plain; charset=utf-8"],
    ["movie.mp4", () => MP4_BYTES, "video", "video/mp4"],
    ["clip.webm", () => WEBM_BYTES, "video", "video/webm"],
    ["doc.docx", () => buildOoxml("docx"), "document", DOCX],
    ["sheet.xlsx", () => buildOoxml("xlsx"), "document", XLSX],
    ["slide.pptx", () => buildOoxml("pptx"), "document", PPTX],
  ] as const)(
    "#140 AC-1（1-6 AC-5）: %s は %s・%s として受け付ける",
    async (name, make, kind, contentType) => {
      expect(await inspectAttachment(name, await make())).toEqual({
        ok: true,
        kind,
        contentType,
      });
    },
  );

  it("#140 AC-1（1-6 AC-5）: CSV（UTF-8）は文書として受け付ける", async () => {
    const result = await inspectAttachment("list.csv", CSV_BYTES);
    expect(result).toMatchObject({ ok: true, kind: "document" });
  });

  it("#140 AC-1（C-153）: embeddings/ を含む docx は受け付ける", async () => {
    const bytes = await buildOoxml("docx", {
      extra: [
        { name: "word/embeddings/oleObject1.bin", data: ascii("[UNIT_TEST]") },
      ],
    });
    expect(await inspectAttachment("doc.docx", bytes)).toMatchObject({
      ok: true,
      contentType: DOCX,
    });
  });
});

describe("#140 AC-1（1-6 AC-5、C-126(5)）拒否する形式・偽装", () => {
  it.each([
    ["PNG の中身で拡張子が .jpg", "photo.jpg", () => buildPng()],
    ["JPEG の中身で拡張子が .png", "image.png", () => buildJpeg()],
    ["PDF の中身で拡張子が .png", "image.png", () => PDF_BYTES],
    ["実行形式の中身で拡張子が .pdf", "report.pdf", () => EXE_LIKE_BYTES],
    ["SVG の中身で拡張子が .png", "image.png", () => SVG_BYTES],
    ["SVG", "vector.svg", () => SVG_BYTES],
    ["HTML", "page.html", () => HTML_BYTES],
    ["MP4 の中身で拡張子が .webm", "clip.webm", () => MP4_BYTES],
    [
      "Matroska（mkv）の中身で拡張子が .webm",
      "clip.webm",
      () => MATROSKA_BYTES,
    ],
    ["NUL を含むテキスト", "memo.txt", () => TEXT_WITH_NUL],
    ["UTF-8 として正しくないテキスト", "memo.txt", () => INVALID_UTF8],
    ["PNG の中身で拡張子が .txt", "memo.txt", () => buildPng()],
    ["旧形式の Word（doc）", "old.doc", () => OLE2_BYTES],
    ["旧形式の Excel の中身で拡張子が .xlsx", "sheet.xlsx", () => OLE2_BYTES],
    ["空のファイル", "memo.txt", () => new Uint8Array()],
  ] as const)(
    "#140 AC-1（1-6 AC-5）: %s は受け付けない",
    async (_label, name, make) => {
      expect(await inspectAttachment(name, await make())).toEqual({
        ok: false,
      });
    },
  );

  it("#140 AC-1（C-137(1)）: 一般の zip は、拡張子が .zip でも .docx でも受け付けない", async () => {
    const zip = await buildZip([
      { name: "readme.txt", data: ascii("[UNIT_TEST]"), compress: true },
    ]);
    expect(await inspectAttachment("archive.zip", zip)).toEqual({ ok: false });
    expect(await inspectAttachment("doc.docx", zip)).toEqual({ ok: false });
  });

  it("#140 AC-1（C-137(1)）: docx の中身で拡張子が .xlsx・.pptx のものは受け付けない", async () => {
    const docx = await buildOoxml("docx");
    expect(await inspectAttachment("sheet.xlsx", docx)).toEqual({ ok: false });
    expect(await inspectAttachment("slide.pptx", docx)).toEqual({ ok: false });
  });

  it("#140 AC-1（C-153(2)）: マクロつき（docm・xlsm）は、拡張子が docm・xlsm でも、docx・xlsx に変えても受け付けない", async () => {
    const docm = await buildOoxml("docm");
    const xlsm = await buildOoxml("xlsm");
    expect(await inspectAttachment("macro.docm", docm)).toEqual({ ok: false });
    expect(await inspectAttachment("doc.docx", docm)).toEqual({ ok: false });
    expect(await inspectAttachment("macro.xlsm", xlsm)).toEqual({ ok: false });
    expect(await inspectAttachment("sheet.xlsx", xlsm)).toEqual({ ok: false });
  });

  it("#140 AC-1（C-153）: vbaProject.bin を含む docx は受け付けない（ooxml-check の結果を使う）", async () => {
    const bytes = await buildOoxml("docx", {
      extra: [{ name: "word/vbaProject.bin", data: ascii("[UNIT_TEST]") }],
    });
    expect(await inspectAttachment("doc.docx", bytes)).toEqual({ ok: false });
  });
});
