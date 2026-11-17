// #143-b b-AC-1・b-AC-3（2-6 AC-5①⑥、S-39、決定 Q1・Q2）: チャンネル管理の一覧（EP-2-42 GET /api/admin/channels）と1件
// （EP-2-43 GET /api/admin/channels/:channelId）を、実際のアプリ入口と隔離 D1 で確かめる結合テスト（計画 #143-b 8.1 の R1〜R4）。
// HTTP の応答コード・認可と検証の順・存在の非開示・応答の形を見る（範囲の SQL の全組は db/channel-admin.repository.db.test.ts、
// 0件の読み直しの分岐は services/channel-admin.service.test.ts）。
// 判定の順（計画 5.2）：認証 401 → 認可 403（入力の検証より先。全体管理者でもオーナーでもなければ、対象・入力によらず同じ 403）→ 入力 422 → 取得。
// 入力（計画 5.1）：q は前後の空白を除いて 1〜55 文字、state は all・active・archived、limit・cursor は共通の形。余分なクエリは 422（strict）。
// 応答：一覧 { items: AdminChannel[], nextCursor }、1件 AdminChannel。no-store。管理者には、範囲外・存在しない・案件専用は同じ 404 の本文。
// データは架空（testuser_chadmr_、[UNIT_TEST]、@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
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
import { deactivateUser } from "../../test/dm-fixtures";
import {
  failureAuditLines,
  insertModifyUser,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import { testId } from "../../test/role-fixtures";
import { COMPANY_GENERAL_ROOM_ID } from "../lib/channel-rules";
import { encodeCursor } from "../lib/cursor";

const BASE = "/api/admin/channels";
const NOT_FOUND = "チャンネルが見つかりません";
const ITEM_KEYS = [
  "archive",
  "department",
  "description",
  "id",
  "manage",
  "memberCount",
  "name",
  "purpose",
  "state",
  "version",
  "visibility",
].sort();

let deptA: SeededDepartment;
let deptB: SeededDepartment;
let admin: ModifyUser;
let ownerA: ModifyUser;
let member: ModifyUser;
let aPrivate: string;
let aArchived: string;
let aCase: string;
let bPrivate: string;
let companyNormal: string;
let logLines: string[];

const get = (path: string, token: string | null) =>
  apiRequest("GET", path, { token });

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

type Item = Record<string, unknown> & { id: string };
async function items(response: Response) {
  return ((await response.json()) as { items: Item[] }).items;
}

beforeEach(async () => {
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  deptA = await insertDepartmentWithChannels("143b結合A");
  deptB = await insertDepartmentWithChannels("143b結合B");
  admin = await insertModifyUser("testuser_chadmr_admin", deptA.id);
  ownerA = await insertModifyUser("testuser_chadmr_ownera", deptA.id);
  member = await insertModifyUser("testuser_chadmr_member", deptA.id);
  await makeGlobalAdmin(admin.userId);
  await makeOwner(ownerA.userId, deptA.id);
  aPrivate = await insertManagedChannel("143b結合A非公開", {
    departmentId: deptA.id,
    visibility: "private",
    members: [member.userId],
  });
  aArchived = await insertManagedChannel("143b結合Aアーカイブ", {
    departmentId: deptA.id,
    members: [member.userId],
  });
  await markArchived(aArchived, member.userId, `${TEST_TAG}理由`);
  aCase = await insertManagedChannel("143b結合A案件", {
    departmentId: deptA.id,
    purpose: "case",
    visibility: "private",
    members: [ownerA.userId],
  });
  bPrivate = await insertManagedChannel("143b結合B非公開", {
    departmentId: deptB.id,
    visibility: "private",
  });
  companyNormal = await insertManagedChannel("143b結合会社直属", {
    departmentId: null,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupChannelManageScenario();
});

describe("#143-b b-AC-3 一般メンバーは、対象・入力によらず同じ 403（R1）", () => {
  const paths = () => [
    BASE,
    `${BASE}?state=active&limit=5`,
    `${BASE}/${aPrivate}`,
    `${BASE}/${testId("NOROOM")}`,
    `${BASE}/not-a-ulid`,
    // 壊れた入力でも 422 ではなく 403（権限のない人に入力の規則を教えない）
    `${BASE}?state=x`,
    `${BASE}?cursor=@@@`,
    `${BASE}?q=`,
    `${BASE}?unknown=1`,
  ];

  it("#143-b b-AC-3（2-6 AC-5①・R1）: 一般メンバーには、一覧・1件（存在する・存在しない・不正な形の ID）・壊れたクエリのすべてが同じ本文の 403 FORBIDDEN", async () => {
    const bodies: string[] = [];
    for (const path of paths()) {
      const response = await get(path, member.token);
      expect(response.status, path).toBe(403);
      const body = await json(response);
      expect(body, path).toMatchObject({ code: "FORBIDDEN" });
      bodies.push(JSON.stringify(body));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("#143-b b-AC-3（R1）: 拒否は運用ログ（監査の failure）に perm.channel.edit として残る", async () => {
    await get(BASE, member.token);
    expect(
      failureAuditLines(logLines).filter(
        (line) => line.body === "perm.channel.edit",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("#143-b b-AC-3（R1）: 無効にされた全体管理者は、未ログインの 401（セッションが使えない）", async () => {
    await deactivateUser(admin.userId);
    expect((await get(BASE, admin.token)).status).toBe(401);
  });
});

describe("#143-b b-AC-1 存在の非開示（R2）", () => {
  it("#143-b b-AC-1（R2）: オーナーには、他部署の非公開・会社直属・全社連絡・案件専用・存在しない ID が、すべて同じ本文の 404「チャンネルが見つかりません」", async () => {
    const bodies: string[] = [];
    for (const id of [
      bPrivate,
      companyNormal,
      COMPANY_GENERAL_ROOM_ID,
      aCase,
      testId("NOROOM"),
    ]) {
      const response = await get(`${BASE}/${id}`, ownerA.token);
      expect(response.status, id).toBe(404);
      const body = await json(response);
      expect(body, id).toMatchObject({ code: "NOT_FOUND", message: NOT_FOUND });
      bodies.push(JSON.stringify(body));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("#143-b b-AC-1（R2）: 全体管理者にも、案件専用と存在しない ID は同じ 404", async () => {
    const one = await get(`${BASE}/${aCase}`, admin.token);
    const two = await get(`${BASE}/${testId("NOROOM")}`, admin.token);
    expect([one.status, two.status]).toEqual([404, 404]);
    expect(await json(one)).toEqual(await json(two));
  });

  it("#143-b b-AC-1（R2・C-142(5)）: オーナーは、参加していない自部署の非公開を 1件で読める（200）", async () => {
    const response = await get(`${BASE}/${aPrivate}`, ownerA.token);
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      id: aPrivate,
      visibility: "private",
    });
  });

  it("#143-b b-AC-1（R2）: オーナーの一覧に、他部署・会社直属・案件専用は出ない", async () => {
    const response = await get(`${BASE}?limit=100`, ownerA.token);
    expect(response.status).toBe(200);
    const ids = (await items(response)).map((item) => item.id);
    expect(ids).toContain(aPrivate);
    for (const id of [bPrivate, companyNormal, COMPANY_GENERAL_ROOM_ID, aCase])
      expect(ids).not.toContain(id);
  });
});

describe("#143-b b-AC-1 管理者の入力の検査（R3）", () => {
  it.each([
    ["q が空", "?q=", "q"],
    ["q が空白だけ", "?q=%20%20", "q"],
    ["q が 56 文字", `?q=${encodeURIComponent("あ".repeat(56))}`, "q"],
    ["state が不正", "?state=deleted", "state"],
    ["cursor が壊れている", "?cursor=@@@", "cursor"],
    ["limit が 101", "?limit=101", "limit"],
    ["limit が 0", "?limit=0", "limit"],
  ])(
    "#143-b b-AC-1（R3）: %s なら 422 VALIDATION_ERROR で、fields に %s を含む",
    async (_label, query, field) => {
      const response = await get(`${BASE}${query}`, ownerA.token);
      expect(response.status).toBe(422);
      const body = (await response.json()) as {
        code: string;
        fields: string[];
      };
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.fields).toContain(field);
    },
  );

  it("#143-b b-AC-1（R3）: 余分なクエリは 422", async () => {
    const response = await get(`${BASE}?unknown=1`, admin.token);
    expect(response.status).toBe(422);
    expect(await json(response)).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("#143-b b-AC-1（R3）: 1件の ID が ULID の形でなければ 422", async () => {
    const response = await get(`${BASE}/not-a-ulid`, admin.token);
    expect(response.status).toBe(422);
    expect(await json(response)).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("#143-b b-AC-1（R3）: q は前後の空白を除いて 55 文字なら 200。state は all・active・archived を受け付ける", async () => {
    const q = encodeURIComponent(` ${"あ".repeat(55)} `);
    expect((await get(`${BASE}?q=${q}`, ownerA.token)).status).toBe(200);
    for (const state of ["all", "active", "archived"])
      expect(
        (await get(`${BASE}?state=${state}`, ownerA.token)).status,
        state,
      ).toBe(200);
  });

  it("#143-b b-AC-1（R3）: 検索語の前後の空白は無視して一致させる", async () => {
    const q = encodeURIComponent("  143b結合A非公開  ");
    const response = await get(`${BASE}?q=${q}`, ownerA.token);
    expect((await items(response)).map((item) => item.id)).toEqual([aPrivate]);
  });

  it("#143-b b-AC-1（R3）: 範囲外の行の位置で作ったカーソルでも 200 で、範囲内の行だけが返る", async () => {
    const cursor = encodeCursor({ v: "", id: bPrivate });
    const response = await get(`${BASE}?cursor=${cursor}`, ownerA.token);
    expect(response.status).toBe(200);
    const ids = (await items(response)).map((item) => item.id);
    expect(ids).toContain(aPrivate);
    expect(ids).not.toContain(bPrivate);
  });
});

describe("#143-b b-AC-1 応答の形（R4）", () => {
  it("#143-b b-AC-1（R4）: 一覧は { items, nextCursor } だけで no-store。行は AdminChannel の項目だけ（件数・メッセージの中身を返さない）", async () => {
    const response = await get(`${BASE}?limit=100`, admin.token);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as {
      items: Item[];
      nextCursor: unknown;
    };
    expect(Object.keys(body).sort()).toEqual(["items", "nextCursor"]);
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items)
      expect(Object.keys(item).sort(), item.id).toEqual(ITEM_KEYS);
  });

  it("#143-b b-AC-1（R4）: 1件は AdminChannel で no-store。アーカイブ中の項目と manage の4つ", async () => {
    const response = await get(`${BASE}/${aArchived}`, ownerA.token);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual(ITEM_KEYS);
    expect(body).toMatchObject({
      id: aArchived,
      name: `${TEST_TAG}143b結合Aアーカイブ`,
      purpose: "normal",
      visibility: "public",
      department: { id: deptA.id, name: deptA.name, isActive: true },
      state: "archived",
      memberCount: 1,
      archive: {
        archivedBy: { id: member.userId, displayName: "テスト太郎" },
        reason: `${TEST_TAG}理由`,
      },
      manage: {
        canRename: false,
        canEditDescription: false,
        canArchive: false,
        canRestore: true,
      },
    });
    expect(typeof body.version).toBe("number");
    expect(typeof (body.archive as { archivedAt: unknown }).archivedAt).toBe(
      "string",
    );
  });

  it("#143-b b-AC-1（R4・D-1）: 部署の専用は purpose=department で、manage は説明の編集だけ。会社直属の department は null", async () => {
    const dedicated = await json(
      await get(`${BASE}/${deptA.dedicatedChannelId}`, ownerA.token),
    );
    expect(dedicated).toMatchObject({
      purpose: "department",
      state: "active",
      archive: null,
      manage: {
        canRename: false,
        canEditDescription: true,
        canArchive: false,
        canRestore: false,
      },
    });
    const company = await json(
      await get(`${BASE}/${companyNormal}`, admin.token),
    );
    expect(company).toMatchObject({ department: null });
  });

  it("#143-b b-AC-1（R4）: 未ログインは、一覧も1件も 401 UNAUTHENTICATED", async () => {
    for (const path of [BASE, `${BASE}/${aPrivate}`]) {
      const response = await get(path, null);
      expect(response.status, path).toBe(401);
      expect(await json(response)).toMatchObject({ code: "UNAUTHENTICATED" });
    }
  });

  it("#143-b b-AC-1（R4）: 続きがあれば nextCursor を返し、それで次のページを読める", async () => {
    const first = await get(`${BASE}?limit=1`, ownerA.token);
    const body = (await first.json()) as {
      items: Item[];
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(1);
    expect(typeof body.nextCursor).toBe("string");
    const second = await get(
      `${BASE}?limit=1&cursor=${body.nextCursor ?? ""}`,
      ownerA.token,
    );
    expect(second.status).toBe(200);
    const next = await items(second);
    expect(next).toHaveLength(1);
    expect(next[0]?.id).not.toBe(body.items[0]?.id);
  });
});
