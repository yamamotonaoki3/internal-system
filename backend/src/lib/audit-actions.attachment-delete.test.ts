// #270（270-A）AC-7・計画 4.3：添付の削除の監査の操作が、監査の検索の一覧（定義元）に登録されていること。
// 未登録だと、監査の検索で「この操作で絞り込む」が 422 になる。対象の種類 attachment は #148 で登録済み（回帰の固定）。
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "./audit-actions";

describe("#270 AC-7 監査の操作と対象の種類の登録", () => {
  it("#270 AC-7: 操作 attachment.delete がある", () => {
    expect(AUDIT_ACTIONS as readonly string[]).toContain("attachment.delete");
  });

  it("#270 AC-7: 対象の種類 attachment がある（回帰の固定）", () => {
    expect(AUDIT_TARGET_TYPES as readonly string[]).toContain("attachment");
  });
});
