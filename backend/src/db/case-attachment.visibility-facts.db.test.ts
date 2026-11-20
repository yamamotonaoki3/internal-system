// #324（#148 148-B-2 のミューテーションの生き残り）：公開範囲の変更の判定の材料（case-attachment.repository.ts の findVisibilityFacts）の
// 有効な参加者か（actorIsParticipant）を、隔離 D1 で確かめる。既存のテストは、Service の層では材料を代役にし、DB の層では書き込み（changeVisibility）だけを見ていた。
// 案件の部屋は非公開で、参加していない人には添付が見えない（null）。そのため「見えるが参加していない」は、公開の通常のチャンネルで作る。
// 期待値：actorIsParticipant は「その部屋に参加の行があり、有効な社員」か（設計書 docs/design/cases.md・attachments.md、5-2 AC-9 の判定の順の4）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedCaseAttachment } from "../../test/case-attachment-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { withCaseAttachments } from "./case-attachment.repository";

let cw: CaseRoomWorld;

async function seedIn(roomId: string, n: number) {
  const message = await seedRoomMessage(roomId, cw.w.memberS1.id, n);
  return seedCaseAttachment({
    n,
    roomId,
    uploaderId: cw.w.memberS1.id,
    messageId: message,
  });
}

const factsFor = (attachmentId: string, actorId: string) =>
  withCaseAttachments(env, (r) =>
    r.findVisibilityFacts({ attachmentId, actorId }),
  );

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(3242);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#324 #148 148-B-2 findVisibilityFacts の有効な参加者か（actorIsParticipant）", () => {
  it("#324 #148 AC-9: 公開の通常のチャンネルの添付は、参加していない人（memberS2）にも見えるが actorIsParticipant は偽、参加している人（memberD1）は真", async () => {
    const id = await seedIn(cw.normal, 1);
    const outsider = await factsFor(id, cw.w.memberS2.id);
    expect(outsider).not.toBeNull();
    expect(outsider?.actorIsParticipant).toBe(false);
    expect(outsider?.caseId).toBeNull();
    const member = await factsFor(id, cw.w.memberD1.id);
    expect(member).not.toBeNull();
    expect(member?.actorIsParticipant).toBe(true);
  });

  it("#324 #148 AC-9: 案件の部屋の添付は、参加者（memberD1）なら actorIsParticipant が真で、案件の ID・状態を返す。参加していない人（memberS2）には見えない（null）", async () => {
    const id = await seedIn(cw.open.roomId, 2);
    expect(await factsFor(id, cw.w.memberD1.id)).toMatchObject({
      actorIsParticipant: true,
      caseId: cw.open.id,
      caseStatus: "active",
    });
    expect(await factsFor(id, cw.w.memberS2.id)).toBeNull();
  });
});
