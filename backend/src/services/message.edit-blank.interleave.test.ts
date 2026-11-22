// #270（270-B）AC-8（編集の割り込み）：本文を空にする編集の、Service の確認の後に、相手の操作が確定したときの応答と DB の結果（Service × SQL）。
// 期待の根拠（実装から写さない）：
//   計画 AC-8：書き込みの直前に、最後の添付の削除が確定しても、SQL の条件で 0 行になり、読み直しで AC-5 の 422 になる
//   計画 2.6・2.6b（改訂1・改訂2）：0 行のときは、必ず先に ①〜⑤（requireModifiable）を読み直す。メッセージの削除が割り込んだ（添付にも印が付く）なら
//     ④の 409「このメッセージはすでに削除されています」で、422 にしない。資格の喪失（参加の解除 403・アーカイブ 404・DM の相手の無効 409）も 422 より先。
//     「見える添付の件数」は「編集できる条件」と同じ batch で読み（visibleAttachmentCountIfModifiable）、条件が成り立たなければ null → ①〜⑤を読み直す
//   計画レビュー3回目の軽微の直し：手順6（0 行の後）の件数の読み取りの直前の割り込みは、最初の件数の読み取りの後・書き込みの直前に最後の添付を消して
//     本物の更新を 0 行にし、その後の「2回目の件数の読み取り」の直前に、メッセージの削除・参加の解除などを差し込む。更新の結果と読み取りの回数も確かめる
// 作り（message.modify-race.test.ts と同じ）：本物の Repository の関数（updateBodyIfModifiable・visibleAttachmentCountIfModifiable）を包み、
//   呼ばれたら先に相手の操作を DB で確定させてから本物を呼ぶ。判定は本物の Repository・authorizer で行う。
// 契約（実装前の仮置き。実装の担当へ）：message.repository.ts の Repository に visibleAttachmentCountIfModifiable を置き（計画 2.6a の DAO の入口）、
//   Service の edit は、本文が空白だけのときだけ、これを呼ぶ（手順3・手順6）。名前が変わるときは、このテストの CountReader を合わせる。
// データは架空（testuser_editint_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markAttachmentDeleted } from "../../test/attachment-delete-fixtures";
import {
  cleanupAttachmentScenario,
  insertAttachmentRow,
} from "../../test/attachment-fixtures";
import {
  cleanupAttachmentOnlyLeftovers,
  rowCount,
} from "../../test/attachment-only-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { deactivateUser, insertDm } from "../../test/dm-fixtures";
import { insertMessage, ulidAt } from "../../test/message-fixtures";
import {
  archiveChannel,
  insertModifyUser,
  leaveChannel,
  messageRow,
  modifyTraceId,
} from "../../test/message-modify-fixtures";
import { cleanupSearchIndex } from "../../test/search-fixtures";
import { withMessages, type MessageRepository } from "../db/message.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";
import { createMessageService } from "./message.service";

const ORIGINAL = `${TEST_TAG}割り込みの前の本文`;
const DELETED_MESSAGE = "このメッセージはすでに削除されています";

/** 計画 2.6a の読み取り（まだない。名前は計画の DAO の名前） */
type CountReader = {
  visibleAttachmentCountIfModifiable: (
    ...args: unknown[]
  ) => Promise<number | null>;
};

let dept: SeededDepartment;
let author: string;
let partner: string;
let open: string;
let seq = 0;

type Interrupts = {
  /** n 回目の件数の読み取りの直前に行う操作（1 始まり） */
  beforeCount?: Partial<Record<number, () => Promise<void>>>;
  /** 書き込み（updateBodyIfModifiable）の直前に行う操作 */
  beforeWrite?: () => Promise<void>;
};

type Run = {
  error: unknown;
  countCalls: number;
  writeCalls: number;
  writeResults: number[];
};

/** 割り込みを入れた Service で、本文を空にする編集を行う */
async function editBlankWith(
  messageId: string,
  interrupts: Interrupts,
  body = "",
): Promise<Run> {
  const traceId = modifyTraceId();
  const run: Run = {
    error: null,
    countCalls: 0,
    writeCalls: 0,
    writeResults: [],
  };
  run.error = await withMessages(env, (repository) =>
    withRoleAssignments(env, async (roles) => {
      const real = repository as MessageRepository & CountReader;
      const interrupted = {
        ...repository,
        visibleAttachmentCountIfModifiable: async (...args: unknown[]) => {
          run.countCalls += 1;
          await interrupts.beforeCount?.[run.countCalls]?.();
          return real.visibleAttachmentCountIfModifiable(...args);
        },
        updateBodyIfModifiable: async (
          input: Parameters<typeof repository.updateBodyIfModifiable>[0],
        ) => {
          run.writeCalls += 1;
          await interrupts.beforeWrite?.();
          const changes = await repository.updateBodyIfModifiable(input);
          run.writeResults.push(changes);
          return changes;
        },
      };
      const service = createMessageService(interrupted, {
        authorizer: createAppAuthorizer(roles, {
          logger: createLogger({ traceId, userId: author }),
        }),
      });
      return service
        .edit(
          {
            userId: author,
            traceId,
            reauthenticatedAt: new Date().toISOString(),
          },
          messageId,
          body,
        )
        .then(
          () => null,
          (error: unknown) => error,
        );
    }),
  );
  return run;
}

/** 本文ありの投稿と、結び付いた添付1件 */
async function seedOn(roomId: string) {
  seq += 1;
  const messageId = ulidAt(1_898_000_000_000 + seq * 1_000);
  await insertMessage({
    roomId,
    senderId: author,
    id: messageId,
    body: ORIGINAL,
  });
  const attachment = await insertAttachmentRow({
    roomId,
    uploaderId: author,
    messageId,
    originalName: `[UNIT_TEST]割り込みの添付${seq}.txt`,
  });
  return { messageId, attachment };
}

/** 本物のメッセージの削除（添付にも印・索引を消す。計画 2.7） */
const deleteMessageForReal = (messageId: string, roomId: string) => () =>
  withMessages(env, async (repository) => {
    const changes = await repository.deleteIfModifiable({
      messageId,
      userId: author,
      roomId,
      deletedAt: new Date().toISOString(),
      traceId: modifyTraceId(),
    });
    expect(changes).toBe(1);
  });

/** 書き込まれていない（本文・編集の列が元のまま。指名・通知が増えない） */
async function expectUntouched(
  messageId: string,
  before: { mentions: number; notifications: number },
) {
  expect(await messageRow(messageId)).toMatchObject({
    body: ORIGINAL,
    edited_at: null,
  });
  expect(await rowCount("message_mentions")).toBe(before.mentions);
  expect(await rowCount("notifications")).toBe(before.notifications);
}

const counts = async () => ({
  mentions: await rowCount("message_mentions"),
  notifications: await rowCount("notifications"),
});

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("空の編集の割り込み");
  author = (await insertModifyUser("testuser_editint_author", dept.id)).userId;
  partner = (await insertModifyUser("testuser_editint_partner", dept.id))
    .userId;
  open = await insertChannel({
    name: `${TEST_TAG}空の編集の割り込みの公開`,
    purpose: "normal",
    departmentId: dept.id,
    visibility: "public",
  });
  await insertMember(open, author);
  await insertMember(open, partner);
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await cleanupAttachmentOnlyLeftovers();
    await cleanupSearchIndex();
  } finally {
    await cleanupAttachmentScenario();
  }
});

describe("#270 AC-8 書き込みの直前の割り込み（updateBodyIfModifiable の直前）", () => {
  it("#270 AC-8 (1): 最後の添付の削除が確定すると、書き込みは 0 行で、読み直しの AC-5 の 422（fields: body）", async () => {
    const { messageId, attachment } = await seedOn(open);
    const before = await counts();
    const run = await editBlankWith(messageId, {
      beforeWrite: () => markAttachmentDeleted(attachment, author),
    });
    expect(run.writeCalls).toBe(1);
    expect(run.writeResults).toEqual([0]);
    expect(run.error).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      details: { fields: ["body"] },
    });
    await expectUntouched(messageId, before);
  });

  it("#270 AC-8 (2)（改訂1 重大1）: メッセージの削除（添付にも印）が確定すると、409「すでに削除」で、422 にしない", async () => {
    const { messageId } = await seedOn(open);
    const run = await editBlankWith(messageId, {
      beforeWrite: deleteMessageForReal(messageId, open),
    });
    expect(run.writeCalls).toBe(1);
    expect(run.writeResults).toEqual([0]);
    expect(run.error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: DELETED_MESSAGE,
    });
    expect(await messageRow(messageId)).toMatchObject({
      body: ORIGINAL,
      edited_at: null,
    });
  });

  it.each<
    [string, (s: { attachment: string }) => Promise<void>, number, string]
  >([
    [
      "参加の解除（公開チャンネル）＋最後の添付の削除",
      async ({ attachment }) => {
        await leaveChannel(open, author);
        await markAttachmentDeleted(attachment, author);
      },
      403,
      "FORBIDDEN",
    ],
    [
      "チャンネルのアーカイブ＋最後の添付の削除",
      async ({ attachment }) => {
        await archiveChannel(open);
        await markAttachmentDeleted(attachment, author);
      },
      404,
      "NOT_FOUND",
    ],
  ])(
    "#270 AC-8: %s が確定すると、資格の読み直しの応答（403・404）で、422 にしない",
    async (_label, interrupt, status, code) => {
      const seeded = await seedOn(open);
      const before = await counts();
      const run = await editBlankWith(seeded.messageId, {
        beforeWrite: () => interrupt(seeded),
      });
      expect(run.writeResults).toEqual([0]);
      expect(run.error).toMatchObject({ code, status });
      await expectUntouched(seeded.messageId, before);
    },
  );

  it("#270 AC-8: DM の相手の無効化＋最後の添付の削除が確定すると、409（相手が無効）で、422 にしない", async () => {
    const dm = await insertDm(author, partner);
    const { messageId, attachment } = await seedOn(dm);
    const before = await counts();
    const run = await editBlankWith(messageId, {
      beforeWrite: async () => {
        await deactivateUser(partner);
        await markAttachmentDeleted(attachment, author);
      },
    });
    expect(run.writeResults).toEqual([0]);
    expect(run.error).toMatchObject({ code: "CONFLICT", status: 409 });
    expect((run.error as { message?: string }).message).not.toBe(
      DELETED_MESSAGE,
    );
    await expectUntouched(messageId, before);
  });

  it("#270 AC-8（対照）: 何も割り込まなければ、同じ組み立てで本文が空になる（書き込みは1回・1行）", async () => {
    const { messageId } = await seedOn(open);
    const run = await editBlankWith(messageId, {});
    expect(run.error).toBeNull();
    expect(run.writeResults).toEqual([1]);
    expect(run.countCalls).toBeGreaterThanOrEqual(1);
  });
});

describe("#270 AC-8（改訂2）最初の件数の読み取り（手順3）の直前の割り込み", () => {
  it("#270 AC-8 (1): メッセージの削除（添付にも印）が確定すると、409「すでに削除」で、422 にしない。書き込みは呼ばない", async () => {
    const { messageId } = await seedOn(open);
    const run = await editBlankWith(messageId, {
      beforeCount: { 1: deleteMessageForReal(messageId, open) },
    });
    expect(run.countCalls).toBe(1);
    expect(run.writeCalls).toBe(0);
    expect(run.error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: DELETED_MESSAGE,
    });
  });

  it.each<[string, (s: { attachment: string }) => Promise<void>, number]>([
    [
      "参加の解除（公開チャンネル）＋添付の削除",
      async ({ attachment }) => {
        await leaveChannel(open, author);
        await markAttachmentDeleted(attachment, author);
      },
      403,
    ],
    [
      "チャンネルのアーカイブ＋添付の削除",
      async ({ attachment }) => {
        await archiveChannel(open);
        await markAttachmentDeleted(attachment, author);
      },
      404,
    ],
  ])(
    "#270 AC-8 (2)(3): %s が確定すると、資格の応答（403・404）で、422 にしない。書き込みは呼ばない",
    async (_label, interrupt, status) => {
      const seeded = await seedOn(open);
      const before = await counts();
      const run = await editBlankWith(seeded.messageId, {
        beforeCount: { 1: () => interrupt(seeded) },
      });
      expect(run.countCalls).toBe(1);
      expect(run.writeCalls).toBe(0);
      expect(run.error).toMatchObject({ status });
      await expectUntouched(seeded.messageId, before);
    },
  );

  it("#270 AC-8 (4): 最後の添付の削除だけが確定すると、条件は成り立ち件数が0で、AC-5 の 422。書き込みは呼ばない", async () => {
    const { messageId, attachment } = await seedOn(open);
    const before = await counts();
    const run = await editBlankWith(messageId, {
      beforeCount: { 1: () => markAttachmentDeleted(attachment, author) },
    });
    expect(run.countCalls).toBe(1);
    expect(run.writeCalls).toBe(0);
    expect(run.error).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      details: { fields: ["body"] },
    });
    await expectUntouched(messageId, before);
  });

  it("#270 AC-8（いまの動きを変えない）: 本文が空白でない編集では、件数を読まない", async () => {
    const { messageId } = await seedOn(open);
    const run = await editBlankWith(messageId, {}, `${TEST_TAG}ふつうの編集`);
    expect(run.error).toBeNull();
    expect(run.countCalls).toBe(0);
    expect(run.writeResults).toEqual([1]);
  });
});

describe("#270 AC-8（改訂2・計画レビュー3回目の直し）0 行の後（手順6）の、2回目の件数の読み取りの直前の割り込み", () => {
  it("#270 AC-8: 書き込みの直前に最後の添付を消して 0 行にし、2回目の件数の読み取りの直前にメッセージを削除すると、409「すでに削除」（422 にしない）", async () => {
    const { messageId, attachment } = await seedOn(open);
    const run = await editBlankWith(messageId, {
      beforeWrite: () => markAttachmentDeleted(attachment, author),
      beforeCount: { 2: deleteMessageForReal(messageId, open) },
    });
    expect(run.writeResults).toEqual([0]);
    expect(run.countCalls).toBe(2);
    expect(run.error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: DELETED_MESSAGE,
    });
  });

  it.each<[string, () => Promise<void>, number]>([
    ["参加の解除（公開チャンネル）", () => leaveChannel(open, author), 403],
    ["チャンネルのアーカイブ", () => archiveChannel(open), 404],
  ])(
    "#270 AC-8: 0 行にした後、2回目の件数の読み取りの直前に %s が確定すると、資格の応答（403・404。422 にしない）",
    async (_label, interrupt, status) => {
      const { messageId, attachment } = await seedOn(open);
      const before = await counts();
      const run = await editBlankWith(messageId, {
        beforeWrite: () => markAttachmentDeleted(attachment, author),
        beforeCount: { 2: interrupt },
      });
      expect(run.writeResults).toEqual([0]);
      expect(run.countCalls).toBe(2);
      expect(run.error).toMatchObject({ status });
      await expectUntouched(messageId, before);
    },
  );

  it("#270 AC-8（対照）: 0 行にした後、2回目の件数の読み取りの直前に何も起きなければ、AC-5 の 422（読み取りは2回）", async () => {
    const { messageId, attachment } = await seedOn(open);
    const run = await editBlankWith(messageId, {
      beforeWrite: () => markAttachmentDeleted(attachment, author),
    });
    expect(run.writeResults).toEqual([0]);
    expect(run.countCalls).toBe(2);
    expect(run.error).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
  });
});
