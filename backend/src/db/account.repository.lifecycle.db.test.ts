// #128（128-a）0-1 AC-9・AC-13・AC-14・AC-15: アカウントの無効化・再有効化の Repository を、マイグレーション済みの D1 で確かめる。
// 契約（計画 3.4。実装前の仮置き）：
//   repository.findAccountState(id) → { id, isActive, isGlobalAdmin, isDepartmentOwner } | null
//   repository.deactivate({ targetId, actorId, now, traceId })：1つの db.batch。先頭の assert（users の NOT NULL の列 login_id を
//     CASE WHEN 前提 THEN login_id ELSE NULL END にする UPDATE）が崩れたら AccountStateChangedError で、何も変わらない。
//   repository.reactivate({ targetId, departmentId, passwordHash, actorId, now, traceId })：同上。
//   それ以外の DB エラーは変換せずに再送出する。
// データは架空（testuser_128_・[UNIT_TEST]・@example.com）。監査ログは trace_id の接頭辞で、利用者・部署・DM は識別子で消す。
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
  membersOf,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { cleanupDmTestData, insertDm } from "../../test/dm-fixtures";
import { insertAssignment, insertUser } from "../../test/role-fixtures";
import { ROLE_IDS } from "../lib/permissions";
import { AccountStateChangedError, withAccounts } from "./account.repository";

// ハッシュの形だけを持つダミー（本物の認証情報ではない）。再有効化で置き換わることを確かめるため2つ用意する
const NEW_HASH_1 =
  "$scrypt$ln=16,r=8,p=2$bmV3c2FsdDFuZXdzYWx0MQ$bmV3aGFzaDFuZXdoYXNoMW5ld2hhc2gx";
const NEW_HASH_2 =
  "$scrypt$ln=16,r=8,p=2$bmV3c2FsdDJuZXdzYWx0Mg$bmV3aGFzaDJuZXdoYXNoMm5ld2hhc2gy";
const NOW_1 = "2026-11-17T01:00:00.000Z";
const NOW_2 = "2026-11-17T02:00:00.000Z";
const OLD_REVOKED = "2026-11-01T00:00:00.000Z";

let deptA: SeededDepartment;
let deptB: SeededDepartment;
let generalRoomId: string;
let normalRoomId: string;
let admin: string;
let ownerA: string;
let target: string;
let inactiveTarget: string;

const trace = () => `${AUTH_TRACE_PREFIX}128-${crypto.randomUUID()}`;

const deactivate = (
  overrides: Partial<{
    targetId: string;
    actorId: string;
    now: string;
  }> = {},
) =>
  withAccounts(env, (repository) =>
    repository.deactivate({
      targetId: target,
      actorId: admin,
      now: NOW_1,
      traceId: trace(),
      ...overrides,
    }),
  );

const reactivate = (
  overrides: Partial<{
    targetId: string;
    departmentId: string;
    passwordHash: string;
    actorId: string;
    now: string;
  }> = {},
) =>
  withAccounts(env, (repository) =>
    repository.reactivate({
      targetId: inactiveTarget,
      departmentId: deptB.id,
      passwordHash: NEW_HASH_1,
      actorId: admin,
      now: NOW_1,
      traceId: trace(),
      ...overrides,
    }),
  );

type UserRow = {
  id: string;
  login_id: string;
  is_active: number;
  deactivated_at: string | null;
  department_id: string | null;
  password_hash: string;
  must_change_password: number;
};

async function userRow(id: string) {
  const row = await env.DB.prepare(
    "SELECT id, login_id, is_active, deactivated_at, department_id, password_hash, must_change_password FROM users WHERE id = ?",
  )
    .bind(id)
    .first<UserRow>();
  if (row === null) throw new Error("利用者がありません");
  return row;
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
    "SELECT role_id, scope_type, department_id FROM user_role_assignments WHERE user_id = ? ORDER BY role_id",
  )
    .bind(userId)
    .all<{
      role_id: string;
      scope_type: string;
      department_id: string | null;
    }>();
  return results;
}

async function sessionsOf(userId: string) {
  const { results } = await env.DB.prepare(
    "SELECT id, revoked_at FROM sessions WHERE user_id = ? ORDER BY id",
  )
    .bind(userId)
    .all<{ id: string; revoked_at: string | null }>();
  return results;
}

async function accountAudits() {
  const { results } = await env.DB.prepare(
    "SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs WHERE action IN ('account.deactivate', 'account.reactivate') ORDER BY occurred_at, id",
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
      "SELECT user_id, role_id, scope_type, department_id FROM user_role_assignments ORDER BY user_id, role_id",
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
  deptA = await insertDepartmentWithChannels("128部署A");
  deptB = await insertDepartmentWithChannels("128部署B");
  normalRoomId = await insertChannel({
    name: `${TEST_TAG}128個別`,
    purpose: "normal",
    departmentId: deptA.id,
  });
  admin = await insertUser("testuser_128_admin", deptA.id);
  ownerA = await insertUser("testuser_128_owner", deptA.id);
  target = await insertUser("testuser_128_target", deptA.id);
  inactiveTarget = await insertUser("testuser_128_gone", deptA.id, {
    isActive: false,
  });
  await env.DB.prepare(
    "UPDATE users SET department_id = NULL, must_change_password = 0 WHERE id = ?",
  )
    .bind(inactiveTarget)
    .run();
  await makeGlobalAdmin(admin);
  await makeOwner(ownerA, deptA.id);
  // 追加ロール（全体管理者・オーナー以外の割り当て）
  await insertAssignment(target, ROLE_IDS.member, "company", null);
  // 以前の割り当てが残る無効な社員（再有効化で戻さないことを確かめる）
  await insertAssignment(inactiveTarget, ROLE_IDS.member, "company", null);
  for (const user of [admin, ownerA, target]) {
    await insertMember(generalRoomId, user);
    await joinDepartmentChannels(deptA, user);
  }
  await insertMember(normalRoomId, target);
  await env.DB.prepare(
    "UPDATE users SET must_change_password = 0 WHERE id IN (?, ?, ?)",
  )
    .bind(admin, ownerA, target)
    .run();
});

afterEach(async () => {
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_128_audit");
  await cleanupDmTestData();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#128 対象の事実の読み取り（findAccountState）", () => {
  it("#128 AC-9: 有効・全体管理者・オーナーの印を返し、ない社員は null", async () => {
    const read = (id: string) =>
      withAccounts(env, (repository) => repository.findAccountState(id));
    expect(await read(target)).toEqual({
      id: target,
      isActive: true,
      isGlobalAdmin: false,
      isDepartmentOwner: false,
    });
    expect(await read(admin)).toMatchObject({ isGlobalAdmin: true });
    expect(await read(ownerA)).toMatchObject({
      isGlobalAdmin: false,
      isDepartmentOwner: true,
    });
    expect(await read(inactiveTarget)).toMatchObject({ isActive: false });
    expect(await read("01JTEST128NOTFOUND00000001")).toBeNull();
  });
});

describe("#128 無効化（Repository・D1）", () => {
  it("#128 AC-9・AC-15: 状態・所属・全チャンネルの参加・追加ロール・セッションを一度に変え、DM の参加は残す", async () => {
    const dm = await insertDm(target, ownerA);
    const live = await insertSession(target, { createdAt: NOW_1 });
    const old = await insertSession(target, {
      createdAt: OLD_REVOKED,
      revokedAt: OLD_REVOKED,
    });
    const adminSession = await insertSession(admin, { createdAt: NOW_1 });

    await deactivate({ now: NOW_2 });

    expect(await userRow(target)).toMatchObject({
      is_active: 0,
      deactivated_at: NOW_2,
      department_id: null,
    });
    // 全社連絡・部署の専用2つ・個別チャンネルのすべてから外れる
    expect(await channelsOf(target)).toEqual([]);
    expect(await rolesOf(target)).toEqual([]);
    const sessions = await sessionsOf(target);
    expect(sessions.find((s) => s.id === live.id)?.revoked_at).toBe(NOW_2);
    // すでに失効していたセッションの時刻は上書きしない
    expect(sessions.find((s) => s.id === old.id)?.revoked_at).toBe(OLD_REVOKED);
    // 他の社員には触れない
    expect((await sessionsOf(admin))[0]).toMatchObject({
      id: adminSession.id,
      revoked_at: null,
    });
    expect(await membersOf(deptA.dedicatedChannelId)).toEqual(
      [admin, ownerA].sort(),
    );
    expect(await rolesOf(ownerA)).toHaveLength(1);
    // DM（U-6）：何もしない
    const { results } = await env.DB.prepare(
      "SELECT user_id FROM conversation_members WHERE conversation_id = ? ORDER BY user_id",
    )
      .bind(dm)
      .all<{ user_id: string }>();
    expect(results.map((r) => r.user_id)).toEqual([target, ownerA].sort());
  });

  it("#128 AC-13: 監査 account.deactivate が1件で、操作者・対象・元の部署だけを持ち、本名・メール・表示名・ハッシュを含まない", async () => {
    await deactivate();
    const audits = await accountAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: admin,
      action: "account.deactivate",
      target_type: "user",
      target_id: target,
      result: "success",
    });
    // #146（統括の決定）：取り消した案件の作成申請の件数を項目として足す（申請がなければ 0）
    expect(JSON.parse(audits[0]?.detail ?? "{}")).toEqual({
      fromDepartmentId: deptA.id,
      cancelledCaseRequestCount: 0,
    });
    const text = JSON.stringify(audits);
    expect(text).not.toContain("testuser_128_target@example.com");
    expect(text).not.toContain("テスト太郎");
    expect(text).not.toContain("$scrypt$");
    expect(text).not.toContain("v1:");
  });

  it.each<[string, () => Promise<unknown>]>([
    ["対象が部署のオーナー", () => deactivate({ targetId: ownerA })],
    ["対象が既に無効", () => deactivate({ targetId: inactiveTarget })],
    [
      "対象が操作者本人（唯一の全体管理者）",
      () => deactivate({ targetId: admin }),
    ],
    [
      "対象がない",
      () => deactivate({ targetId: "01JTEST128NOTFOUND00000001" }),
    ],
    ["操作者が全体管理者でない", () => deactivate({ actorId: ownerA })],
  ])(
    "#128 AC-9: %sなら AccountStateChangedError で、状態・参加・ロール・セッション・監査が何も変わらない",
    async (_label, run) => {
      await insertSession(target, { createdAt: NOW_1 });
      await insertSession(ownerA, { createdAt: NOW_1 });
      const before = await snapshot();
      await expect(run()).rejects.toBeInstanceOf(AccountStateChangedError);
      expect(await snapshot()).toEqual(before);
    },
  );

  it("#128 AC-9（重大2）: 判定の後で操作者の全体管理者の割り当てが外れていたら、何も変わらない", async () => {
    await insertSession(target, { createdAt: NOW_1 });
    await env.DB.prepare(
      "DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = ?",
    )
      .bind(admin, ROLE_IDS.globalAdmin)
      .run();
    const before = await snapshot();
    await expect(deactivate()).rejects.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before);
  });

  it("#128 AC-9（重大2）: 判定の後で操作者が無効になっていたら、何も変わらない", async () => {
    await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
      .bind(admin)
      .run();
    const before = await snapshot();
    await expect(deactivate()).rejects.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before);
  });

  it("#128 AC-9: 全体管理者の割り当てが部署の範囲（company でない）だけでは、操作者として認めない", async () => {
    await env.DB.prepare(
      "DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = ?",
    )
      .bind(admin, ROLE_IDS.globalAdmin)
      .run();
    await insertAssignment(admin, ROLE_IDS.globalAdmin, "department", deptA.id);
    const before = await snapshot();
    await expect(deactivate()).rejects.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before);
  });

  it("#128 AC-9: 同時の無効化×2（同じ時刻）は一方だけ成功し、他方は AccountStateChangedError。監査・失効は1回分", async () => {
    await insertSession(target, { createdAt: NOW_1 });
    const results = await Promise.allSettled([
      deactivate({ now: NOW_1 }),
      deactivate({ now: NOW_1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(AccountStateChangedError);
    expect(await accountAudits()).toHaveLength(1);
    expect((await sessionsOf(target))[0]?.revoked_at).toBe(NOW_1);
    expect(await userRow(target)).toMatchObject({ is_active: 0 });
  });

  it("#128 AC-9: 想定の NOT NULL 違反以外の DB エラー（監査の書き込みの失敗）は変換せずに伝え、すべて取り消す", async () => {
    await env.DB.exec(
      "CREATE TRIGGER unit_fail_128_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'account.deactivate' BEGIN SELECT RAISE(ABORT, 'unit_fail_128_audit'); END",
    );
    await insertSession(target, { createdAt: NOW_1 });
    const before = await snapshot();
    const error = await deactivate().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before);
  });
});

describe("#128 再有効化（Repository・D1）", () => {
  it("#128 AC-14（コードレビュー1回目の重大1）: 無効な間に紛れ込んだ参加の行（個別・以前の部署の専用）があっても、再有効化の後の参加は全社連絡と指定部署の専用2つだけ", async () => {
    await insertMember(normalRoomId, inactiveTarget);
    await insertMember(deptA.dedicatedChannelId, inactiveTarget);
    await reactivate();
    expect(await channelsOf(inactiveTarget)).toEqual(
      [
        generalRoomId,
        deptB.dedicatedChannelId,
        deptB.announcementChannelId,
      ].sort(),
    );
    expect(await membersOf(normalRoomId)).toEqual([target]);
  });

  it("#128 AC-14・AC-15: 同じ ID・ユーザーIDで戻り、指定部署に所属し、全社連絡と部署の専用2つだけに参加し、パスワードの変更を求める", async () => {
    const before = await userRow(inactiveTarget);
    await reactivate({ now: NOW_2 });
    const after = await userRow(inactiveTarget);
    expect(after).toEqual({
      id: inactiveTarget,
      login_id: before.login_id,
      is_active: 1,
      deactivated_at: null,
      department_id: deptB.id,
      password_hash: NEW_HASH_1,
      must_change_password: 1,
    });
    expect(after.password_hash).not.toBe(before.password_hash);
    expect(await channelsOf(inactiveTarget)).toEqual(
      [
        generalRoomId,
        deptB.dedicatedChannelId,
        deptB.announcementChannelId,
      ].sort(),
    );
    // 以前の部署の専用・個別チャンネルには戻さない
    expect(await membersOf(normalRoomId)).toEqual([target]);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE login_id = 'testuser_128_gone'",
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("#128 AC-14: ロールは戻さない（以前の割り当ては増えも消えもしない。全体管理者・オーナーは付かない）", async () => {
    await reactivate();
    expect(await rolesOf(inactiveTarget)).toEqual([
      { role_id: ROLE_IDS.member, scope_type: "company", department_id: null },
    ]);
  });

  it("#128 AC-13: 監査 account.reactivate が1件で、操作者・対象・部署だけを持ち、本名・メール・ハッシュを含まない", async () => {
    await reactivate();
    const audits = await accountAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: admin,
      action: "account.reactivate",
      target_type: "user",
      target_id: inactiveTarget,
      result: "success",
    });
    expect(JSON.parse(audits[0]?.detail ?? "{}")).toEqual({
      departmentId: deptB.id,
    });
    const text = JSON.stringify(audits);
    expect(text).not.toContain("testuser_128_gone@example.com");
    expect(text).not.toContain("テスト太郎");
    expect(text).not.toContain(NEW_HASH_1);
  });

  it.each<[string, () => Promise<unknown>]>([
    ["対象が有効", () => reactivate({ targetId: target })],
    [
      "部署がない",
      () => reactivate({ departmentId: "01JTEST128NODEPT0000000001" }),
    ],
    [
      "対象がない",
      () => reactivate({ targetId: "01JTEST128NOTFOUND00000001" }),
    ],
    ["操作者が全体管理者でない", () => reactivate({ actorId: ownerA })],
  ])(
    "#128 AC-14: %sなら AccountStateChangedError で、何も変わらない",
    async (_label, run) => {
      const before = await snapshot();
      await expect(run()).rejects.toBeInstanceOf(AccountStateChangedError);
      expect(await snapshot()).toEqual(before);
    },
  );

  it("#128 AC-14: 判定の後で部署が無効になっていたら、何も変わらない", async () => {
    await env.DB.prepare("UPDATE departments SET is_active = 0 WHERE id = ?")
      .bind(deptB.id)
      .run();
    const before = await snapshot();
    await expect(reactivate()).rejects.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before);
  });

  it("#128 AC-14（重大2）: 判定の後で操作者の全体管理者の割り当てが外れた・操作者が無効になったら、何も変わらない", async () => {
    await env.DB.prepare(
      "DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = ?",
    )
      .bind(admin, ROLE_IDS.globalAdmin)
      .run();
    const before = await snapshot();
    await expect(reactivate()).rejects.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before);
    await makeGlobalAdmin(admin);
    await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
      .bind(admin)
      .run();
    const before2 = await snapshot();
    await expect(reactivate()).rejects.toBeInstanceOf(AccountStateChangedError);
    expect(await snapshot()).toEqual(before2);
  });

  it("#128 AC-14: 同時の再有効化×2は一方だけ成功し、参加の重複・2件目の監査・ハッシュの上書きがない", async () => {
    const results = await Promise.allSettled([
      reactivate({ passwordHash: NEW_HASH_1, departmentId: deptB.id }),
      reactivate({ passwordHash: NEW_HASH_2, departmentId: deptA.id }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(AccountStateChangedError);
    const winner = results[0]?.status === "fulfilled" ? 0 : 1;
    const row = await userRow(inactiveTarget);
    expect(row.password_hash).toBe(winner === 0 ? NEW_HASH_1 : NEW_HASH_2);
    const dept = winner === 0 ? deptB : deptA;
    expect(row.department_id).toBe(dept.id);
    expect(await channelsOf(inactiveTarget)).toEqual(
      [
        generalRoomId,
        dept.dedicatedChannelId,
        dept.announcementChannelId,
      ].sort(),
    );
    expect(await accountAudits()).toHaveLength(1);
  });
});

describe("#128 無効化×再有効化の同時実行（Repository・D1）", () => {
  it("#128 AC-9・AC-14: 無効化と再有効化を同時に送ると、失敗した側は AccountStateChangedError で何も残さず、最後の状態は成功した操作を順に当てた結果と一致する", async () => {
    await insertSession(target, { createdAt: NOW_1 });
    const results = await Promise.allSettled([
      deactivate({ now: NOW_1 }),
      reactivate({ targetId: target, now: NOW_2 }),
    ]);
    for (const r of results)
      if (r.status === "rejected")
        expect(r.reason).toBeInstanceOf(AccountStateChangedError);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const audits = await accountAudits();
    // 監査は成功した操作の数だけ
    expect(audits).toHaveLength(succeeded);
    const row = await userRow(target);
    const last = audits[audits.length - 1]?.action;
    if (last === "account.reactivate") {
      expect(row).toMatchObject({
        is_active: 1,
        deactivated_at: null,
        department_id: deptB.id,
        password_hash: NEW_HASH_1,
        must_change_password: 1,
      });
      expect(await channelsOf(target)).toEqual(
        [
          generalRoomId,
          deptB.dedicatedChannelId,
          deptB.announcementChannelId,
        ].sort(),
      );
    } else {
      expect(last).toBe("account.deactivate");
      expect(row).toMatchObject({
        is_active: 0,
        deactivated_at: NOW_1,
        department_id: null,
      });
      expect(await channelsOf(target)).toEqual([]);
    }
  });
});
