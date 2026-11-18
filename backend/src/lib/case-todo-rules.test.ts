// #149（149-A）5-4 AC-2・C-90・C-121：TODO の題名の規則（shared/case-todo-rules.ts）。
// 題名は、件名と同じ整形（C-121：全角の英数字を半角・ハイフン類を「-」・連続する空白を1つ・前後の空白を除く）の後に、1〜100 文字（UTF-16 の単位）。
// 期待値は AC・決定記録から決める（整形の関数の出力を写さない）。上限 100 は C-90 の TODO の定めで、件名の上限とは別の定数。
// 契約（実装の担当へ）：shared/case-todo-rules.ts
//   export const CASE_TODO_TITLE_MAX_LENGTH = 100
//   export const caseTodoTitleSchema: z.ZodType<string>（入力の文字列を整形して返す。不正なら safeParse が失敗）
import { describe, expect, it } from "vitest";
import {
  CASE_TODO_TITLE_MAX_LENGTH,
  caseTodoTitleSchema,
} from "../../../shared/case-todo-rules";

const parse = (raw: string) => caseTodoTitleSchema.safeParse(raw);

describe("#149 AC-1 5-4 AC-2（C-90・C-121）TODO の題名", () => {
  it("#149 AC-1 5-4 AC-2: 上限は 100 文字（C-90）", () => {
    expect(CASE_TODO_TITLE_MAX_LENGTH).toBe(100);
  });

  it("#149 AC-1 5-4 AC-2（C-121）: 全角の英数字を半角に、連続する空白を1つに、前後の空白を除いてから受け付ける", () => {
    const result = parse("　ＡＢＣ１２３　　見積り　 ");
    expect(result.success).toBe(true);
    expect(result.data).toBe("ABC123 見積り");
  });

  it("#149 AC-1 5-4 AC-2（C-121）: ハイフン類は「-」にする（長音符は変えない）", () => {
    expect(parse("資料－作成ー確認").data).toBe("資料-作成ー確認");
  });

  it.each([
    ["空文字", ""],
    ["空白だけ（整形すると0文字）", "　 \t "],
  ])("#149 AC-1 5-4 AC-2: %s は受け付けない（1文字以上）", (_label, raw) => {
    expect(parse(raw).success).toBe(false);
  });

  it("#149 AC-1 5-4 AC-2: 1文字は受け付ける", () => {
    expect(parse("a").data).toBe("a");
  });

  it("#149 AC-1 5-4 AC-2: ちょうど 100 文字は受け付け、101 文字は受け付けない", () => {
    expect(parse("あ".repeat(100)).data).toBe("あ".repeat(100));
    expect(parse("あ".repeat(101)).success).toBe(false);
  });

  it("#149 AC-1 5-4 AC-2: 前後の空白を除いた後で 100 文字なら受け付ける（整形の後に数える）", () => {
    expect(parse(`  ${"い".repeat(100)}  `).data).toBe("い".repeat(100));
  });

  it("#149 AC-1 5-4 AC-2: サロゲートペアは UTF-16 の単位で2と数える（98＋1 個で 100 は可、99＋1 個で 101 は不可）", () => {
    expect(parse(`${"う".repeat(98)}😀`).success).toBe(true);
    expect(parse(`${"う".repeat(99)}😀`).success).toBe(false);
  });

  it("#149 AC-1 5-4 AC-2: 文字列でない値は受け付けない", () => {
    expect(caseTodoTitleSchema.safeParse(1).success).toBe(false);
    expect(caseTodoTitleSchema.safeParse(null).success).toBe(false);
  });
});
