// #137 AC-1・AC-2（1-4 AC-1・AC-2・計画 決めたこと5）: 返信できない理由（replyBlockedReason）の値の定義元（shared/message-rules.ts の REPLY_BLOCKED_REASONS）を、
// 実装とは独立した期待値で固定する。サーバー（EP-1-07 の応答）と画面（入力欄の案内）が同じ値を参照する定義元で、値は計画に決めた4つだけ。
// 契約（実装者へ）：REPLY_BLOCKED_REASONS は、4つの理由の値（文字列）を持つ定数（配列でも、値が理由の文字列のオブジェクトでもよい。Object.values で値が取れること）。
import { describe, expect, it } from "vitest";
import { REPLY_BLOCKED_REASONS } from "../../../shared/message-rules";

describe("#137 AC-1・AC-2 返信できない理由の値（shared/message-rules.ts）", () => {
  it("#137 AC-1・AC-2: 理由は deleted_parent・not_joined・read_only・partner_inactive の4つだけ", () => {
    expect([...Object.values(REPLY_BLOCKED_REASONS)].sort()).toEqual([
      "deleted_parent",
      "not_joined",
      "partner_inactive",
      "read_only",
    ]);
  });

  it("#137 AC-1・AC-2: 値に重複がない", () => {
    const values = Object.values(REPLY_BLOCKED_REASONS);
    expect(new Set(values).size).toBe(values.length);
  });
});
