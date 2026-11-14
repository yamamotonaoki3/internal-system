// #134 AC-1（1-3 AC-6・C-143(1)・改訂1 指摘2）: チャンネルの詳細（EP-2-06 GET /api/channels/:channelId）の readOnly。
// readOnly は「チャンネルの部署が無効（C-143(1)：読み取り専用）」なら true。部署のない会社直属のチャンネルは false（計画レビュー2回目の補足：
// 部署は外部結合で読み、会社直属のチャンネルを落とさない）。参加の有無にかかわらず返す（項目の追加で互換を保つ）。
// 既存の canPost は U-9 の申し送りどおり変えない（部署が無効でも、参加者の canPost は今までどおり）。
// データは架空（testuser_ro_、[UNIT_TEST]、@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, insertReadyUser } from "../../test/api-request";
import { cleanupAuthTestData } from "../../test/auth-fixtures";
import { companyGeneralRoomId } from "../../test/company-general-fixtures";
import {
  TEST_TAG,
  cleanupDepartmentTestData,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { deactivateDepartment } from "../../test/message-modify-fixtures";

type User = { userId: string; token: string };
type Detail = { readOnly?: unknown; canPost?: boolean; joined?: boolean };

let dept: SeededDepartment;
let member: User;
let stranger: User;

async function detailOf(roomId: string, user: User): Promise<Detail> {
  const response = await apiRequest("GET", `/api/channels/${roomId}`, {
    token: user.token,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Detail;
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("読み取り専用");
  member = await insertReadyUser("testuser_ro_member", dept.id);
  stranger = await insertReadyUser("testuser_ro_stranger", dept.id);
  await insertMember(dept.dedicatedChannelId, member.userId);
  await insertMember(dept.announcementChannelId, member.userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#134 AC-1（1-3 AC-6）EP-2-06 の readOnly", () => {
  it.each(["dedicatedChannelId", "announcementChannelId"] as const)(
    "#134 AC-1（1-3 AC-6）: 部署が有効なチャンネル（%s）の readOnly は false（真偽値）",
    async (key) => {
      expect((await detailOf(dept[key], member)).readOnly).toBe(false);
    },
  );

  it.each(["dedicatedChannelId", "announcementChannelId"] as const)(
    "#134 AC-1（1-3 AC-6・C-143(1)）: 部署が無効なチャンネル（%s）の readOnly は true",
    async (key) => {
      await deactivateDepartment(dept.id);
      expect((await detailOf(dept[key], member)).readOnly).toBe(true);
    },
  );

  it("#134 AC-1（1-3 AC-6）: 部署が無効な通常のチャンネル（normal）も readOnly は true", async () => {
    const roomId = await insertChannel({
      name: `${TEST_TAG}無効の部署の通常`,
      purpose: "normal",
      departmentId: dept.id,
    });
    await deactivateDepartment(dept.id);
    expect((await detailOf(roomId, member)).readOnly).toBe(true);
  });

  it("#134 AC-1（1-3 AC-6）: 未参加の公開チャンネルの詳細にも readOnly が付く（部署が無効なら true）", async () => {
    await deactivateDepartment(dept.id);
    const detail = await detailOf(dept.dedicatedChannelId, stranger);
    expect(detail.joined).toBe(false);
    expect(detail.readOnly).toBe(true);
  });

  it("#134 AC-1（計画レビュー2回目）: 部署のない会社直属のチャンネル（全社連絡）の readOnly は false で、詳細は落ちない", async () => {
    const general = (await companyGeneralRoomId()) ?? "";
    expect(general).not.toBe("");
    await insertMember(general, member.userId);
    expect((await detailOf(general, member)).readOnly).toBe(false);
    expect((await detailOf(general, stranger)).readOnly).toBe(false);
  });

  it("#134 AC-1（U-9 の申し送り）: 部署が無効でも、参加者の canPost は今までどおり（readOnly だけが変わる）", async () => {
    await deactivateDepartment(dept.id);
    const detail = await detailOf(dept.dedicatedChannelId, member);
    expect(detail.readOnly).toBe(true);
    expect(detail.canPost).toBe(true);
  });
});
