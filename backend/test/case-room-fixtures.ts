// #148（148-A）のテストで使う、案件専用チャンネル（案件の部屋）のやり取りの架空のテストデータの作成と後始末（識別子で消す）。
// 世界は case-request-fixtures.ts の setupCaseWorld（部署・利用者・取引先）と、case-fixtures.ts の seedCase（案件・案件専用チャンネル・参加）を使う。
// 比べる相手として、案件でない部屋（部署 deptS の通常のチャンネル・DM）も作る。
// 後始末：R2 の添付の実体 → 案件でない部屋のメッセージと、それを参照する行 → DM → 案件（cleanupCaseTestData）の順。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { bucket, storedKeys } from "./attachment-fixtures";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "./case-fixtures";
import { setCaseStatus } from "./case-participant-fixtures";
import {
  TEST_TAG,
  setupCaseWorld,
  type CaseWorld,
} from "./case-request-fixtures";
import { insertChannel, insertMember } from "./department-fixtures";
import { cleanupDmTestData, insertDm } from "./dm-fixtures";
import { idAt, isoAt } from "./thread-fixtures";
import { insertMessage } from "./message-fixtures";

export { setCaseStatus };

/** 案件の部屋の書き込みが、案件の終了のために拒否されたときの 409 の文言（計画 148-A「判定の順」） */
export const CASE_CLOSED_MESSAGE = "終了した案件には投稿できません";
/** 終了した案件での 409 の文言（決定記録 C-184。経路ごと。完全一致で確かめる） */
export const CASE_CLOSED_MESSAGES = {
  post: "終了した案件には投稿できません",
  modify: "終了した案件のメッセージは変更できません",
  reaction: "終了した案件にはリアクションできません",
  upload: "終了した案件には添付できません",
} as const;
/** 返信できない理由（計画 148-A。shared/message-rules.ts の REPLY_BLOCKED_REASONS に足す値） */
export const CASE_CLOSED_REASON = "case_closed";

export type CaseRoomWorld = {
  w: CaseWorld;
  /** 進行中の案件：参加者 memberS1・memberD1・inactive（無効・参加の行は残る）。ownerS・memberS2 は非参加 */
  open: SeededCase;
  /** 終了の案件：参加者 memberS1・memberD1・inactive */
  closed: SeededCase;
  /** 進行中の別の案件：参加者 memberS2 だけ（「ほかの部屋の参加者」の確認用） */
  other: SeededCase;
  /** 案件でない、部署 deptS の公開の通常チャンネル：memberS1・memberD1 が参加 */
  normal: string;
};

/** 案件の部屋の世界を作る。n は seedCase の番号（同じテストのファイルの中で重ならないもの） */
export async function setupCaseRoomWorld(base = 1480): Promise<CaseRoomWorld> {
  const w = await setupCaseWorld();
  const participants = [
    { userId: w.memberS1.id, joinedAt: joinedAt(1) },
    { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    { userId: w.inactive.id, joinedAt: joinedAt(3) },
  ];
  const open = await seedCase({
    n: base + 1,
    clientId: w.clientA.id,
    code: "QZA",
    title: `${TEST_TAG}148進行中`,
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: participants,
  });
  const closed = await seedCase({
    n: base + 2,
    clientId: w.clientA.id,
    code: "QZA",
    title: `${TEST_TAG}148終了`,
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    status: "closed",
    members: participants,
  });
  const other = await seedCase({
    n: base + 3,
    clientId: w.clientB.id,
    code: "QZB",
    title: `${TEST_TAG}148別の案件`,
    createdBy: w.memberS2.id,
    departmentIds: [w.deptS.id],
    members: [{ userId: w.memberS2.id, joinedAt: joinedAt(1) }],
  });
  const normal = await insertChannel({
    name: `${TEST_TAG}148通常`,
    purpose: "normal",
    departmentId: w.deptS.id,
  });
  await insertMember(normal, w.memberS1.id);
  await insertMember(normal, w.memberD1.id);
  return { w, open, closed, other, normal };
}

/** 2人の DM を作る（案件でない部屋の比べる相手） */
export const insertCaseWorldDm = (a: string, b: string) => insertDm(a, b);

/** 投稿（親）を入れる。n は idAt の番号 */
export async function seedRoomMessage(
  roomId: string,
  senderId: string,
  n: number,
  body = `${TEST_TAG}148投稿${n}`,
): Promise<string> {
  const id = idAt(n);
  await insertMessage({ roomId, senderId, id, body, createdAt: isoAt(n) });
  return id;
}

/** 返信を入れる。n は idAt の番号（親より大きい） */
export async function seedRoomReply(
  roomId: string,
  parentId: string,
  senderId: string,
  n: number,
): Promise<string> {
  const id = idAt(n);
  await insertMessage({
    roomId,
    senderId,
    id,
    body: `${TEST_TAG}148返信${n}`,
    createdAt: isoAt(n),
    parentMessageId: parentId,
  });
  return id;
}

/** 部屋の行の数（メッセージ） */
export async function messageCountIn(roomId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM messages WHERE room_id = ?",
  )
    .bind(roomId)
    .first<{ n: number }>();
  if (row === null) throw new Error("メッセージの件数を読めませんでした");
  return row.n;
}

/** 部屋の添付の行の数 */
export async function attachmentCountIn(roomId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM message_attachments WHERE room_id = ?",
  )
    .bind(roomId)
    .first<{ n: number }>();
  if (row === null) throw new Error("添付の件数を読めませんでした");
  return row.n;
}

const TEST_USERS =
  "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";

/**
 * 後始末。R2 の添付の実体（attachments/）→ テストの利用者のメッセージを参照する行 → メッセージ → DM → 案件と世界。
 * 途中で失敗しても、残りは必ず行う。
 */
export async function cleanupCaseRoomWorld() {
  try {
    const keys = await storedKeys();
    if (keys.length > 0) await bucket().delete(keys);
  } finally {
    try {
      const mine = `SELECT id FROM messages WHERE sender_id IN (${TEST_USERS})`;
      await env.DB.batch([
        env.DB.prepare(
          `DELETE FROM message_reactions WHERE user_id IN (${TEST_USERS}) OR message_id IN (${mine})`,
        ),
        env.DB.prepare(
          `DELETE FROM message_mentions WHERE message_id IN (${mine})`,
        ),
        env.DB.prepare(
          `DELETE FROM thread_read_positions WHERE user_id IN (${TEST_USERS}) OR parent_message_id IN (${mine})`,
        ),
        env.DB.prepare(
          `DELETE FROM message_attachments WHERE uploader_id IN (${TEST_USERS}) OR message_id IN (${mine})`,
        ),
        env.DB.prepare(
          `DELETE FROM read_positions WHERE user_id IN (${TEST_USERS})`,
        ),
        env.DB.prepare(
          `DELETE FROM notifications WHERE user_id IN (${TEST_USERS})`,
        ),
        env.DB.prepare(
          `DELETE FROM messages WHERE parent_message_id IN (${mine})`,
        ),
        env.DB.prepare(`DELETE FROM messages WHERE id IN (${mine})`),
      ]);
    } finally {
      try {
        await cleanupDmTestData();
      } finally {
        await cleanupCaseTestData();
      }
    }
  }
}
