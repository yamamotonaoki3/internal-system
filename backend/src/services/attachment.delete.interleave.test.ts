// #270（270-A）1-6 AC-4・計画 4.3「前提の確かめ」・7章「確認の後の状態の変化」：Service の事前の判定（①〜⑥）がすべて通った後、
// 削除の印を付ける batch の直前に状態が変わったとき、書き込みの SQL の条件（deletable）で0行になり、読み直しの応答（404／403／409）になること。
// 印・監査・索引・R2 のどれも変わらないこと（SQL の条件が最後の守りであること）。
// 挟み方（message.case-room.interleave.test.ts と同じ考え方）：添付の Service は Repository を中で組むため、要求の env の DB を包み、
//   message_attachments を UPDATE する文を含む最初の batch の直前に、状態を1回だけ変える（test/attachment-delete-fixtures.ts の interleavingDb）。
//   挟めたことは state.ran で確かめる。実際のアプリ入口（index.ts の app）から要求する（権限は固定ロールのまま。全ロールが perm.attachment.delete.own を持つ）。
// 案件の終了の割り込みは attachments.delete.case-room.test.ts にある。
// データは架空（testuser_attint_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_BYTES } from "../../test/attachment-files";
import {
  ATTACHMENT_DELETE_ACTION,
  attachmentDocumentCount,
  auditRowsOf,
  cleanupAttachmentDeleteScenario,
  deletionOf,
  interleavingDb,
  recordingBucket,
} from "../../test/attachment-delete-fixtures";
import {
  attachmentPath,
  attachmentRow,
  bucket,
  rawRequest,
  seedStoredAttachment,
  storedKeys,
} from "../../test/attachment-fixtures";
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
  deactivateDepartment,
  insertModifyUser,
  leaveChannel,
  markDeleted,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import {
  buildSearchIndex,
  cleanupSearchIndex,
} from "../../test/search-fixtures";

const ONE_MINUTE = 60_000;
let dept: SeededDepartment;
let author: ModifyUser;
let partner: ModifyUser;
let open: string;
let seq = 0;

async function seedOn(roomId: string) {
  seq += 1;
  const messageId = ulidAt(1_891_000_000_000 + seq * 1_000);
  await insertMessage({
    roomId,
    senderId: author.userId,
    id: messageId,
    body: `${TEST_TAG}割り込みの本文`,
  });
  const id = await seedStoredAttachment(
    {
      roomId,
      uploaderId: author.userId,
      messageId,
      originalName: `[UNIT_TEST]割込添付${seq}.txt`,
    },
    TEXT_BYTES,
  );
  await buildSearchIndex();
  return {
    messageId,
    id,
    key: (await attachmentRow(id))?.storage_key ?? "",
  };
}

async function deleteInterleaved(
  attachmentId: string,
  interrupt: () => Promise<void>,
) {
  const interleaved = interleavingDb(env.DB, interrupt);
  const recorded = recordingBucket(bucket());
  const response = await rawRequest("DELETE", attachmentPath(attachmentId), {
    token: author.token,
    envOverrides: { DB: interleaved.db, ATTACHMENTS: recorded.bucket },
  });
  return { response, ran: interleaved.state.ran, deletes: recorded.deletes };
}

/** 印・監査・索引・R2 のどれも変わらない */
async function expectNothingChanged(
  seeded: { id: string; key: string },
  deletes: readonly string[],
) {
  expect(await deletionOf(seeded.id)).toEqual({
    deleted_at: null,
    deleted_by: null,
  });
  expect(await auditRowsOf(ATTACHMENT_DELETE_ACTION, seeded.id)).toEqual([]);
  expect(await attachmentDocumentCount(seeded.id)).toBe(1);
  expect(deletes).toEqual([]);
  expect(await storedKeys()).toContain(seeded.key);
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("添付削除の割り込み");
  author = await insertModifyUser(
    "testuser_attint_author",
    dept.id,
    ONE_MINUTE,
  );
  partner = await insertModifyUser(
    "testuser_attint_partner",
    dept.id,
    ONE_MINUTE,
  );
  open = await insertChannel({
    name: `${TEST_TAG}添付削除の割り込みの公開`,
    purpose: "normal",
    departmentId: dept.id,
    visibility: "public",
  });
  await insertMember(open, author.userId);
  await insertMember(open, partner.userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await cleanupSearchIndex();
  } finally {
    await cleanupAttachmentDeleteScenario();
  }
});

describe("#270 AC-4 確認の後・書き込みの直前に状態が変わる（Service × SQL）", () => {
  it.each<[string, () => Promise<void>, number]>([
    [
      "参加の解除（公開チャンネル）",
      () => leaveChannel(open, author.userId),
      403,
    ],
    ["チャンネルのアーカイブ", () => archiveChannel(open), 404],
    ["部署の無効化", () => deactivateDepartment(dept.id), 409],
  ])(
    "#270 AC-4: %s を挟むと、書き込みは0行になり、読み直しの %i になる。印・監査・索引・R2 は変わらない",
    async (_label, interrupt, status) => {
      const seeded = await seedOn(open);
      const { response, ran, deletes } = await deleteInterleaved(
        seeded.id,
        interrupt,
      );
      expect(ran).toBe(true);
      expect(response.status).toBe(status);
      await expectNothingChanged(seeded, deletes);
    },
  );

  it("#270 AC-2: メッセージの削除を挟むと 404（区別しない）で、印・監査・索引・R2 は変わらない", async () => {
    const seeded = await seedOn(open);
    const { response, ran, deletes } = await deleteInterleaved(seeded.id, () =>
      markDeleted(seeded.messageId, author.userId),
    );
    expect(ran).toBe(true);
    expect(response.status).toBe(404);
    expect(await deletionOf(seeded.id)).toEqual({
      deleted_at: null,
      deleted_by: null,
    });
    expect(await auditRowsOf(ATTACHMENT_DELETE_ACTION, seeded.id)).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it("#270 AC-4: DM の相手の無効化を挟むと 409 で、何も変わらない", async () => {
    const dm = await insertDm(author.userId, partner.userId);
    const seeded = await seedOn(dm);
    const { response, ran, deletes } = await deleteInterleaved(seeded.id, () =>
      deactivateUser(partner.userId),
    );
    expect(ran).toBe(true);
    expect(response.status).toBe(409);
    await expectNothingChanged(seeded, deletes);
  });

  it("#270 AC-4（C-142(1)・147-C-1 の前例）: 非公開の部屋で、本人の無効化（参加の行は残す）を挟むと、見えない扱いの 404 で、何も変わらない", async () => {
    const secret = await insertChannel({
      name: `${TEST_TAG}添付削除の割り込みの非公開`,
      purpose: "normal",
      departmentId: dept.id,
      visibility: "private",
    });
    await insertMember(secret, author.userId);
    const seeded = await seedOn(secret);
    const { response, ran, deletes } = await deleteInterleaved(seeded.id, () =>
      deactivateUser(author.userId),
    );
    expect(ran).toBe(true);
    expect(response.status).toBe(404);
    await expectNothingChanged(seeded, deletes);
  });

  it("#270 AC-4 対照: 何も挟まなければ（同じ包み方で）204 になり、印が付いて実体の削除を1回試す", async () => {
    const seeded = await seedOn(open);
    const { response, ran, deletes } = await deleteInterleaved(
      seeded.id,
      async () => {},
    );
    expect(ran).toBe(true);
    expect(response.status).toBe(204);
    expect(deletes).toEqual([seeded.key]);
    expect(await attachmentDocumentCount(seeded.id)).toBe(0);
  });
});
