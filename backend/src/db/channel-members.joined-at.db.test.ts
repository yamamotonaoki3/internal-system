// #237 AC-1（C-169 (2)。計画 改訂2 B・改訂4-2）：未読の下限に参加の時刻（channel_members.joined_at）を使うため、
// 参加の行を作る経路が、どれも UTC の ISO 8601（YYYY-MM-DDTHH:MM:SS.sssZ）で joined_at を入れることを確かめる。
// 形が崩れると unreadLowerBound が参加の下限を付けず（すべて数える側に倒す）、参加の前の投稿まで未読に数えてしまう。
// 経路：DB の既定値（migration 0009・0011 の補完はこれを使う）・参加の API・部署のオーナーの任命（専用チャンネルへの参加）・
//       チャンネルの作成申請の承認（申請者の参加）・アカウントの発行（全社連絡と所属部署の専用チャンネルへの参加）。
// 初回セットアップ（setup.repository）は、会社が未設定の DB でしか通らないため、ここでは確かめない（確認が必要な点として報告する）。
// データは架空（testuser_joinedat_・testuser_chreq_・UNIT_TEST_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import { SCRYPT_TEST_TIMEOUT_MS } from "../../test/auth-fixtures";
import {
  NAME_PREFIX,
  cleanupChannelRequestTestData,
  insertActor,
  insertChannelRequest,
  sessionFor,
} from "../../test/channel-request-fixtures";
import {
  insertChannel,
  insertDepartmentWithChannels,
  makeGlobalAdmin,
} from "../../test/department-fixtures";
import { TEST_TAG } from "../../test/role-fixtures";

const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function joinedAtOf(channelId: string, userId: string) {
  const row = await env.DB.prepare(
    "SELECT joined_at FROM channel_members WHERE channel_id = ? AND user_id = ?",
  )
    .bind(channelId, userId)
    .first<{ joined_at: string }>();
  if (row === null) throw new Error("参加の行がありません");
  return row.joined_at;
}

function expectIsoUtc(value: string) {
  expect(value).toMatch(ISO_UTC_MS);
  expect(new Date(Date.parse(value)).toISOString()).toBe(value);
}

let dept: Awaited<ReturnType<typeof insertDepartmentWithChannels>>;
let admin: string;
let adminToken: string;

beforeEach(async () => {
  for (const method of ["log", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("参加の時刻");
  admin = await insertActor("testuser_joinedat_admin", dept.id);
  await makeGlobalAdmin(admin);
  adminToken = await sessionFor(admin);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.prepare(
    "DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!') OR target_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!')",
  ).run();
  await cleanupChannelRequestTestData();
});

describe("#237 AC-1（C-169 (2)）参加の行の joined_at は、どの経路でも UTC の ISO 8601（ミリ秒まで）", () => {
  it("#237 AC-1: DB の既定値（joined_at を省いた INSERT。migration 0009・0011 の補完が使う）", async () => {
    const member = await insertActor("testuser_joinedat_default", dept.id);
    await env.DB.prepare(
      "INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?)",
    )
      .bind(dept.dedicatedChannelId, member)
      .run();
    expectIsoUtc(await joinedAtOf(dept.dedicatedChannelId, member));
  });

  it("#237 AC-1: 参加の API（POST /api/channels/:id/join）", async () => {
    const member = await insertActor("testuser_joinedat_join", dept.id);
    const roomId = await insertChannel({
      name: `${TEST_TAG}参加の時刻の公開`,
      purpose: "normal",
      departmentId: dept.id,
    });
    const res = await apiRequest("POST", `/api/channels/${roomId}/join`, {
      token: await sessionFor(member),
    });
    expect(res.status).toBe(200);
    expectIsoUtc(await joinedAtOf(roomId, member));
  });

  it("#237 AC-1: 部署のオーナーの任命（PUT /api/departments/:id/owner。新しいオーナーを専用チャンネルに参加させる）", async () => {
    const owner = await insertActor("testuser_joinedat_owner", dept.id);
    const res = await apiRequest("PUT", `/api/departments/${dept.id}/owner`, {
      token: adminToken,
      body: { ownerUserId: owner, version: 1 },
    });
    expect(res.status).toBe(200);
    expectIsoUtc(await joinedAtOf(dept.dedicatedChannelId, owner));
    expectIsoUtc(await joinedAtOf(dept.announcementChannelId, owner));
  });

  it("#237 AC-1: チャンネルの作成申請の承認（POST /api/channel-requests/:id/approve。申請者を参加させる）", async () => {
    const requester = await insertActor("testuser_chreq_joinedat", dept.id);
    // 会社直属（部署なし）の申請は、全体管理者が決裁する
    const requestId = await insertChannelRequest({
      departmentId: null,
      name: `${NAME_PREFIX}参加の時刻`,
      requestedBy: requester,
    });
    const res = await apiRequest(
      "POST",
      `/api/channel-requests/${requestId}/approve`,
      { token: adminToken },
    );
    expect(res.status).toBe(200);
    const { roomId } = (await res.json()) as { roomId: string };
    expectIsoUtc(await joinedAtOf(roomId, requester));
  });

  it(
    "#237 AC-1: アカウントの発行（POST /api/admin/accounts。全社連絡と所属部署の専用チャンネルに参加させる）",
    { timeout: SCRYPT_TEST_TIMEOUT_MS },
    async () => {
      const res = await apiRequest("POST", "/api/admin/accounts", {
        token: adminToken,
        body: {
          loginId: "testuser_joinedat_new",
          legalName: "テスト太郎",
          displayName: "テスト太郎",
          email: "testuser_joinedat_new@example.com",
          emailConfirmed: true,
          departmentId: dept.id,
        },
      });
      expect(res.status).toBe(201);
      const { results } = await env.DB.prepare(
        `SELECT joined_at FROM channel_members
         WHERE user_id IN (SELECT id FROM users WHERE login_id_normalized = 'testuser_joinedat_new')`,
      ).all<{ joined_at: string }>();
      expect(results).toHaveLength(3);
      for (const row of results) expectIsoUtc(row.joined_at);
    },
  );
});
