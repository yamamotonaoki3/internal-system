// #124 のテストで使う、通知（notifications）の架空のテストデータの作成・読み取り・後始末（識別子で消す）。
// 通知の種類は本 Issue では 0 件なので、任意の文字列（test_kind 等）で行を作る。識別子は、宛先が testuser_ / e2euser_ の利用者であること。
// 表の形は計画「テーブル notifications」：id・user_id・kind・room_id・message_id・target_id・created_at・read_at。
import { env } from "cloudflare:workers";
import { createUlidFactory } from "../src/lib/ulid";
import { cleanupAuthTestData } from "./auth-fixtures";

/** 通知の種類の代わりに使う、任意の文字列（本番の定義元にはない） */
export const TEST_KIND = "test_kind";
export const NOTIFICATION_NOW = "2026-11-11T00:00:00.000Z";

/** 指定したミリ秒の時刻を持つ ULID（時刻が違えば、必ず時刻の大小の順になる） */
export function notificationIdAt(ms: number): string {
  return createUlidFactory({ now: () => ms })();
}

export type NotificationSeed = {
  userId: string;
  kind?: string;
  id?: string;
  createdAt?: string;
  readAt?: string | null;
  roomId?: string | null;
  messageId?: string | null;
  targetId?: string | null;
};

export type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  room_id: string | null;
  message_id: string | null;
  target_id: string | null;
  created_at: string;
  read_at: string | null;
};

function insertStatement(seed: NotificationSeed, index: number) {
  return env.DB.prepare(
    "INSERT INTO notifications (id, user_id, kind, room_id, message_id, target_id, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    seed.id ?? notificationIdAt(1_800_000_000_000 + index),
    seed.userId,
    seed.kind ?? TEST_KIND,
    seed.roomId ?? null,
    seed.messageId ?? null,
    seed.targetId ?? null,
    seed.createdAt ?? NOTIFICATION_NOW,
    seed.readAt ?? null,
  );
}

export async function insertNotification(
  seed: NotificationSeed,
): Promise<string> {
  const id = seed.id ?? notificationIdAt(1_800_000_000_000);
  await insertStatement({ ...seed, id }, 0).run();
  return id;
}

/**
 * 宛先 userId に count 件を入れる。IDは昇順、作成日時も昇順（1 分ずつ）。IDの配列（昇順）を返す。
 * readCount 件（古い方から）を既読にする。
 */
export async function insertNotifications(
  userId: string,
  count: number,
  options: { readCount?: number; kind?: string } = {},
): Promise<string[]> {
  const base = Date.parse("2026-11-01T00:00:00.000Z");
  const seeds = Array.from({ length: count }, (_, i) => {
    const at = base + i * 60_000;
    return {
      userId,
      kind: options.kind,
      id: notificationIdAt(at),
      createdAt: new Date(at).toISOString(),
      readAt: i < (options.readCount ?? 0) ? "2026-11-02T00:00:00.000Z" : null,
    } satisfies NotificationSeed;
  });
  const chunk = 50;
  for (let start = 0; start < seeds.length; start += chunk) {
    await env.DB.batch(
      seeds
        .slice(start, start + chunk)
        .map((seed, i) => insertStatement(seed, start + i)),
    );
  }
  return seeds.map((seed) => seed.id);
}

export async function notificationRows(
  userId: string,
): Promise<NotificationRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, user_id, kind, room_id, message_id, target_id, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC",
  )
    .bind(userId)
    .all<NotificationRow>();
  return results;
}

export async function notificationRow(id: string) {
  return env.DB.prepare(
    "SELECT id, user_id, kind, room_id, message_id, target_id, created_at, read_at FROM notifications WHERE id = ?",
  )
    .bind(id)
    .first<NotificationRow>();
}

/** 通知の件数（テストの利用者宛てのもの全部） */
export async function testNotificationCount(): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notifications WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!')",
  ).first<{ n: number }>();
  if (row === null) throw new Error("通知の件数を読めませんでした");
  return row.n;
}

/**
 * このテストの通知だけを消す。user_id の外部キーのため、利用者を消す後始末（cleanupRoleTestData 等）より先に呼ぶ。
 * 対象：宛先が testuser_ / e2euser_ の利用者の通知。
 */
export async function cleanupNotificationTestData() {
  await env.DB.prepare(
    "DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!')",
  ).run();
}

/** 通知 → セッション・監査 → 部署・利用者の順に後始末する（後続の cleanupRoleTestData は呼び出し側で呼ぶ） */
export async function cleanupNotificationScenario(
  cleanupRest: () => Promise<void>,
) {
  try {
    await cleanupNotificationTestData();
  } finally {
    try {
      await cleanupAuthTestData();
    } finally {
      await cleanupRest();
    }
  }
}
