// #147（147-B）5-1 AC-3・AC-17、0-6：参加者の追加・削除と納期の変更の監査の操作の種類が、監査ログの操作の一覧（AUDIT_ACTIONS。
// 画面の絞り込みの候補の定義元）にあること。期待値は計画 147-B の「batch の中身」（case.participant.add・case.participant.remove・
// case.due_date.change）から決める。対象（target_type）は案件（case）。
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "./audit-actions";

describe("#147 147-B 監査の操作の種類", () => {
  it.each([
    "case.participant.add",
    "case.participant.remove",
    "case.due_date.change",
  ])("#147 5-1 AC-3・AC-17: %s が操作の一覧にある", (action) => {
    expect(AUDIT_ACTIONS as readonly string[]).toContain(action);
  });

  it("#147 5-1 AC-3・AC-17: 対象の種類に case がある", () => {
    expect(AUDIT_TARGET_TYPES as readonly string[]).toContain("case");
  });
});
