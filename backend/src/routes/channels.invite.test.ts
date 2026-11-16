// #135 AC-1（2-5 AC-1・AC-2・AC-5・AC-6）・#132 AC-2（2-4 AC-1〜AC-3）: チャンネルへの招待（EP-2-12 POST /api/channels/:channelId/invitations）を、
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる結合テスト。HTTP の形・認証・同じ応答であること・DB の行・一覧への反映の代表例だけを見る
// （判定の順の組み合わせと相手の有効性（2-5 AC-3）は services/channel.service.invite.test.ts、SQL の条件・原子性は db/channel.repository.invite.db.test.ts。計画 10節）。
// 応答の形（計画 4節 Q2・5節）：
//   成功   201 { channelId, userId, joinedAt }
//   本文   { userId }（strict、ULID）。違えば 422 VALIDATION_ERROR（fields）
//   監査   channel.invite を1件（actor=招待者、target=チャンネル、detail のキーは invitedUserId だけ）
//   通知   channel.invited を招待された人へ1件（room_id=チャンネル）
// データは架空（testuser_chinv_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  SESSION_COOKIE,
  TEST_IP,
  cleanupAuthTestData,
  newThrottleKey,
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
  REAUTH_WINDOW_MS,
  failureAuditLines,
  newSessionFor,
} from "../../test/message-modify-fixtures";
import { cleanupNotificationTestData } from "../../test/notification-fixtures";
import { newPiiKey, newSetupToken } from "../../test/random-secrets";
import { insertUser, testId } from "../../test/role-fixtures";
import { loadConfig } from "../config";
import { app } from "../index";

const ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
const INVITE_ACTION = "channel.invite";
const INVITED_KIND = "channel.invited";

let throttleKey: string;
let dept: SeededDepartment;
let inviter: string;
let invitee: string;
let inactive: string;
/** 招待者の、再認証済みのセッション */
let inviterToken: string;
/** 招待者の、再認証していないセッション */
let inviterNoReauth: string;
let inviteeToken: string;
let inactiveToken: string;
let logLines: string[];

async function request(
  method: string,
  path: string,
  options: { token?: string; origin?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    Origin: options.origin ?? ORIGIN,
    "CF-Connecting-IP": TEST_IP,
    "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
  };
  if (options.token) headers.Cookie = `${SESSION_COOKIE}=${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(
    path,
    {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    {
      ...env,
      LOGIN_THROTTLE_KEY: throttleKey,
      SETUP_TOKEN: newSetupToken(),
      PII_ENCRYPTION_KEY: newPiiKey(),
    } as unknown as Env,
  );
}

// token: null はセッションなし（未認証）
const invite = (
  channelId: string,
  body: unknown,
  token: string | null = inviterToken,
  extra: { origin?: string } = {},
) =>
  request("POST", `/api/channels/${channelId}/invitations`, {
    ...(token === null ? {} : { token }),
    body,
    ...extra,
  });

async function privateChannel(label: string, members: string[] = [inviter]) {
  const id = await insertChannel({
    name: `${TEST_TAG}招待${label}`,
    purpose: "normal",
    departmentId: dept.id,
    visibility: "private",
  });
  for (const member of members) await insertMember(id, member);
  return id;
}

async function inviteAudits(channelId: string) {
  const { results } = await env.DB.prepare(
    "SELECT actor_id, target_type, target_id, result, detail FROM audit_logs WHERE action = ? AND target_id = ?",
  )
    .bind(INVITE_ACTION, channelId)
    .all<{
      actor_id: string;
      target_type: string;
      target_id: string;
      result: string;
      detail: string | null;
    }>();
  return results;
}

async function invitedNotifications(roomId: string) {
  const { results } = await env.DB.prepare(
    "SELECT user_id, kind, room_id FROM notifications WHERE kind = ? AND room_id = ?",
  )
    .bind(INVITED_KIND, roomId)
    .all<{ user_id: string; kind: string; room_id: string }>();
  return results;
}

/** 何も増えていないこと（参加の行・成功の監査・通知） */
async function expectNothingWritten(channelId: string, before: string[]) {
  expect(await membersOf(channelId)).toEqual(before);
  expect(await inviteAudits(channelId)).toEqual([]);
  expect(await invitedNotifications(channelId)).toEqual([]);
}

const failureInviteAudits = () =>
  failureAuditLines(logLines).filter((line) => line.body === INVITE_ACTION);

beforeEach(async () => {
  throttleKey = newThrottleKey();
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  dept = await insertDepartmentWithChannels("招待");
  inviter = await insertUser("testuser_chinv_inviter", dept.id);
  invitee = await insertUser("testuser_chinv_invitee", dept.id);
  inactive = await insertUser("testuser_chinv_inactive", dept.id, {
    isActive: false,
  });
  await env.DB.prepare(
    "UPDATE users SET must_change_password = 0 WHERE login_id LIKE 'testuser!_chinv!_%' ESCAPE '!'",
  ).run();
  inviterToken = await newSessionFor(inviter, 0);
  inviterNoReauth = await newSessionFor(inviter, null);
  inviteeToken = await newSessionFor(invitee, null);
  inactiveToken = await newSessionFor(inactive, 0);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.prepare(
    "DELETE FROM audit_logs WHERE action = ? AND (trace_id LIKE ? OR actor_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!'))",
  )
    .bind(INVITE_ACTION, `${AUTH_TRACE_PREFIX}%`)
    .run();
  await cleanupNotificationTestData();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#135 AC-1（2-5 AC-1）・#132 AC-2（2-4 AC-2）招待の成功", () => {
  it("#135 AC-1（2-5 AC-1）: 参加者が有効な社員を招待すると 201 { channelId, userId, joinedAt }。相手が参加者になり、監査1件・通知1件", async () => {
    const room = await privateChannel("成功");
    const response = await invite(room, { userId: invitee });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["channelId", "joinedAt", "userId"].sort(),
    );
    expect(body).toMatchObject({ channelId: room, userId: invitee });
    expect(typeof body.joinedAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.joinedAt as string))).toBe(false);
    expect((await membersOf(room)).sort()).toEqual([inviter, invitee].sort());

    const audits = await inviteAudits(room);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: inviter,
      target_type: "channel",
      target_id: room,
      result: "success",
    });
    // detail は識別子だけ（氏名・チャンネル名を入れない）
    const detail = JSON.parse(audits[0]?.detail ?? "{}") as Record<
      string,
      unknown
    >;
    expect(detail).toEqual({ invitedUserId: invitee });

    expect(await invitedNotifications(room)).toEqual([
      { user_id: invitee, kind: INVITED_KIND, room_id: room },
    ]);
  });

  it("#132 AC-2（2-4 AC-2）: 招待された人には、非公開チャンネルが一覧・詳細に出る（招待の前は出ず、詳細は 404）", async () => {
    const room = await privateChannel("一覧への反映");
    const before = await request("GET", "/api/channels", {
      token: inviteeToken,
    });
    const beforeBody = (await before.json()) as { items: { id: string }[] };
    expect(beforeBody.items.map((i) => i.id)).not.toContain(room);
    expect(
      (await request("GET", `/api/channels/${room}`, { token: inviteeToken }))
        .status,
    ).toBe(404);

    expect((await invite(room, { userId: invitee })).status).toBe(201);

    const after = await request("GET", "/api/channels?joined=true", {
      token: inviteeToken,
    });
    const afterBody = (await after.json()) as { items: { id: string }[] };
    expect(afterBody.items.map((i) => i.id)).toContain(room);
    const detail = await request("GET", `/api/channels/${room}`, {
      token: inviteeToken,
    });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: room, joined: true });
  });
});

describe("#135 AC-1（2-5 AC-2）重複", () => {
  it("#135 AC-1（2-5 AC-2）: 参加済みの社員を招待すると 409 CONFLICT で、行・監査・通知は増えない", async () => {
    const room = await privateChannel("参加済み", [inviter, invitee]);
    const before = await membersOf(room);
    const response = await invite(room, { userId: invitee });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CONFLICT" });
    await expectNothingWritten(room, before);
  });

  it("#135 AC-1（2-5 AC-2）: 自分自身を招待すると 409 CONFLICT で、何も増えない", async () => {
    const room = await privateChannel("自分自身");
    const before = await membersOf(room);
    const response = await invite(room, { userId: inviter });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CONFLICT" });
    await expectNothingWritten(room, before);
  });
});

describe("#132 AC-2（2-4 AC-1）存在の非開示", () => {
  it("#132 AC-2（2-4 AC-1）: 参加していない非公開・存在しない・アーカイブ済みは、同じ 404（ステータス・code・message・本文の項目が同じ）で、何も増えない", async () => {
    const hidden = await privateChannel("見えない", [invitee]);
    const archived = await insertChannel({
      name: `${TEST_TAG}招待アーカイブ済み`,
      purpose: "normal",
      departmentId: dept.id,
      visibility: "private",
      archived: true,
    });
    await insertMember(archived, inviter);
    const missing = testId("NONE");
    const bodies: Record<string, unknown>[] = [];
    for (const target of [hidden, missing, archived]) {
      const before = await membersOf(target);
      const response = await invite(target, { userId: invitee });
      expect(response.status).toBe(404);
      bodies.push((await response.json()) as Record<string, unknown>);
      await expectNothingWritten(target, before);
    }
    expect(bodies[0]).toMatchObject({ code: "NOT_FOUND" });
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it("#132 AC-2（2-4 AC-1・AC-3）: 参加していない非公開には、再認証がなくても 404（REAUTH_REQUIRED で存在を漏らさない）", async () => {
    const hidden = await privateChannel("再認証なしでも見えない", [invitee]);
    const response = await invite(hidden, { userId: invitee }, inviterNoReauth);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("#135 決定 Q3 公開チャンネルの招待の権限", () => {
  it("#135 決定 Q3: 公開チャンネルに参加していない招待者は 403 FORBIDDEN。何も増えず、拒否が audit（channel.invite・failure）に残る", async () => {
    const room = await insertChannel({
      name: `${TEST_TAG}招待公開未参加`,
      purpose: "normal",
      departmentId: dept.id,
      visibility: "public",
    });
    const before = await membersOf(room);
    logLines.length = 0;
    const response = await invite(room, { userId: invitee });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    await expectNothingWritten(room, before);
    const lines = failureInviteAudits();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.attributes).toMatchObject({
      log_type: "audit",
      result: "failure",
      target: room,
    });
  });

  it("#135 AC-1（2-5 AC-1）: 公開チャンネルの参加者は招待できる（201）", async () => {
    const room = await insertChannel({
      name: `${TEST_TAG}招待公開参加中`,
      purpose: "normal",
      departmentId: dept.id,
      visibility: "public",
    });
    await insertMember(room, inviter);
    expect((await invite(room, { userId: invitee })).status).toBe(201);
  });
});

describe("#135 AC-1（2-5 AC-5）・#132 AC-2（2-4 AC-3）再認証", () => {
  it("#135 AC-1（2-5 AC-5）: 再認証していなければ 403 REAUTH_REQUIRED で、何も増えない", async () => {
    const room = await privateChannel("再認証なし");
    const before = await membersOf(room);
    const response = await invite(room, { userId: invitee }, inviterNoReauth);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
    await expectNothingWritten(room, before);
  });

  it("#135 AC-1（2-5 AC-5）: 再認証の有効期間を過ぎていれば 403 REAUTH_REQUIRED", async () => {
    const room = await privateChannel("再認証の期限切れ");
    const expired = await newSessionFor(inviter, REAUTH_WINDOW_MS + 1000);
    const response = await invite(room, { userId: invitee }, expired);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
  });
});

describe("#135 AC-1 認証と入力の確認", () => {
  it("#135 AC-1（認証）: 未認証は 401、無効な社員も 401 で、何も増えない", async () => {
    const room = await privateChannel("未認証");
    const before = await membersOf(room);
    expect((await invite(room, { userId: invitee }, null)).status).toBe(401);
    expect(
      (await invite(room, { userId: invitee }, inactiveToken)).status,
    ).toBe(401);
    await expectNothingWritten(room, before);
  });

  it("#135 AC-1（認証）: 許可されていない Origin からは 403 FORBIDDEN_ORIGIN で、何も増えない", async () => {
    const room = await privateChannel("Origin");
    const before = await membersOf(room);
    const response = await invite(room, { userId: invitee }, inviterToken, {
      origin: "https://origin.invalid",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    await expectNothingWritten(room, before);
  });

  it.each([
    ["userId がない", {}],
    ["userId が ULID でない", { userId: "testuser_chinv_invitee" }],
    ["userId が数値", { userId: 1 }],
    ["知らない項目がある（strict）", { userId: "__INVITEE__", extra: true }],
  ])(
    "#135 AC-1（入力の確認）: %sときは 422 VALIDATION_ERROR（fields）で、何も増えない",
    async (_label, raw) => {
      const room = await privateChannel("入力の確認");
      const before = await membersOf(room);
      const body = JSON.parse(
        JSON.stringify(raw).replace("__INVITEE__", invitee),
      ) as unknown;
      const response = await invite(room, body);
      expect(response.status).toBe(422);
      const json = (await response.json()) as { code: string; fields: unknown };
      expect(json.code).toBe("VALIDATION_ERROR");
      expect(Array.isArray(json.fields)).toBe(true);
      await expectNothingWritten(room, before);
    },
  );

  it("#135 AC-1（入力の確認）: パスのチャンネルIDが ULID でなければ 422", async () => {
    const response = await invite("not-a-ulid", { userId: invitee });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("#135 AC-1（2-5 AC-6）作らないものの確認", () => {
  it.each([
    [
      "部署への招待",
      (deptId: string) => `/api/departments/${deptId}/invitations`,
    ],
    [
      "チャンネルへの参加の申込",
      (_deptId: string, roomId: string) =>
        `/api/channels/${roomId}/join-requests`,
    ],
    [
      "招待の承諾",
      (_deptId: string, roomId: string) =>
        `/api/channels/${roomId}/invitations/${testId("INV")}/accept`,
    ],
  ] as const)(
    "#135 AC-1（2-5 AC-6）: %sの API はない（404）",
    async (_label, pathOf) => {
      const room = await privateChannel("作らないもの");
      const response = await request("POST", pathOf(dept.id, room), {
        token: inviterToken,
        body: { userId: invitee },
      });
      expect(response.status).toBe(404);
    },
  );
});
