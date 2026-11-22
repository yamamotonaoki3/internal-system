// #270（270-B）AC-5 の SQL・計画 2.6：本文を目印（本文なし）にする更新の条件（updateBodyIfModifiable）を、隔離 D1 で確かめる（DB の層）。
// 根拠（実装から写さない）：
//   計画 2.6：新しい本文が目印のときだけ、「そのメッセージに、削除されていない添付がある」を書き込みの条件に足す（batch の経路・互換の経路の両方）。
//     条件が崩れれば、指名・通知・本文の書き込みのどれも行わない（0 行）。本文が目印でないときは条件を足さない（いまの編集の動きを変えない）
//   決定1：目印は半角の空白1文字（test/attachment-only-fixtures.ts の STORED_EMPTY_BODY。本番の定数から作らない）
// 対象でない添付（decoy）を、同じ利用者の別のメッセージに置く（#294：相関の誤りで常に真になる場合を検出する）。
// データは架空（testuser_modblank_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { markAttachmentDeleted } from "../../test/attachment-delete-fixtures";
import {
  cleanupAttachmentScenario,
  createThreadWorld,
  insertAttachmentRow,
  type ThreadWorld,
} from "../../test/attachment-fixtures";
import {
  STORED_EMPTY_BODY,
  cleanupAttachmentOnlyLeftovers,
  rowCount,
} from "../../test/attachment-only-fixtures";
import { TEST_TAG } from "../../test/department-fixtures";
import { messageRow } from "../../test/message-modify-fixtures";
import { seedParent } from "../../test/thread-fixtures";
import { withMessages } from "./message.repository";

const ORIGINAL = `${TEST_TAG}更新の前の本文`;
const EDITED = `${TEST_TAG}更新の後の本文`;

let world: ThreadWorld;
let n = 10;

type Path = "batch" | "compat";

/** batch の経路（roomId・mentions を渡す）か、互換の経路（roomId なし）で更新する */
function update(
  path: Path,
  messageId: string,
  body: string,
  mentions: { userId: string; start: number; end: number }[] = [],
) {
  return withMessages(env, (repository) =>
    repository.updateBodyIfModifiable({
      messageId,
      userId: world.alice.userId,
      body,
      editedAt: "2026-11-22T01:00:00.000Z",
      ...(path === "batch"
        ? { roomId: world.channel, parentMessageId: messageId, mentions }
        : {}),
    }),
  );
}

async function seed(attachments: "none" | "visible" | "deleted") {
  n += 1;
  const id = await seedParent(world.channel, world.alice.userId, n, ORIGINAL);
  if (attachments !== "none") {
    const attachment = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
      messageId: id,
    });
    if (attachments === "deleted")
      await markAttachmentDeleted(attachment, world.alice.userId);
  }
  return id;
}

beforeEach(async () => {
  n = 10;
  world = await createThreadWorld("modblank");
  // 対象でない添付（decoy）：同じ利用者の別のメッセージに、見える添付がある
  const decoyMessage = await seedParent(world.channel, world.alice.userId, 1);
  await insertAttachmentRow({
    roomId: world.channel,
    uploaderId: world.alice.userId,
    messageId: decoyMessage,
  });
});

afterEach(async () => {
  try {
    await cleanupAttachmentOnlyLeftovers();
  } finally {
    await cleanupAttachmentScenario();
  }
});

describe("#270 AC-5 目印への更新は、見える添付があるときだけ", () => {
  it.each<Path>(["batch", "compat"])(
    "#270 AC-5（%s の経路）: 見える添付が1件あれば、目印への更新は 1 行で、本文は目印になる",
    async (path) => {
      const id = await seed("visible");
      expect(await update(path, id, STORED_EMPTY_BODY)).toBe(1);
      expect((await messageRow(id))?.body).toBe(STORED_EMPTY_BODY);
    },
  );

  it.each<[Path, "none" | "deleted"]>([
    ["batch", "none"],
    ["batch", "deleted"],
    ["compat", "none"],
    ["compat", "deleted"],
  ])(
    "#270 AC-5（%s の経路・添付 %s）: 見える添付がないと、目印への更新は 0 行で、本文も edited_at も変わらない（別のメッセージの添付には左右されない）",
    async (path, attachments) => {
      const id = await seed(attachments);
      expect(await update(path, id, STORED_EMPTY_BODY)).toBe(0);
      expect(await messageRow(id)).toMatchObject({
        body: ORIGINAL,
        edited_at: null,
      });
    },
  );

  it("#270 AC-5（batch の経路）: 0 行のときは、指名も通知も増えない", async () => {
    const id = await seed("none");
    const mentions = await rowCount("message_mentions");
    const notifications = await rowCount("notifications");
    expect(
      await update("batch", id, STORED_EMPTY_BODY, [
        { userId: world.bob.userId, start: 0, end: 1 },
      ]),
    ).toBe(0);
    expect(await rowCount("message_mentions")).toBe(mentions);
    expect(await rowCount("notifications")).toBe(notifications);
  });
});

describe("#270 AC-5（いまの動きを変えない）目印でない本文の更新は、添付の有無に左右されない", () => {
  it.each<[Path, "none" | "visible" | "deleted"]>([
    ["batch", "none"],
    ["batch", "visible"],
    ["batch", "deleted"],
    ["compat", "none"],
    ["compat", "visible"],
  ])(
    "#270 AC-5（%s の経路・添付 %s）: ふつうの本文への更新は 1 行",
    async (path, attachments) => {
      const id = await seed(attachments);
      expect(await update(path, id, EDITED)).toBe(1);
      expect((await messageRow(id))?.body).toBe(EDITED);
    },
  );

  it("#270 AC-5（境界）: 空白2文字の本文（目印と完全に等しくない）は、添付がなくても条件を足さない（1 行）", async () => {
    const id = await seed("none");
    expect(await update("batch", id, "  ")).toBe(1);
  });
});
