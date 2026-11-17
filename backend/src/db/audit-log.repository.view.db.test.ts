// #156（0-6 AC-6）: 監査ログの検索1回ごとに、閲覧の記録（audit_log.view）が残ること、記録と取得が同じ db.batch の条件で一体であること
// （確定の時点で閲覧の資格がなければ、記録も行も0で、記録を回避した閲覧はできない）を、マイグレーション済みの D1 で確かめる。
// 契約（実装者へ。audit-log.repository.list.db.test.ts の契約に加えて）：
//   reader.search(...) は、閲覧の資格を、batch の中の条件（記録の onlyWhen と SELECT の WHERE の両方に同じ SQL）で確かめる。
//     資格がなくて記録が0行だったとき、AuditLogViewStateChangedError（audit-log.repository.ts が export）を投げる。何も残さない。
//   資格（Service の最初の判定 resolveSession・isSessionExpired・permission-resolver と同じ。期限は「ちょうど」で切れる）：
//     1 セッションの行がある（id = sessionId）  2 失効していない（revoked_at IS NULL）
//     3 無操作の期限：last_active_at > now - SESSION_IDLE_MS（30分）  4 作成からの期限：created_at > now - SESSION_MAX_AGE_MS（24時間）
//     5 セッションの user_id が viewer.userId で、その利用者が有効  6 全体管理者のロールを会社の範囲（scope_type = 'company'）で持つ
//   閲覧の記録：action = audit_log.view・target_type = audit_log・target_id = null・result = success・actor_id = viewer.userId・trace_id = viewer.traceId・
//     detail（入れ子にしない）= { page: "first"（cursor なし）| "next"（cursor あり）, filterAction, filterResult, filterTargetType（なければ null）,
//       hasActor, hasTarget（絞り込みの操作者・対象の指定の有無。ID は入れない）, from, to（なければ null） }
//   reader.findViewerFacts({ userId, sessionId }) → { session: { userId, createdAt, lastActiveAt, revokedAt } | null, isUserActive: boolean, isGlobalAdmin: boolean }
//     （読み直し用。isGlobalAdmin は会社の範囲の全体管理者のロールを持つこと。Service が 401・403・500 の順で判定する）
// データは架空（testuser_156v_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUDIT_TRACE_PREFIX,
  auditId,
  cleanupAuditLogTestData,
  insertAuditLog,
  remainingAuditTestRows,
  viewRecords,
} from "../../test/audit-log-fixtures";
import { insertSession } from "../../test/auth-fixtures";
import { cleanupMessageScenario } from "../../test/message-fixtures";
import {
  insertAssignment,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";
import { decodeCursor } from "../lib/cursor";
import { ROLE_IDS } from "../lib/permissions";
import { SESSION_IDLE_MS, SESSION_MAX_AGE_MS } from "../lib/session-policy";
import {
  AuditLogViewStateChangedError,
  withAuditLogReader,
} from "./audit-log.repository";

/** 検索の「いま」。セッションの時刻は、これからの差で作る（期限の境界を、ミリ秒の単位で確かめるため） */
const NOW = new Date("2031-03-04T05:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const TRACE = `${AUDIT_TRACE_PREFIX}view`;

let deptId: string;
let viewer: string;
let other: string;
let sessionId: string;

type SearchOptions = {
  filter?: Record<string, string>;
  cursor?: string;
  userId?: string;
  sessionId?: string;
};

const search = (options: SearchOptions = {}) =>
  withAuditLogReader(env, (reader) =>
    reader.search({
      viewer: {
        userId: options.userId ?? viewer,
        sessionId: options.sessionId ?? sessionId,
        traceId: TRACE,
      },
      now: NOW,
      filter: options.filter ?? {},
      cursor:
        options.cursor === undefined ? undefined : decodeCursor(options.cursor),
      limit: 20,
    }),
  );

async function setSession(columns: {
  created_at?: string;
  last_active_at?: string;
  revoked_at?: string | null;
}) {
  const entries = Object.entries(columns);
  await env.DB.prepare(
    `UPDATE sessions SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
  )
    .bind(...entries.map(([, v]) => v), sessionId)
    .run();
}

beforeEach(async () => {
  deptId = await insertDepartment("156閲覧");
  viewer = await insertUser("testuser_156v_viewer", deptId);
  other = await insertUser("testuser_156v_other", deptId);
  await insertAssignment(viewer, ROLE_IDS.globalAdmin, "company", null);
  sessionId = (
    await insertSession(viewer, {
      createdAt: ago(60_000),
      lastActiveAt: ago(1_000),
    })
  ).id;
});

afterEach(async () => {
  await cleanupAuditLogTestData();
  await cleanupMessageScenario();
  expect(await remainingAuditTestRows()).toBe(0);
});

describe("#156 0-6 AC-6: 検索1回ごとの閲覧の記録（D1）", () => {
  it("#156 0-6 AC-6: 最初の検索は、操作者・trace_id・page=first・絞り込みの種類と有無・期間を、平らな detail で1件記録する。絞り込みの ID は残さない", async () => {
    await search({
      filter: {
        from: "2031-03-04",
        to: "2031-03-05",
        actorId: other,
        action: "account.create",
        result: "failure",
        targetType: "user",
        targetId: other,
      },
    });
    const records = await viewRecords(viewer);
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record).toMatchObject({
      actor_id: viewer,
      action: "audit_log.view",
      target_type: "audit_log",
      target_id: null,
      result: "success",
      trace_id: TRACE,
    });
    expect(JSON.parse(record?.detail ?? "null")).toEqual({
      page: "first",
      filterAction: "account.create",
      filterResult: "failure",
      filterTargetType: "user",
      hasActor: true,
      hasTarget: true,
      from: "2031-03-04",
      to: "2031-03-05",
    });
    expect(record?.detail).not.toContain(other);
  });

  it("#156 0-6 AC-6: 絞り込みなしの検索は、種類・期間が null、有無が false の記録になる", async () => {
    await search();
    const [record] = await viewRecords(viewer);
    expect(JSON.parse(record?.detail ?? "null")).toEqual({
      page: "first",
      filterAction: null,
      filterResult: null,
      filterTargetType: null,
      hasActor: false,
      hasTarget: false,
      from: null,
      to: null,
    });
  });

  it("#156 0-6 AC-6: 続き（cursor つき）の検索のたびに、page=next の記録が1件ずつ増える（ページ送りごとに記録する）", async () => {
    for (let n = 1; n <= 3; n += 1)
      await insertAuditLog({
        id: auditId(n),
        occurredAt: `2031-03-04T0${n}:00:00.000Z`,
        actorId: other,
        action: "account.create",
        targetType: "user",
        targetId: other,
      });
    const first = await withAuditLogReader(env, (reader) =>
      reader.search({
        viewer: { userId: viewer, sessionId, traceId: TRACE },
        now: NOW,
        filter: { actorId: other },
        limit: 2,
      }),
    );
    expect(first.nextCursor).not.toBeNull();
    await withAuditLogReader(env, (reader) =>
      reader.search({
        viewer: { userId: viewer, sessionId, traceId: TRACE },
        now: NOW,
        filter: { actorId: other },
        cursor: decodeCursor(first.nextCursor ?? ""),
        limit: 2,
      }),
    );
    const records = await viewRecords(viewer);
    expect(records.map((r) => JSON.parse(r.detail ?? "{}").page)).toEqual([
      "first",
      "next",
    ]);
  });

  it("#156 0-6 AC-6: 自分の閲覧の記録も、同じ検索の結果に出る（記録してから読む）", async () => {
    const page = await search({
      filter: { action: "audit_log.view", actorId: viewer },
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      action: "audit_log.view",
      actorId: viewer,
      result: "success",
    });
  });
});

describe("#156 0-6 AC-6: 閲覧の資格を確定の時点で確かめる（記録と取得が一体）", () => {
  type Case = { name: string; prepare: () => Promise<void> };
  const denied: Case[] = [
    {
      name: "セッションが失効している",
      prepare: () => setSession({ revoked_at: ago(1_000) }),
    },
    {
      name: "無操作の期限のちょうど（last_active_at が now - 30分）",
      prepare: () => setSession({ last_active_at: ago(SESSION_IDLE_MS) }),
    },
    {
      name: "作成から24時間のちょうど（created_at が now - 24時間）",
      prepare: () => setSession({ created_at: ago(SESSION_MAX_AGE_MS) }),
    },
    {
      name: "利用者が無効化された",
      prepare: async () => {
        await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
          .bind(viewer)
          .run();
      },
    },
    {
      name: "全体管理者のロールの割り当てが削除された",
      prepare: async () => {
        await env.DB.prepare(
          "DELETE FROM user_role_assignments WHERE user_id = ?",
        )
          .bind(viewer)
          .run();
      },
    },
    {
      name: "ロールの割り当ての範囲が会社（company）でない",
      prepare: async () => {
        await env.DB.prepare(
          "DELETE FROM user_role_assignments WHERE user_id = ?",
        )
          .bind(viewer)
          .run();
        await insertAssignment(
          viewer,
          ROLE_IDS.globalAdmin,
          "department",
          deptId,
        );
      },
    },
  ];

  it.each(denied)(
    "#156 0-6 AC-6: $name とき、AuditLogViewStateChangedError を投げ、閲覧の記録も残さない",
    async ({ prepare }) => {
      await prepare();
      await expect(search()).rejects.toBeInstanceOf(
        AuditLogViewStateChangedError,
      );
      expect(await viewRecords()).toEqual([]);
    },
  );

  it("#156 0-6 AC-6: セッションの利用者が、閲覧する人（viewer.userId）と違うとき・セッションの行がないときは、投げて何も残さない", async () => {
    const otherSession = (
      await insertSession(other, {
        createdAt: ago(60_000),
        lastActiveAt: ago(1_000),
      })
    ).id;
    await expect(search({ sessionId: otherSession })).rejects.toBeInstanceOf(
      AuditLogViewStateChangedError,
    );
    await expect(search({ sessionId: "0".repeat(64) })).rejects.toBeInstanceOf(
      AuditLogViewStateChangedError,
    );
    expect(await viewRecords()).toEqual([]);
  });

  it("#156 0-6 AC-6: 期限の境界の1ミリ秒前（無操作の期限・作成からの期限）は、まだ閲覧でき、1件記録する", async () => {
    await setSession({ last_active_at: ago(SESSION_IDLE_MS - 1) });
    await expect(search()).resolves.toBeDefined();
    expect(await viewRecords(viewer)).toHaveLength(1);
    await setSession({
      last_active_at: ago(1_000),
      created_at: ago(SESSION_MAX_AGE_MS - 1),
    });
    await expect(search()).resolves.toBeDefined();
    expect(await viewRecords(viewer)).toHaveLength(2);
  });
});

describe("#156 0-6 AC-6: 読み直し用の事実 findViewerFacts（D1）", () => {
  const facts = (userId = viewer, session = sessionId) =>
    withAuditLogReader(env, (reader) =>
      reader.findViewerFacts({ userId, sessionId: session }),
    );

  it("#156 0-6 AC-6: 有効なセッション・有効な利用者・会社範囲の全体管理者なら、その事実を返す", async () => {
    expect(await facts()).toEqual({
      session: {
        userId: viewer,
        createdAt: ago(60_000),
        lastActiveAt: ago(1_000),
        revokedAt: null,
      },
      isUserActive: true,
      isGlobalAdmin: true,
    });
  });

  it("#156 0-6 AC-6: セッションの行がなければ session は null", async () => {
    expect((await facts(viewer, "0".repeat(64))).session).toBeNull();
  });

  it("#156 0-6 AC-6: 失効したセッションは、失効の時刻つきで返す。無効な利用者は isUserActive が false", async () => {
    await setSession({ revoked_at: ago(500) });
    await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
      .bind(viewer)
      .run();
    const result = await facts();
    expect(result.session?.revokedAt).toBe(ago(500));
    expect(result.isUserActive).toBe(false);
  });

  it("#156 0-6 AC-6: 全体管理者のロールがない・会社の範囲でない利用者は、isGlobalAdmin が false", async () => {
    await env.DB.prepare("DELETE FROM user_role_assignments WHERE user_id = ?")
      .bind(viewer)
      .run();
    expect((await facts()).isGlobalAdmin).toBe(false);
    await insertAssignment(viewer, ROLE_IDS.globalAdmin, "department", deptId);
    expect((await facts()).isGlobalAdmin).toBe(false);
  });
});
