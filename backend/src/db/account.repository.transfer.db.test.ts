// #128（128-b）0-1 AC-16・AC-17・AC-18: 部署異動（即時）の Repository を、マイグレーション済みの D1 で確かめる。
// 契約（計画 4.4。実装前の仮置き）：
//   repository.findTransferState(id) → { id, isActive, departmentId, ownedDepartmentIds } | null
//   repository.transfer({ targetId, fromDepartmentId, toDepartmentId, actorId, now, traceId })：1つの db.batch。
//     先頭の assert（128-a と同じ assertStatement。users.login_id の NOT NULL 違反）の前提：
//       対象 is_active=1 AND 対象 department_id=:from AND 対象が :from の role_owner でない AND :to が存在し is_active=1
//       AND :to≠:from AND 操作者が有効で会社範囲の全体管理者。
//     崩れたら AccountStateChangedError で、何も変わらない。それ以外の DB エラーは変換せずに再送出する。
//   変わるもの：所属、旧部署の専用2つ（department・announcement）の参加の削除、新部署の専用2つへの参加（重複させない）、
//     監査 account.transfer 1件（detail：fromDepartmentId・toDepartmentId・roleIds）。
//   変わらないもの：全社連絡・個別チャンネル・DM の参加、ロールの割り当て、セッション。
// データは架空（testuser_128_x_・[UNIT_TEST]・@example.com）。監査ログは trace_id の接頭辞で、利用者・部署は識別子で消す。
// 全体管理者は DB 全体で1人（user_role_assignments_global_admin_unique）のため、操作者の admin だけを全体管理者にする。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  cleanupAuthTestData,
  insertSession,
} from "../../test/auth-fixtures";
import { companyGeneralRoomId } from "../../test/company-general-fixtures";
import {
  TEST_TAG,
  cleanupDepartmentTestData,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  joinDepartmentChannels,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { cleanupDmTestData, insertDm } from "../../test/dm-fixtures";
import { insertAssignment, insertUser } from "../../test/role-fixtures";
import { ROLE_IDS } from "../lib/permissions";
import { AccountStateChangedError, withAccounts } from "./account.repository";

const NOW_1 = "2026-11-17T01:00:00.000Z";

let deptA: SeededDepartment;
let deptB: SeededDepartment;
let deptC: SeededDepartment;
let generalRoomId: string;
let normalRoomId: string;
let admin: string;
let ownerA: string;
let target: string;
let inactiveTarget: string;

const trace = () => `${AUTH_TRACE_PREFIX}128x-${crypto.randomUUID()}`;

const transfer = (
  overrides: Partial<{
    targetId: string;
    fromDepartmentId: string;
    toDepartmentId: string;
    actorId: string;
    now: string;
  }> = {},
) =>
  withAccounts(env, (repository) =>
    repository.transfer({
      targetId: target,
      fromDepartmentId: deptA.id,
      toDepartmentId: deptB.id,
      actorId: admin,
      now: NOW_1,
      traceId: trace(),
      ...overrides,
    }),
  );

async function departmentIdOf(id: string) {
  const row = await env.DB.prepare(
    "SELECT department_id FROM users WHERE id = ?",
  )
    .bind(id)
    .first<{ department_id: string | null }>();
  return row?.department_id;
}

async function channelsOf(userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT channel_id FROM channel_members WHERE user_id = ? ORDER BY channel_id",
  )
    .bind(userId)
    .all<{ channel_id: string }>();
  return results.map((r) => r.channel_id);
}

async function rolesOf(userId: string) {
  const { results } = await env.DB.prepare(
    "SELECT role_id, scope_type, department_id FROM user_role_assignments WHERE user_id = ? ORDER BY role_id, department_id",
  )
    .bind(userId)
    .all<Record<string, unknown>>();
  return results;
}

async function transferAudits() {
  const { results } = await env.DB.prepare(
    "SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs WHERE action = 'account.transfer' ORDER BY occurred_at, id",
  ).all<{
    actor_id: string | null;
    action: string;
    target_type: string;
    target_id: string | null;
    result: string;
    detail: string | null;
  }>();
  return results;
}

/** 失敗の後に、操作の前と完全に同じであることを toEqual で確かめるための全体の状態 */
async function snapshot() {
  const all = async (sql: string) =>
    (await env.DB.prepare(sql).all<Record<string, unknown>>()).results;
  return {
    users: await all(
      "SELECT id, login_id, is_active, deactivated_at, department_id, password_hash, must_change_password FROM users ORDER BY id",
    ),
    members: await all(
      "SELECT channel_id, user_id FROM channel_members ORDER BY channel_id, user_id",
    ),
    assignments: await all(
      "SELECT user_id, role_id, scope_type, department_id FROM user_role_assignments ORDER BY user_id, role_id, department_id",
    ),
    sessions: await all("SELECT id, revoked_at FROM sessions ORDER BY id"),
    conversations: await all(
      "SELECT conversation_id, user_id FROM conversation_members ORDER BY conversation_id, user_id",
    ),
    audits: await all(
      "SELECT action, target_id FROM audit_logs WHERE action LIKE 'account.%' ORDER BY id",
    ),
  };
}

beforeEach(async () => {
  const general = await companyGeneralRoomId();
  if (general === null) throw new Error("全社連絡がありません");
  generalRoomId = general;
  deptA = await insertDepartmentWithChannels("128異動部署A");
  deptB = await insertDepartmentWithChannels("128異動部署B");
  deptC = await insertDepartmentWithChannels("128異動部署C");
  // 部署をまたぐ個別チャンネル（旧部署に置かれたもの）。異動でも参加を維持する（AC-17）
  normalRoomId = await insertChannel({
    name: `${TEST_TAG}128異動個別`,
    purpose: "normal",
    departmentId: deptA.id,
  });
  admin = await insertUser("testuser_128_x_admin", deptA.id);
  ownerA = await insertUser("testuser_128_x_owner", deptA.id);
  target = await insertUser("testuser_128_x_target", deptA.id);
  inactiveTarget = await insertUser("testuser_128_x_gone", deptA.id, {
    isActive: false,
  });
  await env.DB.prepare("UPDATE users SET department_id = NULL WHERE id = ?")
    .bind(inactiveTarget)
    .run();
  await makeGlobalAdmin(admin);
  await makeOwner(ownerA, deptA.id);
  // 追加ロール（AC-18：異動では移さない）
  await insertAssignment(target, ROLE_IDS.member, "company", null);
  for (const user of [admin, ownerA, target]) {
    await insertMember(generalRoomId, user);
    await joinDepartmentChannels(deptA, user);
  }
  await insertMember(normalRoomId, target);
});

afterEach(async () => {
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_128x_audit");
  await cleanupDmTestData();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#128 異動の対象の事実の読み取り（findTransferState）", () => {
  it("#128 AC-16・AC-18: 有効・今の所属・オーナーの部署を返し、ない社員は null", async () => {
    const read = (id: string) =>
      withAccounts(env, (repository) => repository.findTransferState(id));
    expect(await read(target)).toEqual({
      id: target,
      isActive: true,
      departmentId: deptA.id,
      ownedDepartmentIds: [],
    });
    expect(await read(ownerA)).toMatchObject({
      departmentId: deptA.id,
      ownedDepartmentIds: [deptA.id],
    });
    expect(await read(inactiveTarget)).toMatchObject({
      isActive: false,
      departmentId: null,
    });
    expect(await read("01JTEST128XNOTFOUND0000001")).toBeNull();
  });
});

describe("#128 異動の対象の事実の読み取り：部署のないオーナーの割り当て", () => {
  // user_role_assignments_scope_check は scope_type と department_id の組だけを制約するため、
  // role_owner の会社範囲（department_id が NULL）の行も作れる。それを ownedDepartmentIds に混ぜない
  it("#128 AC-18: オーナーの割り当ての department_id が NULL の行があっても、ownedDepartmentIds に null を含めない", async () => {
    await insertAssignment(target, ROLE_IDS.owner, "company", null);
    await makeOwner(target, deptC.id);
    const state = await withAccounts(env, (repository) =>
      repository.findTransferState(target),
    );
    expect(state?.ownedDepartmentIds).toEqual([deptC.id]);
  });
});

describe("#128 部署異動（Repository・D1）", () => {
  it("#128 AC-16: 所属が新しい部署に変わり、監査 account.transfer が1件で、操作者・対象・前後の部署・権限（役割ID）だけを持つ", async () => {
    await transfer();
    expect(await departmentIdOf(target)).toBe(deptB.id);
    const audits = await transferAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: admin,
      action: "account.transfer",
      target_type: "user",
      target_id: target,
      result: "success",
    });
    const detail = JSON.parse(audits[0]?.detail ?? "{}") as Record<
      string,
      unknown
    >;
    expect(Object.keys(detail).sort()).toEqual(
      ["fromDepartmentId", "roleIds", "toDepartmentId"].sort(),
    );
    expect(detail).toMatchObject({
      fromDepartmentId: deptA.id,
      toDepartmentId: deptB.id,
    });
    // AuditDetail は入れ子にしない（project-rules）。役割IDを昇順に「,」で区切った文字列
    expect(detail.roleIds).toBe(ROLE_IDS.member);
    const text = JSON.stringify(audits);
    expect(text).not.toContain("testuser_128_x_target@example.com");
    expect(text).not.toContain("テスト太郎");
    expect(text).not.toContain("$scrypt$");
    expect(text).not.toContain("v1:");
  });

  it("#128 AC-16: 役割が複数ある社員の監査の roleIds は、役割IDを昇順に「,」で区切った文字列", async () => {
    await makeOwner(admin, deptC.id);
    await insertAssignment(admin, ROLE_IDS.member, "company", null);
    await transfer({ targetId: admin });
    const audits = await transferAudits();
    expect(audits).toHaveLength(1);
    const detail = JSON.parse(audits[0]?.detail ?? "{}") as Record<
      string,
      unknown
    >;
    const expected = [ROLE_IDS.globalAdmin, ROLE_IDS.owner, ROLE_IDS.member]
      .slice()
      .sort()
      .join(",");
    expect(detail.roleIds).toBe(expected);
  });

  it("#128 AC-17: 旧部署の専用2つから外れ、新部署の専用2つに参加し、全社連絡・部署をまたぐ個別チャンネル・DM の参加は維持する", async () => {
    const dm = await insertDm(target, ownerA);
    await transfer();
    expect(await channelsOf(target)).toEqual(
      [
        generalRoomId,
        normalRoomId,
        deptB.dedicatedChannelId,
        deptB.announcementChannelId,
      ].sort(),
    );
    // 他の社員の参加には触れない
    expect(await channelsOf(ownerA)).toEqual(
      [
        generalRoomId,
        deptA.dedicatedChannelId,
        deptA.announcementChannelId,
      ].sort(),
    );
    const { results } = await env.DB.prepare(
      "SELECT user_id FROM conversation_members WHERE conversation_id = ? ORDER BY user_id",
    )
      .bind(dm)
      .all<{ user_id: string }>();
    expect(results.map((r) => r.user_id)).toEqual([target, ownerA].sort());
  });

  it("#128 AC-17: 新部署の専用チャンネルに既に参加していても、重複させずに成功する", async () => {
    await insertMember(deptB.dedicatedChannelId, target);
    await expect(transfer()).resolves.toBeUndefined();
    expect(await channelsOf(target)).toEqual(
      [
        generalRoomId,
        normalRoomId,
        deptB.dedicatedChannelId,
        deptB.announcementChannelId,
      ].sort(),
    );
  });

  it("#128 AC-18: ロールの割り当ては移さない（増えも消えもしない）。セッションも失効しない", async () => {
    const session = await insertSession(target, { createdAt: NOW_1 });
    const before = await rolesOf(target);
    await transfer();
    expect(await rolesOf(target)).toEqual(before);
    const row = await env.DB.prepare(
      "SELECT revoked_at FROM sessions WHERE id = ?",
    )
      .bind(session.id)
      .first<{ revoked_at: string | null }>();
    expect(row?.revoked_at).toBeNull();
  });

  it("#128 AC-16・AC-18: 全体管理者（今の部署以外のオーナーを兼ねる）も異動でき、全体管理者・オーナーの割り当ては変わらない", async () => {
    await makeOwner(admin, deptC.id);
    const before = await rolesOf(admin);
    await transfer({ targetId: admin });
    expect(await departmentIdOf(admin)).toBe(deptB.id);
    expect(await rolesOf(admin)).toEqual(before);
  });

  it.each<[string, () => Promise<unknown>]>([
    ["対象が今の部署のオーナー（AC-18）", () => transfer({ targetId: ownerA })],
    ["対象が無効", () => transfer({ targetId: inactiveTarget })],
    ["対象がない", () => transfer({ targetId: "01JTEST128XNOTFOUND0000001" })],
    [
      "新しい部署がない",
      () => transfer({ toDepartmentId: "01JTEST128XNODEPT000000001" }),
    ],
    [
      "新しい部署が今の部署と同じ",
      () => transfer({ toDepartmentId: deptA.id }),
    ],
    [
      "読んだ所属（fromDepartmentId）が今の所属と違う",
      () => transfer({ fromDepartmentId: deptC.id }),
    ],
    ["操作者が全体管理者でない", () => transfer({ actorId: ownerA })],
  ])(
    "#128 AC-16: %sなら AccountStateChangedError で、所属・参加・ロール・セッション・監査が何も変わらない",
    async (_label, run) => {
      await insertSession(target, { createdAt: NOW_1 });
      const before = await snapshot();
      await expect(run()).rejects.toBeInstanceOf(AccountStateChangedError);
      expect(await snapshot()).toEqual(before);
    },
  );

  it("#128 AC-16: 判定の後で対象が無効化されていたら、何も変わらない", async () => {
    await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
      .bind(target)
      .run();
    const before = await snapshot();
    await expect(transfer()).rejects.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before);
  });

  it("#128 AC-16: 判定の後で新しい部署が無効になっていたら、何も変わらない", async () => {
    await env.DB.prepare("UPDATE departments SET is_active = 0 WHERE id = ?")
      .bind(deptB.id)
      .run();
    const before = await snapshot();
    await expect(transfer()).rejects.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before);
  });

  it("#128 AC-16: 判定の後で対象が別の部署へ異動済みになっていたら、何も変わらない", async () => {
    await env.DB.prepare("UPDATE users SET department_id = ? WHERE id = ?")
      .bind(deptC.id, target)
      .run();
    const before = await snapshot();
    await expect(transfer()).rejects.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before);
  });

  it("#128 AC-18: 判定の後で対象が今の部署のオーナーになっていたら、何も変わらない", async () => {
    await env.DB.prepare(
      "DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = ?",
    )
      .bind(ownerA, ROLE_IDS.owner)
      .run();
    await makeOwner(target, deptA.id);
    const before = await snapshot();
    await expect(transfer()).rejects.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before);
  });

  it("#128 AC-16（重大2）: 判定の後で操作者の全体管理者の割り当てが外れた・操作者が無効になったら、何も変わらない", async () => {
    await env.DB.prepare(
      "DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = ?",
    )
      .bind(admin, ROLE_IDS.globalAdmin)
      .run();
    const before = await snapshot();
    await expect(transfer()).rejects.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before);
    await makeGlobalAdmin(admin);
    await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
      .bind(admin)
      .run();
    const before2 = await snapshot();
    await expect(transfer()).rejects.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before2);
  });

  it("#128 AC-16: 全体管理者の割り当てが部署の範囲（company でない）だけでは、操作者として認めない", async () => {
    await env.DB.prepare(
      "DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = ?",
    )
      .bind(admin, ROLE_IDS.globalAdmin)
      .run();
    await insertAssignment(admin, ROLE_IDS.globalAdmin, "department", deptA.id);
    const before = await snapshot();
    await expect(transfer()).rejects.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before);
  });

  it("#128 AC-16・AC-17: 同時の異動×2（同じ旧部署から別々の新部署へ）は一方だけ成功し、他方は AccountStateChangedError。監査は1件で、参加は成功した側の部署だけ", async () => {
    const results = await Promise.allSettled([
      transfer({ toDepartmentId: deptB.id }),
      transfer({ toDepartmentId: deptC.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(AccountStateChangedError);
    const dept = results[0]?.status === "fulfilled" ? deptB : deptC;
    expect(await departmentIdOf(target)).toBe(dept.id);
    expect(await channelsOf(target)).toEqual(
      [
        generalRoomId,
        normalRoomId,
        dept.dedicatedChannelId,
        dept.announcementChannelId,
      ].sort(),
    );
    expect(await transferAudits()).toHaveLength(1);
  });

  it("#128 AC-16: 想定の NOT NULL 違反以外の DB エラー（監査の書き込みの失敗）は変換せずに伝え、すべて取り消す", async () => {
    await env.DB.exec(
      "CREATE TRIGGER unit_fail_128x_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'account.transfer' BEGIN SELECT RAISE(ABORT, 'unit_fail_128x_audit'); END",
    );
    const before = await snapshot();
    const error = await transfer().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before);
  });
});
