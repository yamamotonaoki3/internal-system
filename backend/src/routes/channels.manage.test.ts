// #143-a a-AC-1〜a-AC-5（2-6 AC-4・AC-5・AC-6、3-4 AC-5）: チャンネルの名前・説明の変更（EP-2-36 PATCH /api/channels/:channelId）、
// アーカイブ（EP-2-37 POST /api/channels/:channelId/delete）、復元（EP-2-38 POST /api/channels/:channelId/restore）、
// チャンネルの詳細（EP-2-06）の version・manage、通知の一覧（EP-3-04）の reason・roomArchived を、実際のアプリ入口と隔離 D1 で確かめる結合テスト。
// HTTP の形・判定の順・存在の非開示・監査・通知の代表を見る（SQL の条件の全組は db/channel-manage.db.test.ts、0行の後の分岐は services/channel-manage.service.test.ts）。
// 応答の形（計画 #143-a「API」）：
//   PATCH  本文 { version（必須の整数）, name?, description? }（strict。name・description の少なくとも1つ）→ 200 { id, name, description, version, updatedAt }
//   delete 本文 { version, reason? }（reason は前後の空白を除いて 1〜500。空は理由なし）→ 200 { id, version, deletedAt }。再認証が要る
//   restore 本文 { version } → 200 { id, version, restoredAt }。再認証が要る
//   詳細   既存の項目に version と manage: { canRename, canEditDescription, canArchive } を足す（can で判定し、拒否を監査しない）
//   通知   一覧の各行に reason（channel.archived だけ、その回の理由。ほかは null）と roomArchived（部屋の内容を含まない
//          channel_request.approved・channel.archived・channel.restored の行だけ、チャンネルが今アーカイブ中か。ほかは false）
//   409 の文言：すでに処理「この項目はすでに処理されています」、版「ほかの人が先に変更しました。読み込み直してください」、名前「同じ名前のチャンネルがあります」
// データは架空（testuser_chman_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  MANAGE_MESSAGES,
  TEST_TAG,
  archiveEvents,
  archiveNotifications,
  channelVersion,
  cleanupChannelManageScenario,
  insertManagedChannel,
  manageAudits,
  manageSnapshot,
  managedChannelRow,
  markArchived,
} from "../../test/channel-manage-fixtures";
import {
  insertChannel,
  insertDepartmentWithChannels,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { deactivateUser } from "../../test/dm-fixtures";
import {
  REAUTH_WINDOW_MS,
  failureAuditLines,
  insertModifyUser,
  newSessionFor,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import { insertNotification } from "../../test/notification-fixtures";
import { testId } from "../../test/role-fixtures";
import { COMPANY_GENERAL_ROOM_ID } from "../lib/channel-rules";

let deptA: SeededDepartment;
let deptB: SeededDepartment;
/** 再認証済みのセッションを持つ利用者 */
let admin: ModifyUser;
let ownerA: ModifyUser;
let ownerB: ModifyUser;
let member: ModifyUser;
let member2: ModifyUser;
/** 部署 A のオーナーの、再認証していないセッション */
let ownerANoReauth: string;
let logLines: string[];

const path = (room: string) => `/api/channels/${room}`;
const patch = (room: string, body: unknown, token: string | null) =>
  apiRequest("PATCH", path(room), { token, body });
const archiveRequest = (room: string, body: unknown, token: string | null) =>
  apiRequest("POST", `${path(room)}/delete`, { token, body });
const restoreRequest = (room: string, body: unknown, token: string | null) =>
  apiRequest("POST", `${path(room)}/restore`, { token, body });
const detail = (room: string, token: string) =>
  apiRequest("GET", path(room), { token });

/** 部署 A の通常のチャンネル（既定：公開、参加者は ownerA・member・member2） */
const channelA = (
  label: string,
  options: { visibility?: "public" | "private"; members?: string[] } = {},
) =>
  insertManagedChannel(`管理${label}`, {
    departmentId: deptA.id,
    visibility: options.visibility ?? "public",
    members: options.members ?? [ownerA.userId, member.userId, member2.userId],
  });

const permissionFailures = (permission: string) =>
  failureAuditLines(logLines).filter((line) => line.body === permission);

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function notificationsOf(token: string) {
  const response = await apiRequest("GET", "/api/me/notifications?limit=100", {
    token,
  });
  expect(response.status).toBe(200);
  return (
    (await response.json()) as {
      items: {
        id: string;
        kind: string;
        roomId: string | null;
        targetId: string | null;
        reason: string | null;
        roomArchived: boolean;
      }[];
    }
  ).items;
}

beforeEach(async () => {
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  deptA = await insertDepartmentWithChannels("管理A");
  deptB = await insertDepartmentWithChannels("管理B");
  admin = await insertModifyUser("testuser_chman_admin", deptA.id, 0);
  ownerA = await insertModifyUser("testuser_chman_ownera", deptA.id, 0);
  ownerB = await insertModifyUser("testuser_chman_ownerb", deptB.id, 0);
  member = await insertModifyUser("testuser_chman_member", deptA.id, 0);
  member2 = await insertModifyUser("testuser_chman_member2", deptA.id, 0);
  await makeGlobalAdmin(admin.userId);
  await makeOwner(ownerA.userId, deptA.id);
  await makeOwner(ownerB.userId, deptB.id);
  ownerANoReauth = await newSessionFor(ownerA.userId, null);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupChannelManageScenario();
});

describe("#143 a-AC-1 名前・説明の変更（EP-2-36）の成功", () => {
  it("#143 a-AC-1（2-6 AC-5①③）: 部署のオーナーが自部署の通常のチャンネルの名前（整形して）と説明を変えると 200。詳細に反映され、監査1件・通知なし", async () => {
    const room = await channelA("改名前");
    const version = await channelVersion(room);
    const response = await patch(
      room,
      {
        version,
        name: "　ＡＢＣ管理後　",
        description: `${TEST_TAG}新しい説明`,
      },
      ownerA.token,
    );
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual(
      ["description", "id", "name", "updatedAt", "version"].sort(),
    );
    expect(body).toMatchObject({
      id: room,
      name: "ABC管理後",
      description: `${TEST_TAG}新しい説明`,
      version: version + 1,
    });
    const shown = await json(await detail(room, member.token));
    expect(shown).toMatchObject({
      name: "ABC管理後",
      description: `${TEST_TAG}新しい説明`,
      version: version + 1,
    });
    const audits = await manageAudits(room, "channel.update");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_id).toBe(ownerA.userId);
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE room_id = ?",
    )
      .bind(room)
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(0);
  });

  it("#143 a-AC-1（2-6 AC-1 の C-123 の例外）: 全体管理者は、任命されていない他部署のチャンネルと、会社直属のチャンネルの説明を変えられる", async () => {
    const roomB = await insertManagedChannel("管理他部署", {
      departmentId: deptB.id,
    });
    const company = await insertManagedChannel("管理会社直属", {
      departmentId: null,
    });
    for (const room of [roomB, company]) {
      const response = await patch(
        room,
        {
          version: await channelVersion(room),
          description: `${TEST_TAG}管理者の説明`,
        },
        admin.token,
      );
      expect(response.status).toBe(200);
    }
  });

  it("#143 a-AC-4（2-6 AC-5⑥・C-142(5)）: 参加していない非公開を、自部署のオーナーが変えられ、応答にメッセージ・参加者の中身を含めない", async () => {
    const room = await channelA("非公開未参加", {
      visibility: "private",
      members: [member.userId],
    });
    const response = await patch(
      room,
      {
        version: await channelVersion(room),
        description: `${TEST_TAG}非公開の説明`,
      },
      ownerA.token,
    );
    expect(response.status).toBe(200);
    expect(Object.keys(await json(response)).sort()).toEqual(
      ["description", "id", "name", "updatedAt", "version"].sort(),
    );
  });

  it("#143 a-AC-1（2-6 AC-5④）: 部署の専用・お知らせ専用は、自部署のオーナーが説明を変えられ、名前は 409", async () => {
    for (const room of [
      deptA.dedicatedChannelId,
      deptA.announcementChannelId,
    ]) {
      const renamed = await patch(
        room,
        { version: await channelVersion(room), name: "専用の改名" },
        ownerA.token,
      );
      expect(renamed.status).toBe(409);
      expect(await json(renamed)).toMatchObject({ code: "CONFLICT" });
      const described = await patch(
        room,
        {
          version: await channelVersion(room),
          description: `${TEST_TAG}専用の説明`,
        },
        ownerA.token,
      );
      expect(described.status).toBe(200);
    }
  });

  it("#143 a-AC-1（2-6 AC-5④）: 全社連絡は、全体管理者でも名前は 409。オーナーは説明も変えられない（403）", async () => {
    const before = await manageSnapshot(COMPANY_GENERAL_ROOM_ID);
    const version = await channelVersion(COMPANY_GENERAL_ROOM_ID);
    const renamed = await patch(
      COMPANY_GENERAL_ROOM_ID,
      { version, name: "全社の改名" },
      admin.token,
    );
    expect(renamed.status).toBe(409);
    const described = await patch(
      COMPANY_GENERAL_ROOM_ID,
      { version, description: `${TEST_TAG}オーナーの説明` },
      ownerA.token,
    );
    expect(described.status).toBe(403);
    expect(await json(described)).toMatchObject({ code: "FORBIDDEN" });
    expect(await manageSnapshot(COMPANY_GENERAL_ROOM_ID)).toEqual(before);
  });

  it("#143 a-AC-4（2-6 AC-7・D-2）: 案件専用チャンネルは、全体管理者でも名前・説明を変えられない（409）", async () => {
    const room = await insertManagedChannel("管理案件", {
      departmentId: deptA.id,
      purpose: "case",
      visibility: "private",
      members: [admin.userId],
    });
    const before = await manageSnapshot(room);
    const response = await patch(
      room,
      { version: await channelVersion(room), description: "案件の説明" },
      admin.token,
    );
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ code: "CONFLICT" });
    expect(await manageSnapshot(room)).toEqual(before);
  });

  it("#143 a-AC-1（2-2 AC-13）: 名前 50 文字・説明 500 文字は変えられる", async () => {
    const room = await channelA("境界");
    const response = await patch(
      room,
      {
        version: await channelVersion(room),
        name: "あ".repeat(50),
        description: "い".repeat(500),
      },
      ownerA.token,
    );
    expect(response.status).toBe(200);
  });
});

describe("#143 a-AC-1 名前・説明の変更の入力と競合", () => {
  it.each([
    ["version がない", { description: "説明" }, "version"],
    ["version が文字列", { version: "1", description: "説明" }, "version"],
    ["version が小数", { version: 1.5, description: "説明" }, "version"],
    ["名前が空", { version: 1, name: "" }, "name"],
    ["名前が空白だけ", { version: 1, name: "　 " }, "name"],
    ["名前が 51 文字", { version: 1, name: "あ".repeat(51) }, "name"],
    ["名前に使えない文字", { version: 1, name: "管理!" }, "name"],
    [
      "説明が 501 文字",
      { version: 1, description: "あ".repeat(501) },
      "description",
    ],
  ])(
    "#143 a-AC-1（422）: %s場合は 422 VALIDATION_ERROR で、fields に %s を含み、何も変わらない",
    async (_label, body, field) => {
      const room = await channelA("入力");
      const before = await manageSnapshot(room);
      const response = await patch(room, body, ownerA.token);
      expect(response.status).toBe(422);
      const result = (await response.json()) as {
        code: string;
        fields: string[];
      };
      expect(result.code).toBe("VALIDATION_ERROR");
      expect(result.fields).toContain(field);
      expect(await manageSnapshot(room)).toEqual(before);
    },
  );

  it.each([
    ["名前も説明もない", { version: 1 }],
    [
      "知らない項目がある（strict）",
      { version: 1, description: "x", extra: 1 },
    ],
  ])("#143 a-AC-1（422）: %s場合は 422 VALIDATION_ERROR", async (_l, body) => {
    const room = await channelA("入力の形");
    const response = await patch(room, body, ownerA.token);
    expect(response.status).toBe(422);
    expect(await json(response)).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("#143 a-AC-1（2-2 AC-13）: ほかのチャンネル（大小の違いだけ）・アーカイブ済みのチャンネルと同じ名前には変えられず 409「同じ名前のチャンネルがあります」", async () => {
    await insertChannel({
      name: "管理重複abc",
      purpose: "normal",
      departmentId: deptA.id,
    });
    const archived = await insertChannel({
      name: "管理アーカイブ済みの名前",
      purpose: "normal",
      departmentId: deptA.id,
    });
    await markArchived(archived, admin.userId);
    const room = await channelA("重複させる側");
    for (const name of ["管理重複ABC", "管理アーカイブ済みの名前"]) {
      const before = await manageSnapshot(room);
      const response = await patch(
        room,
        { version: await channelVersion(room), name },
        ownerA.token,
      );
      expect(response.status).toBe(409);
      expect(await json(response)).toMatchObject({
        code: "CONFLICT",
        message: MANAGE_MESSAGES.duplicateName,
      });
      expect(await manageSnapshot(room)).toEqual(before);
    }
  });

  it("#143 版（重大2）: 同じ版から2人が変えると、後のほうは 409「ほかの人が先に変更しました。読み込み直してください」で、先の変更が残る", async () => {
    const room = await channelA("同じ版");
    const version = await channelVersion(room);
    const first = await patch(
      room,
      { version, description: `${TEST_TAG}先` },
      ownerA.token,
    );
    expect(first.status).toBe(200);
    const second = await patch(
      room,
      { version, description: `${TEST_TAG}後` },
      admin.token,
    );
    expect(second.status).toBe(409);
    expect(await json(second)).toMatchObject({
      code: "CONFLICT",
      message: MANAGE_MESSAGES.versionMismatch,
    });
    expect((await managedChannelRow(room))?.description).toBe(`${TEST_TAG}先`);
  });
});

describe("#143 a-AC-4 管理できない人・存在の非開示（EP-2-36）", () => {
  it.each([
    ["参加中の一般の社員", "member"],
    ["他部署のオーナー", "ownerB"],
    ["チャンネルの作成者（一般の社員）", "creator"],
  ] as const)(
    "#143 a-AC-4（2-6 AC-4・AC-5①）: 見える公開チャンネルを%sが変えると 403 FORBIDDEN。拒否が監査（perm.channel.edit・failure）に残り、何も変わらない",
    async (_label, who) => {
      const room = await channelA(`拒否${who}`);
      if (who === "creator")
        await env.DB.prepare(
          "UPDATE channels SET created_by = ? WHERE room_id = ?",
        )
          .bind(member.userId, room)
          .run();
      const token = who === "ownerB" ? ownerB.token : member.token;
      const before = await manageSnapshot(room);
      logLines.length = 0;
      const response = await patch(
        room,
        { version: await channelVersion(room), description: "拒否" },
        token,
      );
      expect(response.status).toBe(403);
      expect(await json(response)).toMatchObject({ code: "FORBIDDEN" });
      expect(permissionFailures("perm.channel.edit")).toHaveLength(1);
      expect(await manageSnapshot(room)).toEqual(before);
    },
  );

  it("#143 a-AC-4（security）: 参加していない非公開（範囲外）・存在しない・アーカイブ済み（全体管理者にも）は同じ 404 で、拒否の監査を残さない", async () => {
    const hidden = await insertManagedChannel("管理他部署の非公開", {
      departmentId: deptB.id,
      visibility: "private",
      members: [ownerB.userId],
    });
    const archived = await channelA("アーカイブ済みの変更");
    await markArchived(archived, ownerA.userId);
    const cases: [string, string][] = [
      [hidden, ownerA.token],
      [testId("NONE"), ownerA.token],
      [archived, admin.token],
      [archived, ownerA.token],
    ];
    const bodies: Record<string, unknown>[] = [];
    logLines.length = 0;
    for (const [room, token] of cases) {
      const response = await patch(
        room,
        { version: 1, description: "見えない" },
        token,
      );
      expect(response.status).toBe(404);
      bodies.push(await json(response));
    }
    expect(bodies[0]).toMatchObject({
      code: "NOT_FOUND",
      message: MANAGE_MESSAGES.notFound,
    });
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(permissionFailures("perm.channel.edit")).toEqual([]);
  });

  it("#143 a-AC-1（認証）: 未認証は 401、許可されていない Origin は 403 FORBIDDEN_ORIGIN、パスが ULID でなければ 422", async () => {
    const room = await channelA("認証");
    const body = { version: 1, description: "x" };
    expect((await patch(room, body, null)).status).toBe(401);
    const origin = await apiRequest("PATCH", path(room), {
      token: ownerA.token,
      body,
      origin: "https://origin.invalid",
    });
    expect(origin.status).toBe(403);
    expect(await json(origin)).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    expect((await patch("not-a-ulid", body, ownerA.token)).status).toBe(422);
  });
});

describe("#143 a-AC-2・a-AC-5 アーカイブ（EP-2-37）", () => {
  it("#143 a-AC-2・a-AC-5（D-5）: 自部署のオーナーが再認証してアーカイブすると 200。参加者（本人・無効な社員を除く）に通知し、理由は前後の空白を除いて記録する", async () => {
    const inactive = await insertModifyUser(
      "testuser_chman_inactive",
      deptA.id,
    );
    const room = await channelA("アーカイブ", {
      members: [ownerA.userId, member.userId, member2.userId, inactive.userId],
    });
    await deactivateUser(inactive.userId);
    const version = await channelVersion(room);
    const response = await archiveRequest(
      room,
      { version, reason: `  ${TEST_TAG}理由  ` },
      ownerA.token,
    );
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual(
      ["deletedAt", "id", "version"].sort(),
    );
    expect(body).toMatchObject({ id: room, version: version + 1 });
    const events = await archiveEvents(room);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      archived_by: ownerA.userId,
      reason: `${TEST_TAG}理由`,
    });
    expect(
      (await archiveNotifications(room, "channel.archived")).map(
        (row) => row.user_id,
      ),
    ).toEqual([member.userId, member2.userId].sort());
    expect(
      JSON.parse(
        (await manageAudits(room, "channel.archive"))[0]?.detail ?? "null",
      ),
    ).toEqual({ hasReason: true });
  });

  it("#143 a-AC-2（V-48）: 理由が空白だけなら理由なしで 200、500 文字は 200、501 文字は 422（fields に reason）", async () => {
    const blank = await channelA("理由空白");
    expect(
      (
        await archiveRequest(
          blank,
          { version: await channelVersion(blank), reason: "　 " },
          ownerA.token,
        )
      ).status,
    ).toBe(200);
    expect((await archiveEvents(blank))[0]?.reason).toBeNull();

    const max = await channelA("理由500");
    expect(
      (
        await archiveRequest(
          max,
          { version: await channelVersion(max), reason: "あ".repeat(500) },
          ownerA.token,
        )
      ).status,
    ).toBe(200);

    const over = await channelA("理由501");
    const before = await manageSnapshot(over);
    const response = await archiveRequest(
      over,
      { version: await channelVersion(over), reason: "あ".repeat(501) },
      ownerA.token,
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { fields: string[] }).fields).toContain(
      "reason",
    );
    expect(await manageSnapshot(over)).toEqual(before);
  });

  it.each([
    ["version がない", { reason: "x" }],
    ["version が文字列", { version: "1" }],
    ["知らない項目がある（strict）", { version: 1, extra: true }],
  ])("#143 a-AC-2（422）: %s場合は 422", async (_l, body) => {
    const room = await channelA("アーカイブの入力");
    const response = await archiveRequest(room, body, ownerA.token);
    expect(response.status).toBe(422);
    expect(await json(response)).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("#143 a-AC-2（2-6 AC-6）: 再認証していない・期限を過ぎたセッションは 403 REAUTH_REQUIRED で、何も変わらない", async () => {
    const room = await channelA("再認証なし");
    const before = await manageSnapshot(room);
    const expired = await newSessionFor(ownerA.userId, REAUTH_WINDOW_MS + 1000);
    for (const token of [ownerANoReauth, expired]) {
      const response = await archiveRequest(
        room,
        { version: await channelVersion(room) },
        token,
      );
      expect(response.status).toBe(403);
      expect(await json(response)).toMatchObject({ code: "REAUTH_REQUIRED" });
    }
    expect(await manageSnapshot(room)).toEqual(before);
  });

  it("#143 a-AC-4（計画「判定の順」）: 見える公開チャンネルを管理できない人は、再認証がなくても 403 FORBIDDEN（REAUTH_REQUIRED ではない）", async () => {
    const room = await channelA("権限が先");
    const noReauth = await newSessionFor(member.userId, null);
    logLines.length = 0;
    const response = await archiveRequest(
      room,
      { version: await channelVersion(room) },
      noReauth,
    );
    expect(response.status).toBe(403);
    expect(await json(response)).toMatchObject({ code: "FORBIDDEN" });
    expect(permissionFailures("perm.channel.delete")).toHaveLength(1);
  });

  it("#143 a-AC-4（security）: 範囲外の参加していない非公開は、再認証がなくても 404 で、拒否の監査を残さない", async () => {
    const hidden = await insertManagedChannel("管理他部署の非公開A", {
      departmentId: deptB.id,
      visibility: "private",
      members: [ownerB.userId],
    });
    logLines.length = 0;
    const response = await archiveRequest(
      hidden,
      { version: 1 },
      ownerANoReauth,
    );
    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({ code: "NOT_FOUND" });
    expect(permissionFailures("perm.channel.delete")).toEqual([]);
  });

  it("#143 a-AC-2（2-6 AC-5②）: 部署の専用・お知らせ専用・全社連絡はアーカイブできない（409）", async () => {
    for (const [room, token] of [
      [deptA.dedicatedChannelId, ownerA.token],
      [deptA.announcementChannelId, ownerA.token],
      [COMPANY_GENERAL_ROOM_ID, admin.token],
    ] as const) {
      const before = await manageSnapshot(room);
      const response = await archiveRequest(
        room,
        { version: await channelVersion(room) },
        token,
      );
      expect(response.status).toBe(409);
      expect(await json(response)).toMatchObject({ code: "CONFLICT" });
      expect(await manageSnapshot(room)).toEqual(before);
    }
  });

  it("#143 a-AC-2: すでにアーカイブ済みなら 409「この項目はすでに処理されています」で、通知を重ねない", async () => {
    const room = await channelA("二重");
    await markArchived(room, admin.userId);
    const before = await manageSnapshot(room);
    const response = await archiveRequest(
      room,
      { version: await channelVersion(room) },
      ownerA.token,
    );
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      code: "CONFLICT",
      message: MANAGE_MESSAGES.alreadyProcessed,
    });
    expect(await manageSnapshot(room)).toEqual(before);
  });

  it("#143 版（重大2）: 古い版のアーカイブは 409（版の文言）", async () => {
    const room = await channelA("古い版");
    const version = await channelVersion(room);
    await patch(room, { version, description: "先の変更" }, admin.token);
    const response = await archiveRequest(room, { version }, ownerA.token);
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      message: MANAGE_MESSAGES.versionMismatch,
    });
  });

  it("#143 a-AC-4（2-6 AC-5⑥）: 全体管理者は、参加していない他部署の非公開をアーカイブでき、応答に中身を含めない", async () => {
    const room = await insertManagedChannel("管理他部署の非公開B", {
      departmentId: deptB.id,
      visibility: "private",
      members: [ownerB.userId],
    });
    const response = await archiveRequest(
      room,
      { version: await channelVersion(room) },
      admin.token,
    );
    expect(response.status).toBe(200);
    expect(Object.keys(await json(response)).sort()).toEqual(
      ["deletedAt", "id", "version"].sort(),
    );
  });

  it("#143 a-AC-2（認証）: 未認証は 401、許可されていない Origin は 403 FORBIDDEN_ORIGIN", async () => {
    const room = await channelA("アーカイブの認証");
    expect((await archiveRequest(room, { version: 1 }, null)).status).toBe(401);
    const origin = await apiRequest("POST", `${path(room)}/delete`, {
      token: ownerA.token,
      body: { version: 1 },
      origin: "https://origin.invalid",
    });
    expect(origin.status).toBe(403);
    expect(await json(origin)).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
  });
});

describe("#143 a-AC-3・a-AC-5 復元（EP-2-38）", () => {
  it("#143 a-AC-3（C-132）: 全体管理者がアーカイブしたものを、自部署のオーナーが再認証して復元すると 200。参加者に通知し、元の参加者・名前のまま見える", async () => {
    const room = await channelA("復元");
    await markArchived(room, admin.userId, `${TEST_TAG}理由`);
    const version = await channelVersion(room);
    const response = await restoreRequest(room, { version }, ownerA.token);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual(
      ["id", "restoredAt", "version"].sort(),
    );
    expect(body).toMatchObject({ id: room, version: version + 1 });
    expect(
      (await archiveNotifications(room, "channel.restored")).map(
        (row) => row.user_id,
      ),
    ).toEqual([member.userId, member2.userId].sort());
    const shown = await detail(room, member.token);
    expect(shown.status).toBe(200);
    const shownBody = (await shown.json()) as {
      joined: boolean;
      members: { id: string }[];
    };
    expect(shownBody.joined).toBe(true);
    expect(shownBody.members.map((m) => m.id).sort()).toEqual(
      [ownerA.userId, member.userId, member2.userId].sort(),
    );
    expect(await manageAudits(room, "channel.restore")).toHaveLength(1);
  });

  it("#143 a-AC-3（EP-2-38）: アーカイブしていないものは 409", async () => {
    const room = await channelA("復元の対象なし");
    const response = await restoreRequest(
      room,
      { version: await channelVersion(room) },
      ownerA.token,
    );
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ code: "CONFLICT" });
  });

  it("#143 a-AC-3（2-6 AC-6）: 再認証がなければ 403 REAUTH_REQUIRED で、復元しない", async () => {
    const room = await channelA("復元の再認証");
    await markArchived(room, ownerA.userId);
    const before = await manageSnapshot(room);
    const response = await restoreRequest(
      room,
      { version: await channelVersion(room) },
      ownerANoReauth,
    );
    expect(response.status).toBe(403);
    expect(await json(response)).toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(await manageSnapshot(room)).toEqual(before);
  });

  it("#143 a-AC-4（security）: アーカイブ中のチャンネルを、参加者の一般の社員・他部署のオーナーが復元しようとしても 404（存在を開示しない）", async () => {
    const room = await channelA("復元の非開示");
    await markArchived(room, ownerA.userId);
    for (const token of [member.token, ownerB.token]) {
      const response = await restoreRequest(
        room,
        { version: await channelVersion(room) },
        token,
      );
      expect(response.status).toBe(404);
    }
  });

  it("#143 版（重大2）: アーカイブの前に読んだ版での復元は 409（版の文言）", async () => {
    const room = await channelA("復元の版");
    const old = await channelVersion(room);
    await markArchived(room, ownerA.userId);
    const response = await restoreRequest(room, { version: old }, ownerA.token);
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      message: MANAGE_MESSAGES.versionMismatch,
    });
  });

  it.each([
    ["version がない", {}],
    ["知らない項目がある（strict）", { version: 1, reason: "x" }],
  ])("#143 a-AC-3（422）: %s場合は 422", async (_l, body) => {
    const room = await channelA("復元の入力");
    await markArchived(room, ownerA.userId);
    const response = await restoreRequest(room, body, ownerA.token);
    expect(response.status).toBe(422);
  });
});

describe("#143 a-AC-6 チャンネルの詳細の version・manage（表示用）", () => {
  it.each([
    [
      "自部署のオーナー・通常",
      "ownerA",
      "normal",
      { canRename: true, canEditDescription: true, canArchive: true },
    ],
    [
      "参加中の一般の社員・通常",
      "member",
      "normal",
      { canRename: false, canEditDescription: false, canArchive: false },
    ],
    [
      "他部署のオーナー・通常（公開）",
      "ownerB",
      "normal",
      { canRename: false, canEditDescription: false, canArchive: false },
    ],
    [
      "自部署のオーナー・部署の専用",
      "ownerA",
      "dedicated",
      { canRename: false, canEditDescription: true, canArchive: false },
    ],
    [
      "全体管理者・全社連絡",
      "admin",
      "companyGeneral",
      { canRename: false, canEditDescription: true, canArchive: false },
    ],
    [
      "全体管理者・他部署の通常",
      "admin",
      "otherDept",
      { canRename: true, canEditDescription: true, canArchive: true },
    ],
  ] as const)(
    "#143 a-AC-6: %s → manage は計画のとおり。version を返し、拒否を監査に残さない",
    async (_label, who, target, expected) => {
      const users = { ownerA, member, ownerB, admin } as const;
      const room =
        target === "normal"
          ? await channelA("詳細")
          : target === "dedicated"
            ? deptA.dedicatedChannelId
            : target === "companyGeneral"
              ? COMPANY_GENERAL_ROOM_ID
              : await insertManagedChannel("管理詳細他部署", {
                  departmentId: deptB.id,
                });
      logLines.length = 0;
      const response = await detail(room, users[who].token);
      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body.manage).toEqual(expected);
      expect(body.version).toBe(await channelVersion(room));
      expect(failureAuditLines(logLines)).toEqual([]);
    },
  );
});

describe("#143 a-AC-5（3-4 AC-5・重大3）過去の通知の reason・roomArchived", () => {
  it("#143 a-AC-5: 参加者の通知の一覧に、アーカイブの通知が理由つきで残り、roomArchived は真。未読数にも数える", async () => {
    const room = await channelA("通知の一覧");
    await archiveRequest(
      room,
      { version: await channelVersion(room), reason: `${TEST_TAG}統合のため` },
      ownerA.token,
    );
    const items = (await notificationsOf(member.token)).filter(
      (item) => item.roomId === room,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "channel.archived",
      reason: `${TEST_TAG}統合のため`,
      roomArchived: true,
    });
    const count = await apiRequest(
      "GET",
      "/api/me/notifications/unread-count",
      {
        token: member.token,
      },
    );
    expect(((await count.json()) as { count: number }).count).toBe(1);
  });

  it("#143 a-AC-5（重大1）: 復元の後は roomArchived が偽に戻り、再アーカイブで別の理由にしても、古い通知は古い理由のまま", async () => {
    const room = await channelA("理由の履歴");
    await archiveRequest(
      room,
      { version: await channelVersion(room), reason: `${TEST_TAG}1回目` },
      ownerA.token,
    );
    await restoreRequest(
      room,
      { version: await channelVersion(room) },
      ownerA.token,
    );
    const afterRestore = (await notificationsOf(member.token)).filter(
      (item) => item.roomId === room,
    );
    expect(afterRestore.map((i) => [i.kind, i.roomArchived]).sort()).toEqual(
      [
        ["channel.archived", false],
        ["channel.restored", false],
      ].sort(),
    );
    expect(
      afterRestore.find((i) => i.kind === "channel.restored")?.reason,
    ).toBeNull();

    await archiveRequest(
      room,
      { version: await channelVersion(room), reason: `${TEST_TAG}2回目` },
      ownerA.token,
    );
    const archived = (await notificationsOf(member.token)).filter(
      (item) => item.roomId === room && item.kind === "channel.archived",
    );
    expect(archived.map((i) => i.reason).sort()).toEqual(
      [`${TEST_TAG}1回目`, `${TEST_TAG}2回目`].sort(),
    );
    expect(archived.every((i) => i.roomArchived)).toBe(true);
  });

  it("#143 a-AC-5（重大3・D-R1）: アーカイブの後、申請の承認の通知は残って roomArchived が真、指名の通知は一覧から除かれ、案件の承認の通知の roomArchived は偽のまま", async () => {
    const room = await channelA("過去の通知");
    const approved = await insertNotification({
      userId: member.userId,
      kind: "channel_request.approved",
      roomId: room,
      id: testId("NTFA"),
    });
    const mentioned = await insertNotification({
      userId: member.userId,
      kind: "message.mentioned",
      roomId: room,
      id: testId("NTFM"),
    });
    const caseApproved = await insertNotification({
      userId: member.userId,
      kind: "case_request.approved",
      roomId: room,
      id: testId("NTFC"),
    });
    await archiveRequest(
      room,
      { version: await channelVersion(room) },
      ownerA.token,
    );
    const items = await notificationsOf(member.token);
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(approved)).toMatchObject({
      roomArchived: true,
      reason: null,
    });
    expect(byId.has(mentioned)).toBe(false);
    expect(byId.get(caseApproved)).toMatchObject({ roomArchived: false });
  });

  it("#143 a-AC-5（security）: アーカイブ中のチャンネルの詳細・メッセージは、通知を受けた参加者にも、存在しないチャンネルと同じ 404", async () => {
    const room = await channelA("通知の後の詳細");
    await archiveRequest(
      room,
      { version: await channelVersion(room) },
      ownerA.token,
    );
    const archivedBody = await json(await detail(room, member.token));
    const missingBody = await json(await detail(testId("NONE"), member.token));
    expect(archivedBody).toEqual(missingBody);
    expect(archivedBody).toMatchObject({ code: "NOT_FOUND" });
  });
});
