// #128（128-c）C-177（U-1・U-8）: 退職処理の申請の一覧（自分の申請 listMine・全体管理者の一覧 listForReview）を、マイグレーション済みの D1 で確かめる。
// 期待する結果は要件（docs/requirements/decision-register.md の C-177）と設計書（docs/design/accounts.md）から決める：
//   新しい順（ID の降順）。申請者は自分の申請だけを見る。全体管理者の一覧は状態（pending・approved・rejected・withdrawn）で絞り込める（指定なしは全部）。
//   ページは limit 件。続きがあるときだけ nextCursor を返し、続きの取得で重複も抜けもない（ADR-0006）。
// データは架空（testuser_128cl_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RETIRE_NOW,
  cleanupRetirementRequestTestData,
  insertRetirementRequest,
} from "../../test/retirement-request-fixtures";
import {
  cleanupRoleTestData,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";
import { decodeCursor } from "../lib/cursor";
import {
  withRetirementRequests,
  type RetirementRequestStatus,
} from "./retirement-request.repository";

/** 一覧のテスト用の申請ID（ULID の形。数字が大きいほど新しい） */
const reqId = (n: number) => `01JTEST128CPAGE${String(n).padStart(11, "0")}`;

let deptId: string;
let ownerA: string;
let ownerB: string;
let admin: string;
let targets: string[];

const review = (
  options: {
    limit?: number;
    status?: RetirementRequestStatus;
    cursor?: ReturnType<typeof decodeCursor>;
  } = {},
) =>
  withRetirementRequests(env, (repository) =>
    repository.listForReview({ limit: 20, ...options }),
  );

const mine = (
  requesterId: string,
  options: { limit?: number; cursor?: ReturnType<typeof decodeCursor> } = {},
) =>
  withRetirementRequests(env, (repository) =>
    repository.listMine(requesterId, { limit: 20, ...options }),
  );

const idsOf = (page: { items: { id: string }[] }) =>
  page.items.map((item) => item.id);

beforeEach(async () => {
  deptId = await insertDepartment("128c一覧");
  ownerA = await insertUser("testuser_128cl_ownera", deptId);
  ownerB = await insertUser("testuser_128cl_ownerb", deptId);
  admin = await insertUser("testuser_128cl_admin", deptId);
  targets = [];
  for (let i = 1; i <= 6; i += 1)
    targets.push(await insertUser(`testuser_128cl_target${i}`, deptId));
  const seed = async (
    n: number,
    requestedBy: string,
    status: RetirementRequestStatus,
  ) => {
    await insertRetirementRequest({
      id: reqId(n),
      targetUserId: targets[n - 1] ?? "",
      requestedBy,
      departmentId: deptId,
      status,
      decidedBy: status === "pending" ? null : admin,
    });
  };
  // 申請者 ownerA：1 withdrawn・2 rejected・3 approved・4 pending・5 pending。ownerB：6 pending
  await seed(1, ownerA, "withdrawn");
  await seed(2, ownerA, "rejected");
  await seed(3, ownerA, "approved");
  await seed(4, ownerA, "pending");
  await seed(5, ownerA, "pending");
  await seed(6, ownerB, "pending");
});

afterEach(async () => {
  await cleanupRetirementRequestTestData();
  await cleanupRoleTestData();
});

describe("#128（128-c）C-177（U-1）全体管理者の一覧 listForReview（D1）", () => {
  it("#128 C-177（U-8）: 状態を指定しなければ、すべての申請を新しい順に返し、1件の形は対象・部署・申請者・理由・日時を含む（本名・メールを含まない）", async () => {
    const page = await review();
    expect(idsOf(page)).toEqual([6, 5, 4, 3, 2, 1].map(reqId));
    expect(page.nextCursor).toBeNull();
    expect(page.items.find((item) => item.id === reqId(2))).toEqual({
      id: reqId(2),
      status: "rejected",
      target: { id: targets[1], displayName: "テスト太郎" },
      department: { id: deptId, name: "[UNIT_TEST]128c一覧" },
      requester: { id: ownerA, displayName: "テスト太郎" },
      decisionReason: "[UNIT_TEST]却下の理由",
      createdAt: RETIRE_NOW,
      decidedAt: RETIRE_NOW,
    });
  });

  it.each<[RetirementRequestStatus, number[]]>([
    ["pending", [6, 5, 4]],
    ["approved", [3]],
    ["rejected", [2]],
    ["withdrawn", [1]],
  ])(
    "#128 C-177（U-1）: 状態に %s を指定すると、その状態の申請だけを新しい順に返す",
    async (status, numbers) => {
      expect(idsOf(await review({ status }))).toEqual(numbers.map(reqId));
    },
  );

  it("#128 C-177（U-1）: 指定した状態の申請がなければ、空の一覧と nextCursor なし", async () => {
    await env.DB.prepare(
      "DELETE FROM retirement_requests WHERE status = 'approved'",
    ).run();
    expect(await review({ status: "approved" })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it.each<[string, number, number[], boolean]>([
    ["件数と同じ（ちょうど）", 6, [6, 5, 4, 3, 2, 1], false],
    ["件数より1件少ない", 5, [6, 5, 4, 3, 2], true],
    ["件数より1件多い", 7, [6, 5, 4, 3, 2, 1], false],
    ["1件", 1, [6], true],
  ])(
    "#128 C-177（U-1）: limit が%s（%i）のとき、その件数までを返し、続きがあるときだけ nextCursor を返す",
    async (_label, limit, numbers, hasNext) => {
      const page = await review({ limit });
      expect(idsOf(page)).toEqual(numbers.map(reqId));
      expect(page.nextCursor === null).toBe(!hasNext);
    },
  );

  it("#128 C-177（U-1）: nextCursor は、そのページの最後の申請のIDを指す", async () => {
    const page = await review({ limit: 2 });
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor ?? "")).toEqual({
      v: reqId(5),
      id: reqId(5),
    });
  });

  it("#128 C-177（U-1）: 続きの取得（cursor）で、重複も抜けもなく新しい順に最後まで読め、最後のページは nextCursor なし", async () => {
    const seen: string[] = [];
    const pages: number[] = [];
    let cursor: ReturnType<typeof decodeCursor> | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await review({ limit: 2, cursor });
      seen.push(...idsOf(page));
      pages.push(page.items.length);
      if (page.nextCursor === null) break;
      cursor = decodeCursor(page.nextCursor);
    }
    expect(seen).toEqual([6, 5, 4, 3, 2, 1].map(reqId));
    expect(pages).toEqual([2, 2, 2]);
  });

  it("#128 C-177（U-1）: 状態の絞り込みと続きの取得を組み合わせても、その状態の申請だけを重複・抜けなく読める", async () => {
    const first = await review({ status: "pending", limit: 2 });
    expect(idsOf(first)).toEqual([6, 5].map(reqId));
    const second = await review({
      status: "pending",
      limit: 2,
      cursor: decodeCursor(first.nextCursor ?? ""),
    });
    expect(idsOf(second)).toEqual([reqId(4)]);
    expect(second.nextCursor).toBeNull();
  });

  it("#128 C-177（U-1）: ページの最後の行のIDが ULID の形でなければ、続きのカーソルを作れずエラーにする（黙って成功にしない）", async () => {
    await insertRetirementRequest({
      id: "invalid-request-id",
      targetUserId: targets[5] ?? "",
      requestedBy: ownerB,
      departmentId: deptId,
      status: "withdrawn",
    });
    await expect(review({ limit: 1 })).rejects.toThrow();
  });
});

describe("#128（128-c）C-177（U-1）自分の申請 listMine（D1）", () => {
  it("#128 C-177（U-1）: 申請者本人の申請だけを新しい順に返し、ほかの申請者の申請は含まない。申請者の項目は応答にない", async () => {
    const page = await mine(ownerA);
    expect(idsOf(page)).toEqual([5, 4, 3, 2, 1].map(reqId));
    expect(page.items.every((item) => !("requester" in item))).toBe(true);
    expect(idsOf(await mine(ownerB))).toEqual([reqId(6)]);
    expect(await mine(admin)).toEqual({ items: [], nextCursor: null });
  });

  it("#128 C-177（U-1）: 続きの取得（cursor）で、自分の申請を重複も抜けもなく読める", async () => {
    const first = await mine(ownerA, { limit: 2 });
    expect(idsOf(first)).toEqual([5, 4].map(reqId));
    const second = await mine(ownerA, {
      limit: 2,
      cursor: decodeCursor(first.nextCursor ?? ""),
    });
    expect(idsOf(second)).toEqual([3, 2].map(reqId));
    const third = await mine(ownerA, {
      limit: 2,
      cursor: decodeCursor(second.nextCursor ?? ""),
    });
    expect(idsOf(third)).toEqual([reqId(1)]);
    expect(third.nextCursor).toBeNull();
  });

  it("#128 C-177（U-1）: limit が件数と同じ（5）なら nextCursor なし。1件少ない（4）なら nextCursor あり", async () => {
    expect((await mine(ownerA, { limit: 5 })).nextCursor).toBeNull();
    expect((await mine(ownerA, { limit: 4 })).nextCursor).not.toBeNull();
  });
});
