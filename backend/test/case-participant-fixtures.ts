// #147（147-B）のテストで使う、案件の参加者・納期の書き込みの確認の部品（読み取りと、状態を直接変える操作）。
// 世界は case-request-fixtures.ts の setupCaseWorld、案件は case-fixtures.ts の seedCase を使い、後始末は cleanupCaseTestData に任せる
// （案件・チャンネル・参加の行は取引先 [UNIT_TEST] で、監査は trace_id の接頭辞で消える）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";

/** 計画 147-B の API の文言（画面はこの文言をそのまま出す） */
export const CASE_PARTICIPANT_MESSAGES = {
  caseNotFound: "案件が見つかりません",
  participantsOnly: "参加者だけが操作できます",
  participantNotFound: "参加者が見つかりません",
  autoParticipant: "担当部署のオーナー・全体管理者は外せません",
} as const;

/** 計画 147-B の 409 の reason */
export const CASE_CONFLICT_REASONS = {
  closed: "closed",
  alreadyParticipant: "already_participant",
  autoParticipant: "auto_participant",
  lastActiveParticipant: "last_active_participant",
} as const;

export type CaseAuditRow = {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: string;
  detail: string | null;
};

/** 147-B の監査（case.participant.add・case.participant.remove・case.due_date.change）。書かれた順 */
export async function caseWriteAudits(): Promise<CaseAuditRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, actor_id, action, target_type, target_id, result, detail FROM audit_logs
     WHERE action IN ('case.participant.add', 'case.participant.remove', 'case.due_date.change')
     ORDER BY occurred_at, id`,
  ).all<CaseAuditRow>();
  return results;
}

/** 案件の部屋の参加の行の利用者 ID（昇順） */
export async function participantIdsOf(roomId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT user_id FROM channel_members WHERE channel_id = ? ORDER BY user_id",
  )
    .bind(roomId)
    .all<{ user_id: string }>();
  return results.map((row) => row.user_id);
}

export type CaseWriteRow = {
  status: string;
  due_date: string | null;
  version: number;
  updated_at: string;
};

export async function caseWriteRow(caseId: string): Promise<CaseWriteRow> {
  const row = await env.DB.prepare(
    "SELECT status, due_date, version, updated_at FROM cases WHERE id = ?",
  )
    .bind(caseId)
    .first<CaseWriteRow>();
  if (row === null) throw new Error(`案件 ${caseId} がありません`);
  return row;
}

/** 取り消しの確認用：参加の行（全案件）・案件の行・147-B の監査。失敗の後に、前と完全に同じであることを確かめる */
export async function caseWriteSnapshot() {
  const all = async (sql: string) =>
    (await env.DB.prepare(sql).all<Record<string, unknown>>()).results;
  return {
    members: await all(
      "SELECT channel_id, user_id, joined_at FROM channel_members WHERE channel_id IN (SELECT channel_id FROM cases) ORDER BY channel_id, user_id",
    ),
    cases: await all(
      "SELECT id, status, due_date, version, updated_at FROM cases ORDER BY id",
    ),
    audits: await caseWriteAudits(),
  };
}

/** 案件の状態を直接変える（#150 の終了の代わり） */
export async function setCaseStatus(
  caseId: string,
  status: "active" | "closed",
) {
  await env.DB.prepare("UPDATE cases SET status = ? WHERE id = ?")
    .bind(status, caseId)
    .run();
}

/** 納期を直接変える（同時の変更の代わり。版は変えない） */
export async function setCaseDueDate(caseId: string, dueDate: string | null) {
  await env.DB.prepare("UPDATE cases SET due_date = ? WHERE id = ?")
    .bind(dueDate, caseId)
    .run();
}

/** 案件の担当部署を置き換える（#150 の再編集で担当部署から外れた状態を作る） */
export async function setCaseDepartments(
  caseId: string,
  departmentIds: string[],
) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM case_departments WHERE case_id = ?").bind(
      caseId,
    ),
    ...departmentIds.map((departmentId) =>
      env.DB.prepare(
        "INSERT INTO case_departments (case_id, department_id) VALUES (?, ?)",
      ).bind(caseId, departmentId),
    ),
  ]);
}

/** detail の JSON を読む（null は null） */
export function parseDetail(detail: string | null): unknown {
  return detail === null ? null : (JSON.parse(detail) as unknown);
}

/** detail が入れ子（オブジェクト・配列）を持たないこと */
export function isFlat(detail: unknown): boolean {
  if (detail === null || typeof detail !== "object") return false;
  return Object.values(detail).every(
    (value) => value === null || typeof value !== "object",
  );
}
