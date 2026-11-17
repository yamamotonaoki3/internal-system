// #128（128-c）0-1 AC-20・C-177（U-1・U-2）: 退職処理の申請の Repository を、マイグレーション済みの D1 で確かめる。
// 契約（計画 5.1・5.3。実装前の仮置き）：
//   withRetirementRequests(env, (repository, roles) => …)（retirement-request.repository.ts）
//   repository.create({ targetUserId, departmentId, actorId, reviewerIds, now, traceId }) → { id, ... }
//     1つの db.batch。先頭の assert（#196 の方式）で「対象が有効で departmentId に所属」「操作者が有効で departmentId のオーナー」
//     「操作者≠対象」「対象がオーナー・全体管理者の割り当てを持たない」を確かめ、崩れていたら RetirementRequestStateChangedError で何も残さない。
//     同じ対象の pending（部分一意索引の違反）は RetirementRequestConflictError（reason: "duplicate_pending"）。
//     監査 retirement_request.create と、reviewerIds への retirement_request.submitted の通知（target_id＝申請ID）を同じ batch に入れる。
//   repository.reject({ id, actorId, reason, now, traceId })：前提＝申請が pending・操作者が有効で会社範囲の全体管理者。
//     申請者への retirement_request.rejected（決裁者が申請者本人なら送らない）と監査 retirement_request.reject を同じ batch に。
//   repository.withdraw({ id, actorId, now, traceId })：前提＝申請が pending・操作者が申請者本人で有効。decided_by＝申請者。通知しない。
//     申請者が今もその部署のオーナーであることは前提にしない（計画 5.3）。
//   それ以外の DB エラーは変換せずに再送出する。
// データは架空（testuser_128c_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  cleanupAuthTestData,
  insertSession,
} from "../../test/auth-fixtures";
import {
  cleanupDepartmentTestData,
  insertDepartmentWithChannels,
  joinDepartmentChannels,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { insertUser } from "../../test/role-fixtures";
import {
  RETIRE_LATER,
  RETIRE_NOW,
  cleanupRetirementRequestTestData,
  detailValueTypes,
  insertRetirementRequest,
  retirementAudits,
  retirementNotifications,
  retirementRow,
  retirementRows,
  retirementSnapshot,
} from "../../test/retirement-request-fixtures";
import { ROLE_IDS } from "../lib/permissions";
import {
  RetirementRequestConflictError,
  RetirementRequestStateChangedError,
  withRetirementRequests,
} from "./retirement-request.repository";

const MISSING_ID = "01JTEST128CN0NE00000000001";
const REASON = "[UNIT_TEST]在籍の確認がとれたため却下";

let deptA: SeededDepartment;
let deptB: SeededDepartment;
let admin: string;
let ownerA: string;
let ownerB: string;
let target: string;
let other: string;

const trace = () => `${AUTH_TRACE_PREFIX}128c-${crypto.randomUUID()}`;

const create = (
  overrides: Partial<{
    targetUserId: string;
    departmentId: string;
    actorId: string;
    reviewerIds: string[];
    now: string;
  }> = {},
) =>
  withRetirementRequests(env, (repository) =>
    repository.create({
      targetUserId: target,
      departmentId: deptA.id,
      actorId: ownerA,
      reviewerIds: [admin],
      now: RETIRE_NOW,
      traceId: trace(),
      ...overrides,
    }),
  );

const reject = (
  id: string,
  overrides: Partial<{ actorId: string; reason: string; now: string }> = {},
) =>
  withRetirementRequests(env, (repository) =>
    repository.reject({
      id,
      actorId: admin,
      reason: REASON,
      now: RETIRE_LATER,
      traceId: trace(),
      ...overrides,
    }),
  );

const withdraw = (
  id: string,
  overrides: Partial<{ actorId: string; now: string }> = {},
) =>
  withRetirementRequests(env, (repository) =>
    repository.withdraw({
      id,
      actorId: ownerA,
      now: RETIRE_LATER,
      traceId: trace(),
      ...overrides,
    }),
  );

beforeEach(async () => {
  deptA = await insertDepartmentWithChannels("128c部署A");
  deptB = await insertDepartmentWithChannels("128c部署B");
  admin = await insertUser("testuser_128c_admin", deptB.id);
  ownerA = await insertUser("testuser_128c_ownera", deptA.id);
  ownerB = await insertUser("testuser_128c_ownerb", deptB.id);
  target = await insertUser("testuser_128c_target", deptA.id);
  other = await insertUser("testuser_128c_other", deptA.id);
  await makeGlobalAdmin(admin);
  await makeOwner(ownerA, deptA.id);
  await makeOwner(ownerB, deptB.id);
  await joinDepartmentChannels(deptA, target);
});

afterEach(async () => {
  await cleanupRetirementRequestTestData();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#128（128-c）0-1 AC-20 申請の作成（Repository・D1）", () => {
  it("#128 0-1 AC-20: 作成すると pending の申請が1件でき、作成者・対象・部署・日時を記録し、対象の所属・状態・ロール・参加・セッションは変わらない", async () => {
    await insertSession(target, { createdAt: RETIRE_NOW });
    const before = await retirementSnapshot();
    const created = await create();
    expect(created).toMatchObject({ id: expect.any(String) as string });
    expect(await retirementRows()).toEqual([
      {
        id: created.id,
        target_user_id: target,
        requested_by: ownerA,
        department_id: deptA.id,
        status: "pending",
        decision_reason: null,
        decided_by: null,
        decided_at: null,
      },
    ]);
    const createdAt = await env.DB.prepare(
      "SELECT created_at FROM retirement_requests WHERE id = ?",
    )
      .bind(created.id)
      .first<{ created_at: string }>();
    expect(createdAt?.created_at).toBe(RETIRE_NOW);
    const after = await retirementSnapshot();
    // 申請を送っただけでは、所属・アカウント・権限は変わらない
    expect(after.users).toEqual(before.users);
    expect(after.assignments).toEqual(before.assignments);
    expect(after.members).toEqual(before.members);
    expect(after.sessions).toEqual(before.sessions);
  });

  it("#128 0-1 AC-20・3-4 AC-1: 監査 retirement_request.create が1件、通知 submitted が reviewerIds だけに1件ずつ（target_id は申請ID）。監査に本名・メール・表示名がなく、detail は入れ子でない", async () => {
    const created = await create({ reviewerIds: [admin, admin] });
    const audits = await retirementAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: ownerA,
      action: "retirement_request.create",
      result: "success",
    });
    expect(detailValueTypes(audits[0]?.detail ?? null)).not.toContain("object");
    expect(detailValueTypes(audits[0]?.detail ?? null)).not.toContain("array");
    const text = JSON.stringify(audits);
    expect(text).not.toContain("testuser_128c_target@example.com");
    expect(text).not.toContain("テスト太郎");
    expect(text).not.toContain("v1:");
    expect(await retirementNotifications()).toEqual([
      {
        user_id: admin,
        kind: "retirement_request.submitted",
        room_id: null,
        message_id: null,
        target_id: created.id,
      },
    ]);
  });

  it("#128 C-177（U-2）: 同じ対象への申請中の申請があると、2件目は RetirementRequestConflictError（duplicate_pending）で、行・監査・通知は増えない", async () => {
    await create();
    const before = await retirementSnapshot();
    const error = await create({ now: RETIRE_LATER }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetirementRequestConflictError);
    expect(error).toMatchObject({ reason: "duplicate_pending" });
    expect(await retirementSnapshot()).toEqual(before);
  });

  it("#128 C-177（U-2）: 却下・取り下げ・完了の申請しかない対象には、新しい申請を作れる（一意は pending の間だけ）", async () => {
    await insertRetirementRequest({
      targetUserId: target,
      requestedBy: ownerA,
      departmentId: deptA.id,
      status: "rejected",
      decidedBy: admin,
    });
    await insertRetirementRequest({
      targetUserId: target,
      requestedBy: ownerA,
      departmentId: deptA.id,
      status: "withdrawn",
    });
    await create();
    const rows = await retirementRows();
    expect(rows.map((r) => r.status).sort()).toEqual([
      "pending",
      "rejected",
      "withdrawn",
    ]);
  });

  it("#128 C-177（U-2）: 同じ対象への申請を同時に2件送ると、片方だけが成功し、他方は RetirementRequestConflictError。申請・監査・通知は1件分", async () => {
    const results = await Promise.allSettled([create(), create()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(RetirementRequestConflictError);
    expect(await retirementRows()).toHaveLength(1);
    expect(await retirementAudits()).toHaveLength(1);
    expect(await retirementNotifications()).toHaveLength(1);
  });

  it.each<[string, () => Promise<unknown>]>([
    ["操作者がほかの部署のオーナー", () => create({ actorId: ownerB })],
    ["操作者がオーナーでない一般社員", () => create({ actorId: other })],
    [
      "操作者が全体管理者だが、その部署のオーナーではない",
      () => create({ actorId: admin }),
    ],
    ["対象が操作者本人", () => create({ targetUserId: ownerA })],
    ["対象がない", () => create({ targetUserId: MISSING_ID })],
    [
      "対象が渡した部署に所属していない（ほかの部署の社員）",
      () => create({ targetUserId: ownerB }),
    ],
  ])(
    "#128 0-1 AC-20: %sなら RetirementRequestStateChangedError で、申請・監査・通知が何も残らない",
    async (_label, run) => {
      const before = await retirementSnapshot();
      await expect(run()).rejects.toBeInstanceOf(
        RetirementRequestStateChangedError,
      );
      expect(await retirementSnapshot()).toEqual(before);
    },
  );

  it.each<[string, () => Promise<string>]>([
    [
      "部署のオーナー（ほかの部署のオーナーが、この部署に所属している）",
      async () => {
        await env.DB.prepare("UPDATE users SET department_id = ? WHERE id = ?")
          .bind(deptA.id, ownerB)
          .run();
        return ownerB;
      },
    ],
    [
      "全体管理者（その部署に所属）",
      async () => {
        await env.DB.prepare("UPDATE users SET department_id = ? WHERE id = ?")
          .bind(deptA.id, admin)
          .run();
        return admin;
      },
    ],
  ])(
    "#128 0-1 AC-20（0-1 AC-9）: 対象が%sなら RetirementRequestStateChangedError で、何も残らない",
    async (_label, prepare) => {
      const targetUserId = await prepare();
      const before = await retirementSnapshot();
      await expect(create({ targetUserId })).rejects.toBeInstanceOf(
        RetirementRequestStateChangedError,
      );
      expect(await retirementSnapshot()).toEqual(before);
    },
  );

  it.each<[string, () => Promise<void>]>([
    [
      "申請者が無効になった",
      async () => {
        await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
          .bind(ownerA)
          .run();
      },
    ],
    [
      "申請者のオーナーの割り当てが外れた（オーナーの交代）",
      async () => {
        await env.DB.prepare(
          "DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = ?",
        )
          .bind(ownerA, ROLE_IDS.owner)
          .run();
      },
    ],
    [
      "対象が無効になった",
      async () => {
        await env.DB.prepare(
          "UPDATE users SET is_active = 0, department_id = NULL WHERE id = ?",
        )
          .bind(target)
          .run();
      },
    ],
    [
      "対象がほかの部署へ異動した",
      async () => {
        await env.DB.prepare("UPDATE users SET department_id = ? WHERE id = ?")
          .bind(deptB.id, target)
          .run();
      },
    ],
    [
      "対象が部署のオーナーになった",
      async () => {
        // 部署のオーナーは1部署に1人のため、ほかの部署のオーナーの割り当てを対象に移す
        await env.DB.prepare(
          "UPDATE user_role_assignments SET user_id = ? WHERE user_id = ? AND role_id = ?",
        )
          .bind(target, ownerB, ROLE_IDS.owner)
          .run();
      },
    ],
  ])(
    "#128 0-1 AC-20: 判定の後で%s場合は、RetirementRequestStateChangedError で何も残らない",
    async (_label, change) => {
      await change();
      const before = await retirementSnapshot();
      await expect(create()).rejects.toBeInstanceOf(
        RetirementRequestStateChangedError,
      );
      expect(await retirementSnapshot()).toEqual(before);
    },
  );

  it("#128 0-1 AC-20: 想定の違反以外の DB エラー（通知の書き込みの失敗）は変換せずに伝え、申請・監査も残さない", async () => {
    await env.DB.exec(
      "CREATE TRIGGER unit_fail_128c_notification BEFORE INSERT ON notifications WHEN NEW.kind LIKE 'retirement_request.%' BEGIN SELECT RAISE(ABORT, 'unit_fail_128c_notification'); END",
    );
    const before = await retirementSnapshot();
    const error = await create().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RetirementRequestStateChangedError);
    expect(error).not.toBeInstanceOf(RetirementRequestConflictError);
    expect(await retirementSnapshot()).toEqual(before);
  });
});

describe("#128（128-c）C-177（U-1）表の制約（check）", () => {
  const rawInsert = (
    status: string,
    reason: string | null,
    decidedBy: string | null,
    decidedAt: string | null,
  ) =>
    env.DB.prepare(
      `INSERT INTO retirement_requests (id, target_user_id, requested_by, department_id, status, decision_reason,
         decided_by, decided_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        `01JTEST128CCHECK${String(Math.floor(Math.random() * 1e9)).padStart(10, "0")}`,
        target,
        ownerA,
        deptA.id,
        status,
        reason,
        decidedBy,
        decidedAt,
        RETIRE_NOW,
        RETIRE_NOW,
      )
      .run();

  // 表は収集の時点で評価されるため、決裁者は印（"admin"）で書き、テストの中で beforeEach の値に置き換える
  it.each<[string, string, string | null, "admin" | null, string | null]>([
    ["却下で理由がない", "rejected", null, "admin", RETIRE_NOW],
    ["決裁済みで日時がない", "approved", null, "admin", null],
    ["完了で決裁者がない", "approved", null, null, RETIRE_NOW],
    ["却下で決裁者がない", "rejected", REASON, null, RETIRE_NOW],
    ["定義にない状態", "returned", null, "admin", RETIRE_NOW],
  ])(
    "#128 C-177（U-1）: %sの行は入れられない（CHECK の違反）",
    async (_label, status, reason, decider, decidedAt) => {
      const decidedBy = decider === "admin" ? admin : null;
      await expect(
        rawInsert(status, reason, decidedBy, decidedAt),
      ).rejects.toThrow(/CHECK constraint failed/);
      expect(await retirementRows()).toEqual([]);
    },
  );

  it("#128 C-177（U-2）: 同じ対象の pending の行を直接2件入れようとすると、部分一意索引で拒否される", async () => {
    await rawInsert("pending", null, null, null);
    await expect(rawInsert("pending", null, null, null)).rejects.toThrow();
    expect(await retirementRows()).toHaveLength(1);
  });
});

describe("#128（128-c）C-177（U-1）却下（Repository・D1）", () => {
  let requestId: string;
  beforeEach(async () => {
    requestId = (await create()).id;
  });

  it("#128 C-177（U-1）・3-4 AC-2: 却下すると rejected・理由・決裁者・日時を記録し、申請者だけに rejected の通知、監査は1件で理由の文を含まない。対象は変わらない", async () => {
    const before = await retirementSnapshot();
    await reject(requestId);
    expect(await retirementRow(requestId)).toMatchObject({
      status: "rejected",
      decision_reason: REASON,
      decided_by: admin,
      decided_at: RETIRE_LATER,
    });
    const notifications = await retirementNotifications();
    expect(
      notifications.filter((n) => n.kind === "retirement_request.rejected"),
    ).toEqual([
      {
        user_id: ownerA,
        kind: "retirement_request.rejected",
        room_id: null,
        message_id: null,
        target_id: requestId,
      },
    ]);
    const audits = (await retirementAudits()).filter(
      (a) => a.action === "retirement_request.reject",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_id: admin, result: "success" });
    expect(JSON.stringify(audits)).not.toContain(REASON);
    expect(detailValueTypes(audits[0]?.detail ?? null)).not.toContain("object");
    const after = await retirementSnapshot();
    expect(after.users).toEqual(before.users);
    expect(after.assignments).toEqual(before.assignments);
  });

  it("#128 3-4 AC-2: 決裁者が申請者本人（全体管理者がその部署のオーナーを兼ねて申請した）なら、却下の通知は送らない", async () => {
    await withdraw(requestId);
    // 部署のオーナーは1部署に1人のため、交代してから全体管理者をオーナーにする
    await env.DB.prepare(
      "DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = ?",
    )
      .bind(ownerA, ROLE_IDS.owner)
      .run();
    await makeOwner(admin, deptA.id);
    const own = await create({ actorId: admin, reviewerIds: [] });
    await reject(own.id);
    expect(
      (await retirementNotifications()).filter(
        (n) => n.kind === "retirement_request.rejected",
      ),
    ).toEqual([]);
  });

  it.each<[string, () => Promise<void>, () => Promise<unknown>]>([
    [
      "申請が取り下げ済み",
      async () => {
        await withdraw(requestId);
      },
      () => reject(requestId),
    ],
    [
      "申請が却下済み",
      async () => {
        await reject(requestId);
      },
      () => reject(requestId, { reason: "[UNIT_TEST]2回目" }),
    ],
    [
      "操作者が全体管理者でない（オーナー）",
      async () => {},
      () => reject(requestId, { actorId: ownerA }),
    ],
    [
      "判定の後で操作者の全体管理者の割り当てが外れた",
      async () => {
        await env.DB.prepare(
          "DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = ?",
        )
          .bind(admin, ROLE_IDS.globalAdmin)
          .run();
      },
      () => reject(requestId),
    ],
    [
      "判定の後で操作者が無効になった",
      async () => {
        await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
          .bind(admin)
          .run();
      },
      () => reject(requestId),
    ],
    ["申請がない", async () => {}, () => reject(MISSING_ID)],
  ])(
    "#128 C-177（U-1）: %sなら RetirementRequestStateChangedError で何も変わらない",
    async (_label, prepare, run) => {
      await prepare();
      const before = await retirementSnapshot();
      await expect(run()).rejects.toBeInstanceOf(
        RetirementRequestStateChangedError,
      );
      expect(await retirementSnapshot()).toEqual(before);
    },
  );

  it("#128 C-177（U-1）: 却下と取り下げを同時に送ると片方だけが成功し、最後の状態は成功した側のもの。通知・監査は1件分", async () => {
    const results = await Promise.allSettled([
      reject(requestId),
      withdraw(requestId),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed?.reason).toBeInstanceOf(RetirementRequestStateChangedError);
    const row = await retirementRow(requestId);
    const decisions = (await retirementAudits()).filter(
      (a) => a.action !== "retirement_request.create",
    );
    expect(decisions).toHaveLength(1);
    if (row.status === "rejected") {
      expect(decisions[0]?.action).toBe("retirement_request.reject");
      expect(
        (await retirementNotifications()).filter(
          (n) => n.kind === "retirement_request.rejected",
        ),
      ).toHaveLength(1);
    } else {
      expect(row.status).toBe("withdrawn");
      expect(decisions[0]?.action).toBe("retirement_request.withdraw");
      expect(
        (await retirementNotifications()).filter(
          (n) => n.kind === "retirement_request.rejected",
        ),
      ).toEqual([]);
    }
  });
});

describe("#128（128-c）C-177（U-1）取り下げ（Repository・D1）", () => {
  let requestId: string;
  beforeEach(async () => {
    requestId = (await create()).id;
  });

  it("#128 C-177（U-1）: 申請者が取り下げると withdrawn・決裁者＝申請者・日時を記録し、監査は1件、通知は送らない", async () => {
    const notificationsBefore = await retirementNotifications();
    await withdraw(requestId);
    expect(await retirementRow(requestId)).toMatchObject({
      status: "withdrawn",
      decision_reason: null,
      decided_by: ownerA,
      decided_at: RETIRE_LATER,
    });
    expect(
      (await retirementAudits()).filter(
        (a) => a.action === "retirement_request.withdraw",
      ),
    ).toHaveLength(1);
    expect(await retirementNotifications()).toEqual(notificationsBefore);
  });

  it("#128 C-177（U-3）: 申請者がその部署のオーナーでなくなっていても、自分の申請は取り下げられる", async () => {
    await env.DB.prepare(
      "DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = ?",
    )
      .bind(ownerA, ROLE_IDS.owner)
      .run();
    await withdraw(requestId);
    expect((await retirementRow(requestId)).status).toBe("withdrawn");
  });

  it.each<[string, () => Promise<void>, () => Promise<unknown>]>([
    [
      "操作者が申請者でない（全体管理者でも）",
      async () => {},
      () => withdraw(requestId, { actorId: admin }),
    ],
    [
      "操作者が申請者でない（ほかの部署のオーナー）",
      async () => {},
      () => withdraw(requestId, { actorId: ownerB }),
    ],
    [
      "申請が取り下げ済み",
      async () => {
        await withdraw(requestId);
      },
      () => withdraw(requestId),
    ],
    [
      "申請が却下済み",
      async () => {
        await reject(requestId);
      },
      () => withdraw(requestId),
    ],
    [
      "判定の後で申請者が無効になった",
      async () => {
        await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
          .bind(ownerA)
          .run();
      },
      () => withdraw(requestId),
    ],
  ])(
    "#128 C-177（U-1）: %sなら RetirementRequestStateChangedError で何も変わらない",
    async (_label, prepare, run) => {
      await prepare();
      const before = await retirementSnapshot();
      await expect(run()).rejects.toBeInstanceOf(
        RetirementRequestStateChangedError,
      );
      expect(await retirementSnapshot()).toEqual(before);
    },
  );
});

/** エラーと、その原因の連鎖（cause）のメッセージをつなげた文字列（元のエラーが変換されずに伝わったかを確かめる） */
function messagesOf(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(" | ");
}

// 全体管理者は DB の制約で1人だけ（user_role_assignments の role_id の一意）。宛先の確認は、その1人との食い違いで確かめる
describe("#128（128-c）0-1 AC-20・3-4 AC-1 通知の宛先の確認（Repository・D1）", () => {
  it("#128 3-4 AC-1: 申請者以外に有効な全体管理者がいなければ、reviewerIds が空でも申請は作られ、通知は送らない", async () => {
    await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
      .bind(admin)
      .run();
    await create({ reviewerIds: [] });
    expect(await retirementRows()).toHaveLength(1);
    expect(await retirementNotifications()).toEqual([]);
  });

  it.each<[string, () => Promise<string[]>]>([
    [
      "宛先の全体管理者が無効になった",
      async () => {
        await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
          .bind(admin)
          .run();
        return [admin];
      },
    ],
    ["宛先が空だが、有効な全体管理者がいる", async () => []],
    ["宛先が、全体管理者でない社員だけ", async () => [other]],
    ["宛先に、全体管理者でない社員も入っている", async () => [admin, other]],
  ])(
    "#128 3-4 AC-1: %sなら RetirementRequestStateChangedError で、申請・監査・通知が何も残らない",
    async (_label, prepare) => {
      const reviewerIds = await prepare();
      const before = await retirementSnapshot();
      await expect(create({ reviewerIds })).rejects.toBeInstanceOf(
        RetirementRequestStateChangedError,
      );
      expect(await retirementSnapshot()).toEqual(before);
    },
  );
});

describe("#128（128-c）C-177（U-2）DB の違反の変換（Repository・D1）", () => {
  it("#128 C-177（U-2）: 同じ対象への2件目の Conflict は、元の DB エラー（一意制約の違反）を cause に持つ", async () => {
    await create();
    const error = await create({ now: RETIRE_LATER }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetirementRequestConflictError);
    expect(messagesOf((error as Error).cause)).toMatch(
      /UNIQUE constraint failed: retirement_requests\.target_user_id/,
    );
  });

  it("#128 0-1 AC-20: 前提の崩れの StateChanged は、元の DB エラー（NOT NULL 制約の違反）を cause に持つ", async () => {
    const error = await create({ actorId: other }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetirementRequestStateChangedError);
    expect(messagesOf((error as Error).cause)).toMatch(
      /NOT NULL constraint failed: users\.login_id/,
    );
  });

  it.each<[string, string]>([
    [
      "申請中の索引以外の一意制約の違反（通知のID）",
      "UNIQUE constraint failed: notifications.id",
    ],
    [
      "申請中の索引以外の一意制約の違反（社員ID）",
      "UNIQUE constraint failed: users.login_id",
    ],
    [
      "前提の確認の列以外の NOT NULL 違反（通知の宛先）",
      "NOT NULL constraint failed: notifications.user_id",
    ],
    [
      "前提の確認の列以外の NOT NULL 違反（申請の対象）",
      "NOT NULL constraint failed: retirement_requests.target_user_id",
    ],
    ["制約の違反でない失敗", "unit_fail_128c_plain"],
  ])(
    "#128 0-1 AC-20: %sは、重複・前提の崩れに変換せず、同じエラーのまま伝わり、何も残らない",
    async (_label, message) => {
      await env.DB.exec(
        `CREATE TRIGGER unit_fail_128c_notification BEFORE INSERT ON notifications WHEN NEW.kind LIKE 'retirement_request.%' BEGIN SELECT RAISE(ABORT, '${message}'); END`,
      );
      const before = await retirementSnapshot();
      const error = await create().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(RetirementRequestStateChangedError);
      expect(error).not.toBeInstanceOf(RetirementRequestConflictError);
      expect(messagesOf(error)).toContain(message);
      expect(await retirementSnapshot()).toEqual(before);
    },
  );
});

describe("#128（128-c）C-177 監査の記録（Repository・D1。docs/design/accounts.md の表）", () => {
  it("#128 C-177: 作成の監査は、対象の種類 retirement_request・対象 = 申請ID・detail は targetUserId と departmentId だけ", async () => {
    const created = await create();
    const [audit] = await retirementAudits();
    expect(audit).toMatchObject({
      actor_id: ownerA,
      action: "retirement_request.create",
      target_type: "retirement_request",
      target_id: created.id,
      result: "success",
    });
    expect(JSON.parse(audit?.detail ?? "{}")).toEqual({
      targetUserId: target,
      departmentId: deptA.id,
    });
  });

  it("#128 C-177: 却下の監査は、対象の種類 retirement_request・対象 = 申請ID・detail は requestedBy だけ（理由の文は入れない）", async () => {
    const { id } = await create();
    await reject(id);
    const audit = (await retirementAudits()).find(
      (a) => a.action === "retirement_request.reject",
    );
    expect(audit).toMatchObject({
      actor_id: admin,
      target_type: "retirement_request",
      target_id: id,
      result: "success",
    });
    expect(JSON.parse(audit?.detail ?? "{}")).toEqual({ requestedBy: ownerA });
  });

  it("#128 C-177: 取り下げの監査は、対象の種類 retirement_request・対象 = 申請ID・detail は requestedBy だけ", async () => {
    const { id } = await create();
    await withdraw(id);
    const audit = (await retirementAudits()).find(
      (a) => a.action === "retirement_request.withdraw",
    );
    expect(audit).toMatchObject({
      actor_id: ownerA,
      target_type: "retirement_request",
      target_id: id,
      result: "success",
    });
    expect(JSON.parse(audit?.detail ?? "{}")).toEqual({ requestedBy: ownerA });
  });
});
