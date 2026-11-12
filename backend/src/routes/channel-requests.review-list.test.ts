// #131 AC-7・AC-8（2-2 AC-7・AC-8・AC-10）：審査一覧（EP-2-09 GET /api/channel-requests）の見える範囲を、主体ごとに実際のアプリ入口と隔離 D1 で確かめる。
// 範囲の条件は SQL の WHERE に入れる（取得後に取り除かない）ため、範囲外の行がページ送りに漏れない・件数が崩れないことも確かめる。
// 契約（実装者へ。テストが決めたもの）：
//  - GET /api/channel-requests?status&departmentId&limit&cursor
//      → 200 { items: [{ id, departmentId, name, visibility, status, rejectReason, createdAt, decidedAt, channelId,
//                        requesterId, requesterDisplayName, canApprove }], nextCursor }
//      id 降順。limit 既定 20・1〜100。status は pending | approved | rejected | withdrawn（省略はすべて）。departmentId は ULID。不正は 422
//      見える範囲：決裁できる申請（canApprove=true）＋「オーナーが自部署で出した自分の申請」（canApprove=false）。審査者でない人は 403 FORBIDDEN
//      Cache-Control に no-store。申請者のメール・本名は含めない
// データは架空（testuser_chreq_・@example.com・[UNIT_TEST] の部署・UNIT_TEST_ のチャンネル名）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  BASE,
  CHREQ_NOW,
  NAME_PREFIX,
  cleanupChannelRequestTestData,
  insertChannelRequest,
  setupWorld,
  type World,
} from "../../test/channel-request-fixtures";

type ReviewItem = {
  id: string;
  departmentId: string | null;
  name: string;
  visibility: string;
  status: string;
  rejectReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  channelId: string | null;
  requesterId: string;
  requesterDisplayName: string;
  canApprove: boolean;
};
type ReviewPage = { items: ReviewItem[]; nextCursor: string | null };

let w: World;
// 申請の ID（R1〜R7）
let r: Record<string, string>;

const get = (path: string, token: string) => apiRequest("GET", path, { token });

async function listAll(token: string, query = ""): Promise<ReviewItem[]> {
  const items: ReviewItem[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i += 1) {
    const params = new URLSearchParams(query);
    params.set("limit", "100");
    if (cursor !== null) params.set("cursor", cursor);
    const res = await get(`${BASE}?${params.toString()}`, token);
    expect(res.status).toBe(200);
    const page = (await res.json()) as ReviewPage;
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return items;
  }
  throw new Error("一覧のページが終わりませんでした");
}

const visible = (items: ReviewItem[]) =>
  Object.fromEntries(items.map((item) => [item.id, item.canApprove]));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CHREQ_NOW));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  w = await setupWorld();
  const seed = (
    key: string,
    departmentId: string | null,
    requestedBy: string,
    status: "pending" | "rejected" = "pending",
  ) =>
    insertChannelRequest({
      departmentId,
      name: `${NAME_PREFIX}一覧${key}`,
      requestedBy,
      status,
      ...(status === "rejected" ? { decidedBy: w.ownerS.id } : {}),
    }).then((id) => [key, id] as const);
  r = Object.fromEntries([
    await seed("R1", w.deptS.id, w.memberS1.id),
    await seed("R2", w.deptS.id, w.ownerS.id),
    await seed("R3", w.deptD.id, w.memberD1.id),
    await seed("R4", w.deptH.id, w.memberH1.id),
    await seed("R5", null, w.memberS1.id),
    await seed("R6", null, w.admin.id),
    await seed("R7", w.deptS.id, w.memberS2.id, "rejected"),
  ]);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupChannelRequestTestData();
});

describe("#131 AC-7・AC-8（EP-2-09）主体ごとの見える範囲と canApprove", () => {
  it("#131 AC-7・AC-8: 部署のオーナーは自部署の申請だけを見る。自分の申請は canApprove=false で出る。会社直属・他部署は出ない", async () => {
    const items = await listAll(w.ownerS.token, "status=pending");
    expect(visible(items)).toEqual({ [r.R1 ?? ""]: true, [r.R2 ?? ""]: false });
  });

  it("#131 AC-7: 兼任でないオーナー（本部）には、会社直属の申請も他部署の申請も出ない", async () => {
    const items = await listAll(w.ownerH.token, "status=pending");
    expect(visible(items)).toEqual({ [r.R4 ?? ""]: true });
  });

  it("#131 AC-7・AC-8・AC-10: 全体管理者は、会社直属（自分の申請を含む）・任命された部署・オーナー自身の申請を見て、すべて承認できる。任命されていない部署の一般社員の申請は出ない", async () => {
    const items = await listAll(w.admin.token, "status=pending");
    expect(visible(items)).toEqual({
      [r.R2 ?? ""]: true,
      [r.R3 ?? ""]: true,
      [r.R5 ?? ""]: true,
      [r.R6 ?? ""]: true,
    });
  });

  it.each<keyof World>(["memberS1", "memberD1", "memberH1"])(
    "#131 AC-7: メンバー（%s）は 403 FORBIDDEN（自分の申請があっても）",
    async (member) => {
      const res = await get(BASE, (w[member] as { token: string }).token);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it("#131 AC-7: 項目は決めた 12 項目で、申請者の表示名を含み、メール・本名を含めない。no-store", async () => {
    const res = await get(`${BASE}?status=pending`, w.ownerS.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const text = await res.text();
    const page = JSON.parse(text) as ReviewPage;
    for (const item of page.items)
      expect(Object.keys(item).sort()).toEqual(
        [
          "canApprove",
          "channelId",
          "createdAt",
          "decidedAt",
          "departmentId",
          "id",
          "name",
          "rejectReason",
          "requesterDisplayName",
          "requesterId",
          "status",
          "visibility",
        ].sort(),
      );
    expect(page.items.find((item) => item.id === r.R1)).toMatchObject({
      departmentId: w.deptS.id,
      name: `${NAME_PREFIX}一覧R1`,
      status: "pending",
      requesterId: w.memberS1.id,
      requesterDisplayName: "テスト太郎",
      canApprove: true,
    });
    expect(text).not.toContain("@example.com");
  });
});

describe("#131 AC-7（EP-2-09）決裁済みの行の canApprove", () => {
  it("#131 AC-7・二重決裁: 決裁済み・取り下げ済みの行は、決裁できる人の範囲でも canApprove=false（承認待ちだけ true）", async () => {
    const approved = await insertChannelRequest({
      departmentId: w.deptS.id,
      name: `${NAME_PREFIX}一覧承認済み`,
      requestedBy: w.memberS1.id,
      status: "approved",
      decidedBy: w.ownerS.id,
    });
    const withdrawn = await insertChannelRequest({
      departmentId: w.deptS.id,
      name: `${NAME_PREFIX}一覧取下`,
      requestedBy: w.memberS2.id,
      status: "withdrawn",
    });
    const items = await listAll(w.ownerS.token);
    expect(visible(items)).toEqual({
      [r.R1 ?? ""]: true,
      [r.R2 ?? ""]: false,
      [r.R7 ?? ""]: false,
      [approved]: false,
      [withdrawn]: false,
    });
  });

  it("#131 AC-10: 会社直属の決裁済みの行も、全体管理者に canApprove=false で出る", async () => {
    const rejected = await insertChannelRequest({
      departmentId: null,
      name: `${NAME_PREFIX}一覧会社却下`,
      requestedBy: w.memberS1.id,
      status: "rejected",
      decidedBy: w.admin.id,
    });
    const items = await listAll(w.admin.token, "status=rejected");
    expect(visible(items)).toEqual({ [rejected]: false });
  });
});

describe("#131 AC-7（EP-2-09）絞り込みは範囲の中で効く", () => {
  it("#131 AC-7: status=rejected は範囲の中の却下済みだけ（オーナーには自部署の却下が出る）", async () => {
    const items = await listAll(w.ownerS.token, "status=rejected");
    expect(items.map((item) => item.id)).toEqual([r.R7]);
    expect(items[0]).toMatchObject({
      status: "rejected",
      rejectReason: "テストの却下理由",
    });
  });

  it("#131 AC-7: status を省くと、範囲の中の全状態が出る", async () => {
    const items = await listAll(w.ownerS.token);
    expect(items.map((item) => item.id).sort()).toEqual(
      [r.R1, r.R2, r.R7].sort(),
    );
  });

  it("#131 AC-7・AC-8: departmentId で絞っても範囲は広がらない（全体管理者が営業を指定すると、オーナー自身の申請 R2 だけ）", async () => {
    const sales = await listAll(w.admin.token, `departmentId=${w.deptS.id}`);
    expect(sales.map((item) => item.id)).toEqual([r.R2]);
    const dev = await listAll(w.admin.token, `departmentId=${w.deptD.id}`);
    expect(dev.map((item) => item.id)).toEqual([r.R3]);
    const other = await listAll(w.ownerH.token, `departmentId=${w.deptS.id}`);
    expect(other).toEqual([]);
  });

  it("#131 AC-7: 並びは id の降順", async () => {
    const items = await listAll(w.admin.token, "status=pending");
    const ids = items.map((item) => item.id);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it.each([
    "status=unknown",
    "limit=0",
    "limit=101",
    "departmentId=not-a-ulid",
    "cursor=tampered-value",
  ])("#131 AC-7（クエリ検証）: %s は 422 VALIDATION_ERROR", async (query) => {
    const res = await get(`${BASE}?${query}`, w.ownerS.token);
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(text).not.toContain("tampered-value");
  });

  it("#131 AC-7（クエリ検証）: メンバーは、クエリが正しくても 403", async () => {
    const res = await get(`${BASE}?status=pending`, w.memberS1.token);
    expect(res.status).toBe(403);
  });
});

describe("#131 AC-7（EP-2-09）ページ送りで範囲外の行が漏れない", () => {
  it("#131 AC-7: 範囲内 26 件（R4 を含む）と範囲外 30 件が交互に並んでいても、既定の 20 件と 6 件に分かれ、範囲外は出ず、重複・欠落がない", async () => {
    const inScope: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      await insertChannelRequest({
        departmentId: w.deptS.id,
        name: `${NAME_PREFIX}範囲外${String(i).padStart(2, "0")}`,
        requestedBy: w.memberS1.id,
      });
      if (i < 25)
        inScope.push(
          await insertChannelRequest({
            departmentId: w.deptH.id,
            name: `${NAME_PREFIX}範囲内${String(i).padStart(2, "0")}`,
            requestedBy: w.memberH1.id,
          }),
        );
    }
    const expected = [r.R4 ?? "", ...inScope].sort().reverse();
    const first = (await (
      await get(`${BASE}?status=pending`, w.ownerH.token)
    ).json()) as ReviewPage;
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = (await (
      await get(
        `${BASE}?status=pending&cursor=${first.nextCursor}`,
        w.ownerH.token,
      )
    ).json()) as ReviewPage;
    expect(second.items).toHaveLength(6);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(
      expected,
    );
    for (const item of [...first.items, ...second.items])
      expect(item.departmentId).toBe(w.deptH.id);
  });
});
