// #140 AC-3（C-137・C-153、security）: 配信の Content-Disposition の組み立て（backend/src/lib/content-disposition.ts）を確かめる。
// 計画「情報漏えいの経路と対策」：画像・動画は inline、それ以外は attachment（どちらにするかは呼び出し側が渡す）。
//   ASCII に置き換えた filename と、filename*=UTF-8''<RFC 5987 のエンコード> を付ける。
//   ヘッダーを壊す文字（改行・「"」・「\」・制御文字）は filename に出さない（保存時に 422 で弾くが、ここでも安全な形にする）。
// 期待値は RFC 6266・RFC 5987 の規則から手で書く。
//
// 実装が前提とする約束（このテストが固定する）：
//   contentDisposition(name: string, disposition: "inline" | "attachment"): string
//   形：`<disposition>; filename="<ASCII>"; filename*=UTF-8''<エンコード>`
import { describe, expect, it } from "vitest";
import { contentDisposition } from "./content-disposition";

const parse = (header: string) => {
  const match =
    /^(inline|attachment); filename="([^"]*)"; filename\*=UTF-8''(\S+)$/.exec(
      header,
    );
  if (match === null) throw new Error(`形が違います：${header}`);
  return { type: match[1], ascii: match[2] as string, encoded: match[3] };
};

describe("#140 AC-3 Content-Disposition", () => {
  it("#140 AC-3: ASCII の名前は、filename と filename* の両方にそのまま入る", () => {
    expect(contentDisposition("report.pdf", "attachment")).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it("#140 AC-3: inline を指定すると inline になる", () => {
    expect(contentDisposition("photo.png", "inline")).toBe(
      `inline; filename="photo.png"; filename*=UTF-8''photo.png`,
    );
  });

  it("#140 AC-3: 日本語の名前は filename* に UTF-8 のパーセントエンコードで入り、filename は ASCII だけになる", () => {
    const parsed = parse(contentDisposition("報告書 2026.pdf", "attachment"));
    expect(parsed.type).toBe("attachment");
    expect(parsed.encoded).toBe("%E5%A0%B1%E5%91%8A%E6%9B%B8%202026.pdf");
    expect(parsed.ascii).toMatch(/^[\x20-\x7e]+$/);
    expect(parsed.ascii.endsWith(".pdf")).toBe(true);
  });

  it("#140 AC-3: RFC 5987 の attr-char でない「'」「(」「)」「*」「;」「,」は filename* でエンコードする", () => {
    const parsed = parse(contentDisposition("it's (1)*;,.txt", "attachment"));
    expect(parsed.encoded).toBe("it%27s%20%281%29%2A%3B%2C.txt");
  });

  it.each([
    ["二重引用符", 'a"b.txt'],
    ["バックスラッシュ", "a\\b.txt"],
    ["改行", "a\r\nb.txt"],
    ["NUL", "a\u0000b.txt"],
  ])(
    "#140 AC-3: %sを含む名前でも、ヘッダーの形を壊さない（filename に出さない）",
    (_label, name) => {
      const header = contentDisposition(name, "attachment");
      expect(header).not.toMatch(/[\r\n\u0000]/);
      const parsed = parse(header);
      expect(parsed.ascii).not.toMatch(/["\\]/);
      expect(parsed.ascii).toMatch(/^[\x20-\x7e]*$/);
    },
  );
});
