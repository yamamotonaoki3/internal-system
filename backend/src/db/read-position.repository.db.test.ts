// #237 AC-1〜AC-4（3-1 AC-1〜AC-3・ADR-0006・C-169）：既読位置の Repository（db/read-position.repository.ts）を、隔離 D1 で直接呼んで確かめる。
// 期待値は要件・計画の数字（99・100・「100で打ち切り」、参加の前は数えない、自分の投稿は数えない）から決める。本番の定数から作らない。
// 契約（実装者へ。計画「変更するファイル」・改訂2 B・改訂4-3）：
//   createReadPositionRepository(db: Database) が次を返す
//     listUnread(userId, { limit: number; cursor?: CursorPayload }): Promise<{ items: { roomId: string; count: number }[]; nextCursor: string | null }>
//        対象の部屋（参加中・未アーカイブのチャンネルと、当事者の DM）を room_id の昇順で limit 件調べ、未読が1件以上の部屋だけを返す。
//        count は 1〜100（100 で打ち切り）。下限は既読位置と参加の時刻の大きい方（DM は既読位置だけ）。自分の投稿は数えない。
//        nextCursor は「対象の部屋」の limit 件目から作る（items が空でも nextCursor がありうる）。カーソルは decodeCursor で戻せる形。
//        SQL の数は部屋の数に比例しない。
//     advance({ userId, roomId, messageId, now }): Promise<number>  既読位置を前に進めた行数（1 か 0）。1文の条件付き upsert。
//        メッセージがその部屋にあり、参加中・未アーカイブのチャンネルか当事者の DM のときだけ。古い・同じ ID では変えない（0）。updated_at は now。
//     messageExistsInRoom(roomId, messageId): Promise<boolean>
//   withReadPositions(env, run) も公開する。
// データは架空（testuser_rprepo_、テスト太郎、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import {
  DEPT_NOW,
  insertChannel,
  insertMember,
} from "../../test/department-fixtures";
import { cleanupDmScenario, insertDm } from "../../test/dm-fixtures";
import {
  insertMessagesAt,
  insertReadPosition,
  joinAt,
  readPositionOf,
  readPositionRows,
  removeMember,
  setArchived,
  setJoinedAt,
  ulidAtMs,
} from "../../test/read-position-fixtures";
import {
  TEST_TAG,
  insertDepartment,
  insertUser,
  testId,
} from "../../test/role-fixtures";
import { decodeCursor } from "../lib/cursor";
import { withDatabase } from "./database";
import { listUnreadCountRows } from "./unread-counts.sql";
import {
  createReadPositionRepository,
  withReadPositions,
} from "./read-position.repository";

/** insertMember が入れる参加の時刻（DEPT_NOW）のミリ秒 */
const JOINED_MS = Date.parse(DEPT_NOW);
/** 参加の後の投稿の開始の時刻 */
const AFTER_JOIN_MS = JOINED_MS + 60_000;
/** 参加の前の投稿の開始の時刻（150件入れても参加の前に収まる） */
const BEFORE_JOIN_MS = JOINED_MS - 10 * 60_000;

let deptId: string;
let viewer: string;
let other: string;
let third: string;

type Unread = { roomId: string; count: number };

const repo = <T>(
  run: (r: ReturnType<typeof createReadPositionRepository>) => Promise<T>,
) => withReadPositions(env, run);

/** 全ページを取り、未読の部屋を1つの配列にする（ページの数も返す） */
async function allUnread(userId: string, limit = 100) {
  const items: Unread[] = [];
  let cursor: string | null = null;
  for (let pages = 1; pages <= 50; pages += 1) {
    const page: { items: Unread[]; nextCursor: string | null } = await repo(
      (r) =>
        r.listUnread(
          userId,
          cursor === null ? { limit } : { limit, cursor: decodeCursor(cursor) },
        ),
    );
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return { items, pages };
  }
  throw new Error("未読の一覧のページが終わりませんでした");
}

async function unreadMap(userId: string) {
  const { items } = await allUnread(userId);
  return new Map(items.map((item) => [item.roomId, item.count]));
}

async function newChannel(
  label: string,
  options: {
    visibility?: "public" | "private";
    id?: string;
    archived?: boolean;
  } = {},
) {
  return insertChannel({
    name: `${TEST_TAG}未読${label}`,
    purpose: "normal",
    departmentId: deptId,
    ...options,
  });
}

/** 参加中のチャンネル（参加の時刻は DEPT_NOW） */
async function joinedChannel(label: string, id?: string) {
  const roomId = await newChannel(label, id === undefined ? {} : { id });
  await insertMember(roomId, viewer);
  return roomId;
}

beforeEach(async () => {
  deptId = await insertDepartment("未読リポジトリ");
  viewer = await insertUser("testuser_rprepo_viewer", deptId);
  other = await insertUser("testuser_rprepo_other", deptId);
  third = await insertUser("testuser_rprepo_third", deptId);
});

afterEach(async () => {
  await cleanupDmScenario();
});

describe("#237 AC-1・AC-4 未読数：上限つきで数え直す（3-1 AC-1・ADR-0006）", () => {
  it("#237 AC-1: 他人の未読が 0・1・99・100・101 件の部屋は、項目なし・1・99・100・100（100で打ち切り）", async () => {
    const counts = [0, 1, 99, 100, 101];
    const rooms: string[] = [];
    for (const [i, n] of counts.entries()) {
      const roomId = await joinedChannel(`件数${i}`);
      rooms.push(roomId);
      await insertMessagesAt(roomId, other, AFTER_JOIN_MS + i * 1000, n);
    }
    const unread = await unreadMap(viewer);
    expect(unread.has(rooms[0] ?? "")).toBe(false);
    expect(unread.get(rooms[1] ?? "")).toBe(1);
    expect(unread.get(rooms[2] ?? "")).toBe(99);
    expect(unread.get(rooms[3] ?? "")).toBe(100);
    expect(unread.get(rooms[4] ?? "")).toBe(100);
    expect(unread.size).toBe(4);
  });

  it("#237 AC-1: 未読の部屋は room_id の昇順で返り、count は 0 の項目を含まない", async () => {
    const ids = [
      "01JRPREPXSRT00000000000003",
      "01JRPREPXSRT00000000000001",
      "01JRPREPXSRT00000000000002",
    ];
    for (const [i, id] of ids.entries()) {
      await joinedChannel(`並び${i}`, id);
      await insertMessagesAt(id, other, AFTER_JOIN_MS + i * 1000, i + 1);
    }
    const { items } = await allUnread(viewer);
    expect(items).toEqual([
      { roomId: "01JRPREPXSRT00000000000001", count: 2 },
      { roomId: "01JRPREPXSRT00000000000002", count: 3 },
      { roomId: "01JRPREPXSRT00000000000003", count: 1 },
    ]);
  });

  it("#237 AC-1: 部屋が多くても、挿入順・件数の大小に関わらず、各ページの items は room_id の昇順で返る（対象の部屋を取る SQL の ORDER BY と、渡した配列の順を保つことの両方を通した結果。DAO 単独の順は別のテストで確かめる）", async () => {
    const total = 12;
    const idOf = (n: number) =>
      `01JRPREPXSRM${String(n).padStart(14, "0")}`.slice(0, 26);
    // room_id の降順に作り、件数は昇順の位置と逆相関にする（対象の部屋を取る SQL の ORDER BY が崩れると、ここで昇順にならない）
    for (let n = total; n >= 1; n -= 1) {
      const id = idOf(n);
      await joinedChannel(`順序${n}`, id);
      await insertMessagesAt(id, other, AFTER_JOIN_MS + n * 1000, (n % 5) + 1);
    }
    const expected = Array.from({ length: total }, (_, i) => idOf(i + 1));
    const all = await allUnread(viewer);
    expect(all.items.map((item) => item.roomId)).toEqual(expected);
    const paged = await allUnread(viewer, 5);
    expect(paged.pages).toBeGreaterThan(1);
    expect(paged.items.map((item) => item.roomId)).toEqual(expected);
  });

  it("#237 AC-1: 既読位置より後のメッセージだけを数える（既読位置のメッセージ自身は数えない）", async () => {
    const roomId = await joinedChannel("既読の後");
    const ids = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 100);
    await insertReadPosition(viewer, roomId, ids[49] ?? "");
    expect((await unreadMap(viewer)).get(roomId)).toBe(50);
    await env.DB.prepare(
      "UPDATE read_positions SET last_read_message_id = ? WHERE user_id = ? AND room_id = ?",
    )
      .bind(ids[99] ?? "", viewer, roomId)
      .run();
    expect((await unreadMap(viewer)).has(roomId)).toBe(false);
  });

  it("#237 AC-1（C-169 (3)）: 自分の投稿は数えない。自分の投稿だけの部屋は項目なし、混在はほかの人の分だけ", async () => {
    const ownOnly = await joinedChannel("自分だけ");
    await insertMessagesAt(ownOnly, viewer, AFTER_JOIN_MS, 5);
    const mixed = await joinedChannel("混在");
    await insertMessagesAt(mixed, viewer, AFTER_JOIN_MS, 5);
    await insertMessagesAt(mixed, other, AFTER_JOIN_MS + 100, 2);
    await insertMessagesAt(mixed, third, AFTER_JOIN_MS + 200, 1);
    await insertMessagesAt(mixed, viewer, AFTER_JOIN_MS + 300, 4);
    const unread = await unreadMap(viewer);
    expect(unread.has(ownOnly)).toBe(false);
    expect(unread.get(mixed)).toBe(3);
  });

  it("#237 AC-1（C-169 (3)）: 自分の投稿が既読位置の後に100件以上あっても、他人の投稿は打ち切られずに数える", async () => {
    const roomId = await joinedChannel("自分の大量の投稿");
    await insertMessagesAt(roomId, viewer, AFTER_JOIN_MS, 120);
    await insertMessagesAt(roomId, other, AFTER_JOIN_MS + 1000, 3);
    expect((await unreadMap(viewer)).get(roomId)).toBe(3);
  });

  it("#237 AC-1: チャンネルと DM の両方が出る", async () => {
    const channel = await joinedChannel("両方");
    await insertMessagesAt(channel, other, AFTER_JOIN_MS, 2);
    const dm = await insertDm(viewer, other);
    await insertMessagesAt(dm, other, AFTER_JOIN_MS, 3);
    const unread = await unreadMap(viewer);
    expect(unread.get(channel)).toBe(2);
    expect(unread.get(dm)).toBe(3);
  });
});

describe("#237 AC-1（C-169 (2)）既読位置がない部屋は、参加した後のメッセージだけ数える", () => {
  it("#237 AC-1: 参加の前の投稿（150件）は数えず、参加の後の 0・1・99・100・101 件は 項目なし・1・99・100・100", async () => {
    const counts = [0, 1, 99, 100, 101];
    const rooms: string[] = [];
    for (const [i, n] of counts.entries()) {
      const roomId = await joinedChannel(`参加の後${i}`);
      rooms.push(roomId);
      await insertMessagesAt(roomId, other, BEFORE_JOIN_MS, 150);
      await insertMessagesAt(roomId, other, AFTER_JOIN_MS, n);
    }
    const unread = await unreadMap(viewer);
    expect(unread.has(rooms[0] ?? "")).toBe(false);
    expect(unread.get(rooms[1] ?? "")).toBe(1);
    expect(unread.get(rooms[2] ?? "")).toBe(99);
    expect(unread.get(rooms[3] ?? "")).toBe(100);
    expect(unread.get(rooms[4] ?? "")).toBe(100);
  });

  it("#237 AC-1: 参加と同じミリ秒の時刻部分を持つ ID は数え、参加の1ミリ秒前の ID は数えない", async () => {
    const roomId = await joinedChannel("同じミリ秒");
    const joinedMs = Date.parse("2026-11-13T00:00:00.000Z");
    await setJoinedAt(roomId, viewer, "2026-11-13T00:00:00.000Z");
    await insertMessagesAt(roomId, other, joinedMs - 1, 1);
    expect((await unreadMap(viewer)).has(roomId)).toBe(false);
    await insertMessagesAt(roomId, other, joinedMs, 1);
    expect((await unreadMap(viewer)).get(roomId)).toBe(1);
  });

  it("#237 AC-1: 抜けて入り直した：古い既読位置（最初の参加の後）より後でも、抜けている間の投稿は数えず、入り直した後だけ数える", async () => {
    const roomId = await joinedChannel("入り直し");
    const first = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 3);
    await insertReadPosition(viewer, roomId, first[2] ?? "");
    await removeMember(roomId, viewer);
    // 抜けている間の投稿（5件）
    await insertMessagesAt(roomId, other, AFTER_JOIN_MS + 10_000, 5);
    const rejoinMs = AFTER_JOIN_MS + 60_000;
    await joinAt(roomId, viewer, new Date(rejoinMs).toISOString());
    expect((await unreadMap(viewer)).has(roomId)).toBe(false);
    await insertMessagesAt(roomId, other, rejoinMs + 1000, 2);
    expect((await unreadMap(viewer)).get(roomId)).toBe(2);
  });

  it("#237 AC-1: 入り直した後に既読位置を進めていれば、既読位置から数える", async () => {
    const roomId = await joinedChannel("入り直しの後の既読");
    const rejoinMs = AFTER_JOIN_MS + 60_000;
    await setJoinedAt(roomId, viewer, new Date(rejoinMs).toISOString());
    const after = await insertMessagesAt(roomId, other, rejoinMs + 1000, 6);
    await insertReadPosition(viewer, roomId, after[3] ?? "");
    expect((await unreadMap(viewer)).get(roomId)).toBe(2);
  });

  it("#237 AC-1: DM は既読位置がなければ全件を数える（上限100）", async () => {
    const dm = await insertDm(viewer, other);
    await insertMessagesAt(dm, other, BEFORE_JOIN_MS, 101);
    expect((await unreadMap(viewer)).get(dm)).toBe(100);
    const small = await insertDm(viewer, third);
    await insertMessagesAt(small, third, BEFORE_JOIN_MS, 7);
    expect((await unreadMap(viewer)).get(small)).toBe(7);
  });
});

describe("#237 AC-1（1-1 AC-2・C-94）未読の対象は、参加中のチャンネルと当事者の DM だけ", () => {
  it("#237 AC-1: 未参加の公開チャンネル・未参加の非公開チャンネル・他人同士の DM・アーカイブ済み（参加中でも）は出ない", async () => {
    const publicUnjoined = await newChannel("未参加の公開");
    await insertMember(publicUnjoined, other);
    const privateUnjoined = await newChannel("未参加の非公開", {
      visibility: "private",
    });
    await insertMember(privateUnjoined, other);
    const othersDm = await insertDm(other, third);
    const archived = await joinedChannel("アーカイブ済み");
    await setArchived(archived, true);
    for (const roomId of [publicUnjoined, privateUnjoined, othersDm, archived])
      await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 3);
    const joined = await joinedChannel("参加中");
    await insertMessagesAt(joined, other, AFTER_JOIN_MS, 1);
    const { items } = await allUnread(viewer);
    expect(items).toEqual([{ roomId: joined, count: 1 }]);
  });

  it("#237 AC-1: 参加中の非公開チャンネルは出る", async () => {
    const roomId = await newChannel("参加中の非公開", {
      visibility: "private",
    });
    await insertMember(roomId, viewer);
    await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 4);
    expect((await unreadMap(viewer)).get(roomId)).toBe(4);
  });

  it("#237 AC-1: 他人の未読は自分の一覧に出ない（同じ部屋でも、利用者ごとに数える）", async () => {
    const roomId = await joinedChannel("利用者ごと");
    await insertMember(roomId, other);
    const ids = await insertMessagesAt(roomId, third, AFTER_JOIN_MS, 4);
    await insertReadPosition(other, roomId, ids[3] ?? "");
    expect((await unreadMap(viewer)).get(roomId)).toBe(4);
    expect((await unreadMap(other)).has(roomId)).toBe(false);
  });
});

describe("#237 AC-3（3-1 AC-3）閲覧権限を失った部屋は未読の対象から外れる。既読位置の行は消さない", () => {
  it("#237 AC-3: 参加の行を消すと未読から消え、read_positions の行は残る。参加し直すと、残っていた既読位置から数える", async () => {
    const roomId = await joinedChannel("外れる");
    const ids = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 10);
    await insertReadPosition(viewer, roomId, ids[6] ?? "");
    expect((await unreadMap(viewer)).get(roomId)).toBe(3);
    await removeMember(roomId, viewer);
    expect((await unreadMap(viewer)).has(roomId)).toBe(false);
    expect(await readPositionOf(viewer, roomId)).toBe(ids[6]);
    // 参加の時刻が既読位置より前の参加し直し（下限は既読位置）
    await joinAt(roomId, viewer, DEPT_NOW);
    expect((await unreadMap(viewer)).get(roomId)).toBe(3);
  });

  it("#237 AC-3: アーカイブで消え、アーカイブを戻すと再び出る。既読位置の行は残る", async () => {
    const roomId = await joinedChannel("アーカイブの往復");
    const ids = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 5);
    await insertReadPosition(viewer, roomId, ids[0] ?? "");
    await setArchived(roomId, true);
    expect((await unreadMap(viewer)).has(roomId)).toBe(false);
    expect(await readPositionOf(viewer, roomId)).toBe(ids[0]);
    await setArchived(roomId, false);
    expect((await unreadMap(viewer)).get(roomId)).toBe(4);
  });
});

describe("#237 AC-1 ページ送り（対象の部屋の room_id でカーソル。改訂4-3）", () => {
  const roomIdAt = (n: number) => `01JRPREPXPAGE${String(n).padStart(13, "0")}`;

  it("#237 AC-1: limit=1 で「未読なし → 未読あり」の順の部屋：1ページ目は items が空で nextCursor があり、続きで未読ありの部屋が出て、最後は nextCursor が null", async () => {
    const empty = await joinedChannel("頁の未読なし", roomIdAt(1));
    const unread = await joinedChannel("頁の未読あり", roomIdAt(2));
    await insertMessagesAt(unread, other, AFTER_JOIN_MS, 2);
    expect(empty < unread).toBe(true);
    const first = await repo((r) => r.listUnread(viewer, { limit: 1 }));
    expect(first.items).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const second = await repo((r) =>
      r.listUnread(viewer, {
        limit: 1,
        cursor: decodeCursor(first.nextCursor ?? ""),
      }),
    );
    expect(second.items).toEqual([{ roomId: unread, count: 2 }]);
    expect(second.nextCursor).toBeNull();
  });

  it("#237 AC-1: 対象の部屋がちょうど limit 件なら nextCursor は null", async () => {
    for (let n = 1; n <= 3; n += 1) {
      const roomId = await joinedChannel(`頁ちょうど${n}`, roomIdAt(10 + n));
      await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 1);
    }
    const page = await repo((r) => r.listUnread(viewer, { limit: 3 }));
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it("#237 AC-1: 全ページを通して、未読の部屋に欠け・重なりがない（チャンネルと DM が混ざり、未読なしの部屋が間にある）", async () => {
    const expected: Unread[] = [];
    // チャンネルは 22・24・…・34、DM は 25（チャンネルの間に入る）
    for (let n = 1; n <= 7; n += 1) {
      const roomId = await joinedChannel(`頁全体${n}`, roomIdAt(20 + 2 * n));
      if (n % 3 !== 0) {
        await insertMessagesAt(roomId, other, AFTER_JOIN_MS + n * 1000, n);
        expected.push({ roomId, count: n });
      }
    }
    const dm = await insertDm(viewer, other, { roomId: roomIdAt(25) });
    await insertMessagesAt(dm, other, AFTER_JOIN_MS, 1);
    expected.push({ roomId: dm, count: 1 });
    expected.sort((x, y) => (x.roomId < y.roomId ? -1 : 1));
    for (const limit of [1, 2, 3, 100]) {
      const { items } = await allUnread(viewer, limit);
      expect(items, `limit=${limit}`).toEqual(expected);
    }
  });
});

/** 実行した SQL（prepare）と、その値（bind）を記録する D1 で Repository を作る */
function recordingRepository() {
  const statements: { sql: string; params: unknown[] }[] = [];
  const client = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare")
        return (query: string) => {
          const entry = { sql: query, params: [] as unknown[] };
          statements.push(entry);
          const prepared = target.prepare(query);
          return new Proxy(prepared, {
            get(stmt, key) {
              if (key === "bind")
                return (...values: unknown[]) => {
                  entry.params = values;
                  return stmt.bind(...values);
                };
              const value: unknown = Reflect.get(stmt, key, stmt);
              return typeof value === "function" ? value.bind(stmt) : value;
            },
          });
        };
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    repository: createReadPositionRepository(drizzle(client, { schema })),
    statements,
  };
}

/** EXPLAIN QUERY PLAN の各行の detail */
async function planOf(statement: { sql: string; params: unknown[] }) {
  const { results } = await env.DB.prepare(
    `EXPLAIN QUERY PLAN ${statement.sql}`,
  )
    .bind(...statement.params)
    .all<{ detail: string }>();
  return results.map((row) => row.detail);
}

/** 表を索引なしで頭から読む行（CO-ROUTINE・MATERIALIZE の中間結果と json_each を読む行は除く） */
function fullScans(details: string[]): string[] {
  const intermediate = new Set(
    details
      .map((detail) => /^(?:CO-ROUTINE|MATERIALIZE) (\S+)/.exec(detail)?.[1])
      .filter((name): name is string => name !== undefined),
  );
  return details.filter((detail) => {
    const scanned = /^SCAN (\S+)/.exec(detail)?.[1];
    if (scanned === undefined) return false;
    if (detail.includes(" USING ")) return false;
    if (/json_each/.test(detail)) return false;
    if (scanned.startsWith("(subquery")) return false;
    return !intermediate.has(scanned);
  });
}

describe("#237 AC-4 SQL の数と索引（N+1 にしない。EXPLAIN QUERY PLAN）", () => {
  it("#237 AC-4: 部屋の数（1・10・30）で、未読の取得の SQL の数が変わらない", async () => {
    const counted: number[] = [];
    let made = 0;
    for (const target of [1, 10, 30]) {
      for (; made < target; made += 1) {
        const roomId = await joinedChannel(`N+1の${made}`);
        await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 1);
      }
      const recording = recordingRepository();
      const page = await recording.repository.listUnread(viewer, {
        limit: 100,
      });
      expect(page.items).toHaveLength(target);
      counted.push(recording.statements.length);
    }
    expect(counted[0]).toBeGreaterThan(0);
    expect(new Set(counted).size).toBe(1);
  });

  it("#237 AC-4: 参加の前の履歴が1,000件ある部屋でも、messages は messages_room_id_id_idx (room_id=? AND id>?) の範囲で読み、表を頭から読む行がない。read_positions は主キーの索引で引く", async () => {
    const channel = await joinedChannel("EXPLAINのチャンネル");
    await insertMessagesAt(channel, other, BEFORE_JOIN_MS - 1000 * 1000, 1000);
    await insertMessagesAt(channel, other, AFTER_JOIN_MS, 3);
    const read = await joinedChannel("EXPLAINの既読あり");
    const readIds = await insertMessagesAt(read, other, AFTER_JOIN_MS, 3);
    await insertReadPosition(viewer, read, readIds[0] ?? "");
    const dm = await insertDm(viewer, other);
    await insertMessagesAt(dm, other, AFTER_JOIN_MS, 2);

    const recording = recordingRepository();
    const page = await recording.repository.listUnread(viewer, { limit: 100 });
    expect(page.items.map((item: Unread) => item.count).sort()).toEqual([
      2, 2, 3,
    ]);

    const plans: string[][] = [];
    for (const statement of recording.statements)
      plans.push(await planOf(statement));
    const all = plans.flat();
    expect(
      all.some((detail) =>
        /USING (?:COVERING )?INDEX messages_room_id_id_idx \(room_id=\? AND id>\?\)/.test(
          detail,
        ),
      ),
      all.join("\n"),
    ).toBe(true);
    expect(
      all.some((detail) =>
        detail.includes("sqlite_autoindex_read_positions_1"),
      ),
      all.join("\n"),
    ).toBe(true);
    for (const details of plans)
      expect(fullScans(details), details.join("\n")).toEqual([]);
  });
});

describe("#237 AC-2 既読位置を進める（条件付きの upsert。後戻りしない）", () => {
  const NOW1 = "2026-11-13T01:00:00.000Z";
  const NOW2 = "2026-11-13T02:00:00.000Z";

  async function updatedAtOf(userId: string, roomId: string) {
    const row = await env.DB.prepare(
      "SELECT updated_at FROM read_positions WHERE user_id = ? AND room_id = ?",
    )
      .bind(userId, roomId)
      .first<{ updated_at: string }>();
    return row?.updated_at ?? null;
  }

  it("#237 AC-2: 行がなければ作り、新しい ID で前に進む（どちらも 1）。updated_at は now", async () => {
    const roomId = await joinedChannel("前進");
    const ids = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 3);
    expect(
      await repo((r) =>
        r.advance({
          userId: viewer,
          roomId,
          messageId: ids[0] ?? "",
          now: NOW1,
        }),
      ),
    ).toBe(1);
    expect(await readPositionOf(viewer, roomId)).toBe(ids[0]);
    expect(await updatedAtOf(viewer, roomId)).toBe(NOW1);
    expect(
      await repo((r) =>
        r.advance({
          userId: viewer,
          roomId,
          messageId: ids[2] ?? "",
          now: NOW2,
        }),
      ),
    ).toBe(1);
    expect(await readPositionOf(viewer, roomId)).toBe(ids[2]);
    expect(await updatedAtOf(viewer, roomId)).toBe(NOW2);
  });

  it("#237 AC-2: 古い ID・同じ ID では変わらない（0。updated_at も変わらない）", async () => {
    const roomId = await joinedChannel("後戻りなし");
    const ids = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 3);
    await repo((r) =>
      r.advance({ userId: viewer, roomId, messageId: ids[1] ?? "", now: NOW1 }),
    );
    for (const messageId of [ids[0] ?? "", ids[1] ?? ""])
      expect(
        await repo((r) =>
          r.advance({ userId: viewer, roomId, messageId, now: NOW2 }),
        ),
      ).toBe(0);
    expect(await readPositionOf(viewer, roomId)).toBe(ids[1]);
    expect(await updatedAtOf(viewer, roomId)).toBe(NOW1);
  });

  it.each([
    ["古い → 新しい", [0, 9]],
    ["新しい → 古い", [9, 0]],
  ])(
    "#237 AC-2: 同時に送っても（%s）、最後に残るのは新しい ID",
    async (_label, order) => {
      const roomId = await joinedChannel(`同時${order.join("")}`);
      const ids = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 10);
      await Promise.all(
        order.map((i) =>
          repo((r) =>
            r.advance({
              userId: viewer,
              roomId,
              messageId: ids[i] ?? "",
              now: NOW1,
            }),
          ),
        ),
      );
      expect(await readPositionOf(viewer, roomId)).toBe(ids[9]);
    },
  );

  it("#237 AC-2: 別の部屋のメッセージ ID・存在しない ID では行ができない（0）", async () => {
    const roomId = await joinedChannel("別の部屋のID");
    const elsewhere = await joinedChannel("別の部屋");
    const [foreign] = await insertMessagesAt(
      elsewhere,
      other,
      AFTER_JOIN_MS,
      1,
    );
    await insertMessagesAt(roomId, other, AFTER_JOIN_MS + 1000, 1);
    for (const messageId of [foreign ?? "", ulidAtMs(AFTER_JOIN_MS + 5000)])
      expect(
        await repo((r) =>
          r.advance({ userId: viewer, roomId, messageId, now: NOW1 }),
        ),
      ).toBe(0);
    expect(await readPositionOf(viewer, roomId)).toBeNull();
  });

  it("#237 AC-2: 未参加の公開・未参加の非公開・アーカイブ済み（参加中）・他人の DM では行ができない（0）。当事者の DM はできる（1）", async () => {
    const publicUnjoined = await newChannel("既読の未参加の公開");
    const privateUnjoined = await newChannel("既読の未参加の非公開", {
      visibility: "private",
    });
    const archived = await joinedChannel("既読のアーカイブ");
    await setArchived(archived, true);
    const othersDm = await insertDm(other, third);
    for (const roomId of [
      publicUnjoined,
      privateUnjoined,
      archived,
      othersDm,
    ]) {
      const [messageId] = await insertMessagesAt(
        roomId,
        other,
        AFTER_JOIN_MS,
        1,
      );
      expect(
        await repo((r) =>
          r.advance({
            userId: viewer,
            roomId,
            messageId: messageId ?? "",
            now: NOW1,
          }),
        ),
        roomId,
      ).toBe(0);
    }
    expect(await readPositionRows()).toEqual([]);
    const ownDm = await insertDm(viewer, other);
    const [dmMessage] = await insertMessagesAt(ownDm, other, AFTER_JOIN_MS, 1);
    expect(
      await repo((r) =>
        r.advance({
          userId: viewer,
          roomId: ownDm,
          messageId: dmMessage ?? "",
          now: NOW1,
        }),
      ),
    ).toBe(1);
  });

  it("#237 AC-2: 既読にすると、その部屋の未読が一覧から消え、その後の新着だけが数えられる", async () => {
    const roomId = await joinedChannel("既読で消える");
    const ids = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 4);
    expect((await unreadMap(viewer)).get(roomId)).toBe(4);
    await repo((r) =>
      r.advance({ userId: viewer, roomId, messageId: ids[3] ?? "", now: NOW1 }),
    );
    expect((await unreadMap(viewer)).has(roomId)).toBe(false);
    await insertMessagesAt(roomId, other, AFTER_JOIN_MS + 10_000, 2);
    expect((await unreadMap(viewer)).get(roomId)).toBe(2);
  });
});

describe("#237 AC-2 messageExistsInRoom", () => {
  it("#237 AC-2: その部屋のメッセージなら true、別の部屋のメッセージ・存在しない ID は false", async () => {
    const roomId = await joinedChannel("存在の確認");
    const elsewhere = await joinedChannel("存在の確認の別の部屋");
    const [own] = await insertMessagesAt(roomId, other, AFTER_JOIN_MS, 1);
    const [foreign] = await insertMessagesAt(
      elsewhere,
      other,
      AFTER_JOIN_MS,
      1,
    );
    await withDatabase(env, async (db) => {
      const r = createReadPositionRepository(db);
      expect(await r.messageExistsInRoom(roomId, own ?? "")).toBe(true);
      expect(await r.messageExistsInRoom(roomId, foreign ?? "")).toBe(false);
      expect(await r.messageExistsInRoom(roomId, testId("NOMSG"))).toBe(false);
    });
  });
});

describe("#237 AC-1 DAO（listUnreadCountRows）は渡された部屋の順のまま返す", () => {
  it("#237 AC-1: room_id の昇順でない順（降順・入れ替え）の配列を直接渡すと、渡した順のまま返る（ORDER BY json_each.key の確認）", async () => {
    const ids = [
      "01JRPREPXDAO00000000000003",
      "01JRPREPXDAO00000000000001",
      "01JRPREPXDAO00000000000004",
      "01JRPREPXDAO00000000000002",
    ];
    for (const [i, id] of ids.entries()) {
      await joinedChannel(`DAO${i}`, id);
      await insertMessagesAt(id, other, AFTER_JOIN_MS + i * 1000, i + 1);
    }
    const rows = await withDatabase(env, (db) =>
      listUnreadCountRows(
        db,
        viewer,
        ids.map((roomId) => ({ roomId, lower: "" })),
      ),
    );
    expect(rows).toEqual([
      { roomId: ids[0], count: 1 },
      { roomId: ids[1], count: 2 },
      { roomId: ids[2], count: 3 },
      { roomId: ids[3], count: 4 },
    ]);
  });
});
