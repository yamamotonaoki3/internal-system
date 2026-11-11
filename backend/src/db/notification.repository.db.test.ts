// #124 AC-1（3-4 AC-1〜AC-3 の土台）・AC-2：通知の Repository（db/notification.repository.ts）を、隔離 D1 で直接呼んで確かめる。
// 期待値は計画「通知の設計」・要件 3-4・R-57 から決める。時刻は引数で固定する。通知の種類は本 Issue では 0 件のため、任意の文字列（test_kind 等）を使う。
// 契約（実装者へ）：
//  - notificationInserts<K extends string = NotificationKind>(db, recipientIds: readonly string[], input: { kind: K; roomId?: string|null; messageId?: string|null; targetId?: string|null }): BatchItem[]
//      文を返すだけで実行しない。宛先ごとに 1 文（D1 の 1 文の変数の上限を超えない）。宛先の重複は除く。0 人なら空配列。
//      id は ULID、created_at は DB の既定（nowUtc）、read_at は null。省略した roomId・messageId・targetId は null。
//  - createNotificationRepository(db: Database, deps: { definitions?: Readonly<Record<string, { containsRoomContent: boolean }>> } = {}):
//      listForRecipient(recipientId, { limit, cursor?: CursorPayload }): Promise<{ items: { id, kind, roomId, messageId, targetId, createdAt, readAt }[]; nextCursor: string | null }>
//          created_at 降順・id 降順。limit+1 件を読み toPage で切る。user_id = recipientId の条件は visibleToRecipient を通す
//      countUnread(recipientId): Promise<number>   未読数。100 で打ち切る。条件は visibleToRecipient を通す
//      markRead(recipientId, notificationId, nowIso): Promise<boolean>   宛先本人の通知として存在したか。未読なら read_at = nowIso。既読済みは read_at を変えず true。他人宛て・不在は false で何も変えない
//      markAllRead(recipientId, nowIso): Promise<number>   本人の未読を既読にした件数。既読の read_at は変えない
//  - visibleToRecipient(recipientId: string, definitions = NOTIFICATION_KIND_DEFINITIONS): SQL（drizzle の SQL）
//      「本人宛て」＋「containsRoomContent が true の種類にだけ当てる部屋の条件」。roomContentKinds(definitions) が空なら部屋の条件を付けない（空の IN () を作らない）
//  - withNotifications(env, run)
// データは架空（testuser_notif_db_・テスト太郎・@example.com・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  TEST_KIND,
  cleanupNotificationScenario,
  insertNotification,
  insertNotifications,
  notificationIdAt,
  notificationRow,
  notificationRows,
} from "../../test/notification-fixtures";
import {
  cleanupRoleTestData,
  insertDepartment,
  insertUser,
  testId,
} from "../../test/role-fixtures";
import { decodeCursor } from "../lib/cursor";
import { isUlid } from "../lib/ulid";
import { withDatabase, type BatchItem } from "./database";
import {
  createNotificationRepository,
  notificationInserts,
  visibleToRecipient,
} from "./notification.repository";

const NOW = "2026-11-11T00:00:00.000Z";
const LATER = "2026-11-11T05:00:00.000Z";

// 業務の表の代わりのテスト専用テーブル。CHECK 制約で、業務の文を意図的に失敗させる
const accounts = sqliteTable("unit_notif_accounts", {
  id: integer("id").primaryKey(),
  balance: integer("balance").notNull(),
});
const rawDb = drizzle(env.DB);
/** db.batch は 1 文以上の配列を要求するため、テストでは空でない配列として渡す */
const commit = (items: BatchItem[]) =>
  rawDb.batch(items as [BatchItem, ...BatchItem[]]);

let deptId: string;
let userA: string;
let userB: string;
let userC: string;

const repo = <T>(
  run: (r: ReturnType<typeof createNotificationRepository>) => Promise<T>,
  definitions?: Readonly<Record<string, { containsRoomContent: boolean }>>,
) =>
  withDatabase(env, (db) =>
    run(createNotificationRepository(db, definitions ? { definitions } : {})),
  );

beforeAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS unit_notif_accounts");
  await env.DB.exec(
    "CREATE TABLE unit_notif_accounts (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL CHECK (balance >= 0))",
  );
});

beforeEach(async () => {
  deptId = await insertDepartment("通知DB営業");
  userA = await insertUser("testuser_notif_db_a", deptId);
  userB = await insertUser("testuser_notif_db_b", deptId);
  userC = await insertUser("testuser_notif_db_c", deptId);
});

afterEach(async () => {
  await env.DB.exec("DELETE FROM unit_notif_accounts");
  await cleanupNotificationScenario(cleanupRoleTestData);
});

afterAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS unit_notif_accounts");
});

describe("#124 AC-1（3-4 AC-1・AC-2 の土台）notificationInserts は業務の db.batch に入れて原子的に確定する", () => {
  it("#124 AC-1（3-4 AC-1）: 業務の更新と同じ batch に入れると、両方が確定する", async () => {
    await rawDb.insert(accounts).values({ id: 1, balance: 100 });
    await rawDb.batch([
      rawDb
        .update(accounts)
        .set({ balance: sql`${accounts.balance} - 30` })
        .where(sql`${accounts.id} = 1`),
      ...notificationInserts<typeof TEST_KIND>(rawDb, [userA, userB], {
        kind: TEST_KIND,
      }),
    ]);
    const [row] = await rawDb.select().from(accounts);
    expect(row?.balance).toBe(70);
    expect(await notificationRows(userA)).toHaveLength(1);
    expect(await notificationRows(userB)).toHaveLength(1);
  });

  it("#124 AC-1（3-4 AC-2）: batch の後ろの業務の文が失敗すると、通知も 1 件も残らない", async () => {
    await rawDb.insert(accounts).values({ id: 1, balance: 10 });
    await expect(
      commit([
        ...notificationInserts<typeof TEST_KIND>(rawDb, [userA, userB], {
          kind: TEST_KIND,
        }),
        rawDb
          .update(accounts)
          .set({ balance: sql`${accounts.balance} - 30` })
          .where(sql`${accounts.id} = 1`),
      ]),
    ).rejects.toThrow();
    expect(await notificationRows(userA)).toHaveLength(0);
    expect(await notificationRows(userB)).toHaveLength(0);
    const [row] = await rawDb.select().from(accounts);
    expect(row?.balance).toBe(10);
  });

  it("#124 AC-1（3-4 AC-2）: 通知の文が失敗すると（存在しない宛先）、業務の更新も残らない", async () => {
    await rawDb.insert(accounts).values({ id: 1, balance: 100 });
    await expect(
      rawDb.batch([
        rawDb
          .update(accounts)
          .set({ balance: sql`${accounts.balance} - 30` })
          .where(sql`${accounts.id} = 1`),
        ...notificationInserts<typeof TEST_KIND>(rawDb, [testId("NOUSER")], {
          kind: TEST_KIND,
        }),
      ]),
    ).rejects.toThrow();
    const [row] = await rawDb.select().from(accounts);
    expect(row?.balance).toBe(100);
  });

  it("#124 AC-1: 文を返すだけで、batch に入れるまでは何も書かない", async () => {
    notificationInserts<typeof TEST_KIND>(rawDb, [userA], { kind: TEST_KIND });
    expect(await notificationRows(userA)).toHaveLength(0);
  });
});

describe("#124 AC-1（3-4 AC-3・R-57）notificationInserts の宛先", () => {
  it("#124 AC-1（3-4 AC-3）: 渡した宛先にだけ作られ、渡していない利用者には 0 件", async () => {
    await commit(
      notificationInserts<typeof TEST_KIND>(rawDb, [userA, userB], {
        kind: TEST_KIND,
        roomId: "01JTESTNOTIFROOM0000000001",
        messageId: "01JTESTNOTIFMESSAGE00000001",
        targetId: "01JTESTNOTIFTARGET00000001",
      }),
    );
    expect(await notificationRows(userA)).toHaveLength(1);
    expect(await notificationRows(userB)).toHaveLength(1);
    expect(await notificationRows(userC)).toHaveLength(0);
  });

  it("#124 AC-1（3-4 AC-3）: 宛先の重複は 1 件にまとめる", async () => {
    await commit(
      notificationInserts<typeof TEST_KIND>(
        rawDb,
        [userA, userA, userB, userA],
        {
          kind: TEST_KIND,
        },
      ),
    );
    expect(await notificationRows(userA)).toHaveLength(1);
    expect(await notificationRows(userB)).toHaveLength(1);
  });

  it("#124 AC-1（3-4 AC-3）: 宛先が 0 人なら文は 0 件（batch に空配列を渡さずに済む）", () => {
    expect(
      notificationInserts<typeof TEST_KIND>(rawDb, [], { kind: TEST_KIND }),
    ).toEqual([]);
  });

  it("#124 AC-1: 宛先が多くても（30 人）1 文の変数の上限に当たらず、全員に 1 件ずつ作られる", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 30; i += 1)
      ids.push(
        await insertUser(
          `testuser_notif_db_m${String(i).padStart(2, "0")}`,
          deptId,
        ),
      );
    await commit(
      notificationInserts<typeof TEST_KIND>(rawDb, ids, {
        kind: TEST_KIND,
      }),
    );
    for (const id of ids) expect(await notificationRows(id)).toHaveLength(1);
  });

  it("#124 AC-1: 作られる行は ULID の id・指定した種類と ID・未読（read_at が null）・作成日時あり。宛先ごとに id が違う", async () => {
    await commit(
      notificationInserts<typeof TEST_KIND>(rawDb, [userA, userB], {
        kind: TEST_KIND,
        roomId: "01JTESTNOTIFROOM0000000001",
        messageId: "01JTESTNOTIFMESSAGE00000001",
        targetId: "01JTESTNOTIFTARGET00000001",
      }),
    );
    const a = (await notificationRows(userA))[0];
    const b = (await notificationRows(userB))[0];
    expect(a).toMatchObject({
      kind: TEST_KIND,
      room_id: "01JTESTNOTIFROOM0000000001",
      message_id: "01JTESTNOTIFMESSAGE00000001",
      target_id: "01JTESTNOTIFTARGET00000001",
      read_at: null,
    });
    expect(isUlid(a?.id)).toBe(true);
    expect(isUlid(b?.id)).toBe(true);
    expect(a?.id).not.toBe(b?.id);
    expect(Number.isNaN(Date.parse(a?.created_at ?? ""))).toBe(false);
  });

  it("#124 AC-1: roomId・messageId・targetId を省くと null", async () => {
    await commit(
      notificationInserts<typeof TEST_KIND>(rawDb, [userA], {
        kind: TEST_KIND,
      }),
    );
    expect((await notificationRows(userA))[0]).toMatchObject({
      room_id: null,
      message_id: null,
      target_id: null,
    });
  });

  it("#124 AC-1（security・data-model）: 通知の行に本名・本文・メール・表示名を持つ列がなく、行の値にも入らない", async () => {
    const { results } = await env.DB.prepare(
      "PRAGMA table_info(notifications)",
    ).all<{ name: string }>();
    expect(results.map((column) => column.name).sort()).toEqual(
      [
        "created_at",
        "id",
        "kind",
        "message_id",
        "read_at",
        "room_id",
        "target_id",
        "user_id",
      ].sort(),
    );
    await commit(
      notificationInserts<typeof TEST_KIND>(rawDb, [userA], {
        kind: TEST_KIND,
        targetId: "01JTESTNOTIFTARGET00000001",
      }),
    );
    const text = JSON.stringify(await notificationRows(userA));
    expect(text).not.toContain("テスト太郎");
    expect(text).not.toContain("@example.com");
  });
});

describe("#124 AC-2 型：本番のコードは定義元にない種類を渡せない", () => {
  it("#124 AC-2: 型引数の既定値は NotificationKind。定義にない種類は型エラーで、型引数で渡せばテストは任意の種類を使える", () => {
    const compileOnly = () => {
      // @ts-expect-error 既定の型引数は NotificationKind。定義元にない種類は渡せない
      notificationInserts(rawDb, [], { kind: "test_undefined_kind" });
      return notificationInserts<"test_undefined_kind">(rawDb, [], {
        kind: "test_undefined_kind",
      });
    };
    expect(compileOnly()).toEqual([]);
  });
});

describe("#124 AC-1（R-57）一覧：本人宛てだけが、新しい順に見える", () => {
  it("#124 AC-1（R-57）: 他人宛ての通知は出ない。新しい順で、項目の形は決めた 7 項目だけ（user_id を返さない）", async () => {
    const aIds = await insertNotifications(userA, 3);
    await insertNotifications(userB, 2);
    const page = await repo((r) => r.listForRecipient(userA, { limit: 20 }));
    expect(page.items.map((item) => item.id)).toEqual([...aIds].reverse());
    expect(page.nextCursor).toBeNull();
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(
      [
        "createdAt",
        "id",
        "kind",
        "messageId",
        "readAt",
        "roomId",
        "targetId",
      ].sort(),
    );
  });

  it("#124 AC-1: 通知がない利用者は、空の一覧と nextCursor が null", async () => {
    await insertNotifications(userB, 1);
    expect(await repo((r) => r.listForRecipient(userA, { limit: 20 }))).toEqual(
      { items: [], nextCursor: null },
    );
  });

  it("#124 AC-1: カーソルで続きを読むと、重複も欠落もなく、同じ作成日時の行が続いても順序が安定する", async () => {
    const sameTime = "2026-11-05T00:00:00.000Z";
    const ids = Array.from({ length: 5 }, (_v, i) =>
      notificationIdAt(1_800_000_000_000 + i),
    );
    for (const id of ids)
      await insertNotification({ userId: userA, id, createdAt: sameTime });
    const older = await insertNotification({
      userId: userA,
      id: notificationIdAt(1_700_000_000_000),
      createdAt: "2026-11-01T00:00:00.000Z",
    });
    const newer = await insertNotification({
      userId: userA,
      id: notificationIdAt(1_900_000_000_000),
      createdAt: "2026-11-09T00:00:00.000Z",
    });
    const expected = [newer, ...[...ids].reverse(), older];

    const seen: string[] = [];
    let cursor: ReturnType<typeof decodeCursor> | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await repo((r) =>
        r.listForRecipient(userA, { limit: 2, cursor }),
      );
      seen.push(...page.items.map((item) => item.id));
      if (page.nextCursor === null) break;
      cursor = decodeCursor(page.nextCursor);
    }
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("#124 AC-1（3-4 AC-3）未読数と既読", () => {
  it.each([
    [0, 0],
    [99, 99],
    [100, 100],
    [101, 100],
  ])(
    "#124 AC-1: 未読 %i 件なら未読数は %i（100 で打ち切る）",
    async (unread, expected) => {
      await insertNotifications(userA, unread);
      expect(await repo((r) => r.countUnread(userA))).toBe(expected);
    },
  );

  it("#124 AC-1: 未読数は既読を数えず、他人宛てを数えない", async () => {
    await insertNotifications(userA, 5, { readCount: 2 });
    await insertNotifications(userB, 7);
    expect(await repo((r) => r.countUnread(userA))).toBe(3);
    expect(await repo((r) => r.countUnread(userC))).toBe(0);
  });

  it("#124 AC-1: markRead は本人の未読を指定した時刻で既読にし、true を返す。未読数が 1 減る", async () => {
    const [id] = await insertNotifications(userA, 3);
    expect(await repo((r) => r.markRead(userA, id ?? "", NOW))).toBe(true);
    expect((await notificationRow(id ?? ""))?.read_at).toBe(NOW);
    expect(await repo((r) => r.countUnread(userA))).toBe(2);
  });

  it("#124 AC-1: 既読済みへの markRead も true で、read_at は最初の時刻のまま", async () => {
    const [id] = await insertNotifications(userA, 1);
    await repo((r) => r.markRead(userA, id ?? "", NOW));
    expect(await repo((r) => r.markRead(userA, id ?? "", LATER))).toBe(true);
    expect((await notificationRow(id ?? ""))?.read_at).toBe(NOW);
  });

  it("#124 AC-1（R-57）: 他人宛ての ID の markRead は false で、相手の read_at は変わらない", async () => {
    const [id] = await insertNotifications(userB, 1);
    expect(await repo((r) => r.markRead(userA, id ?? "", NOW))).toBe(false);
    expect((await notificationRow(id ?? ""))?.read_at).toBeNull();
  });

  it("#124 AC-1: 存在しない ID の markRead は false", async () => {
    expect(await repo((r) => r.markRead(userA, testId("NONOTIF"), NOW))).toBe(
      false,
    );
  });

  it("#124 AC-1（3-4 AC-5）: 既読にしても行は消えず、一覧に既読として残る", async () => {
    const [id] = await insertNotifications(userA, 1);
    await repo((r) => r.markRead(userA, id ?? "", NOW));
    const page = await repo((r) => r.listForRecipient(userA, { limit: 20 }));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id, readAt: NOW });
  });

  it("#124 AC-1（R-57）: markAllRead は本人の未読だけを既読にして件数を返し、既読の時刻と他人の分は変えない", async () => {
    const aIds = await insertNotifications(userA, 4, { readCount: 1 });
    const bIds = await insertNotifications(userB, 2);
    expect(await repo((r) => r.markAllRead(userA, LATER))).toBe(3);
    const rows = await notificationRows(userA);
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.read_at === LATER)).toHaveLength(3);
    expect((await notificationRow(aIds[0] ?? ""))?.read_at).toBe(
      "2026-11-02T00:00:00.000Z",
    );
    for (const id of bIds)
      expect((await notificationRow(id))?.read_at).toBeNull();
    expect(await repo((r) => r.countUnread(userA))).toBe(0);
    expect(await repo((r) => r.countUnread(userB))).toBe(2);
  });

  it("#124 AC-1: 未読がなければ markAllRead は 0 を返す", async () => {
    expect(await repo((r) => r.markAllRead(userA, NOW))).toBe(0);
  });
});

describe("#124 AC-1・AC-2（3-1 AC-3 の土台）visibleToRecipient：一覧と未読数が同じ除外条件を通る", () => {
  const MIXED = {
    test_room_kind: { containsRoomContent: true },
    test_plain_kind: { containsRoomContent: false },
  } as const;

  const toQuery = (definitions?: Parameters<typeof visibleToRecipient>[1]) =>
    new SQLiteSyncDialect().sqlToQuery(
      definitions === undefined
        ? visibleToRecipient(userA)
        : visibleToRecipient(userA, definitions),
    );

  it("#124 AC-2: 定義が 0 件（本番の定義）のとき、本人宛てがすべて一覧と未読数に出る（部屋の条件が付かない）", async () => {
    await insertNotification({
      userId: userA,
      id: notificationIdAt(1_800_000_000_001),
      kind: "test_any_kind",
      roomId: "01JTESTNOTIFROOM0000000001",
    });
    await insertNotification({
      userId: userA,
      id: notificationIdAt(1_800_000_000_002),
      kind: "test_other_kind",
    });
    await insertNotification({
      userId: userB,
      id: notificationIdAt(1_800_000_000_003),
      kind: "test_any_kind",
    });
    const page = await repo(
      (r) => r.listForRecipient(userA, { limit: 20 }),
      {},
    );
    expect(page.items).toHaveLength(2);
    expect(await repo((r) => r.countUnread(userA), {})).toBe(2);
  });

  it.each([
    ["定義が空", {}],
    [
      "部屋の内容を含む種類がない",
      { test_plain_kind: { containsRoomContent: false } },
    ],
  ])(
    "#124 AC-2: %s なら、空の IN () を作らず、パラメーターは宛先だけ",
    (_label, definitions) => {
      const query = toQuery(definitions);
      expect(query.sql).not.toMatch(/\bin\s*\(\s*\)/i);
      expect(query.params).toEqual([userA]);
    },
  );

  it("#124 AC-2: 本番の定義（引数なし）でも、空の IN () を作らない", () => {
    const query = toQuery();
    expect(query.sql).not.toMatch(/\bin\s*\(\s*\)/i);
    expect(query.params).toContain(userA);
  });

  it("#124 AC-2: 部屋の内容を含む種類があっても、含まない種類の通知は部屋に関係なく本人宛てなら見える", async () => {
    await insertNotification({
      userId: userA,
      id: notificationIdAt(1_800_000_000_001),
      kind: "test_plain_kind",
      roomId: "01JTESTNOTIFROOM0000000009",
    });
    await insertNotification({
      userId: userA,
      id: notificationIdAt(1_800_000_000_002),
      kind: "test_plain_kind",
    });
    const page = await repo(
      (r) => r.listForRecipient(userA, { limit: 20 }),
      MIXED,
    );
    expect(page.items).toHaveLength(2);
    expect(await repo((r) => r.countUnread(userA), MIXED)).toBe(2);
  });

  it("#124 AC-2: 部屋の内容を含む種類の条件を差し込んでも SQL は実行でき、他人宛ては出ない", async () => {
    await insertNotification({
      userId: userB,
      id: notificationIdAt(1_800_000_000_001),
      kind: "test_room_kind",
      roomId: "01JTESTNOTIFROOM0000000001",
    });
    const page = await repo(
      (r) => r.listForRecipient(userA, { limit: 20 }),
      MIXED,
    );
    expect(page.items).toEqual([]);
    expect(await repo((r) => r.countUnread(userA), MIXED)).toBe(0);
  });

  it("#124 AC-1: markRead も同じ除外条件を通る。条件で隠れる通知（部屋の内容を含む種類で room_id が null）の ID は false で、read_at は変わらない", async () => {
    const hidden = await insertNotification({
      userId: userA,
      id: notificationIdAt(1_800_000_000_201),
      kind: "test_room_kind",
      roomId: null,
    });
    const shown = await insertNotification({
      userId: userA,
      id: notificationIdAt(1_800_000_000_202),
      kind: "test_room_kind",
      roomId: "01JTESTNOTIFROOM0000000001",
    });
    expect(await repo((r) => r.markRead(userA, hidden, NOW), MIXED)).toBe(
      false,
    );
    expect((await notificationRow(hidden))?.read_at).toBeNull();
    expect(await repo((r) => r.markRead(userA, shown, NOW), MIXED)).toBe(true);
    expect((await notificationRow(shown))?.read_at).toBe(NOW);
  });

  it("#124 AC-1: 一覧に出る未読の件数と未読数が、同じ条件のため必ず一致する（種類・部屋が混ざっていても）", async () => {
    const room = "01JTESTNOTIFROOM0000000001";
    const kinds = ["test_room_kind", "test_plain_kind", "test_room_kind"];
    for (const [i, kind] of kinds.entries())
      await insertNotification({
        userId: userA,
        id: notificationIdAt(1_800_000_000_100 + i),
        kind,
        roomId: i === 1 ? null : room,
      });
    const page = await repo(
      (r) => r.listForRecipient(userA, { limit: 100 }),
      MIXED,
    );
    const unreadVisible = page.items.filter((item) => item.readAt === null);
    expect(await repo((r) => r.countUnread(userA), MIXED)).toBe(
      unreadVisible.length,
    );
  });
});
