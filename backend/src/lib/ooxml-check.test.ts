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
  OOXML_MAIN,
  contentTypesXml,
  zip64Extra,
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

// #140 コードレビュー1回目（重大2）：[Content_Types].xml の主の部品の型は、実際の Override 要素だけから判定する。
// 決めた期待（XML 1.0 と OPC の規則。正当な Office のファイルが出力しうる形は許可する）：
//   コメント・CDATA・処理命令の中だけにある Override は数えない（false）。正しい定義にコメントが混ざるだけなら true。
//   属性の値の単一引用符・属性の順の違い・要素名の名前空間の接頭辞（同じ名前空間 URI）は、XML として同じ意味なので true。
describe("#140 AC-1（C-137(1)）[Content_Types].xml の読み方", () => {
  const MAIN = OOXML_MAIN.docx;
  const NS = "http://schemas.openxmlformats.org/package/2006/content-types";
  const DEFAULTS =
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>';
  const OVERRIDE = `<Override PartName="${MAIN.part}" ContentType="${MAIN.type}"/>`;
  const types = (inner: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${NS}">${DEFAULTS}${inner}</Types>`;
  const docxWith = (xml: string) =>
    buildOoxml("docx", { contentTypes: ascii(xml) });

  it.each([
    ["コメントの中", `<!-- ${OVERRIDE} -->`],
    ["CDATA の中", `<![CDATA[${OVERRIDE}]]>`],
    ["処理命令の中", `<?note ${OVERRIDE} ?>`],
  ])(
    "#140 AC-1（C-137(1)）: 主の部品の Override が%sだけにあると false",
    async (_label, inner) => {
      expect(await checkOoxml(await docxWith(types(inner)), "docx")).toBe(
        false,
      );
    },
  );

  it("#140 AC-1（C-137(1)）: 正しい Override にコメントが混ざっているだけなら true", async () => {
    const xml = types(`<!-- [UNIT_TEST] 注記 -->${OVERRIDE}<!-- 終わり -->`);
    expect(await checkOoxml(await docxWith(xml), "docx")).toBe(true);
  });

  it.each([
    [
      "属性の値が単一引用符",
      `<Override PartName='${MAIN.part}' ContentType='${MAIN.type}'/>`,
    ],
    [
      "属性の順が逆",
      `<Override ContentType="${MAIN.type}" PartName="${MAIN.part}"/>`,
    ],
  ])("#140 AC-1（決めた期待）: %sの Override は true", async (_label, el) => {
    expect(await checkOoxml(await docxWith(types(el)), "docx")).toBe(true);
  });

  it("#140 AC-1（決めた期待）: 要素名に名前空間の接頭辞が付く（同じ名前空間）なら true", async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?><ct:Types xmlns:ct="${NS}">` +
      `<ct:Default Extension="xml" ContentType="application/xml"/>` +
      `<ct:Override PartName="${MAIN.part}" ContentType="${MAIN.type}"/></ct:Types>`;
    expect(await checkOoxml(await docxWith(xml), "docx")).toBe(true);
  });

  it("#140 AC-1（C-137(1)）: 別の名前空間の Override（接頭辞が別の URI）は数えず false", async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${NS}" xmlns:x="urn:example:unit-test">` +
      `${DEFAULTS}<x:Override PartName="${MAIN.part}" ContentType="${MAIN.type}"/></Types>`;
    expect(await checkOoxml(await docxWith(xml), "docx")).toBe(false);
  });
});

// #140 コードレビュー1回目（重大3）：ZIP64 は、EOCD だけでなく、ローカルヘッダー・中央ディレクトリのサイズ欄と拡張情報（ID 0x0001）でも拒否する。
// あわせて、ローカルヘッダーと中央ディレクトリで名前・サイズ・圧縮方式が食い違う zip を拒否する（APPNOTE 4.3.7・4.4。データ記述子は使わない形）。
describe("#140 AC-1（Q3）ローカルヘッダーと中央ディレクトリ", () => {
  it.each([
    [
      "主の部品のローカルヘッダーのサイズ欄が 0xffffffff で、ZIP64 の拡張情報を持つ",
      {
        local: {
          compressedSize: 0xffffffff,
          uncompressedSize: 0xffffffff,
          extra: zip64Extra(60, 60),
        },
      },
    ],
    [
      "主の部品のローカルヘッダーだけに ZIP64 の拡張情報がある（サイズ欄は通常）",
      { local: { extra: zip64Extra(60, 60) } },
    ],
    [
      "主の部品の中央ディレクトリに ZIP64 の拡張情報がある",
      { centralExtra: zip64Extra(60, 60) },
    ],
  ] as const)("#140 AC-1（Q3）: %s zip は false", async (_label, mainEntry) => {
    const bytes = await buildOoxml("docx", {
      mainEntry: mainEntry as Partial<ZipEntry>,
    });
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });

  it("#140 AC-1（Q3）: [Content_Types].xml のローカルヘッダーのサイズ欄が 0xffffffff なら false", async () => {
    const bytes = await buildOoxml("docx", {
      contentTypesEntry: {
        local: { compressedSize: 0xffffffff, uncompressedSize: 0xffffffff },
      },
    });
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });

  it.each([
    ["名前", { local: { name: "[Content_Types].xmL" } }],
    ["圧縮後のサイズ", { local: { compressedSize: 7 } }],
    ["展開後のサイズ", { local: { uncompressedSize: 7 } }],
    ["圧縮方式", { local: { method: 0 } }],
  ] as const)(
    "#140 AC-1（C-153）: [Content_Types].xml のローカルヘッダーと中央ディレクトリで%sが食い違うと false",
    async (_label, entry) => {
      const bytes = await buildOoxml("docx", {
        contentTypesEntry: entry as Partial<ZipEntry>,
      });
      expect(await checkOoxml(bytes, "docx")).toBe(false);
    },
  );

  it("#140 AC-1（C-153）: 主の部品のローカルヘッダーの名前が中央ディレクトリと違うと false", async () => {
    const bytes = await buildOoxml("docx", {
      mainEntry: { local: { name: "word/other.xml" } },
    });
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });
});

// #140 統括の決定：データ記述子（汎用フラグの bit3）を使うエントリは許可する（Java 製のツール等が出力する正当な Office ファイル）。
// その場合はサイズの突き合わせを省き、名前と圧縮方式はローカルと中央で突き合わせる。bit3 がないのにローカルのサイズが0で食い違うものは拒否する。
describe("#140 AC-1（C-137(1)・C-153）データ記述子", () => {
  const withDescriptor = (extra: Partial<ZipEntry> = {}) =>
    buildOoxml("docx", {
      contentTypesEntry: { dataDescriptor: true, ...extra },
      mainEntry: { dataDescriptor: true },
    });

  it("#140 AC-1（決定）: データ記述子つきの正当な docx は true", async () => {
    expect(await checkOoxml(await withDescriptor(), "docx")).toBe(true);
  });

  it("#140 AC-1（決定）: データ記述子つきで、ローカルと中央の名前が食い違うと false", async () => {
    const bytes = await withDescriptor({
      local: { name: "[Content_Types].xmL" },
    });
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });

  it("#140 AC-1（決定）: データ記述子つきで、ローカルと中央の圧縮方式が食い違うと false", async () => {
    const bytes = await withDescriptor({ local: { method: 0 } });
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });

  it("#140 AC-1（決定）: bit3 が立っていないのに、ローカルのサイズ欄が0で中央と食い違うと false", async () => {
    const bytes = await buildOoxml("docx", {
      contentTypesEntry: {
        local: { compressedSize: 0, uncompressedSize: 0 },
      },
    });
    expect(await checkOoxml(bytes, "docx")).toBe(false);
  });
});
