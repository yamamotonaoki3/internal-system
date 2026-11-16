// #128（128-a）コードレビュー1回目の重大1：公開チャンネルへの参加の書き込みは、本人が今も有効であることを条件にする。
// 参加の確認（Service）の後、書き込みの前に無効化が確定した競合を、無効にした状態から Repository を直接呼んで再現する。
// データは架空（testuser_128_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  cleanupAuthTestData,
} from "../../test/auth-fixtures";
import {
  TEST_TAG,
  cleanupDepartmentTestData,
  insertChannel,
  insertDepartmentWithChannels,
  membersOf,
} from "../../test/department-fixtures";
import { insertUser } from "../../test/role-fixtures";
import { withChannels } from "./channel.repository";

let roomId: string;
let userId: string;

async function joinAuditCount() {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'channel.join' AND target_id = ?",
  )
    .bind(roomId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  const dept = await insertDepartmentWithChannels("128参加競合");
  roomId = await insertChannel({
    name: `${TEST_TAG}128公開`,
    purpose: "normal",
    departmentId: dept.id,
  });
  userId = await insertUser("testuser_128_joiner", dept.id);
});

afterEach(async () => {
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#128 AC-9: 無効な社員の参加（Repository・D1）", () => {
  it("#128 AC-9: 確認の後に本人が無効化されていたら、参加の行も成功の監査も作らず null を返す", async () => {
    await env.DB.prepare(
      "UPDATE users SET is_active = 0, deactivated_at = ?, department_id = NULL WHERE id = ?",
    )
      .bind("2026-11-17T00:00:00.000Z", userId)
      .run();
    const result = await withChannels(env, (repository) =>
      repository.join({
        roomId,
        userId,
        traceId: `${AUTH_TRACE_PREFIX}128-${crypto.randomUUID()}`,
      }),
    );
    expect(result).toBeNull();
    expect(await membersOf(roomId)).toEqual([]);
    expect(await joinAuditCount()).toBe(0);
  });

  it("#128 AC-9: 有効な社員は従来どおり参加できる（条件の追加で有効な社員を拒否しない）", async () => {
    const result = await withChannels(env, (repository) =>
      repository.join({
        roomId,
        userId,
        traceId: `${AUTH_TRACE_PREFIX}128-${crypto.randomUUID()}`,
      }),
    );
    expect(result).not.toBeNull();
    expect(await membersOf(roomId)).toEqual([userId]);
    expect(await joinAuditCount()).toBe(1);
  });
});
