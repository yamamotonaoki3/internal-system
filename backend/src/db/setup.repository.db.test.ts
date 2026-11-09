// #200 AC-1: 初回セットアップの Repository（setup.repository.ts）を、マイグレーション済みの D1 で確かめる。
// 競合（一意制約違反）を SetupConflictError に変換する規則（列 → 理由、名前、文言、原因）と、監査ログの記録先を確かめる。
// データは架空（testuser_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import { cleanupAuthTestData } from "../../test/auth-fixtures";
import { TEST_TAG, countRows, testId } from "../../test/role-fixtures";
import {
  SetupConflictError,
  createSetupRepository,
  type InitialAdminInput,
} from "./setup.repository";

const SETUP_ACTION = "setup.initial_admin.create";
const DUMMY_HASH =
  "$scrypt$ln=16,r=8,p=2$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";
const DUMMY_LEGAL = "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAA";
const NOW = "2026-11-09T00:00:00.000Z";

function input(): InitialAdminInput {
  return {
    userId: testId("SETU"),
    departmentId: testId("SDEP"),
    companyName: `${TEST_TAG}テスト株式会社`,
    departmentName: `${TEST_TAG}セットアップ部`,
    loginId: "testuser_setup_001",
    displayName: "テスト太郎",
    legalNameEncrypted: DUMMY_LEGAL,
    email: "testuser_setup_001@example.com",
    extension: null,
    jobTitle: null,
    passwordHash: DUMMY_HASH,
    now: NOW,
    traceId: `unit-auth-${crypto.randomUUID()}`,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  const testUsers = `SELECT id FROM users WHERE department_id IN (SELECT id FROM departments WHERE name LIKE '${TEST_TAG}%')`;
  const testChannels = `SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE name LIKE '${TEST_TAG}%')`;
  const { results: testRooms } = await env.DB.prepare(testChannels).all<{
    room_id: string;
  }>();
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM channel_members WHERE channel_id IN (${testChannels}) OR user_id IN (${testUsers})`,
    ),
    env.DB.prepare(`DELETE FROM channels WHERE room_id IN (${testChannels})`),
    ...testRooms.map((room) =>
      env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(room.room_id),
    ),
  ]);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM audit_logs WHERE action = ?").bind(
      SETUP_ACTION,
    ),
    env.DB.prepare(
      `DELETE FROM user_role_assignments WHERE user_id IN (${testUsers})`,
    ),
    env.DB.prepare(`DELETE FROM users WHERE id IN (${testUsers})`),
    env.DB.prepare("DELETE FROM departments WHERE name LIKE ?").bind(
      `${TEST_TAG}%`,
    ),
    env.DB.prepare(
      "DELETE FROM company_settings WHERE company_name LIKE ?",
    ).bind(`${TEST_TAG}%`),
  ]);
  await cleanupAuthTestData();
  expect(await countRows("users")).toBe(0);
});

describe("#200 AC-1 セットアップの Repository", () => {
  it("#200 AC-1: 成功すると、監査ログ setup.initial_admin.create を、対象の種類 user・対象ID＝最初の管理者で1件記録する", async () => {
    const value = input();
    await createSetupRepository(drizzle(env.DB, { schema })).createInitialAdmin(
      value,
    );
    const audit = await env.DB.prepare(
      "SELECT actor_id, target_type, target_id, result FROM audit_logs WHERE action = ?",
    )
      .bind(SETUP_ACTION)
      .all<Record<string, string>>();
    expect(audit.results).toEqual([
      {
        actor_id: value.userId,
        target_type: "user",
        target_id: value.userId,
        result: "success",
      },
    ]);
  });

  it.each([
    ["company_settings.id", "already_completed"],
    ["user_role_assignments.role_id", "already_completed"],
    ["users.login_id_normalized", "login_id"],
    ["users.email_normalized", "email"],
    ["departments.name_normalized", "department_name"],
  ])(
    "#200 AC-1: 一意制約 %s の違反は、理由 %s の SetupConflictError（名前・文言・原因つき）に変換する",
    async (column, reason) => {
      const db = drizzle(env.DB, { schema });
      const cause = new Error(`UNIQUE constraint failed: ${column}`);
      // 外側のエラーに包まれていても（cause をたどって）見つける
      const wrapped = new Error("D1_ERROR: failed", { cause });
      vi.spyOn(db, "batch").mockRejectedValue(wrapped);
      const error = await createSetupRepository(db)
        .createInitialAdmin(input())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SetupConflictError);
      const conflict = error as SetupConflictError;
      expect(conflict.reason).toBe(reason);
      expect(conflict.name).toBe("SetupConflictError");
      expect(conflict.message).toBe(
        "セットアップの内容が、すでにあるデータと競合しました",
      );
      expect(conflict.cause).toBe(wrapped);
    },
  );

  it("#200 AC-1: 対象外の列の一意制約違反・制約違反でないエラーは、変換せず元のエラーのまま投げる", async () => {
    for (const message of [
      "UNIQUE constraint failed: users.id",
      "NOT NULL constraint failed: users.display_name",
      "D1_ERROR: 別のエラー",
    ]) {
      const db = drizzle(env.DB, { schema });
      const original = new Error(message);
      vi.spyOn(db, "batch").mockRejectedValue(original);
      const error = await createSetupRepository(db)
        .createInitialAdmin(input())
        .catch((e: unknown) => e);
      expect(error).toBe(original);
      vi.restoreAllMocks();
    }
  });
});
