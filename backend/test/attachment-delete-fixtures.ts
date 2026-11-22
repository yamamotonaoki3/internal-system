// #270（270-A）のテストで使う、添付の削除（EP-1-11 DELETE /api/attachments/:attachmentId）と、削除済みの添付の後始末の、
// 架空のテストデータの作成・読み取り・失敗の注入・後始末（識別子で消す）。
// 識別子：利用者は testuser_ で始め、部署名・チャンネル名・本文は [UNIT_TEST] を付ける。値はすべて架空のもの。
// 表の形は計画（270-A 4.7）：message_attachments に deleted_at（text・NULL 可）・deleted_by（text・NULL 可・users を参照）を足す。
// このファイルは、まだない本番のコード（削除の Service・DAO・後始末のジョブ）を読み込まない。読み込むと、これを使う既存のテストまで壊れるため。
// R2 は vitest-pool-workers（Miniflare）の手元の保存先だけを使う。本物のバケットには接続しない。
import { env } from "cloudflare:workers";
import { apiRequest } from "./api-request";
import { AUTH_TRACE_PREFIX } from "./auth-fixtures";
import {
  attachmentPath,
  cleanupAttachmentScenario,
} from "./attachment-fixtures";

/** 削除の印の時刻（テストで直接作る削除済みの状態） */
export const ATTACHMENT_DELETED_AT = "2026-11-21T00:00:00.000Z";

/** 監査の名前（計画 4.3・AC-7） */
export const ATTACHMENT_DELETE_ACTION = "attachment.delete";

/** 未投稿の添付をこの API で消そうとしたときの 409 の文言（計画 4.2 の 3） */
export const PENDING_DELETE_MESSAGE =
  "送信前の添付は、送信前の一覧で取り消してください";

// ---- API ----

/** EP-1-11 DELETE /api/attachments/:attachmentId */
export function deleteAttachment(
  attachmentId: string,
  token: string | null,
  options: { origin?: string } = {},
) {
  return apiRequest("DELETE", attachmentPath(attachmentId), {
    token,
    ...(options.origin === undefined ? {} : { origin: options.origin }),
  });
}

// ---- 状態の作成・読み取り ----

export type AttachmentDeletion = {
  deleted_at: string | null;
  deleted_by: string | null;
};

/** 添付の削除の列（行がなければ null）。列がまだない（実装前）ときは、ここで失敗する */
export async function deletionOf(
  attachmentId: string,
): Promise<AttachmentDeletion | null> {
  return env.DB.prepare(
    "SELECT deleted_at, deleted_by FROM message_attachments WHERE id = ?",
  )
    .bind(attachmentId)
    .first<AttachmentDeletion>();
}

export type AttachmentPurgeState = AttachmentDeletion & {
  purge_failed_at: string | null;
};

/**
 * 削除の列と、実体の削除に最後に失敗した時刻（purge_failed_at。コードレビューの指摘1の直しで足す列）。行がなければ null。
 * 列がまだない（実装前）ときは、ここで失敗する
 */
export async function purgeStateOf(
  attachmentId: string,
): Promise<AttachmentPurgeState | null> {
  return env.DB.prepare(
    "SELECT deleted_at, deleted_by, purge_failed_at FROM message_attachments WHERE id = ?",
  )
    .bind(attachmentId)
    .first<AttachmentPurgeState>();
}

/** 実体の削除に失敗したことがある状態を直接作る（状態の準備。時刻は ISO 8601 の文字列） */
export async function markPurgeFailed(attachmentId: string, failedAt: string) {
  await env.DB.prepare(
    "UPDATE message_attachments SET purge_failed_at = ? WHERE id = ?",
  )
    .bind(failedAt, attachmentId)
    .run();
}

/** 削除済みの状態を直接作る（API を通さない） */
export async function markAttachmentDeleted(
  attachmentId: string,
  deletedBy: string,
  deletedAt = ATTACHMENT_DELETED_AT,
) {
  await env.DB.prepare(
    "UPDATE message_attachments SET deleted_at = ?, deleted_by = ? WHERE id = ?",
  )
    .bind(deletedAt, deletedBy, attachmentId)
    .run();
}

export type AttachmentAuditRow = {
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: string;
  detail: string | null;
};

/** 監査の行（action を指定。target を渡すとその対象だけ） */
export async function auditRowsOf(action: string, targetId?: string) {
  const { results } = await (
    targetId === undefined
      ? env.DB.prepare(
          "SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs WHERE action = ? ORDER BY occurred_at, id",
        ).bind(action)
      : env.DB.prepare(
          "SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs WHERE action = ? AND target_id = ? ORDER BY occurred_at, id",
        ).bind(action, targetId)
  ).all<AttachmentAuditRow>();
  return results;
}

/** 種類 attachment の索引の写しの数（対応の表） */
export async function attachmentDocumentCount(
  attachmentId: string,
): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM search_documents WHERE kind = 'attachment' AND ref_id = ?",
  )
    .bind(attachmentId)
    .first<{ n: number }>();
  if (row === null) throw new Error("索引の写しの数を読めませんでした");
  return row.n;
}

// ---- 失敗の注入・割り込み ----

type Recorded = { sqlOf: WeakMap<object, string> };

/**
 * D1 を包み、作った文の SQL を覚える（bind の後の文も同じ SQL として覚える）。
 * 文そのものは本物のまま渡す（Proxy で包まない。D1 の内部の確かめを壊さないため）。
 */
function recordingDb(
  real: D1Database,
  rewrite: (query: string) => string = (query) => query,
): { db: D1Database } & Recorded {
  const sqlOf = new WeakMap<object, string>();
  const remember = (statement: D1PreparedStatement, query: string) => {
    sqlOf.set(statement, query);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values: unknown[]) => {
      const bound = bind(...values);
      remember(bound, query);
      return bound;
    };
    return statement;
  };
  const db = new Proxy(real, {
    get(target, property, receiver) {
      if (property === "prepare")
        return (query: string) =>
          remember(target.prepare(rewrite(query)), query);
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db, sqlOf };
}

/** 添付の削除の印を付ける UPDATE（計画 4.3 の 2）か */
export const ATTACHMENT_UPDATE =
  /update\s+["`]?message_attachments["`]?\s+set/i;

/**
 * D1 を包み、条件に合う文を含む最初の batch の直前に、interrupt を1回だけ実行する（確認の後・書き込みの直前の状態の変化）。
 * ran は割り込んだかどうか（挟めたことの確認に使う）。
 * pattern に関数を渡すと、batch の文の SQL の一覧で判定する（#270 の 270-B：読み取りだけの batch を狙うため）。
 */
export function interleavingDb(
  real: D1Database,
  interrupt: () => Promise<void>,
  pattern: RegExp | ((queries: string[]) => boolean) = ATTACHMENT_UPDATE,
) {
  const { db, sqlOf } = recordingDb(real);
  const state = { ran: false };
  const matches = (queries: string[]) =>
    typeof pattern === "function"
      ? pattern(queries)
      : queries.some((query) => pattern.test(query));
  const wrapped = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          if (
            !state.ran &&
            matches(statements.map((s) => sqlOf.get(s) ?? ""))
          ) {
            state.ran = true;
            await interrupt();
          }
          return real.batch(statements);
        };
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return { db: wrapped, state };
}

/**
 * D1 を包み、条件に合う文を、実行の時に失敗する文に置き換える（存在しない表を読む。プレースホルダの数は元と同じ）。
 * batch の中の1文の失敗を作り、batch 全体が取り消されることを確かめる。
 */
export function failingStatementDb(real: D1Database, pattern: RegExp) {
  const state = { replaced: 0 };
  const { db } = recordingDb(real, (query) => {
    if (!pattern.test(query)) return query;
    state.replaced += 1;
    const holders = (query.match(/\?\d*/g) ?? []).length;
    const list = holders === 0 ? "0" : Array(holders).fill("?").join(", ");
    return `SELECT * FROM "__unit_test_injected_failure_270" WHERE 0 IN (${list})`;
  });
  return { db, state };
}

/** R2 を包み、delete の呼び出しを記録する。fail が真を返すキーの delete は失敗させる（ほかは本物に流す） */
export function recordingBucket(
  real: R2Bucket,
  fail: (key: string) => boolean = () => false,
) {
  const deletes: string[] = [];
  const wrapped = new Proxy(real, {
    get(target, property, receiver) {
      if (property === "delete")
        return async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          deletes.push(...list);
          if (list.some(fail))
            throw new Error("[UNIT_TEST] 注入した R2 の削除の失敗");
          return target.delete(keys);
        };
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { bucket: wrapped, deletes };
}

// ---- ログ ----

export type JsonLog = {
  body?: string;
  severity_text?: string;
  attributes?: Record<string, unknown>;
};

/** console に出た JSON の行 */
export function jsonLogs(lines: readonly string[]): JsonLog[] {
  return lines
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as JsonLog);
}

// ---- 後始末 ----

const TEST_USERS =
  "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";

/**
 * このテストの監査（attachment.delete・message.delete）を消してから、添付・メッセージ・部屋・利用者を消す（cleanupAttachmentScenario）。
 * 監査は trace_id の接頭辞（API・テストが付けたもの）か、操作者がテストの利用者のものだけ。途中で失敗しても残りは必ず行う。
 */
export async function cleanupAttachmentDeleteScenario() {
  try {
    await env.DB.prepare(
      `DELETE FROM audit_logs WHERE action IN ('attachment.delete', 'message.delete') AND (trace_id LIKE ? OR actor_id IN (${TEST_USERS}))`,
    )
      .bind(`${AUTH_TRACE_PREFIX}%`)
      .run();
  } finally {
    await cleanupAttachmentScenario();
  }
}
