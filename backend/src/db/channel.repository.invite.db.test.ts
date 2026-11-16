// #135 AC-1（2-5 AC-1・AC-2）・#132 AC-2（2-4 AC-2）: 招待の Repository（channel.repository.ts の findInvitee・invite と channel-invite.sql.ts）を、
// マイグレーション済みの D1 で確かめる。SQL の条件・0行・原子性・通知の見える範囲は DB の層でしか見られない（計画 10節）。
// 書き込みの条件（計画 5節 手順9。監査・通知・参加の3文とも同じ条件）：
//   チャンネルが未アーカイブ・purpose が case でない・部署がない、または部署が有効・招待者の参加の行がある（公開・非公開とも）・招待者が有効（計画レビュー2回目で追加）・相手が有効・相手が未参加
// 実装が前提とする約束（実装前。報告に明記）：
//   repository.findInvitee(roomId, userId): Promise<{ isActive: boolean; joined: boolean } | null>（社員が存在しなければ null）
//   repository.invite({ roomId, inviterId, inviteeId, traceId }): Promise<string | null>
//     挿入した参加の joined_at を返す。条件が成り立たず0行なら null（既存の参加の行があっても null）
//   監査 channel.invite（actor=招待者、target_type=channel、target_id=チャンネル、detail={ invitedUserId }）、通知 channel.invited（宛先=相手、room_id=チャンネル）
// データは架空（testuser_chinvdb_、[UNIT_TEST]、@example.com）。
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
  insertMember,
  membersOf,
} from "../../test/department-fixtures";
import { deactivateUser } from "../../test/dm-fixtures";
import {
  archiveChannel,
  deactivateDepartment,
  leaveChannel,
} from "../../test/message-modify-fixtures";
import { cleanupNotificationTestData } from "../../test/notification-fixtures";
import { insertDepartment, insertUser, testId } from "../../test/role-fixtures";
import { withChannels } from "./channel.repository";
import { withDatabase } from "./database";
import { createNotificationRepository } from "./notification.repository";

let deptId: string;
let inviter: string;
let invitee: string;

const traceId = () => `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`;

async function channel(
  label: string,
  options: {
    visibility?: "public" | "private";
    purpose?: "normal" | "case";
    departmentId?: string | null;
    members?: string[];
  } = {},
) {
  const id = await insertChannel({
    name: `${TEST_TAG}招待DB${label}`,
    purpose: options.purpose ?? "normal",
    departmentId:
      options.departmentId === undefined ? deptId : options.departmentId,
    visibility: options.visibility ?? "private",
  });
  for (const member of options.members ?? [inviter])
    await insertMember(id, member);
  return id;
}

const invite = (roomId: string, inviteeId = invitee, inviterId = inviter) =>
  withChannels(env, (r) =>
    r.invite({ roomId, inviterId, inviteeId, traceId: traceId() }),
  );

async function auditRows(roomId: string) {
  const { results } = await env.DB.prepare(
    "SELECT actor_id, target_type, target_id, result, detail FROM audit_logs WHERE action = 'channel.invite' AND target_id = ?",
  )
    .bind(roomId)
    .all<{
      actor_id: string;
      target_type: string;
      target_id: string;
      result: string;
      detail: string | null;
    }>();
  return results;
}

async function notificationRowsFor(roomId: string) {
  const { results } = await env.DB.prepare(
    "SELECT user_id, kind, room_id FROM notifications WHERE kind = 'channel.invited' AND room_id = ?",
  )
    .bind(roomId)
    .all<{ user_id: string; kind: string; room_id: string }>();
  return results;
}

/** 0行のとき：成功の監査・通知・参加の行のどれも増えていない */
async function expectNothingWritten(roomId: string, before: string[]) {
  expect(await membersOf(roomId)).toEqual(before);
  expect(await auditRows(roomId)).toEqual([]);
  expect(await notificationRowsFor(roomId)).toEqual([]);
}

beforeEach(async () => {
  deptId = await insertDepartment("招待DB");
  inviter = await insertUser("testuser_chinvdb_inviter", deptId);
  invitee = await insertUser("testuser_chinvdb_invitee", deptId);
});

afterEach(async () => {
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_invite_notification");
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_invite_member");
  await env.DB.prepare(
    "DELETE FROM audit_logs WHERE action = 'channel.invite' AND trace_id LIKE ?",
  )
    .bind(`${AUTH_TRACE_PREFIX}%`)
    .run();
  await cleanupNotificationTestData();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#135 AC-1（2-5 AC-1）invite の成功", () => {
  it("#135 AC-1（2-5 AC-1）: 参加の行・監査 channel.invite（detail は invitedUserId だけ）・通知 channel.invited を1件ずつ作り、joined_at を返す", async () => {
    const room = await channel("成功");
    const joinedAt = await invite(room);
    expect(typeof joinedAt).toBe("string");
    const member = await env.DB.prepare(
      "SELECT joined_at FROM channel_members WHERE channel_id = ? AND user_id = ?",
    )
      .bind(room, invitee)
      .first<{ joined_at: string }>();
    expect(member?.joined_at).toBe(joinedAt);
    const audits = await auditRows(room);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: inviter,
      target_type: "channel",
      target_id: room,
      result: "success",
    });
    expect(JSON.parse(audits[0]?.detail ?? "null")).toEqual({
      invitedUserId: invitee,
    });
    expect(await notificationRowsFor(room)).toEqual([
      { user_id: invitee, kind: "channel.invited", room_id: room },
    ]);
  });

  it("#135 AC-1（計画レビュー2回目 重大）: 公開チャンネルでも、招待者の参加の行がなければ3文とも0行（null）で、参加の行・監査・通知が増えない", async () => {
    const room = await channel("公開未参加", {
      visibility: "public",
      members: [],
    });
    const before = await membersOf(room);
    expect(await invite(room)).toBeNull();
    await expectNothingWritten(room, before);
  });

  it("#135 AC-1（計画レビュー2回目 重大）: 公開チャンネルで、書き込みの直前に招待者が参加の行を失った場合も null で、何も増えない", async () => {
    const room = await channel("公開で外れた", { visibility: "public" });
    await leaveChannel(room, inviter);
    const before = await membersOf(room);
    expect(await invite(room)).toBeNull();
    await expectNothingWritten(room, before);
  });

  it("#135 AC-1（読み取り専用）: 会社直属（部署なし）のチャンネルには招待できる", async () => {
    // 全社連絡（purpose: company_general）は全社で1件だけのため、部署なしの通常の公開チャンネルで確かめる
    const room = await channel("会社直属", {
      departmentId: null,
      purpose: "normal",
      visibility: "public",
    });
    expect(await invite(room)).not.toBeNull();
    expect(await membersOf(room)).toContain(invitee);
  });
});

describe("#135 AC-1 書き込みの条件（書き込み直前の変化で0行。重大1・重大2）", () => {
  it.each([
    [
      "相手が参加済みになった",
      async (room: string) => insertMember(room, invitee),
    ],
    ["チャンネルがアーカイブされた", (room: string) => archiveChannel(room)],
    ["非公開で招待者が外れた", (room: string) => leaveChannel(room, inviter)],
    ["部署が無効になった", () => deactivateDepartment(deptId)],
    ["相手が無効になった", () => deactivateUser(invitee)],
    [
      "招待者が無効になった（計画レビュー2回目）",
      () => deactivateUser(inviter),
    ],
  ])(
    "#135 AC-1（0行）: %s場合は null を返し、成功の監査・通知・新しい参加の行を残さない",
    async (_label, change) => {
      const room = await channel("0行");
      await change(room);
      const before = await membersOf(room);
      expect(await invite(room)).toBeNull();
      expect(await membersOf(room)).toEqual(before);
      expect(await auditRows(room)).toEqual([]);
      expect(await notificationRowsFor(room)).toEqual([]);
    },
  );

  it("#135 AC-1（2-5 AC-7）: 案件専用チャンネルには書き込まない（null）", async () => {
    const room = await channel("案件", { purpose: "case" });
    const before = await membersOf(room);
    expect(await invite(room)).toBeNull();
    await expectNothingWritten(room, before);
  });

  it("#135 AC-1（2-5 AC-3）: 存在しない相手には書き込まず null（外部キーのエラーにしない）", async () => {
    const room = await channel("相手なし");
    const before = await membersOf(room);
    expect(await invite(room, testId("NOUSER"))).toBeNull();
    await expectNothingWritten(room, before);
  });

  it("#135 AC-1: 存在しないチャンネルには書き込まず null", async () => {
    const missing = testId("NOROOM");
    expect(await invite(missing)).toBeNull();
    expect(await auditRows(missing)).toEqual([]);
    expect(await notificationRowsFor(missing)).toEqual([]);
  });

  it("#135 AC-1（重なり）: 招待者が外れ、相手も参加済みのときも null で、何も増えない", async () => {
    const room = await channel("重なり", { members: [inviter, invitee] });
    await leaveChannel(room, inviter);
    const before = await membersOf(room);
    expect(await invite(room)).toBeNull();
    await expectNothingWritten(room, before);
  });
});

describe("#135 AC-1 原子性（監査・通知・参加は同じ batch）", () => {
  it("#135 AC-1: 通知の書き込みが失敗すると例外になり、監査も参加の行も残らない", async () => {
    const room = await channel("通知の失敗");
    const before = await membersOf(room);
    await env.DB.exec(
      "CREATE TRIGGER unit_fail_invite_notification BEFORE INSERT ON notifications WHEN NEW.kind = 'channel.invited' BEGIN SELECT RAISE(ABORT, 'unit test failure'); END",
    );
    await expect(invite(room)).rejects.toThrow();
    await expectNothingWritten(room, before);
  });

  it("#135 AC-1: 参加の行の書き込みが失敗すると例外になり、監査も通知も残らない", async () => {
    const room = await channel("参加の失敗");
    const before = await membersOf(room);
    await env.DB.exec(
      `CREATE TRIGGER unit_fail_invite_member BEFORE INSERT ON channel_members WHEN NEW.user_id = '${invitee}' BEGIN SELECT RAISE(ABORT, 'unit test failure'); END`,
    );
    await expect(invite(room)).rejects.toThrow();
    await expectNothingWritten(room, before);
  });
});

describe("#135 AC-1（2-5 AC-2・AC-3）findInvitee", () => {
  it("#135 AC-1（2-5 AC-3）: 存在しない社員は null", async () => {
    const room = await channel("findInvitee なし");
    expect(
      await withChannels(env, (r) => r.findInvitee(room, testId("NOUSER"))),
    ).toBeNull();
  });

  it.each([
    ["有効で未参加", false, false, { isActive: true, joined: false }],
    ["有効で参加済み", true, false, { isActive: true, joined: true }],
    ["無効で未参加", false, true, { isActive: false, joined: false }],
    [
      "無効で参加の行が残っている",
      true,
      true,
      { isActive: false, joined: true },
    ],
  ] as const)(
    "#135 AC-1（2-5 AC-2・AC-3）: %sの社員の状態を返す",
    async (_label, joined, deactivated, expected) => {
      const room = await channel("findInvitee");
      if (joined) await insertMember(room, invitee);
      if (deactivated) await deactivateUser(invitee);
      expect(
        await withChannels(env, (r) => r.findInvitee(room, invitee)),
      ).toEqual(expected);
    },
  );
});

describe("#135 決定 Q4 通知の見える範囲（既存の除外の仕組み）", () => {
  const listFor = (userId: string) =>
    withDatabase(env, (db) =>
      createNotificationRepository(db).listForRecipient(userId, { limit: 100 }),
    );

  it("#135 決定 Q4: 招待された人の通知一覧に channel.invited が出て、のちに非公開チャンネルから外れると一覧から除かれる", async () => {
    const room = await channel("通知の範囲");
    expect(await invite(room)).not.toBeNull();
    const listed = await listFor(invitee);
    expect(
      listed.items.filter(
        (item) => item.kind === "channel.invited" && item.roomId === room,
      ),
    ).toHaveLength(1);

    await leaveChannel(room, invitee);
    const after = await listFor(invitee);
    expect(after.items.some((item) => item.roomId === room)).toBe(false);
  });

  it("#135 決定 Q4: 通知の行にチャンネル名を保存しない（target_id・message_id にも名前を入れない）", async () => {
    const room = await channel("通知に名前を入れない");
    await invite(room);
    const row = await env.DB.prepare(
      "SELECT * FROM notifications WHERE kind = 'channel.invited' AND room_id = ?",
    )
      .bind(room)
      .first<Record<string, unknown>>();
    expect(row).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain("招待DB");
  });
});
