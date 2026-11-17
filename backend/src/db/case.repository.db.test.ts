// #147（147-A）5-1 AC-2・AC-4・AC-12・AC-21（Q6）、レビュー2回目：案件の一覧（EP-5-06）の Repository を、マイグレーション済みの D1 で確かめる。
// この層で確かめるもの（計画 147-A のテストケース）：SQL で絞る範囲（joined は「有効な参加者」の案件だけ。ページを送っても参加していない案件が混ざらない）・
//   status の絞り込み・ID の降順のカーソル・all の非参加の行の項目（説明・参加者を返さない）・participantCount を返す相手（参加者・管理の資格のある人）。
// 判定の順・応答の形（JSON）・詳細の 403 は結合テスト（routes/cases.test.ts）で確かめ、ここでは重ねない。
// 契約（実装前の仮置き。計画 147-A の API・管理の資格。実装の担当へ）：
//   withCases(env, (repository) => …)（backend/src/db/case.repository.ts）
//   repository.list({ actorId, isGlobalAdmin, ownedDepartmentIds, scope: "joined" | "all", status: "active" | "closed", limit, cursor?: CursorPayload })
//     : Promise<{ items: CaseListItem[]; nextCursor: string | null }>
//     isGlobalAdmin・ownedDepartmentIds は、Service が操作者のロールの割り当てを1回読んで渡す（有効な全体管理者か、オーナーである部署の ID）。
//   CaseListItem のキーは、ちょうど id・caseNumber・title・status・client{id,name,isActive}・departments[{id,name,isActive}]・dueDate・
//     isParticipant・canManage・participantCount（説明・参加者・チャンネル ID は持たない）。
//   isParticipant は「有効な参加者」（activeChannelMember）。participantCount は参加者か管理の資格のある人の行だけ数で、ほかは null。
//   participantCount は、参加の行の数（退職者＝無効な社員の行を含む。計画のリスクの節「一覧に出る人数」と S-17 の「参加者 N人」を一致させる）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  caseIdOf,
  cleanupCaseTestData,
  joinedAt,
  seedCase,
} from "../../test/case-fixtures";
import {
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { decodeCursor } from "../lib/cursor";
import { withCases } from "./case.repository";

let w: CaseWorld;

type Scope = "joined" | "all";
type Status = "active" | "closed";
type Viewer = {
  actorId: string;
  isGlobalAdmin?: boolean;
  ownedDepartmentIds?: string[];
};

type ListItem = {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  client: { id: string; name: string; isActive: boolean };
  departments: { id: string; name: string; isActive: boolean }[];
  dueDate: string | null;
  isParticipant: boolean;
  canManage: boolean;
  participantCount: number | null;
};

const ITEM_KEYS = [
  "canManage",
  "caseNumber",
  "client",
  "departments",
  "dueDate",
  "id",
  "isParticipant",
  "participantCount",
  "status",
  "title",
];

const list = (
  viewer: Viewer,
  scope: Scope,
  status: Status,
  options: { limit?: number; cursor?: string | null } = {},
) =>
  withCases(env, (repository) =>
    repository.list({
      actorId: viewer.actorId,
      isGlobalAdmin: viewer.isGlobalAdmin ?? false,
      ownedDepartmentIds: viewer.ownedDepartmentIds ?? [],
      scope,
      status,
      limit: options.limit ?? 20,
      ...(options.cursor == null
        ? {}
        : { cursor: decodeCursor(options.cursor) }),
    }),
  ) as Promise<{ items: ListItem[]; nextCursor: string | null }>;

/** limit 件ずつ最後のページまで送り、すべての行を返す */
async function listAll(
  viewer: Viewer,
  scope: Scope,
  status: Status,
  limit: number,
): Promise<ListItem[]> {
  const items: ListItem[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i += 1) {
    const page = await list(viewer, scope, status, { limit, cursor });
    expect(page.items.length).toBeLessThanOrEqual(limit);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return items;
  }
  throw new Error("一覧のページが終わりませんでした");
}

const byId = (items: ListItem[], n: number) => {
  const found = items.find((item) => item.id === caseIdOf(n));
  if (found === undefined) throw new Error(`案件 ${n} がありません`);
  return found;
};

/**
 * 案件（n が大きいほど新しい）：
 *  1 進行中・QZA・deptS：memberS1（作成者）・memberD1・inactive（無効。行は残す）。説明あり・納期あり
 *  2 進行中・QZB・deptD：memberD1
 *  3 終了・QZA・deptS と deptD：memberS1
 *  4 進行中・QZA・deptS：memberS1
 *  5 進行中・QZB・deptD：inactive だけ（無効な社員の参加の行だけが残っている）
 *  6 進行中・QZA・deptS：memberS1
 */
beforeEach(async () => {
  w = await setupCaseWorld();
  const seed = (
    n: number,
    client: "A" | "B",
    departmentIds: string[],
    memberIds: string[],
    extra: { status?: Status; description?: string; dueDate?: string } = {},
  ) =>
    seedCase({
      n,
      clientId: client === "A" ? w.clientA.id : w.clientB.id,
      code: client === "A" ? "QZA" : "QZB",
      title: `[UNIT_TEST]147A一覧${n}`,
      createdBy: memberIds[0] ?? w.memberS2.id,
      departmentIds,
      members: memberIds.map((userId, index) => ({
        userId,
        joinedAt: joinedAt(index + 1),
      })),
      ...extra,
    });
  await seed(
    1,
    "A",
    [w.deptS.id],
    [w.memberS1.id, w.memberD1.id, w.inactive.id],
    {
      description: "[UNIT_TEST]147Aの非公開の説明",
      dueDate: "2026-12-01",
    },
  );
  await seed(2, "B", [w.deptD.id], [w.memberD1.id]);
  await seed(3, "A", [w.deptS.id, w.deptD.id], [w.memberS1.id], {
    status: "closed",
  });
  await seed(4, "A", [w.deptS.id], [w.memberS1.id]);
  await seed(5, "B", [w.deptD.id], [w.inactive.id]);
  await seed(6, "A", [w.deptS.id], [w.memberS1.id]);
});

afterEach(async () => {
  await cleanupCaseTestData();
});

describe("#147 5-1 AC-4・AC-12 一覧の範囲（joined）と並び", () => {
  it("#147 5-1 AC-4: joined・進行中は、参加している進行中の案件だけを ID の降順で返す", async () => {
    const page = await list({ actorId: w.memberS1.id }, "joined", "active");
    expect(page.items.map((item) => item.id)).toEqual([
      caseIdOf(6),
      caseIdOf(4),
      caseIdOf(1),
    ]);
    expect(page.nextCursor).toBeNull();
    for (const item of page.items) expect(item.isParticipant).toBe(true);
  });

  it("#147 5-1 AC-4・AC-12: joined を limit=1 で最後まで送っても、参加していない案件が混ざらず、漏れも重複もない", async () => {
    const items = await listAll(
      { actorId: w.memberS1.id },
      "joined",
      "active",
      1,
    );
    expect(items.map((item) => item.id)).toEqual([
      caseIdOf(6),
      caseIdOf(4),
      caseIdOf(1),
    ]);
  });

  it("#147 5-1 AC-12: status=closed では終了した案件だけを返す（joined・all とも）", async () => {
    const joined = await list({ actorId: w.memberS1.id }, "joined", "closed");
    expect(joined.items.map((item) => item.id)).toEqual([caseIdOf(3)]);
    expect(joined.items[0]?.status).toBe("closed");
    const all = await list({ actorId: w.memberS2.id }, "all", "closed");
    expect(all.items.map((item) => item.id)).toEqual([caseIdOf(3)]);
  });

  it("#147 5-1 AC-4: 参加していない社員の joined は 0 件", async () => {
    const page = await list({ actorId: w.memberS2.id }, "joined", "active");
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("#147 有効な参加者（レビュー2回目）: 参加の行が残っていても、無効な社員の joined には出ず、all でも isParticipant は false", async () => {
    // 行が実際に残っていること（空振りしないこと）を先に確かめる
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM channel_members WHERE user_id = ? AND channel_id IN (SELECT channel_id FROM cases)",
    )
      .bind(w.inactive.id)
      .first<{ n: number }>();
    expect(row?.n).toBe(2);
    const joined = await list({ actorId: w.inactive.id }, "joined", "active");
    expect(joined.items).toEqual([]);
    const all = await list({ actorId: w.inactive.id }, "all", "active");
    expect(all.items.length).toBeGreaterThan(0);
    for (const item of all.items) {
      expect(item.isParticipant).toBe(false);
      expect(item.participantCount).toBeNull();
    }
  });

  it("#147 5-1 AC-4: all は進行中のすべての案件を ID の降順で返し、limit=2 で送っても漏れも重複もない", async () => {
    const items = await listAll({ actorId: w.memberS2.id }, "all", "active", 2);
    expect(items.map((item) => item.id)).toEqual([
      caseIdOf(6),
      caseIdOf(5),
      caseIdOf(4),
      caseIdOf(2),
      caseIdOf(1),
    ]);
  });
});

describe("#147 5-1 AC-2・AC-21 all の行の項目", () => {
  it("#147 5-1 AC-2: 一般の非参加者の行は概要の項目だけで、participantCount は null、isParticipant・canManage は false", async () => {
    const page = await list({ actorId: w.memberS2.id }, "all", "active");
    expect(page.items.length).toBe(5);
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
      expect(item.isParticipant).toBe(false);
      expect(item.canManage).toBe(false);
      expect(item.participantCount).toBeNull();
    }
    const text = JSON.stringify(page.items);
    expect(text).not.toContain("147Aの非公開の説明");
  });

  it("#147 5-1 AC-2・AC-17・AC-19: 概要の項目（案件番号・件名・状態・取引先・担当部署・納期）を返す", async () => {
    const page = await list({ actorId: w.memberS2.id }, "all", "active");
    const first = byId(page.items, 1);
    expect(first).toMatchObject({
      caseNumber: "QZA-261117-0001",
      title: "[UNIT_TEST]147A一覧1",
      status: "active",
      client: { id: w.clientA.id, name: w.clientA.name, isActive: true },
      departments: [{ id: w.deptS.id, name: w.deptS.name, isActive: true }],
      dueDate: "2026-12-01",
    });
    expect(Object.keys(first.client).sort()).toEqual([
      "id",
      "isActive",
      "name",
    ]);
    expect(byId(page.items, 2).dueDate).toBeNull();
  });

  it("#147 5-1 AC-2: 参加者の行には participantCount（参加の行の数。無効な社員を含む）が入り、参加していない行は null", async () => {
    const page = await list({ actorId: w.memberS1.id }, "all", "active");
    const joined = byId(page.items, 1);
    expect(joined.isParticipant).toBe(true);
    expect(joined.participantCount).toBe(3);
    expect(Object.keys(joined).sort()).toEqual(ITEM_KEYS);
    const other = byId(page.items, 2);
    expect(other.isParticipant).toBe(false);
    expect(other.participantCount).toBeNull();
  });

  it("#147 5-1 AC-21（Q6）: 担当部署のオーナーは、参加していなくても、担当の案件だけ participantCount が入り canManage が true", async () => {
    const page = await list(
      { actorId: w.ownerS.id, ownedDepartmentIds: [w.deptS.id] },
      "all",
      "active",
    );
    const own = byId(page.items, 1);
    expect(own.isParticipant).toBe(false);
    expect(own.canManage).toBe(true);
    expect(own.participantCount).toBe(3);
    for (const n of [2, 5]) {
      const item = byId(page.items, n);
      expect(item.canManage).toBe(false);
      expect(item.participantCount).toBeNull();
    }
  });

  it("#147 5-1 AC-21（Q6）: 担当部署が複数の案件では、どれか1つのオーナーなら管理の資格がある", async () => {
    const page = await list(
      { actorId: w.ownerD.id, ownedDepartmentIds: [w.deptD.id] },
      "all",
      "closed",
    );
    const item = byId(page.items, 3);
    expect(item.canManage).toBe(true);
    expect(item.participantCount).toBe(1);
  });

  it("#147 5-1 AC-21（Q6）: 全体管理者は、参加していなくても、すべての行に participantCount が入り canManage が true", async () => {
    const page = await list(
      { actorId: w.admin.id, isGlobalAdmin: true },
      "all",
      "active",
    );
    expect(page.items.length).toBe(5);
    for (const item of page.items) {
      expect(item.isParticipant).toBe(false);
      expect(item.canManage).toBe(true);
      expect(item.participantCount).not.toBeNull();
    }
    expect(byId(page.items, 2).participantCount).toBe(1);
    expect(byId(page.items, 5).participantCount).toBe(1);
  });

  it("#147 5-1 AC-19: 取引先・担当部署が無効なら isActive: false で、そのまま返す", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE clients SET is_active = 0 WHERE id = ?").bind(
        w.clientB.id,
      ),
      env.DB.prepare("UPDATE departments SET is_active = 0 WHERE id = ?").bind(
        w.deptD.id,
      ),
    ]);
    const page = await list({ actorId: w.memberS2.id }, "all", "active");
    const item = byId(page.items, 2);
    expect(item.client).toEqual({
      id: w.clientB.id,
      name: w.clientB.name,
      isActive: false,
    });
    expect(item.departments).toEqual([
      { id: w.deptD.id, name: w.deptD.name, isActive: false },
    ]);
  });
});
