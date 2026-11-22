// #270（270-A）AC-6・計画 4.5「実体の削除の開始（確定）」：メッセージの削除（remove）は、削除が成功した（deleted が 1）後に、
// 依存として受け取った purgeAttachmentsOf(messageId) を、同じ要求の中で1回だけ呼ぶ。
// 断られた（403・409・再認証）・書き込みが0行のときは呼ばない。purgeAttachmentsOf が失敗しても remove は成功のまま（後始末の失敗は主の結果を変えない）で、
// error ログに残す。省略したとき（既存の組み立て）は何もしない。
// 本物の Repository（隔離 D1）と、権限をすべて許す偽の authorizer で確かめる（Service の層）。
// 契約（実装前の仮置き。実装の担当へ）：createMessageService(repository, { authorizer, now?, purgeAttachmentsOf?: (messageId: string) => Promise<void> })
// データは架空（testuser_mpurge_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupAttachmentDeleteScenario } from "../../test/attachment-delete-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
} from "../../test/department-fixtures";
import { fakeAuthorizer } from "../../test/dm-fixtures";
import { insertMessage, ulidAt } from "../../test/message-fixtures";
import {
  insertModifyUser,
  markDeleted,
  messageRow,
  modifyTraceId,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import { withMessages, type MessageRepository } from "../db/message.repository";
import { createMessageService } from "./message.service";

let author: ModifyUser;
let other: ModifyUser;
let room: string;
let errorLines: string[];
let seq = 0;

const actor = (userId: string, reauthenticated = true) => ({
  userId,
  traceId: modifyTraceId(),
  reauthenticatedAt: reauthenticated
    ? new Date(Date.now() - 60_000).toISOString()
    : null,
});

async function post(senderId = author.userId) {
  seq += 1;
  const id = ulidAt(1_894_000_000_000 + seq * 1_000);
  await insertMessage({
    roomId: room,
    senderId,
    id,
    body: `${TEST_TAG}purge の本文${seq}`,
  });
  return id;
}

async function removeWith(
  purgeAttachmentsOf: ((messageId: string) => Promise<void>) | undefined,
  actorValue: ReturnType<typeof actor>,
  messageId: string,
  wrap: (r: MessageRepository) => MessageRepository = (r) => r,
) {
  return withMessages(env, (repository) =>
    createMessageService(wrap(repository), {
      authorizer: fakeAuthorizer(),
      ...(purgeAttachmentsOf === undefined ? {} : { purgeAttachmentsOf }),
    })
      .remove(actorValue, messageId)
      .then(
        () => ({ error: null as unknown }),
        (error: unknown) => ({ error }),
      ),
  );
}

beforeEach(async () => {
  errorLines = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    errorLines.push(String(line));
  });
  const dept = await insertDepartmentWithChannels("メッセージ削除の purge");
  author = await insertModifyUser("testuser_mpurge_author", dept.id);
  other = await insertModifyUser("testuser_mpurge_other", dept.id);
  room = await insertChannel({
    name: `${TEST_TAG}purge の部屋`,
    purpose: "normal",
    departmentId: dept.id,
    visibility: "private",
  });
  await insertMember(room, author.userId);
  await insertMember(room, other.userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAttachmentDeleteScenario();
});

describe("#270 AC-6 削除の成功の後に、purgeAttachmentsOf を1回だけ呼ぶ", () => {
  it("#270 AC-6: 削除が成功すると、purgeAttachmentsOf をそのメッセージの ID で1回呼ぶ（削除の印の後）", async () => {
    const messageId = await post();
    const calls: { id: string; deletedAt: string | null }[] = [];
    const purge = async (id: string) => {
      calls.push({ id, deletedAt: (await messageRow(id))?.deleted_at ?? null });
    };
    const { error } = await removeWith(purge, actor(author.userId), messageId);
    expect(error).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe(messageId);
    // 呼ばれた時点で、削除は確定している
    expect(calls[0]?.deletedAt).not.toBeNull();
  });

  it("#270 AC-6: purgeAttachmentsOf が失敗しても、remove は成功のまま（投げない）で、メッセージは削除済み。error ログに残す", async () => {
    const messageId = await post();
    const purge = async () => {
      throw new Error("[UNIT_TEST] 注入した purge の失敗");
    };
    const { error } = await removeWith(purge, actor(author.userId), messageId);
    expect(error).toBeNull();
    expect((await messageRow(messageId))?.deleted_at).not.toBeNull();
    expect(errorLines.length).toBeGreaterThanOrEqual(1);
  });

  it("#270 AC-6: purgeAttachmentsOf を渡さない（既存の組み立て）ときも、削除は成功する", async () => {
    const messageId = await post();
    const { error } = await removeWith(
      undefined,
      actor(author.userId),
      messageId,
    );
    expect(error).toBeNull();
    expect((await messageRow(messageId))?.deleted_at).not.toBeNull();
  });
});

describe("#270 AC-6 断られた・0行のときは呼ばない", () => {
  it.each<
    [string, () => Promise<{ actor: ReturnType<typeof actor>; id: string }>]
  >([
    [
      "他人の投稿（403）",
      async () => ({ actor: actor(other.userId), id: await post() }),
    ],
    [
      "削除済みの投稿（409）",
      async () => {
        const id = await post();
        await markDeleted(id, author.userId);
        return { actor: actor(author.userId), id };
      },
    ],
    [
      "再認証がない（403 REAUTH_REQUIRED）",
      async () => ({ actor: actor(author.userId, false), id: await post() }),
    ],
  ])("#270 AC-6: %s では purgeAttachmentsOf を呼ばない", async (_l, make) => {
    const { actor: who, id } = await make();
    const calls: string[] = [];
    const { error } = await removeWith(
      async (messageId) => {
        calls.push(messageId);
      },
      who,
      id,
    );
    expect(error).not.toBeNull();
    expect(calls).toEqual([]);
  });

  it("#270 AC-6: 書き込みが0行（確認の後に削除された）なら、呼ばない", async () => {
    const id = await post();
    const calls: string[] = [];
    const wrap = (repository: MessageRepository): MessageRepository =>
      new Proxy(repository, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver) as unknown;
          if (property !== "deleteIfModifiable" || typeof value !== "function")
            return value;
          return async (...args: unknown[]) => {
            await markDeleted(id, author.userId);
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
    const { error } = await removeWith(
      async (messageId) => {
        calls.push(messageId);
      },
      actor(author.userId),
      id,
      wrap,
    );
    expect(error).not.toBeNull();
    expect(calls).toEqual([]);
  });
});
