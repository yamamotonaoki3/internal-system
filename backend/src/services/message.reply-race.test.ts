// #137 AC-1・AC-2（1-4 AC-1・AC-2・C-59）（壊すテスト）: 返信の「確認から書き込みまでの間」に状態が変わったとき、本物の条件付きの INSERT（隔離 D1）が書き込みを拒み、
// Service が読み直して原因に合う応答（404・403・409）にすることを確かめる。message.modify-race.test.ts と同じ作り：
// 書き込みの直前に割り込むため、本物の Repository の insertReplyIfOrdered を包み、呼ばれたら先に DB の状態を変えてから本物を呼ぶ。判定（①〜⑥）は本物の Repository・authorizer で行う。
// 契約（実装者へ。計画 決めたこと4⑦）：insertReplyIfOrdered が 0 行のときは ①〜⑥ を読み直し、どれにも当たらなければ ID が部屋の最大以下だったとして、
//   最大より大きい ID（maxId は返信を含む部屋全体の最大）で作り直して再試行する（上限あり。超えたら 503 SERVICE_UNAVAILABLE）。
// データは架空（testuser_replyrace_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deactivateUser, insertDm } from "../../test/dm-fixtures";
import { insertMessage } from "../../test/message-fixtures";
import {
  archiveChannel,
  leaveChannel,
  markDeleted,
} from "../../test/message-modify-fixtures";
import {
  TEST_TAG,
  cleanupThreadScenario,
  createThreadWorld,
  ulidAtMs,
  replyRows,
  roomRowCount,
  seedParent,
  type ThreadWorld,
} from "../../test/thread-fixtures";
import { withMessages, type MessageRepository } from "../db/message.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";
import { createMessageService } from "./message.service";

let world: ThreadWorld;
const BODY = `${TEST_TAG}割り込みの返信`;
/** 最初の1回＋再試行の上限（message.service.retry.test.ts と同じ前提：呼び出しは4回以内） */
const LAST_CALL = 4;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("replyrace");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupThreadScenario();
});

type Insert = MessageRepository["insertReplyIfOrdered"];
/** call 回目の書き込みで呼ばれる。writeReal() が本物の条件付きの INSERT（挿入した行数を返す） */
type Wrap = (
  call: number,
  writeReal: () => ReturnType<Insert>,
) => Promise<number>;

/** insertReplyIfOrdered を wrap に差し替えた Service で、bob が親に返信し、成功の値か投げたエラーと、書き込みの呼び出し回数を返す */
async function postWith(parentId: string, wrap: Wrap) {
  let calls = 0;
  const outcome = await withMessages(env, (repository) =>
    withRoleAssignments(env, async (roles) => {
      const authorizer = createAppAuthorizer(roles, {
        logger: createLogger({ traceId: "unit-137-race" }),
      });
      const service = createMessageService(
        {
          ...repository,
          insertReplyIfOrdered: (input: Parameters<Insert>[0]) => {
            calls += 1;
            return wrap(calls, () => repository.insertReplyIfOrdered(input));
          },
        },
        { authorizer },
      );
      return service
        .postReply(
          { userId: world.bob.userId, traceId: "unit-137-race" },
          parentId,
          BODY,
        )
        .then(
          (value) => ({ value, error: null as unknown }),
          (error: unknown) => ({ value: null, error }),
        );
    }),
  );
  return { ...outcome, calls };
}

describe("#137 AC-2（1-4 AC-2・C-59）確認から書き込みまでの間に親が削除される", () => {
  it("#137 AC-2: 確認の後に親が削除されると、201 にならず 409 CONFLICT で、返信は残らない", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const outcome = await postWith(parentId, async (_call, writeReal) => {
      await markDeleted(parentId, world.alice.userId);
      return writeReal();
    });
    expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(outcome.value).toBeNull();
    expect(await replyRows(parentId)).toEqual([]);
  });

  it("#137 AC-2（対照）: 割り込みがなければ、同じ組み立てで返信は書き込まれる（上の拒否が書き込みの条件によるものであることの確認）", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const outcome = await postWith(parentId, (_call, writeReal) => writeReal());
    expect(outcome.error).toBeNull();
    expect(outcome.value).toMatchObject({
      roomId: world.channel,
      parentMessageId: parentId,
    });
    expect(await replyRows(parentId)).toHaveLength(1);
  });
});

describe("#137 AC-1 確認から書き込みまでの間に部屋の状態が変わる", () => {
  it("#137 AC-1: 確認の後に公開チャンネルの参加を外すと 403 FORBIDDEN で、書き込まれない", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const outcome = await postWith(parentId, async (_call, writeReal) => {
      await leaveChannel(world.channel, world.bob.userId);
      return writeReal();
    });
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await replyRows(parentId)).toEqual([]);
  });

  it("#137 AC-1: 確認の後にチャンネルがアーカイブされると 404 NOT_FOUND で、書き込まれない", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const outcome = await postWith(parentId, async (_call, writeReal) => {
      await archiveChannel(world.channel);
      return writeReal();
    });
    expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await replyRows(parentId)).toEqual([]);
  });

  it("#137 AC-1（C-168(2)）: DM の確認の後に相手が無効になると 409 CONFLICT で、書き込まれない", async () => {
    const roomId = await insertDm(world.alice.userId, world.bob.userId);
    const parentId = await seedParent(roomId, world.alice.userId, 1);
    const outcome = await postWith(parentId, async (_call, writeReal) => {
      await deactivateUser(world.alice.userId);
      return writeReal();
    });
    expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(await replyRows(parentId)).toEqual([]);
  });
});

describe("#137 AC-1（決めたこと2・4⑦）ID の作り直し", () => {
  it("#137 AC-1: 確認の後に、部屋に自分の ID より大きい投稿が入ると、最大より大きい ID で作り直して201 になる（部屋の最大は返信を含む）", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    // 実行時の現在時刻の newUlid() より必ず大きくするため、現在より未来の時刻にする
    const bigger = ulidAtMs(Date.now() + 86_400_000);
    const outcome = await postWith(parentId, async (call, writeReal) => {
      if (call === 1)
        await insertMessage({
          roomId: world.channel,
          senderId: world.dave.userId,
          id: bigger,
        });
      return writeReal();
    });
    expect(outcome.error).toBeNull();
    expect(outcome.calls).toBe(2);
    const created = outcome.value as { id: string; parentMessageId: string };
    expect(created.parentMessageId).toBe(parentId);
    expect(created.id > bigger).toBe(true);
    expect((await replyRows(parentId)).map((row) => row.id)).toEqual([
      created.id,
    ]);
  });

  it("#137 AC-1: 挿入できない状態が続くと、再試行して、上限を超えたら 503 SERVICE_UNAVAILABLE にし、行を増やさない", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const before = await roomRowCount(world.channel);
    const outcome = await postWith(parentId, async () => 0);
    expect(outcome.error).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
    });
    expect(outcome.calls).toBeGreaterThan(1);
    expect(outcome.calls).toBeLessThanOrEqual(LAST_CALL);
    expect(await roomRowCount(world.channel)).toBe(before);
  });

  it("#137 AC-1: 再試行を使い切った最後の挿入の間に参加が外れていたら、503 ではなく 403 FORBIDDEN", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const outcome = await postWith(parentId, async (call) => {
      if (call === LAST_CALL)
        await leaveChannel(world.channel, world.bob.userId);
      return 0;
    });
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await replyRows(parentId)).toEqual([]);
  });

  it("#137 AC-2: 再試行を使い切った最後の挿入の間に親が削除されていたら、503 ではなく 409 CONFLICT", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const outcome = await postWith(parentId, async (call) => {
      if (call === LAST_CALL) await markDeleted(parentId, world.alice.userId);
      return 0;
    });
    expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
  });
});
