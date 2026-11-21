// #270（270-A）AC-6・計画 4.5：メッセージの削除（deleteIfModifiable）の batch に、その添付の削除の印を足す。隔離 D1 で確かめる（DB の層）。
// - 削除が確定したときだけ、同じ batch で、そのメッセージの添付（まだ印のないもの）に deleted_at・deleted_by を付ける。拒否なら何も変わらない
// - 戻り値は、メッセージの UPDATE の件数（成功 1・拒否 0）。添付が 0件・3件・全件が既に削除済みのどれでも変わらない
//   （batch に文を足しても、主の UPDATE を積んだ位置の結果を読む。計画 4.5「結果を読む位置」）
// - 既に印のある添付の deleted_at は書き換えない。ほかのメッセージの添付・未投稿の添付には触れない
// - 監査は message.delete の1行だけ（添付ごとの監査を増やさない。AC-7・既定の方針4）
// 実装が前提とする約束：repository.deleteIfModifiable({ messageId, userId, roomId, deletedAt, traceId }): Promise<number>（既存）
// データは架空（testuser_mmatt_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_DELETED_AT,
  auditRowsOf,
  cleanupAttachmentDeleteScenario,
  deletionOf,
  markAttachmentDeleted,
} from "../../test/attachment-delete-fixtures";
import { insertAttachmentRow } from "../../test/attachment-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
} from "../../test/department-fixtures";
import { insertMessage, ulidAt } from "../../test/message-fixtures";
import {
  insertModifyUser,
  modifyTraceId,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import { withMessages } from "./message.repository";

const DELETED_AT = "2026-11-21T03:00:00.000Z";
let author: ModifyUser;
let other: ModifyUser;
let room: string;
let seq = 0;

async function post(senderId = author.userId) {
  seq += 1;
  const id = ulidAt(1_893_000_000_000 + seq * 1_000);
  await insertMessage({
    roomId: room,
    senderId,
    id,
    body: `${TEST_TAG}削除の本文${seq}`,
  });
  return id;
}

const attachN = async (messageId: string | null, n: number) => {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1)
    ids.push(
      await insertAttachmentRow({
        roomId: room,
        uploaderId: author.userId,
        messageId,
      }),
    );
  return ids;
};

const remove = (messageId: string, userId = author.userId) =>
  withMessages(env, (r) =>
    r.deleteIfModifiable({
      messageId,
      userId,
      roomId: room,
      deletedAt: DELETED_AT,
      traceId: modifyTraceId(),
    }),
  );

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const dept = await insertDepartmentWithChannels("メッセージ削除と添付");
  author = await insertModifyUser("testuser_mmatt_author", dept.id);
  other = await insertModifyUser("testuser_mmatt_other", dept.id);
  room = await insertChannel({
    name: `${TEST_TAG}メッセージ削除と添付の部屋`,
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

describe("#270 AC-6 メッセージの削除で、添付にも同じ batch で印が付く", () => {
  it("#270 AC-6: 添付3件のメッセージを消すと、3件すべてに deleted_at（メッセージと同じ時刻）・deleted_by（本人）が付く", async () => {
    const messageId = await post();
    const ids = await attachN(messageId, 3);
    expect(await remove(messageId)).toBe(1);
    for (const id of ids)
      expect(await deletionOf(id)).toEqual({
        deleted_at: DELETED_AT,
        deleted_by: author.userId,
      });
  });

  it("#270 AC-6: ほかのメッセージの添付と、未投稿の添付には触れない", async () => {
    const messageId = await post();
    await attachN(messageId, 1);
    const [elsewhere] = await attachN(await post(), 1);
    const [pending] = await attachN(null, 1);
    expect(await remove(messageId)).toBe(1);
    for (const id of [elsewhere, pending])
      expect(await deletionOf(id ?? "")).toEqual({
        deleted_at: null,
        deleted_by: null,
      });
  });

  it("#270 AC-6: 既に印のある添付の deleted_at・deleted_by は書き換えない", async () => {
    const messageId = await post();
    const [already, fresh] = await attachN(messageId, 2);
    await markAttachmentDeleted(already ?? "", author.userId);
    expect(await remove(messageId)).toBe(1);
    expect(await deletionOf(already ?? "")).toEqual({
      deleted_at: ATTACHMENT_DELETED_AT,
      deleted_by: author.userId,
    });
    expect((await deletionOf(fresh ?? ""))?.deleted_at).toBe(DELETED_AT);
  });

  it("#270 AC-6: 削除が断られた（他人が消そうとした）ときは、メッセージも添付も変わらず、戻り値は 0", async () => {
    const messageId = await post();
    const ids = await attachN(messageId, 3);
    expect(await remove(messageId, other.userId)).toBe(0);
    for (const id of ids)
      expect(await deletionOf(id)).toEqual({
        deleted_at: null,
        deleted_by: null,
      });
  });

  it("#270 AC-7: 監査は message.delete の1行だけで、attachment.delete は増えない", async () => {
    const messageId = await post();
    const ids = await attachN(messageId, 2);
    expect(await remove(messageId)).toBe(1);
    expect(await auditRowsOf("message.delete", messageId)).toHaveLength(1);
    for (const id of ids)
      expect(await auditRowsOf("attachment.delete", id)).toEqual([]);
  });
});

describe("#270 AC-6 計画 4.5 戻り値は、添付の件数に左右されない（結果を読む位置）", () => {
  it.each([
    ["添付が 0 件", 0, false],
    ["添付が 3 件", 3, false],
    ["添付が 3 件で、全件が既に削除済み", 3, true],
  ])(
    "#270 AC-6: %s のとき、成功の戻り値は 1・拒否の戻り値は 0",
    async (_label, count, allDeleted) => {
      const success = await post();
      const refused = await post();
      for (const messageId of [success, refused]) {
        const ids = await attachN(messageId, count);
        if (allDeleted)
          for (const id of ids) await markAttachmentDeleted(id, author.userId);
      }
      expect(await remove(refused, other.userId)).toBe(0);
      expect(await remove(success)).toBe(1);
    },
  );
});
