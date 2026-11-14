// #134 AC-1（壊すテスト）: 編集・削除の「確認から書き込みまでの間」に状態が変わったとき、本物の条件付きの UPDATE（隔離 D1）が書き込みを拒み、
// Service が読み直して原因に合う応答（403・404・409）にすることを確かめる（計画「計画で決めた点」3、改訂1 指摘4）。
// 書き込みの直前に割り込むため、本物の Repository の書き込み（updateBodyIfModifiable・deleteIfModifiable）を包み、
// 呼ばれたら先に DB の状態を変えてから本物を呼ぶ。判定（①〜⑥）は本物の Repository・authorizer で行う。
// 書き込みの条件が Service の確認と同じ内容を持つこと（本人・未削除・部屋の条件）を、DB の結果で確かめる。
// データは架空（testuser_race_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEST_TAG,
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { deactivateUser, insertDm } from "../../test/dm-fixtures";
import { insertMessage } from "../../test/message-fixtures";
import {
  archiveChannel,
  cleanupMessageModifyScenario,
  deactivateDepartment,
  deleteAuditRows,
  failureAuditLines,
  insertModifyUser,
  leaveChannel,
  markDeleted,
  messageRow,
  modifyTraceId,
} from "../../test/message-modify-fixtures";
import { withMessages } from "../db/message.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";
import { createMessageService } from "./message.service";

let dept: SeededDepartment;
let author: string;
let partner: string;
let logLines: string[];

const ORIGINAL = `${TEST_TAG}割り込み前の本文`;
const EDITED = `${TEST_TAG}割り込み後の本文`;

/**
 * 書き込みの直前に interrupt を実行する Service で、編集か削除を行い、投げたエラー（なければ null）を返す。
 * 再認証は今（有効）にしておく。
 */
async function runWithInterrupt(
  operation: "edit" | "remove",
  messageId: string,
  interrupt: () => Promise<void>,
): Promise<unknown> {
  const traceId = modifyTraceId();
  return withMessages(env, (repository) =>
    withRoleAssignments(env, async (roles) => {
      const interrupted = {
        ...repository,
        updateBodyIfModifiable: async (
          input: Parameters<typeof repository.updateBodyIfModifiable>[0],
        ) => {
          await interrupt();
          return repository.updateBodyIfModifiable(input);
        },
        deleteIfModifiable: async (
          input: Parameters<typeof repository.deleteIfModifiable>[0],
        ) => {
          await interrupt();
          return repository.deleteIfModifiable(input);
        },
      };
      const service = createMessageService(interrupted, {
        authorizer: createAppAuthorizer(roles, {
          logger: createLogger({ traceId, userId: author }),
        }),
      });
      const actor = {
        userId: author,
        traceId,
        reauthenticatedAt: new Date().toISOString(),
      };
      const promise =
        operation === "edit"
          ? service.edit(actor, messageId, EDITED)
          : service.remove(actor, messageId);
      return promise.then(
        () => null,
        (error: unknown) => error,
      );
    }),
  );
}

/** 書き込まれていない（本文・編集・削除の列が元のまま。削除の監査もない） */
async function expectUntouched(id: string) {
  expect(await messageRow(id)).toMatchObject({
    body: ORIGINAL,
    edited_at: null,
    deleted_at: null,
    deleted_by: null,
  });
  expect(await deleteAuditRows(id)).toEqual([]);
}

beforeEach(async () => {
  logLines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("割り込み");
  author = (await insertModifyUser("testuser_race_author", dept.id)).userId;
  partner = (await insertModifyUser("testuser_race_partner", dept.id)).userId;
  await insertMember(dept.dedicatedChannelId, author);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupMessageModifyScenario();
});

const OPERATIONS = ["edit", "remove"] as const;

describe("#134 共通（壊すテスト）：確認から書き込みまでの間の変化", () => {
  it.each(OPERATIONS)(
    "#134 AC-1（U-3）: %s の確認の後に公開チャンネルの参加を外すと 403 FORBIDDEN で、書き込まれない",
    async (operation) => {
      const id = await insertMessage({
        roomId: dept.dedicatedChannelId,
        senderId: author,
        body: ORIGINAL,
      });
      const error = await runWithInterrupt(operation, id, () =>
        leaveChannel(dept.dedicatedChannelId, author),
      );
      expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
      await expectUntouched(id);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（改訂1 指摘4）: %s の確認の後にチャンネルがアーカイブされると 404 NOT_FOUND で、書き込まれない",
    async (operation) => {
      const id = await insertMessage({
        roomId: dept.dedicatedChannelId,
        senderId: author,
        body: ORIGINAL,
      });
      const error = await runWithInterrupt(operation, id, () =>
        archiveChannel(dept.dedicatedChannelId),
      );
      expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
      await expectUntouched(id);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（1-3 AC-6・U-9）: %s の確認の後に部署が無効になると 409 CONFLICT で、書き込まれない",
    async (operation) => {
      const id = await insertMessage({
        roomId: dept.dedicatedChannelId,
        senderId: author,
        body: ORIGINAL,
      });
      const error = await runWithInterrupt(operation, id, () =>
        deactivateDepartment(dept.id),
      );
      expect(error).toMatchObject({ code: "CONFLICT", status: 409 });
      await expectUntouched(id);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（計画 5）: %s の確認の後に別のタブで削除されると 409 CONFLICT で、本文・削除の記録は変わらない",
    async (operation) => {
      const id = await insertMessage({
        roomId: dept.dedicatedChannelId,
        senderId: author,
        body: ORIGINAL,
      });
      const error = await runWithInterrupt(operation, id, () =>
        markDeleted(id, author),
      );
      expect(error).toMatchObject({ code: "CONFLICT", status: 409 });
      const row = await messageRow(id);
      expect(row).toMatchObject({ body: ORIGINAL, edited_at: null });
      expect(await deleteAuditRows(id)).toEqual([]);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（U-3・C-168(2)）: DM の %s の確認の後に相手が無効になると 409 CONFLICT で、書き込まれない",
    async (operation) => {
      const roomId = await insertDm(author, partner);
      const id = await insertMessage({
        roomId,
        senderId: author,
        body: ORIGINAL,
      });
      const error = await runWithInterrupt(operation, id, () =>
        deactivateUser(partner),
      );
      expect(error).toMatchObject({ code: "CONFLICT", status: 409 });
      await expectUntouched(id);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1: 割り込みがなければ、同じ組み立てで %s が書き込まれる（上の拒否が書き込みの条件によるものであることの対照）",
    async (operation) => {
      const id = await insertMessage({
        roomId: dept.dedicatedChannelId,
        senderId: author,
        body: ORIGINAL,
      });
      const error = await runWithInterrupt(operation, id, async () => {});
      expect(error).toBeNull();
      const row = await messageRow(id);
      if (operation === "edit") expect(row?.body).toBe(EDITED);
      else {
        expect(row?.deleted_by).toBe(author);
        expect(await deleteAuditRows(id)).toHaveLength(1);
      }
    },
  );
});

describe("#134 AC-1（U-3）確認から書き込みまでの間に抜けたときの拒否の監査（コードレビューの指摘）", () => {
  const ACTION = { edit: "message.edit", remove: "message.delete" } as const;

  it.each(OPERATIONS)(
    "#134 AC-1（判定⑦）: %s の確認の後に公開チャンネルの参加を外すと、403 の拒否が logger.audit に1件残る（操作・利用者・対象・理由。本文は出さない）",
    async (operation) => {
      const id = await insertMessage({
        roomId: dept.dedicatedChannelId,
        senderId: author,
        body: ORIGINAL,
      });
      const error = await runWithInterrupt(operation, id, () =>
        leaveChannel(dept.dedicatedChannelId, author),
      );
      expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
      const denied = failureAuditLines(logLines).filter(
        (line) => line.attributes?.target === id,
      );
      expect(denied, JSON.stringify(failureAuditLines(logLines))).toHaveLength(
        1,
      );
      const [line] = denied;
      expect(line?.body).toBe(ACTION[operation]);
      expect((line as { user_id?: string } | undefined)?.user_id).toBe(author);
      expect(line?.attributes).toMatchObject({
        log_type: "audit",
        result: "failure",
        target: id,
        reason: "not_member",
      });
      expect(JSON.stringify(denied)).not.toContain(ORIGINAL);
      expect(JSON.stringify(denied)).not.toContain(EDITED);
      await expectUntouched(id);
    },
  );
});
