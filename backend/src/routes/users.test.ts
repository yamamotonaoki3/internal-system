// #130 AC-1（0-4 AC-4・AC-5・AC-6・AC-10・AC-11）・AC-2（6-1 AC-4）・AC-3（7-3 AC-1〜AC-4）：/api/users のルート（社員一覧 EP-7-01・部署の候補・
// プロフィールカード EP-0-18・ステータスの代理設定 EP-0-15）を、実際のアプリ入口と隔離 D1 で確かめる。時刻は Date だけを PROFILE_NOW に固定する。
// 公開形の仮定（契約。計画 1章）：
//  - GET /api/users?departmentId&limit&cursor → { items: [{ id, displayName, department:{id,name}, extension, email, status:{kind,returnAt,message}, canSetStatus }], nextCursor }
//    並びは displayName・id の昇順。有効かつ所属ありの社員だけ。本名は含めない
//  - GET /api/users/departments → { items: [{ id, name }] }（有効な部署だけ・名前順）
//  - GET /api/users/:userId/profile-card → { userId, displayName, legalName, department:{id,name}|null, status:{kind,returnAt,message} }
//  - PUT /api/users/:userId/status 本文 { status, returnAt? }（strict。一言は扱わない）
// データは架空（testuser_prof_・テスト太郎・テスト花子・@example.com・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROFILE_NOW,
  cleanupProfileTestData,
  detailKeys,
  failAuditOf,
  insertProfileUser,
  makeProfileGlobalAdmin,
  makeProfileOwner,
  newProfileContext,
  profileAuditRows,
  profileRequest,
  sessionTokenFor,
  userStatusRow,
  type ProfileContext,
} from "../../test/profile-fixtures";
import { insertDepartment } from "../../test/role-fixtures";
import { isUlid } from "../lib/ulid";

// 形式は正しい（isUlid を通る）が、存在しない利用者のID
const MISSING_USER_ID = "01JTESTPR0F0N0NE000000000Z";

type DirectoryItem = {
  id: string;
  displayName: string;
  department: { id: string; name: string };
  extension: string | null;
  email: string;
  status: { kind: string; returnAt: string | null; message: string | null };
  canSetStatus: boolean;
};
type DirectoryPage = { items: DirectoryItem[]; nextCursor: string | null };

let context: ProfileContext;
let deptA: string;
let deptB: string;
let deptHq: string;
let inactiveDept: string;
let ownerA: string;
let memberA1: string;
let memberA2: string;
let inactiveA: string;
let memberB1: string;
let admin: string;
let noDeptActive: string;
let ownerToken: string;
let memberToken: string;
let adminToken: string;
let logLines: string[];

const HOUR = 60 * 60 * 1000;
const iso = (ms: number) => new Date(PROFILE_NOW.getTime() + ms).toISOString();
const ONE_YEAR_LATER = "2027-11-11T00:00:00.000Z";

const get = (path: string, token: string | null) =>
  profileRequest(context, "GET", path, { token });
const putStatus = (
  userId: string,
  token: string | null,
  body: unknown,
  options: { origin?: string | null } = {},
) =>
  profileRequest(context, "PUT", `/api/users/${userId}/status`, {
    token,
    body,
    ...options,
  });

async function listAll(token: string, query = ""): Promise<DirectoryItem[]> {
  const items: DirectoryItem[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i += 1) {
    const params = new URLSearchParams(query);
    params.set("limit", "100");
    if (cursor !== null) params.set("cursor", cursor);
    const res = await get(`/api/users?${params.toString()}`, token);
    expect(res.status).toBe(200);
    const page = (await res.json()) as DirectoryPage;
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return items;
  }
  throw new Error("一覧のページが終わりませんでした");
}

const auditLogLines = () =>
  logLines
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter(
      (line) =>
        (line.attributes as Record<string, unknown> | undefined)?.log_type ===
        "audit",
    );

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(PROFILE_NOW);
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  context = newProfileContext();
  deptA = await insertDepartment("プロフA営業");
  deptB = await insertDepartment("プロフB開発");
  deptHq = await insertDepartment("プロフC本部");
  inactiveDept = await insertDepartment("プロフD廃止");
  await env.DB.prepare("UPDATE departments SET is_active = 0 WHERE id = ?")
    .bind(inactiveDept)
    .run();
  ownerA = await insertProfileUser(context, "testuser_prof_owner_a", deptA, {
    displayName: "テストA長",
    legalName: "テスト本名オーナー",
  });
  memberA1 = await insertProfileUser(context, "testuser_prof_a1", deptA, {
    displayName: "テストA一",
    legalName: "テスト本名A一",
  });
  memberA2 = await insertProfileUser(context, "testuser_prof_a2", deptA, {
    displayName: "テストA二",
    legalName: "テスト本名A二",
  });
  inactiveA = await insertProfileUser(context, "testuser_prof_a_off", deptA, {
    displayName: "テストA無効",
    isActive: false,
  });
  memberB1 = await insertProfileUser(context, "testuser_prof_b1", deptB, {
    displayName: "テストB一",
    legalName: "テスト本名B一",
    extension: null,
  });
  admin = await insertProfileUser(context, "testuser_prof_admin", deptHq, {
    displayName: "テスト管理者",
  });
  noDeptActive = await insertProfileUser(
    context,
    "testuser_prof_nodept",
    null,
    { displayName: "テスト所属なし", legalName: "テスト本名所属なし" },
  );
  await makeProfileOwner(ownerA, deptA);
  await makeProfileGlobalAdmin(admin);
  ownerToken = await sessionTokenFor(ownerA);
  memberToken = await sessionTokenFor(memberA1);
  adminToken = await sessionTokenFor(admin);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupProfileTestData();
});

describe("#130 AC-3（7-3 AC-1・AC-2）GET /api/users 社員一覧", () => {
  it("#130 AC-3（7-3 AC-1）: 未認証は 401", async () => {
    const res = await get("/api/users", null);
    expect(res.status).toBe(401);
  });

  it("#130 AC-3（7-3 AC-1）: 一般メンバーも閲覧でき、有効かつ所属ありの社員だけが出る（無効化済み・所属なしは出ない）", async () => {
    const ids = (await listAll(memberToken)).map((item) => item.id);
    for (const id of [ownerA, memberA1, memberA2, memberB1, admin])
      expect(ids).toContain(id);
    expect(ids).not.toContain(inactiveA);
    expect(ids).not.toContain(noDeptActive);
  });

  it("#130 AC-3（7-3 AC-2）: 項目は id・表示名・部署・内線・メール・ステータス・canSetStatus だけ（キーの集合を照合。本名を含まない）", async () => {
    const res = await get(`/api/users?departmentId=${deptA}`, memberToken);
    expect(res.status).toBe(200);
    const page = (await res.json()) as DirectoryPage;
    expect(Object.keys(page).sort()).toEqual(["items", "nextCursor"]);
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(
        [
          "canSetStatus",
          "department",
          "displayName",
          "email",
          "extension",
          "id",
          "status",
        ].sort(),
      );
      expect(Object.keys(item.department).sort()).toEqual(["id", "name"]);
      expect(Object.keys(item.status).sort()).toEqual(
        ["kind", "message", "returnAt"].sort(),
      );
    }
    const body = JSON.stringify(page);
    expect(body).not.toContain("legalName");
    expect(body).not.toContain("テスト本名");
  });

  it("#130 AC-2（6-1 AC-4）・AC-3（7-3 AC-2）: 各行に部署とステータスが一緒に出て、値が正しい", async () => {
    await env.DB.prepare(
      "UPDATE users SET status_kind = 'away', status_return_at = ?, status_message = 'テスト外出' WHERE id = ?",
    )
      .bind(iso(HOUR), memberA1)
      .run();
    const items = await listAll(memberToken, `departmentId=${deptA}`);
    expect(items.find((item) => item.id === memberA1)).toEqual({
      id: memberA1,
      displayName: "テストA一",
      department: { id: deptA, name: "[UNIT_TEST]プロフA営業" },
      extension: "1234",
      email: "testuser_prof_a1@example.com",
      status: { kind: "away", returnAt: iso(HOUR), message: "テスト外出" },
      canSetStatus: false,
    });
    expect(items.find((item) => item.id === memberA2)?.status).toEqual({
      kind: "available",
      returnAt: null,
      message: null,
    });
  });

  it("#130 AC-3（7-3 AC-2）: 内線がない社員は extension が null", async () => {
    const items = await listAll(memberToken, `departmentId=${deptB}`);
    expect(items.find((item) => item.id === memberB1)?.extension).toBeNull();
  });
});

describe("#130 AC-3（7-3 AC-3）部署での絞り込みとページング", () => {
  it("#130 AC-3（7-3 AC-3）: departmentId で絞り込める（他部署が混ざらない）", async () => {
    const items = await listAll(memberToken, `departmentId=${deptA}`);
    expect(items.map((item) => item.id).sort()).toEqual(
      [ownerA, memberA1, memberA2].sort(),
    );
    expect(items.every((item) => item.department.id === deptA)).toBe(true);
  });

  it("#130 AC-3（7-3 AC-3・P-9）: 並びは表示名・ID の昇順", async () => {
    const items = await listAll(memberToken, `departmentId=${deptA}`);
    const keys = items.map((item) => [item.displayName, item.id] as const);
    const sorted = [...keys].sort((x, y) =>
      x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1,
    );
    expect(keys).toEqual(sorted);
  });

  it.each([
    ["不正な departmentId", "departmentId=abc"],
    ["空の departmentId", "departmentId="],
    ["未知のクエリ", "role=owner"],
    ["limit=0", "limit=0"],
    ["limit=101", "limit=101"],
    ["壊れたカーソル", "cursor=%%%"],
    ["形は正しいが中身が壊れたカーソル", "cursor=eyJ2IjoxfQ"],
  ])("#130 AC-3（7-3 AC-3）: %s は 422", async (_label, query) => {
    const res = await get(`/api/users?${query}`, memberToken);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("#130 AC-3（7-3 AC-3）: 21件で既定の20件と nextCursor が出て、続きに重複・欠落がない（同じ表示名が続いても欠落しない）", async () => {
    const deptP = await insertDepartment("プロフEページ");
    const created: string[] = [];
    for (let i = 0; i < 21; i += 1)
      created.push(
        await insertProfileUser(
          context,
          `testuser_prof_page_${String(i).padStart(2, "0")}`,
          deptP,
          { displayName: i < 15 ? "テスト同名" : `テスト別名${i}` },
        ),
      );
    const first = await get(`/api/users?departmentId=${deptP}`, memberToken);
    expect(first.status).toBe(200);
    const page1 = (await first.json()) as DirectoryPage;
    expect(page1.items).toHaveLength(20);
    expect(page1.nextCursor).not.toBeNull();
    const second = await get(
      `/api/users?departmentId=${deptP}&cursor=${encodeURIComponent(page1.nextCursor ?? "")}`,
      memberToken,
    );
    expect(second.status).toBe(200);
    const page2 = (await second.json()) as DirectoryPage;
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    const ids = [...page1.items, ...page2.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(21);
    expect([...ids].sort()).toEqual([...created].sort());
  });

  it("#130 AC-3（7-3 AC-3）: limit=1 で3ページに分けても、同じ表示名の並びで欠落しない", async () => {
    await env.DB.prepare(
      "UPDATE users SET display_name = 'テスト同名' WHERE id IN (?, ?, ?)",
    )
      .bind(ownerA, memberA1, memberA2)
      .run();
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 3; i += 1) {
      const query = new URLSearchParams({ departmentId: deptA, limit: "1" });
      if (cursor !== null) query.set("cursor", cursor);
      const res = await get(`/api/users?${query.toString()}`, memberToken);
      const page = (await res.json()) as DirectoryPage;
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    }
    expect(ids).toEqual([ownerA, memberA1, memberA2].sort());
    expect(cursor).toBeNull();
  });
});

describe("#130 AC-3（7-3 AC-3・P-8）GET /api/users/departments 部署の候補", () => {
  it("#130 AC-3（7-3 AC-3）: 未認証は 401", async () => {
    expect((await get("/api/users/departments", null)).status).toBe(401);
  });

  it("#130 AC-3（7-3 AC-3）: 一般メンバーで 200。有効な部署だけを id と name だけで、名前順に返す", async () => {
    const res = await get("/api/users/departments", memberToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: string; name: string }[];
    };
    for (const item of body.items)
      expect(Object.keys(item).sort()).toEqual(["id", "name"]);
    const ids = body.items.map((item) => item.id);
    expect(ids).not.toContain(inactiveDept);
    const ours = body.items.filter((item) =>
      [deptA, deptB, deptHq].includes(item.id),
    );
    expect(ours).toEqual([
      { id: deptA, name: "[UNIT_TEST]プロフA営業" },
      { id: deptB, name: "[UNIT_TEST]プロフB開発" },
      { id: deptHq, name: "[UNIT_TEST]プロフC本部" },
    ]);
    const names = body.items.map((item) => item.name);
    expect(names).toEqual([...names].sort());
  });
});

describe("#130 AC-1（0-4 AC-5・canSetStatus）代理設定できる行の判定", () => {
  async function canSetMap(token: string) {
    const items = await listAll(token);
    return new Map(items.map((item) => [item.id, item.canSetStatus]));
  }

  it("#130 AC-1（0-4 AC-5）: オーナーは自部署の行（自分を含む）だけ true、他部署は false", async () => {
    const map = await canSetMap(ownerToken);
    expect(map.get(ownerA)).toBe(true);
    expect(map.get(memberA1)).toBe(true);
    expect(map.get(memberA2)).toBe(true);
    expect(map.get(memberB1)).toBe(false);
    expect(map.get(admin)).toBe(false);
  });

  it("#130 AC-1（0-4 AC-5）: メンバーは全部 false、全体管理者は全部 true", async () => {
    const memberMap = await canSetMap(memberToken);
    expect([...memberMap.values()].every((value) => !value)).toBe(true);
    const adminMap = await canSetMap(adminToken);
    for (const id of [ownerA, memberA1, memberA2, memberB1, admin])
      expect(adminMap.get(id)).toBe(true);
  });

  it.each([
    ["オーナー", () => ownerToken],
    ["メンバー", () => memberToken],
    ["全体管理者", () => adminToken],
  ])(
    "#130 AC-1（0-4 AC-5）: %s の視点で、canSetStatus が true の行への PUT は 200、false の行への PUT は 403",
    async (_label, tokenOf) => {
      const token = tokenOf();
      const items = await listAll(token);
      const targets = items.filter((item) =>
        [ownerA, memberA1, memberA2, memberB1, admin].includes(item.id),
      );
      expect(targets).toHaveLength(5);
      for (const item of targets) {
        const res = await putStatus(item.id, token, { status: "meeting" });
        expect(res.status, item.displayName).toBe(
          item.canSetStatus ? 200 : 403,
        );
      }
    },
  );
});

describe("#130 AC-1（0-4 AC-5・AC-6）PUT /api/users/:userId/status 代理設定", () => {
  it("#130 AC-1（0-4 AC-5・AC-6）: 自部署のオーナーは自部署の社員に設定でき、status.proxy_set が操作者・対象・detail（部署IDと種類だけ）で残り、status_updated_by が操作者", async () => {
    await env.DB.prepare(
      "UPDATE users SET status_message = 'テスト本人の一言' WHERE id = ?",
    )
      .bind(memberA1)
      .run();
    const returnAt = iso(2 * HOUR);
    const res = await putStatus(memberA1, ownerToken, {
      status: "away",
      returnAt,
    });
    expect(res.status).toBe(200);
    const row = await userStatusRow(memberA1);
    expect(row).toMatchObject({
      status_kind: "away",
      status_message: "テスト本人の一言",
      status_updated_by: ownerA,
    });
    expect(new Date(row?.status_return_at ?? "").toISOString()).toBe(returnAt);
    const audits = await profileAuditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: ownerA,
      action: "status.proxy_set",
      target_type: "user",
      target_id: memberA1,
      result: "success",
    });
    expect(detailKeys(audits[0]?.detail ?? null)).toEqual([
      "departmentId",
      "status",
    ]);
    expect(JSON.parse(audits[0]?.detail ?? "{}")).toEqual({
      departmentId: deptA,
      status: "away",
    });
  });

  it("#130 AC-1（0-4 AC-5）: オーナーは他部署の社員に 403。値は変わらず、拒否の監査（perm.status.proxy.set・failure）がログに残る", async () => {
    const before = await userStatusRow(memberB1);
    const res = await putStatus(memberB1, ownerToken, { status: "absent" });
    expect(res.status).toBe(403);
    expect(await userStatusRow(memberB1)).toEqual(before);
    expect(await profileAuditRows()).toHaveLength(0);
    expect(
      auditLogLines().some(
        (line) =>
          line.body === "perm.status.proxy.set" &&
          (line.attributes as Record<string, unknown>).result === "failure",
      ),
    ).toBe(true);
  });

  it("#130 AC-1（0-4 AC-5）: 一般メンバーは同じ部署の社員にも 403", async () => {
    const res = await putStatus(memberA2, memberToken, { status: "absent" });
    expect(res.status).toBe(403);
    expect((await userStatusRow(memberA2))?.status_kind).toBe("available");
  });

  it("#130 AC-1（0-4 AC-5）: 全体管理者は全部署の社員に 200", async () => {
    expect(
      (await putStatus(memberA1, adminToken, { status: "absent" })).status,
    ).toBe(200);
    expect(
      (
        await putStatus(memberB1, adminToken, {
          status: "vacation",
          returnAt: iso(HOUR),
        })
      ).status,
    ).toBe(200);
    expect((await userStatusRow(memberB1))?.status_updated_by).toBe(admin);
  });

  it.each([
    ["無効化済み", () => inactiveA],
    ["所属なし", () => noDeptActive],
    ["存在しない", () => MISSING_USER_ID],
  ])("#130 AC-1（0-4 AC-5）: %s の社員は 404", async (_label, idOf) => {
    const res = await putStatus(idOf(), adminToken, { status: "absent" });
    expect(res.status).toBe(404);
    expect(await profileAuditRows()).toHaveLength(0);
  });

  it("#130 AC-1（0-4 AC-5）: 未認証は 401、許可外の Origin は 403 FORBIDDEN_ORIGIN", async () => {
    expect((await putStatus(memberA1, null, { status: "away" })).status).toBe(
      401,
    );
    const res = await putStatus(
      memberA1,
      ownerToken,
      { status: "away" },
      { origin: "https://origin.invalid" },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    expect((await userStatusRow(memberA1))?.status_kind).toBe("available");
  });

  it("#130 AC-1（0-4 AC-6）: オーナーが自分に設定すると 200 で、操作者と対象者が同じ status.proxy_set が1件残る", async () => {
    const res = await putStatus(ownerA, ownerToken, { status: "meeting" });
    expect(res.status).toBe(200);
    const audits = await profileAuditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: ownerA,
      target_id: ownerA,
      action: "status.proxy_set",
    });
  });

  it("#130 AC-1（0-4 AC-6）: 監査の挿入が失敗すると、ステータスの更新も取り消される（同じ db.batch）", async () => {
    await failAuditOf("status.proxy_set");
    const before = await userStatusRow(memberA1);
    const res = await putStatus(memberA1, ownerToken, { status: "absent" });
    expect(res.status).toBe(500);
    expect(await userStatusRow(memberA1)).toEqual(before);
    expect(await profileAuditRows()).toHaveLength(0);
  });

  it("#130 個人情報: 代理設定のログに、対象者の本名・メール・表示名を出さない", async () => {
    await putStatus(memberA1, ownerToken, {
      status: "away",
      returnAt: iso(HOUR),
    });
    await putStatus(memberB1, ownerToken, { status: "away" });
    const logs = logLines.join("\n");
    for (const value of [
      "テスト本名A一",
      "テスト本名B一",
      "testuser_prof_a1@example.com",
      "testuser_prof_b1@example.com",
      "テストA一",
      "テストB一",
    ])
      expect(logs).not.toContain(value);
  });
});

describe("#130 AC-1（0-4 AC-4・EP-0-15）代理設定の本文の検証（時刻固定）", () => {
  it("#130 AC-1（0-4 AC-4）: returnAt が過去・現在ちょうどは 422", async () => {
    for (const returnAt of [iso(-1), iso(0)]) {
      const res = await putStatus(memberA1, ownerToken, {
        status: "away",
        returnAt,
      });
      expect(res.status).toBe(422);
    }
    expect((await userStatusRow(memberA1))?.status_kind).toBe("available");
  });

  it("#130 AC-1（0-4 AC-4）: 現在＋1年ちょうどは 200、1ms 超えは 422", async () => {
    expect(
      (
        await putStatus(memberA1, ownerToken, {
          status: "vacation",
          returnAt: ONE_YEAR_LATER,
        })
      ).status,
    ).toBe(200);
    const over = new Date(new Date(ONE_YEAR_LATER).getTime() + 1).toISOString();
    expect(
      (
        await putStatus(memberA2, ownerToken, {
          status: "vacation",
          returnAt: over,
        })
      ).status,
    ).toBe(422);
  });

  it("#130 AC-1（0-4 AC-4・P-3）: available と returnAt の同時送信は 422", async () => {
    const res = await putStatus(memberA1, ownerToken, {
      status: "available",
      returnAt: iso(HOUR),
    });
    expect(res.status).toBe(422);
  });

  it("#130 AC-1（0-4 AC-4・P-3）: available を設定すると戻り予定が消える", async () => {
    await putStatus(memberA1, ownerToken, {
      status: "away",
      returnAt: iso(HOUR),
    });
    expect(
      (await putStatus(memberA1, ownerToken, { status: "available" })).status,
    ).toBe(200);
    expect((await userStatusRow(memberA1))?.status_return_at).toBeNull();
  });

  it.each([
    ["status がない", { returnAt: "2026-11-11T05:00:00.000Z" }],
    ["5種類以外", { status: "busy" }],
    [
      "一言を含む（P-5：代理設定では扱わない）",
      { status: "away", statusMessage: "テスト代理の一言" },
    ],
    ["表示名を含む", { status: "away", displayName: "テスト乗っ取り" }],
  ])(
    "#130 AC-1（0-4 AC-5・P-5）: %s は 422 で何も変わらない",
    async (_label, body) => {
      const before = await userStatusRow(memberA1);
      const res = await putStatus(memberA1, ownerToken, body);
      expect(res.status).toBe(422);
      expect(await userStatusRow(memberA1)).toEqual(before);
    },
  );
});

describe("#130 AC-1（0-4 AC-10・AC-11）GET /api/users/:userId/profile-card", () => {
  it("#130 AC-1（0-4 AC-10・AC-11）: 一般メンバーに、本名（復号値）・部署・ステータスを返す", async () => {
    await env.DB.prepare(
      "UPDATE users SET status_kind = 'meeting', status_return_at = ?, status_message = 'テスト会議中' WHERE id = ?",
    )
      .bind(iso(HOUR), memberB1)
      .run();
    const res = await get(`/api/users/${memberB1}/profile-card`, memberToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: memberB1,
      displayName: "テストB一",
      legalName: "テスト本名B一",
      department: { id: deptB, name: "[UNIT_TEST]プロフB開発" },
      status: { kind: "meeting", returnAt: iso(HOUR), message: "テスト会議中" },
    });
  });

  it("#130 AC-1（0-4 AC-11）: 未認証は 401 で本名を出さない", async () => {
    const res = await get(`/api/users/${memberB1}/profile-card`, null);
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain("テスト本名");
  });

  it.each([
    ["無効化済み", () => inactiveA],
    ["存在しない", () => MISSING_USER_ID],
  ])("#130 AC-1（0-4 AC-10）: %s の社員は 404", async (_label, idOf) => {
    const res = await get(`/api/users/${idOf()}/profile-card`, memberToken);
    expect(res.status).toBe(404);
  });

  it("#130 AC-1（0-4 AC-10）: 所属なしの社員のカードは department が null", async () => {
    const res = await get(
      `/api/users/${noDeptActive}/profile-card`,
      memberToken,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      userId: noDeptActive,
      legalName: "テスト本名所属なし",
      department: null,
    });
  });

  it("#130 個人情報: カードの本名の復号値をログに出さない", async () => {
    await get(`/api/users/${memberB1}/profile-card`, memberToken);
    expect(logLines.join("\n")).not.toContain("テスト本名B一");
  });
});

describe("#130 AC-1（0-4 AC-5・AC-10）利用者IDの形式", () => {
  it("#130: 存在しない利用者として使う ID は、ULID の形式を満たす（形式の誤りではなく不在を確かめるため）", () => {
    expect(isUlid(MISSING_USER_ID)).toBe(true);
  });

  it("#130 AC-1（0-4 AC-10）: 形式が不正な ID のカードは 422（既存の departments・channels と同じ）", async () => {
    const res = await get("/api/users/not-a-ulid/profile-card", memberToken);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("#130 AC-1（0-4 AC-5）: 形式が不正な ID への代理設定は 422 で、監査を残さない", async () => {
    const res = await putStatus("not-a-ulid", adminToken, { status: "absent" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await profileAuditRows()).toHaveLength(0);
  });
});
