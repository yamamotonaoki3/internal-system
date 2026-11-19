// #148（148-B-2）5-2 AC-9・R-85・計画 6.4「書き込みの条件」：公開範囲の変更の Repository（case-attachment.repository.ts の changeVisibility）を、
// マイグレーション済みの隔離 D1 で直接呼んで確かめる（Service の判定を通さない）。
// この層で確かめるもの：書き込みの条件（計画 6.4 の突き合わせの表）を1つずつ崩すと、行も監査も変わらず AttachmentStateChangedError。
//   満たせば行が1つ変わり、監査が同じ batch で1件（action case.attachment.visibility.change・target_type attachment・
//   detail は平らで caseId・before・after だけ。ファイル名を入れない）。
//   相関：同じ案件・別の案件に、条件を満たす別の添付がある状態で、対象の添付だけ条件を崩しても0行（別の添付の行で条件が真にならない）。
//   生成された SQL：UPDATE の WHERE の EXISTS の内側にも、対象の添付の ID の条件がある。
// 契約（実装前の仮置き。実装の担当へ）：backend/src/db/case-attachment.repository.ts
//   repository.changeVisibility({ attachmentId, actorId, caseId, before, after, traceId }): Promise<void>（0行なら AttachmentStateChangedError を投げる）
//   export class AttachmentStateChangedError extends Error
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import {
  caseAttachmentIdAt,
  caseAttachmentName,
  markMessageDeleted,
  publicationVisibilityOf,
  seedCaseAttachment,
  setPublicationVisibility,
  visibilityAudits,
} from "../../test/case-attachment-fixtures";
import { addCaseMember, removeCaseMember } from "../../test/case-fixtures";
import { isFlat, parseDetail } from "../../test/case-participant-fixtures";
import {
  casereqTraceId,
  removeGlobalAdmin,
  removeOwner,
  setUserActive,
} from "../../test/case-request-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
  setCaseStatus,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import {
  AttachmentStateChangedError,
  createCaseAttachmentRepository,
  withCaseAttachments,
} from "./case-attachment.repository";

let cw: CaseRoomWorld;

type Change = {
  attachmentId: string;
  actorId: string;
  caseId?: string;
  before?: "participants_only" | "public_archive";
  after?: "participants_only" | "public_archive";
};

async function change(input: Change) {
  return withCaseAttachments(env, (r) =>
    r.changeVisibility({
      attachmentId: input.attachmentId,
      actorId: input.actorId,
      caseId: input.caseId ?? cw.open.id,
      before: input.before ?? "participants_only",
      after: input.after ?? "public_archive",
      traceId: casereqTraceId(),
    }),
  );
}

/** 0行（状態が変わった）として拒否され、行と監査が変わらないこと */
async function expectRejected(input: Change) {
  const before = await publicationVisibilityOf(input.attachmentId);
  const audits = await visibilityAudits();
  await expect(change(input)).rejects.toBeInstanceOf(
    AttachmentStateChangedError,
  );
  expect(await publicationVisibilityOf(input.attachmentId)).toBe(before);
  expect(await visibilityAudits()).toEqual(audits);
}

async function expectChanged(input: Change) {
  await change(input);
  expect(await publicationVisibilityOf(input.attachmentId)).toBe(
    input.after ?? "public_archive",
  );
}

/** 進行中の案件の部屋に、memberS1 が投稿した添付（n=1）を入れる */
async function seedTarget(n = 1, uploaderId = cw.w.memberS1.id) {
  const message = await seedRoomMessage(cw.open.roomId, uploaderId, n);
  const id = await seedCaseAttachment({
    n,
    roomId: cw.open.roomId,
    uploaderId,
    messageId: message,
  });
  return { id, message };
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1640);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 AC-9 書き込みの条件を満たせば、行が1つ変わり、監査が1件", () => {
  it("#148 AC-9 D4: 本人（一般・参加者）が変えると、行が変わり、監査は平らな detail（caseId・before・after）で1件。ファイル名を入れない", async () => {
    const { id } = await seedTarget();
    await expectChanged({ attachmentId: id, actorId: cw.w.memberS1.id });
    const audits = await visibilityAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: cw.w.memberS1.id,
      action: "case.attachment.visibility.change",
      target_type: "attachment",
      target_id: id,
      result: "success",
    });
    const detail = parseDetail(audits[0]?.detail ?? null);
    expect(isFlat(detail)).toBe(true);
    expect(detail).toEqual({
      caseId: cw.open.id,
      before: "participants_only",
      after: "public_archive",
    });
    expect(audits[0]?.detail ?? "").not.toContain(caseAttachmentName(1));
  });

  it("#148 AC-9: public_archive から participants_only へも変えられる", async () => {
    const { id } = await seedTarget();
    await setPublicationVisibility(id, "public_archive");
    await expectChanged({
      attachmentId: id,
      actorId: cw.w.memberS1.id,
      before: "public_archive",
      after: "participants_only",
    });
  });

  it("#148 AC-9 R-85: 担当部署のオーナー（参加者）は、ほかの人の添付を変えられる", async () => {
    const { id } = await seedTarget();
    await addCaseMember(cw.open.roomId, cw.w.ownerS.id);
    await expectChanged({ attachmentId: id, actorId: cw.w.ownerS.id });
  });

  it("#148 AC-9 R-85: 全体管理者（参加者）は、ほかの人の添付を変えられる", async () => {
    const { id } = await seedTarget();
    await addCaseMember(cw.open.roomId, cw.w.admin.id);
    await expectChanged({ attachmentId: id, actorId: cw.w.admin.id });
  });
});

describe("#148 AC-9 書き込みの条件を1つずつ崩すと0行（行も監査も変わらない）", () => {
  it("#148 AC-9 計画 6.4 の2: 未投稿の添付（本人のもの）", async () => {
    const id = await seedCaseAttachment({
      n: 2,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: null,
    });
    await expectRejected({ attachmentId: id, actorId: cw.w.memberS1.id });
  });

  it("#148 AC-9 計画 6.4 の1: メッセージが削除された添付", async () => {
    const { id, message } = await seedTarget();
    await markMessageDeleted(message, cw.w.memberS1.id);
    await expectRejected({ attachmentId: id, actorId: cw.w.memberS1.id });
  });

  it("#148 AC-9 計画 6.4 の3: 案件でない部屋（通常のチャンネル）の添付", async () => {
    const message = await seedRoomMessage(cw.normal, cw.w.memberS1.id, 3);
    const id = await seedCaseAttachment({
      n: 3,
      roomId: cw.normal,
      uploaderId: cw.w.memberS1.id,
      messageId: message,
    });
    await expectRejected({ attachmentId: id, actorId: cw.w.memberS1.id });
  });

  it("#148 AC-9 計画 6.4 の4: 本人でも、参加から外れていれば0行", async () => {
    const { id } = await seedTarget();
    await removeCaseMember(cw.open.roomId, cw.w.memberS1.id);
    await expectRejected({ attachmentId: id, actorId: cw.w.memberS1.id });
  });

  it("#148 AC-9 計画 6.4 の4: 本人でも、無効（参加の行は残る）なら0行", async () => {
    const { id } = await seedTarget();
    await setUserActive(cw.w.memberS1.id, false);
    await expectRejected({ attachmentId: id, actorId: cw.w.memberS1.id });
  });

  it("#148 AC-9 R-85 計画 6.4 の4・6: 参加していない担当部署のオーナー・全体管理者（管理の資格だけでは変えられない）", async () => {
    const { id } = await seedTarget();
    await expectRejected({ attachmentId: id, actorId: cw.w.ownerS.id });
    await expectRejected({ attachmentId: id, actorId: cw.w.admin.id });
  });

  it("#148 AC-9 R-85 計画 6.4 の6: 本人でも管理の資格もない参加者（一般）", async () => {
    const { id } = await seedTarget();
    await expectRejected({ attachmentId: id, actorId: cw.w.memberD1.id });
  });

  it("#148 AC-9 R-85 計画 6.4 の6: 担当部署でない部署のオーナー（参加者）は、ほかの人の添付を変えられない", async () => {
    const { id } = await seedTarget();
    await addCaseMember(cw.open.roomId, cw.w.ownerD.id);
    await expectRejected({ attachmentId: id, actorId: cw.w.ownerD.id });
  });

  it("#148 AC-9 R-85 計画 6.4 の6: 担当部署のオーナーを外された参加者・全体管理者を外された参加者", async () => {
    const { id } = await seedTarget();
    await addCaseMember(cw.open.roomId, cw.w.ownerS.id);
    await addCaseMember(cw.open.roomId, cw.w.admin.id);
    await removeOwner(cw.w.ownerS.id, cw.w.deptS.id);
    await removeGlobalAdmin(cw.w.admin.id);
    await expectRejected({ attachmentId: id, actorId: cw.w.ownerS.id });
    await expectRejected({ attachmentId: id, actorId: cw.w.admin.id });
  });

  it("#148 AC-9 計画 6.4 の8: 終了した案件の添付（本人でも）", async () => {
    const { id } = await seedTarget();
    await setCaseStatus(cw.open.id, "closed");
    await expectRejected({ attachmentId: id, actorId: cw.w.memberS1.id });
  });

  it("#148 AC-9 計画 6.4 の9: いまの値が、読んだ値（before）と違う", async () => {
    const { id } = await seedTarget();
    await setPublicationVisibility(id, "public_archive");
    await expectRejected({
      attachmentId: id,
      actorId: cw.w.memberS1.id,
      before: "participants_only",
      after: "public_archive",
    });
  });

  it("#148 AC-9: 存在しない添付", async () => {
    await expectRejected({
      attachmentId: caseAttachmentIdAt(999),
      actorId: cw.w.memberS1.id,
    });
  });
});

describe("#148 AC-9 計画 15章 相関：別の添付の行で条件が真にならない", () => {
  it("#148 AC-9: 同じ案件に、操作する人が変えられる別の添付があっても、対象の添付が他人のものなら0行", async () => {
    const target = await seedTarget(1, cw.w.memberS1.id);
    const own = await seedTarget(2, cw.w.memberD1.id);
    await expectRejected({
      attachmentId: target.id,
      actorId: cw.w.memberD1.id,
    });
    expect(await publicationVisibilityOf(own.id)).toBe("participants_only");
  });

  it("#148 AC-9: 同じ案件の別の添付が before の値を満たしても、対象の値が違えば0行", async () => {
    const target = await seedTarget(1);
    const sibling = await seedTarget(2);
    await setPublicationVisibility(target.id, "public_archive");
    await expectRejected({
      attachmentId: target.id,
      actorId: cw.w.memberS1.id,
      before: "participants_only",
    });
    expect(await publicationVisibilityOf(sibling.id)).toBe("participants_only");
  });

  it("#148 AC-9: 同じ案件の別の添付のメッセージが残っていても、対象のメッセージが削除されていれば0行", async () => {
    const target = await seedTarget(1);
    await seedTarget(2);
    await markMessageDeleted(target.message, cw.w.memberS1.id);
    await expectRejected({
      attachmentId: target.id,
      actorId: cw.w.memberS1.id,
    });
  });

  it("#148 AC-9: 別の案件（進行中）に操作する人の添付があっても、対象の案件に参加していなければ0行", async () => {
    const target = await seedTarget(1, cw.w.memberS1.id);
    const message = await seedRoomMessage(cw.other.roomId, cw.w.memberS2.id, 5);
    await seedCaseAttachment({
      n: 5,
      roomId: cw.other.roomId,
      uploaderId: cw.w.memberS2.id,
      messageId: message,
    });
    await expectRejected({
      attachmentId: target.id,
      actorId: cw.w.memberS2.id,
    });
  });

  it("#148 AC-9: 終了した案件の添付は、進行中の別の案件の添付があっても0行", async () => {
    const message = await seedRoomMessage(
      cw.closed.roomId,
      cw.w.memberS1.id,
      6,
    );
    const closedId = await seedCaseAttachment({
      n: 6,
      roomId: cw.closed.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: message,
    });
    await seedTarget(7);
    await expectRejected({
      attachmentId: closedId,
      actorId: cw.w.memberS1.id,
      caseId: cw.closed.id,
    });
  });
});

describe("#148 AC-9 計画 6.4 生成された SQL", () => {
  type Recorded = { sql: string; params: unknown[] };

  function recordingDb(statements: Recorded[]): D1Database {
    const wrap = (prepared: D1PreparedStatement, entry: Recorded) =>
      new Proxy(prepared, {
        get(stmt, key) {
          if (key === "bind")
            return (...values: unknown[]) => {
              entry.params = values;
              return wrap(stmt.bind(...values), entry);
            };
          const value: unknown = Reflect.get(stmt, key, stmt);
          return typeof value === "function" ? value.bind(stmt) : value;
        },
      });
    return new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare")
          return (query: string) => {
            const entry: Recorded = { sql: query, params: [] };
            statements.push(entry);
            return wrap(target.prepare(query), entry);
          };
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  it("#148 AC-9: UPDATE と監査の INSERT の両方が EXISTS の条件を持ち、それぞれ対象の添付の ID を外側と内側（または内側）に持つ", async () => {
    const { id } = await seedTarget();
    const statements: Recorded[] = [];
    const repository = createCaseAttachmentRepository(
      drizzle(recordingDb(statements), { schema }),
    );
    await repository.changeVisibility({
      attachmentId: id,
      actorId: cw.w.memberS1.id,
      caseId: cw.open.id,
      before: "participants_only",
      after: "public_archive",
      traceId: casereqTraceId(),
    });
    const update = statements.find((s) =>
      /^\s*update\s+["`]?message_attachments/i.test(s.sql),
    );
    const audit = statements.find((s) =>
      /insert\s+into\s+["`]?audit_logs/i.test(s.sql),
    );
    expect(update, JSON.stringify(statements.map((s) => s.sql))).toBeDefined();
    expect(audit).toBeDefined();
    for (const statement of [update, audit]) {
      expect(statement?.sql).toMatch(/exists\s*\(/i);
      expect(statement?.sql).toMatch(/message_id\s+is\s+not\s+null/i);
    }
    // UPDATE：外側（WHERE id = ?）と、EXISTS の内側の対象の ID の条件の2つ
    expect(
      (update?.params ?? []).filter((value) => value === id).length,
    ).toBeGreaterThanOrEqual(2);
    // 監査：target_id と、EXISTS の内側の対象の ID の条件
    expect(
      (audit?.params ?? []).filter((value) => value === id).length,
    ).toBeGreaterThanOrEqual(2);
    // 監査が UPDATE より先（同じ「更新前」の時点の条件を見る）
    expect(statements.indexOf(audit as Recorded)).toBeLessThan(
      statements.indexOf(update as Recorded),
    );
  });
});
