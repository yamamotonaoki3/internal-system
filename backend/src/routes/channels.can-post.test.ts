// #201 AC-5・仮定U-14: チャンネルの詳細（EP-2-06）の canPost。参加者で、かつお知らせ専用なら権限がある人だけ真。
// 詳細の表示は can（拒否を監査に記録しない）で判定する。投稿APIだけが拒否を記録する（計画レビュー #3）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, insertReadyUser } from "../../test/api-request";
import { cleanupAuthTestData } from "../../test/auth-fixtures";
import { companyGeneralRoomId } from "../../test/company-general-fixtures";
import {
  cleanupDepartmentTestData,
  insertDepartmentWithChannels,
  insertMember,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";

type User = { userId: string; token: string };
let deptA: SeededDepartment;
let deptB: SeededDepartment;
let member: User;
let ownerA: User;
let ownerB: User;
let admin: User;
let stranger: User;
let logLines: string[];

const canPostOf = async (roomId: string, user: User) => {
  const response = await apiRequest("GET", `/api/channels/${roomId}`, {
    token: user.token,
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { canPost: boolean }).canPost;
};

beforeEach(async () => {
  logLines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deptA = await insertDepartmentWithChannels("canPostA");
  deptB = await insertDepartmentWithChannels("canPostB");
  member = await insertReadyUser("testuser_cp_member", deptA.id);
  ownerA = await insertReadyUser("testuser_cp_ownera", deptA.id);
  ownerB = await insertReadyUser("testuser_cp_ownerb", deptB.id);
  admin = await insertReadyUser("testuser_cp_admin", deptA.id);
  stranger = await insertReadyUser("testuser_cp_stranger", deptB.id);
  await makeOwner(ownerA.userId, deptA.id);
  await makeOwner(ownerB.userId, deptB.id);
  await makeGlobalAdmin(admin.userId);
  for (const user of [member, ownerA, ownerB, admin]) {
    await insertMember(deptA.announcementChannelId, user.userId);
    await insertMember(deptA.dedicatedChannelId, user.userId);
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#201 AC-5 詳細の canPost", () => {
  it.each([
    ["自部署のオーナー", true, () => ownerA],
    ["全体管理者", true, () => admin],
    ["一般の参加者", false, () => member],
    ["他部署のオーナー（参加者）", false, () => ownerB],
  ])(
    "#201 AC-5: お知らせ専用の詳細で、%s の canPost は %s",
    async (_l, expected, who) => {
      expect(await canPostOf(deptA.announcementChannelId, who())).toBe(
        expected,
      );
    },
  );

  it("#201 AC-5: 詳細を開いただけでは、拒否の監査（logger.audit）は増えない", async () => {
    await canPostOf(deptA.announcementChannelId, member);
    const audits = logLines.filter((line) => line.includes('"audit"'));
    expect(audits).toEqual([]);
  });

  it("#201 AC-1: 通常のチャンネルは参加者なら真、未参加なら偽", async () => {
    expect(await canPostOf(deptA.dedicatedChannelId, member)).toBe(true);
    expect(await canPostOf(deptA.dedicatedChannelId, stranger)).toBe(false);
  });

  it("#201 AC-5（仮定U-14）: 全社連絡は、参加している一般の社員も canPost が真", async () => {
    const general = await companyGeneralRoomId();
    expect(general).not.toBeNull();
    await insertMember(general ?? "", member.userId);
    expect(await canPostOf(general ?? "", member)).toBe(true);
  });
});
