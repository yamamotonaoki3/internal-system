// #150（150-C）5-1 AC-20・C-122(5)：案件の再編集の監査の操作の種類が、監査ログの操作の一覧（AUDIT_ACTIONS。画面の絞り込みの候補の定義元）にあること。
// 期待値は計画 150-C 4.4（case.edit。対象の種類は case）から決める。
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "./audit-actions";

describe("#150 150-C 監査の操作の種類（案件の再編集）", () => {
  it("#150 C-122(5): case.edit が操作の一覧にある", () => {
    expect(AUDIT_ACTIONS as readonly string[]).toContain("case.edit");
  });

  it("#150 C-122(5): 対象の種類に case がある", () => {
    expect(AUDIT_TARGET_TYPES as readonly string[]).toContain("case");
  });
});
