// #200 AC-2・AC-3: チャンネルの Repository を、マイグレーション済みの D1 で確かめる。
// 参加の監査ログは「参加の行がまだないときだけ」書くこと、公開・未アーカイブでないとき参加せず null を返すこと、不正なIDの検出を確かめる。
// データは架空（testuser_、[UNIT_TEST]、@example.com）。
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
  insertMember,
  membersOf,
  type SeededDepartment,
} from "../../test/department-fixtures";
import {
  cleanupRoleTestData,
  insertUser,
  testId,
} from "../../test/role-fixtures";
import { withChannels } from "./channel.repository";

let dept: SeededDepartment;
let userId: string;

const traceId = () => `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`;

async function joinAuditCount(channelId: string) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'channel.join' AND target_id = ?",
  )
    .bind(channelId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  dept = await insertDepartmentWithChannels("チャンネルRepo");
  userId = await insertUser("testuser_chrepo_001", dept.id);
});

afterEach(async () => {
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
  await cleanupRoleTestData();
});

describe("#200 AC-2 参加（Repository）", () => {
  it("#200 AC-2: 参加の行がまだないときは、参加の行と監査ログ channel.join を1件ずつ作り、参加の日時を返す", async () => {
    const joinedAt = await withChannels(env, (repository) =>
      repository.join({
        roomId: dept.dedicatedChannelId,
        userId,
        traceId: traceId(),
      }),
    );
    expect(joinedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await membersOf(dept.dedicatedChannelId)).toEqual([userId]);
    expect(await joinAuditCount(dept.dedicatedChannelId)).toBe(1);
  });

  it("#200 AC-2（Q-6）: すでに参加しているときは、参加の行も日時も変えず、監査ログを書かない（Service を通さず直接呼んでも）", async () => {
    await insertMember(dept.dedicatedChannelId, userId);
    const joinedAt = await withChannels(env, (repository) =>
      repository.join({
        roomId: dept.dedicatedChannelId,
        userId,
        traceId: traceId(),
      }),
    );
    expect(joinedAt).toBe("2026-11-09T00:00:00.000Z");
    expect(await membersOf(dept.dedicatedChannelId)).toEqual([userId]);
    expect(await joinAuditCount(dept.dedicatedChannelId)).toBe(0);
  });

  // 確認（Service）の後にアーカイブ・非公開化された競合は、確認済みの状態から Repository を直接呼んで再現する
  it.each([
    ["アーカイブされた", { archived: true }],
    ["非公開になった", { visibility: "private" as const }],
  ])(
    "#200 AC-2: 確認の後に%sチャンネルには、参加の行も監査ログも作らず、例外ではなく null を返す",
    async (_label, options) => {
      const roomId = await insertChannel({
        name: `${TEST_TAG}競合`,
        purpose: "normal",
        departmentId: dept.id,
        ...options,
      });
      const result = await withChannels(env, (repository) =>
        repository.join({ roomId, userId, traceId: traceId() }),
      );
      expect(result).toBeNull();
      expect(await membersOf(roomId)).toEqual([]);
      expect(await joinAuditCount(roomId)).toBe(0);
    },
  );

  it("#200 AC-2: 公開で未アーカイブのときだけ参加の行を挿入する（公開・未削除なら日時を返し、参加の行が1件できる）", async () => {
    const roomId = await insertChannel({
      name: `${TEST_TAG}公開`,
      purpose: "normal",
      departmentId: dept.id,
    });
    const result = await withChannels(env, (repository) =>
      repository.join({ roomId, userId, traceId: traceId() }),
    );
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await membersOf(roomId)).toEqual([userId]);
  });
});

describe("#200 AC-2 一覧のカーソル（Repository）", () => {
  it("#200 AC-2: ULID の形でないチャンネルIDが次のページの起点になるときは、エラー（決めた文言）にする", async () => {
    const odd = await insertDepartmentWithChannels("不正ID");
    await insertChannel({
      name: `${TEST_TAG}a-not-ulid`,
      purpose: "normal",
      departmentId: odd.id,
      id: "not-a-ulid",
    });
    await insertChannel({
      name: `${TEST_TAG}b-ulid`,
      purpose: "normal",
      departmentId: odd.id,
      id: testId("ROOM"),
    });
    const error = await withChannels(env, (repository) =>
      repository.list(userId, { limit: 1, departmentId: odd.id }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("チャンネルIDが不正です");
  });

  it("#200 AC-2: 参加者の数は有効な社員だけを数える", async () => {
    const inactive = await insertUser("testuser_chrepo_off", dept.id, {
      isActive: false,
    });
    await insertMember(dept.dedicatedChannelId, userId);
    await insertMember(dept.dedicatedChannelId, inactive);
    const count = await withChannels(env, (repository) =>
      repository.countMembers(dept.dedicatedChannelId),
    );
    expect(count).toBe(1);
  });
});
