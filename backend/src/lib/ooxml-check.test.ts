// #140 AC-1（1-6 AC-5、C-137(1)・C-153）: Office の新しい形式（docx・xlsx・pptx）の zip の構造の自前の検査（backend/src/lib/ooxml-check.ts）を確かめる。
// 決定（計画 Q3）：エントリ数は10,000まで／[Content_Types].xml の展開後は1MB（1,000,000バイト）まで／vbaProject.bin を含むものは拒否、embeddings/ は許可／
//   暗号化・ZIP64・複数ディスクの zip は拒否。[Content_Types].xml がない・末尾が切れた zip は拒否。
// [Content_Types].xml は圧縮（deflate）したものを使い、ヘッダーのサイズを偽っても展開の途中で上限を超えたら拒否することを確かめる。
// テスト用の zip は backend/test/attachment-files.ts で組む（架空・無害）。
//
// 実装が前提とする約束（このテストが固定する）：
//   checkOoxml(bytes: Uint8Array, extension: "docx" | "xlsx" | "pptx"): Promise<boolean>
//   true は「zip の構造が正しく、[Content_Types].xml の主の部品の種類が extension と一致し、禁止の要素がない」。それ以外は false（例外を投げない）。
import { describe, expect, it } from "vitest";
import {
  ascii,
  buildOoxml,
  buildZip,
  contentTypesXml,
  type ZipEntry,
} from "../../test/attachment-files";
import { checkOoxml } from "./ooxml-check";

const smallEntries = (count: number): ZipEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    name: `customXml/i${i}.xml`,
    data: new Uint8Array(),
  }));

describe("#140 AC-1（C-137(1)）正しい形", () => {
  it.each(["docx", "xlsx", "pptx"] as const)(
    "#140 AC-1（C-137(1)）: 圧縮した [Content_Types].xml を持つ正しい %s は true",
    async (flavor) => {
      expect(await checkOoxml(await buildOoxml(flavor), flavor)).toBe(true);
    },
  );

  it("#140 AC-1（C-137(1)）: [Content_Types].xml が無圧縮でも true", async () => {
    const bytes = await buildOoxml("docx", {
      contentTypesEntry: { compress: false },
    });
    expect(await checkOoxml(bytes, "docx")).toBe(true);
  });

  it("#140 AC-1（Q3）: embeddings/ を含むものは true", async () => {
    const bytes = await buildOoxml("xlsx", {
      extra: [
        { name: "xl/embeddings/oleObject1.bin", data: ascii("[UNIT_TEST]") },
      ],
    });
    expect(await checkOoxml(bytes, "xlsx")).toBe(true);
  });

  it("#140 AC-1（Q3）: エントリ数ちょうど10,000は true", async () => {
    // buildOoxml は3エントリ（[Content_Types].xml・_rels/.rels・本体）を持つ
    const bytes = await buildOoxml("docx", { extra: smallEntries(9_997) });
    expect(await checkOoxml(bytes, "docx")).toBe(true);
  });

  it("#140 AC-1（Q3）: [Content_Types].xml の展開後がちょうど1,000,000バイトは true", async () => {
    const base = contentTypesXml("docx");
    const padded = contentTypesXml("docx", 1_000_000 - base.length);
    expect(padded.length).toBe(1_000_000);
    const bytes = await buildOoxml("docx", { contentTypes: ascii(padded) });
    expect(await checkOoxml(bytes, "docx")).toBe(true);
  });
});

describe("#140 AC-1（C-153・Q3）拒否", () => {
  it("#140 AC-1（C-137(1)）: 主の部品の種類が拡張子と違う（docx の中身を xlsx・pptx として）と false", async () => {
    const docx = await buildOoxml("docx");
    expect(await checkOoxml(docx, "xlsx")).toBe(false);
    expect(await checkOoxml(docx, "pptx")).toBe(false);
  });

  it("#140 AC-1（C-153(2)）: マクロつき（docm・xlsm）の主の部品は false", async () => {
    expect(await checkOoxml(await buildOoxml("docm"), "docx")).toBe(false);
    expect(await checkOoxml(await buildOoxml("xlsm"), "xlsx")).toBe(false);
  });

  it("#140 AC-1（C-153）: [Content_Types].xml のない zip は false", async () => {
    const bytes = await buildOoxml("docx", { omitContentTypes: true });
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });

  it("#140 AC-1（C-137(1)）: 一般の zip（Office の部品がない）は false", async () => {
    const bytes = await buildZip([
      { name: "readme.txt", data: ascii("[UNIT_TEST]"), compress: true },
    ]);
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });

  it.each([
    ["末尾（EOCD）が切れた", 10],
    ["中央ディレクトリの途中で切れた", 60],
  ])("#140 AC-1（C-153）: %s zip は false", async (_label, cut) => {
    const bytes = await buildOoxml("docx");
    expect(await checkOoxml(bytes.slice(0, bytes.length - cut), "docx")).toBe(
      false,
    );
  });

  it("#140 AC-1（C-153）: zip ではないバイト列は false", async () => {
    expect(await checkOoxml(ascii("[UNIT_TEST] not a zip"), "docx")).toBe(
      false,
    );
  });

  it("#140 AC-1（Q3）: vbaProject.bin を含むもの（主の部品が docx でも）は false", async () => {
    const bytes = await buildOoxml("docx", {
      extra: [{ name: "word/vbaProject.bin", data: ascii("[UNIT_TEST]") }],
    });
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });

  it("#140 AC-1（Q3）: 暗号化のフラグが立ったエントリを含むものは false", async () => {
    const bytes = await buildOoxml("docx", {
      extra: [
        { name: "word/secret.xml", data: ascii("[UNIT_TEST]"), flags: 1 },
      ],
    });
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });

  it("#140 AC-1（Q3）: ZIP64 の zip は false", async () => {
    const bytes = await buildOoxml("docx", { zip: { zip64: true } });
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });

  it("#140 AC-1（Q3）: 複数ディスクの zip は false", async () => {
    const bytes = await buildOoxml("docx", { zip: { diskNumber: 1 } });
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });

  it("#140 AC-1（Q3）: エントリ数10,001は false", async () => {
    const bytes = await buildOoxml("docx", { extra: smallEntries(9_998) });
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });

  it("#140 AC-1（Q3）: [Content_Types].xml の展開後が1,000,001バイトは false", async () => {
    const base = contentTypesXml("docx");
    const padded = contentTypesXml("docx", 1_000_001 - base.length);
    const bytes = await buildOoxml("docx", { contentTypes: ascii(padded) });
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });

  it("#140 AC-1（Q3）: ヘッダーの展開後のサイズを小さく偽っても、展開の途中で1MBを超えたら false", async () => {
    const padded = contentTypesXml("docx", 3_000_000);
    const bytes = await buildOoxml("docx", {
      contentTypes: ascii(padded),
      contentTypesEntry: { declaredSize: 500 },
    });
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });
});
