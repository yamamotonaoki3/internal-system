// #150（150-C）5-1 AC-20・C-122(5)：監査ログの画面で、案件の再編集の操作に日本語の名前が出ること。
// 文言は計画 150-C 5章（action-labels.ts：「案件の編集」）から決める。
import { describe, expect, it } from "vitest";
import { ACTION_LABELS, actionLabel } from "./action-labels";

describe("#150 150-C 監査の表示名", () => {
  it("#150 C-122(5): 操作 case.edit は「案件の編集」", () => {
    expect(ACTION_LABELS.has("case.edit")).toBe(true);
    expect(actionLabel("case.edit")).toBe("案件の編集");
  });
});
