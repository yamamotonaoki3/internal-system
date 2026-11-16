// #200 AC-2・AC-3（2-3 AC-1・AC-2、2-4 AC-1）: チャンネルの閲覧・参加の判定（純粋関数）の全組み合わせ。
// 前提（実装前。引き継ぎに明記）：
//   canViewChannel(channel: { visibility: "public" | "private"; deletedAt: string | null }, isMember: boolean): boolean
//   canJoinChannel(channel: { visibility: "public" | "private"; deletedAt: string | null }): boolean
// 見える：公開、または参加中の非公開で、アーカイブされていない（deletedAt が null）。参加できる：公開で、アーカイブされていない。
import { describe, expect, it } from "vitest";
import {
  COMPANY_GENERAL_CHANNEL_NAME,
  COMPANY_GENERAL_ROOM_ID,
  canInviteToChannel,
  canJoinChannel,
  canViewChannel,
} from "./channel-rules";

const ARCHIVED = "2026-11-09T00:00:00.000Z";

describe("#200 AC-3 canViewChannel（全組み合わせ）", () => {
  it.each([
    // [公開か, アーカイブか, 参加中か, 期待]
    ["public", null, false, true],
    ["public", null, true, true],
    ["private", null, true, true],
    ["private", null, false, false],
    ["public", ARCHIVED, false, false],
    ["public", ARCHIVED, true, false],
    ["private", ARCHIVED, true, false],
    ["private", ARCHIVED, false, false],
  ] as const)(
    "#200 AC-3: visibility=%s・deletedAt=%s・参加中=%s → %s",
    (visibility, deletedAt, isMember, expected) => {
      expect(canViewChannel({ visibility, deletedAt }, isMember)).toBe(
        expected,
      );
    },
  );
});

describe("#200 AC-2・AC-3 canJoinChannel（全組み合わせ）", () => {
  it.each([
    ["public", null, true],
    ["private", null, false],
    ["public", ARCHIVED, false],
    ["private", ARCHIVED, false],
  ] as const)(
    "#200 AC-3: visibility=%s・deletedAt=%s → %s",
    (visibility, deletedAt, expected) => {
      expect(canJoinChannel({ visibility, deletedAt })).toBe(expected);
    },
  );
});

describe("#200 AC-1 全社連絡の定数", () => {
  it("#200 AC-1: 名前は「全社連絡」、ルームIDは26文字の固定値", () => {
    expect(COMPANY_GENERAL_CHANNEL_NAME).toBe("全社連絡");
    expect(COMPANY_GENERAL_ROOM_ID).toHaveLength(26);
  });
});

// #135 AC-1（2-5 AC-1・AC-7）・#132 AC-2（2-4 AC-2・AC-3）: 招待の判定（閲覧可否 → 招待の権限 → チャンネルの状態）。計画 5節の手順3・4・6。
// 前提（実装前）：
//   canInviteToChannel(
//     channel: { visibility; deletedAt; purpose: ChannelPurpose; departmentIsActive: boolean },
//     inviterIsMember: boolean,
//   ): "allowed" | "not_found" | "not_member" | "case_channel" | "department_inactive"
//   先に当たった理由を返す（順：not_found → not_member → case_channel → department_inactive）。
//   再認証（手順5）は Service が not_member と case_channel の間で行うため、この関数は扱わない。
describe("#135 AC-1 canInviteToChannel（招待の判定の順）", () => {
  type Purpose =
    "normal" | "department" | "announcement" | "company_general" | "case";
  const base = {
    visibility: "private" as "public" | "private",
    deletedAt: null as string | null,
    purpose: "normal" as Purpose,
    departmentIsActive: true,
  };

  it.each([
    // [説明, チャンネル, 招待者が参加中か, 期待]
    ["#132 AC-2（2-4 AC-2）: 参加中の非公開は招待できる", {}, true, "allowed"],
    [
      "#135 AC-1（2-5 AC-1）: 参加中の公開も招待できる",
      { visibility: "public" },
      true,
      "allowed",
    ],
    [
      "#132 AC-2（2-4 AC-1）: 参加していない非公開は見えない（404）",
      {},
      false,
      "not_found",
    ],
    [
      "#132 AC-2（2-4 AC-1）: アーカイブ済みは参加中でも見えない（404）",
      { deletedAt: ARCHIVED },
      true,
      "not_found",
    ],
    [
      "#132 AC-2: アーカイブ済みの公開も見えない（404）",
      { visibility: "public", deletedAt: ARCHIVED },
      false,
      "not_found",
    ],
    [
      "#135 決定 Q3: 参加していない公開は招待の権限がない（403）",
      { visibility: "public" },
      false,
      "not_member",
    ],
    [
      "#135 AC-1（2-5 AC-7）: 案件専用は招待できない（409）",
      { purpose: "case" },
      true,
      "case_channel",
    ],
    [
      "#135 AC-1（読み取り専用）: 部署が無効は招待できない（409）",
      { departmentIsActive: false },
      true,
      "department_inactive",
    ],
    [
      "#135 AC-1（判定の順）: 参加していない非公開は、案件・部署が無効でも 404 を先に返す",
      { purpose: "case", departmentIsActive: false },
      false,
      "not_found",
    ],
    [
      "#135 AC-1（判定の順）: 参加していない公開は、案件・部署が無効でも 403 を先に返す",
      { visibility: "public", purpose: "case", departmentIsActive: false },
      false,
      "not_member",
    ],
    [
      "#135 AC-1（判定の順）: アーカイブ済みは、案件でも 404 を先に返す",
      { purpose: "case", deletedAt: ARCHIVED },
      true,
      "not_found",
    ],
    [
      "#135 AC-1（判定の順）: 案件で部署も無効なら、案件（case_channel）を先に返す",
      { purpose: "case", departmentIsActive: false },
      true,
      "case_channel",
    ],
    [
      "#135 AC-1: 会社直属・お知らせ専用・部署の専用チャンネルは状態の判定で止めない",
      { purpose: "company_general", visibility: "public" },
      true,
      "allowed",
    ],
    [
      "#135 AC-1: お知らせ専用も招待の判定では止めない",
      { purpose: "announcement", visibility: "public" },
      true,
      "allowed",
    ],
    [
      "#135 AC-1: 部署の専用チャンネルも止めない",
      { purpose: "department", visibility: "public" },
      true,
      "allowed",
    ],
  ] as const)("%s", (_label, overrides, isMember, expected) => {
    expect(canInviteToChannel({ ...base, ...overrides }, isMember)).toBe(
      expected,
    );
  });
});
