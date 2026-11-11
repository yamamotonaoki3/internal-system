// #130 AC-1（0-4 AC-1・AC-4・AC-6・AC-9・AC-10）：プロフィールの Repository（db/profile.repository.ts）を隔離 D1 で直接呼び、
// 「渡した項目だけを変える」「ステータスに触れたときだけ更新の時刻・更新者を残す」「部署なしは null」「行がないとき」を確かめる。
// 在席の行に戻り予定だけを書く更新は、競合（読んだ後に在席へ戻された）を防ぐため 0 行になり null を返す（コードレビューの指摘）。
// 期待値は計画 1章（DB・API）から決める。データは架空（testuser_prof_rw_・テスト太郎・@example.com・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTH_TRACE_PREFIX } from "../../test/auth-fixtures";
import {
  cleanupRoleTestData,
  insertDepartment,
  insertUser,
  testId,
} from "../../test/role-fixtures";
import { createProfileRepository } from "./profile.repository";
import { withDatabase } from "./database";

const NOW = "2026-11-11T00:00:00.000Z";
const LATER = "2026-11-11T05:00:00.000Z";
const TRACE = `${AUTH_TRACE_PREFIX}prof-rw-${crypto.randomUUID()}`;

let deptId: string;
let userId: string;

const repo = <T>(
  run: (r: ReturnType<typeof createProfileRepository>) => Promise<T>,
) => withDatabase(env, (db) => run(createProfileRepository(db)));

async function row(id: string) {
  return env.DB.prepare(
    "SELECT display_name, status_kind, status_return_at, status_message, status_updated_at, status_updated_by FROM users WHERE id = ?",
  )
    .bind(id)
    .first<Record<string, string | null>>();
}

async function audits() {
  const { results } = await env.DB.prepare(
    "SELECT action, actor_id, target_id FROM audit_logs WHERE trace_id = ?",
  )
    .bind(TRACE)
    .all();
  return results;
}

async function setStatus(id: string, kind: string, returnAt: string | null) {
  await env.DB.prepare(
    "UPDATE users SET status_kind = ?, status_return_at = ?, status_message = 'テスト元の一言' WHERE id = ?",
  )
    .bind(kind, returnAt, id)
    .run();
}

const write = () => ({ actorId: userId, traceId: TRACE });

beforeEach(async () => {
  deptId = await insertDepartment("プロフRW営業");
  userId = await insertUser("testuser_prof_rw_self", deptId);
});

afterEach(async () => {
  await env.DB.prepare("DELETE FROM audit_logs WHERE trace_id = ?")
    .bind(TRACE)
    .run();
  await env.DB.prepare(
    "UPDATE users SET status_updated_by = NULL WHERE login_id LIKE 'testuser!_prof!_rw!_%' ESCAPE '!'",
  ).run();
  await cleanupRoleTestData();
});

describe("#130 updateOwnProfile：渡した項目だけを変える", () => {
  it("#130 AC-1（0-4 AC-9）: 表示名だけなら、ステータスの列と更新の時刻・更新者は変えず、監査を1件残す", async () => {
    await setStatus(userId, "away", LATER);
    const result = await repo((r) =>
      r.updateOwnProfile(userId, { displayName: "テスト改名" }, write(), NOW),
    );
    expect(result).toEqual({
      displayName: "テスト改名",
      status: "away",
      returnAt: LATER,
      statusMessage: "テスト元の一言",
      updatedAt: NOW,
    });
    expect(await row(userId)).toEqual({
      display_name: "テスト改名",
      status_kind: "away",
      status_return_at: LATER,
      status_message: "テスト元の一言",
      status_updated_at: null,
      status_updated_by: null,
    });
    expect(await audits()).toEqual([
      {
        action: "profile.display_name_change",
        actor_id: userId,
        target_id: userId,
      },
    ]);
  });

  it("#130 AC-1（0-4 AC-3・P-2）: 一言だけなら、表示名・種類・戻り予定は変えず、更新の時刻・更新者（本人）を残し、監査は残さない", async () => {
    await setStatus(userId, "away", LATER);
    const result = await repo((r) =>
      r.updateOwnProfile(
        userId,
        { statusMessage: "テスト新しい一言" },
        write(),
        NOW,
      ),
    );
    expect(result?.statusMessage).toBe("テスト新しい一言");
    expect(await row(userId)).toEqual({
      display_name: "テスト太郎",
      status_kind: "away",
      status_return_at: LATER,
      status_message: "テスト新しい一言",
      status_updated_at: NOW,
      status_updated_by: userId,
    });
    expect(await audits()).toEqual([]);
  });

  it("#130 AC-1（0-4 AC-3）: 一言に null を渡すと消える", async () => {
    await setStatus(userId, "away", LATER);
    await repo((r) =>
      r.updateOwnProfile(userId, { statusMessage: null }, write(), NOW),
    );
    expect((await row(userId))?.status_message).toBeNull();
  });

  it("#130 AC-2（6-1 AC-3）: 種類だけなら、戻り予定・一言・表示名は変えない", async () => {
    await setStatus(userId, "away", LATER);
    await repo((r) =>
      r.updateOwnProfile(userId, { statusKind: "meeting" }, write(), NOW),
    );
    expect(await row(userId)).toMatchObject({
      display_name: "テスト太郎",
      status_kind: "meeting",
      status_return_at: LATER,
      status_message: "テスト元の一言",
      status_updated_at: NOW,
      status_updated_by: userId,
    });
  });

  it("#130 AC-1（0-4 AC-4）: 種類と戻り予定 null を渡すと、戻り予定が消える", async () => {
    await setStatus(userId, "away", LATER);
    await repo((r) =>
      r.updateOwnProfile(
        userId,
        { statusKind: "available", statusReturnAt: null },
        write(),
        NOW,
      ),
    );
    expect(await row(userId)).toMatchObject({
      status_kind: "available",
      status_return_at: null,
    });
  });

  it("#130 AC-1（0-4 AC-4）: 在席でない行に戻り予定だけを渡すと、戻り予定だけが変わる", async () => {
    await setStatus(userId, "away", LATER);
    const next = "2026-11-11T07:00:00.000Z";
    const result = await repo((r) =>
      r.updateOwnProfile(
        userId,
        { statusReturnAt: next, onlyIfNotAvailable: true },
        write(),
        NOW,
      ),
    );
    expect(result).toMatchObject({ status: "away", returnAt: next });
    expect(await row(userId)).toMatchObject({
      status_kind: "away",
      status_return_at: next,
      status_message: "テスト元の一言",
      status_updated_at: NOW,
    });
  });

  it("#130 AC-1（0-4 AC-4・P-3・競合）: 在席の行に戻り予定だけを渡すと 0 行で null を返し、何も変えない", async () => {
    const before = await row(userId);
    const result = await repo((r) =>
      r.updateOwnProfile(
        userId,
        { statusReturnAt: LATER, onlyIfNotAvailable: true },
        write(),
        NOW,
      ),
    );
    expect(result).toBeNull();
    expect(await row(userId)).toEqual(before);
  });
});

describe("#130 updateOwnProfile：条件と行がないとき", () => {
  it("#130 AC-1（0-4 AC-4）: 条件（onlyIfNotAvailable）を付けなければ、在席の行でも種類と一緒に戻り予定を書ける", async () => {
    const result = await repo((r) =>
      r.updateOwnProfile(
        userId,
        { statusKind: "away", statusReturnAt: LATER },
        write(),
        NOW,
      ),
    );
    expect(result).toMatchObject({ status: "away", returnAt: LATER });
  });

  it("#130 AC-1: 対象の行がなければ例外にする（成功に見える値を返さない）", async () => {
    await expect(
      repo((r) =>
        r.updateOwnProfile(
          testId("NOUSER"),
          { statusMessage: "テスト一言" },
          write(),
          NOW,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("#130 読み込み", () => {
  it("#130 AC-1（0-4 AC-11）: findOwnProfile は部署を {id,name} で返し、所属なしは null、不在は null", async () => {
    const own = await repo((r) => r.findOwnProfile(userId));
    expect(own?.department).toEqual({
      id: deptId,
      name: "[UNIT_TEST]プロフRW営業",
    });
    expect(own?.status).toEqual({
      kind: "available",
      returnAt: null,
      message: null,
    });
    await env.DB.prepare("UPDATE users SET department_id = NULL WHERE id = ?")
      .bind(userId)
      .run();
    expect(
      (await repo((r) => r.findOwnProfile(userId)))?.department,
    ).toBeNull();
    expect(await repo((r) => r.findOwnProfile(testId("NOUSER")))).toBeNull();
  });

  it("#130 AC-1（0-4 AC-10）: findProfileCard は部署・有効かどうかを返し、所属なしは null、不在は null", async () => {
    const card = await repo((r) => r.findProfileCard(userId));
    expect(card).toMatchObject({
      id: userId,
      isActive: true,
      department: { id: deptId, name: "[UNIT_TEST]プロフRW営業" },
    });
    await env.DB.prepare(
      "UPDATE users SET department_id = NULL, is_active = 0 WHERE id = ?",
    )
      .bind(userId)
      .run();
    expect(await repo((r) => r.findProfileCard(userId))).toMatchObject({
      isActive: false,
      department: null,
    });
    expect(await repo((r) => r.findProfileCard(testId("NOUSER")))).toBeNull();
  });

  it("#130 AC-1（0-4 AC-5）: findStatusTarget は不在なら null", async () => {
    expect(await repo((r) => r.findStatusTarget(testId("NOUSER")))).toBeNull();
    expect(await repo((r) => r.findStatusTarget(userId))).toEqual({
      id: userId,
      isActive: true,
      departmentId: deptId,
    });
  });
});

describe("#130 setStatusByProxy", () => {
  it("#130 AC-1（0-4 AC-6）: 更新した値と updatedAt（渡した時刻）を返し、一言は変えない", async () => {
    await setStatus(userId, "available", null);
    const result = await repo((r) =>
      r.setStatusByProxy(
        { userId, departmentId: deptId },
        { statusKind: "away", statusReturnAt: LATER },
        write(),
        NOW,
      ),
    );
    expect(result).toEqual({
      userId,
      status: "away",
      returnAt: LATER,
      updatedAt: NOW,
    });
    expect((await row(userId))?.status_message).toBe("テスト元の一言");
  });

  it("#130 AC-1（0-4 AC-6）: 対象の行がなければ例外にする（成功に見える値を返さない）", async () => {
    await expect(
      repo((r) =>
        r.setStatusByProxy(
          { userId: testId("NOUSER"), departmentId: deptId },
          { statusKind: "away", statusReturnAt: null },
          write(),
          NOW,
        ),
      ),
    ).rejects.toThrow();
  });
});
