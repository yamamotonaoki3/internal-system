// #156（0-6 AC-1・AC-2・AC-5・AC-6）: 監査ログの閲覧の Service の判定の順と、行の整形（toAuditLogItem）を、Repository の代役で確かめる。
// 契約（実装者へ。実装前の仮置き。backend/src/services/audit-log.service.ts）：
//   createAuditLogService(repository, roles, deps?: { now?: () => Date })・withAuditLogService(env, run)
//   service.authorize(actor)：会社の範囲で perm.audit_log.view を authorize する（全体管理者だけ可。拒否は 403 FORBIDDEN。拒否の記録は authorizer が出す）
//   service.search(actor, input) → { items: AuditLogItem[]; nextCursor: string | null }
//     actor は { userId, sessionId, traceId }。input は検証済みの本文：{ from?, to?, actorId?, action?, targetType?, targetId?, result?, cursor?: CursorPayload, limit }
//     順：authorize（拒否なら Repository を呼ばない）→ repository.search({ viewer: { userId, sessionId, traceId }, now: now(), filter, cursor, limit }) → items を toAuditLogItem で整形。
//   Repository：search（audit-log.repository.view.db.test.ts の契約。資格がなく記録が0行なら AuditLogViewStateChangedError）・
//     findViewerFacts({ userId, sessionId }) → { session: { userId, createdAt, lastActiveAt, revokedAt } | null, isUserActive, isGlobalAdmin }
//   0行（AuditLogViewStateChangedError）のときの読み直しは、最初と同じ順（セッションの状態を先に見るので、ログアウトした人に権限の状態を教えない）：
//     セッションの行がない・利用者が違う・失効・無操作の期限・作成からの期限（session-policy の isSessionExpired と同じ）・利用者が無効 → 401 UNAUTHENTICATED
//     → 全体管理者でない（ロールがない・範囲が会社でない）→ 403 FORBIDDEN → どれにも当たらなければ、成功にせず元のエラーを投げる（500）。
//   toAuditLogItem(row: AuditLogRow) → AuditLogItem：
//     { id, occurredAt, action, result, actor: { id, displayName, isActive } | null, target: { type, id, label, isActive } | null,
//       failureCategory?, affectedCount?, reason? }
//     actor：actorId が null なら null、行がなければ { id, displayName: null, isActive: false }。
//     target：targetType が null でなければ { type, id, label: targetName, isActive: targetIsActive }（行がなければ label・isActive が null）。targetId が null なら target は null。
//       例外：action が account.create で result が failure のときは、対象の社員を示さない（target は null。C-76・0-6 AC-2）。
//     detail（JSON の文字列）から取り出すのは failureCategory（文字列）・affectedCount（数）・reason（文字列）だけ。型が違えば出さない。
//       failureCategory・affectedCount は account.create の failure のときだけ。reason はどの操作でも、文字列のときだけ。
//       detail の原文・trace_id・roomId などそのほかの項目・秘密の項目名の値は返さない（AC-5）。壊れた JSON でも例外にしない（項目なし）。
// データは架空（[UNIT_TEST]）。
import { describe, expect, it, vi } from "vitest";
import {
  AuditLogViewStateChangedError,
  type AuditLogRow,
} from "../db/audit-log.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { ROLE_IDS } from "../lib/permissions";
import { SESSION_IDLE_MS, SESSION_MAX_AGE_MS } from "../lib/session-policy";
import { createAuditLogService, toAuditLogItem } from "./audit-log.service";

const ADMIN_ID = "01JTEST156SVCADM1N00000010";
const OTHER_ID = "01JTEST156SVC0THER00000010";
const SESSION_ID = "a".repeat(64);
const NOW = new Date("2031-03-04T05:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const actor = { userId: ADMIN_ID, sessionId: SESSION_ID, traceId: "trace-156" };

type Facts = {
  session: {
    userId: string;
    createdAt: string;
    lastActiveAt: string;
    revokedAt: string | null;
  } | null;
  isUserActive: boolean;
  isGlobalAdmin: boolean;
};
const healthy: Facts = {
  session: {
    userId: ADMIN_ID,
    createdAt: ago(60_000),
    lastActiveAt: ago(1_000),
    revokedAt: null,
  },
  isUserActive: true,
  isGlobalAdmin: true,
};

const baseRow: AuditLogRow = {
  id: "01JTEST156SVCR0W0000000001",
  occurredAt: "2031-03-04T01:00:00.000Z",
  action: "account.deactivate",
  result: "success",
  actorId: OTHER_ID,
  actorName: "testuser_156s_表示",
  actorIsActive: true,
  targetType: "user",
  targetId: ADMIN_ID,
  targetName: "testuser_156s_対象",
  targetIsActive: false,
  detail: null,
};

type ActorFacts = {
  isActive: boolean;
  assignments: {
    roleId: string;
    scopeType: "company" | "department";
    departmentId: string | null;
  }[];
};
const asAdmin: ActorFacts = {
  isActive: true,
  assignments: [
    { roleId: ROLE_IDS.globalAdmin, scopeType: "company", departmentId: null },
  ],
};
const asMember: ActorFacts = { isActive: true, assignments: [] };
const asOwner: ActorFacts = {
  isActive: true,
  assignments: [
    {
      roleId: ROLE_IDS.owner,
      scopeType: "department",
      departmentId: "01JTEST156SVCDEPT000000001",
    },
  ],
};

function rolesOf(facts: ActorFacts): RoleAssignmentRepository {
  return {
    async findByUserId() {
      return {
        user: { isActive: facts.isActive },
        assignments: facts.assignments,
      };
    },
  };
}

function fakeRepository(
  options: {
    search?: () => Promise<{ items: AuditLogRow[]; nextCursor: string | null }>;
    facts?: Facts;
  } = {},
) {
  const search = vi.fn(
    options.search ?? (async () => ({ items: [baseRow], nextCursor: null })),
  );
  const findViewerFacts = vi.fn(async () => options.facts ?? healthy);
  return { search, findViewerFacts };
}

function serviceWith(
  repository: ReturnType<typeof fakeRepository>,
  roles: RoleAssignmentRepository = rolesOf(asAdmin),
) {
  return createAuditLogService(repository as never, roles, { now: () => NOW });
}

const inputOf = (extra: Record<string, unknown> = {}) => ({
  limit: 20,
  ...extra,
});

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("エラーになるはずが成功しました");
}

describe("#156 0-6 AC-1: 認可（Service）", () => {
  it.each<[string, ActorFacts]>([
    ["一般メンバー", asMember],
    ["部署のオーナー", asOwner],
  ])(
    "#156 0-6 AC-1: %sは 403 FORBIDDEN で、Repository を呼ばない（記録も取得もしない）",
    async (_label, facts) => {
      const repository = fakeRepository();
      const service = serviceWith(repository, rolesOf(facts));
      const error = await errorOf(service.search(actor, inputOf()));
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "FORBIDDEN" });
      expect(repository.search).not.toHaveBeenCalled();
      expect(repository.findViewerFacts).not.toHaveBeenCalled();
    },
  );

  it("#156 0-6 AC-1: authorize は、全体管理者なら通り、一般メンバーなら 403", async () => {
    const repository = fakeRepository();
    await expect(
      serviceWith(repository).authorize(actor),
    ).resolves.toBeUndefined();
    const error = await errorOf(
      serviceWith(repository, rolesOf(asMember)).authorize(actor),
    );
    expect(error).toMatchObject({ code: "FORBIDDEN" });
  });

  it("#156 0-6 AC-1: 無効な利用者は、全体管理者の割り当てが残っていても 403", async () => {
    const repository = fakeRepository();
    const service = serviceWith(
      repository,
      rolesOf({ ...asAdmin, isActive: false }),
    );
    expect(await errorOf(service.search(actor, inputOf()))).toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repository.search).not.toHaveBeenCalled();
  });
});

describe("#156 0-6 AC-3・AC-6: 検索（Service）", () => {
  it("#156 0-6 AC-6: 閲覧する人（利用者・セッション・trace）と、判定に使った時刻、絞り込み・カーソル・件数を、Repository に渡す", async () => {
    const repository = fakeRepository();
    const cursor = { v: "2031-03-04T01:00:00.000Z", id: baseRow.id };
    await serviceWith(repository).search(
      actor,
      inputOf({
        from: "2031-03-01",
        to: "2031-03-04",
        actorId: OTHER_ID,
        action: "account.create",
        targetType: "user",
        targetId: ADMIN_ID,
        result: "failure",
        cursor,
        limit: 7,
      }),
    );
    expect(repository.search).toHaveBeenCalledTimes(1);
    expect(repository.search).toHaveBeenCalledWith({
      viewer: { userId: ADMIN_ID, sessionId: SESSION_ID, traceId: "trace-156" },
      now: NOW,
      filter: {
        from: "2031-03-01",
        to: "2031-03-04",
        actorId: OTHER_ID,
        action: "account.create",
        targetType: "user",
        targetId: ADMIN_ID,
        result: "failure",
      },
      cursor,
      limit: 7,
    });
  });

  it("#156 0-6 AC-2・AC-3: 行を整形して、nextCursor はそのまま返す", async () => {
    const repository = fakeRepository({
      search: async () => ({ items: [baseRow], nextCursor: "next-token" }),
    });
    const page = await serviceWith(repository).search(actor, inputOf());
    expect(page.nextCursor).toBe("next-token");
    expect(page.items).toEqual([toAuditLogItem(baseRow)]);
  });

  it("#156 0-6 AC-6: Repository のそれ以外のエラーは、読み直さずにそのまま伝える（成功扱いにしない）", async () => {
    const boom = new Error("D1 が応答しません");
    const repository = fakeRepository({
      search: async () => {
        throw boom;
      },
    });
    const error = await errorOf(
      serviceWith(repository).search(actor, inputOf()),
    );
    expect(error).toBe(boom);
    expect(repository.findViewerFacts).not.toHaveBeenCalled();
  });
});

describe("#156 0-6 AC-6: 記録が0行（資格が崩れた）ときの読み直し", () => {
  const changed = () => async () => {
    throw new AuditLogViewStateChangedError();
  };
  const searchWith = (facts: Facts) => {
    const repository = fakeRepository({ search: changed(), facts });
    return {
      repository,
      run: () => serviceWith(repository).search(actor, inputOf()),
    };
  };
  const session = (overrides: Partial<NonNullable<Facts["session"]>>) => ({
    ...healthy,
    session: {
      ...(healthy.session as NonNullable<Facts["session"]>),
      ...overrides,
    },
  });

  it.each<[string, Facts]>([
    ["セッションの行がない", { ...healthy, session: null }],
    ["セッションが失効している", session({ revokedAt: ago(1_000) })],
    ["セッションの利用者が違う", session({ userId: OTHER_ID })],
    ["無操作の期限のちょうど", session({ lastActiveAt: ago(SESSION_IDLE_MS) })],
    [
      "作成から24時間のちょうど",
      session({ createdAt: ago(SESSION_MAX_AGE_MS) }),
    ],
    ["利用者が無効", { ...healthy, isUserActive: false }],
  ])("#156 0-6 AC-6: %s場合は、401 UNAUTHENTICATED", async (_label, facts) => {
    const { run } = searchWith(facts);
    const error = await errorOf(run());
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("#156 0-6 AC-6: 全体管理者でない（ロールがない・範囲が会社でない）場合は、403 FORBIDDEN", async () => {
    const { run } = searchWith({ ...healthy, isGlobalAdmin: false });
    expect(await errorOf(run())).toMatchObject({ code: "FORBIDDEN" });
  });

  it("#156 0-6 AC-6: セッションの理由と権限の理由が両方あるときは、セッションを先に見て 401（ログアウトした人に権限の状態を教えない）", async () => {
    const { run } = searchWith({
      ...session({ revokedAt: ago(1_000) }),
      isGlobalAdmin: false,
    });
    expect(await errorOf(run())).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("#156 0-6 AC-6: 期限の境界の1ミリ秒前など、どの理由にも当たらないときは、成功にせず元のエラーを投げる（500）", async () => {
    const { run } = searchWith(
      session({ lastActiveAt: ago(SESSION_IDLE_MS - 1) }),
    );
    const error = await errorOf(run());
    expect(error).toBeInstanceOf(AuditLogViewStateChangedError);
    expect(error).not.toBeInstanceOf(AppError);
  });

  it("#156 0-6 AC-6: 読み直しには、閲覧する人の利用者 ID とセッション ID を渡す", async () => {
    const { repository, run } = searchWith(healthy);
    await errorOf(run());
    expect(repository.findViewerFacts).toHaveBeenCalledWith({
      userId: ADMIN_ID,
      sessionId: SESSION_ID,
    });
  });
});

describe("#156 0-6 AC-2: toAuditLogItem（行の整形）", () => {
  it("#156 0-6 AC-2: 日時・操作・結果・操作した人（有効・無効）・対象の名前を整形する。内部の列（actorName など）はそのまま出さない", () => {
    expect(toAuditLogItem(baseRow)).toEqual({
      id: baseRow.id,
      occurredAt: baseRow.occurredAt,
      action: "account.deactivate",
      result: "success",
      actor: {
        id: OTHER_ID,
        displayName: "testuser_156s_表示",
        isActive: true,
      },
      target: {
        type: "user",
        id: ADMIN_ID,
        label: "testuser_156s_対象",
        isActive: false,
      },
    });
  });

  it("#156 0-6 AC-2: 操作者が不明（null）なら actor は null。行がない操作者は、名前なし・無効", () => {
    expect(
      toAuditLogItem({
        ...baseRow,
        actorId: null,
        actorName: null,
        actorIsActive: null,
      }).actor,
    ).toBeNull();
    expect(
      toAuditLogItem({ ...baseRow, actorName: null, actorIsActive: null })
        .actor,
    ).toEqual({ id: OTHER_ID, displayName: null, isActive: false });
  });

  it("#156 0-6 AC-2: 対象の行がなければ label と isActive が null。対象の ID がなければ target は null", () => {
    expect(
      toAuditLogItem({ ...baseRow, targetName: null, targetIsActive: null })
        .target,
    ).toEqual({ type: "user", id: ADMIN_ID, label: null, isActive: null });
    expect(
      toAuditLogItem({
        ...baseRow,
        action: "auth.rate_limited",
        targetType: "source",
        targetId: null,
        targetName: null,
        targetIsActive: null,
      }).target,
    ).toBeNull();
  });

  it("#156 0-6 AC-2・AC-7: アカウント登録の失敗は、対象の社員を示さず（target は null）、エラー分類と対象件数を出す", () => {
    const item = toAuditLogItem({
      ...baseRow,
      action: "account.create",
      result: "failure",
      detail: JSON.stringify({
        failureCategory: "duplicate_login_id",
        affectedCount: 3,
      }),
    });
    expect(item.target).toBeNull();
    expect(item).toMatchObject({
      failureCategory: "duplicate_login_id",
      affectedCount: 3,
    });
    expect(JSON.stringify(item)).not.toContain("testuser_156s_対象");
  });

  it("#156 0-6 AC-2: アカウント登録の成功は、対象の社員を出し、failureCategory・affectedCount は出さない（detail にあっても）", () => {
    const item = toAuditLogItem({
      ...baseRow,
      action: "account.create",
      result: "success",
      detail: JSON.stringify({ failureCategory: "x", affectedCount: 1 }),
    });
    expect(item.target).toMatchObject({ label: "testuser_156s_対象" });
    expect(item).not.toHaveProperty("failureCategory");
    expect(item).not.toHaveProperty("affectedCount");
  });

  it("#156 0-6 AC-2: 型が違う failureCategory・affectedCount は出さない（文字列でない分類・数でない件数）", () => {
    const item = toAuditLogItem({
      ...baseRow,
      action: "account.create",
      result: "failure",
      detail: JSON.stringify({ failureCategory: 5, affectedCount: "3" }),
    });
    expect(item).not.toHaveProperty("failureCategory");
    expect(item).not.toHaveProperty("affectedCount");
  });

  it("#156 0-6 AC-2: reason は、文字列のときだけ出す（数・入れ子は出さない）", () => {
    expect(
      toAuditLogItem({
        ...baseRow,
        detail: JSON.stringify({ reason: "locked" }),
      }),
    ).toMatchObject({ reason: "locked" });
    expect(
      toAuditLogItem({ ...baseRow, detail: JSON.stringify({ reason: 3 }) }),
    ).not.toHaveProperty("reason");
    expect(
      toAuditLogItem({
        ...baseRow,
        detail: JSON.stringify({ reason: { a: 1 } }),
      }),
    ).not.toHaveProperty("reason");
  });

  it("#156 0-6 AC-5: detail の原文・秘密の項目名の値・roomId など決めた項目以外は、返さない", () => {
    const item = toAuditLogItem({
      ...baseRow,
      action: "message.delete",
      targetType: "message",
      targetId: "01JTEST156SVCMSG0000000001",
      targetName: null,
      targetIsActive: null,
      detail: JSON.stringify({
        reason: "policy",
        roomId: "01JTEST156SVCR00M000000001",
        password: "[UNIT_TEST]secret-value",
        lockedUntil: "2031-03-04T06:00:00.000Z",
      }),
    });
    const text = JSON.stringify(item);
    expect(text).not.toContain("secret-value");
    expect(text).not.toContain("01JTEST156SVCR00M000000001");
    expect(text).not.toContain("lockedUntil");
    expect(text).not.toContain('"detail"');
    expect(text).not.toContain("traceId");
    expect(item).toMatchObject({ reason: "policy" });
    expect(Object.keys(item).sort()).toEqual(
      [
        "action",
        "actor",
        "id",
        "occurredAt",
        "reason",
        "result",
        "target",
      ].sort(),
    );
  });

  it("#156 0-6 AC-2: detail が null・壊れた JSON・配列・文字列でも、例外にせず、決めた項目なしで整形する", () => {
    for (const detail of [null, "{broken", "[1,2]", '"text"', "123"]) {
      const item = toAuditLogItem({ ...baseRow, detail });
      expect(Object.keys(item).sort()).toEqual(
        ["action", "actor", "id", "occurredAt", "result", "target"].sort(),
      );
    }
  });
});
