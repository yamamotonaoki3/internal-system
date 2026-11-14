// #137 AC-1（1-4 AC-4・C-147・計画レビュー1回目 重大1）: スレッドの既読 markThreadRead の判定の順・権限の拒否と、
// 「確認から書き込み（条件付きの upsert）までの間」に状態が変わったときの再判定（upsert が 0 行のとき）を確かめる。
// 契約（実装者へ）：createUnreadService(readPositions, rooms, { authorizer }).markThreadRead(actor, parentMessageId, lastReadMessageId): Promise<void>
//   判定の順：見えるか（404）→ 親が返信でないか（404）→ 参加者か（403）→ authorize(perm.notification.own)（拒否は 403）→ readPositions.advanceThread(...)（条件付きの upsert。挿入・更新した行数 1 か 0 を返す）
//   → 0 行なら：見える・親・参加状態をもう一度確かめ（見えない・アーカイブ済み → 404、未参加 → 403）→ lastReadMessageId がこのスレッドの返信でなければ 404
//   → すでに同じかより新しい位置なら成功（204）→ どれでもなければ 409。部屋の判定を権限の確認より先に行うのは、403 で存在を教えないため。
// 方法：message.modify-race.test.ts と同じく、本物の Repository・D1 を使い、readPositions.advanceThread を包んで、本物を呼ぶ直前に DB の状態を変える。
// データは架空（testuser_thrrace_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { fakeAuthorizer } from "../../test/dm-fixtures";
import {
  archiveChannel,
  leaveChannel,
} from "../../test/message-modify-fixtures";
import {
  TEST_TAG,
  cleanupThreadScenario,
  createThreadWorld,
  insertThreadReadPosition,
  seedParent,
  seedReply,
  threadReadPositionOf,
  threadReadRows,
  type ThreadWorld,
} from "../../test/thread-fixtures";
import { withMessages } from "../db/message.repository";
import {
  withReadPositions,
  type ReadPositionRepository,
} from "../db/read-position.repository";
import type { Permission } from "../lib/permissions";
import { createUnreadService } from "./unread.service";

let world: ThreadWorld;
let parent: string;
let r1: string;
let r2: string;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("thrrace");
  parent = await seedParent(world.channel, world.alice.userId, 1);
  r1 = await seedReply(world.channel, parent, world.bob.userId, 2);
  r2 = await seedReply(world.channel, parent, world.dave.userId, 3);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupThreadScenario();
});

type Advance = ReadPositionRepository["advanceThread"];

/**
 * markThreadRead を呼び、成功なら null、失敗なら投げたエラーを返す。
 * beforeAdvance があれば、条件付きの upsert（advanceThread）の直前に実行する。permissions は authorize に渡された権限。
 */
async function mark(
  userId: string,
  parentId: string,
  lastReadMessageId: string,
  options: {
    denied?: readonly Permission[];
    beforeAdvance?: () => Promise<void>;
  } = {},
) {
  const authorizer = fakeAuthorizer(options.denied ?? []);
  const error = await withReadPositions(env, (readPositions) =>
    withMessages(env, (rooms) => {
      const wrapped = {
        ...readPositions,
        advanceThread: async (...args: Parameters<Advance>) => {
          await options.beforeAdvance?.();
          return readPositions.advanceThread(...args);
        },
      };
      return createUnreadService(wrapped, rooms, { authorizer })
        .markThreadRead(
          { userId, traceId: "unit-137-thread-read" },
          parentId,
          lastReadMessageId,
        )
        .then(
          () => null,
          (e: unknown) => e,
        );
    }),
  );
  return { error, permissions: authorizer.calls.map((c) => c.permission) };
}

describe("#137 AC-4 成功と、すでに新しい位置", () => {
  it("#137 AC-4: 参加者は既読にでき、perm.notification.own を判定して、位置が入る", async () => {
    const outcome = await mark(world.alice.userId, parent, r2);
    expect(outcome.error).toBeNull();
    expect(outcome.permissions).toContain("perm.notification.own");
    expect(await threadReadPositionOf(world.alice.userId, parent)).toBe(r2);
  });

  it("#137 AC-4（再判定 ③）: すでに新しい位置があるとき（upsert が 0 行）は、エラーにならず、位置は戻らない", async () => {
    await insertThreadReadPosition(world.alice.userId, parent, r2);
    const outcome = await mark(world.alice.userId, parent, r1);
    expect(outcome.error).toBeNull();
    expect(await threadReadPositionOf(world.alice.userId, parent)).toBe(r2);
  });

  it("#137 AC-4（再判定 ②）: このスレッドの返信でない ID（別のスレッドの返信）は 404 NOT_FOUND で、行を作らない", async () => {
    const otherParent = await seedParent(world.channel, world.bob.userId, 10);
    const foreign = await seedReply(
      world.channel,
      otherParent,
      world.dave.userId,
      11,
    );
    const outcome = await mark(world.alice.userId, parent, foreign);
    expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await threadReadRows()).toEqual([]);
  });
});

describe("#137 AC-4 判定の順と権限の拒否", () => {
  it("#137 AC-4（①）: 非公開で未参加のスレッドは、権限を拒否されていても 404 で、perm.notification.own を判定しない", async () => {
    const room = await insertChannel({
      name: `${TEST_TAG}既読順序の非公開`,
      purpose: "normal",
      departmentId: world.dept.id,
      visibility: "private",
    });
    await insertMember(room, world.bob.userId);
    const p = await seedParent(room, world.bob.userId, 10);
    const r = await seedReply(room, p, world.bob.userId, 11);
    const outcome = await mark(world.alice.userId, p, r, {
      denied: ["perm.notification.own"],
    });
    expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(outcome.permissions).not.toContain("perm.notification.own");
  });

  it("#137 AC-4（②）: 親が返信の ID なら、権限を拒否されていても 404", async () => {
    const outcome = await mark(world.alice.userId, r1, r2, {
      denied: ["perm.notification.own"],
    });
    expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(outcome.permissions).not.toContain("perm.notification.own");
  });

  it("#137 AC-4（③）: 未参加の公開チャンネルは 403 FORBIDDEN で、perm.notification.own を判定せず、行を作らない", async () => {
    const outcome = await mark(world.carol.userId, parent, r1);
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(outcome.permissions).not.toContain("perm.notification.own");
    expect(await threadReadRows()).toEqual([]);
  });

  it("#137 AC-4（④・R-55）: perm.notification.own を拒否されると、参加者でも 403 で、行を作らない", async () => {
    const outcome = await mark(world.alice.userId, parent, r1, {
      denied: ["perm.notification.own"],
    });
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(outcome.permissions).toContain("perm.notification.own");
    expect(await threadReadRows()).toEqual([]);
  });
});

describe("#137 AC-4（改訂1 重大1）確認から書き込みまでの間に状態が変わる（upsert が 0 行のときの再判定）", () => {
  it("#137 AC-4: 確認の後に公開チャンネルの参加を外すと 403 FORBIDDEN で、行を作らない", async () => {
    const outcome = await mark(world.alice.userId, parent, r1, {
      beforeAdvance: () => leaveChannel(world.channel, world.alice.userId),
    });
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await threadReadRows()).toEqual([]);
  });

  it("#137 AC-4: 確認の後にチャンネルがアーカイブされると 404 NOT_FOUND で、行を作らない", async () => {
    const outcome = await mark(world.alice.userId, parent, r1, {
      beforeAdvance: () => archiveChannel(world.channel),
    });
    expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await threadReadRows()).toEqual([]);
  });

  it("#137 AC-4（対照）: 割り込みがなければ、同じ組み立てで位置が書き込まれる（上の拒否が書き込みの条件によるものであることの確認）", async () => {
    const outcome = await mark(world.alice.userId, parent, r1, {
      beforeAdvance: async () => {},
    });
    expect(outcome.error).toBeNull();
    expect(await threadReadPositionOf(world.alice.userId, parent)).toBe(r1);
  });
});
