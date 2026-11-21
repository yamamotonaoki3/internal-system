// #270（270-A）1-6 AC-4・計画 4.3「条件（DAO の deletable）」・7章「資格」：削除してよい条件の事例表を、隔離 D1 で確かめる（DB の層）。
// 条件（計画 4.3）：添付が存在し・deleted_at が NULL・message_id が NULL でない・uploader_id が本人、かつ、結ぶメッセージが同じ部屋で、
//   message-modify.sql.ts の modifiable（本人の投稿・未削除・チャンネルは有効な参加者・未アーカイブ・案件が進行中・部署が有効／DM は当事者で相手が有効）を満たす。
// どの事例も、同じ利用者が消せる「対象でない添付」（decoy。別の部署のチャンネル）を別に置く（#294：相関の誤りで常に真になる場合を検出する）。
// 案件の終了は attachments.delete.case-room.test.ts（結合）で確かめる。
// 契約（実装前の仮置き。実装の担当へ）：backend/src/db/attachment-delete.sql.ts
//   deletable(attachmentId: string, userId: string): SQL（真偽になる式。SELECT や WHERE にそのまま置ける）
// データは架空（testuser_attdao_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupAttachmentDeleteScenario,
  markAttachmentDeleted,
} from "../../test/attachment-delete-fixtures";
import { insertAttachmentRow } from "../../test/attachment-fixtures";
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
import { deletable } from "./attachment-delete.sql";
import { withDatabase } from "./database";

let dept: SeededDepartment;
let author: ModifyUser;
let other: ModifyUser;
let third: ModifyUser;
let room: string;
let decoy: string;
let seq = 0;

async function post(roomId: string, senderId = author.userId) {
  seq += 1;
  const id = ulidAt(1_892_000_000_000 + seq * 1_000);
  await insertMessage({
    roomId,
    senderId,
    id,
    body: `${TEST_TAG}資格の本文${seq}`,
  });
  return id;
}

async function attach(
  roomId: string,
  messageId: string | null,
  uploaderId = author.userId,
) {
  return insertAttachmentRow({ roomId, uploaderId, messageId });
}

async function isDeletable(attachmentId: string, userId = author.userId) {
  return withDatabase(env, async (db) => {
    const rows = await db.all<{ ok: number }>(
      sql`SELECT CASE WHEN ${deletable(attachmentId, userId)} THEN 1 ELSE 0 END AS ok`,
    );
    return rows[0]?.ok === 1;
  });
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("添付削除の資格");
  const decoyDept = await insertDepartmentWithChannels("添付削除の資格の別");
  author = await insertModifyUser("testuser_attdao_author", dept.id);
  other = await insertModifyUser("testuser_attdao_other", dept.id);
  third = await insertModifyUser("testuser_attdao_third", dept.id);
  room = await insertChannel({
    name: `${TEST_TAG}資格の部屋`,
    purpose: "normal",
    departmentId: dept.id,
    visibility: "private",
  });
  await insertMember(room, author.userId);
  await insertMember(room, other.userId);
  const decoyRoom = await insertChannel({
    name: `${TEST_TAG}資格の別の部屋`,
    purpose: "normal",
    departmentId: decoyDept.id,
    visibility: "private",
  });
  await insertMember(decoyRoom, author.userId);
  decoy = await attach(decoyRoom, await post(decoyRoom));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAttachmentDeleteScenario();
});

describe("#270 AC-2・AC-4 deletable の事例表（対象でない添付が別にある状態で）", () => {
  it("#270 AC-1: 本人の投稿に結び付いた本人の添付で、書き込める部屋なら真", async () => {
    expect(await isDeletable(await attach(room, await post(room)))).toBe(true);
    expect(await isDeletable(decoy)).toBe(true);
  });

  it("#270 AC-1: DM の当事者で相手が有効なら真", async () => {
    const dm = await insertDm(author.userId, other.userId);
    expect(await isDeletable(await attach(dm, await post(dm)))).toBe(true);
  });

  const falseCases: [string, () => Promise<string>][] = [
    [
      "他人の添付（他人の投稿）",
      async () => attach(room, await post(room, other.userId), other.userId),
    ],
    [
      "他人の投稿に結び付いた本人の添付（送信者が違う）",
      async () => attach(room, await post(room, other.userId)),
    ],
    [
      "削除済みの添付",
      async () => {
        const id = await attach(room, await post(room));
        await markAttachmentDeleted(id, author.userId);
        return id;
      },
    ],
    ["未投稿の添付", async () => attach(room, null)],
    [
      "削除済みのメッセージの添付",
      async () => {
        const messageId = await post(room);
        const id = await attach(room, messageId);
        await markDeleted(messageId, author.userId);
        return id;
      },
    ],
    [
      "別の部屋のメッセージに結び付いた添付（同じ部屋でない）",
      async () => {
        const elsewhere = await insertChannel({
          name: `${TEST_TAG}資格のよその部屋`,
          purpose: "normal",
          departmentId: dept.id,
          visibility: "private",
        });
        await insertMember(elsewhere, author.userId);
        return attach(room, await post(elsewhere));
      },
    ],
    [
      "一度も参加していない公開チャンネル",
      async () => {
        const open = await insertChannel({
          name: `${TEST_TAG}資格の公開`,
          purpose: "normal",
          departmentId: dept.id,
          visibility: "public",
        });
        return attach(open, await post(open));
      },
    ],
    [
      "参加を外れたチャンネル",
      async () => {
        const id = await attach(room, await post(room));
        await leaveChannel(room, author.userId);
        return id;
      },
    ],
    [
      "アーカイブしたチャンネル",
      async () => {
        const id = await attach(room, await post(room));
        await archiveChannel(room);
        return id;
      },
    ],
    [
      "部署が無効なチャンネル",
      async () => {
        const id = await attach(room, await post(room));
        await deactivateDepartment(dept.id);
        return id;
      },
    ],
    [
      "DM の相手が無効",
      async () => {
        const dm = await insertDm(author.userId, other.userId);
        const id = await attach(dm, await post(dm));
        await deactivateUser(other.userId);
        return id;
      },
    ],
    [
      "DM の第三者（当事者でない）",
      async () => {
        const dm = await insertDm(other.userId, third.userId);
        return attach(dm, await post(dm));
      },
    ],
  ];

  it.each(falseCases)(
    "#270 AC-2・AC-4: %s は偽。対象でない添付（decoy）は真のまま",
    async (_label, make) => {
      const id = await make();
      expect(await isDeletable(id)).toBe(false);
      expect(await isDeletable(decoy)).toBe(true);
    },
  );

  it("#270 AC-4: 無効になった本人は偽（どの添付も）", async () => {
    const id = await attach(room, await post(room));
    await deactivateUser(author.userId);
    expect(await isDeletable(id)).toBe(false);
  });

  it("#270 AC-2: 存在しない添付は偽", async () => {
    expect(await isDeletable("01JZZZZZZZZZZZZZZZZZZZZZZZ")).toBe(false);
    expect(await isDeletable(decoy)).toBe(true);
  });

  it("#270 AC-2: 本人の添付でも、別の利用者を指定すると偽", async () => {
    const id = await attach(room, await post(room));
    expect(await isDeletable(id, other.userId)).toBe(false);
  });
});
