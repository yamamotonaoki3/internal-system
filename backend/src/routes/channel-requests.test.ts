// #131 チャンネルの作成申請：申請（EP-2-07）・自分の申請（EP-2-08）・取り下げ（新規。計画 AC-15 の案）と、共通の拒否（401・Origin）を、
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。時刻は Date だけを CHREQ_NOW に固定する。
// 期待値は要件 2-2 AC-1・AC-11・AC-13、3-4 AC-1・AC-3、計画の「API」「名前の重複判定」「batch」「利用者決定 A（取り下げは通知しない）」から決める。
// 契約（実装者へ。テストが決めたもの）：
//  - POST /api/channel-requests 本文（strict）{ scope: "department" | "company", name: string, description?: string, visibility: "public" | "private" }
//      → 201 { id, departmentId, name, visibility, status: "pending", ... }（部署はサーバーが users.department_id から決める。name は整形後）
//      余計な項目（departmentId・purpose など）・不正な値は 422 VALIDATION_ERROR（fields に項目名。所属なしで department は fields: ["scope"]）
//      名前の重複（channels の全件＝アーカイブ済みを含む、承認待ちの申請。大文字小文字を区別しない）は 409 CONFLICT。却下・取り下げ済みの名前は重複しない
//      監査 channel_request.create を 1 件（target_type: channel_request、target_id: 申請 ID、detail のキーは departmentId・requestId・visibility だけ）
//      通知 channel_request.submitted を審査者へ（room_id・message_id は null、target_id は申請 ID）
//  - GET /api/channel-requests/mine?limit&cursor → 200 { items: [{ id, departmentId, name, visibility, status, rejectReason, createdAt, decidedAt, channelId }], nextCursor }
//      本人の申請だけ。id 降順。limit 既定 20・1〜100。Cache-Control に no-store
//  - POST /api/channel-requests/:requestId/withdraw（本文なし・再認証なし）→ 200 { requestId, status: "withdrawn" }
//      本人の承認待ちだけ。他人の申請・存在しない ID は 404 NOT_FOUND。決裁済み・取り下げ済みは 409 CONFLICT（message: この申請はすでに処理されています）
//      監査 channel_request.withdraw を 1 件（detail のキーは departmentId・requestId）。通知は送らない
//  - 共通：未認証 401 UNAUTHENTICATED、許可外の Origin の POST は 403 FORBIDDEN_ORIGIN（何も変わらない）
// データは架空（testuser_chreq_・@example.com・[UNIT_TEST] の部署・UNIT_TEST_ のチャンネル名）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  BAD_ORIGIN,
  BASE,
  CHREQ_NOW,
  MESSAGES,
  NAME_PREFIX,
  auditLogLines,
  cleanupChannelRequestTestData,
  detailKeys,
  failNotificationInsert,
  insertActor,
  insertChannelRequest,
  requestAudits,
  requestIdAt,
  requestNotifications,
  requestRow,
  requestRows,
  requestSnapshot,
  sessionFor,
  setupWorld,
  type World,
} from "../../test/channel-request-fixtures";
import { insertChannel } from "../../test/department-fixtures";
import { isUlid } from "../lib/ulid";

type MineItem = {
  id: string;
  departmentId: string | null;
  name: string;
  visibility: string;
  status: string;
  rejectReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  channelId: string | null;
};
type MinePage = { items: MineItem[]; nextCursor: string | null };

let w: World;
let logLines: string[];

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
  scope: "department",
  name: `${NAME_PREFIX}新規`,
  visibility: "public",
  ...overrides,
});
const create = (token: string, overrides: Record<string, unknown> = {}) =>
  post(BASE, token, createBody(overrides));

async function mineAll(token: string): Promise<MineItem[]> {
  const items: MineItem[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i += 1) {
    const query: string =
      cursor === null ? "limit=100" : `limit=100&cursor=${cursor}`;
    const res = await get(`${BASE}/mine?${query}`, token);
    expect(res.status).toBe(200);
    const page = (await res.json()) as MinePage;
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return items;
  }
  throw new Error("一覧のページが終わりませんでした");
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CHREQ_NOW));
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  w = await setupWorld();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupChannelRequestTestData();
});

describe("#131 共通：認証と Origin", () => {
  it.each([
    ["POST", BASE],
    ["GET", `${BASE}/mine`],
    ["GET", BASE],
    ["POST", `${BASE}/${requestIdAt(1_800_000_000_000)}/approve`],
    ["POST", `${BASE}/${requestIdAt(1_800_000_000_000)}/reject`],
    ["POST", `${BASE}/${requestIdAt(1_800_000_000_000)}/withdraw`],
  ])(
    "#131 共通: 未認証の %s %s は 401 UNAUTHENTICATED",
    async (method, path) => {
      const res = await apiRequest(method, path, {
        token: null,
        ...(method === "POST" ? { body: {} } : {}),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    },
  );

  it("#131 共通: 許可外の Origin の申請・承認・却下・取り下げは 403 FORBIDDEN_ORIGIN で、何も変わらない", async () => {
    const id = await insertChannelRequest({
      departmentId: w.deptS.id,
      name: `${NAME_PREFIX}Origin`,
      requestedBy: w.memberS1.id,
    });
    const before = await requestSnapshot();
    const cases: [string, string, unknown][] = [
      [BASE, w.memberS1.token, createBody()],
      [`${BASE}/${id}/approve`, w.ownerS.token, undefined],
      [`${BASE}/${id}/reject`, w.ownerS.token, { reason: "理由" }],
      [`${BASE}/${id}/withdraw`, w.memberS1.token, undefined],
    ];
    for (const [path, token, body] of cases) {
      const res = await post(path, token, body, BAD_ORIGIN);
      expect(res.status, path).toBe(403);
      expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    }
    expect(await requestSnapshot()).toEqual(before);
  });
});

describe("#131 AC-1（2-2 AC-1）POST /api/channel-requests：申請できる", () => {
  it.each([
    ["department", "public"],
    ["department", "private"],
    ["company", "public"],
    ["company", "private"],
  ])(
    "#131 AC-1（2-2 AC-1）: メンバーは %s × %s で申請でき 201。部署は本人の所属（会社直属は null）で、承認待ちになる",
    async (scope, visibility) => {
      const res = await create(w.memberS1.token, {
        scope,
        visibility,
        description: "テストの説明",
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      const departmentId = scope === "department" ? w.deptS.id : null;
      expect(body).toMatchObject({
        departmentId,
        name: `${NAME_PREFIX}新規`,
        visibility,
        status: "pending",
      });
      expect(isUlid(body.id)).toBe(true);
      const row = await requestRow(String(body.id));
      expect(row).toMatchObject({
        department_id: departmentId,
        name: `${NAME_PREFIX}新規`,
        name_normalized: `${NAME_PREFIX}新規`.toLowerCase(),
        description: "テストの説明",
        visibility,
        requested_by: w.memberS1.id,
        status: "pending",
        decided_by: null,
        decision_reason: null,
        channel_id: null,
        requested_at: CHREQ_NOW,
        decided_at: null,
      });
    },
  );

  it("#131 AC-1: 説明を省くと空の説明で保存する", async () => {
    const res = await create(w.memberS1.token);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect((await requestRow(id))?.description).toBe("");
  });

  it("#131 AC-1（security）: 応答に申請者のメール・本名・利用者 ID を含めない", async () => {
    const res = await create(w.memberS1.token);
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain("@example.com");
    expect(text).not.toContain(w.memberS1.id);
  });

  it("#131 AC-1（2-2 AC-1・C-105）: オーナー・全体管理者も申請できる（部署は本人の所属）", async () => {
    const owner = await create(w.ownerS.token, {
      name: `${NAME_PREFIX}オーナー`,
    });
    expect(owner.status).toBe(201);
    expect(await owner.json()).toMatchObject({ departmentId: w.deptS.id });
    const admin = await create(w.admin.token, { name: `${NAME_PREFIX}管理者` });
    expect(admin.status).toBe(201);
    // 全体管理者の所属は deptH（任命された deptD ではない）
    expect(await admin.json()).toMatchObject({ departmentId: w.deptH.id });
  });

  it.each<[string, Record<string, unknown>]>([
    ["他部署の departmentId", { departmentId: "01JTESTCHREQOTHERDEPT0001" }],
    ["purpose（案件専用など。2-2 AC-11）", { purpose: "case" }],
    ["requestedBy", { requestedBy: "01JTESTCHREQOTHERUSER0001" }],
    ["status", { status: "approved" }],
  ])(
    "#131 AC-1・AC-11（2-2 AC-1・AC-11）: 余計な項目 %s を付けると 422 で、何も作らない",
    async (_label, extra) => {
      const before = await requestSnapshot();
      const res = await post(BASE, w.memberS1.token, {
        ...createBody(),
        ...extra,
      });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await requestSnapshot()).toEqual(before);
    },
  );

  it.each<[string, Record<string, unknown>, string]>([
    ["scope がない", { scope: undefined }, "scope"],
    ["scope が不正", { scope: "other_department" }, "scope"],
    ["visibility がない", { visibility: undefined }, "visibility"],
    ["visibility が不正", { visibility: "internal" }, "visibility"],
    ["name がない", { name: undefined }, "name"],
    ["name が文字列でない", { name: 123 }, "name"],
    ["description が文字列でない", { description: 1 }, "description"],
  ])(
    "#131 AC-1: %s なら 422 VALIDATION_ERROR（fields に %s）",
    async (_label, overrides, field) => {
      const res = await post(BASE, w.memberS1.token, createBody(overrides));
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string; fields?: string[] };
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.fields).toContain(field);
      expect(await requestRows()).toEqual([]);
    },
  );

  it("#131 AC-1: 所属のない社員は、自部署（department）では 422（fields: scope）、会社直属は申請できる", async () => {
    const noDept = await insertActor("testuser_chreq_nodept", null);
    const token = await sessionFor(noDept);
    const denied = await create(token, { scope: "department" });
    expect(denied.status).toBe(422);
    expect(await denied.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["scope"],
      message: "所属する部署がないため、自部署のチャンネルは申請できません",
    });
    expect(await requestRows()).toEqual([]);
    const allowed = await create(token, { scope: "company" });
    expect(allowed.status).toBe(201);
    expect(await allowed.json()).toMatchObject({ departmentId: null });
  });
});

describe("#131 AC-13（2-2 AC-13）POST /api/channel-requests：名前と説明の規則", () => {
  it.each([
    ["途中の半角空白", `${NAME_PREFIX}営業 共有`],
    ["途中の全角空白", `${NAME_PREFIX}営業　共有`],
    ["記号", `${NAME_PREFIX}営業!`],
    ["角かっこ", "[UNIT_TEST]営業"],
    ["半角カナ", `${NAME_PREFIX}ｴｲｷﾞｮｳ`],
    ["制御文字", `${NAME_PREFIX}営業\u0001`],
    ["空", ""],
    ["空白だけ", "　 "],
    ["51 文字", `${NAME_PREFIX}${"a".repeat(41)}`],
  ])(
    "#131 AC-13: 名前が%sなら 422（fields に name）で、何も作らない",
    async (_label, name) => {
      const res = await create(w.memberS1.token, { name });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string; fields?: string[] };
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.fields).toContain("name");
      expect(await requestRows()).toEqual([]);
      expect(await requestAudits()).toEqual([]);
    },
  );

  it.each([
    ["日本語・ハイフン・アンダースコア", `${NAME_PREFIX}営業_共有-2`],
    ["「々」「〆」「ー」", `${NAME_PREFIX}々〆ー`],
  ])("#131 AC-13: 名前が%sなら申請できる", async (_label, name) => {
    const res = await create(w.memberS1.token, { name });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name });
  });

  it("#131 AC-13（C-121 の確定）: 全角英数字・全角ハイフン・アンダースコアは半角に整えて保存する（ＵＮＩＴ＿ＴＥＳＴ＿ＥＩＧＹＯ－１ → UNIT_TEST_EIGYO-1）", async () => {
    const res = await create(w.memberS1.token, {
      name: "　ＵＮＩＴ＿ＴＥＳＴ＿ＥＩＧＹＯ－１ ",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.name).toBe("UNIT_TEST_EIGYO-1");
    expect(await requestRow(body.id)).toMatchObject({
      name: "UNIT_TEST_EIGYO-1",
      name_normalized: "unit_test_eigyo-1",
    });
  });

  it("#131 AC-13: 前後に空白を付けた 50 文字は、空白を除いて通る", async () => {
    const name = `${NAME_PREFIX}${"a".repeat(40)}`;
    expect(name).toHaveLength(50);
    const res = await create(w.memberS1.token, { name: `  ${name}　` });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name });
  });

  it("#131 AC-13: 説明は 500 文字まで申請でき、501 文字は 422（fields に description）", async () => {
    const ok = await create(w.memberS1.token, {
      description: "あ".repeat(500),
    });
    expect(ok.status).toBe(201);
    const ng = await create(w.memberS2.token, {
      name: `${NAME_PREFIX}説明超過`,
      description: "あ".repeat(501),
    });
    expect(ng.status).toBe(422);
    const body = (await ng.json()) as { code: string; fields?: string[] };
    expect(body.fields).toContain("description");
    expect(await requestRows()).toHaveLength(1);
  });
});

describe("#131 AC-13（2-2 AC-13）POST /api/channel-requests：名前の重複", () => {
  it.each([
    ["既存の通常チャンネルと大文字小文字違い", false],
    ["アーカイブしたチャンネル（2-6 AC-6・C-124）", true],
  ])(
    "#131 AC-13: %s の名前は 409 CONFLICT で、何も作らない",
    async (_label, archived) => {
      await insertChannel({
        name: `${NAME_PREFIX}dup`,
        purpose: "normal",
        departmentId: w.deptD.id,
        archived,
      });
      const before = await requestSnapshot();
      const res = await create(w.memberS1.token, { name: `${NAME_PREFIX}DUP` });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "CONFLICT" });
      expect(await requestSnapshot()).toEqual(before);
    },
  );

  it("#131 AC-13: 会社直属のチャンネルの名前とも、部署をまたいで重複を認めない", async () => {
    await insertChannel({
      name: `${NAME_PREFIX}company`,
      purpose: "normal",
      departmentId: null,
    });
    const res = await create(w.memberS1.token, {
      name: `${NAME_PREFIX}Company`,
    });
    expect(res.status).toBe(409);
  });

  it("#131 AC-13: 全角で入力した「ＵＮＩＴ＿ＴＥＳＴ＿ＥＩＧＹＯ－１」は、既存の「unit_test_eigyo-1」と重複して 409", async () => {
    await insertChannel({
      name: "unit_test_eigyo-1",
      purpose: "normal",
      departmentId: w.deptD.id,
    });
    const res = await create(w.memberS1.token, {
      name: "ＵＮＩＴ＿ＴＥＳＴ＿ＥＩＧＹＯ－１",
    });
    expect(res.status).toBe(409);
    expect(await requestRows()).toEqual([]);
  });

  it("#131 AC-13: 承認待ちの申請（他人・別の部署・会社直属を含む）と大文字小文字違いの名前は 409", async () => {
    await insertChannelRequest({
      departmentId: null,
      name: `${NAME_PREFIX}Pending`,
      requestedBy: w.memberH1.id,
    });
    const res = await create(w.memberS1.token, {
      name: `${NAME_PREFIX}PENDING`,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "CONFLICT" });
    expect(await requestRows()).toHaveLength(1);
  });

  it.each(["rejected", "withdrawn"] as const)(
    "#131 AC-13: %s の申請の名前は重複の比較から外れ、同じ名前で申請できる",
    async (status) => {
      await insertChannelRequest({
        departmentId: w.deptS.id,
        name: `${NAME_PREFIX}再申請`,
        requestedBy: w.memberS1.id,
        status,
        decidedBy: status === "rejected" ? w.ownerS.id : w.memberS1.id,
      });
      const res = await create(w.memberS1.token, {
        name: `${NAME_PREFIX}再申請`,
      });
      expect(res.status).toBe(201);
    },
  );

  it("#131 AC-13（同時実行）: 同じ名前の申請を同時に 2 件送ると、1 件だけ 201 で、もう 1 件は 409", async () => {
    const results = await Promise.all([
      create(w.memberS1.token, { name: `${NAME_PREFIX}同時` }),
      create(w.memberS2.token, { name: `${NAME_PREFIX}同時` }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await requestRows()).toHaveLength(1);
    expect(
      (await requestAudits()).filter(
        (a) => a.action === "channel_request.create",
      ),
    ).toHaveLength(1);
  });
});

describe("#131 AC-3（2-2 AC-3）・3-4 AC-1・AC-3：申請の監査と通知", () => {
  it("#131 AC-3: 申請で監査 channel_request.create が 1 件。detail は ID と公開範囲だけで、名前・説明を含めない", async () => {
    const res = await create(w.memberS1.token, {
      name: `${NAME_PREFIX}監査`,
      description: "テストの説明本文",
    });
    const { id } = (await res.json()) as { id: string };
    const audits = await requestAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.memberS1.id,
      action: "channel_request.create",
      target_type: "channel_request",
      target_id: id,
      result: "success",
    });
    expect(detailKeys(audits[0]?.detail ?? null)).toEqual([
      "departmentId",
      "requestId",
      "visibility",
    ]);
    expect(JSON.parse(audits[0]?.detail ?? "{}")).toEqual({
      departmentId: w.deptS.id,
      requestId: id,
      visibility: "public",
    });
    const text = audits[0]?.detail ?? "";
    expect(text).not.toContain("監査");
    expect(text).not.toContain("テストの説明本文");
  });

  type Recipient = keyof Pick<World, "ownerS" | "ownerH" | "admin">;
  it.each<[string, keyof World, "department" | "company", Recipient[]]>([
    [
      "部署の申請（一般社員）→ その部署のオーナー",
      "memberS1",
      "department",
      ["ownerS"],
    ],
    [
      "オーナー本人の部署の申請 → 全体管理者",
      "ownerS",
      "department",
      ["admin"],
    ],
    [
      "会社直属の申請（一般社員）→ 全体管理者",
      "memberS1",
      "company",
      ["admin"],
    ],
    ["全体管理者自身の会社直属の申請 → 誰にも送らない", "admin", "company", []],
    [
      "全体管理者が自部署（オーナーではない）で申請 → その部署のオーナー",
      "admin",
      "department",
      ["ownerH"],
    ],
    [
      "全体管理者がオーナーの部署の一般社員の申請 → 全体管理者（オーナーとして）",
      "memberD1",
      "department",
      ["admin"],
    ],
  ])(
    "#131 3-4 AC-1・AC-3: %s。ほかの社員には送らない",
    async (_label, requester, scope, recipients) => {
      const actor = w[requester] as { token: string };
      const res = await create(actor.token, { scope });
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };
      const expected = recipients
        .map((key) => ({
          user_id: (w[key] as { id: string }).id,
          kind: "channel_request.submitted",
          room_id: null,
          message_id: null,
          target_id: id,
        }))
        .sort((a, b) => a.user_id.localeCompare(b.user_id));
      expect(await requestNotifications()).toEqual(expected);
    },
  );

  it("#131 AC-13・3-4 AC-3: 失敗した申請（422・409）は、監査も通知も残さない", async () => {
    expect(
      (await create(w.memberS1.token, { name: `${NAME_PREFIX}営業 共有` }))
        .status,
    ).toBe(422);
    await insertChannel({
      name: `${NAME_PREFIX}taken`,
      purpose: "normal",
      departmentId: null,
    });
    expect(
      (await create(w.memberS1.token, { name: `${NAME_PREFIX}taken` })).status,
    ).toBe(409);
    expect(await requestAudits()).toEqual([]);
    expect(await requestNotifications()).toEqual([]);
  });

  it("#131 AC-3（batch の原子性）: 通知の書き込みが失敗すると 500 で、申請・監査も残さない", async () => {
    await failNotificationInsert();
    const before = await requestSnapshot();
    const res = await create(w.memberS1.token);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("unit_131_fail_notification");
    expect(await requestSnapshot()).toEqual(before);
  });
});

describe("#131 AC-6（2-2 AC-6）GET /api/channel-requests/mine：自分の申請", () => {
  it("#131 AC-6（2-2 AC-5・AC-6）: 自分の申請だけを新しい順に返し、却下は理由つき。項目は決めた 9 項目", async () => {
    const pending = await insertChannelRequest({
      departmentId: w.deptS.id,
      name: `${NAME_PREFIX}自分1`,
      requestedBy: w.memberS1.id,
    });
    const rejected = await insertChannelRequest({
      departmentId: null,
      name: `${NAME_PREFIX}自分2`,
      requestedBy: w.memberS1.id,
      status: "rejected",
      decidedBy: w.admin.id,
      decisionReason: "<script>alert(1)</script>",
      visibility: "private",
    });
    const approved = await insertChannelRequest({
      departmentId: w.deptS.id,
      name: `${NAME_PREFIX}自分3`,
      requestedBy: w.memberS1.id,
      status: "approved",
      decidedBy: w.ownerS.id,
      channelId: "01JTESTCHREQMINEROOM00001",
    });
    await insertChannelRequest({
      departmentId: w.deptS.id,
      name: `${NAME_PREFIX}他人`,
      requestedBy: w.memberS2.id,
    });
    const res = await get(`${BASE}/mine`, w.memberS1.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const page = (await res.json()) as MinePage;
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((item) => item.id)).toEqual([
      approved,
      rejected,
      pending,
    ]);
    for (const item of page.items)
      expect(Object.keys(item).sort()).toEqual(
        [
          "channelId",
          "createdAt",
          "decidedAt",
          "departmentId",
          "id",
          "name",
          "rejectReason",
          "status",
          "visibility",
        ].sort(),
      );
    expect(page.items[1]).toEqual({
      id: rejected,
      departmentId: null,
      name: `${NAME_PREFIX}自分2`,
      visibility: "private",
      status: "rejected",
      rejectReason: "<script>alert(1)</script>",
      createdAt: CHREQ_NOW,
      decidedAt: CHREQ_NOW,
      channelId: null,
    });
    expect(page.items[0]).toMatchObject({
      status: "approved",
      rejectReason: null,
      channelId: "01JTESTCHREQMINEROOM00001",
    });
    expect(page.items[2]).toMatchObject({
      status: "pending",
      rejectReason: null,
      decidedAt: null,
      channelId: null,
    });
  });

  it("#131 AC-6（security）: 他人の申請は返さず、決裁者の利用者 ID・メールも含めない", async () => {
    await insertChannelRequest({
      departmentId: w.deptS.id,
      name: `${NAME_PREFIX}他人の申請`,
      requestedBy: w.memberS2.id,
    });
    await insertChannelRequest({
      departmentId: w.deptS.id,
      name: `${NAME_PREFIX}自分の却下`,
      requestedBy: w.memberS1.id,
      status: "rejected",
      decidedBy: w.ownerS.id,
    });
    const text = await (await get(`${BASE}/mine`, w.memberS1.token)).text();
    expect(text).not.toContain("他人の申請");
    expect(text).not.toContain(w.ownerS.id);
    expect(text).not.toContain("@example.com");
  });

  it("#131 AC-6: 申請が 0 件なら空の配列と nextCursor が null", async () => {
    expect(await (await get(`${BASE}/mine`, w.memberS1.token)).json()).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("#131 AC-6（クエリ検証）: 25 件は既定の 20 件と 5 件に分かれ、重複・欠落がない", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i += 1)
      ids.push(
        await insertChannelRequest({
          departmentId: w.deptS.id,
          name: `${NAME_PREFIX}頁${String(i).padStart(2, "0")}`,
          requestedBy: w.memberS1.id,
          status: "withdrawn",
        }),
      );
    const first = (await (
      await get(`${BASE}/mine`, w.memberS1.token)
    ).json()) as MinePage;
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = (await (
      await get(`${BASE}/mine?cursor=${first.nextCursor}`, w.memberS1.token)
    ).json()) as MinePage;
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual(
      [...ids].reverse(),
    );
    expect((await mineAll(w.memberS1.token)).map((i) => i.id)).toEqual(
      [...ids].reverse(),
    );
  });

  it.each([
    "limit=0",
    "limit=101",
    "limit=abc",
    "cursor=tampered-value",
    "status=pending",
  ])("#131 AC-6（クエリ検証）: %s は 422 VALIDATION_ERROR", async (query) => {
    const res = await get(`${BASE}/mine?${query}`, w.memberS1.token);
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(text).not.toContain("tampered-value");
  });

  it.each([
    ["limit=1", 1],
    ["limit=100", 3],
  ])("#131 AC-6（クエリ検証）: %s は受け付ける", async (query, expected) => {
    for (let i = 0; i < 3; i += 1)
      await insertChannelRequest({
        departmentId: w.deptS.id,
        name: `${NAME_PREFIX}境界${i}`,
        requestedBy: w.memberS1.id,
        status: "withdrawn",
      });
    const res = await get(`${BASE}/mine?${query}`, w.memberS1.token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as MinePage).items).toHaveLength(expected);
  });
});

describe("#131 AC-15（取り下げ・利用者決定 2・A）POST /api/channel-requests/:requestId/withdraw", () => {
  async function pendingOf(
    requester: keyof World,
    departmentId: string | null,
  ) {
    return insertChannelRequest({
      departmentId,
      name: `${NAME_PREFIX}取り下げ`,
      requestedBy: (w[requester] as { id: string }).id,
    });
  }

  it("#131 AC-15: 本人は承認待ちを再認証なしで取り下げられ 200。状態・決裁者（本人）・日時が残り、監査 1 件、通知は誰にも送らない", async () => {
    const id = await pendingOf("memberS1", w.deptS.id);
    const res = await post(`${BASE}/${id}/withdraw`, w.memberS1.plain);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requestId: id, status: "withdrawn" });
    expect(await requestRow(id)).toMatchObject({
      status: "withdrawn",
      decided_by: w.memberS1.id,
      decided_at: CHREQ_NOW,
      decision_reason: null,
      channel_id: null,
    });
    const audits = await requestAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.memberS1.id,
      action: "channel_request.withdraw",
      target_type: "channel_request",
      target_id: id,
      result: "success",
    });
    expect(detailKeys(audits[0]?.detail ?? null)).toEqual([
      "departmentId",
      "requestId",
    ]);
    expect(await requestNotifications()).toEqual([]);
  });

  it.each<keyof World>(["memberS2", "ownerS", "admin"])(
    "#131 AC-15: 他人（%s）の取り下げは 404 NOT_FOUND で、何も変わらない（存在を明かさない）",
    async (other) => {
      const id = await pendingOf("memberS1", w.deptS.id);
      const before = await requestSnapshot();
      const res = await post(
        `${BASE}/${id}/withdraw`,
        (w[other] as { token: string }).token,
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        code: "NOT_FOUND",
        message: "申請が見つかりません",
      });
      expect(await requestSnapshot()).toEqual(before);
    },
  );

  it("#131 AC-15: 他人の取り下げの拒否は、logger.audit に channel_request.withdraw・failure・理由 not_found・対象の申請 ID・操作した利用者で記録する", async () => {
    const id = await pendingOf("memberS1", w.deptS.id);
    logLines.length = 0;
    await post(`${BASE}/${id}/withdraw`, w.memberS2.token);
    const lines = auditLogLines(logLines).filter(
      (line) => line.attributes?.result === "failure",
    );
    expect(lines.map((line) => line.body)).toEqual([
      "channel_request.withdraw",
    ]);
    expect(lines[0]?.attributes).toMatchObject({
      log_type: "audit",
      target: id,
      reason: "not_found",
    });
    expect(lines[0]?.user_id).toBe(w.memberS2.id);
  });

  it("#131 AC-15: 存在しない申請 ID の取り下げは 404", async () => {
    const res = await post(
      `${BASE}/${requestIdAt(1_700_000_000_000)}/withdraw`,
      w.memberS1.token,
    );
    expect(res.status).toBe(404);
  });

  it.each(["approved", "rejected", "withdrawn"] as const)(
    "#131 AC-15: %s の申請の取り下げは 409 CONFLICT（すでに処理されています）で、何も増えない",
    async (status) => {
      const id = await insertChannelRequest({
        departmentId: w.deptS.id,
        name: `${NAME_PREFIX}処理済み`,
        requestedBy: w.memberS1.id,
        status,
        decidedBy: status === "withdrawn" ? w.memberS1.id : w.ownerS.id,
      });
      const before = await requestSnapshot();
      const res = await post(`${BASE}/${id}/withdraw`, w.memberS1.token);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: "CONFLICT",
        message: MESSAGES.decided,
      });
      expect(await requestSnapshot()).toEqual(before);
    },
  );

  it("#131 AC-15: 二重の取り下げは 2 回目が 409 で、監査は 1 件のまま", async () => {
    const id = await pendingOf("memberS1", w.deptS.id);
    expect(
      (await post(`${BASE}/${id}/withdraw`, w.memberS1.token)).status,
    ).toBe(200);
    expect(
      (await post(`${BASE}/${id}/withdraw`, w.memberS1.token)).status,
    ).toBe(409);
    expect(await requestAudits()).toHaveLength(1);
  });

  it("#131 AC-15: 取り下げた申請は、承認・却下が 409 で、チャンネルは作られない", async () => {
    const id = await pendingOf("memberS1", w.deptS.id);
    await post(`${BASE}/${id}/withdraw`, w.memberS1.token);
    const before = await requestSnapshot();
    const approve = await post(`${BASE}/${id}/approve`, w.ownerS.token);
    expect(approve.status).toBe(409);
    expect(await approve.json()).toMatchObject({ message: MESSAGES.decided });
    const reject = await post(`${BASE}/${id}/reject`, w.ownerS.token, {
      reason: "理由",
    });
    expect(reject.status).toBe(409);
    expect(await requestSnapshot()).toEqual(before);
  });

  it("#131 AC-15（AC-13）: 取り下げた申請と同じ名前で、申請し直せる", async () => {
    const first = await create(w.memberS1.token, {
      name: `${NAME_PREFIX}出し直し`,
    });
    const { id } = (await first.json()) as { id: string };
    expect(
      (await post(`${BASE}/${id}/withdraw`, w.memberS1.token)).status,
    ).toBe(200);
    const again = await create(w.memberS1.token, {
      name: `${NAME_PREFIX}出し直し`,
    });
    expect(again.status).toBe(201);
  });

  it("#131 AC-15: 取り下げた申請は、審査一覧の承認待ちから消える", async () => {
    const id = await pendingOf("memberS1", w.deptS.id);
    const listIds = async () =>
      (
        (await (
          await get(`${BASE}?status=pending`, w.ownerS.token)
        ).json()) as {
          items: { id: string }[];
        }
      ).items.map((item) => item.id);
    expect(await listIds()).toContain(id);
    await post(`${BASE}/${id}/withdraw`, w.memberS1.token);
    expect(await listIds()).not.toContain(id);
  });

  it("#131 AC-15（batch の原子性）: 監査の書き込みが失敗すると 500 で、申請は承認待ちのまま", async () => {
    const id = await pendingOf("memberS1", w.deptS.id);
    await env.DB.exec(
      "CREATE TRIGGER unit_131_fail_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'channel_request.withdraw' BEGIN SELECT RAISE(ABORT, 'unit_131_fail_audit'); END",
    );
    const before = await requestSnapshot();
    const res = await post(`${BASE}/${id}/withdraw`, w.memberS1.token);
    expect(res.status).toBe(500);
    expect(await requestSnapshot()).toEqual(before);
    expect((await requestRow(id))?.status).toBe("pending");
  });
});
