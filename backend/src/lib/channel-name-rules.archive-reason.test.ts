// #143-a a-AC-2（2-6 AC-6・V-48）: アーカイブの理由の規則（shared/channel-name-rules.ts の ARCHIVE_REASON_MAX_LENGTH・archiveReasonSchema）。
// 期待値は要件の数字をそのまま書く（定義から作らない）：理由は任意。入力する場合は前後の空白を除いて1〜500文字。
// 送らない・空・空白だけは「理由なし」（V-48 の【案】。計画 #143-a の API の節）。
// 契約（実装前。報告に明記）：
//   ARCHIVE_REASON_MAX_LENGTH = 500
//   archiveReasonSchema（Zod。任意）：undefined を受け付ける。文字列は前後の空白を除き、空なら「理由なし」（undefined か null）、
//     1〜500 文字ならその文字列（除いた後）。500 文字を超えれば失敗
// データは架空のもの。
import { describe, expect, it } from "vitest";
import {
  ARCHIVE_REASON_MAX_LENGTH,
  archiveReasonSchema,
} from "../../../shared/channel-name-rules";

describe("#143 a-AC-2（V-48）アーカイブの理由", () => {
  it("#143 a-AC-2（2-6 AC-6）: 上限は 500 文字", () => {
    expect(ARCHIVE_REASON_MAX_LENGTH).toBe(500);
  });

  it("#143 a-AC-2: 理由を送らない（undefined）ことができ、理由なしになる", () => {
    const result = archiveReasonSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    expect(result.data ?? null).toBeNull();
  });

  it.each([
    ["空", ""],
    ["半角空白だけ", "   "],
    ["全角空白だけ", "　　"],
    ["改行だけ", "\n\n"],
  ])(
    "#143 a-AC-2（V-48【案】）: %sの理由は「理由なし」として受け付ける",
    (_label, raw) => {
      const result = archiveReasonSchema.safeParse(raw);
      expect(result.success).toBe(true);
      expect(result.data ?? null).toBeNull();
    },
  );

  it("#143 a-AC-2: 前後の空白を除いた 1 文字と 500 文字は使え、結果は除いた後の文字列", () => {
    expect(archiveReasonSchema.parse(" あ ")).toBe("あ");
    expect(archiveReasonSchema.parse(`　${"あ".repeat(500)}　`)).toBe(
      "あ".repeat(500),
    );
  });

  it.each([
    ["501 文字", "あ".repeat(501)],
    ["前後に空白を付けた 501 文字", ` ${"あ".repeat(501)} `],
  ])("#143 a-AC-2: %sの理由は受け付けない", (_label, raw) => {
    expect(archiveReasonSchema.safeParse(raw).success).toBe(false);
  });

  it("#143 a-AC-2: 文字列でない理由は受け付けない", () => {
    expect(archiveReasonSchema.safeParse(1).success).toBe(false);
  });
});
