// #148（148-B-2）5-2 AC-9・計画 7章「同時の操作」：公開範囲の変更の判定（findVisibilityFacts）の「後」・書き込みの「前」に状態が変わったとき、
// 書き込みの条件で0行になり、読み直しで正しい応答を返すこと（行も監査も変わらない）。先例：services/case-attachment.interleave.test.ts。
// 挟み方：本物の Repository（隔離 D1）を Proxy で包み、最初の読み取り（findVisibilityFacts）が返った直後に割り込む。権限の判定は本物。
// 契約（実装前の仮置き）：createCaseAttachmentService(repository, roles).changeVisibility(actor, attachmentId, body)
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VISIBILITY_MESSAGES,
  changeVisibilityRequest,
  markMessageDeleted,
  publicationVisibilityOf,
  seedCaseAttachment,
  visibilityAudits,
} from "../../test/case-attachment-fixtures";
import { addCaseMember, removeCaseMember } from "../../test/case-fixtures";
import { casereqTraceId, removeOwner } from "../../test/case-request-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
  setCaseStatus,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import {
  withCaseAttachments,
  type CaseAttachmentRepository,
} from "../db/case-attachment.repository";
import { createCaseAttachmentService } from "./case-attachment.service";

let cw: CaseRoomWorld;
let attachmentId: string;
let messageId: string;

function interruptAfterFirst(
  repository: CaseAttachmentRepository,
  interrupt: () => Promise<void>,
  state: { done: boolean },
): CaseAttachmentRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        const result: unknown = await (
          value as (...a: unknown[]) => unknown
        ).apply(target, args);
        if (property === "findVisibilityFacts" && !state.done) {
          state.done = true;
          await interrupt();
        }
        return result;
      };
    },
  }) as CaseAttachmentRepository;
}

async function changeWith(
  actorId: string,
  after: string,
  interrupt: () => Promise<void>,
) {
  const state = { done: false };
  try {
    const value = await withCaseAttachments(env, (repository, roles) =>
      createCaseAttachmentService(
        interruptAfterFirst(repository, interrupt, state),
        roles,
      ).changeVisibility(
        { userId: actorId, traceId: casereqTraceId() },
        attachmentId,
        { publicationVisibility: after },
      ),
    );
    expect(state.done).toBe(true);
    return { ok: true as const, value };
  } catch (error) {
    expect(state.done).toBe(true);
    return { ok: false as const, error };
  }
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1650);
  messageId = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
  attachmentId = await seedCaseAttachment({
    n: 1,
    roomId: cw.open.roomId,
    uploaderId: cw.w.memberS1.id,
    messageId,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 AC-9 計画 7章 判定の後・書き込みの前の割り込み", () => {
  it("#148 AC-9 ①: 案件が終了すると 409（終了の文）。行・監査は変わらない", async () => {
    const result = await changeWith(cw.w.memberS1.id, "public_archive", () =>
      setCaseStatus(cw.open.id, "closed"),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", message: VISIBILITY_MESSAGES.closed },
    });
    expect(await publicationVisibilityOf(attachmentId)).toBe(
      "participants_only",
    );
    expect(await visibilityAudits()).toEqual([]);
  });

  it("#148 AC-9 ②: 参加から外されると 404（見えなくなった人に 403・409 を出さない）", async () => {
    const result = await changeWith(cw.w.memberS1.id, "public_archive", () =>
      removeCaseMember(cw.open.roomId, cw.w.memberS1.id),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: VISIBILITY_MESSAGES.notFound },
    });
    expect(await publicationVisibilityOf(attachmentId)).toBe(
      "participants_only",
    );
    expect(await visibilityAudits()).toEqual([]);
  });

  it("#148 AC-9 ③: 担当部署のオーナー（参加者・本人でない）がオーナーでなくなると 403", async () => {
    await addCaseMember(cw.open.roomId, cw.w.ownerS.id);
    const result = await changeWith(cw.w.ownerS.id, "public_archive", () =>
      removeOwner(cw.w.ownerS.id, cw.w.deptS.id),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", message: VISIBILITY_MESSAGES.forbidden },
    });
    expect(await publicationVisibilityOf(attachmentId)).toBe(
      "participants_only",
    );
    expect(await visibilityAudits()).toEqual([]);
  });

  it("#148 AC-9 ④: メッセージが削除されると 404", async () => {
    const result = await changeWith(cw.w.memberS1.id, "public_archive", () =>
      markMessageDeleted(messageId, cw.w.memberS1.id),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: VISIBILITY_MESSAGES.notFound },
    });
    expect(await visibilityAudits()).toEqual([]);
  });

  it("#148 AC-9 ⑤: ほかの人が同じ変更先に変えると 200。監査はほかの人の1件だけ", async () => {
    await addCaseMember(cw.open.roomId, cw.w.ownerS.id);
    const result = await changeWith(
      cw.w.memberS1.id,
      "public_archive",
      async () => {
        const res = await changeVisibilityRequest(
          attachmentId,
          { publicationVisibility: "public_archive" },
          cw.w.ownerS.token,
        );
        expect(res.status).toBe(200);
      },
    );
    expect(result).toEqual({
      ok: true,
      value: { id: attachmentId, publicationVisibility: "public_archive" },
    });
    expect(await publicationVisibilityOf(attachmentId)).toBe("public_archive");
    const audits = await visibilityAudits();
    expect(audits.map((a) => a.actor_id)).toEqual([cw.w.ownerS.id]);
  });

  it("#148 AC-9 ⑥（既知の差）: 古い読みで今の値を求めると、書かずに 200（応答は読んだ時点の値）。監査はほかの人の1件だけ", async () => {
    await addCaseMember(cw.open.roomId, cw.w.ownerS.id);
    const result = await changeWith(
      cw.w.memberS1.id,
      "participants_only",
      async () => {
        const res = await changeVisibilityRequest(
          attachmentId,
          { publicationVisibility: "public_archive" },
          cw.w.ownerS.token,
        );
        expect(res.status).toBe(200);
      },
    );
    expect(result).toEqual({
      ok: true,
      value: { id: attachmentId, publicationVisibility: "participants_only" },
    });
    expect(await publicationVisibilityOf(attachmentId)).toBe("public_archive");
    expect((await visibilityAudits()).map((a) => a.actor_id)).toEqual([
      cw.w.ownerS.id,
    ]);
  });
});
