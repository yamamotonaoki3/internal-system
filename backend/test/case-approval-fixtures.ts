// #146（146-B）のテストで使う、案件（cases）・案件専用チャンネル・採番の架空のテストデータの作成・読み取り・後始末（識別子で消す）。
// 申請・部署・利用者・取引先の世界は case-request-fixtures.ts（146-A）を使い、ここでは 146-B で増える表だけを扱う。
// 表の形は計画 B-1（migration は実装の担当が作る。番号は 0024 の次）：
//   cases：id・case_number（UNIQUE。英大文字3文字-数字6桁-数字4桁）・number_client_id・client_id・channel_id（channels.room_id・UNIQUE）・
//     request_id（UNIQUE）・title・description・due_date・status（active か closed）・created_by・approved_by・version・created_at・updated_at
//   case_departments：case_id・department_id（PK は2列）
//   case_number_sequences：client_id・year（西暦4桁の整数。日本時間の年）・last_number（CHECK 1〜9999）。PK は (client_id, year)
// 後始末は、テストの取引先（[UNIT_TEST]）の案件と、その案件のチャンネル・部屋・参加・通知・既読位置だけを消す。表がまだない（実装前）ときは触れない。
import { env } from "cloudflare:workers";
import {
  CASEREQ_NOW,
  TEST_TAG,
  caseRequestIdAt,
  cleanupCaseRequestTestData,
} from "./case-request-fixtures";

/** 承認・却下の失敗の文言（計画 B-4・B-5・突き合わせの表。画面はこの文言をそのまま出す） */
export const DECIDE_MESSAGES = {
  decided: "この申請はすでに処理されています",
  departmentInactive:
    "担当部署の一部が無効のため承認できません。却下して再申請を依頼してください",
  clientInactive:
    "取引先が無効のため承認できません。却下して再申請を依頼してください",
  candidateInactive:
    "無効になった候補がいます。申請者に取り下げと再申請を依頼してください",
  numberExhausted: "この取引先の今年の案件番号が上限に達したため承認できません",
  numberConflict: "採番が競合しました。もう一度承認してください",
  reviewerIneligible: "この申請を審査する権限がありません",
} as const;

/** 案件番号の形（5-1 AC-18）：英大文字3文字-YYMMDD-4桁 */
export const CASE_NUMBER_PATTERN = /^[A-Z]{3}-\d{6}-\d{4}$/;

let caseSequence = 0;
function nextCaseId(): string {
  caseSequence += 1;
  return caseRequestIdAt(1_810_000_000_000 + caseSequence * 1_000);
}

async function tableExists(name: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
  )
    .bind(name)
    .first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

/** 連番の状態を直接入れる（上限・年の境界の確認用） */
export async function setCaseNumberSequence(
  clientId: string,
  year: number,
  lastNumber: number,
) {
  await env.DB.prepare(
    `INSERT INTO case_number_sequences (client_id, year, last_number) VALUES (?, ?, ?)
     ON CONFLICT (client_id, year) DO UPDATE SET last_number = excluded.last_number`,
  )
    .bind(clientId, year, lastNumber)
    .run();
}

export async function caseNumberSequence(
  clientId: string,
  year: number,
): Promise<number | null> {
  const row = await env.DB.prepare(
    "SELECT last_number FROM case_number_sequences WHERE client_id = ? AND year = ?",
  )
    .bind(clientId, year)
    .first<{ last_number: number }>();
  return row?.last_number ?? null;
}

/**
 * 案件を直接入れる（類似件名の比較・案件番号の衝突の確認用）。案件専用チャンネル（purpose=case・private・部署なし）も一緒に作る。
 * request_id は UNIQUE のため、申請の行を作らずに架空の ID を入れる（申請の case_id は外部キーでない。計画 A-1）。
 */
export async function insertCase(seed: {
  clientId: string;
  caseNumber: string;
  title: string;
  createdBy: string;
  status?: "active" | "closed";
  departmentIds?: string[];
}): Promise<{ id: string; roomId: string }> {
  const id = nextCaseId();
  const roomId = nextCaseId();
  const requestId = nextCaseId();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO rooms (id, kind, created_at) VALUES (?, 'channel', ?)",
    ).bind(roomId, CASEREQ_NOW),
    env.DB.prepare(
      `INSERT INTO channels (room_id, department_id, name, name_normalized, description, visibility, purpose,
         created_by, version, created_at, updated_at, deleted_at, deleted_by)
       VALUES (?, NULL, ?, ?, '', 'private', 'case', ?, 1, ?, ?, NULL, NULL)`,
    ).bind(
      roomId,
      seed.caseNumber,
      `case:${seed.caseNumber.toLowerCase()}`,
      // 案件専用チャンネルの作成者は申請者（統括の決定。cases.created_by と揃える）
      seed.createdBy,
      CASEREQ_NOW,
      CASEREQ_NOW,
    ),
    env.DB.prepare(
      `INSERT INTO cases (id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
         status, created_by, approved_by, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', NULL, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      id,
      seed.caseNumber,
      seed.clientId,
      seed.clientId,
      roomId,
      requestId,
      seed.title,
      seed.status ?? "active",
      seed.createdBy,
      seed.createdBy,
      CASEREQ_NOW,
      CASEREQ_NOW,
    ),
    ...(seed.departmentIds ?? []).map((departmentId) =>
      env.DB.prepare(
        "INSERT INTO case_departments (case_id, department_id) VALUES (?, ?)",
      ).bind(id, departmentId),
    ),
  ]);
  return { id, roomId };
}

/** 案件の行と担当部署を消す（チャンネル・連番は残す。「消しても連番が戻らない」の確認用） */
export async function deleteCaseRow(caseId: string) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM case_departments WHERE case_id = ?").bind(
      caseId,
    ),
    env.DB.prepare("DELETE FROM cases WHERE id = ?").bind(caseId),
  ]);
}

export type CaseRow = {
  id: string;
  case_number: string;
  number_client_id: string;
  client_id: string;
  channel_id: string;
  request_id: string;
  title: string;
  description: string;
  due_date: string | null;
  status: string;
  created_by: string;
  approved_by: string;
  version: number;
};

export async function caseOfRequest(requestId: string) {
  return env.DB.prepare("SELECT * FROM cases WHERE request_id = ?")
    .bind(requestId)
    .first<CaseRow>();
}

export async function caseDepartmentIds(caseId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT department_id FROM case_departments WHERE case_id = ? ORDER BY department_id",
  )
    .bind(caseId)
    .all<{ department_id: string }>();
  return results.map((r) => r.department_id);
}

export type CaseChannelRow = {
  room_id: string;
  department_id: string | null;
  name: string;
  name_normalized: string;
  visibility: string;
  purpose: string;
};

export async function channelOf(roomId: string) {
  return env.DB.prepare(
    "SELECT room_id, department_id, name, name_normalized, visibility, purpose FROM channels WHERE room_id = ?",
  )
    .bind(roomId)
    .first<CaseChannelRow>();
}

/** チャンネルの参加者（user_id の昇順。重複があればそのまま返す） */
export async function memberIdsOf(roomId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT user_id FROM channel_members WHERE channel_id = ? ORDER BY user_id",
  )
    .bind(roomId)
    .all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}

/**
 * 取り消しの確認用：146-B で増える表と、申請・部屋・チャンネル・参加・監査・通知の全体の状態。
 * 失敗した承認・却下のあとで、操作の前と完全に同じであることを toEqual で確かめる。
 */
export async function approvalSnapshot() {
  const all = async (sql: string) =>
    (await env.DB.prepare(sql).all<Record<string, unknown>>()).results;
  return {
    requests: await all(
      "SELECT id, status, version, decided_by, decided_at, decision_reason, case_id FROM case_creation_requests ORDER BY id",
    ),
    candidates: await all(
      "SELECT request_id, user_id, added_by FROM case_creation_request_candidates ORDER BY request_id, user_id",
    ),
    cases: await all("SELECT id, case_number FROM cases ORDER BY id"),
    caseDepartments: await all(
      "SELECT case_id, department_id FROM case_departments ORDER BY case_id, department_id",
    ),
    sequences: await all(
      "SELECT client_id, year, last_number FROM case_number_sequences ORDER BY client_id, year",
    ),
    rooms: await all("SELECT id FROM rooms ORDER BY id"),
    channels: await all(
      "SELECT room_id, purpose FROM channels ORDER BY room_id",
    ),
    members: await all(
      "SELECT channel_id, user_id FROM channel_members ORDER BY channel_id, user_id",
    ),
    departments: await all(
      "SELECT id, is_active, version FROM departments ORDER BY id",
    ),
    clients: await all(
      "SELECT id, is_active, version FROM clients ORDER BY id",
    ),
    audits: await all(
      "SELECT action, target_id FROM audit_logs WHERE action LIKE 'case_request.%' ORDER BY id",
    ),
    notifications: await all(
      "SELECT user_id, kind, target_id FROM notifications ORDER BY id",
    ),
  };
}

/**
 * このテストのデータだけを消す。外部キーの順：既読位置 → 通知（案件のチャンネル）→ 参加 → 案件の部署 → 案件 → チャンネル → 部屋 →
 * テストの取引先の連番 → 146-A の後始末（申請・取引先・利用者・部署）。
 * 案件は「取引先が [UNIT_TEST] のもの」で絞る。部屋の ID は、案件を消す前に集める。
 * 案件の行だけを消したテスト（deleteCaseRow）で残る案件専用チャンネルも消すため、purpose='case' で、テストの取引先コード
 * （insertClient の QY・QZ で始まる）で始まる名前のチャンネルも対象にする。チャンネルの created_by は利用者を指すため、利用者より先に消す。
 */
export async function cleanupCaseApprovalTestData() {
  const tagged = `${TEST_TAG}%`;
  const testClients = "SELECT id FROM clients WHERE name LIKE ?1";
  if (await tableExists("cases")) {
    const caseRooms = `SELECT channel_id FROM cases WHERE client_id IN (${testClients}) OR number_client_id IN (${testClients})
      UNION SELECT room_id FROM channels WHERE purpose = 'case' AND (name GLOB 'QY?-*' OR name GLOB 'QZ?-*')`;
    const { results } = await env.DB.prepare(caseRooms)
      .bind(tagged)
      .all<{ channel_id: string }>();
    const roomIds = results.map((r) => r.channel_id);
    const inRooms = `SELECT value FROM json_each(?1)`;
    const rooms = JSON.stringify(roomIds);
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM read_positions WHERE room_id IN (${inRooms})`,
      ).bind(rooms),
      env.DB.prepare(
        `DELETE FROM notifications WHERE room_id IN (${inRooms})`,
      ).bind(rooms),
      env.DB.prepare(`DELETE FROM messages WHERE room_id IN (${inRooms})`).bind(
        rooms,
      ),
      env.DB.prepare(
        `DELETE FROM channel_members WHERE channel_id IN (${inRooms})`,
      ).bind(rooms),
      env.DB.prepare(
        `DELETE FROM case_departments WHERE case_id IN (SELECT id FROM cases WHERE client_id IN (${testClients}) OR number_client_id IN (${testClients}))`,
      ).bind(tagged),
      env.DB.prepare(
        `DELETE FROM cases WHERE client_id IN (${testClients}) OR number_client_id IN (${testClients})`,
      ).bind(tagged),
      env.DB.prepare(`DELETE FROM channels WHERE room_id IN (${inRooms})`).bind(
        rooms,
      ),
      env.DB.prepare(`DELETE FROM rooms WHERE id IN (${inRooms})`).bind(rooms),
    ]);
  }
  if (await tableExists("case_number_sequences"))
    await env.DB.prepare(
      `DELETE FROM case_number_sequences WHERE client_id IN (${testClients})`,
    )
      .bind(tagged)
      .run();
  await cleanupCaseRequestTestData();
}
