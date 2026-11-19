// #156（0-6 AC-6・AC-3）: 監査ログの操作の種類（AUDIT_ACTIONS）と、対象の種類（AUDIT_TARGET_TYPES）の一覧。
// 閲覧の記録の操作 audit_log.view が操作の一覧にあること（画面の絞り込みの候補・検索の action の検証がこの一覧を定義元にする）、
// 対象の種類の固定の一覧が、実際に書かれる種類（計画 #156）を過不足なく持つこと。
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "./audit-actions";

describe("#156 0-6 AC-6: 操作の種類の一覧", () => {
  it("#156 0-6 AC-6: 閲覧の記録の操作 audit_log.view を含み、重複がない", () => {
    expect(AUDIT_ACTIONS as readonly string[]).toContain("audit_log.view");
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it("#156 0-6 AC-3: すべての操作は「対象の種類.操作」の形（小文字の英数字と _ を . で区切る）", () => {
    for (const action of AUDIT_ACTIONS)
      expect(action, action).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
  });
});

describe("#156 0-6 AC-3: 対象の種類の一覧", () => {
  it("#156 0-6 AC-3: 実際に書かれる種類（社員・部署・取引先・チャンネル・チャンネル申請・案件の作成申請・退職処理の申請・メッセージ・接続元。計画の後に #146・#128-c が足した case_request・retirement_request と、#147（147-B）が足した case を含む）と、閲覧の記録の audit_log を、過不足なく持つ", () => {
    expect([...AUDIT_TARGET_TYPES].sort()).toEqual(
      [
        "user",
        "department",
        "client",
        "channel",
        "channel_request",
        "case_request",
        "case",
        "retirement_request",
        "message",
        // #148（148-B-2）：案件の添付の公開範囲の変更（case.attachment.visibility.change）の対象
        "attachment",
        "source",
        "audit_log",
      ].sort(),
    );
  });
});
