// #148（148-A）5-2 AC-1・5-1 AC-11・計画「同時の操作」：資格の確認（Service の事前の判定）の後、書き込みの前に案件が終了したとき、
// 書き込みの SQL の条件（caseRoomOpen）で0行になり、読み直しで 409 になること（行が残らない・変わらない）を確かめる。
// 挟み方（先例 services/message.modify-race.test.ts・channel-member.active-interleave.test.ts の「本物の Repository を包む」形）：
//   本物の Repository（隔離 D1）を Proxy で包み、書き込みの関数（insertIfOrdered・insertReplyIfOrdered・updateBodyIfModifiable・
//   deleteIfModifiable・addReactionIfReactable・removeReactionIfReactable）が呼ばれる直前に、cases.status を 'closed' にする。
//   Service の事前の判定はすべて通った後なので、止めるのは SQL の条件だけ。挟めたことは、書き込みの関数が呼ばれたことで確かめる。
// 投稿の1件で、直前に参加から外れた場合も 404 になる（147-C-1 の条件が案件の部屋でも効くこと）。
// 権限の判定（authorizer）は、すべて許す偽物。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CASE_CLOSED_MESSAGES,
  cleanupCaseRoomWorld,
  messageCountIn,
  seedRoomMessage,
  setCaseStatus,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { removeCaseMember } from "../../test/case-fixtures";
import { fakeAuthorizer } from "../../test/dm-fixtures";
import { messageRow } from "../../test/message-modify-fixtures";
import { reactionRows } from "../../test/reaction-fixtures";
import { withMessages, type MessageRepository } from "../db/message.repository";
import { createMessageService } from "./message.service";

const WRITES = new Set([
  "insertIfOrdered",
  "insertReplyIfOrdered",
  "updateBodyIfModifiable",
  "deleteIfModifiable",
  "addReactionIfReactable",
  "removeReactionIfReactable",
]);

let cw: CaseRoomWorld;

const actor = (userId: string) => ({
  userId,
  traceId: "unit-148-interleave",
  reauthenticatedAt: new Date().toISOString(),
});

type Service = ReturnType<typeof createMessageService>;

/** 書き込みの関数が呼ばれる直前に interrupt を1回だけ実行する Repository */
function interleave(
  repository: MessageRepository,
  interrupt: () => Promise<void>,
  seen: string[],
): MessageRepository {
  let done = false;
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        const name = String(property);
        if (WRITES.has(name) && !done) {
          done = true;
          seen.push(name);
          await interrupt();
        }
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

async function runInterleaved<T>(
  interrupt: () => Promise<void>,
  action: (service: Service) => Promise<T>,
) {
  const seen: string[] = [];
  const outcome = await withMessages(env, (repository) =>
    action(
      createMessageService(interleave(repository, interrupt, seen), {
        authorizer: fakeAuthorizer(),
      }),
    ).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    ),
  );
  return { ...outcome, seen };
}

const closeOpenCase = () => setCaseStatus(cw.open.id, "closed");

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1520);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 5-1 AC-11 資格の確認の後、書き込みの前に案件が終了する（Service × SQL）", () => {
  it("#148 5-1 AC-11: 投稿は 409 になり、行が残らない", async () => {
    const { error, seen } = await runInterleaved(closeOpenCase, (s) =>
      s.post(actor(cw.w.memberS1.id), cw.open.roomId, "[UNIT_TEST]148割込"),
    );
    expect(seen).toEqual(["insertIfOrdered"]);
    expect(error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      userMessage: CASE_CLOSED_MESSAGES.post,
    });
    expect(await messageCountIn(cw.open.roomId)).toBe(0);
  });

  it("#148 5-1 AC-11: 返信は 409 になり、行が残らない", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 1);
    const { error, seen } = await runInterleaved(closeOpenCase, (s) =>
      s.postReply(actor(cw.w.memberS1.id), parent, "[UNIT_TEST]148割込"),
    );
    expect(seen).toEqual(["insertReplyIfOrdered"]);
    expect(error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      userMessage: CASE_CLOSED_MESSAGES.post,
    });
    expect(await messageCountIn(cw.open.roomId)).toBe(1);
  });

  it("#148 5-1 AC-11: 編集は 409 になり、本文・編集日時が変わらない", async () => {
    const own = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 2);
    const { error, seen } = await runInterleaved(closeOpenCase, (s) =>
      s.edit(actor(cw.w.memberS1.id), own, "[UNIT_TEST]148割込の編集"),
    );
    expect(seen).toEqual(["updateBodyIfModifiable"]);
    expect(error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      userMessage: CASE_CLOSED_MESSAGES.modify,
    });
    expect(await messageRow(own)).toMatchObject({
      body: "[UNIT_TEST]148投稿2",
      edited_at: null,
    });
  });

  it("#148 5-1 AC-11: 削除は 409 になり、削除の印が付かない", async () => {
    const own = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 3);
    const { error, seen } = await runInterleaved(closeOpenCase, (s) =>
      s.remove(actor(cw.w.memberS1.id), own),
    );
    expect(seen).toEqual(["deleteIfModifiable"]);
    expect(error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      userMessage: CASE_CLOSED_MESSAGES.modify,
    });
    expect(await messageRow(own)).toMatchObject({
      deleted_at: null,
      deleted_by: null,
    });
  });

  it("#148 5-1 AC-11・C-81: リアクションの追加・取り消しは 409 になり、行が変わらない", async () => {
    const target = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 4);
    await env.DB.prepare(
      "INSERT INTO message_reactions (message_id, kind, value, user_id, created_at) VALUES (?, 'emoji', '🎉', ?, ?)",
    )
      .bind(target, cw.w.memberS1.id, "2026-11-17T03:00:00.000Z")
      .run();
    const added = await runInterleaved(closeOpenCase, (s) =>
      s.addReaction(actor(cw.w.memberS1.id), target, "emoji", "👍"),
    );
    expect(added.seen).toEqual(["addReactionIfReactable"]);
    expect(added.error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      userMessage: CASE_CLOSED_MESSAGES.reaction,
    });
    // 2つ目の操作の前に、案件を進行中に戻す（各回の前の復元）
    await setCaseStatus(cw.open.id, "active");
    const removed = await runInterleaved(closeOpenCase, (s) =>
      s.removeReaction(actor(cw.w.memberS1.id), target, "emoji", "🎉"),
    );
    expect(removed.seen).toEqual(["removeReactionIfReactable"]);
    expect(removed.error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      userMessage: CASE_CLOSED_MESSAGES.reaction,
    });
    expect((await reactionRows(target)).map((row) => row.value)).toEqual([
      "🎉",
    ]);
  });
});

describe("#148 147-C-1 資格の確認の後、書き込みの前に参加から外れる（案件の部屋）", () => {
  it("#148 5-2 AC-3: 投稿の直前に参加から外れると 404 になり、行が残らない", async () => {
    const { error, seen } = await runInterleaved(
      () => removeCaseMember(cw.open.roomId, cw.w.memberS1.id),
      (s) =>
        s.post(actor(cw.w.memberS1.id), cw.open.roomId, "[UNIT_TEST]148割込"),
    );
    expect(seen).toEqual(["insertIfOrdered"]);
    expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await messageCountIn(cw.open.roomId)).toBe(0);
  });
});
