// #128（128-c）0-1 AC-20・C-177（U-3）・3-4 AC-2: 128-a の無効化の batch に足す「退職処理の申請の完了」を、マイグレーション済みの D1 で確かめる。
// 契約（計画 5.3。実装前の仮置き）：
//   repository.deactivate（account.repository.ts）の batch に、
//     ・対象の pending の申請があれば、申請者へ retirement_request.approved（target_id＝申請ID）の通知を入れる文
//     ・UPDATE retirement_requests SET status='approved', decided_by=:actor, decided_at=:now WHERE target_user_id=:id AND status='pending'
//   を足す。監査 account.deactivate の detail に retirementRequestId（完了にした申請のID。なければ null）を足す（入れ子にしない）。
//   申請を通さない直接の無効化でも、pending の申請があれば完了にする。前提が崩れて batch 全体が取り消されたら、申請も通知も変わらない。
//   部署異動（transfer）・オーナーの交代では、申請を残す（U-3）。
// データは架空（testuser_128c_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  cleanupAuthTestData,
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
  cleanupRetirementRequestTestData,
  insertRetirementRequest,
  retirementNotifications,
  retirementRow,
  retirementSnapshot,
} from "../../test/retirement-request-fixtures";
import { ROLE_IDS } from "../lib/permissions";
import { AccountStateChangedError, withAccounts } from "./account.repository";

let deptA: SeededDepartment;
let deptB: SeededDepartment;
let admin: string;
let ownerA: string;
let target: string;
let bystander: string;

const trace = () => `${AUTH_TRACE_PREFIX}128c-${crypto.randomUUID()}`;

const deactivate = (
  overrides: Partial<{ targetId: string; actorId: string }> = {},
) =>
  withAccounts(env, (repository) =>
    repository.deactivate({
      targetId: target,
      actorId: admin,
      now: RETIRE_LATER,
      traceId: trace(),
      ...overrides,
    }),
  );

async function deactivateAuditDetail() {
  const row = await env.DB.prepare(
    "SELECT detail FROM audit_logs WHERE action = 'account.deactivate' AND target_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1",
  )
    .bind(target)
    .first<{ detail: string | null }>();
  return JSON.parse(row?.detail ?? "{}") as Record<string, unknown>;
}

beforeEach(async () => {
  deptA = await insertDepartmentWithChannels("128c無効化A");
  deptB = await insertDepartmentWithChannels("128c無効化B");
  admin = await insertUser("testuser_128c_d_admin", deptB.id);
  ownerA = await insertUser("testuser_128c_d_owner", deptA.id);
  target = await insertUser("testuser_128c_d_target", deptA.id);
  bystander = await insertUser("testuser_128c_d_other", deptA.id);
  await makeGlobalAdmin(admin);
  await makeOwner(ownerA, deptA.id);
  await joinDepartmentChannels(deptA, target);
});

afterEach(async () => {
  await cleanupRetirementRequestTestData();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#128（128-c）C-177（U-3）無効化で申請を完了にする", () => {
  it("#128 0-1 AC-20・C-177（U-3）: 対象の申請中の申請は approved・決裁者＝操作者・日時になり、申請者だけに approved の通知が1件届く", async () => {
    const requestId = await insertRetirementRequest({
      targetUserId: target,
      requestedBy: ownerA,
      departmentId: deptA.id,
    });
    await deactivate();
    expect(await retirementRow(requestId)).toMatchObject({
      status: "approved",
      decided_by: admin,
      decided_at: RETIRE_LATER,
      decision_reason: null,
    });
    expect(await retirementNotifications()).toEqual([
      {
        user_id: ownerA,
        kind: "retirement_request.approved",
        room_id: null,
        message_id: null,
        target_id: requestId,
      },
    ]);
  });

  it("#128 0-1 AC-20: 無効化の監査 detail に、元の部署と完了にした申請のIDが入り、入れ子にしない", async () => {
    const requestId = await insertRetirementRequest({
      targetUserId: target,
      requestedBy: ownerA,
      departmentId: deptA.id,
    });
    await deactivate();
    expect(await deactivateAuditDetail()).toEqual({
      fromDepartmentId: deptA.id,
      retirementRequestId: requestId,
    });
  });

  it("#128 C-177（U-3）: 申請がない直接の無効化では、通知を作らず、detail の申請のIDは null。決裁済みの過去の申請は変えない", async () => {
    const rejected = await insertRetirementRequest({
      targetUserId: target,
      requestedBy: ownerA,
      departmentId: deptA.id,
      status: "rejected",
      decidedBy: admin,
    });
    const before = await retirementRow(rejected);
    await deactivate();
    expect(await retirementRow(rejected)).toEqual(before);
    expect(await retirementNotifications()).toEqual([]);
    expect(await deactivateAuditDetail()).toEqual({
      fromDepartmentId: deptA.id,
      retirementRequestId: null,
    });
  });

  it("#128 C-177（U-3）: ほかの社員への申請中の申請は変えない", async () => {
    const otherRequest = await insertRetirementRequest({
      targetUserId: bystander,
      requestedBy: ownerA,
      departmentId: deptA.id,
    });
    await deactivate();
    expect((await retirementRow(otherRequest)).status).toBe("pending");
    expect(await retirementNotifications()).toEqual([]);
  });

  it.each<[string, () => Promise<void>, () => Promise<unknown>]>([
    [
      "操作者が全体管理者でない",
      async () => {},
      () => deactivate({ actorId: ownerA }),
    ],
    [
      "判定の後で対象が部署のオーナーになった",
      async () => {
        // 部署のオーナーは1部署に1人のため、オーナーの割り当てを対象に移す
        await env.DB.prepare(
          "UPDATE user_role_assignments SET user_id = ? WHERE user_id = ? AND role_id = ?",
        )
          .bind(target, ownerA, ROLE_IDS.owner)
          .run();
      },
      () => deactivate(),
    ],
    [
      "判定の後で操作者が無効になった",
      async () => {
        await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
          .bind(admin)
          .run();
      },
      () => deactivate(),
    ],
  ])(
    "#128 C-177（U-3）: 無効化の前提が崩れて%s場合は AccountStateChangedError で、申請は pending のまま・通知もない",
    async (_label, prepare, run) => {
      await insertRetirementRequest({
        targetUserId: target,
        requestedBy: ownerA,
        departmentId: deptA.id,
      });
      await prepare();
      const before = await retirementSnapshot();
      await expect(run()).rejects.toBeInstanceOf(AccountStateChangedError);
      expect(await retirementSnapshot()).toEqual(before);
    },
  );

  it("#128 C-177（U-3）: 部署異動では、申請を pending のまま残し、通知もしない", async () => {
    const requestId = await insertRetirementRequest({
      targetUserId: target,
      requestedBy: ownerA,
      departmentId: deptA.id,
    });
    await withAccounts(env, (repository) =>
      repository.transfer({
        targetId: target,
        fromDepartmentId: deptA.id,
        toDepartmentId: deptB.id,
        actorId: admin,
        now: RETIRE_LATER,
        traceId: trace(),
      }),
    );
    expect(await retirementRow(requestId)).toMatchObject({
      status: "pending",
      department_id: deptA.id,
      decided_by: null,
    });
    expect(await retirementNotifications()).toEqual([]);
  });

  it("#128 C-177（U-3）: 異動・オーナーの交代の後に直接無効化しても、残っていた申請は完了になり、元の申請者に通知が届く", async () => {
    const requestId = await insertRetirementRequest({
      targetUserId: target,
      requestedBy: ownerA,
      departmentId: deptA.id,
    });
    await env.DB.prepare(
      "DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = ?",
    )
      .bind(ownerA, ROLE_IDS.owner)
      .run();
    await deactivate();
    expect((await retirementRow(requestId)).status).toBe("approved");
    expect(
      (await retirementNotifications()).map((n) => [n.user_id, n.kind]),
    ).toEqual([[ownerA, "retirement_request.approved"]]);
  });
});
