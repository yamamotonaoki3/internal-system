// 担当者が外れたときの TODO の担当の書き換え（#149 の 149-D。計画 6.3）。参加者の削除・本人の退出・無効化・再開の除外で共通の部品。
// 規則（定義元はここだけ）：外れた人が現在の担当で、未完了・未削除の TODO の assignee_id を NULL にし（recorded_assignee_* は残す）、
// 記録 auto_unassign を足し、版に1を足す。
// batch の前に読むのは「対象の件数 n」と「記録の表の全体の最大の ID」だけ。先頭の前提で1回だけ「いまの対象の件数＝n」と ID の新しさを確かめ、
// 後ろの文は規則だけを条件にする（呼び出し側の condition を付けない）。担当を NULL にした直後から「読んだときのまま」は偽になり、
// それを条件にすると後ろの文（参加の行の削除など）が0行になるため。
import { count, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { caseTodoEvents, caseTodos } from "../../db/schema";
import { newUlid, ulidAfter } from "../lib/ulid";
import type { BatchItem, Database } from "./database";

/** 対象の範囲。t は case_todos の別名（または表の名前） */
export type UnassignScope = (t: SQL) => SQL;

/** 参加者の削除・本人の退出：その案件で、外れた人が担当のもの */
export const caseAssigneeScope =
  (caseId: string, userId: string): UnassignScope =>
  (t) =>
    sql`${t}.case_id = ${caseId} AND ${t}.assignee_id = ${userId}`;

/** 無効化：全案件で、外れた人が担当のもの（終了中の案件を含む。決定 Q7） */
export const assigneeScope =
  (userId: string): UnassignScope =>
  (t) =>
    sql`${t}.assignee_id = ${userId}`;

/** 再開の除外：その案件で、外す人（JSON の配列）のどれかが担当のもの */
export const caseAssigneesScope =
  (caseId: string, userIdsJson: string): UnassignScope =>
  (t) =>
    sql`${t}.case_id = ${caseId} AND ${t}.assignee_id IN (SELECT value FROM json_each(${userIdsJson}))`;

/** 規則：未完了・未削除で、担当があり、範囲に入る TODO */
export function unassignTargetSql(t: SQL, scope: UnassignScope): SQL {
  return sql`${t}.is_done = 0 AND ${t}.deleted_at IS NULL AND ${t}.assignee_id IS NOT NULL AND ${scope(t)}`;
}

/** 記録の表の全体に、firstId 以上の ID がないこと（149-B 計画 6.1。主キーの索引で探す） */
export function eventIdsFreshSql(firstId: string | SQL): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM case_todo_events fe WHERE fe.id >= ${firstId})`;
}

/** 対象の件数 n と、記録の ID（昇順の n 個。JSON の配列1つ。D1 の束縛する値の数を件数に依存させないため） */
export type UnassignPlan = { n: number; idsJson: string };

/** batch の前の読み取り。ID は記録の表の全体の最大より大きくする（時計が戻っても別の TODO の記録と衝突させない） */
export async function readUnassignPlan(
  db: Database,
  scope: UnassignScope,
): Promise<UnassignPlan> {
  const ut = alias(caseTodos, "ut");
  const [countRows, maxRows] = await Promise.all([
    db
      .select({ n: count() })
      .from(ut)
      .where(unassignTargetSql(sql`ut`, scope)),
    db
      .select({ id: sql<string | null>`MAX(${caseTodoEvents.id})` })
      .from(caseTodoEvents),
  ]);
  const n = countRows[0]?.n ?? 0;
  const max = maxRows[0]?.id ?? null;
  const ids: string[] = [];
  let previous = max;
  for (let i = 0; i < n; i += 1) {
    const id = previous === null ? newUlid() : ulidAfter(previous);
    ids.push(id);
    previous = id;
  }
  return { n, idsJson: JSON.stringify(ids) };
}

/** 先頭の前提にだけ入れる式：いまの対象の件数が n で、今回の最初の ID 以上の記録が全体にないこと */
export function unassignPreSql(scope: UnassignScope, plan: UnassignPlan): SQL {
  const counted = sql`(SELECT COUNT(*) FROM case_todos pt WHERE ${unassignTargetSql(sql`pt`, scope)}) = ${plan.n}`;
  if (plan.n === 0) return counted;
  return sql`${counted} AND ${eventIdsFreshSql(sql`json_extract(${plan.idsJson}, '$[0]')`)}`;
}

/**
 * 4文：記録 → 件数の確認 → 担当の書き換え → 件数の確認。条件は規則だけ。
 * guard(n) は、直前の文の件数が n でなければ batch 全体を取り消す文（表は呼び出し側で決める）
 */
export function unassignStatements(
  db: Database,
  input: {
    scope: UnassignScope;
    plan: UnassignPlan;
    actorId: string;
    now: string;
    guard: (expected: number) => BatchItem;
  },
): BatchItem[] {
  const { scope, plan, actorId, now, guard } = input;
  return [
    db.insert(caseTodoEvents).select(
      sql`SELECT j.value, r.id, r.case_id, 'auto_unassign', ${actorId}, NULL, NULL,
          r.assignee_id, r.recorded_assignee_name, NULL, NULL, ${now}
          FROM (SELECT ut.id, ut.case_id, ut.assignee_id, ut.recorded_assignee_name,
              ROW_NUMBER() OVER (ORDER BY ut.id) - 1 AS rn
            FROM case_todos ut WHERE ${unassignTargetSql(sql`ut`, scope)}) r
          JOIN json_each(${plan.idsJson}) j ON j.key = r.rn`,
    ),
    guard(plan.n),
    db
      .update(caseTodos)
      .set({
        assigneeId: null,
        version: sql`${caseTodos.version} + 1`,
        updatedAt: now,
      })
      .where(unassignTargetSql(sql`"case_todos"`, scope)),
    guard(plan.n),
  ];
}
