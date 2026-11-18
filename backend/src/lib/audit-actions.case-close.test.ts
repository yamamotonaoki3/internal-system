// #150（150-A）5-1 AC-13：案件の終了・再開の監査の操作の種類が、監査ログの操作の一覧（AUDIT_ACTIONS。画面の絞り込みの候補の定義元）にあること。
// 期待値は計画 150-A 6.3（case.close・case.reopen。対象の種類は case）から決める。
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "./audit-actions";

describe("#150 150-A 監査の操作の種類（案件の終了・再開）", () => {
  it.each(["case.close", "case.reopen"])(
    "#150 5-1 AC-13: %s が操作の一覧にある",
    (action) => {
      expect(AUDIT_ACTIONS as readonly string[]).toContain(action);
    },
  );

  it("#150 5-1 AC-13: 対象の種類に case がある", () => {
    expect(AUDIT_TARGET_TYPES as readonly string[]).toContain("case");
  });
});
