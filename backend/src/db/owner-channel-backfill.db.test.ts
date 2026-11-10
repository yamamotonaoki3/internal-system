// #206 AC-5: 既存データの補完。部署のオーナーを兼ねる全体管理者で、その部署の専用チャンネル（department・announcement）に
// 未参加の人を参加させる、べき等な補完 SQL を、実際のマイグレーション済み D1 で確かめる。
// 補完 SQL は migration にしない運用の手順（利用者の承認後に手で流す）。本番への適用はこのテストの範囲外。
// 契約（実装前の前提）：
// - SQL は backend/db/scripts/backfill-owner-channel-members.sql の 1 ファイル。`--` で始まる行（コメント）を除くと、INSERT 1 文だけ
// - 何度流しても同じ結果になる（参加済みの行は増やさず、joined_at も変えない）
// - 対象：有効な利用者（users.is_active = 1）で、部署のオーナーのロールと全体管理者のロールを持ち、
//   その部署の purpose が department / announcement で、アーカイブされていない（deleted_at が NULL の）チャンネルに未参加のもの。
//   アーカイブ済みを除く理由：アカウント発行時の自動参加（#200 Q-10）がアーカイブ済みの専用チャンネルに参加させないのと同じ扱いにそろえる。
//   利用者に deleted_at 列はなく、「有効」は is_active（作成・交代の batch の前提確認と同じ）で判定する
// 全体管理者は会社に1人だけ（user_role_assignments_global_admin_unique）のため、テストごとに全体管理者は1人にする。
// データは架空のもの（testuser_dept_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import backfillSql from "../../db/scripts/backfill-owner-channel-members.sql?raw";
import {
  TEST_TAG,
  cleanupDepartmentTestData,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  makeGlobalAdmin,
  makeOwner,
} from "../../test/department-fixtures";
import { insertDepartment, insertUser } from "../../test/role-fixtures";

const OLD_JOINED_AT = "2026-01-01T00:00:00.000Z";

async function runBackfill() {
  const statement = backfillSql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .trim();
  expect(statement.length).toBeGreaterThan(0);
  // 1 ファイル 1 文（末尾の ; を除いて、途中に文の区切りがない）
  expect(statement.replace(/;\s*$/, "")).not.toContain(";");
  await env.DB.prepare(statement).run();
}

async function memberSnapshot() {
  const { results } = await env.DB.prepare(
    `SELECT channel_id, user_id, joined_at FROM channel_members
     WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_dept!_%' ESCAPE '!')
     ORDER BY channel_id, user_id`,
  ).all<{ channel_id: string; user_id: string; joined_at: string }>();
  return results;
}

/** channel_members 全体の件数（testuser_dept_ 以外の行も含め、他の行を変えないことの確認用） */
async function totalMembers() {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM channel_members",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

const keysOf = (rows: { channel_id: string; user_id: string }[]) =>
  rows.map((r) => `${r.channel_id}:${r.user_id}`).sort();

afterEach(async () => {
  await cleanupDepartmentTestData();
});

describe("#206 AC-5 オーナーの全体管理者の専用チャンネルへの参加の補完（補完 SQL）", () => {
  it("#206 AC-5: 未参加の専用チャンネルだけに参加させ、参加済みの行（joined_at を含む）・他の人・通常のチャンネルは変えない", async () => {
    const admin = await insertUser(
      "testuser_dept_bf206_admin",
      await insertDepartment("補完所属"),
    );
    await makeGlobalAdmin(admin);
    // 部署1：未参加
    const unjoined = await insertDepartmentWithChannels("補完未参加");
    // 部署2：通常だけ参加済み（お知らせに足し、既存の行は変えない）
    const partial = await insertDepartmentWithChannels("補完一部");
    // 部署3：両方参加済み（何も変えない）
    const done = await insertDepartmentWithChannels("補完済み");
    for (const dept of [unjoined, partial, done])
      await makeOwner(admin, dept.id);
    await insertMember(partial.dedicatedChannelId, admin);
    await insertMember(done.dedicatedChannelId, admin);
    await insertMember(done.announcementChannelId, admin);
    await env.DB.prepare(
      "UPDATE channel_members SET joined_at = ? WHERE user_id = ?",
    )
      .bind(OLD_JOINED_AT, admin)
      .run();
    // 部署の通常のチャンネル（purpose=normal）：参加させない
    const normal = await insertChannel({
      name: `${TEST_TAG}補完未参加の雑談`,
      purpose: "normal",
      departmentId: unjoined.id,
    });
    // オーナーではない一般社員（部署1に所属、未参加）と、全体管理者でない別部署のオーナー：参加させない
    const member = await insertUser("testuser_dept_bf206_member", unjoined.id);
    const otherDept = await insertDepartmentWithChannels("補完別部署");
    const plainOwner = await insertUser(
      "testuser_dept_bf206_plain",
      otherDept.id,
    );
    await makeOwner(plainOwner, otherDept.id);

    const before = await memberSnapshot();
    const totalBefore = await totalMembers();
    await runBackfill();
    const after = await memberSnapshot();
    // 全体の件数も、期待の追加行（3行）だけ増える
    expect(await totalMembers()).toBe(totalBefore + 3);

    const beforeKeys = new Set(keysOf(before));
    const added = keysOf(after).filter((key) => !beforeKeys.has(key));
    expect(added).toEqual(
      [
        `${unjoined.dedicatedChannelId}:${admin}`,
        `${unjoined.announcementChannelId}:${admin}`,
        `${partial.announcementChannelId}:${admin}`,
      ].sort(),
    );
    // 既存の行は joined_at も含めて変わらない
    for (const row of before) expect(after).toContainEqual(row);
    for (const row of after.filter(
      (r) => !beforeKeys.has(`${r.channel_id}:${r.user_id}`),
    ))
      expect(typeof row.joined_at).toBe("string");
    // 対象外（通常のチャンネル・一般社員・全体管理者でないオーナー）に行は増えていない
    const addedSet = new Set(added);
    for (const key of [
      `${normal}:${admin}`,
      `${unjoined.dedicatedChannelId}:${member}`,
      `${otherDept.dedicatedChannelId}:${plainOwner}`,
      `${otherDept.announcementChannelId}:${plainOwner}`,
      // オーナーでない部署の専用チャンネルにも入らない
      `${otherDept.dedicatedChannelId}:${admin}`,
      `${otherDept.announcementChannelId}:${admin}`,
    ])
      expect(addedSet.has(key), key).toBe(false);
  });

  it("#206 AC-5: 無効な利用者（is_active=0）の全体管理者のオーナーは参加させない", async () => {
    const dept = await insertDepartmentWithChannels("補完無効");
    const inactive = await insertUser("testuser_dept_bf206_inact", dept.id, {
      isActive: false,
    });
    await makeGlobalAdmin(inactive);
    await makeOwner(inactive, dept.id);
    const before = await memberSnapshot();
    const totalBefore = await totalMembers();
    await runBackfill();
    expect(await memberSnapshot()).toEqual(before);
    expect(await totalMembers()).toBe(totalBefore);
  });

  it("#206 AC-5: 全体管理者であっても、オーナーでない部署の専用チャンネルには参加させない", async () => {
    const dept = await insertDepartmentWithChannels("補完非オーナー");
    const admin = await insertUser("testuser_dept_bf206_nonown", dept.id);
    await makeGlobalAdmin(admin);
    const before = await memberSnapshot();
    const totalBefore = await totalMembers();
    await runBackfill();
    expect(await memberSnapshot()).toEqual(before);
    expect(await totalMembers()).toBe(totalBefore);
  });

  it("#206 AC-5: 全体管理者でないオーナーは参加させない", async () => {
    const dept = await insertDepartmentWithChannels("補完一般オーナー");
    const owner = await insertUser("testuser_dept_bf206_plainonly", dept.id);
    await makeOwner(owner, dept.id);
    const before = await memberSnapshot();
    const totalBefore = await totalMembers();
    await runBackfill();
    expect(await memberSnapshot()).toEqual(before);
    expect(await totalMembers()).toBe(totalBefore);
  });

  it("#206 AC-5: アーカイブ済み（deleted_at あり）の専用チャンネルには参加させず、残りの専用チャンネルには参加させる", async () => {
    const deptId = await insertDepartment("補完アーカイブ");
    const dedicated = await insertChannel({
      name: `${TEST_TAG}補完アーカイブ`,
      purpose: "department",
      departmentId: deptId,
    });
    const archivedAnnouncement = await insertChannel({
      name: `${TEST_TAG}補完アーカイブのお知らせ`,
      purpose: "announcement",
      departmentId: deptId,
      archived: true,
    });
    const admin = await insertUser("testuser_dept_bf206_arch", deptId);
    await makeGlobalAdmin(admin);
    await makeOwner(admin, deptId);
    await runBackfill();
    const keys = keysOf(await memberSnapshot());
    expect(keys).toContain(`${dedicated}:${admin}`);
    expect(keys).not.toContain(`${archivedAnnouncement}:${admin}`);
  });

  it("#206 AC-5: 何度流しても同じ結果になる（べき等。2回目は何も増やさず、joined_at も変えない）", async () => {
    const dept = await insertDepartmentWithChannels("補完べき等");
    const admin = await insertUser("testuser_dept_bf206_idem", dept.id);
    await makeGlobalAdmin(admin);
    await makeOwner(admin, dept.id);
    await runBackfill();
    const first = await memberSnapshot();
    expect(keysOf(first)).toEqual(
      [
        `${dept.dedicatedChannelId}:${admin}`,
        `${dept.announcementChannelId}:${admin}`,
      ].sort(),
    );
    const totalFirst = await totalMembers();
    await runBackfill();
    expect(await memberSnapshot()).toEqual(first);
    // 2回目は channel_members 全体で 0 件の追加
    expect(await totalMembers()).toBe(totalFirst);
  });

  it("#206 AC-5: 対象が1件もなくても失敗せず、何も増やさない", async () => {
    const dept = await insertDepartmentWithChannels("補完対象なし");
    await insertUser("testuser_dept_bf206_none", dept.id);
    const before = await memberSnapshot();
    const totalBefore = await totalMembers();
    await runBackfill();
    expect(await memberSnapshot()).toEqual(before);
    expect(await totalMembers()).toBe(totalBefore);
  });
});
