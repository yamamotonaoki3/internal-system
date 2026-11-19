// #148（148-B-2）5-2 AC-9・計画 6.5：公開範囲の変更の監査の操作と対象の種類が、監査の検索の一覧（定義元）に登録されていること。
// 未登録だと、監査の検索で「この対象で絞り込む」が 422 になる。
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "./audit-actions";

describe("#148 AC-9 監査の操作と対象の種類の登録", () => {
  it("#148 AC-9 D4: 操作 case.attachment.visibility.change がある", () => {
    expect(AUDIT_ACTIONS as readonly string[]).toContain(
      "case.attachment.visibility.change",
    );
  });

  it("#148 AC-9: 対象の種類 attachment がある", () => {
    expect(AUDIT_TARGET_TYPES as readonly string[]).toContain("attachment");
  });
});
