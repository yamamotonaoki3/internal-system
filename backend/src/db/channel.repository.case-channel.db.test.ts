// #146（146-B）5-1 AC-6・C-83・計画 B-2・1.4：チャンネルの一覧（channel.repository.ts の list）から、案件専用チャンネル（purpose=case）を除く。
// 案件専用チャンネルは、参加者（メンバー）の一覧にも出さない（案件の画面から開く。#147）。既存のチャンネルの見え方は変えない（退行なし）。
// この層で確かめるもの（計画 1.3）：一覧の範囲の SQL。ページ送り（limit=1）でも案件専用チャンネルが出ないこと。
// データは架空（testuser_chcase_、[UNIT_TEST]）。案件専用チャンネルの名前は [UNIT_TEST] を付けた値にする（後始末が名前で消すため）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupAuthTestData } from "../../test/auth-fixtures";
import {
  TEST_TAG,
  cleanupDepartmentTestData,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import {
  cleanupCaseRoomWorld,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { cleanupRoleTestData, insertUser } from "../../test/role-fixtures";
import { decodeCursor, type CursorPayload } from "../lib/cursor";
import { withChannels } from "./channel.repository";

let dept: SeededDepartment;
let memberId: string;
let outsiderId: string;

async function listAll(viewerId: string, joined?: boolean) {
  const ids: string[] = [];
  let cursor: CursorPayload | undefined;
  for (let i = 0; i < 100; i += 1) {
    const page = await withChannels(env, (repository) =>
      repository.list(viewerId, {
        limit: 1,
        ...(cursor === undefined ? {} : { cursor }),
        ...(joined === undefined ? {} : { joined }),
      }),
    );
    ids.push(...page.items.map((item) => item.roomId));
    if (page.nextCursor === null) return ids;
    cursor = decodeCursor(page.nextCursor);
  }
  throw new Error("一覧のページが終わりませんでした");
}

beforeEach(async () => {
  dept = await insertDepartmentWithChannels("案件チャンネル一覧");
  memberId = await insertUser("testuser_chcase_member", dept.id);
  outsiderId = await insertUser("testuser_chcase_outsider", dept.id);
});

afterEach(async () => {
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
  await cleanupRoleTestData();
});

describe("#146 5-1 AC-6・C-83 チャンネルの一覧から案件専用チャンネルを除く", () => {
  it("#146 5-1 AC-6: 案件専用チャンネル（非公開・部署なし）は、そのメンバーの一覧にも出ない。参加中の非公開の通常チャンネルは出る（退行なし）", async () => {
    const caseRoom = await insertChannel({
      name: `${TEST_TAG}QZA-261117-0001`,
      purpose: "case",
      departmentId: null,
      visibility: "private",
    });
    const privateRoom = await insertChannel({
      name: `${TEST_TAG}非公開の通常`,
      purpose: "normal",
      departmentId: dept.id,
      visibility: "private",
    });
    const publicRoom = await insertChannel({
      name: `${TEST_TAG}公開の通常`,
      purpose: "normal",
      departmentId: null,
    });
    await insertMember(caseRoom, memberId);
    await insertMember(privateRoom, memberId);

    const ids = await listAll(memberId);
    expect(ids).not.toContain(caseRoom);
    expect(ids).toContain(privateRoom);
    expect(ids).toContain(publicRoom);
    expect(ids).toContain(dept.dedicatedChannelId);
    expect(ids).toContain(dept.announcementChannelId);
  });

  it("#146 5-1 AC-6: 参加中だけの絞り込み（joined=true）でも、案件専用チャンネルは出ない", async () => {
    const caseRoom = await insertChannel({
      name: `${TEST_TAG}QZA-261117-0002`,
      purpose: "case",
      departmentId: null,
      visibility: "private",
    });
    await insertMember(caseRoom, memberId);
    expect(await listAll(memberId, true)).not.toContain(caseRoom);
  });

  it("#146 退行なし: 参加していない人には、非公開の通常チャンネルも案件専用チャンネルも出ず、公開のチャンネルは出る", async () => {
    const caseRoom = await insertChannel({
      name: `${TEST_TAG}QZA-261117-0003`,
      purpose: "case",
      departmentId: null,
      visibility: "private",
    });
    const privateRoom = await insertChannel({
      name: `${TEST_TAG}非公開2`,
      purpose: "normal",
      departmentId: dept.id,
      visibility: "private",
    });
    const publicRoom = await insertChannel({
      name: `${TEST_TAG}公開2`,
      purpose: "normal",
      departmentId: dept.id,
    });
    await insertMember(caseRoom, memberId);
    await insertMember(privateRoom, memberId);
    const ids = await listAll(outsiderId);
    expect(ids).not.toContain(caseRoom);
    expect(ids).not.toContain(privateRoom);
    expect(ids).toContain(publicRoom);
  });
});

// #148（148-A）5-2 AC-1・計画「共通の SQL の部品」：findForViewer が cases を外部結合し、案件の部屋なら caseId・caseStatus を返す（通常の部屋は null）。
// 1文のまま（N+1 にしない）。終了中の判定を Service が使う。
describe("#148 5-2 AC-1 findForViewer の案件の ID・状態", () => {
  let cw: CaseRoomWorld;
  beforeEach(async () => {
    cw = await setupCaseRoomWorld(1490);
  });
  afterEach(async () => {
    await cleanupCaseRoomWorld();
  });

  it("#148 5-2 AC-1: 進行中の案件の部屋では caseId と caseStatus 'active'、終了の案件の部屋では 'closed' を返す", async () => {
    const open = await withChannels(env, (r) =>
      r.findForViewer(cw.open.roomId, cw.w.memberS1.id),
    );
    const closed = await withChannels(env, (r) =>
      r.findForViewer(cw.closed.roomId, cw.w.memberS1.id),
    );
    expect(open).toMatchObject({
      roomId: cw.open.roomId,
      purpose: "case",
      caseId: cw.open.id,
      caseStatus: "active",
    });
    expect(closed).toMatchObject({
      roomId: cw.closed.roomId,
      caseId: cw.closed.id,
      caseStatus: "closed",
    });
  });

  it("#148 5-2 AC-1: 案件でない通常のチャンネルでは caseId・caseStatus は null（項目そのものはある）", async () => {
    const row = await withChannels(env, (r) =>
      r.findForViewer(cw.normal, cw.w.memberS1.id),
    );
    expect(row).not.toBeNull();
    expect(row).toHaveProperty("caseId", null);
    expect(row).toHaveProperty("caseStatus", null);
  });

  it("#148 5-2 AC-1: 別の案件（other）の ID を取り違えない（案件の部屋ごとに、その案件の ID）", async () => {
    const row = await withChannels(env, (r) =>
      r.findForViewer(cw.other.roomId, cw.w.memberS2.id),
    );
    expect(row).toMatchObject({ caseId: cw.other.id, caseStatus: "active" });
  });
});
