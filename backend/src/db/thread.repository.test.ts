// #137 AC-1（1-4 AC-4）: スレッドの一覧の Repository（thread.repository.ts）が、行の値を一覧の項目へ正しく写し、壊れた行を成功に見せないことを確かめる。
// 前半は本物の DB（隔離 D1）で、DM の相手と親の投稿者の有効・無効（isActive・authorIsActive）を確かめる。
// 後半は、SQL の結果を固定して返す偽の DB で、DB では作れない壊れた行（相手の情報の一部が欠けた DM・ULID でない ID・未読数の欠け）を作る。
// 期待：壊れた行は、成功の一覧として返さずに失敗させる（AGENTS.md「エラーをもみ消さない」・ADR-0006 のカーソル）。エラーの文言は固定しない（内部の例外）。
// データは架空（testuser_threpo_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deactivateUser, insertDm } from "../../test/dm-fixtures";
import {
  TEST_TAG,
  cleanupThreadScenario,
  createThreadWorld,
  idAt,
  isoAt,
  seedParent,
  seedReply,
  type ThreadWorld,
} from "../../test/thread-fixtures";
import { decodeCursor } from "../lib/cursor";
import type { Database } from "./database";
import { createThreadRepository, withThreads } from "./thread.repository";

describe("#137 AC-1（1-4 AC-4）スレッドの一覧の項目の有効・無効（本物の DB）", () => {
  let world: ThreadWorld;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    world = await createThreadWorld("threpo");
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupThreadScenario();
  });

  function listAsAlice() {
    return withThreads(env, (repository) =>
      repository.listThreads(world.alice.userId, {
        limit: 20,
        includeDirect: true,
      }),
    );
  }

  it("#137 AC-1（1-4 AC-4）: 当事者の DM で相手が有効なら、room.partner.isActive は true", async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const parent = await seedParent(dm, world.bob.userId, 1);
    await seedReply(dm, parent, world.alice.userId, 2);
    const page = await listAsAlice();
    expect(page.items.map((item) => item.room)).toEqual([
      {
        kind: "direct",
        id: dm,
        partner: {
          id: world.bob.userId,
          displayName: "テスト太郎",
          isActive: true,
        },
      },
    ]);
  });

  it("#137 AC-1（1-4 AC-4）: 親の投稿者が有効なら、parent.author.isActive は true", async () => {
    const parent = await seedParent(world.channel, world.bob.userId, 1);
    await seedReply(world.channel, parent, world.alice.userId, 2);
    const page = await listAsAlice();
    expect(page.items.map((item) => item.parent.id)).toEqual([parent]);
    expect(page.items[0]?.parent.author).toEqual({
      id: world.bob.userId,
      displayName: "テスト太郎",
      isActive: true,
    });
  });

  it("#137 AC-1（1-4 AC-4・#238）: 親の投稿者が無効でも一覧に含め、parent.author.isActive は false", async () => {
    const parent = await seedParent(world.channel, world.bob.userId, 1);
    await seedReply(world.channel, parent, world.alice.userId, 2);
    await deactivateUser(world.bob.userId);
    const page = await listAsAlice();
    expect(page.items.map((item) => item.parent.id)).toEqual([parent]);
    expect(page.items[0]?.parent.author.isActive).toBe(false);
  });
});

// ---- 偽の DB（SQL の結果を固定する） ----

const VIEWER = "testuser_threpo_viewer";
const PARTNER = "testuser_threpo_partner";
const ROOM = "testroom_threpo_dm";

/** スレッドの一覧の SQL（thread-list.sql.ts）が返す1行。既定は「当事者の DM で、相手が有効」 */
function threadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: idAt(1),
    room_id: ROOM,
    sender_id: PARTNER,
    sender_display_name: "テスト次郎",
    body: `${TEST_TAG}親1`,
    created_at: isoAt(1),
    edited_at: null,
    deleted_at: null,
    author_is_active: 1,
    reply_count: 1,
    last_reply_id: idAt(2),
    last_reply_at: isoAt(2),
    channel_name: null,
    joined_at: null,
    partner_id: PARTNER,
    partner_display_name: "テスト次郎",
    partner_is_active: 1,
    last_read_message_id: null,
    ...overrides,
  };
}

/**
 * 1回目の db.all はスレッドの一覧、2回目はスレッドごとの未読数（thread-unread-counts.sql.ts）の結果を返す偽の DB。
 * Repository は db.all だけを使う（SQL 2本）。
 */
function fakeDb(
  threadRows: readonly unknown[],
  unreadRows: readonly { parent_id: string; unread_count: number }[],
): Database {
  const results: unknown[][] = [[...threadRows], [...unreadRows]];
  return {
    async all() {
      const next = results.shift();
      if (next === undefined) throw new Error("想定より多くの SQL が呼ばれた");
      return next;
    },
  } as unknown as Database;
}

function listWith(
  threadRows: readonly unknown[],
  unreadRows: readonly { parent_id: string; unread_count: number }[],
  limit = 20,
) {
  return createThreadRepository(fakeDb(threadRows, unreadRows)).listThreads(
    VIEWER,
    { limit, includeDirect: true },
  );
}

describe("#137 AC-1（1-4 AC-4）壊れた行を成功の一覧に見せない（偽の DB）", () => {
  it("#137 AC-1（1-4 AC-4）: 相手の情報がそろった DM の行は、room を { kind: direct, id, partner } にし、未読数をそのまま返す", async () => {
    const page = await listWith(
      [threadRow()],
      [{ parent_id: idAt(1), unread_count: 3 }],
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.room).toEqual({
      kind: "direct",
      id: ROOM,
      partner: { id: PARTNER, displayName: "テスト次郎", isActive: true },
    });
    expect(page.items[0]?.unreadCount).toBe(3);
    expect(page.nextCursor).toBeNull();
  });

  it("#137 AC-1（1-4 AC-4）: 相手が無効（partner_is_active が 0）の DM の行は、partner.isActive が false", async () => {
    const page = await listWith(
      [threadRow({ partner_is_active: 0 })],
      [{ parent_id: idAt(1), unread_count: 0 }],
    );
    expect(page.items[0]?.room).toEqual({
      kind: "direct",
      id: ROOM,
      partner: { id: PARTNER, displayName: "テスト次郎", isActive: false },
    });
  });

  it.each([
    ["partner_id", { partner_id: null }],
    ["partner_display_name", { partner_display_name: null }],
    ["partner_is_active", { partner_is_active: null }],
    [
      "相手の情報すべて",
      { partner_id: null, partner_display_name: null, partner_is_active: null },
    ],
  ])(
    "#137 AC-1（1-4 AC-4）: チャンネルでも DM でもない行（チャンネル名がなく、DM の相手の %s が欠けている）は、一覧を返さずに失敗する",
    async (_label, overrides) => {
      await expect(
        listWith(
          [threadRow(overrides)],
          [{ parent_id: idAt(1), unread_count: 0 }],
        ),
      ).rejects.toBeInstanceOf(Error);
    },
  );

  it("#137 AC-1（1-4 AC-4・ADR-0006）: 続きがあるとき、nextCursor は（最後の項目の最後の返信の ID, 親の ID）を指す", async () => {
    const page = await listWith(
      [
        threadRow({ id: idAt(1), last_reply_id: idAt(4) }),
        threadRow({ id: idAt(2), last_reply_id: idAt(3) }),
      ],
      [{ parent_id: idAt(1), unread_count: 0 }],
      1,
    );
    expect(page.items.map((item) => item.parent.id)).toEqual([idAt(1)]);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor ?? "")).toEqual({
      v: idAt(4),
      id: idAt(1),
    });
  });

  it("#137 AC-1（1-4 AC-4・ADR-0006）: ページの最後の項目の ID が ULID でなければ、読み戻せないカーソルを作らずに失敗する", async () => {
    await expect(
      listWith(
        [
          threadRow({ id: "testmsg_threpo_not_ulid" }),
          threadRow({ id: idAt(2), last_reply_id: idAt(3) }),
        ],
        [{ parent_id: "testmsg_threpo_not_ulid", unread_count: 0 }],
        1,
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it("#137 AC-1（1-4 AC-4）: スレッドの未読数が取れなかった行があれば、未読数のない項目を返さずに失敗する", async () => {
    await expect(
      listWith(
        [threadRow({ id: idAt(1) })],
        [{ parent_id: idAt(5), unread_count: 0 }],
      ),
    ).rejects.toBeInstanceOf(Error);
  });
});
