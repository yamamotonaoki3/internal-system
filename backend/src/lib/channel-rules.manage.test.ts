// #143-a a-AC-1・a-AC-2・a-AC-3・a-AC-4（2-6 AC-4・AC-5②・AC-6・AC-7、決定 D-2）: チャンネルの種類と状態から、
// 「種類として」できる管理の操作を返す純粋な関数 channelManageActions（lib/channel-rules.ts）。権限（オーナー・全体管理者）は別に判定する。
// 期待値は計画 #143「1. 誰が何をできるか」の表から決める（実装の都合ではなく、要件の表のとおり）：
//   通常（normal）       ：未アーカイブ → 名前・説明・アーカイブ、アーカイブ済み → 復元だけ（アーカイブ済みは名前・説明も変えない。EP-2-36 の 404）
//   部署の専用・お知らせ専用・全社連絡：説明だけ（名前の変更・アーカイブはできない。復元の対象もない）
//   案件専用（case）    ：どれもできない（案件と連動する。#151）
// 契約（実装前。報告に明記）：
//   channelManageActions(channel: { purpose: ChannelPurpose; deletedAt: string | null })
//     : { rename: boolean; editDescription: boolean; archive: boolean; restore: boolean }
import { describe, expect, it } from "vitest";
import { channelManageActions } from "./channel-rules";

const ARCHIVED_AT = "2026-11-15T00:00:00.000Z";
const NONE = {
  rename: false,
  editDescription: false,
  archive: false,
  restore: false,
} as const;

describe("#143 a-AC-1〜a-AC-4 種類×状態ごとの、管理の操作（計画 1章の表）", () => {
  it.each([
    [
      "通常・未アーカイブ",
      "normal",
      null,
      { rename: true, editDescription: true, archive: true, restore: false },
    ],
    [
      "通常・アーカイブ済み",
      "normal",
      ARCHIVED_AT,
      { rename: false, editDescription: false, archive: false, restore: true },
    ],
    [
      "部署の専用・未アーカイブ",
      "department",
      null,
      { rename: false, editDescription: true, archive: false, restore: false },
    ],
    [
      "お知らせ専用・未アーカイブ",
      "announcement",
      null,
      { rename: false, editDescription: true, archive: false, restore: false },
    ],
    [
      "全社連絡・未アーカイブ",
      "company_general",
      null,
      { rename: false, editDescription: true, archive: false, restore: false },
    ],
    ["案件専用・未アーカイブ", "case", null, NONE],
    ["案件専用・アーカイブ済み", "case", ARCHIVED_AT, NONE],
    // アーカイブできない種類がアーカイブ済みの行になっていても（データの異常）、復元・編集は認めない
    ["部署の専用・アーカイブ済み（異常な行）", "department", ARCHIVED_AT, NONE],
    [
      "お知らせ専用・アーカイブ済み（異常な行）",
      "announcement",
      ARCHIVED_AT,
      NONE,
    ],
    [
      "全社連絡・アーカイブ済み（異常な行）",
      "company_general",
      ARCHIVED_AT,
      NONE,
    ],
  ] as const)(
    "#143 a-AC-1〜a-AC-4: %s → 計画の表のとおり",
    (_label, purpose, deletedAt, expected) => {
      expect(channelManageActions({ purpose, deletedAt })).toEqual(expected);
    },
  );

  it("#143 a-AC-4（2-6 AC-5②・AC-7、D-2）: 名前を変えられるのは通常のチャンネルだけ（ほかの4種類はどの状態でも偽）", () => {
    const purposes = [
      "department",
      "announcement",
      "company_general",
      "case",
    ] as const;
    const states = [null, ARCHIVED_AT];
    const checked = purposes.flatMap((purpose) =>
      states.map(
        (deletedAt) => channelManageActions({ purpose, deletedAt }).rename,
      ),
    );
    expect(checked).toHaveLength(8);
    expect(checked.every((value) => value === false)).toBe(true);
  });
});
