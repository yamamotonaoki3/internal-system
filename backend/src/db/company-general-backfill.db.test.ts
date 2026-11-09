// #200 AC-1（2-1 AC-16・17、0-1 AC-15）: 全社連絡の初期データ（0010 の一意インデックス・0011 の手作成 migration）を確かめる。
// テストの前の migration は空の DB に流れるため、「既存の社員に全社連絡を補う」経路は通らない。
// そこで、0011 の文を TEST_MIGRATIONS から取り出し、全社連絡を取り除いた状態（= 0009 までの状態）に社員を入れてから直接実行する。
// 前提（実装前。引き継ぎに明記）：
// - 0010 は名前に add_company_general_unique を含み、channels_company_general_unique（purpose の部分一意。company_general の行だけ）を作る
// - 0011 は名前に seed_company_general_channel を含み、文だけで完結してべき等。journal 順で 0010 の直後（最後）
// - ルームIDは channel-rules.ts の COMPANY_GENERAL_ROOM_ID（ULID 形式の固定値）と一致する
import { type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BACKFILL_ACTION,
  COMPANY_GENERAL_MIGRATION_KEY,
  COMPANY_GENERAL_UNIQUE_MIGRATION_KEY,
  backfillAudits,
  companyGeneralMembers,
  companyGeneralRows,
  removeCompanyGeneral,
  restoreCompanyGeneral,
  runCompanyGeneralMigration,
} from "../../test/company-general-fixtures";
import {
  TEST_TAG,
  cleanupDepartmentTestData,
  insertChannel,
} from "../../test/department-fixtures";
import { insertDepartment, insertUser } from "../../test/role-fixtures";
import {
  COMPANY_GENERAL_CHANNEL_NAME,
  COMPANY_GENERAL_ROOM_ID,
} from "../lib/channel-rules";
import { isUlid } from "../lib/ulid";

const migrations = (env as typeof env & { TEST_MIGRATIONS: D1Migration[] })
  .TEST_MIGRATIONS;

async function count(sql: string, ...binds: unknown[]) {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 名前の衝突を作るために入れたチャンネルのルーム。afterEach で消す */
let conflictRoomIds: string[] = [];

beforeEach(async () => {
  conflictRoomIds = [];
  // 0009 までの状態（全社連絡がない）にする
  await removeCompanyGeneral();
});

afterEach(async () => {
  await cleanupDepartmentTestData();
  for (const id of conflictRoomIds) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM channel_members WHERE channel_id = ?").bind(
        id,
      ),
      env.DB.prepare("DELETE FROM channels WHERE room_id = ?").bind(id),
      env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(id),
    ]);
  }
  await restoreCompanyGeneral();
});

describe("#200 AC-1 全社連絡の補完（0010・0011）", () => {
  it("#200 AC-1（2-1 AC-16）: 0011 は journal の順で、channels を作る migration と 0010（一意インデックス）の後にあり、最後の migration である", () => {
    const names = migrations.map((m) => m.name);
    const seed = names.findIndex((n) =>
      n.includes(COMPANY_GENERAL_MIGRATION_KEY),
    );
    const unique = names.findIndex((n) =>
      n.includes(COMPANY_GENERAL_UNIQUE_MIGRATION_KEY),
    );
    const table = migrations.findIndex((m) =>
      m.queries.some((q) => /CREATE TABLE [`"]?channels[`"]?/i.test(q)),
    );
    expect(table).toBeGreaterThanOrEqual(0);
    expect(unique).toBeGreaterThan(table);
    expect(seed).toBe(unique + 1);
    expect(names).toHaveLength(seed + 1);
  });

  it("#200 AC-1（Q-3）: 0010 は channels_company_general_unique を作る（DDL だけで、データを書き換えない）", () => {
    const unique = migrations.find((m) =>
      m.name.includes(COMPANY_GENERAL_UNIQUE_MIGRATION_KEY),
    );
    expect(unique).toBeDefined();
    const sql = (unique?.queries ?? []).join("\n");
    expect(sql).toMatch(/channels_company_general_unique/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it("#200 AC-1: 固定のルームIDは ULID の形式で、定数の名前は「全社連絡」", () => {
    expect(isUlid(COMPANY_GENERAL_ROOM_ID)).toBe(true);
    expect(COMPANY_GENERAL_CHANNEL_NAME).toBe("全社連絡");
  });

  it("#200 AC-1（2-1 AC-17）: 有効2名・無効1名がいる状態で流すと、全社連絡が1件でき、有効な2名だけが参加する。列の値は0009と同じ組み立て", async () => {
    const dept = await insertDepartment("全社連絡補完");
    const active1 = await insertUser("testuser_cg_active1", dept);
    const active2 = await insertUser("testuser_cg_active2", dept);
    const inactive = await insertUser("testuser_cg_inactive", dept, {
      isActive: false,
    });
    await runCompanyGeneralMigration();

    expect(await companyGeneralRows()).toEqual([
      {
        room_id: COMPANY_GENERAL_ROOM_ID,
        department_id: null,
        name: "全社連絡",
        name_normalized: "全社連絡",
        description: "",
        visibility: "public",
        purpose: "company_general",
        deleted_at: null,
      },
    ]);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM rooms WHERE id = ? AND kind = 'channel'",
        COMPANY_GENERAL_ROOM_ID,
      ),
    ).toBe(1);
    const members = await companyGeneralMembers();
    expect(members).toContain(active1);
    expect(members).toContain(active2);
    expect(members).not.toContain(inactive);
    // 全社連絡の参加者は、有効な社員の全員だけ
    expect(members.length).toBe(
      await count("SELECT COUNT(*) AS n FROM users WHERE is_active = 1"),
    );
    // joined_at は既定値（ISO 8601 の UTC）が入る
    const joined = await env.DB.prepare(
      "SELECT joined_at FROM channel_members WHERE channel_id = ? AND user_id = ?",
    )
      .bind(COMPANY_GENERAL_ROOM_ID, active1)
      .first<{ joined_at: string }>();
    expect(joined?.joined_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // 成功のときは、補完の失敗の監査ログを書かない
    expect(await backfillAudits()).toEqual([]);
  });

  it("#200 AC-1: 2回流しても、チャンネル・ルーム・参加者・監査が増えない（べき等）。後から増えた有効な社員は、2回目で参加する", async () => {
    const dept = await insertDepartment("べき等");
    const first = await insertUser("testuser_cg_idem1", dept);
    await runCompanyGeneralMigration();
    const snapshot = async () => ({
      rooms: await count("SELECT COUNT(*) AS n FROM rooms"),
      channels: await count("SELECT COUNT(*) AS n FROM channels"),
      members: await companyGeneralMembers(),
      audits: (await backfillAudits()).length,
    });
    const before = await snapshot();
    await runCompanyGeneralMigration();
    expect(await snapshot()).toEqual(before);

    const second = await insertUser("testuser_cg_idem2", dept);
    await runCompanyGeneralMigration();
    const after = await snapshot();
    expect(after.channels).toBe(before.channels);
    expect(after.rooms).toBe(before.rooms);
    expect(after.members).toContain(first);
    expect(after.members).toContain(second);
    expect(after.members.length).toBe(before.members.length + 1);
  });

  it("#200 AC-1（Q-1）: 社員がいない新規の DB でも全社連絡は1件でき、参加者は0名（セットアップのときに最初の管理者が参加する）", async () => {
    expect(
      await count("SELECT COUNT(*) AS n FROM users WHERE is_active = 1"),
    ).toBe(0);
    await runCompanyGeneralMigration();
    expect(await companyGeneralRows()).toHaveLength(1);
    expect(await companyGeneralMembers()).toEqual([]);
  });

  it("#200 AC-1（Q-4）: 「全社連絡」の名前（アーカイブ済み）が既存のチャンネルと衝突すると、作らず、failure を1件だけ記録する。再実行しても1件", async () => {
    const dept = await insertDepartment("衝突");
    const user = await insertUser("testuser_cg_conflict", dept);
    conflictRoomIds.push(
      await insertChannel({
        name: "全社連絡",
        purpose: "normal",
        departmentId: null,
        archived: true,
      }),
    );
    await runCompanyGeneralMigration();
    expect(await companyGeneralRows()).toEqual([]);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM channel_members WHERE user_id = ?",
        user,
      ),
    ).toBe(0);
    const audits = await backfillAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: BACKFILL_ACTION,
      target_type: "channel",
      result: "failure",
    });
    expect(JSON.parse(audits[0]?.detail ?? "{}")).toEqual({
      reason: "channel_name_conflict",
    });

    await runCompanyGeneralMigration();
    expect(await backfillAudits()).toHaveLength(1);
    expect(await companyGeneralRows()).toEqual([]);
  });

  it("#200 AC-1（Q-3）: 2件目の全社連絡は、一意インデックスで拒否される（件数は変わらない）", async () => {
    await runCompanyGeneralMigration();
    const before = await count("SELECT COUNT(*) AS n FROM channels");
    await expect(
      insertChannel({
        name: `${TEST_TAG}二つ目の全社連絡`,
        purpose: "company_general",
        departmentId: null,
      }),
    ).rejects.toThrow();
    expect(await count("SELECT COUNT(*) AS n FROM channels")).toBe(before);
    expect(await companyGeneralRows()).toHaveLength(1);
  });

  it("#200 AC-1: 全社連絡以外のチャンネルの参加者には触れない", async () => {
    const dept = await insertDepartment("無関係");
    const user = await insertUser("testuser_cg_other", dept);
    const other = await insertChannel({
      name: `${TEST_TAG}無関係な通常チャンネル`,
      purpose: "normal",
      departmentId: null,
    });
    await runCompanyGeneralMigration();
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM channel_members WHERE channel_id = ?",
        other,
      ),
    ).toBe(0);
    expect(await companyGeneralMembers()).toContain(user);
  });
});
