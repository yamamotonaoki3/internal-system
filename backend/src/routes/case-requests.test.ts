// #146（146-A）案件の作成申請：申請（EP-5-01）・自分の申請（EP-5-02）・取り下げ・類似件名の確認を、
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。時刻は Date だけを CASEREQ_NOW（日本時間 2026-11-17 12:00）に固定する。
// この層で確かめるもの（計画 A-9）：状態コード・応答の形・存在の非開示（同じ 404・同じ 422）・通知と監査の行・一覧の範囲。
// 判定の順は Service のテスト、DB の前提・原子性は DB のテストで確かめる。
// 期待値は要件 5-3 AC-1・AC-5〜AC-7・AC-11・AC-14、5-1 AC-19、C-130・C-132・C-141(2)(3)、3-4 AC-1・AC-3、計画 A-4〜A-6 から決める。
// 契約（実装の担当へ。テストが決めたもの）：
//  - POST /api/case-requests 本文（strict）{ clientId, title, description?, dueDate?, departmentIds, candidateIds?, resubmitOf? }
//      → 201 { ...項目, titleFormatted: boolean, hasSimilarTitle: boolean }
//      項目 = { id, title, description, dueDate, client: { id, code, name, isActive }, departments: [{ id, name, isActive }],
//               candidates: [{ userId, displayName }], status, rejectReason, caseId, resubmittedFrom, createdAt, decidedAt }
//      422 VALIDATION_ERROR：応答の最上位の fields（clientId・title・description・dueDate・departmentIds・candidateIds・resubmitOf）
//      403 FORBIDDEN「所属部署がないため申請できません」（全体管理者でない所属なし）
//  - GET /api/case-requests/mine?limit&cursor → 200 { items: 項目[], nextCursor }。本人の申請だけ、ID の降順、no-store
//  - POST /api/case-requests/:requestId/withdraw（本文なし・再認証なし）→ 200 { requestId, status: "withdrawn" }
//      他人の申請・存在しない ID は 404 NOT_FOUND（同じ本文）。決裁済み・取り下げ済みは 409 CONFLICT「この申請はすでに処理されています」
//  - GET /api/case-requests/similar-title?clientId&title → 200 { hasSimilar, formattedTitle } だけ
//  - 共通：未認証は 401 UNAUTHENTICATED、許可外の Origin の POST は 403 FORBIDDEN_ORIGIN（何も変わらない）
// データは架空（testuser_casereq_・@example.com・[UNIT_TEST] の部署と取引先）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  BAD_ORIGIN,
  BASE,
  CASEREQ_NOW,
  MESSAGES,
  TEST_TAG,
  TODAY_JST,
  YESTERDAY_JST,
  caseRequestAudits,
  caseRequestIdAt,
  caseRequestNotifications,
  caseRequestRow,
  caseRequestSnapshot,
  cleanupCaseRequestTestData,
  insertCaseRequest,
  setClientActive,
  setUserDepartment,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { isUlid } from "../lib/ulid";

type Item = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  client: { id: string; code: string; name: string; isActive: boolean };
  departments: { id: string; name: string; isActive: boolean }[];
  candidates: { userId: string; displayName: string }[];
  status: string;
  rejectReason: string | null;
  caseId: string | null;
  resubmittedFrom: string | null;
  createdAt: string;
  decidedAt: string | null;
};
type Page = { items: Item[]; nextCursor: string | null };
type ErrorBody = { code: string; message: string; fields?: string[] };

let w: CaseWorld;

const post = (
  path: string,
  token: string | null,
  body?: unknown,
  origin?: string,
) =>
  apiRequest("POST", path, {
    token,
    ...(body === undefined ? {} : { body }),
    ...(origin === undefined ? {} : { origin }),
  });
const get = (path: string, token: string | null) =>
  apiRequest("GET", path, { token });

const createBody = (overrides: Record<string, unknown> = {}) => ({
  clientId: w.clientA.id,
  title: `${TEST_TAG}保守契約`,
  departmentIds: [w.deptS.id],
  ...overrides,
});
const create = (token: string, overrides: Record<string, unknown> = {}) =>
  post(BASE, token, createBody(overrides));

async function createdId(
  token: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await create(token, overrides);
  expect(res.status).toBe(201);
  return ((await res.json()) as Item).id;
}

async function mineAll(token: string, limit = 100): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i += 1) {
    const query: string =
      cursor === null ? `limit=${limit}` : `limit=${limit}&cursor=${cursor}`;
    const res = await get(`${BASE}/mine?${query}`, token);
    expect(res.status).toBe(200);
    const page = (await res.json()) as Page;
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return items;
  }
  throw new Error("一覧のページが終わりませんでした");
}

const similar = (token: string, clientId: string, title: string) =>
  get(
    `${BASE}/similar-title?clientId=${encodeURIComponent(clientId)}&title=${encodeURIComponent(title)}`,
    token,
  );

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  w = await setupCaseWorld();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseRequestTestData();
});

describe("#146 共通：認証と Origin", () => {
  it.each([
    ["POST", BASE],
    ["GET", `${BASE}/mine`],
    ["GET", `${BASE}/similar-title?clientId=x&title=y`],
    ["POST", `${BASE}/${caseRequestIdAt(1_800_000_000_000)}/withdraw`],
  ])(
    "#146 共通: 未認証の %s %s は 401 UNAUTHENTICATED",
    async (method, path) => {
      const res = await apiRequest(method, path, {
        token: null,
        ...(method === "POST" ? { body: {} } : {}),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    },
  );

  it("#146 共通: 許可外の Origin の申請・取り下げは 403 FORBIDDEN_ORIGIN で、何も変わらない", async () => {
    const id = await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}Origin`,
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
    });
    const before = await caseRequestSnapshot();
    for (const [path, body] of [
      [BASE, createBody()],
      [`${BASE}/${id}/withdraw`, undefined],
    ] as const) {
      const res = await post(path, w.memberS1.token, body, BAD_ORIGIN);
      expect(res.status, path).toBe(403);
      expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    }
    expect(await caseRequestSnapshot()).toEqual(before);
  });
});

describe("#146 5-3 AC-1・C-132 POST /api/case-requests：申請できる人と担当部署", () => {
  it("#146 5-3 AC-1・AC-2: メンバーが申請すると 201 で、決めた形の申請の項目を返す（審査中・案件の ID なし）。no-store", async () => {
    const res = await create(w.memberS1.token, {
      description: "[UNIT_TEST]説明",
      dueDate: "2026-12-01",
      candidateIds: [w.memberD1.id],
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    const body = (await res.json()) as Item & {
      titleFormatted: boolean;
      hasSimilarTitle: boolean;
    };
    expect(isUlid(body.id)).toBe(true);
    expect(Object.keys(body).sort()).toEqual(
      [
        "id",
        "title",
        "description",
        "dueDate",
        "client",
        "departments",
        "candidates",
        "status",
        "rejectReason",
        "caseId",
        // 146-B：承認済みなら案件番号、それ以外は null（統括の決定）
        "caseNumber",
        "resubmittedFrom",
        "createdAt",
        "decidedAt",
        "titleFormatted",
        "hasSimilarTitle",
      ].sort(),
    );
    expect(body).toMatchObject({
      title: `${TEST_TAG}保守契約`,
      description: "[UNIT_TEST]説明",
      dueDate: "2026-12-01",
      client: {
        id: w.clientA.id,
        code: "QZA",
        name: w.clientA.name,
        isActive: true,
      },
      departments: [{ id: w.deptS.id, name: w.deptS.name, isActive: true }],
      candidates: [{ userId: w.memberD1.id, displayName: "テスト太郎" }],
      status: "pending",
      rejectReason: null,
      caseId: null,
      caseNumber: null,
      resubmittedFrom: null,
      createdAt: CASEREQ_NOW,
      decidedAt: null,
      titleFormatted: false,
      hasSimilarTitle: false,
    });
  });

  it("#146 5-3 AC-1: 所属のない一般社員は 403「所属部署がないため申請できません」で、何も残らない", async () => {
    const before = await caseRequestSnapshot();
    const res = await create(w.noDept.token);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: "FORBIDDEN",
      message: MESSAGES.noDepartment,
    });
    expect(await caseRequestSnapshot()).toEqual(before);
  });

  it("#146 5-3 AC-1: 所属のない全体管理者は 201", async () => {
    await setUserDepartment(w.admin.id, null);
    const res = await create(w.admin.token);
    expect(res.status).toBe(201);
  });

  it.each([
    ["メンバー", "memberS1"],
    ["オーナー", "ownerS"],
    ["全体管理者", "admin"],
  ] as const)(
    "#146 C-132・C-130: %s は、所属しない部署を含む複数の部署を選べる",
    async (_label, who) => {
      const res = await create(w[who].token, {
        departmentIds: [w.deptD.id, w.deptH.id],
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as Item;
      expect(body.departments.map((d) => d.id).sort()).toEqual(
        [w.deptD.id, w.deptH.id].sort(),
      );
    },
  );

  it("#146 C-130（重大3）: 101 の有効な部署を選んだ申請は 201 で、申請の部署が101行になる（件数の上限なし）", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 101; i += 1)
      ids.push(`01JTESTCASEREQDEPT${String(i).padStart(8, "0")}`);
    await env.DB.batch(
      ids.map((id, i) =>
        env.DB.prepare(
          "INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at) VALUES (?, ?, ?, 1, ?, '', 1, ?)",
        ).bind(
          id,
          `${TEST_TAG}casereq多数${i}`,
          `${TEST_TAG}casereq多数${i}`.toLowerCase(),
          CASEREQ_NOW,
          CASEREQ_NOW,
        ),
      ),
    );
    const res = await create(w.memberS1.token, { departmentIds: ids });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as Item;
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM case_creation_request_departments WHERE request_id = ?",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(row?.n).toBe(101);
  });

  it.each([
    ["空", { departmentIds: [] }],
    ["重複", { departmentIds: ["DUP", "DUP"] }],
    ["存在しない部署", { departmentIds: ["MISSING"] }],
    ["無効な部署", { departmentIds: ["INACTIVE"] }],
  ])(
    "#146 5-3 AC-1: 担当部署が%sなら 422（fields: departmentIds）で、何も残らない",
    async (_label, overrides) => {
      const map = (v: string) =>
        v === "DUP"
          ? w.deptS.id
          : v === "MISSING"
            ? "01JTESTCASEREQMISSING00001"
            : v;
      let departmentIds = overrides.departmentIds.map(map);
      if (overrides.departmentIds[0] === "INACTIVE") {
        await env.DB.prepare(
          "UPDATE departments SET is_active = 0 WHERE id = ?",
        )
          .bind(w.deptD.id)
          .run();
        departmentIds = [w.deptD.id];
      }
      const before = await caseRequestSnapshot();
      const res = await create(w.memberS1.token, { departmentIds });
      expect(res.status).toBe(422);
      const body = (await res.json()) as ErrorBody;
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.fields).toContain("departmentIds");
      expect(await caseRequestSnapshot()).toEqual(before);
    },
  );

  it.each([
    ["余計な項目", { status: "approved" }],
    [
      "余計な項目（requestedBy）",
      { requestedBy: "01JTESTCASEREQMISSING00001" },
    ],
  ])("#146 計画 A-4: 本文に%sがあれば 422", async (_label, extra) => {
    const res = await create(w.memberS1.token, extra);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it.each([
    ["空", ""],
    ["空白だけ", "　 　"],
    ["整形の後に101文字", `${"a".repeat(50)}  ${"b".repeat(50)}  `],
  ])(
    "#146 5-3 AC-12: 件名が%sなら 422（fields: title）",
    async (_label, title) => {
      const res = await create(w.memberS1.token, { title });
      expect(res.status).toBe(422);
      expect(((await res.json()) as ErrorBody).fields).toContain("title");
    },
  );

  it("#146 5-3 AC-12: 説明が2001文字なら 422（fields: description）、2000文字は 201", async () => {
    const bad = await create(w.memberS1.token, {
      description: "あ".repeat(2001),
    });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as ErrorBody).fields).toContain("description");
    const ok = await create(w.memberS1.token, {
      description: "あ".repeat(2000),
    });
    expect(ok.status).toBe(201);
  });

  it("#146 5-3 AC-13: 全角・連続する空白の件名は整形して保存し、titleFormatted は真", async () => {
    const res = await create(w.memberS1.token, {
      title: "　ＡＢＣ　　保守−契約 ",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Item & { titleFormatted: boolean };
    expect(body.title).toBe("ABC 保守-契約");
    expect(body.titleFormatted).toBe(true);
    expect((await caseRequestRow(body.id))?.title).toBe("ABC 保守-契約");
  });
});

describe("#146 5-3 AC-11・5-1 AC-19 取引先", () => {
  it.each([
    ["指定がない", "none"],
    ["無効", "inactive"],
    ["存在しない", "missing"],
  ])(
    "#146 5-3 AC-11: 取引先が%sなら 422（fields: clientId）で、何も残らない",
    async (_label, which) => {
      const before = await caseRequestSnapshot();
      const body: Record<string, unknown> = createBody();
      if (which === "none") delete body.clientId;
      if (which === "inactive") body.clientId = w.clientOff.id;
      if (which === "missing") body.clientId = "01JTESTCASEREQMISSING00001";
      const res = await post(BASE, w.memberS1.token, body);
      expect(res.status).toBe(422);
      expect(((await res.json()) as ErrorBody).fields).toContain("clientId");
      expect(await caseRequestSnapshot()).toEqual(before);
    },
  );

  it("#146 5-1 AC-19・C-120: 申請の後に取引先を無効にすると、自分の申請の client.isActive が false になる", async () => {
    const id = await createdId(w.memberS1.token);
    await setClientActive(w.clientA.id, false);
    const items = await mineAll(w.memberS1.token);
    expect(items.find((item) => item.id === id)?.client).toMatchObject({
      id: w.clientA.id,
      name: w.clientA.name,
      isActive: false,
    });
  });
});

describe("#146 5-3 AC-5 追加の候補", () => {
  it("#146 5-3 AC-5: 他部署の有効な社員を候補にできる", async () => {
    const res = await create(w.memberS1.token, {
      candidateIds: [w.memberD1.id, w.ownerH.id],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Item;
    expect(body.candidates.map((c) => c.userId).sort()).toEqual(
      [w.memberD1.id, w.ownerH.id].sort(),
    );
  });

  it.each([
    ["無効な社員", "inactive"],
    ["申請者本人", "self"],
    ["重複", "dup"],
    ["存在しない社員", "missing"],
  ])(
    "#146 5-3 AC-5: 候補に%sを入れると 422（fields: candidateIds）で、何も残らない",
    async (_label, which) => {
      const candidateIds =
        which === "inactive"
          ? [w.inactive.id]
          : which === "self"
            ? [w.memberS1.id]
            : which === "dup"
              ? [w.memberD1.id, w.memberD1.id]
              : ["01JTESTCASEREQMISSING00001"];
      const before = await caseRequestSnapshot();
      const res = await create(w.memberS1.token, { candidateIds });
      expect(res.status).toBe(422);
      expect(((await res.json()) as ErrorBody).fields).toContain(
        "candidateIds",
      );
      expect(await caseRequestSnapshot()).toEqual(before);
    },
  );
});

describe("#146 5-3 AC-6・C-141(2) 再申請と納期", () => {
  it("#146 5-3 AC-6: 本人の却下済みの申請を元にすると、元の ID を持つ別の申請になる", async () => {
    const original = await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}元の申請`,
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
      status: "rejected",
    });
    const res = await create(w.memberS1.token, { resubmitOf: original });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Item;
    expect(body.id).not.toBe(original);
    expect(body.resubmittedFrom).toBe(original);
  });

  it("#146 5-3 AC-6・AC-8（統括の決定）: 本人の自動取消（auto_cancelled）の申請を元にしても 201 で、元の ID を持つ", async () => {
    const original = await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}自動取消の元`,
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
      status: "auto_cancelled",
      decidedBy: w.admin.id,
    });
    const res = await create(w.memberS1.token, { resubmitOf: original });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Item).resubmittedFrom).toBe(original);
  });

  it("#146 5-3 AC-6（存在の非開示）: 他人の申請・存在しない申請・審査中・承認済みを元にすると、同じ 422・同じ本文", async () => {
    const others = await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}他人`,
      requestedBy: w.memberS2.id,
      departmentIds: [w.deptS.id],
      status: "rejected",
    });
    const pending = await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}審査中`,
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
    });
    const approved = await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}承認済み`,
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
      status: "approved",
    });
    const bodies: unknown[] = [];
    for (const resubmitOf of [
      others,
      "01JTESTCASEREQMISSING00001",
      pending,
      approved,
    ]) {
      const res = await create(w.memberS1.token, { resubmitOf });
      expect(res.status, resubmitOf).toBe(422);
      bodies.push(await res.json());
    }
    expect(bodies[0]).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["resubmitOf"],
    });
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it("#146 C-141(2): 再申請でも過去（昨日）の納期は 422（fields: dueDate）、今日は 201", async () => {
    const original = await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}元の申請`,
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
      status: "withdrawn",
      dueDate: YESTERDAY_JST,
    });
    const past = await create(w.memberS1.token, {
      resubmitOf: original,
      dueDate: YESTERDAY_JST,
    });
    expect(past.status).toBe(422);
    expect(((await past.json()) as ErrorBody).fields).toEqual(["dueDate"]);
    const today = await create(w.memberS1.token, {
      resubmitOf: original,
      dueDate: TODAY_JST,
    });
    expect(today.status).toBe(201);
  });

  it.each(["2026-02-30", "2026/12/01", "20261201"])(
    "#146 5-1 AC-17: 納期 %s は形の誤りで 422（fields: dueDate）",
    async (dueDate) => {
      const res = await create(w.memberS1.token, { dueDate });
      expect(res.status).toBe(422);
      expect(((await res.json()) as ErrorBody).fields).toContain("dueDate");
    },
  );
});

describe("#146 5-3 AC-7 POST /api/case-requests/:requestId/withdraw", () => {
  const pendingOf = (requestedBy: string) =>
    insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}取り下げ`,
      requestedBy,
      departmentIds: [w.deptS.id],
    });

  it("#146 5-3 AC-7: 本人は再認証なし（再認証していないセッション）で取り下げられ、REAUTH_REQUIRED にならず 200 { requestId, status: withdrawn }。自分の申請に取り下げで出る", async () => {
    const id = await pendingOf(w.memberS1.id);
    const res = await post(`${BASE}/${id}/withdraw`, w.memberS1.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    expect(await res.json()).toEqual({ requestId: id, status: "withdrawn" });
    const item = (await mineAll(w.memberS1.token)).find((i) => i.id === id);
    expect(item).toMatchObject({ status: "withdrawn", decidedAt: CASEREQ_NOW });
  });

  it("#146 5-3 AC-7（存在の非開示）: 他人（メンバー・担当部署のオーナー・全体管理者）と存在しない ID は、同じ 404・同じ本文で、何も変わらない", async () => {
    const id = await pendingOf(w.memberS1.id);
    const before = await caseRequestSnapshot();
    const bodies: unknown[] = [];
    for (const [token, target] of [
      [w.memberS2.token, id],
      [w.ownerS.token, id],
      [w.admin.token, id],
      [w.memberS1.token, "01JTESTCASEREQMISSING00001"],
    ] as const) {
      const res = await post(`${BASE}/${target}/withdraw`, token);
      expect(res.status).toBe(404);
      bodies.push(await res.json());
    }
    expect(bodies[0]).toMatchObject({ code: "NOT_FOUND" });
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(await caseRequestSnapshot()).toEqual(before);
  });

  it("#146 5-3 AC-7: 取り下げ済みをもう一度取り下げると 409「この申請はすでに処理されています」で、監査は1件のまま", async () => {
    const id = await pendingOf(w.memberS1.id);
    expect(
      (await post(`${BASE}/${id}/withdraw`, w.memberS1.token)).status,
    ).toBe(200);
    const res = await post(`${BASE}/${id}/withdraw`, w.memberS1.token);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "CONFLICT",
      message: MESSAGES.decided,
    });
    expect(
      (await caseRequestAudits()).filter(
        (a) => a.action === "case_request.withdraw",
      ),
    ).toHaveLength(1);
  });
});

describe("#146 5-3 AC-14・C-141(3) 類似件名", () => {
  it("#146 5-3 AC-14: 確認の API は hasSimilar と formattedTitle だけを返す（件名・申請者・件数を返さない）", async () => {
    await insertCaseRequest({
      clientId: w.clientA.id,
      title: "ABC 保守",
      requestedBy: w.memberS2.id,
      departmentIds: [w.deptS.id],
    });
    const res = await similar(w.memberS1.token, w.clientA.id, "ＡＢＣ　保守");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["formattedTitle", "hasSimilar"]);
    expect(body).toEqual({ hasSimilar: true, formattedTitle: "ABC 保守" });
    const other = await similar(w.memberS1.token, w.clientB.id, "ABC 保守");
    expect(await other.json()).toEqual({
      hasSimilar: false,
      formattedTitle: "ABC 保守",
    });
  });

  it.each([
    ["件名が空", "clientId=CLIENT&title="],
    ["件名が整形の後に101文字", `clientId=CLIENT&title=${"a".repeat(101)}`],
    ["取引先の指定がない", "title=abc"],
  ])("#146 5-3 AC-14: %sなら 422", async (_label, query) => {
    const res = await get(
      `${BASE}/similar-title?${query.replace("CLIENT", w.clientA.id)}`,
      w.memberS1.token,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("#146 5-3 AC-14: 似た件名があっても申請でき、201 の hasSimilarTitle が真", async () => {
    await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}保守契約`,
      requestedBy: w.memberS2.id,
      departmentIds: [w.deptS.id],
    });
    const res = await create(w.memberS1.token);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ hasSimilarTitle: true });
  });
});

describe("#146 5-3 AC-2（範囲）GET /api/case-requests/mine", () => {
  it("#146 自分の申請：本人の申請だけを ID の降順で返し、他人の申請は出ない。limit=1 で送っても漏れも重複もない", async () => {
    const mine = [
      await createdId(w.memberS1.token, { title: `${TEST_TAG}自分1` }),
      await createdId(w.memberS1.token, { title: `${TEST_TAG}自分2` }),
      await createdId(w.memberS1.token, { title: `${TEST_TAG}自分3` }),
    ];
    await createdId(w.memberS2.token, { title: `${TEST_TAG}他人` });
    await createdId(w.ownerS.token, { title: `${TEST_TAG}オーナー` });
    const all = await mineAll(w.memberS1.token, 1);
    expect(all.map((item) => item.id)).toEqual([...mine].sort().reverse());
    const res = await get(`${BASE}/mine`, w.memberS1.token);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
  });

  it("#146 自分の申請：申請ごとの担当部署・候補は、その申請のものだけで、ほかの申請のものと混ざらない", async () => {
    const first = await createdId(w.memberS1.token, {
      title: `${TEST_TAG}部署S`,
      departmentIds: [w.deptS.id],
      candidateIds: [w.memberD1.id],
    });
    const second = await createdId(w.memberS1.token, {
      title: `${TEST_TAG}部署DH`,
      departmentIds: [w.deptD.id, w.deptH.id],
      candidateIds: [w.ownerH.id, w.memberS2.id],
    });
    const third = await createdId(w.memberS1.token, {
      title: `${TEST_TAG}候補なし`,
      departmentIds: [w.deptH.id],
    });
    const items = await mineAll(w.memberS1.token);
    const of = (id: string) => items.find((item) => item.id === id);
    expect(of(first)?.departments.map((d) => d.id)).toEqual([w.deptS.id]);
    expect(of(first)?.candidates.map((c) => c.userId)).toEqual([w.memberD1.id]);
    expect(
      of(second)
        ?.departments.map((d) => d.id)
        .sort(),
    ).toEqual([w.deptD.id, w.deptH.id].sort());
    expect(
      of(second)
        ?.candidates.map((c) => c.userId)
        .sort(),
    ).toEqual([w.ownerH.id, w.memberS2.id].sort());
    expect(of(third)?.departments.map((d) => d.id)).toEqual([w.deptH.id]);
    expect(of(third)?.candidates).toEqual([]);
  });

  it.each(["limit=0", "limit=101", "cursor=broken"])(
    "#146 ページ送り：%s は 422",
    async (query) => {
      const res = await get(`${BASE}/mine?${query}`, w.memberS1.token);
      expect(res.status).toBe(422);
    },
  );
});

describe("#146 5-3 AC-8 自動取消（auto_cancelled）の応答", () => {
  it("#146 5-3 AC-8: 自分の申請に status: auto_cancelled で出て、取り下げは 409「この申請はすでに処理されています」", async () => {
    const id = await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}自動取消`,
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
      status: "auto_cancelled",
      decidedBy: w.admin.id,
    });
    const item = (await mineAll(w.memberS1.token)).find((i) => i.id === id);
    expect(item).toMatchObject({ status: "auto_cancelled", caseId: null });
    const res = await post(`${BASE}/${id}/withdraw`, w.memberS1.token);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "CONFLICT",
      message: MESSAGES.decided,
    });
  });
});

describe("#146 3-4 AC-1・AC-3 通知と監査", () => {
  it("#146 3-4 AC-1・AC-3（Q3）: 提出の通知は担当部署のオーナーだけに届く（他部署のオーナー・メンバー・全体管理者・申請者本人には届かない）", async () => {
    const id = await createdId(w.memberS1.token, {
      departmentIds: [w.deptS.id, w.deptD.id],
    });
    expect(await caseRequestNotifications()).toEqual(
      [w.ownerS.id, w.ownerD.id].sort().map((user_id) => ({
        user_id,
        kind: "case_request.submitted",
        room_id: null,
        message_id: null,
        target_id: id,
      })),
    );
  });

  it("#146 3-4 AC-3（Q3）: オーナーが申請すると本人を除き、ほかにオーナーがいなければ全体管理者に届く", async () => {
    const id = await createdId(w.ownerS.token);
    expect(await caseRequestNotifications()).toEqual([
      {
        user_id: w.admin.id,
        kind: "case_request.submitted",
        room_id: null,
        message_id: null,
        target_id: id,
      },
    ]);
  });

  it("#146 5-3 AC-7: 取り下げでは通知を出さない", async () => {
    const id = await createdId(w.memberS1.token);
    const before = await caseRequestNotifications();
    expect(
      (await post(`${BASE}/${id}/withdraw`, w.memberS1.token)).status,
    ).toBe(200);
    expect(await caseRequestNotifications()).toEqual(before);
  });

  it("#146 監査: 申請と取り下げの監査が1件ずつ残り、detail に件名・説明の本文がない", async () => {
    const id = await createdId(w.memberS1.token, {
      title: `${TEST_TAG}監査の件名`,
      description: "[UNIT_TEST]監査の説明",
    });
    expect(
      (await post(`${BASE}/${id}/withdraw`, w.memberS1.token)).status,
    ).toBe(200);
    const audits = await caseRequestAudits();
    expect(audits.map((a) => [a.action, a.target_id, a.result])).toEqual([
      ["case_request.create", id, "success"],
      ["case_request.withdraw", id, "success"],
    ]);
    for (const audit of audits) {
      expect(audit.detail ?? "").not.toContain("監査の件名");
      expect(audit.detail ?? "").not.toContain("監査の説明");
    }
  });
});
