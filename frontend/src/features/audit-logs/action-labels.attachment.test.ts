// #148（148-B-2）5-2 AC-9・計画 6.5：監査ログの画面（S-xx 監査ログ）で、公開範囲の変更の操作と、対象の種類 attachment に日本語の名前が出ること。
// ファイル名は監査の画面に出さない（対象は種類の名前だけ。NAMED_TARGET_TYPES に足さない）。
// 文言（テストが決めたもの。計画の案）：操作「案件の添付の公開範囲の変更」、対象の種類「添付ファイル」。
import { describe, expect, it } from "vitest";
import {
  ACTION_LABELS,
  TARGET_TYPE_LABELS,
  actionLabel,
  targetTypeLabel,
} from "./action-labels";

describe("#148 AC-9 監査の表示名", () => {
  it("#148 AC-9: 操作 case.attachment.visibility.change は「案件の添付の公開範囲の変更」", () => {
    expect(ACTION_LABELS.has("case.attachment.visibility.change")).toBe(true);
    expect(actionLabel("case.attachment.visibility.change")).toBe(
      "案件の添付の公開範囲の変更",
    );
  });

  it("#148 AC-9: 対象の種類 attachment は「添付ファイル」", () => {
    expect(TARGET_TYPE_LABELS.has("attachment")).toBe(true);
    expect(targetTypeLabel("attachment")).toBe("添付ファイル");
  });
});
