// #143-a a-AC-1〜a-AC-3（2-6 AC-5③・AC-6、0-6）: チャンネルの名前・説明の変更、アーカイブ、復元の監査の操作の種類が、
// 監査ログの操作の一覧（AUDIT_ACTIONS。画面の絞り込みの候補の定義元）にあること。
// 期待値は計画 #143-a の API の節（channel.update・channel.archive・channel.restore）から決める。
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "./audit-actions";

describe("#143 a-AC-1〜a-AC-3 監査の操作の種類", () => {
  it.each(["channel.update", "channel.archive", "channel.restore"])(
    "#143 a-AC-1〜a-AC-3: %s が操作の一覧にある",
    (action) => {
      expect(AUDIT_ACTIONS as readonly string[]).toContain(action);
    },
  );

  it("#143 a-AC-1〜a-AC-3: 対象の種類は既存の channel を使う（種類を増やさない）", () => {
    expect(AUDIT_TARGET_TYPES as readonly string[]).toContain("channel");
  });
});
