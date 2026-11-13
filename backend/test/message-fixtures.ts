// #201 のDBテストで使う、メッセージ（messages）の架空のテストデータの作成・読み取り・後始末（識別子で消す）。
// 識別子：投稿者が testuser_ / e2euser_ の利用者、または部署名・チャンネル名が [UNIT_TEST] のチャンネルの部屋。本文は [UNIT_TEST] を付ける。
// 表の形は計画 2章：messages(id, room_id, sender_id, sender_display_name, body, created_at)。
import { env } from "cloudflare:workers";
import { withMessages } from "../src/db/message.repository";
import { withRoleAssignments } from "../src/db/role-assignment.repository";
import { createLogger } from "../src/lib/logger/logger";
import { createUlidFactory } from "../src/lib/ulid";
import { createAppAuthorizer } from "../src/services/authorizer";
import { createMessageService } from "../src/services/message.service";
import { cleanupAuthTestData } from "./auth-fixtures";
import { cleanupDepartmentTestData } from "./department-fixtures";
import { cleanupReadPositions } from "./read-position-fixtures";
import { TEST_TAG, testId } from "./role-fixtures";

export { TEST_TAG };
export const MESSAGE_TEST_NOW = "2026-11-09T00:00:00.000Z";
/** after に渡すと「最初から全部」になる、最小のULID */
export const ZERO_ID = "00000000000000000000000000";

/** 指定したミリ秒の時刻を持つULID（時刻が違えば、必ず時刻の大小の順になる） */
export function ulidAt(ms: number): string {
  return createUlidFactory({ now: () => ms })();
}

export type MessageSeed = {
  roomId: string;
  senderId: string;
  body?: string;
  id?: string;
  displayName?: string;
};

function insertStatement(seed: MessageSeed, index = 0) {
  return env.DB.prepare(
    "INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(
    seed.id ?? ulidAt(1_800_000_000_000 + index),
    seed.roomId,
    seed.senderId,
    seed.displayName ?? "テスト太郎",
    seed.body ?? `${TEST_TAG}本文${index}`,
    MESSAGE_TEST_NOW,
  );
}

export async function insertMessage(seed: MessageSeed): Promise<string> {
  const id = seed.id ?? ulidAt(1_800_000_000_000);
  await insertStatement({ ...seed, id }).run();
  return id;
}

/** 昇順のIDで count 件を入れ、IDの配列（昇順）を返す */
export async function insertMessages(
  roomId: string,
  senderId: string,
  count: number,
): Promise<string[]> {
  const ids = Array.from({ length: count }, (_, i) =>
    ulidAt(1_800_000_000_000 + i),
  );
  const chunk = 50;
  for (let start = 0; start < count; start += chunk) {
    await env.DB.batch(
      ids
        .slice(start, start + chunk)
        .map((id, i) =>
          insertStatement(
            { roomId, senderId, id, body: `${TEST_TAG}本文${start + i}` },
            start + i,
          ),
        ),
    );
  }
  return ids;
}

/** 部屋のメッセージのIDを昇順で */
export async function messageIds(roomId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM messages WHERE room_id = ? ORDER BY id",
  )
    .bind(roomId)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

export async function messageCount(roomId: string): Promise<number> {
  return (await messageIds(roomId)).length;
}

const directRooms: string[] = [];

/**
 * チャンネルではない部屋（DM。kind='direct'。#136 C-168(1)）だけを作る。会話（conversations）・当事者の行は作らない。
 * 当事者のいる DM は dm-fixtures の insertDm を使う。
 */
export async function insertDirectRoom(): Promise<string> {
  const id = testId("DIRECT");
  await env.DB.prepare(
    "INSERT INTO rooms (id, kind, created_at) VALUES (?, 'direct', ?)",
  )
    .bind(id, MESSAGE_TEST_NOW)
    .run();
  directRooms.push(id);
  return id;
}

/**
 * このテストのメッセージだけを消す。外部キーの都合で、チャンネル・利用者を消す後始末（cleanupDepartmentTestData 等）より先に呼ぶ。
 * 対象：投稿者が testuser_/e2euser_ の利用者、[UNIT_TEST] のチャンネルの部屋、このファイルが作ったDMの部屋。
 */
export async function cleanupMessageTestData() {
  const testUsers =
    "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";
  const taggedRooms =
    "SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE name LIKE ?1) OR name LIKE ?1";
  const tagged = `${TEST_TAG}%`;
  const rooms = directRooms.splice(0);
  // #237：既読位置（read_positions）は部屋を外部キーで指すため、DM の部屋より先に消す
  await cleanupReadPositions();
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM messages WHERE sender_id IN (${testUsers}) OR room_id IN (${taggedRooms})`,
    ).bind(tagged),
    ...rooms.flatMap((id) => [
      env.DB.prepare("DELETE FROM messages WHERE room_id = ?").bind(id),
      env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(id),
    ]),
  ]);
}

/**
 * メッセージ → セッション・監査 → チャンネル・部署・利用者の順に後始末する。どれかが失敗しても、残りの後始末は必ず行う
 * （最初の失敗の原因が、後続のテストの「データが残っている」失敗に隠れないようにする）。
 */
export async function cleanupMessageScenario() {
  try {
    await cleanupMessageTestData();
  } finally {
    try {
      await cleanupAuthTestData();
    } finally {
      await cleanupDepartmentTestData();
    }
  }
}

/** Repository の findDisplayName を、指定した利用者ごとに呼んで返す（存在しない利用者は null） */
export async function findDisplayNames(
  userIds: string[],
): Promise<(string | null)[]> {
  return withMessages(env, async (repository) => {
    const names: (string | null)[] = [];
    for (const id of userIds) {
      names.push(await repository.findDisplayName(id));
    }
    return names;
  });
}

/**
 * 投稿者の表示名が取れない（findDisplayName が null）状態でサービスに投稿させ、投げられたエラーと挿入の呼び出し回数を返す。
 * 挿入は実際には行わない。
 */
export async function postWithMissingDisplayName(
  userId: string,
  roomId: string,
  body: string,
): Promise<{ error: unknown; insertCalls: number }> {
  let insertCalls = 0;
  const error = await withMessages(env, (repository) =>
    withRoleAssignments(env, async (roles) => {
      const authorizer = createAppAuthorizer(roles, {
        logger: createLogger({ traceId: "unit-201-boundary" }),
      });
      const service = createMessageService(
        {
          ...repository,
          findDisplayName: async () => null,
          insertIfOrdered: async () => {
            insertCalls += 1;
            return 1;
          },
        },
        { authorizer },
      );
      return service
        .post({ userId, traceId: "unit-201-boundary" }, roomId, body)
        .then(
          () => null,
          (e: unknown) => e,
        );
    }),
  );
  return { error, insertCalls };
}
