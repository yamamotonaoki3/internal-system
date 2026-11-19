// #148（148-B-1）5-2 AC-7（参加者の部分）・C-62・R-62・R-64、計画 148-B-1「一覧の SQL」：案件の添付の一覧の Repository
// （case-attachment.repository.ts）を、マイグレーション済みの D1 で確かめる。
// この層で確かめるもの：
//   一覧に出る範囲（その案件の部屋の、投稿済みで、削除されていないメッセージの添付だけ。トップレベル・返信の両方。返信の親が削除済みでも、
//   返信が残っていれば出す＝配信と同じ）。未投稿・削除済みのメッセージの添付・ほかの案件・通常のチャンネルの添付は混ざらない。
//   並び（添付の ID の降順）・ページ送り（limit 件と nextCursor。重なりも抜けもない）・D1 の上限を超える件数。項目の形（保存キーを含まない）。
//   読み取りの資格（閲覧者が有効な参加者でなければ not_visible で中身を返さない。参加していない担当部署のオーナー・全体管理者
//   〔管理の資格はあるが参加していない人〕・参加の行が残った無効の利用者・ほかの案件の有効な参加者も同じ）。終了した案件でも読める。
// 判定の順・応答コードは、Service のテスト（services/case-attachment.service.test.ts）と結合テスト（routes/cases.attachments.test.ts）で確かめ、ここでは重ねない。
// 契約（実装前の仮置き。実装の担当へ）：backend/src/db/case-attachment.repository.ts
//   withCaseAttachments(env, (repository, roles) => …)・createCaseAttachmentRepository(db)
//   repository.findAttachmentListFacts({ caseId, actorId }): Promise<{ isParticipant: boolean } | null>（案件がなければ null）
//   repository.listCaseAttachments({ caseId, viewerId, limit, cursor: string | null }):
//     Promise<"not_found" | "not_visible" | { items: CaseAttachmentItem[]; nextCursor: string | null }>
//   CaseAttachmentItem = { id, name, kind, contentType, size, uploadedAt, messageId, threadParentId: string | null,
//     uploader: { id, displayName, isActive } }（uploadedAt は添付の created_at。displayName は利用者のいまの表示名）
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CASE_ATTACHMENT_ITEM_KEYS,
  CASE_ATTACHMENT_UPLOADER_KEYS,
  caseAttachmentIdAt,
  caseAttachmentIsoAt,
  caseAttachmentName,
  markMessageDeleted,
  seedCaseAttachment,
  seedManyCaseAttachments,
} from "../../test/case-attachment-fixtures";
import {
  MISSING_CASE_ID,
  removeCaseMember,
  setDisplayName,
} from "../../test/case-fixtures";
import { setUserActive } from "../../test/case-request-fixtures";
import {
  cleanupCaseRoomWorld,
  insertCaseWorldDm,
  seedRoomMessage,
  seedRoomReply,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { withCaseAttachments } from "./case-attachment.repository";

type Uploader = { id: string; displayName: string; isActive: boolean };
type Item = {
  publicationVisibility?: string;
  canChangeVisibility?: boolean;
  id: string;
  name: string;
  kind: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  messageId: string;
  threadParentId: string | null;
  uploader: Uploader;
};
type Page = { items: Item[]; nextCursor: string | null };

const NAME_S1 = "テスト投稿者148B";
const NAME_D1 = "テスト参加者148B";

let cw: CaseRoomWorld;

const list = (
  viewerId: string,
  options: { caseId?: string; limit?: number; cursor?: string | null } = {},
) =>
  withCaseAttachments(env, (r) =>
    r.listCaseAttachments({
      caseId: options.caseId ?? cw.open.id,
      viewerId,
      limit: options.limit ?? 100,
      cursor: options.cursor ?? null,
    }),
  );
async function listOk(
  viewerId: string,
  options: { caseId?: string; limit?: number; cursor?: string | null } = {},
): Promise<Page> {
  const result = await list(viewerId, options);
  if (typeof result === "string") throw new Error(`一覧が ${result}`);
  return result as Page;
}
const idsOf = (page: Page) => page.items.map((item) => item.id);

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1560);
  await setDisplayName(cw.w.memberS1.id, NAME_S1);
  await setDisplayName(cw.w.memberD1.id, NAME_D1);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 AC-7 148-B-1 一覧に出る範囲と並び", () => {
  it("#148 AC-7: その案件の投稿済みの添付（トップレベル・返信）が、添付の ID の降順で出る。threadParentId は返信だけ親の ID", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
    const reply = await seedRoomReply(
      cw.open.roomId,
      parent,
      cw.w.memberD1.id,
      2,
    );
    await seedCaseAttachment({
      n: 1,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: parent,
    });
    await seedCaseAttachment({
      n: 3,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberD1.id,
      messageId: reply,
      threadParentId: parent,
    });
    await seedCaseAttachment({
      n: 2,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: parent,
    });
    const page = await listOk(cw.w.memberS1.id);
    expect(
      page.items.map((i) => [i.id, i.messageId, i.threadParentId]),
    ).toEqual([
      [caseAttachmentIdAt(3), reply, parent],
      [caseAttachmentIdAt(2), parent, null],
      [caseAttachmentIdAt(1), parent, null],
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("#148 AC-7 C-62: 項目は名前・種類・形式・大きさ・添付の時刻・元のメッセージ・投稿者（表示名だけ）。保存キーは含まない", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
    await seedCaseAttachment({
      n: 5,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: parent,
      kind: "image",
      contentType: "image/png",
      sizeBytes: 1234,
    });
    const [item] = (await listOk(cw.w.memberD1.id)).items;
    expect(item).toEqual({
      id: caseAttachmentIdAt(5),
      name: caseAttachmentName(5),
      kind: "image",
      contentType: "image/png",
      size: 1234,
      uploadedAt: caseAttachmentIsoAt(5),
      messageId: parent,
      threadParentId: null,
      uploader: { id: cw.w.memberS1.id, displayName: NAME_S1, isActive: true },
      // #148（148-B-2）で加わる項目：既定は参加者限定。閲覧者 memberD1 は投稿者でも管理の資格もないので変更できない
      publicationVisibility: "participants_only",
      canChangeVisibility: false,
    });
    expect(Object.keys(item ?? {}).sort()).toEqual([
      ...CASE_ATTACHMENT_ITEM_KEYS,
    ]);
    expect(Object.keys(item?.uploader ?? {}).sort()).toEqual([
      ...CASE_ATTACHMENT_UPLOADER_KEYS,
    ]);
  });

  it("#148 AC-7: 投稿者が無効（退職）になっていれば、uploader.isActive は false", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 1);
    await seedCaseAttachment({
      n: 1,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberD1.id,
      messageId: parent,
    });
    await setUserActive(cw.w.memberD1.id, false);
    const [item] = (await listOk(cw.w.memberS1.id)).items;
    expect(item?.uploader).toEqual({
      id: cw.w.memberD1.id,
      displayName: NAME_D1,
      isActive: false,
    });
  });

  it("#148 AC-7 C-62: 未投稿の添付（本人のものも）・削除されたメッセージの添付・ほかの案件・通常のチャンネル・DM の添付は混ざらない", async () => {
    const kept = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
    const deleted = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 2);
    const otherMessage = await seedRoomMessage(
      cw.other.roomId,
      cw.w.memberS2.id,
      3,
    );
    const normalMessage = await seedRoomMessage(cw.normal, cw.w.memberS1.id, 4);
    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    const dmMessage = await seedRoomMessage(dm, cw.w.memberS1.id, 5);
    await seedCaseAttachment({
      n: 1,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: kept,
    });
    // 未投稿（閲覧者本人のもの）
    await seedCaseAttachment({
      n: 2,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: null,
    });
    // 未投稿の返信への添付
    await seedCaseAttachment({
      n: 3,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: null,
      threadParentId: kept,
    });
    await seedCaseAttachment({
      n: 4,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: deleted,
    });
    await markMessageDeleted(deleted, cw.w.memberS1.id);
    await seedCaseAttachment({
      n: 5,
      roomId: cw.other.roomId,
      uploaderId: cw.w.memberS2.id,
      messageId: otherMessage,
    });
    await seedCaseAttachment({
      n: 6,
      roomId: cw.normal,
      uploaderId: cw.w.memberS1.id,
      messageId: normalMessage,
    });
    await seedCaseAttachment({
      n: 7,
      roomId: dm,
      uploaderId: cw.w.memberS1.id,
      messageId: dmMessage,
    });
    expect(idsOf(await listOk(cw.w.memberS1.id))).toEqual([
      caseAttachmentIdAt(1),
    ]);
  });

  it("#148 AC-7 計画「元のメッセージへ」: 返信の親が削除済みでも、返信が残っていれば、その返信の添付は出る（配信と同じ）。削除された返信の添付は出ない", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
    const reply = await seedRoomReply(
      cw.open.roomId,
      parent,
      cw.w.memberD1.id,
      2,
    );
    const deletedReply = await seedRoomReply(
      cw.open.roomId,
      parent,
      cw.w.memberD1.id,
      3,
    );
    await seedCaseAttachment({
      n: 1,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberD1.id,
      messageId: reply,
      threadParentId: parent,
    });
    await seedCaseAttachment({
      n: 2,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberD1.id,
      messageId: deletedReply,
      threadParentId: parent,
    });
    await markMessageDeleted(parent, cw.w.memberS1.id);
    await markMessageDeleted(deletedReply, cw.w.memberD1.id);
    const page = await listOk(cw.w.memberS1.id);
    expect(page.items.map((i) => [i.id, i.threadParentId])).toEqual([
      [caseAttachmentIdAt(1), parent],
    ]);
  });

  it("#148 AC-7: 添付が1件もなければ items は空で、nextCursor は null", async () => {
    await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
    expect(await listOk(cw.w.memberS1.id)).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("#148 AC-7 5-1 AC-11: 終了した案件でも、参加者は一覧を読める", async () => {
    const parent = await seedRoomMessage(cw.closed.roomId, cw.w.memberS1.id, 1);
    await seedCaseAttachment({
      n: 1,
      roomId: cw.closed.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: parent,
    });
    expect(
      idsOf(await listOk(cw.w.memberD1.id, { caseId: cw.closed.id })),
    ).toEqual([caseAttachmentIdAt(1)]);
  });
});

describe("#148 AC-7 148-B-1 ページ送り", () => {
  it("#148 AC-7: limit 件ずつ、続きがあれば nextCursor、最後は null。重なりも抜けもない", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
    for (const n of [1, 2, 3, 4, 5])
      await seedCaseAttachment({
        n,
        roomId: cw.open.roomId,
        uploaderId: cw.w.memberS1.id,
        messageId: parent,
      });
    const first = await listOk(cw.w.memberS1.id, { limit: 2 });
    expect(idsOf(first)).toEqual([
      caseAttachmentIdAt(5),
      caseAttachmentIdAt(4),
    ]);
    expect(first.nextCursor).not.toBeNull();
    const second = await listOk(cw.w.memberS1.id, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(idsOf(second)).toEqual([
      caseAttachmentIdAt(3),
      caseAttachmentIdAt(2),
    ]);
    const third = await listOk(cw.w.memberS1.id, {
      limit: 2,
      cursor: second.nextCursor,
    });
    expect(idsOf(third)).toEqual([caseAttachmentIdAt(1)]);
    expect(third.nextCursor).toBeNull();
  });

  it("#148 AC-7: ちょうど limit 件なら nextCursor は null（limit＋1 件を読んで続きを決める）", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
    for (const n of [1, 2])
      await seedCaseAttachment({
        n,
        roomId: cw.open.roomId,
        uploaderId: cw.w.memberS1.id,
        messageId: parent,
      });
    const page = await listOk(cw.w.memberS1.id, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("#148 AC-7 D1 の上限: 150件の添付でも、1回100件、続きで残りの50件（ほかの部屋の添付は混ざらない）", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
    await seedManyCaseAttachments({
      from: 100,
      count: 150,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: parent,
    });
    const normalMessage = await seedRoomMessage(cw.normal, cw.w.memberS1.id, 2);
    await seedManyCaseAttachments({
      from: 400,
      count: 60,
      roomId: cw.normal,
      uploaderId: cw.w.memberS1.id,
      messageId: normalMessage,
    });
    const first = await listOk(cw.w.memberS1.id, { limit: 100 });
    expect(first.items).toHaveLength(100);
    expect(first.items[0]?.id).toBe(caseAttachmentIdAt(249));
    const second = await listOk(cw.w.memberS1.id, {
      limit: 100,
      cursor: first.nextCursor,
    });
    expect(second.items).toHaveLength(50);
    expect(second.items.at(-1)?.id).toBe(caseAttachmentIdAt(100));
    expect(second.nextCursor).toBeNull();
    const all = new Set([...idsOf(first), ...idsOf(second)]);
    expect(all.size).toBe(150);
  });
});

describe("#148 AC-7 #196 読み取りの資格", () => {
  async function seedOne() {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
    await seedCaseAttachment({
      n: 1,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: parent,
    });
  }

  it.each([
    ["非参加の一般社員", () => cw.w.noDept.id],
    ["参加の行が残った無効な利用者", () => cw.w.inactive.id],
    [
      "参加していない担当部署のオーナー（管理の資格はある）",
      () => cw.w.ownerS.id,
    ],
    ["参加していない全体管理者（管理の資格はある）", () => cw.w.admin.id],
    [
      "ほかの案件の有効な参加者（#294 相関が常に真でないこと）",
      () => cw.w.memberS2.id,
    ],
  ])(
    "#148 AC-7 R-62・R-64: 閲覧者が %s なら not_visible で、添付を返さない",
    async (_label, viewer) => {
      await seedOne();
      expect(await list(viewer())).toBe("not_visible");
    },
  );

  it("#148 AC-7: 案件がなければ not_found", async () => {
    expect(await list(cw.w.memberS1.id, { caseId: MISSING_CASE_ID })).toBe(
      "not_found",
    );
  });

  it.each([
    [
      "参加者から外された",
      () => removeCaseMember(cw.open.roomId, cw.w.memberS1.id),
    ],
    ["無効になった", () => setUserActive(cw.w.memberS1.id, false)],
  ])(
    "#148 AC-7 #196: 閲覧者が %s 後の読み取りは not_visible（前の添付を返さない）",
    async (_label, lose) => {
      await seedOne();
      expect(idsOf(await listOk(cw.w.memberS1.id))).toHaveLength(1);
      await lose();
      expect(await list(cw.w.memberS1.id)).toBe("not_visible");
    },
  );
});

describe("#148 AC-7 148-B-1 判定の材料（findAttachmentListFacts）", () => {
  const facts = (caseId: string, actorId: string) =>
    withCaseAttachments(env, (r) =>
      r.findAttachmentListFacts({ caseId, actorId }),
    );

  it("#148 AC-7: 有効な参加者は isParticipant が真", async () => {
    expect(await facts(cw.open.id, cw.w.memberS1.id)).toEqual({
      isParticipant: true,
    });
  });

  it.each([
    ["非参加の一般社員", () => cw.w.noDept.id],
    ["参加の行が残った無効な利用者", () => cw.w.inactive.id],
    ["参加していない担当部署のオーナー", () => cw.w.ownerS.id],
    ["参加していない全体管理者", () => cw.w.admin.id],
    ["ほかの案件の有効な参加者", () => cw.w.memberS2.id],
  ])("#148 AC-7: %s は isParticipant が偽", async (_label, actor) => {
    expect(await facts(cw.open.id, actor())).toEqual({ isParticipant: false });
  });

  it("#148 AC-7: 案件がなければ null", async () => {
    expect(await facts(MISSING_CASE_ID, cw.w.memberS1.id)).toBeNull();
  });
});
