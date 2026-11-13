// #200 のDBテストで使う、全社連絡（purpose=company_general）の確認・取り除き・復元の共通処理。
// 全社連絡は migration（0011）が作る初期データのため、テストの DB にはすでに1件ある。
// 「全社連絡がない状態」を作るテストは、removeCompanyGeneral で取り除き、終わったら restoreCompanyGeneral で戻す。
import { type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { cleanupReadPositions } from "./read-position-fixtures";

const migrations = (env as typeof env & { TEST_MIGRATIONS: D1Migration[] })
  .TEST_MIGRATIONS;

export const COMPANY_GENERAL_MIGRATION_KEY = "seed_company_general_channel";
export const COMPANY_GENERAL_UNIQUE_MIGRATION_KEY =
  "add_company_general_unique";
export const BACKFILL_ACTION = "channel.company_general_backfill";

/** 0011（全社連絡の補完）の migration。名前で1件に特定する */
export function companyGeneralMigration(): D1Migration {
  const found = migrations.filter((m) =>
    m.name.includes(COMPANY_GENERAL_MIGRATION_KEY),
  );
  if (found.length !== 1 || found[0] === undefined)
    throw new Error(
      `${COMPANY_GENERAL_MIGRATION_KEY} の migration が1件ではありません（${found.length}件）`,
    );
  return found[0];
}

/** 0011 の文を、journal と同じ順で実行する（何度流しても同じ結果になることを確かめる用） */
export async function runCompanyGeneralMigration() {
  const { queries } = companyGeneralMigration();
  if (queries.length === 0) throw new Error("migration の文が空です");
  await env.DB.batch(queries.map((query) => env.DB.prepare(query)));
}

export type CompanyGeneralRow = {
  room_id: string;
  department_id: string | null;
  name: string;
  name_normalized: string;
  description: string;
  visibility: string;
  purpose: string;
  deleted_at: string | null;
};

export async function companyGeneralRows() {
  const { results } = await env.DB.prepare(
    `SELECT room_id, department_id, name, name_normalized, description, visibility, purpose, deleted_at
     FROM channels WHERE purpose = 'company_general' ORDER BY room_id`,
  ).all<CompanyGeneralRow>();
  return results;
}

/** 全社連絡の room_id（なければ null） */
export async function companyGeneralRoomId(): Promise<string | null> {
  return (await companyGeneralRows())[0]?.room_id ?? null;
}

/** 全社連絡の参加者の社員ID（昇順） */
export async function companyGeneralMembers(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT user_id FROM channel_members
     WHERE channel_id IN (SELECT room_id FROM channels WHERE purpose = 'company_general') ORDER BY user_id`,
  ).all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}

export async function backfillAudits() {
  const { results } = await env.DB.prepare(
    "SELECT action, target_type, target_id, result, detail FROM audit_logs WHERE action = ? ORDER BY occurred_at, id",
  )
    .bind(BACKFILL_ACTION)
    .all<{
      action: string;
      target_type: string;
      target_id: string | null;
      result: string;
      detail: string | null;
    }>();
  return results;
}

/** 全社連絡（参加者・チャンネル・ルーム）と、補完の監査ログを取り除く。外部キーの順 */
export async function removeCompanyGeneral() {
  const rows = await companyGeneralRows();
  // #237：全社連絡を開いたテストの利用者の既読位置は、全社連絡の部屋を外部キーで指すため、部屋より先に消す
  await cleanupReadPositions();
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM channel_members WHERE channel_id IN (SELECT room_id FROM channels WHERE purpose = 'company_general')",
    ),
    env.DB.prepare("DELETE FROM channels WHERE purpose = 'company_general'"),
    ...rows.map((row) =>
      env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(row.room_id),
    ),
    env.DB.prepare("DELETE FROM audit_logs WHERE action = ?").bind(
      BACKFILL_ACTION,
    ),
  ]);
}

/** 全社連絡を、migration と同じ文で元に戻す（取り除いたテストの後始末） */
export async function restoreCompanyGeneral() {
  await removeCompanyGeneral();
  await runCompanyGeneralMigration();
}
