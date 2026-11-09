// #200 AC-1〜AC-3（2-3 AC-1・AC-2、2-4 AC-1）: チャンネルの一覧・詳細・参加（EP-2-04・EP-2-06・EP-2-05）を、
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。リポジトリ・サービス・ルートをまとめた結合テスト。
// 処理の順（計画 11章 #7）：①見えるか（見えなければ404）→②参加済みなら200（べき等）→③参加できるか（できなければ404）→参加する。
// 応答の形の前提（実装前。引き継ぎに明記）：
//   一覧   200 { items: [{ id, roomId, name, visibility, departmentId, departmentName, joined }], nextCursor }
//   詳細   200 { id, roomId, name, description, visibility, departmentId, joined, isCaseChannel, memberCount?, members? }
//          members（先頭 MEMBERS_PREVIEW_LIMIT 件の { id, displayName }）と memberCount は参加者にだけ返す
//   参加   200 { channelId, roomId, joinedAt }
// データは架空のもの（testuser_ch_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  SESSION_COOKIE,
  TEST_IP,
  cleanupAuthTestData,
  insertSession,
  newThrottleKey,
} from "../../test/auth-fixtures";
import { companyGeneralRoomId } from "../../test/company-general-fixtures";
import {
  TEST_TAG,
  cleanupDepartmentTestData,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  makeGlobalAdmin,
  membersOf,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { newPiiKey, newSetupToken } from "../../test/random-secrets";
import { insertDepartment, insertUser, testId } from "../../test/role-fixtures";
import { loadConfig } from "../config";
import { app } from "../index";
import { MEMBERS_PREVIEW_LIMIT } from "../lib/channel-rules";

const ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
const JOIN_ACTION = "channel.join";
let throttleKey: string;
let deptA: SeededDepartment;
let deptB: SeededDepartment;
let viewer: string;
let other: string;
let inactive: string;
let admin: string;
let viewerToken: string;
let inactiveToken: string;
let adminToken: string;

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

// token: 省略=一般社員のセッション、null=セッションなし（未認証）。undefined は既定引数で置き換わるため、未認証には null を使う
const get = (path: string, token: string | null = viewerToken) =>
  request("GET", path, token === null ? {} : { token });
const join = (
  channelId: string,
  token: string | null = viewerToken,
  extra: { origin?: string } = {},
) =>
  request("POST", `/api/channels/${channelId}/join`, {
    ...(token === null ? {} : { token }),
    ...extra,
  });

type ListItem = {
  id: string;
  roomId: string;
  name: string;
  visibility: string;
  departmentId: string | null;
  departmentName: string | null;
  joined: boolean;
};
type ListBody = { items: ListItem[]; nextCursor: string | null };
type DetailBody = Record<string, unknown> & {
  members?: { id: string; displayName: string }[];
  memberCount?: number;
};

async function list(query = "", token: string | null = viewerToken) {
  const response = await get(`/api/channels${query}`, token);
  expect(response.status).toBe(200);
  return (await response.json()) as ListBody;
}

async function activeSession(userId: string) {
  const session = await insertSession(userId, {
    createdAt: new Date().toISOString(),
  });
  return session.token;
}

async function joinAuditCount(channelId: string) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action = ? AND target_id = ?",
  )
    .bind(JOIN_ACTION, channelId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function memberRowCount(channelId: string, userId: string) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM channel_members WHERE channel_id = ? AND user_id = ?",
  )
    .bind(channelId, userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

const pad = (n: number) => String(n).padStart(2, "0");

beforeEach(async () => {
  throttleKey = newThrottleKey();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deptA = await insertDepartmentWithChannels("チャンネルA");
  deptB = await insertDepartmentWithChannels("チャンネルB");
  viewer = await insertUser("testuser_ch_viewer", deptA.id);
  other = await insertUser("testuser_ch_other", deptB.id);
  inactive = await insertUser("testuser_ch_inactive", deptA.id, {
    isActive: false,
  });
  admin = await insertUser("testuser_ch_admin", deptA.id);
  await env.DB.prepare(
    "UPDATE users SET must_change_password = 0 WHERE login_id LIKE 'testuser!_ch!_%' ESCAPE '!'",
  ).run();
  await makeGlobalAdmin(admin);
  viewerToken = await activeSession(viewer);
  inactiveToken = await activeSession(inactive);
  adminToken = await activeSession(admin);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_channel_join_audit");
  await env.DB.prepare(
    "DELETE FROM audit_logs WHERE action = ? AND trace_id LIKE ?",
  )
    .bind(JOIN_ACTION, `${AUTH_TRACE_PREFIX}%`)
    .run();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#200 AC-2 GET /api/channels（EP-2-04）", () => {
  it("#200 AC-2（2-3 AC-1）: 未参加の社員にも、全社連絡と全部署の公開チャンネルが joined:false で出る。項目は決めた形", async () => {
    const body = await list("?limit=100");
    const byId = new Map(body.items.map((item) => [item.id, item]));
    const general = await companyGeneralRoomId();
    expect(general).not.toBeNull();
    expect(byId.get(general ?? "")).toMatchObject({
      id: general,
      roomId: general,
      name: "全社連絡",
      visibility: "public",
      departmentId: null,
      departmentName: null,
      joined: false,
    });
    for (const [channelId, department] of [
      [deptA.dedicatedChannelId, deptA],
      [deptA.announcementChannelId, deptA],
      [deptB.dedicatedChannelId, deptB],
      [deptB.announcementChannelId, deptB],
    ] as const) {
      expect(byId.get(channelId)).toMatchObject({
        roomId: channelId,
        visibility: "public",
        departmentId: department.id,
        departmentName: department.name,
        joined: false,
      });
    }
  });

  it("#200 AC-2: 参加中のチャンネルは joined:true、未参加は joined:false（社員ごとに違う）", async () => {
    await insertMember(deptA.dedicatedChannelId, viewer);
    const mine = await list(`?departmentId=${deptA.id}`);
    expect(Object.fromEntries(mine.items.map((i) => [i.id, i.joined]))).toEqual(
      {
        [deptA.dedicatedChannelId]: true,
        [deptA.announcementChannelId]: false,
      },
    );
    const others = await list(
      `?departmentId=${deptA.id}`,
      await activeSession(other),
    );
    expect(others.items.every((i) => !i.joined)).toBe(true);
  });

  it("#200 AC-3（2-4 AC-1）: 参加していない非公開チャンネルは一覧に出ず、参加中の非公開チャンネルは出る", async () => {
    const hidden = await insertChannel({
      name: `${TEST_TAG}非公開で未参加`,
      purpose: "normal",
      departmentId: deptA.id,
      visibility: "private",
    });
    const mine = await insertChannel({
      name: `${TEST_TAG}非公開で参加中`,
      purpose: "normal",
      departmentId: deptA.id,
      visibility: "private",
    });
    await insertMember(mine, viewer);
    const ids = (await list(`?departmentId=${deptA.id}`)).items.map(
      (i) => i.id,
    );
    expect(ids).not.toContain(hidden);
    expect(ids).toContain(mine);
    const item = (await list(`?departmentId=${deptA.id}`)).items.find(
      (i) => i.id === mine,
    );
    expect(item).toMatchObject({ visibility: "private", joined: true });
  });

  it("#200 AC-3: アーカイブ済みのチャンネルは、公開でも参加中でも一覧に出ない", async () => {
    const archivedPublic = await insertChannel({
      name: `${TEST_TAG}公開でアーカイブ`,
      purpose: "normal",
      departmentId: deptA.id,
      archived: true,
    });
    const archivedJoined = await insertChannel({
      name: `${TEST_TAG}参加中でアーカイブ`,
      purpose: "normal",
      departmentId: deptA.id,
      archived: true,
    });
    await insertMember(archivedJoined, viewer);
    const ids = (await list(`?departmentId=${deptA.id}`)).items.map(
      (i) => i.id,
    );
    expect(ids).not.toContain(archivedPublic);
    expect(ids).not.toContain(archivedJoined);
  });

  it("#200 AC-4: departmentId で、その部署のチャンネルだけに絞る。存在しない部署は404 NOT_FOUND、形式が違う値は422", async () => {
    const onlyB = await list(`?departmentId=${deptB.id}`);
    expect(onlyB.items.map((i) => i.id).sort()).toEqual(
      [deptB.dedicatedChannelId, deptB.announcementChannelId].sort(),
    );
    const missing = await get(`/api/channels?departmentId=${testId("NONE")}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "NOT_FOUND" });
    const malformed = await get("/api/channels?departmentId=not-an-id");
    expect(malformed.status).toBe(422);
    expect(await malformed.json()).toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("#200 AC-4: joined=true は参加中だけ、joined=false は未参加だけ。true/false 以外は422", async () => {
    await insertMember(deptA.dedicatedChannelId, viewer);
    const joinedOnly = await list(`?joined=true&departmentId=${deptA.id}`);
    expect(joinedOnly.items.map((i) => i.id)).toEqual([
      deptA.dedicatedChannelId,
    ]);
    const notJoined = await list(`?joined=false&departmentId=${deptA.id}`);
    expect(notJoined.items.map((i) => i.id)).toEqual([
      deptA.announcementChannelId,
    ]);
    const bad = await get("/api/channels?joined=maybe");
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("#200 AC-2: 並びは名前の正規化値の昇順（同名なら room_id）", async () => {
    const names = ["ch-b", "ch-a", "ch-c"];
    const dept = await insertDepartment("並び順");
    for (const name of names)
      await insertChannel({
        name: `${TEST_TAG}${name}`,
        purpose: "normal",
        departmentId: dept,
      });
    const items = (await list(`?departmentId=${dept}`)).items;
    expect(items.map((i) => i.name)).toEqual(
      ["ch-a", "ch-b", "ch-c"].map((n) => `${TEST_TAG}${n}`),
    );
  });

  it.each([
    [20, 20, false],
    [21, 20, true],
  ])(
    "#200 AC-2（ページング境界）: %i 件あると、1ページ目は %i 件で、次のページがある=%s",
    async (total, firstPage, hasNext) => {
      const dept = await insertDepartment(`ページ${total}`);
      for (let i = 1; i <= total; i += 1)
        await insertChannel({
          name: `${TEST_TAG}page-${pad(i)}`,
          purpose: "normal",
          departmentId: dept,
        });
      const first = await list(`?departmentId=${dept}`);
      expect(first.items).toHaveLength(firstPage);
      expect(first.nextCursor !== null).toBe(hasNext);
      if (hasNext && first.nextCursor !== null) {
        const second = await list(
          `?departmentId=${dept}&cursor=${first.nextCursor}`,
        );
        expect(second.items).toHaveLength(total - firstPage);
        expect(second.nextCursor).toBeNull();
        const all = [...first.items, ...second.items].map((i) => i.name);
        expect(new Set(all).size).toBe(total);
        expect(all).toEqual([...all].sort());
      }
    },
  );

  it("#200 AC-2: 参加中の一覧（joined=true）もカーソルで送れる（サイドバー用。件数に上限がある）", async () => {
    const dept = await insertDepartment("参加中ページ");
    for (let i = 1; i <= 21; i += 1) {
      const id = await insertChannel({
        name: `${TEST_TAG}joined-${pad(i)}`,
        purpose: "normal",
        departmentId: dept,
      });
      await insertMember(id, viewer);
    }
    const first = await list(`?joined=true&departmentId=${dept}`);
    expect(first.items).toHaveLength(20);
    expect(first.items.every((i) => i.joined)).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(
      `?joined=true&departmentId=${dept}&cursor=${first.nextCursor}`,
    );
    expect(second.items).toHaveLength(1);
  });

  it("#200 AC-2: limit は1〜100。0・101・数値でない値は422、100は受け付ける", async () => {
    for (const bad of ["0", "101", "abc"]) {
      const response = await get(`/api/channels?limit=${bad}`);
      expect(response.status).toBe(422);
    }
    expect((await get("/api/channels?limit=100")).status).toBe(200);
  });

  it("#200 AC-2: 改ざんしたカーソルは422（fields に cursor）。入力値を応答に含めない", async () => {
    const response = await get("/api/channels?cursor=tampered-value");
    expect(response.status).toBe(422);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(text).not.toContain("tampered-value");
  });

  it("#200 AC-2（認可）: 未認証は401 UNAUTHENTICATED、無効化された社員も401", async () => {
    const unauthenticated = await get("/api/channels", null);
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({
      code: "UNAUTHENTICATED",
    });
    const disabled = await get("/api/channels", inactiveToken);
    expect(disabled.status).toBe(401);
  });
});

describe("#200 AC-2・AC-3 GET /api/channels/:channelId（EP-2-06）", () => {
  it("#200 AC-2（2-3 AC-1）: 未参加の社員も公開チャンネルを200で読める。members・memberCount は返さず、isCaseChannel は false", async () => {
    const response = await get(`/api/channels/${deptB.dedicatedChannelId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as DetailBody;
    expect(body).toMatchObject({
      id: deptB.dedicatedChannelId,
      roomId: deptB.dedicatedChannelId,
      name: deptB.name,
      description: "",
      visibility: "public",
      departmentId: deptB.id,
      joined: false,
      isCaseChannel: false,
    });
    expect(body).not.toHaveProperty("members");
    expect(body).not.toHaveProperty("memberCount");
  });

  it("#200 AC-2: 参加者には、参加者の数と、参加者（id・displayName）が返る", async () => {
    await insertMember(deptA.dedicatedChannelId, viewer);
    await insertMember(deptA.dedicatedChannelId, admin);
    const body = (await (
      await get(`/api/channels/${deptA.dedicatedChannelId}`)
    ).json()) as DetailBody;
    expect(body.joined).toBe(true);
    expect(body.memberCount).toBe(2);
    expect(body.members?.map((m) => m.id).sort()).toEqual(
      [viewer, admin].sort(),
    );
    expect(body.members?.[0]).toEqual({
      id: expect.any(String),
      displayName: "テスト太郎",
    });
  });

  it.each([
    [MEMBERS_PREVIEW_LIMIT, MEMBERS_PREVIEW_LIMIT],
    [MEMBERS_PREVIEW_LIMIT + 1, MEMBERS_PREVIEW_LIMIT],
  ])(
    "#200 AC-2（計画レビュー #6）: 参加者が %i 人のとき、先頭は %i 件まで返し、memberCount は総数",
    async (total, shown) => {
      const channel = await insertChannel({
        name: `${TEST_TAG}大人数${total}`,
        purpose: "normal",
        departmentId: deptA.id,
      });
      await insertMember(channel, viewer);
      for (let i = 1; i < total; i += 1) {
        const user = await insertUser(`testuser_ch_many${pad(i)}`, deptA.id);
        await insertMember(channel, user);
      }
      const body = (await (
        await get(`/api/channels/${channel}`)
      ).json()) as DetailBody;
      expect(body.memberCount).toBe(total);
      expect(body.members).toHaveLength(shown);
    },
  );

  it("#200 AC-3: 参加していない非公開チャンネルは404 NOT_FOUND。存在しないIDと同じ応答で、存在を開示しない", async () => {
    const hidden = await insertChannel({
      name: `${TEST_TAG}隠れた非公開`,
      purpose: "normal",
      departmentId: deptA.id,
      visibility: "private",
    });
    const privateResponse = await get(`/api/channels/${hidden}`);
    const missingResponse = await get(`/api/channels/${testId("NONE")}`);
    expect(privateResponse.status).toBe(404);
    expect(missingResponse.status).toBe(404);
    const privateBody = (await privateResponse.json()) as Record<
      string,
      unknown
    >;
    const missingBody = (await missingResponse.json()) as Record<
      string,
      unknown
    >;
    expect(privateBody).toMatchObject({ code: "NOT_FOUND" });
    expect(privateBody.code).toBe(missingBody.code);
    expect(privateBody.message).toBe(missingBody.message);
  });

  it("#200 AC-3: 参加中の非公開チャンネルは200で読める", async () => {
    const mine = await insertChannel({
      name: `${TEST_TAG}参加中の非公開`,
      purpose: "normal",
      departmentId: deptA.id,
      visibility: "private",
    });
    await insertMember(mine, viewer);
    const response = await get(`/api/channels/${mine}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      visibility: "private",
      joined: true,
    });
  });

  it("#200 AC-3: アーカイブ済みは、公開でも参加中でも404 NOT_FOUND", async () => {
    const archived = await insertChannel({
      name: `${TEST_TAG}アーカイブ済み`,
      purpose: "normal",
      departmentId: deptA.id,
      archived: true,
    });
    await insertMember(archived, viewer);
    const response = await get(`/api/channels/${archived}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("#200 AC-2（認可）: 未認証は401、無効化された社員も401", async () => {
    expect(
      (await get(`/api/channels/${deptA.dedicatedChannelId}`, null)).status,
    ).toBe(401);
    expect(
      (await get(`/api/channels/${deptA.dedicatedChannelId}`, inactiveToken))
        .status,
    ).toBe(401);
  });
});

describe("#200 AC-2・AC-3 POST /api/channels/:channelId/join（EP-2-05）", () => {
  it("#200 AC-2（2-3 AC-2）: 公開チャンネルに自分で参加でき、200で channelId・roomId・joinedAt を返し、参加の監査が1件できる", async () => {
    const response = await join(deptB.dedicatedChannelId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      channelId: string;
      roomId: string;
      joinedAt: string;
    };
    expect(body).toEqual({
      channelId: deptB.dedicatedChannelId,
      roomId: deptB.dedicatedChannelId,
      joinedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(await membersOf(deptB.dedicatedChannelId)).toEqual([viewer]);
    expect(await joinAuditCount(deptB.dedicatedChannelId)).toBe(1);
    const audit = await env.DB.prepare(
      "SELECT actor_id, target_type, result FROM audit_logs WHERE action = ? AND target_id = ?",
    )
      .bind(JOIN_ACTION, deptB.dedicatedChannelId)
      .first<Record<string, string>>();
    expect(audit).toEqual({
      actor_id: viewer,
      target_type: "channel",
      result: "success",
    });
  });

  it("#200 AC-2（Q-6・計画レビュー #1）: 2回目の参加も200（べき等）で、参加の行は1件のまま、監査は増えない。1回目は監査が1件", async () => {
    const first = await join(deptB.dedicatedChannelId);
    expect(first.status).toBe(200);
    expect(await joinAuditCount(deptB.dedicatedChannelId)).toBe(1);
    const second = await join(deptB.dedicatedChannelId);
    expect(second.status).toBe(200);
    expect(await memberRowCount(deptB.dedicatedChannelId, viewer)).toBe(1);
    expect(await joinAuditCount(deptB.dedicatedChannelId)).toBe(1);
    const a = (await first.json()) as { joinedAt: string };
    const b = (await second.json()) as { joinedAt: string };
    expect(b.joinedAt).toBe(a.joinedAt);
  });

  it("#200 AC-2: すでに参加済み（自動参加など）のチャンネルへの参加は200で、監査は増えない", async () => {
    await insertMember(deptA.dedicatedChannelId, viewer);
    const response = await join(deptA.dedicatedChannelId);
    expect(response.status).toBe(200);
    expect(await joinAuditCount(deptA.dedicatedChannelId)).toBe(0);
    expect(await memberRowCount(deptA.dedicatedChannelId, viewer)).toBe(1);
  });

  it("#200 AC-2（Q-11）: 全体管理者は、他部署の専用チャンネルにも参加できる。一般社員も他部署の公開チャンネルに参加できる", async () => {
    expect((await join(deptB.dedicatedChannelId, adminToken)).status).toBe(200);
    expect(await membersOf(deptB.dedicatedChannelId)).toEqual([admin]);
    expect((await join(deptB.announcementChannelId)).status).toBe(200);
    expect(await membersOf(deptB.announcementChannelId)).toEqual([viewer]);
  });

  it("#200 AC-3: 全社連絡にも参加できる", async () => {
    const general = await companyGeneralRoomId();
    expect(general).not.toBeNull();
    const response = await join(general ?? "");
    expect(response.status).toBe(200);
    expect(await memberRowCount(general ?? "", viewer)).toBe(1);
  });

  it("#200 AC-3: 参加していない非公開チャンネルは404 NOT_FOUNDで、参加の行も監査も作らない", async () => {
    const hidden = await insertChannel({
      name: `${TEST_TAG}参加できない非公開`,
      purpose: "normal",
      departmentId: deptA.id,
      visibility: "private",
    });
    const response = await join(hidden);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(await memberRowCount(hidden, viewer)).toBe(0);
    expect(await joinAuditCount(hidden)).toBe(0);
  });

  it("#200 AC-3: 参加中の非公開チャンネルへの参加は200（べき等）で、監査は増えない", async () => {
    const mine = await insertChannel({
      name: `${TEST_TAG}参加中の非公開join`,
      purpose: "normal",
      departmentId: deptA.id,
      visibility: "private",
    });
    await insertMember(mine, viewer);
    const response = await join(mine);
    expect(response.status).toBe(200);
    expect(await joinAuditCount(mine)).toBe(0);
    expect(await memberRowCount(mine, viewer)).toBe(1);
  });

  it("#200 AC-3: アーカイブ済み、存在しないIDは404 NOT_FOUNDで、行も監査も作らない", async () => {
    const archived = await insertChannel({
      name: `${TEST_TAG}アーカイブ済みjoin`,
      purpose: "normal",
      departmentId: deptA.id,
      archived: true,
    });
    for (const target of [archived, testId("NONE")]) {
      const response = await join(target);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
      expect(await memberRowCount(target, viewer)).toBe(0);
      expect(await joinAuditCount(target)).toBe(0);
    }
  });

  it("#200 AC-2（認可）: 未認証は401、無効化された社員も401で、行も監査も作らない", async () => {
    expect((await join(deptB.dedicatedChannelId, null)).status).toBe(401);
    expect((await join(deptB.dedicatedChannelId, inactiveToken)).status).toBe(
      401,
    );
    expect(await membersOf(deptB.dedicatedChannelId)).toEqual([]);
    expect(await joinAuditCount(deptB.dedicatedChannelId)).toBe(0);
  });

  it("#200 AC-2（認可）: 許可されていない Origin からの参加は403 FORBIDDEN_ORIGINで、行も監査も作らない", async () => {
    const response = await join(deptB.dedicatedChannelId, viewerToken, {
      origin: "https://origin.invalid",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    expect(await membersOf(deptB.dedicatedChannelId)).toEqual([]);
    expect(await joinAuditCount(deptB.dedicatedChannelId)).toBe(0);
  });

  it("#200 AC-2（監査と参加は同じ batch）: 監査ログの書き込みが失敗すると、参加の行も残らず、500で詳細を返さない", async () => {
    await env.DB.exec(
      `CREATE TRIGGER unit_fail_channel_join_audit BEFORE INSERT ON audit_logs WHEN NEW.action = '${JOIN_ACTION}' BEGIN SELECT RAISE(ABORT, 'unit test failure'); END`,
    );
    const response = await join(deptB.dedicatedChannelId);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("unit test failure");
    expect(await membersOf(deptB.dedicatedChannelId)).toEqual([]);
  });

  it("#200 AC-2: 参加したチャンネルは、一覧の joined と joined=true の絞り込みに反映される", async () => {
    await join(deptB.dedicatedChannelId);
    const joinedOnly = await list(`?joined=true&departmentId=${deptB.id}`);
    expect(joinedOnly.items.map((i) => i.id)).toEqual([
      deptB.dedicatedChannelId,
    ]);
  });
});
