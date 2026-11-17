// #143-b b-AC-2・b-AC-3（2-6 AC-6、C-124・C-132、S-38、EP-2-40）: アーカイブしたものの一覧（GET /api/admin/deleted-items）を、
// 実際のアプリ入口と隔離 D1 で確かめる結合テスト（計画 #143-b 8.1 の R1・R3・R4。範囲の SQL の全組は DB のテスト）。
// 判定の順（計画 5.2）：認証 401 → 認可 403（perm.channel.delete をどの範囲でも持たなければ、入力によらず同じ 403）→ 入力 422 → 取得。
// 入力：type（任意。いまは channel だけ。case は #151 で足すため 422）、limit・cursor。余分なクエリは 422。
// 応答：{ items: ArchivedItem[], nextCursor }。行は type・id・name・caseNumber・deletedBy・deletedAt・reason・version・department・canRestore。no-store。
// 並び：アーカイブした日時の新しい順（決定 Q2）。
// データは架空（testuser_chdelr_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  ARCHIVED_AT,
  TEST_TAG,
  cleanupChannelManageScenario,
  insertManagedChannel,
  markArchived,
} from "../../test/channel-manage-fixtures";
import {
  insertDepartmentWithChannels,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";
import {
  failureAuditLines,
  insertModifyUser,
  type ModifyUser,
} from "../../test/message-modify-fixtures";

const BASE = "/api/admin/deleted-items";
const ITEM_KEYS = [
  "canRestore",
  "caseNumber",
  "deletedAt",
  "deletedBy",
  "department",
  "id",
  "name",
  "reason",
  "type",
  "version",
].sort();

let deptA: SeededDepartment;
let deptB: SeededDepartment;
let admin: ModifyUser;
let ownerA: ModifyUser;
let member: ModifyUser;
let aArchived: string;
let aActive: string;
let bArchived: string;
let logLines: string[];

const get = (path: string, token: string | null) =>
  apiRequest("GET", path, { token });

type Item = Record<string, unknown> & { id: string };
async function body(response: Response) {
  return (await response.json()) as {
    items: Item[];
    nextCursor: string | null;
  };
}

beforeEach(async () => {
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  deptA = await insertDepartmentWithChannels("143b削除済みA");
  deptB = await insertDepartmentWithChannels("143b削除済みB");
  admin = await insertModifyUser("testuser_chdelr_admin", deptA.id);
  ownerA = await insertModifyUser("testuser_chdelr_ownera", deptA.id);
  member = await insertModifyUser("testuser_chdelr_member", deptA.id);
  await makeGlobalAdmin(admin.userId);
  await makeOwner(ownerA.userId, deptA.id);
  aArchived = await insertManagedChannel("143b削除済みA非公開", {
    departmentId: deptA.id,
    visibility: "private",
    members: [member.userId],
  });
  await markArchived(aArchived, member.userId, `${TEST_TAG}統合のため`);
  aActive = await insertManagedChannel("143b削除済みA使用中", {
    departmentId: deptA.id,
  });
  bArchived = await insertManagedChannel("143b削除済みBの部屋", {
    departmentId: deptB.id,
  });
  await markArchived(bArchived, admin.userId, null);
  await env.DB.prepare("UPDATE channels SET deleted_at = ? WHERE room_id = ?")
    .bind("2026-11-16T00:00:00.000Z", bArchived)
    .run();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupChannelManageScenario();
});

describe("#143-b b-AC-3 認可が入力の検証より先（R1）", () => {
  it.each(["", "?type=channel", "?type=case", "?cursor=@@@", "?unknown=1"])(
    "#143-b b-AC-3（2-6 AC-6・R1）: 一般メンバーは %s でも同じ 403 FORBIDDEN（422 にしない）",
    async (query) => {
      const response = await get(`${BASE}${query}`, member.token);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it("#143-b b-AC-3（R1）: 拒否は運用ログに perm.channel.delete として残る", async () => {
    await get(BASE, member.token);
    expect(
      failureAuditLines(logLines).filter(
        (line) => line.body === "perm.channel.delete",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("#143-b b-AC-2（R4）: 未ログインは 401 UNAUTHENTICATED", async () => {
    const response = await get(BASE, null);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("#143-b b-AC-2 入力の検査（R3）", () => {
  it.each([
    ["type=case（案件は #151 で足す）", "?type=case", "type"],
    ["type が不正", "?type=message", "type"],
    ["cursor が壊れている", "?cursor=@@@", "cursor"],
    ["limit が 101", "?limit=101", "limit"],
  ])(
    "#143-b b-AC-2（R3）: %s なら 422 で、fields に %s を含む",
    async (_label, query, field) => {
      const response = await get(`${BASE}${query}`, ownerA.token);
      expect(response.status).toBe(422);
      const result = (await response.json()) as {
        code: string;
        fields: string[];
      };
      expect(result.code).toBe("VALIDATION_ERROR");
      expect(result.fields).toContain(field);
    },
  );

  it("#143-b b-AC-2（R3）: 余分なクエリは 422。type=channel は 200", async () => {
    expect((await get(`${BASE}?unknown=1`, admin.token)).status).toBe(422);
    expect((await get(`${BASE}?type=channel`, admin.token)).status).toBe(200);
  });
});

describe("#143-b b-AC-2 範囲・並び・応答の形（R4）", () => {
  it("#143-b b-AC-2（C-132）: オーナーには自部署のアーカイブ済み（誰がアーカイブしたものでも・参加していない非公開も）だけが出る。使用中・他部署は出ない", async () => {
    const response = await get(BASE, ownerA.token);
    expect(response.status).toBe(200);
    expect((await body(response)).items.map((item) => item.id)).toEqual([
      aArchived,
    ]);
  });

  it("#143-b b-AC-2（決定 Q2）: 全体管理者には全部署が出て、アーカイブした日時の新しい順", async () => {
    const ids = (
      await body(await get(`${BASE}?limit=100`, admin.token))
    ).items.map((item) => item.id);
    expect(ids).not.toContain(aActive);
    expect(ids.indexOf(bArchived)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(aArchived)).toBeGreaterThan(ids.indexOf(bArchived));
  });

  it("#143-b b-AC-2（R4・EP-2-40）: { items, nextCursor } だけで no-store。行は ArchivedItem の項目だけで、値は channels と開いているアーカイブの記録から", async () => {
    const response = await get(BASE, ownerA.token);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const result = await body(response);
    expect(Object.keys(result).sort()).toEqual(["items", "nextCursor"]);
    expect(result.nextCursor).toBeNull();
    const item = result.items[0];
    expect(Object.keys(item ?? {}).sort()).toEqual(ITEM_KEYS);
    expect(item).toMatchObject({
      type: "channel",
      id: aArchived,
      name: `${TEST_TAG}143b削除済みA非公開`,
      caseNumber: null,
      deletedBy: { id: member.userId, displayName: "テスト太郎" },
      deletedAt: ARCHIVED_AT,
      reason: `${TEST_TAG}統合のため`,
      department: { id: deptA.id, name: deptA.name, isActive: true },
      canRestore: true,
    });
    expect(typeof item?.version).toBe("number");
  });

  it("#143-b b-AC-2（R4）: 理由なしは reason=null。limit=1 で続きを nextCursor で読める", async () => {
    const first = await body(await get(`${BASE}?limit=1`, admin.token));
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ id: bArchived, reason: null });
    expect(typeof first.nextCursor).toBe("string");
    const second = await body(
      await get(
        `${BASE}?limit=1&cursor=${first.nextCursor ?? ""}`,
        admin.token,
      ),
    );
    expect(second.items.map((item) => item.id)).not.toContain(bArchived);
  });
});
