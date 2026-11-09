// #196 AC-3（S-4 A・計画レビュー 3）: 既存の部署（初代部署）に、自動専用チャンネル2つと参加者を補うデータ移行の migration を確かめる。
// テストの前の migration は空の DB に流れるため、「既存の部署を補う」経路は通らない。そこで、名前に backfill_department_channels を含む
// migration の SQL 文を TEST_MIGRATIONS から取り出し、部署・社員を入れた状態で直接実行する。
// 前提（実装前。引き継ぎに明記）：
// - migration のファイル名に "backfill_department_channels" を含む（例：0009_backfill_department_channels.sql。journal に登録する）
// - 文だけで完結し、何度流しても同じ結果になる（自動チャンネルをすでに持つ部署は補わない）
// - 既存のチャンネル名（アーカイブ済みを含む・大小文字違い）と衝突する部署は補わず、ほかの部署の補完は続ける。
//   補わなかった部署は、監査ログに result='failure'・target_type='department'・target_id=部署ID で記録する（握りつぶさない）
// - 参加者は、その部署に所属する有効な社員だけ（全体管理者でも所属していなければ参加しない。S-8）
import { type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import {
  TEST_TAG,
  autoChannelsOf,
  cleanupDepartmentTestData,
  insertChannel,
  membersOf,
} from "../../test/department-fixtures";
import { insertDepartment, insertUser } from "../../test/role-fixtures";

const migrations = (env as typeof env & { TEST_MIGRATIONS: D1Migration[] })
  .TEST_MIGRATIONS;

function backfillMigration(): D1Migration {
  const found = migrations.filter((m) =>
    m.name.includes("backfill_department_channels"),
  );
  expect(found, "backfill_department_channels の migration").toHaveLength(1);
  const [migration] = found;
  if (!migration) throw new Error("migration がありません");
  return migration;
}

async function runBackfill() {
  const { queries } = backfillMigration();
  expect(queries.length).toBeGreaterThan(0);
  await env.DB.batch(queries.map((query) => env.DB.prepare(query)));
}

async function count(sql: string, ...binds: unknown[]) {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

afterEach(async () => {
  await env.DB.prepare(
    "DELETE FROM audit_logs WHERE target_id IN (SELECT id FROM departments WHERE name LIKE ?)",
  )
    .bind(`${TEST_TAG}%`)
    .run();
  await cleanupDepartmentTestData();
});

describe("#196 初代部署の専用チャンネルの補完（データ移行 migration）", () => {
  it("#196 AC-3（S-4 A）: migration は journal 順の最後の方にあり、空の DB では何も作らずに成功している", async () => {
    const names = migrations.map((m) => m.name);
    const index = names.findIndex((n) =>
      n.includes("backfill_department_channels"),
    );
    // channels を作る migration より後に流れる
    const tableIndex = migrations.findIndex((m) =>
      m.queries.some((q) => /CREATE TABLE [`"]?channels[`"]?/i.test(q)),
    );
    expect(tableIndex).toBeGreaterThanOrEqual(0);
    expect(index).toBeGreaterThan(tableIndex);
  });

  it("#196 AC-3（計画レビュー 3）: 部署が0件でも失敗せず、何も作らない", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM channels");
    await runBackfill();
    expect(await count("SELECT COUNT(*) AS n FROM channels")).toBe(before);
  });

  it("#196 AC-3（7-1 AC-1・AC-2・S-8）: 既存の部署に公開の通常・お知らせチャンネルとルームができ、所属する有効な社員だけが参加する", async () => {
    const dept = await insertDepartment("初代部署");
    const other = await insertDepartment("別の部署");
    const active = await insertUser("testuser_dept_bf_active", dept);
    const inactive = await insertUser("testuser_dept_bf_inactive", dept, {
      isActive: false,
    });
    const outsider = await insertUser("testuser_dept_bf_other", other);
    await runBackfill();
    const channels = await autoChannelsOf(dept);
    expect(
      channels.map((c) => ({
        purpose: c.purpose,
        name: c.name,
        name_normalized: c.name_normalized,
        description: c.description,
        visibility: c.visibility,
        deleted_at: c.deleted_at,
      })),
    ).toEqual([
      {
        purpose: "announcement",
        name: `${TEST_TAG}初代部署のお知らせ`,
        name_normalized: `${TEST_TAG}初代部署のお知らせ`.toLowerCase(),
        description: "",
        visibility: "public",
        deleted_at: null,
      },
      {
        purpose: "department",
        name: `${TEST_TAG}初代部署`,
        name_normalized: `${TEST_TAG}初代部署`.toLowerCase(),
        description: "",
        visibility: "public",
        deleted_at: null,
      },
    ]);
    for (const channel of channels) {
      expect(
        await count(
          "SELECT COUNT(*) AS n FROM rooms WHERE id = ? AND kind = 'channel'",
          channel.room_id,
        ),
      ).toBe(1);
      const members = await membersOf(channel.room_id);
      expect(members).toEqual([active]);
      expect(members).not.toContain(inactive);
      expect(members).not.toContain(outsider);
    }
    // 別の部署にも、その部署の社員だけで補われる
    const otherChannels = await autoChannelsOf(other);
    expect(otherChannels).toHaveLength(2);
    for (const channel of otherChannels)
      expect(await membersOf(channel.room_id)).toEqual([outsider]);
  });

  it("#196 AC-3（計画レビュー 3）: 2回流しても、チャンネル・ルーム・参加者が重複しない（べき等）", async () => {
    const dept = await insertDepartment("べき等");
    await insertUser("testuser_dept_bf_idem", dept);
    await runBackfill();
    const snapshot = async () => ({
      rooms: await count("SELECT COUNT(*) AS n FROM rooms"),
      channels: await count("SELECT COUNT(*) AS n FROM channels"),
      members: await count("SELECT COUNT(*) AS n FROM channel_members"),
    });
    const first = await snapshot();
    await runBackfill();
    expect(await snapshot()).toEqual(first);
    expect(await autoChannelsOf(dept)).toHaveLength(2);
  });

  it("#196 AC-3（計画レビュー 3）: すでに自動チャンネルを持つ部署（セットアップ・部署作成で作られたもの）には触れない", async () => {
    const dept = await insertDepartment("作成済み");
    const user = await insertUser("testuser_dept_bf_existing", dept);
    await runBackfill();
    const before = await autoChannelsOf(dept);
    // 参加を外しても、補完は作り直さない（自動チャンネルがある部署は対象外）
    await env.DB.prepare("DELETE FROM channel_members WHERE user_id = ?")
      .bind(user)
      .run();
    await runBackfill();
    expect(await autoChannelsOf(dept)).toEqual(before);
    for (const channel of before)
      expect(await membersOf(channel.room_id)).toEqual([]);
  });

  it("#196 AC-3（計画レビュー 3・前提）: 既存のチャンネル名（アーカイブ済み・大小文字違い）と衝突する部署は補わず、失敗を監査ログに記録し、ほかの部署は補う", async () => {
    await insertChannel({
      name: `${TEST_TAG}衝突部署のお知らせ`.toUpperCase(),
      purpose: "normal",
      departmentId: null,
      archived: true,
    });
    const conflicted = await insertDepartment("衝突部署");
    const fine = await insertDepartment("問題なし");
    await insertUser("testuser_dept_bf_conflict", conflicted);
    await runBackfill();
    // 衝突する部署は、通常・お知らせのどちらも作らない（片方だけにしない）
    expect(await autoChannelsOf(conflicted)).toEqual([]);
    expect(await autoChannelsOf(fine)).toHaveLength(2);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE target_type = 'department' AND target_id = ? AND result = 'failure'",
        conflicted,
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE target_id = ? AND result = 'failure'",
        fine,
      ),
    ).toBe(0);
  });
});
