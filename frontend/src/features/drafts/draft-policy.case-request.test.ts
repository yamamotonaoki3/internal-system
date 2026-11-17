// #146（146-A）screens S-18「下書き」・C-120：案件の作成の申請の説明欄の下書きの scope（draft-policy.ts の caseRequestDraftScope）。
// ほかの scope（部屋・スレッド）と重ならず、公開の入口（index.ts）から使えること。値そのものは決めない。
import { describe, expect, it } from "vitest";
import {
  caseRequestDraftScope,
  roomDraftScope,
  threadDraftScope,
} from "./index";

describe("#146 S-18 案件の作成の申請の下書きの scope", () => {
  it("#146 C-120: いつも同じ値を返し、空でない", () => {
    expect(caseRequestDraftScope()).toBe(caseRequestDraftScope());
    expect(caseRequestDraftScope().length).toBeGreaterThan(0);
  });

  it("#146 C-120: 部屋・スレッドの scope と重ならない（同じ形の ID を渡しても）", () => {
    const scope = caseRequestDraftScope();
    for (const id of ["new", "case-request", "01JTESTCASEREQROOM0000001"]) {
      expect(scope).not.toBe(roomDraftScope(id));
      expect(scope).not.toBe(threadDraftScope(id, id));
      expect(roomDraftScope(id).startsWith(`${scope}:`)).toBe(false);
    }
    expect(scope.startsWith("room:")).toBe(false);
    expect(scope.startsWith("thread:")).toBe(false);
  });
});
