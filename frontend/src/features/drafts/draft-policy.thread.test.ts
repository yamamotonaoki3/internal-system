// #137 AC-1（1-4 AC-3・1-1 AC-4）: スレッドの返信の入力欄の下書きの scope（threadDraftScope）。
// 契約（実装前の仮置き。計画 plan-137 の「9. 画面」・改訂1の重大2）：
//   features/drafts/draft-policy.ts が threadDraftScope(roomId, parentMessageId) を公開し、index.ts からも公開する。
//   形は `thread:<roomId>:<親ID>`（#239 で予約済み）。部屋の入力欄の scope（`room:<roomId>`）とは決して重ならない。
//   期待値は本番の定義から作らず、形を独立に書く。データは架空。
import { describe, expect, it } from "vitest";
import { draftKey, roomDraftScope } from "./draft-policy";
import { threadDraftScope } from "./index";

const ROOM = "01JTESTROOM00000000000D001";
const PARENT_A = "01JTESTMSG0000000000000001";
const PARENT_B = "01JTESTMSG0000000000000002";

describe("#137 AC-1（1-4 AC-3）threadDraftScope", () => {
  it("#137 AC-1: scope は thread:<roomId>:<親ID> の形", () => {
    expect(threadDraftScope(ROOM, PARENT_A)).toBe(`thread:${ROOM}:${PARENT_A}`);
  });

  it("#137 AC-1: 同じ部屋でも、親が違えば別の scope（スレッドごとに下書きを分ける）", () => {
    expect(threadDraftScope(ROOM, PARENT_A)).not.toBe(
      threadDraftScope(ROOM, PARENT_B),
    );
  });

  it("#137 AC-1: 親が同じでも、部屋が違えば別の scope", () => {
    expect(threadDraftScope(ROOM, PARENT_A)).not.toBe(
      threadDraftScope("01JTESTROOM00000000000D002", PARENT_A),
    );
  });

  it("#137 AC-1: 部屋の入力欄の scope とは重ならず、端末のキーは利用者ごとに thread: が付く", () => {
    expect(threadDraftScope(ROOM, PARENT_A)).not.toBe(roomDraftScope(ROOM));
    expect(
      draftKey("01JTESTUSER00000000000DA01", threadDraftScope(ROOM, PARENT_A)),
    ).toBe(
      `internal-system:draft:v1:01JTESTUSER00000000000DA01:thread:${ROOM}:${PARENT_A}`,
    );
  });
});
