// #147（147-C-2）0-1 AC-9・5-1 AC-7（C-142(1)）・AC-15（決定 Q1）・Q4：無効化・再有効化と、案件の参加の記録。
// 無効化の Repository（本物の batch。隔離 D1）で、次を確かめる（期待は計画 147-C-2 と決定記録 C-142(1)・C-182 Q1・Q4）。
//   - 無効化しても、案件専用チャンネル（purpose=case）の参加の行は残る（進行中・終了とも）。通常・部署の専用・全社連絡の行は消える
//   - 行が残っても、147-C-1 の「有効な参加者」の判定で、無効な人は書き込めず、中身を見られず、有効な参加者に数えられない
//   - AC-15：対象が「進行中の案件の唯一の有効な参加者」なら、batch 全体が取り消される（状態・参加・ロール・セッション・監査が変わらない）。
//     終了した案件だけなら、またはほかに有効な参加者（自動参加の全体管理者を含む）がいれば、無効化できる
//   - 再有効化（Q4）：残っていた案件の参加の行は外れ、全社連絡と部署の専用チャンネル2つに入る
// 契約（実装前の仮置き。計画 147-C-2）：
//   repository.deactivate({ targetId, actorId, now, traceId })：唯一の有効な参加者の進行中の案件があれば、batch の先頭の前提が崩れ
//   AccountStateChangedError を投げ、何も残さない。監査 account.deactivate の detail は変えない。
// 判定の順と応答（409 case_handover_required）は、結合テスト（routes/accounts.case-handover.test.ts）で確かめる。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。全体管理者は w.admin の1人だけ。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertSession } from "../../test/auth-fixtures";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import { participantIdsOf } from "../../test/case-participant-fixtures";
import {
  activeParticipantIdsOf,
  roomIdOf,
} from "../../test/case-reopen-fixtures";
import {
  casereqTraceId,
  setUserActive,
  setupCaseWorld,
  TEST_TAG,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { companyGeneralRoomId } from "../../test/company-general-fixtures";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { createUlidFactory } from "../lib/ulid";
import { AccountStateChangedError, withAccounts } from "./account.repository";
import { CaseStateChangedError, withCases } from "./case.repository";
import { withChannels } from "./channel.repository";
import { withMessages } from "./message.repository";

const NOW_1 = "2026-11-17T05:00:00.000Z";
const NOW_2 = "2026-11-17T06:00:00.000Z";
// ハッシュの形だけを持つダミー（本物の認証情報ではない）
const NEW_HASH =
  "$scrypt$ln=16,r=8,p=2$bmV3c2FsdDFuZXdzYWx0MQ$bmV3aGFzaDFuZXdoYXNoMW5ld2hhc2gx";

function fixedIdAt(ms: number): string {
  return createUlidFactory({
    now: () => ms,
    random: (length) => new Uint8Array(length),
  })();
}

let w: CaseWorld;
/** 対象（無効化する社員）。一般のメンバーで、ロールなし */
let target: string;
let generalRoomId: string;
let normalRoomId: string;
let caseSeq = 0;

const deactivate = (targetId = target, now = NOW_1) =>
  withAccounts(env, (r) =>
    r.deactivate({
      targetId,
      actorId: w.admin.id,
      now,
      traceId: casereqTraceId(),
    }),
  );

const reactivate = (targetId = target) =>
  withAccounts(env, (r) =>
    r.reactivate({
      targetId,
      departmentId: w.deptD.id,
      passwordHash: NEW_HASH,
      actorId: w.admin.id,
      now: NOW_2,
      traceId: casereqTraceId(),
    }),
  );

/** 案件を1件入れる（n は 81 から順に振る。案件番号・ID が重ならない） */
async function caseWith(
  memberIds: string[],
  options: { status?: "active" | "closed"; departmentIds?: string[] } = {},
): Promise<SeededCase> {
  caseSeq += 1;
  return seedCase({
    n: 80 + caseSeq,
    clientId: w.clientA.id,
    code: "QZA",
    title: `[UNIT_TEST]147C2無効化${caseSeq}`,
    createdBy: memberIds[0] ?? w.memberS1.id,
    departmentIds: options.departmentIds ?? [w.deptD.id],
    status: options.status ?? "active",
    members: memberIds.map((userId, i) => ({ userId, joinedAt: joinedAt(i) })),
  });
}

async function channelsOf(userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT channel_id FROM channel_members WHERE user_id = ? ORDER BY channel_id",
  )
    .bind(userId)
    .all<{ channel_id: string }>();
  return results.map((r) => r.channel_id);
}

/** 失敗の後に、操作の前と完全に同じであることを確かめるための状態 */
async function snapshot() {
  const all = async (query: string) =>
    (await env.DB.prepare(query).all<Record<string, unknown>>()).results;
  return {
    users: await all(
      "SELECT id, login_id, is_active, deactivated_at, department_id FROM users ORDER BY id",
    ),
    members: await all(
      "SELECT channel_id, user_id, joined_at FROM channel_members ORDER BY channel_id, user_id",
    ),
    assignments: await all(
      "SELECT user_id, role_id, department_id FROM user_role_assignments ORDER BY user_id, role_id, department_id",
    ),
    sessions: await all("SELECT id, revoked_at FROM sessions ORDER BY id"),
    audits: await all(
      "SELECT action, target_id, detail FROM audit_logs WHERE action LIKE 'account.%' ORDER BY id",
    ),
  };
}

async function expectDeactivationRejected() {
  const before = await snapshot();
  await expect(deactivate()).rejects.toBeInstanceOf(AccountStateChangedError);
  expect(await snapshot()).toEqual(before);
}

async function isActive(userId: string) {
  const row = await env.DB.prepare("SELECT is_active FROM users WHERE id = ?")
    .bind(userId)
    .first<{ is_active: number }>();
  return row?.is_active;
}

beforeEach(async () => {
  caseSeq = 0;
  w = await setupCaseWorld();
  target = w.memberS2.id;
  const general = await companyGeneralRoomId();
  if (general === null) throw new Error("全社連絡がありません");
  generalRoomId = general;
  normalRoomId = await insertChannel({
    name: `${TEST_TAG}147C2個別`,
    purpose: "normal",
    departmentId: w.deptS.id,
  });
  await insertMember(generalRoomId, target);
  await insertMember(normalRoomId, target);
});

afterEach(async () => {
  await cleanupCaseTestData();
});

describe("#147 147-C-2 C-142(1): 無効化しても、案件の参加の記録は残る", () => {
  it("#147 C-142(1): 進行中・終了の案件の参加の行は残り、全社連絡・部署の専用2つ・通常のチャンネルの行は消える", async () => {
    const active = await caseWith([w.memberS1.id, target, w.memberD1.id]);
    const closed = await caseWith([w.memberS1.id, target], {
      status: "closed",
    });
    // 対象でない案件（対象が参加していない）
    const other = await caseWith([w.memberS1.id, w.memberD1.id]);

    await deactivate();

    expect(await channelsOf(target)).toEqual(
      [active.roomId, closed.roomId].sort(),
    );
    expect(await participantIdsOf(active.roomId)).toEqual(
      [w.memberS1.id, target, w.memberD1.id].sort(),
    );
    expect(await participantIdsOf(other.roomId)).toEqual(
      [w.memberS1.id, w.memberD1.id].sort(),
    );
    // ほかの社員の部署・全社連絡の参加は変わらない
    expect(await channelsOf(w.memberS1.id)).toEqual(
      expect.arrayContaining([
        w.deptS.dedicatedChannelId,
        w.deptS.announcementChannelId,
      ]),
    );
  });

  it("#147 C-142(1): 参加の時刻（joined_at）も変わらない", async () => {
    const active = await caseWith([w.memberS1.id, target]);
    const before = await env.DB.prepare(
      "SELECT joined_at FROM channel_members WHERE channel_id = ? AND user_id = ?",
    )
      .bind(active.roomId, target)
      .first<{ joined_at: string }>();
    await deactivate();
    const after = await env.DB.prepare(
      "SELECT joined_at FROM channel_members WHERE channel_id = ? AND user_id = ?",
    )
      .bind(active.roomId, target)
      .first<{ joined_at: string }>();
    expect(after).toEqual(before);
  });

  it("#147 0-1 AC-9: 監査 account.deactivate は1件で、detail は今までと同じ形（案件の項目を足さない）", async () => {
    await caseWith([w.memberS1.id, target]);
    await deactivate();
    const { results } = await env.DB.prepare(
      "SELECT actor_id, target_id, result, detail FROM audit_logs WHERE action = 'account.deactivate' AND target_id = ?",
    )
      .bind(target)
      .all<{
        actor_id: string;
        target_id: string;
        result: string;
        detail: string;
      }>();
    expect(results).toHaveLength(1);
    expect(results[0]?.actor_id).toBe(w.admin.id);
    expect(results[0]?.result).toBe("success");
    expect(JSON.parse(results[0]?.detail ?? "null")).toEqual({
      fromDepartmentId: w.deptS.id,
      retirementRequestId: null,
      cancelledCaseRequestCount: 0,
    });
  });

  it("#147 C-142(1)・D1 の上限: 101件の進行中の案件に参加していても、無効化は1回で通り、101件の行がすべて残る", async () => {
    const seeded: string[] = [];
    for (let i = 0; i < 101; i += 1) {
      const c = await caseWith([w.memberS1.id, target]);
      seeded.push(c.roomId);
    }
    await deactivate();
    expect(await channelsOf(target)).toEqual(seeded.sort());
  });
});

describe("#147 147-C-2 C-142(1) と 147-C-1: 残した参加の行では、無効な人は書き込めず、見られず、数えられない", () => {
  const ROOT_ID = fixedIdAt(1_861_000_001_000);
  const NEW_MESSAGE_ID = fixedIdAt(1_861_000_010_000);
  const NEW_REPLY_ID = fixedIdAt(1_861_000_011_000);
  let room: SeededCase;

  beforeEach(async () => {
    room = await caseWith([w.memberS1.id, target, w.memberD1.id]);
    await env.DB.prepare(
      `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, parent_message_id)
       VALUES (?, ?, ?, 'テスト太郎', '[UNIT_TEST]元の投稿', ?, NULL)`,
    )
      .bind(ROOT_ID, room.roomId, w.memberS1.id, NOW_1)
      .run();
    await deactivate();
  });

  async function roomSnapshot() {
    const one = async (query: string) =>
      (await env.DB.prepare(query).bind(room.roomId).first<{ v: number }>())?.v;
    return {
      messages: await one(
        "SELECT COUNT(*) AS v FROM messages WHERE room_id = ?",
      ),
      reactions: await one(
        "SELECT COUNT(*) AS v FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE room_id = ?)",
      ),
      mentions: await one(
        "SELECT COUNT(*) AS v FROM message_mentions WHERE message_id IN (SELECT id FROM messages WHERE room_id = ?)",
      ),
      notifications: await one(
        "SELECT COUNT(*) AS v FROM notifications WHERE room_id = ?",
      ),
    };
  }

  it("#147 C-142(1): 本物の無効化の後、その社員の名前での投稿・返信・リアクションは0行で、何も残らない", async () => {
    const before = await roomSnapshot();
    const posted = await withMessages(env, (r) =>
      r.insertIfOrdered({
        id: NEW_MESSAGE_ID,
        roomId: room.roomId,
        senderId: target,
        senderDisplayName: "テスト太郎",
        body: "@テスト太郎 [UNIT_TEST]無効な人の投稿",
        mentions: [{ userId: w.memberS1.id, start: 0, end: 6 }],
        attachmentIds: [],
      }),
    );
    const replied = await withMessages(env, (r) =>
      r.insertReplyIfOrdered({
        id: NEW_REPLY_ID,
        roomId: room.roomId,
        parentMessageId: ROOT_ID,
        senderId: target,
        senderDisplayName: "テスト太郎",
        body: "@テスト太郎 [UNIT_TEST]無効な人の返信",
        createdAt: NOW_2,
        mentions: [{ userId: w.memberS1.id, start: 0, end: 6 }],
        attachmentIds: [],
      }),
    );
    const reacted = await withMessages(env, (r) =>
      r.addReactionIfReactable({
        messageId: ROOT_ID,
        userId: target,
        kind: "emoji",
        value: "👍",
      }),
    );
    expect(posted).toBe(0);
    expect(replied).toBe(0);
    expect(reacted.changes).toBe(0);
    expect(await roomSnapshot()).toEqual(before);
  });

  it("#147 C-142(1): 無効な人には、チャンネルの参加が NULL、案件の詳細は not_visible、参加中の一覧に出ない", async () => {
    const channel = await withChannels(env, (r) =>
      r.findForViewer(room.roomId, target),
    );
    expect(channel?.joinedAt).toBeNull();
    const detail = await withCases(env, (r) =>
      r.findDetailExtras({ caseId: room.id, actorId: target }),
    );
    expect(detail).toBe("not_visible");
    const joined = await withCases(env, (r) =>
      r.list({
        actorId: target,
        scope: "joined",
        status: "active",
        limit: 20,
      }),
    );
    expect(joined.items.map((c) => c.id)).not.toContain(room.id);
  });

  it("#147 C-142(1)・Q1: 有効な参加者の詳細では、無効な人は一覧に残る（退職者）が、外すと有効な参加者が0人になる人は外せない", async () => {
    const detail = await withCases(env, (r) =>
      r.findDetailExtras({ caseId: room.id, actorId: w.memberS1.id }),
    );
    if (typeof detail === "string") throw new Error(detail);
    expect(detail.participants.find((p) => p.userId === target)?.isActive).toBe(
      false,
    );
    // memberD1 を外すと、有効な参加者は memberS1 だけになる（無効な target は数えない）
    await withCases(env, (r) =>
      r.removeParticipant({
        caseId: room.id,
        actorId: w.memberS1.id,
        userId: w.memberD1.id,
        traceId: casereqTraceId(),
      }),
    );
    await expect(
      withCases(env, (r) =>
        r.removeParticipant({
          caseId: room.id,
          actorId: w.memberS1.id,
          userId: w.memberS1.id,
          traceId: casereqTraceId(),
        }),
      ),
    ).rejects.toBeInstanceOf(CaseStateChangedError);
    expect(await participantIdsOf(room.roomId)).toEqual(
      [w.memberS1.id, target].sort(),
    );
  });
});

describe("#147 147-C-2 AC-15（Q1）: 判定の事実 findAccountState の isSoleActiveCaseParticipant", () => {
  const read = (id: string) => withAccounts(env, (r) => r.findAccountState(id));

  it("#147 AC-15: 唯一の有効な参加者の進行中の案件があれば true、ほかに有効な参加者がいる・終了だけ・不参加なら false（常に真偽値）", async () => {
    await caseWith([target, w.inactive.id]);
    await caseWith([w.memberS1.id, w.memberD1.id]);
    await caseWith([w.memberD1.id], { status: "closed" });
    expect(await read(target)).toMatchObject({
      isSoleActiveCaseParticipant: true,
    });
    expect(await read(w.memberS1.id)).toMatchObject({
      isSoleActiveCaseParticipant: false,
    });
    expect(await read(w.memberD1.id)).toMatchObject({
      isSoleActiveCaseParticipant: false,
    });
    expect(await read(w.ownerH.id)).toMatchObject({
      isSoleActiveCaseParticipant: false,
    });
  });
});

describe("#147 147-C-2 AC-15（Q1）: 進行中の案件の唯一の有効な参加者は、無効化できない", () => {
  it("#147 AC-15: 対象だけが有効な参加者の進行中の案件があると、batch 全体が取り消される（状態・参加・ロール・セッション・監査が変わらない）", async () => {
    await insertSession(target, { createdAt: NOW_1 });
    // 対象のほかには、無効な社員だけ
    await caseWith([target, w.inactive.id]);
    await expectDeactivationRejected();
    expect(await isActive(target)).toBe(1);
  });

  it("#147 AC-15: 対象だけが参加者（1人だけ）の進行中の案件でも取り消される", async () => {
    await caseWith([target]);
    await expectDeactivationRejected();
  });

  it("#147 AC-15: ほかの参加者が判定の後に無効になった（読み取りの後の割り込み）場合も、batch の前提で取り消される", async () => {
    await caseWith([target, w.memberD1.id]);
    // Service の判定は通った後、書き込みの前に、ほかの唯一の有効な参加者が無効になる
    await setUserActive(w.memberD1.id, false);
    await expectDeactivationRejected();
  });

  it("#147 AC-15: 唯一の有効な参加者でも、終了した案件だけなら無効化でき、終了した案件の行は残る", async () => {
    const closed = await caseWith([target, w.inactive.id], {
      status: "closed",
    });
    await deactivate();
    expect(await isActive(target)).toBe(0);
    expect(await participantIdsOf(closed.roomId)).toEqual(
      [target, w.inactive.id].sort(),
    );
  });

  it("#147 AC-15: ほかに有効な一般の参加者がいれば、無効化できる", async () => {
    await caseWith([target, w.memberD1.id, w.inactive.id]);
    await deactivate();
    expect(await isActive(target)).toBe(0);
  });

  it("#147 AC-15・Q1: ほかの有効な参加者が自動参加の全体管理者だけでも、無効化できる（自動参加の人も数える）", async () => {
    await caseWith([target, w.admin.id]);
    await deactivate();
    expect(await isActive(target)).toBe(0);
  });

  it("#147 AC-15・Q1: ほかの有効な参加者が担当部署のオーナーだけでも、無効化できる", async () => {
    await caseWith([target, w.ownerD.id], { departmentIds: [w.deptD.id] });
    await deactivate();
    expect(await isActive(target)).toBe(0);
  });

  it("#147 AC-15（相関の条件）: 対象が参加していない案件で、ほかの人が唯一の有効な参加者でも、対象の無効化は止まらない", async () => {
    // 対象でない行：memberD1 だけが有効な参加者の進行中の案件
    await caseWith([w.memberD1.id, w.inactive.id]);
    // 対象の案件には、ほかに有効な参加者がいる
    await caseWith([target, w.memberS1.id]);
    await deactivate();
    expect(await isActive(target)).toBe(0);
  });

  it("#147 AC-15（相関の条件）: 有効な参加者がいる案件が多数あっても、1件でも唯一の案件があれば取り消される", async () => {
    for (let i = 0; i < 3; i += 1) await caseWith([target, w.memberS1.id]);
    await caseWith([target]);
    await expectDeactivationRejected();
  });

  it("#147 AC-15・D1 の上限: 101件の案件のうち最後の1件だけが唯一の案件でも、取り消される", async () => {
    for (let i = 0; i < 100; i += 1) await caseWith([target, w.memberS1.id]);
    await caseWith([target, w.inactive.id]);
    await expectDeactivationRejected();
  });

  it("#147 AC-15: 無効化と、その案件のほかの唯一の有効な参加者の退出を同時に送ると、片方だけが成り立ち、有効な参加者0人の進行中の案件が残らない", async () => {
    const room = await caseWith([target, w.memberD1.id]);
    const results = await Promise.allSettled([
      deactivate(),
      withCases(env, (r) =>
        r.removeParticipant({
          caseId: room.id,
          actorId: w.memberD1.id,
          userId: w.memberD1.id,
          traceId: casereqTraceId(),
        }),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const active = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM channel_members m JOIN users u ON u.id = m.user_id
       WHERE m.channel_id = ? AND u.is_active = 1`,
    )
      .bind(room.roomId)
      .first<{ n: number }>();
    expect(active?.n).toBe(1);
  });
});

describe("#147 147-C-2 Q4: 再有効化で、案件の参加の記録を外す", () => {
  it("#147 Q4: 無効の間に残った案件の行は、再有効化の後に無く、全社連絡と新しい部署の専用チャンネル2つにだけ入る", async () => {
    const active = await caseWith([w.memberS1.id, target]);
    const closed = await caseWith([w.memberS1.id, target], {
      status: "closed",
    });
    await deactivate();
    expect(await channelsOf(target)).toEqual(
      [active.roomId, closed.roomId].sort(),
    );

    await reactivate();

    expect(await channelsOf(target)).toEqual(
      [
        generalRoomId,
        w.deptD.dedicatedChannelId,
        w.deptD.announcementChannelId,
      ].sort(),
    );
    // ほかの参加者の行は残る
    expect(await participantIdsOf(active.roomId)).toEqual([w.memberS1.id]);
    expect(await participantIdsOf(closed.roomId)).toEqual([w.memberS1.id]);
  });

  it("#147 Q4: 再有効化の後、その案件の詳細は not_visible（参加者でない）", async () => {
    const active = await caseWith([w.memberS1.id, target]);
    await deactivate();
    await reactivate();
    const detail = await withCases(env, (r) =>
      r.findDetailExtras({ caseId: active.id, actorId: target }),
    );
    expect(detail).toBe("not_visible");
  });
});

// #150（150-A）計画 6.4・10章「AC-15 との関係」：唯一の有効な参加者の案件を、API の終了・再開と同じ Repository（closeCase・reopenCase）で
// 終了・再開すると、147-C-2 の条件（進行中の案件だけを数える）が状態で切り替わる。契約は db/case-close.repository.db.test.ts と同じ。
describe("#150 150-A AC-15 と終了・再開", () => {
  const statusWrite = async (
    kind: "close" | "reopen",
    caseId: string,
    actorId: string,
    version: number,
  ) =>
    withCases(env, async (r) => {
      const recipientIds = await r.listCaseNotifyRecipients(caseId, actorId);
      const input = {
        caseId,
        actorId,
        version,
        recipientIds,
        traceId: casereqTraceId(),
      };
      if (kind === "close") return r.closeCase(input);
      // 150-B から再開は本文つき。ここでは選び直しなし（いまの有効な参加者・空の追加と除外）
      const roomId = await roomIdOf(caseId);
      return r.reopenCase({
        ...input,
        participantIds:
          roomId === null ? [] : await activeParticipantIdsOf(roomId),
        addUserIds: [],
        removeUserIds: [],
        readRecipientIds: recipientIds,
      });
    });

  it("#150 AC-15・5-1 AC-9: 唯一の有効な参加者の進行中の案件を終了すると、その社員を無効化でき、参加の行は残る", async () => {
    const only = await caseWith([target, w.inactive.id]);
    await statusWrite("close", only.id, target, 1);
    await deactivate();
    expect(await isActive(target)).toBe(0);
    expect(await participantIdsOf(only.roomId)).toEqual(
      [target, w.inactive.id].sort(),
    );
  });

  it("#150 AC-15・5-1 AC-10: 終了した後に再開すると、再び進行中の案件の唯一の有効な参加者になり、無効化は取り消される", async () => {
    const only = await caseWith([target, w.inactive.id]);
    await statusWrite("close", only.id, target, 1);
    await statusWrite("reopen", only.id, target, 2);
    await expectDeactivationRejected();
    expect(await isActive(target)).toBe(1);
  });
});
