// #156（0-6）監査ログの閲覧のテストで使う、架空のテストデータの作成・読み取り・後始末（識別子で消す。C-05）。
// 監査ログは「消さない」決まり（0-6 AC-4）のため、本番のコードに削除の経路はない。ここの削除はテストの後始末だけで、
// 条件は「trace_id の接頭辞（AUDIT_TRACE_PREFIX。本番の trace_id は UUID で、この接頭辞を持たない）」と「テストの利用者が操作者の閲覧の記録」だけに絞る。
// 行は直接 INSERT する（監査の書き込み関数を通さない）。値はすべて架空のもの。
import { env } from "cloudflare:workers";
import { AUTH_TRACE_PREFIX } from "./auth-fixtures";

/** このIssueのテストが入れる監査ログの trace_id の接頭辞（auth-fixtures の後始末 cleanupAuthTestData でも消える） */
export const AUDIT_TRACE_PREFIX = `${AUTH_TRACE_PREFIX}audit156-`;

const TEST_USERS =
  "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";

/** ULID と同じ26文字（Crockford の Base32 の文字だけ）の、テスト用の監査ログのID。n が大きいほど辞書順で後ろ */
export const auditId = (n: number) =>
  `01JTEST156AAA${String(n).padStart(13, "0")}`;

export type AuditSeed = {
  id: string;
  occurredAt: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  result?: "success" | "failure";
  /** JSON の文字列のまま入れる（本物の書き込み関数を通さないため、秘密の項目名の行も作れる） */
  detail?: string | null;
  traceId?: string;
};

export async function insertAuditLog(seed: AuditSeed): Promise<string> {
  await env.DB.prepare(
    `INSERT INTO audit_logs (id, occurred_at, actor_id, action, target_type, target_id, result, trace_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      seed.id,
      seed.occurredAt,
      seed.actorId,
      seed.action,
      seed.targetType,
      seed.targetId,
      seed.result ?? "success",
      seed.traceId ?? `${AUDIT_TRACE_PREFIX}${seed.id}`,
      seed.detail ?? null,
    )
    .run();
  return seed.id;
}

export type ViewRecord = {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: string;
  trace_id: string;
  detail: string | null;
};

/** 閲覧の記録（audit_log.view）。操作者を渡すと、その人のものだけ。古い順 */
export async function viewRecords(actorId?: string): Promise<ViewRecord[]> {
  const base = "SELECT * FROM audit_logs WHERE action = 'audit_log.view'";
  const statement =
    actorId === undefined
      ? env.DB.prepare(`${base} ORDER BY occurred_at, id`)
      : env.DB.prepare(
          `${base} AND actor_id = ? ORDER BY occurred_at, id`,
        ).bind(actorId);
  const { results } = await statement.all<ViewRecord>();
  return results;
}

/** テストの監査ログの件数（シードの行と、テストの利用者の閲覧の記録）。後始末の後は 0 でなければならない */
export async function remainingAuditTestRows(): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM audit_logs WHERE trace_id LIKE ? OR (action = 'audit_log.view' AND actor_id IN (${TEST_USERS}))`,
  )
    .bind(`${AUTH_TRACE_PREFIX}%`)
    .first<{ n: number }>();
  if (row === null) throw new Error("監査ログの件数を読めませんでした");
  return row.n;
}

/** このIssueのテストの監査ログだけを、識別子で消す（利用者・セッションより先に呼ぶ必要はない。外部キーがないため） */
export async function cleanupAuditLogTestData() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM audit_logs WHERE trace_id LIKE ?").bind(
      `${AUTH_TRACE_PREFIX}%`,
    ),
    env.DB.prepare(
      `DELETE FROM audit_logs WHERE action = 'audit_log.view' AND actor_id IN (${TEST_USERS})`,
    ),
  ]);
}

/** 取引先を1件入れる（名前は [UNIT_TEST] を付けて渡す） */
export async function insertClient(id: string, code: string, name: string) {
  await env.DB.prepare(
    "INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)",
  )
    .bind(
      id,
      code,
      name,
      name.toLowerCase(),
      "2026-11-17T00:00:00.000Z",
      "2026-11-17T00:00:00.000Z",
    )
    .run();
}

export async function cleanupClients() {
  await env.DB.prepare("DELETE FROM clients WHERE name LIKE ?")
    .bind("[UNIT_TEST]%")
    .run();
}
