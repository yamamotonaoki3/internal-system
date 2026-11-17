// #147（147-A）のテストで使う、案件の一覧・概要・詳細の架空のテストデータの作成と後始末（識別子で消す）。
// 部署・利用者・取引先の世界は case-request-fixtures.ts（setupCaseWorld）を使う。案件は、説明・納期・参加者・ID を自由に決めて入れる。
// 案件の後始末は case-approval-fixtures.ts の cleanupCaseApprovalTestData（取引先が [UNIT_TEST] の案件と、その部屋・チャンネル・参加）に任せる。
// 案件番号の英字は、テストの取引先のコード（QZA・QZB・QZX）で始める（後始末の GLOB 'QZ?-*' の対象）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { createUlidFactory } from "../src/lib/ulid";
import { CASEREQ_NOW, caseRequestIdAt } from "./case-request-fixtures";

export { cleanupCaseApprovalTestData as cleanupCaseTestData } from "./case-approval-fixtures";

/** 案件の操作の失敗の文言（計画 147-A の判定の順。画面はこの文言をそのまま出す） */
export const CASE_MESSAGES = {
  notFound: "案件が見つかりません",
  participantsOnly: "参加者だけが見られます（非公開）",
} as const;

export const CASES_BASE = "/api/cases";

/** 案件の ID（ULID）。n が大きいほど新しい（ID の降順の確認用） */
export function caseIdOf(n: number): string {
  // 乱数の部分を固定し、同じ n には必ず同じ ID を返す（時刻の部分が n とともに増えるので、ID の降順は n の降順）
  return createUlidFactory({
    now: () => 1_830_000_000_000 + n * 1_000,
    random: (length) => new Uint8Array(length),
  })();
}

/** 存在しない案件の ID（ULID の形） */
export const MISSING_CASE_ID = caseRequestIdAt(1_829_000_000_000);

let roomSequence = 0;
function nextRoomId(): string {
  roomSequence += 1;
  return caseRequestIdAt(1_840_000_000_000 + roomSequence * 1_000);
}

export type CaseMember = { userId: string; joinedAt: string };

export type CaseSeed = {
  n: number;
  clientId: string;
  /** 案件番号の英字（取引先のコード） */
  code: string;
  title: string;
  createdBy: string;
  departmentIds: string[];
  status?: "active" | "closed";
  description?: string;
  dueDate?: string | null;
  members?: CaseMember[];
};

export type SeededCase = {
  id: string;
  roomId: string;
  caseNumber: string;
  title: string;
  description: string;
};

/** 参加の時刻（n 分後。並びの確認用） */
export const joinedAt = (minutes: number) =>
  new Date(Date.parse(CASEREQ_NOW) + minutes * 60_000).toISOString();

/**
 * 案件を1件入れる：部屋 → 案件専用チャンネル（purpose=case・private・部署なし）→ 案件 → 担当部署 → 参加。
 * 参加の行は、利用者が無効でもそのまま入れる（C-142(1)：退職しても参加の記録は残る）。
 */
export async function seedCase(seed: CaseSeed): Promise<SeededCase> {
  const id = caseIdOf(seed.n);
  const roomId = nextRoomId();
  const caseNumber = `${seed.code}-261117-${String(seed.n).padStart(4, "0")}`;
  const description = seed.description ?? "";
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
      caseNumber,
      `case:${caseNumber.toLowerCase()}`,
      seed.createdBy,
      CASEREQ_NOW,
      CASEREQ_NOW,
    ),
    env.DB.prepare(
      `INSERT INTO cases (id, case_number, number_client_id, client_id, channel_id, request_id, title, description, due_date,
         status, created_by, approved_by, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      id,
      caseNumber,
      seed.clientId,
      seed.clientId,
      roomId,
      // 申請の行は作らない（request_id は外部キーでない）。案件ごとに別の値
      caseRequestIdAt(1_850_000_000_000 + seed.n * 1_000),
      seed.title,
      description,
      seed.dueDate ?? null,
      seed.status ?? "active",
      seed.createdBy,
      seed.createdBy,
      CASEREQ_NOW,
      CASEREQ_NOW,
    ),
    ...seed.departmentIds.map((departmentId) =>
      env.DB.prepare(
        "INSERT INTO case_departments (case_id, department_id) VALUES (?, ?)",
      ).bind(id, departmentId),
    ),
    ...(seed.members ?? []).map((member) =>
      env.DB.prepare(
        "INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)",
      ).bind(roomId, member.userId, member.joinedAt),
    ),
  ]);
  return { id, roomId, caseNumber, title: seed.title, description };
}

export async function addCaseMember(
  roomId: string,
  userId: string,
  at = joinedAt(30),
) {
  await env.DB.prepare(
    "INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)",
  )
    .bind(roomId, userId, at)
    .run();
}

/** 参加から外す（147-B の操作の代わりに、行を直接消す） */
export async function removeCaseMember(roomId: string, userId: string) {
  await env.DB.prepare(
    "DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?",
  )
    .bind(roomId, userId)
    .run();
}

/** 表示名を変える（参加者の一覧で人を見分けるため。insertUser は全員「テスト太郎」にする） */
export async function setDisplayName(userId: string, displayName: string) {
  await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
    .bind(displayName, userId)
    .run();
}
