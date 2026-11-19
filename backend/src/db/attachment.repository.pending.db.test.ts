// #148（148-A）5-2 AC-2・計画「レビュー1回目への対応」重大1：未投稿の添付の登録（attachment.repository.ts の insertPending）を、
// 保存の時点の資格を条件にした登録（INSERT … SELECT … WHERE）にする。部屋の種類によらない1つの条件：
//   部屋が未アーカイブ・アップロードした人が有効な参加者（DM は当事者で、当事者に無効な社員がいない）・案件の部屋なら案件が進行中（caseRoomOpen）
//   ・返信先（threadParentId）があれば、親が存在して未削除で、同じ部屋のトップレベルの投稿
// この層で確かめるもの（計画 148-A のテストケース「添付の登録」）：条件を外れれば0行（行が残らない）、満たせば1行（通常のチャンネル・DM・案件の部屋）。
// R2 の後始末・読み直しの応答（404／403／409）は、Service（services/attachment.upload-race.test.ts）と結合のテストで確かめ、ここでは重ねない。
// 契約（実装前の仮置き。実装の担当へ）：repository.insertPending(input: PendingAttachmentInsert): Promise<number>（登録した行数 1 か 0）
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_PREFIX, attachmentRow } from "../../test/attachment-fixtures";
import { publicationVisibilityOf } from "../../test/case-attachment-fixtures";
import {
  cleanupCaseRoomWorld,
  insertCaseWorldDm,
  seedRoomMessage,
  seedRoomReply,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import {
  removeOwner,
  setDepartmentActive,
} from "../../test/case-request-fixtures";
import { deactivateUser } from "../../test/dm-fixtures";
import {
  archiveChannel,
  markDeleted,
} from "../../test/message-modify-fixtures";
import { ulidAtMs } from "../../test/read-position-fixtures";
import { withAttachments } from "./attachment.repository";

let cw: CaseRoomWorld;
let counter = 0;

async function register(
  roomId: string,
  uploaderId: string,
  threadParentId: string | null = null,
  // #148（148-B-2）：公開範囲は必須の引数（省略で既定値に落ちる引数にしない）。既存のケースは参加者限定で登録する
  publicationVisibility:
    "participants_only" | "public_archive" = "participants_only",
) {
  counter += 1;
  const id = ulidAtMs(1_850_500_000_000 + counter);
  const changes = await withAttachments(env, (r) =>
    r.insertPending({
      id,
      roomId,
      threadParentId,
      uploaderId,
      storageKey: `${STORAGE_PREFIX}${id}`,
      originalName: "test148.txt",
      kind: "document",
      contentType: "text/plain; charset=utf-8",
      sizeBytes: 10,
      publicationVisibility,
    }),
  );
  return { changes, row: await attachmentRow(id), id };
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1500);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 5-2 AC-2 未投稿の添付の登録：条件を満たせば1行", () => {
  it("#148 5-2 AC-2: 進行中の案件の部屋で、有効な参加者は部屋への添付・返信への添付を登録できる", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 1);
    const toRoom = await register(cw.open.roomId, cw.w.memberS1.id);
    const toReply = await register(cw.open.roomId, cw.w.memberS1.id, parent);
    expect(toRoom.changes).toBe(1);
    expect(toRoom.row).toMatchObject({
      room_id: cw.open.roomId,
      uploader_id: cw.w.memberS1.id,
      thread_parent_id: null,
      message_id: null,
    });
    expect(toReply.changes).toBe(1);
    expect(toReply.row).toMatchObject({ thread_parent_id: parent });
  });

  it("#148 退行なし: 通常のチャンネルの参加者・DM の当事者は登録できる", async () => {
    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    expect((await register(cw.normal, cw.w.memberD1.id)).changes).toBe(1);
    expect((await register(dm, cw.w.memberS1.id)).changes).toBe(1);
  });
});

describe("#148 5-2 AC-2 未投稿の添付の登録：保存の時点の資格がなければ0行（行が残らない）", () => {
  it("#148 5-1 AC-11: 終了の案件の部屋では、参加者でも0行（部屋・返信の両方）", async () => {
    const parent = await seedRoomMessage(cw.closed.roomId, cw.w.memberD1.id, 2);
    const toRoom = await register(cw.closed.roomId, cw.w.memberS1.id);
    const toReply = await register(cw.closed.roomId, cw.w.memberS1.id, parent);
    expect([toRoom.changes, toReply.changes]).toEqual([0, 0]);
    expect([toRoom.row, toReply.row]).toEqual([null, null]);
  });

  it("#148 5-2 AC-3: 案件の部屋の非参加者（ほかの案件の参加者）は0行", async () => {
    const result = await register(cw.open.roomId, cw.w.memberS2.id);
    expect(result).toMatchObject({ changes: 0, row: null });
  });

  it("#148 147-C-1: 参加の行が残った無効の利用者は0行", async () => {
    const result = await register(cw.open.roomId, cw.w.inactive.id);
    expect(result).toMatchObject({ changes: 0, row: null });
  });

  it("#148 退行なし: 通常のチャンネルの未参加者・アーカイブ中の部屋は0行", async () => {
    expect((await register(cw.normal, cw.w.memberS2.id)).changes).toBe(0);
    await archiveChannel(cw.normal);
    expect((await register(cw.normal, cw.w.memberS1.id)).changes).toBe(0);
  });

  it("#148 退行なし: DM の当事者でない人、当事者に無効な社員がいる DM は0行", async () => {
    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    expect((await register(dm, cw.w.memberS2.id)).changes).toBe(0);
    await deactivateUser(cw.w.memberD1.id);
    expect((await register(dm, cw.w.memberS1.id)).changes).toBe(0);
  });

  it("#148 5-2 AC-2: 返信先が削除済み・返信（トップレベルでない）・別の部屋の投稿・存在しないなら0行", async () => {
    const deleted = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 3);
    await markDeleted(deleted, cw.w.memberD1.id);
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 4);
    const replyRow = await seedRoomReply(
      cw.open.roomId,
      parent,
      cw.w.memberD1.id,
      5,
    );
    const elsewhere = await seedRoomMessage(cw.normal, cw.w.memberD1.id, 6);
    const results = [
      await register(cw.open.roomId, cw.w.memberS1.id, deleted),
      await register(cw.open.roomId, cw.w.memberS1.id, replyRow),
      await register(cw.open.roomId, cw.w.memberS1.id, elsewhere),
      await register(
        cw.open.roomId,
        cw.w.memberS1.id,
        ulidAtMs(1_700_000_000_000),
      ),
    ];
    expect(results.map((r) => r.changes)).toEqual([0, 0, 0, 0]);
    // 比べる相手：同じ部屋の未削除の親なら1行
    expect(
      (await register(cw.open.roomId, cw.w.memberS1.id, parent)).changes,
    ).toBe(1);
  });
});

// #148 コードレビュー1回目の重大1：最初の判定（requirePostable・requireReplyable）が見ている、お知らせ専用の投稿の資格と、
// 返信先の部屋の部署の有効性も、保存の時点の条件に入れる。
describe("#148 重大1 お知らせ専用の投稿の資格・返信先の部署の有効性", () => {
  it("#148 重大1(a): お知らせ専用のチャンネルには、その部署のオーナーは登録でき、オーナーでない参加者・オーナーを外された人は0行", async () => {
    const room = cw.w.deptS.announcementChannelId;
    expect((await register(room, cw.w.ownerS.id)).changes).toBe(1);
    expect((await register(room, cw.w.memberS1.id)).changes).toBe(0);
    await removeOwner(cw.w.ownerS.id, cw.w.deptS.id);
    expect((await register(room, cw.w.ownerS.id)).changes).toBe(0);
  });

  it("#148 重大1(a): 全体管理者は、参加しているお知らせ専用のチャンネルに登録できる", async () => {
    expect(
      (await register(cw.w.deptH.announcementChannelId, cw.w.admin.id)).changes,
    ).toBe(1);
  });

  it("#148 重大1(b): 返信への添付は、部屋の部署が無効なら0行、有効なら1行（部屋への添付は部署の有効性を問わない）", async () => {
    const room = cw.w.deptS.dedicatedChannelId;
    const parent = await seedRoomMessage(room, cw.w.memberS2.id, 80);
    expect((await register(room, cw.w.memberS1.id, parent)).changes).toBe(1);
    await setDepartmentActive(cw.w.deptS.id, false);
    expect((await register(room, cw.w.memberS1.id, parent)).changes).toBe(0);
    expect((await register(room, cw.w.memberS1.id)).changes).toBe(1);
    await setDepartmentActive(cw.w.deptS.id, true);
  });
});

// #148（148-B-2）5-2 AC-8・計画 6.3：公開範囲つきの登録。全社員公開アーカイブで公開できる（public_archive）は案件の部屋だけ
// （Service の 422 と突き合わせる二重の守り）。参加者限定（participants_only）はどの部屋でも登録できる。既存の資格の条件は値によらない。
describe("#148 AC-8 未投稿の添付の登録：公開範囲", () => {
  it("#148 AC-8: 案件の部屋（部屋・返信）では public_archive を1行登録し、その値が行に残る", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 1);
    const toRoom = await register(
      cw.open.roomId,
      cw.w.memberS1.id,
      null,
      "public_archive",
    );
    const toReply = await register(
      cw.open.roomId,
      cw.w.memberS1.id,
      parent,
      "public_archive",
    );
    expect([toRoom.changes, toReply.changes]).toEqual([1, 1]);
    expect(await publicationVisibilityOf(toRoom.id)).toBe("public_archive");
    expect(await publicationVisibilityOf(toReply.id)).toBe("public_archive");
  });

  it("#148 AC-8: 通常のチャンネル・DM（部屋・返信）では public_archive は0行（行が残らない）", async () => {
    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    const normalParent = await seedRoomMessage(cw.normal, cw.w.memberD1.id, 2);
    const dmParent = await seedRoomMessage(dm, cw.w.memberD1.id, 3);
    const results = [
      await register(cw.normal, cw.w.memberD1.id, null, "public_archive"),
      await register(
        cw.normal,
        cw.w.memberD1.id,
        normalParent,
        "public_archive",
      ),
      await register(dm, cw.w.memberS1.id, null, "public_archive"),
      await register(dm, cw.w.memberS1.id, dmParent, "public_archive"),
    ];
    expect(results.map((r) => [r.changes, r.row])).toEqual([
      [0, null],
      [0, null],
      [0, null],
      [0, null],
    ]);
  });

  it("#148 AC-8: participants_only はどの部屋でも1行で、その値が行に残る", async () => {
    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    const results = [
      await register(cw.open.roomId, cw.w.memberS1.id),
      await register(cw.normal, cw.w.memberD1.id),
      await register(dm, cw.w.memberS1.id),
    ];
    expect(results.map((r) => r.changes)).toEqual([1, 1, 1]);
    for (const r of results)
      expect(await publicationVisibilityOf(r.id)).toBe("participants_only");
  });

  it("#148 AC-8: 既存の資格の条件（終了・非参加・無効）を外れれば、public_archive でも0行", async () => {
    const results = [
      await register(
        cw.closed.roomId,
        cw.w.memberS1.id,
        null,
        "public_archive",
      ),
      await register(cw.open.roomId, cw.w.memberS2.id, null, "public_archive"),
      await register(cw.open.roomId, cw.w.inactive.id, null, "public_archive"),
    ];
    expect(results.map((r) => r.changes)).toEqual([0, 0, 0]);
  });
});

// #148（148-B-2）計画 D5・手順0：insertPending の列の名前を明示する前後で、全部の部屋の行の各列が同じ値で入ること（列の取り違えの検出）
describe("#148 D5 未投稿の添付の登録：各列の値（列の取り違えがない）", () => {
  it.each([
    ["案件の部屋", () => cw.open.roomId, () => cw.w.memberS1.id],
    ["通常のチャンネル", () => cw.normal, () => cw.w.memberD1.id],
  ])(
    "#148 D5: %s の行の各列が、渡した値のまま入る",
    async (_l, room, uploader) => {
      const parent = await seedRoomMessage(room(), uploader(), 90);
      const result = await register(room(), uploader(), parent);
      expect(result.row).toEqual({
        id: result.id,
        room_id: room(),
        thread_parent_id: parent,
        message_id: null,
        uploader_id: uploader(),
        storage_key: `${STORAGE_PREFIX}${result.id}`,
        original_name: "test148.txt",
        kind: "document",
        content_type: "text/plain; charset=utf-8",
        size_bytes: 10,
        created_at: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        ) as unknown,
      });
    },
  );

  it("#148 D5: DM の行の各列が、渡した値のまま入る", async () => {
    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    const result = await register(dm, cw.w.memberS1.id);
    expect(result.row).toMatchObject({
      room_id: dm,
      thread_parent_id: null,
      message_id: null,
      uploader_id: cw.w.memberS1.id,
      original_name: "test148.txt",
      kind: "document",
      content_type: "text/plain; charset=utf-8",
      size_bytes: 10,
    });
  });
});
