// #155（155-B）I-1〜I-4：添付ファイル名の索引（search_documents の kind = 'attachment'・search_fts）と、書き込みの全経路の整合。
// 期待は、計画（155-B）2章「データ」（ref_id＝添付の ID・room_id＝添付の部屋・message_id＝結ぶメッセージ・created_at＝メッセージの作成日時・
//   source_body と検索用の文＝original_name をそのまま。B-3：記号を除かない）、3章「索引の同期」（投稿・返信の結び付けの batch の末尾に組・
//   結び付けの失敗は batch ごと取り消し・論理削除で消す・本文の編集では変えない・未投稿・未投稿の掃除では何もしない・組はべき等で順序に依らない）、
//   R1-3（名前の書き換えの後の組で、旧の名前で0件・新の名前で1件）、R1-5（削除の拒否：未削除の他人の投稿は残る／削除済みは0件のまま）から決める。実装から写さない。
// 索引の確かめ方は、本番の検索（Repository）を通さず、test/search-fixtures.ts の直接の SQL（MATCH・instr・不一致の分類）で行う。
// 書き込みは本物の Repository（message.repository.ts の insertIfOrdered・insertReplyIfOrdered・updateBodyIfModifiable・deleteIfModifiable、
//   attachment.repository.ts の deletePendingBefore）を隔離 D1 に対して呼ぶ。
// 契約は test/search-fixtures.ts の冒頭（syncAttachmentIndexStatements(db, messageId)）。
// 準備：部署 deptS の利用者 V（memberS1）・O（memberS2）が参加する公開チャンネル ROOM と、別の公開チャンネル OTHER。
// ファイル名は、ほかの行の文字列に含まれない、通し番号つきの語（例「索引添付甲001.txt」）。データは架空（testuser_casereq_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  STORED_EMPTY_BODY,
  cleanupAttachmentOnlyLeftovers,
  messageDocumentBodies,
} from "../../test/attachment-only-fixtures";
import { AUTH_TRACE_PREFIX } from "../../test/auth-fixtures";
import { cleanupCaseTestData } from "../../test/case-fixtures";
import {
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertMember,
} from "../../test/department-fixtures";
import {
  cleanupRelatedReadsRooms,
  fixedIdAt,
  insertAttachmentRow,
} from "../../test/related-reads-fixtures";
import {
  NO_ATTACHMENT_MISMATCH,
  NO_MISMATCH,
  attachmentIndexCountsOf,
  attachmentIndexMismatches,
  buildSearchIndex,
  cleanupSearchIndex,
  ftsInstrAttachmentIds,
  ftsInstrIds,
  ftsMatchAttachmentIds,
  ftsMatchIds,
  indexCountsOf,
  insertAttachmentIndexRow,
  indexMismatches,
  runAttachmentIndexStatements,
  runIndexStatements,
  totalAttachmentDocuments,
  type AttachmentIndexMismatches,
} from "../../test/search-fixtures";
import { withAttachments } from "./attachment.repository";
import { withMessages } from "./message.repository";

const BASE_MS = 1_880_000_000_000;
const ROOM = fixedIdAt(BASE_MS);
const OTHER = fixedIdAt(BASE_MS + 1);
let sequence = 0;
function nextId(): { id: string; at: string } {
  sequence += 1;
  const ms = BASE_MS + 10_000 + sequence * 1_000;
  return { id: fixedIdAt(ms), at: new Date(ms).toISOString() };
}

let w: CaseWorld;
let V: string;
let O: string;

const body = (text: string) => `${TEST_TAG}${text}`;
const traceId = () => `${AUTH_TRACE_PREFIX}search155b-${crypto.randomUUID()}`;

/** 未投稿の添付を入れる（投稿の前の状態） */
function pending(
  originalName: string,
  options: {
    uploaderId?: string;
    roomId?: string;
    threadParentId?: string | null;
    sizeBytes?: number;
  } = {},
) {
  return insertAttachmentRow({
    roomId: options.roomId ?? ROOM,
    uploaderId: options.uploaderId ?? V,
    messageId: null,
    threadParentId: options.threadParentId ?? null,
    originalName,
    ...(options.sizeBytes === undefined
      ? {}
      : { sizeBytes: options.sizeBytes }),
  });
}

async function post(
  senderId: string,
  text: string,
  attachmentIds: string[] = [],
): Promise<{ id: string; at: string; changes: number }> {
  const { id, at } = nextId();
  const changes = await withMessages(env, (repo) =>
    repo.insertIfOrdered({
      id,
      roomId: ROOM,
      senderId,
      senderDisplayName: "テスト太郎",
      body: body(text),
      createdAt: at,
      attachmentIds,
    }),
  );
  return { id, at, changes };
}

async function reply(
  senderId: string,
  parentMessageId: string,
  text: string,
  attachmentIds: string[] = [],
): Promise<{ id: string; at: string; changes: number }> {
  const { id, at } = nextId();
  const changes = await withMessages(env, (repo) =>
    repo.insertReplyIfOrdered({
      id,
      roomId: ROOM,
      parentMessageId,
      senderId,
      senderDisplayName: "テスト太郎",
      body: body(text),
      createdAt: at,
      attachmentIds,
    }),
  );
  return { id, at, changes };
}

const editCompat = (messageId: string, userId: string, text: string) =>
  withMessages(env, (repo) =>
    repo.updateBodyIfModifiable({
      messageId,
      userId,
      body: body(text),
      editedAt: new Date().toISOString(),
    }),
  );

const editBatch = (messageId: string, userId: string, text: string) =>
  withMessages(env, (repo) =>
    repo.updateBodyIfModifiable({
      messageId,
      userId,
      body: body(text),
      editedAt: new Date().toISOString(),
      roomId: ROOM,
      mentions: [],
    }),
  );

const remove = (messageId: string, userId: string) =>
  withMessages(env, (repo) =>
    repo.deleteIfModifiable({
      messageId,
      userId,
      roomId: ROOM,
      deletedAt: new Date().toISOString(),
      traceId: traceId(),
    }),
  );

type DocumentRow = {
  kind: string;
  ref_id: string;
  room_id: string | null;
  message_id: string | null;
  created_at: string;
  source_body: string;
  text: string | null;
};

/** その添付の写し（対応の行と検索用の文） */
async function documentOf(attachmentId: string): Promise<DocumentRow | null> {
  return env.DB.prepare(
    `SELECT d.kind, d.ref_id, d.room_id, d.message_id, d.created_at, d.source_body, f.text AS text
     FROM search_documents d LEFT JOIN search_fts f ON f.rowid = d.id
     WHERE d.kind = 'attachment' AND d.ref_id = ?`,
  )
    .bind(attachmentId)
    .first<DocumentRow>();
}

async function expectConsistent() {
  expect(await attachmentIndexMismatches()).toEqual(NO_ATTACHMENT_MISMATCH);
  expect(await indexMismatches()).toEqual(NO_MISMATCH);
}

beforeEach(async () => {
  sequence = 0;
  w = await setupCaseWorld();
  V = w.memberS1.id;
  O = w.memberS2.id;
  for (const [id, name] of [
    [ROOM, "search-index-att"],
    [OTHER, "search-index-att-other"],
  ] as const) {
    await insertChannel({
      id,
      name: `${TEST_TAG}${name}`,
      purpose: "normal",
      departmentId: w.deptS.id,
      visibility: "public",
    });
    await insertMember(id, V);
    await insertMember(id, O);
  }
});

afterEach(async () => {
  try {
    await cleanupAttachmentOnlyLeftovers();
    await cleanupSearchIndex();
  } finally {
    await cleanupRelatedReadsRooms([ROOM, OTHER]);
    await cleanupCaseTestData();
  }
});

describe("#155 AC-3 155-B I-1 状態の遷移（添付の書き込みの後の索引）", () => {
  it("#155 AC-3 I-1: 添付つきの投稿の後、名前の3文字以上（MATCH）と2文字（instr）で引け、写しの各列は計画 2章のとおり", async () => {
    const attachment = await pending("索引添付甲001.txt");
    const message = await post(V, "添付つきの投稿の本文", [attachment]);
    expect(message.changes).toBe(1);
    expect(await ftsMatchAttachmentIds("索引添付甲001")).toEqual([attachment]);
    expect(await ftsInstrAttachmentIds("甲0")).toEqual([attachment]);
    expect(await documentOf(attachment)).toEqual({
      kind: "attachment",
      ref_id: attachment,
      room_id: ROOM,
      message_id: message.id,
      created_at: message.at,
      source_body: "索引添付甲001.txt",
      text: "索引添付甲001.txt",
    });
    await expectConsistent();
  });

  it("#155 AC-3 I-1: 写しの作成日時はメッセージの作成日時（アップロードの時刻ではない）", async () => {
    const attachment = await insertAttachmentRow({
      roomId: ROOM,
      uploaderId: V,
      messageId: null,
      threadParentId: null,
      originalName: "索引添付乙002.txt",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const message = await post(V, "日時の確認の本文", [attachment]);
    expect((await documentOf(attachment))?.created_at).toBe(message.at);
  });

  it("#155 AC-3 I-1: 1つの投稿の複数の添付は、それぞれ1行ずつ写しになる", async () => {
    const first = await pending("索引添付丙003.txt");
    const second = await pending("索引添付丁004.pdf");
    await post(V, "複数の添付の本文", [first, second]);
    expect(await ftsMatchAttachmentIds("索引添付丙003")).toEqual([first]);
    expect(await ftsMatchAttachmentIds("索引添付丁004")).toEqual([second]);
    expect(await totalAttachmentDocuments()).toBe(2);
    await expectConsistent();
  });

  it("#155 AC-3 I-1: 返信の添付も引ける（結ぶメッセージは返信）", async () => {
    const parent = await post(V, "返信の親の本文");
    const attachment = await pending("索引添付戊005.txt", {
      uploaderId: O,
      threadParentId: parent.id,
    });
    const child = await reply(O, parent.id, "添付つきの返信", [attachment]);
    expect(child.changes).toBe(1);
    expect(await ftsMatchAttachmentIds("索引添付戊005")).toEqual([attachment]);
    expect((await documentOf(attachment))?.message_id).toBe(child.id);
    await expectConsistent();
  });

  it('#155 AC-3 I-1 B-3: 名前は記号を除かずに入る（_ * % " を含む名前を、その記号を含む語で引ける）', async () => {
    const name = '索引_添付*己%006"版.txt';
    const attachment = await pending(name);
    await post(V, "記号の名前の本文", [attachment]);
    expect((await documentOf(attachment))?.text).toBe(name);
    expect(await ftsMatchAttachmentIds("索引_添付*己%006")).toEqual([
      attachment,
    ]);
    expect(await ftsInstrAttachmentIds("_添")).toEqual([attachment]);
  });

  it("#155 AC-3 I-1: 未投稿の添付（アップロードしただけ）は索引に入らない", async () => {
    const attachment = await pending("索引添付庚007.txt");
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 0,
      fts: 0,
    });
    // 投稿に結ばない組を実行しても入らない
    const message = await post(V, "結ばない投稿の本文");
    await runAttachmentIndexStatements(message.id);
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 0,
      fts: 0,
    });
    await expectConsistent();
  });

  for (const [label, prepare] of [
    [
      "件数（存在しない添付の ID を含む）",
      async () => [
        await pending("索引添付辛008.txt"),
        fixedIdAt(BASE_MS + 999_000),
      ],
    ],
    [
      "件数（上限の10件を超える11件）",
      async () => {
        const ids: string[] = [];
        for (let i = 0; i < 11; i += 1)
          ids.push(
            await pending(`索引添付辛上限${String(i).padStart(3, "0")}.txt`),
          );
        return ids;
      },
    ],
    [
      "容量（合計が上限を超える）",
      async () => [
        await pending("索引添付辛容量一.bin", { sizeBytes: 100_000_000 }),
        await pending("索引添付辛容量二.bin", { sizeBytes: 100_000_000 }),
        await pending("索引添付辛容量三.bin", { sizeBytes: 1 }),
      ],
    ],
    [
      "他人の添付",
      async () => [await pending("索引添付辛他人.txt", { uploaderId: O })],
    ],
  ] as const)
    it(`#155 AC-3 I-1: 結び付けの失敗（${label}）の投稿は取り消され、添付の索引にも残らない`, async () => {
      const ids = await prepare();
      const before = await totalAttachmentDocuments();
      const { id, at } = nextId();
      await expect(
        withMessages(env, (repo) =>
          repo.insertIfOrdered({
            id,
            roomId: ROOM,
            senderId: V,
            senderDisplayName: "テスト太郎",
            body: body("取り消される添付の投稿"),
            createdAt: at,
            attachmentIds: ids,
          }),
        ),
      ).rejects.toThrow();
      expect(await totalAttachmentDocuments()).toBe(before);
      expect(await ftsInstrAttachmentIds("辛")).toEqual([]);
      for (const attachmentId of ids)
        expect(await attachmentIndexCountsOf(attachmentId)).toEqual({
          documents: 0,
          fts: 0,
        });
      await expectConsistent();
    });

  it("#155 AC-3 I-1: 論理削除の後、添付の写し（対応の行・検索用の行）が残らず、名前で引けない", async () => {
    const attachment = await pending("索引添付壬009.txt");
    const message = await post(V, "削除する添付の本文", [attachment]);
    expect(await ftsMatchAttachmentIds("索引添付壬009")).toEqual([attachment]);
    expect(await remove(message.id, V)).toBe(1);
    expect(await ftsMatchAttachmentIds("索引添付壬009")).toEqual([]);
    expect(await ftsInstrAttachmentIds("壬0")).toEqual([]);
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 0,
      fts: 0,
    });
    await expectConsistent();
  });

  it("#155 AC-3 I-1 R1-5: 未削除の他人の投稿への削除の拒否は 0 件で、添付の写しが残る", async () => {
    const attachment = await pending("索引添付癸010.txt", { uploaderId: O });
    const message = await post(O, "他人の添付の本文", [attachment]);
    expect(await remove(message.id, V)).toBe(0);
    expect(await ftsMatchAttachmentIds("索引添付癸010")).toEqual([attachment]);
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 1,
      fts: 1,
    });
    await expectConsistent();
  });

  it("#155 AC-3 I-1 R1-5: すでに削除済みのメッセージへの削除（拒否）では、添付の写しは0件のまま入り直さない", async () => {
    const attachment = await pending("索引添付子011.txt");
    const message = await post(V, "二度消す添付の本文", [attachment]);
    expect(await remove(message.id, V)).toBe(1);
    expect(await remove(message.id, V)).toBe(0);
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 0,
      fts: 0,
    });
    expect(await ftsMatchAttachmentIds("索引添付子011")).toEqual([]);
    await expectConsistent();
  });

  it("#155 AC-3 I-1: 本文の編集（互換経路・batch の経路）の後も、添付の写しは残り、名前で引ける", async () => {
    const attachment = await pending("索引添付丑012.txt");
    const message = await post(V, "編集前の添付の本文", [attachment]);
    expect(await editCompat(message.id, V, "互換で編集した本文")).toBe(1);
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 1,
      fts: 1,
    });
    expect(await editBatch(message.id, V, "一括で編集した本文")).toBe(1);
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 1,
      fts: 1,
    });
    expect(await ftsMatchAttachmentIds("索引添付丑012")).toEqual([attachment]);
    await expectConsistent();
  });

  it("#155 AC-3 I-1: 組を2回実行しても、写しの数は同じ（べき等）", async () => {
    const attachment = await pending("索引添付寅013.txt");
    const message = await post(V, "べき等の添付の本文", [attachment]);
    await runAttachmentIndexStatements(message.id);
    await runAttachmentIndexStatements(message.id);
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 1,
      fts: 1,
    });
    expect(await totalAttachmentDocuments()).toBe(1);
    await expectConsistent();
  });

  it("#155 AC-3 I-1: 添付の行を消した後に組を実行すると、その写しが消える（ほかの添付の写しは残る）", async () => {
    const gone = await pending("索引添付卯014.txt");
    const kept = await pending("索引添付辰015.txt");
    const message = await post(V, "添付の行を消す本文", [gone, kept]);
    await env.DB.prepare("DELETE FROM message_attachments WHERE id = ?")
      .bind(gone)
      .run();
    await runAttachmentIndexStatements(message.id);
    expect(await attachmentIndexCountsOf(gone)).toEqual({
      documents: 0,
      fts: 0,
    });
    expect(await ftsMatchAttachmentIds("索引添付卯014")).toEqual([]);
    expect(await ftsMatchAttachmentIds("索引添付辰015")).toEqual([kept]);
    await expectConsistent();
  });

  it("#155 AC-3 I-1 R1-3: DB の上で名前を書き換えてから組を実行すると、旧の名前で0件・新の名前で1件（MATCH・instr）", async () => {
    const attachment = await pending("索引添付巳016旧名.txt");
    const message = await post(V, "名前を変える本文", [attachment]);
    await env.DB.prepare(
      "UPDATE message_attachments SET original_name = ? WHERE id = ?",
    )
      .bind("索引添付午017新名.txt", attachment)
      .run();
    await runAttachmentIndexStatements(message.id);
    expect(await ftsMatchAttachmentIds("索引添付巳016")).toEqual([]);
    expect(await ftsInstrAttachmentIds("旧名")).toEqual([]);
    expect(await ftsMatchAttachmentIds("索引添付午017")).toEqual([attachment]);
    expect(await ftsInstrAttachmentIds("新名")).toEqual([attachment]);
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 1,
      fts: 1,
    });
    await expectConsistent();
  });

  it("#155 AC-3 I-1: 添付の結び付きを別のメッセージへ移してから両方の組を実行すると、写しは移った先のメッセージに結ぶ1行だけ", async () => {
    const attachment = await pending("索引添付未018.txt");
    const first = await post(V, "移す前の添付の本文", [attachment]);
    const second = await post(V, "移した先の添付の本文");
    await env.DB.prepare(
      "UPDATE message_attachments SET message_id = ? WHERE id = ?",
    )
      .bind(second.id, attachment)
      .run();
    await runAttachmentIndexStatements(first.id);
    await runAttachmentIndexStatements(second.id);
    expect(await documentOf(attachment)).toMatchObject({
      message_id: second.id,
      created_at: second.at,
    });
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 1,
      fts: 1,
    });
    await expectConsistent();
  });

  it("#155 AC-3 I-1: 添付の部屋がメッセージの部屋と食い違う行は、組を実行しても写しにならない", async () => {
    const attachment = await pending("索引添付申019.txt");
    const message = await post(V, "部屋の食い違いの本文", [attachment]);
    await env.DB.prepare(
      "UPDATE message_attachments SET room_id = ? WHERE id = ?",
    )
      .bind(OTHER, attachment)
      .run();
    await runAttachmentIndexStatements(message.id);
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 0,
      fts: 0,
    });
    expect(await ftsMatchAttachmentIds("索引添付申019")).toEqual([]);
  });
});

describe("#155 AC-3 155-B I-2 順序に依らない一致と、不一致の分類の検出", () => {
  it("#155 AC-3 I-2: 登録（reindexMessages）を投稿の後に2回実行しても、添付の写しは1行ずつ（不一致0件）", async () => {
    const a1 = await pending("索引添付酉020.txt");
    const a2 = await pending("索引添付戌021.txt");
    await post(V, "登録二回の本文一", [a1]);
    await post(O, "登録二回の本文二");
    const parent = await post(V, "登録二回の本文三");
    const a3 = await pending("索引添付亥022.txt", {
      threadParentId: parent.id,
    });
    await reply(V, parent.id, "登録二回の返信", [a3]);
    await buildSearchIndex();
    await buildSearchIndex();
    for (const id of [a1, a3])
      expect(await attachmentIndexCountsOf(id)).toEqual({
        documents: 1,
        fts: 1,
      });
    // 未投稿のまま（a2）は入らない
    expect(await attachmentIndexCountsOf(a2)).toEqual({ documents: 0, fts: 0 });
    await expectConsistent();
  });

  it("#155 AC-3 I-2: 写しを消した状態（登録の前）から登録すると、添付の写しが入る", async () => {
    const attachment = await pending("索引添付甲023.txt");
    await post(V, "登録の前の本文", [attachment]);
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_documents WHERE kind = 'attachment')",
      ),
      env.DB.prepare("DELETE FROM search_documents WHERE kind = 'attachment'"),
    ]);
    expect((await attachmentIndexMismatches()).missing).toBe(1);
    await buildSearchIndex();
    expect(await ftsMatchAttachmentIds("索引添付甲023")).toEqual([attachment]);
    await expectConsistent();
  });

  it("#155 AC-3 I-2: 削除の確定の後に組・登録を実行しても、添付の写しは入らない", async () => {
    const attachment = await pending("索引添付乙024.txt");
    const message = await post(V, "削除の後の組の本文", [attachment]);
    expect(await remove(message.id, V)).toBe(1);
    await runAttachmentIndexStatements(message.id);
    await buildSearchIndex();
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 0,
      fts: 0,
    });
    await expectConsistent();
  });

  it("#155 AC-3 I-2: 存在しないメッセージの組は、何も入れない", async () => {
    const before = await totalAttachmentDocuments();
    await runAttachmentIndexStatements(fixedIdAt(BASE_MS + 888_000));
    expect(await totalAttachmentDocuments()).toBe(before);
  });

  // 不一致を数える SQL が、常に0になる形でないこと：故意に壊した行を1つずつ入れ、その分類で1件と数える（計画 R1-3）
  const breakers: {
    label: string;
    expected: Partial<AttachmentIndexMismatches>;
    run: (c: {
      attachment: string;
      messageId: string;
      other: string;
    }) => Promise<unknown>;
  }[] = [
    {
      label: "写しが無い（missing）",
      expected: { missing: 1 },
      run: ({ attachment }) =>
        env.DB.batch([
          env.DB.prepare(
            "DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_documents WHERE kind = 'attachment' AND ref_id = ?)",
          ).bind(attachment),
          env.DB.prepare(
            "DELETE FROM search_documents WHERE kind = 'attachment' AND ref_id = ?",
          ).bind(attachment),
        ]),
    },
    {
      label: "元の添付が無い（missingAttachment）",
      expected: { missingAttachment: 1 },
      run: ({ attachment }) =>
        env.DB.prepare("DELETE FROM message_attachments WHERE id = ?")
          .bind(attachment)
          .run(),
    },
    {
      label: "結び付きが違う（wrongMessage）",
      expected: { wrongMessage: 1 },
      run: ({ attachment, other }) =>
        env.DB.prepare(
          "UPDATE message_attachments SET message_id = ? WHERE id = ?",
        )
          .bind(other, attachment)
          .run(),
    },
    {
      label: "部屋が違う（wrongRoom）",
      expected: { wrongRoom: 1 },
      run: ({ attachment }) =>
        env.DB.prepare(
          "UPDATE search_documents SET room_id = ? WHERE kind = 'attachment' AND ref_id = ?",
        )
          .bind(OTHER, attachment)
          .run(),
    },
    {
      label: "名前が違う（wrongName）",
      expected: { wrongName: 1 },
      run: ({ attachment }) =>
        env.DB.prepare(
          "UPDATE message_attachments SET original_name = ? WHERE id = ?",
        )
          .bind("索引添付の別名.txt", attachment)
          .run(),
    },
    {
      label: "作成日時が違う（wrongCreatedAt）",
      expected: { wrongCreatedAt: 1 },
      run: ({ attachment }) =>
        env.DB.prepare(
          "UPDATE search_documents SET created_at = ? WHERE kind = 'attachment' AND ref_id = ?",
        )
          .bind("2026-01-01T00:00:00.000Z", attachment)
          .run(),
    },
    {
      label: "メッセージが削除済み（deletedMessage）",
      expected: { deletedMessage: 1 },
      run: ({ messageId }) =>
        env.DB.prepare(
          "UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ?",
        )
          .bind(new Date().toISOString(), V, messageId)
          .run(),
    },
    {
      label: "対応の行に検索用の行が無い（withoutFts）",
      expected: { withoutFts: 1 },
      run: ({ attachment }) =>
        env.DB.prepare(
          "DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_documents WHERE kind = 'attachment' AND ref_id = ?)",
        )
          .bind(attachment)
          .run(),
    },
    {
      label: "検索用の文が名前と違う（wrongFtsText）",
      expected: { wrongFtsText: 1 },
      run: ({ attachment }) =>
        env.DB.prepare(
          "UPDATE search_fts SET text = ? WHERE rowid IN (SELECT id FROM search_documents WHERE kind = 'attachment' AND ref_id = ?)",
        )
          .bind("記号を除いた別の文", attachment)
          .run(),
    },
    {
      label:
        "検索用の行に対応の行が無い（orphanFts。対応の行が無いので missing も1）",
      expected: { orphanFts: 1, missing: 1 },
      run: ({ attachment }) =>
        env.DB.prepare(
          "DELETE FROM search_documents WHERE kind = 'attachment' AND ref_id = ?",
        )
          .bind(attachment)
          .run(),
    },
  ];
  for (const breaker of breakers)
    it(`#155 AC-3 I-2 R1-3: 不一致の分類「${breaker.label}」を、故意に壊した1行で1件と数える`, async () => {
      const attachment = await pending("索引添付丙025.txt");
      const message = await post(V, "壊す前の添付の本文", [attachment]);
      const other = await post(V, "結び付きの移り先の本文");
      // 壊す前は0件（対照）
      expect(await attachmentIndexMismatches()).toEqual(NO_ATTACHMENT_MISMATCH);
      await breaker.run({ attachment, messageId: message.id, other: other.id });
      expect(await attachmentIndexMismatches()).toEqual({
        ...NO_ATTACHMENT_MISMATCH,
        ...breaker.expected,
      });
    });
});

describe("#155 AC-3 155-B I-3 書き込みの経路の一覧（それぞれの後で、添付の索引と元の表の不一致0件）", () => {
  it("#155 AC-3 I-3: アップロード・投稿・返信・本文の編集（互換・batch）・削除の拒否・未投稿の掃除・論理削除の後、不一致0件。何もしない経路で添付の写しの数が変わらない", async () => {
    let parentId = "";
    let replyAttachment = "";
    let pendingLeft = "";
    const steps: {
      name: string;
      run: () => Promise<unknown>;
      /** この経路の後の、種類 attachment の写しの総数 */
      documents: number;
    }[] = [
      {
        name: "アップロード（未投稿の行）",
        run: async () => {
          pendingLeft = await pending("索引経路丁026.txt");
        },
        documents: 0,
      },
      {
        name: "添付つきの投稿",
        run: async () => {
          const a = await pending("索引経路戊027.txt");
          const r = await post(V, "経路の添付投稿", [a]);
          expect(r.changes).toBe(1);
          parentId = r.id;
        },
        documents: 1,
      },
      {
        name: "添付つきの返信",
        run: async () => {
          replyAttachment = await pending("索引経路己028.txt", {
            uploaderId: O,
            threadParentId: parentId,
          });
          const r = await reply(O, parentId, "経路の添付返信", [
            replyAttachment,
          ]);
          expect(r.changes).toBe(1);
        },
        documents: 2,
      },
      {
        name: "本文の編集（互換経路）",
        run: () => editCompat(parentId, V, "経路の互換編集"),
        documents: 2,
      },
      {
        name: "本文の編集（batch の経路）",
        run: () => editBatch(parentId, V, "経路の一括編集"),
        documents: 2,
      },
      {
        name: "他人の投稿の削除の拒否",
        run: async () => expect(await remove(parentId, O)).toBe(0),
        documents: 2,
      },
      {
        name: "未投稿の掃除（deletePendingBefore）",
        run: () =>
          withAttachments(env, (repo) =>
            repo.deletePendingBefore(
              new Date(Date.now() + 60_000).toISOString(),
            ),
          ),
        documents: 2,
      },
      {
        name: "論理削除（親）",
        run: async () => expect(await remove(parentId, V)).toBe(1),
        documents: 1,
      },
    ];
    for (const step of steps) {
      await step.run();
      expect({
        step: step.name,
        documents: await totalAttachmentDocuments(),
        ...(await attachmentIndexMismatches()),
      }).toEqual({
        step: step.name,
        documents: step.documents,
        ...NO_ATTACHMENT_MISMATCH,
      });
    }
    // 削除済みの親への、未削除の返信の添付は残る
    expect(await ftsMatchAttachmentIds("索引経路己028")).toEqual([
      replyAttachment,
    ]);
    expect(await ftsMatchAttachmentIds("索引経路戊027")).toEqual([]);
    expect(await attachmentIndexCountsOf(pendingLeft)).toEqual({
      documents: 0,
      fts: 0,
    });
  });
});

describe("#155 AC-3 155-B I-5 古い写しの判定の条件ごと（SQL の条件を外す手での確認で、落ちるテストがなかったもの）", () => {
  it("#155 AC-3 I-5 a.id = d.ref_id: 同じメッセージに同じ名前の添付が2つあり、片方の行を消してから組を実行すると、消した添付の写しだけが消える", async () => {
    const gone = await pending("索引同名の資料.txt");
    const kept = await pending("索引同名の資料.txt");
    const message = await post(V, "同名の添付の本文", [gone, kept]);
    expect(await attachmentIndexCountsOf(gone)).toEqual({
      documents: 1,
      fts: 1,
    });
    await env.DB.prepare("DELETE FROM message_attachments WHERE id = ?")
      .bind(gone)
      .run();
    await runAttachmentIndexStatements(message.id);
    expect(await attachmentIndexCountsOf(gone)).toEqual({
      documents: 0,
      fts: 0,
    });
    expect(await attachmentIndexCountsOf(kept)).toEqual({
      documents: 1,
      fts: 1,
    });
    await expectConsistent();
  });

  it("#155 AC-3 I-5 a.room_id = d.room_id: 写しの部屋だけが違う（壊れた）写しは、組で作り直され、添付の部屋になる", async () => {
    const attachment = await pending("索引部屋違いの写し.txt");
    const message = await post(V, "写しの部屋の本文", [attachment]);
    await env.DB.prepare(
      "UPDATE search_documents SET room_id = ? WHERE kind = 'attachment' AND ref_id = ?",
    )
      .bind(OTHER, attachment)
      .run();
    expect((await attachmentIndexMismatches()).wrongRoom).toBe(1);
    await runAttachmentIndexStatements(message.id);
    expect((await documentOf(attachment))?.room_id).toBe(ROOM);
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 1,
      fts: 1,
    });
    await expectConsistent();
  });

  it("#155 AC-3 I-5 m.created_at = d.created_at: 写しの日時だけが違う（壊れた）写しは、組で作り直され、メッセージの作成日時になる", async () => {
    const attachment = await pending("索引日時違いの写し.txt");
    const message = await post(V, "写しの日時の本文", [attachment]);
    await env.DB.prepare(
      "UPDATE search_documents SET created_at = ? WHERE kind = 'attachment' AND ref_id = ?",
    )
      .bind("2026-01-01T00:00:00.000Z", attachment)
      .run();
    await runAttachmentIndexStatements(message.id);
    expect((await documentOf(attachment))?.created_at).toBe(message.at);
    await expectConsistent();
  });

  it("#155 AC-3 I-5 m.room_id = a.room_id: メッセージの部屋が添付の部屋と食い違う（写しと添付の部屋は同じ）と、組で写しが消え、入り直さない", async () => {
    const attachment = await pending("索引移動の写し.txt");
    const message = await post(V, "部屋の移ったメッセージの本文", [attachment]);
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 1,
      fts: 1,
    });
    await env.DB.prepare("UPDATE messages SET room_id = ? WHERE id = ?")
      .bind(OTHER, message.id)
      .run();
    await runAttachmentIndexStatements(message.id);
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 0,
      fts: 0,
    });
  });

  it("#155 AC-3 I-5 検索用の行の d.kind = 'attachment': 添付の組は、同じメッセージの本文の写しの検索用の行を入れない（本文は記号を除いた文で入れるもので、添付の組の担当ではない）", async () => {
    const attachment = await pending("索引本文の担当外.txt");
    const message = await post(V, "申**請**手続の本文", [attachment]);
    const messageFts = () =>
      env.DB.prepare(
        "SELECT COUNT(*) AS n FROM search_fts WHERE rowid IN (SELECT id FROM search_documents WHERE kind = 'message' AND ref_id = ?)",
      )
        .bind(message.id)
        .first<{ n: number }>();
    expect((await messageFts())?.n).toBe(1);
    await env.DB.prepare(
      "DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_documents WHERE kind = 'message' AND ref_id = ?)",
    )
      .bind(message.id)
      .run();
    await runAttachmentIndexStatements(message.id);
    expect((await messageFts())?.n).toBe(0);
    // 対照：添付の写しの検索用の行は残っている
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 1,
      fts: 1,
    });
    // 記号を残した本文では引けない
    const raw = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM search_fts WHERE search_fts MATCH ?",
    )
      .bind('"申**請"')
      .first<{ n: number }>();
    expect(raw?.n).toBe(0);
  });
});

describe("#155 AC-3 155-B I-4 既存の戻り値の契約（添付つきでも書いた件数）", () => {
  it("#155 AC-3 I-4: 添付つきの投稿・返信は 1、削除は本人なら 1・拒否なら 0（索引の書き込みの数を含めない）", async () => {
    const a1 = await pending("索引戻値庚029.txt");
    const a2 = await pending("索引戻値辛030.txt");
    const parent = await post(V, "戻り値の添付投稿", [a1, a2]);
    expect(parent.changes).toBe(1);
    const a3 = await pending("索引戻値壬031.txt", {
      uploaderId: O,
      threadParentId: parent.id,
    });
    expect((await reply(O, parent.id, "戻り値の添付返信", [a3])).changes).toBe(
      1,
    );
    expect(await remove(parent.id, O)).toBe(0);
    expect(await remove(parent.id, V)).toBe(1);
  });
});

// ---- #270（270-B）AC-9：本文のない投稿（本文が目印）の索引（計画 2.2 の 4・5、2.8）----
// 根拠：計画 AC-9（本文のない投稿は、本文の検索のどの語でも目印で一致しない。添付のファイル名では一致する。reindexMessages の後も同じ。
//   本文を空にする編集で前の本文の写しが消え、空から本文を足す編集で写しができる）・計画 2.2 の 4（message の写しを作らない。目印の写しがあれば古い写しとして消す。
//   indexedMessage には条件を足さない＝本文のない投稿の添付の名前は索引に入る）。目印は test/attachment-only-fixtures.ts の値。
// 注意：test/search-fixtures.ts の indexMismatches は「未削除のメッセージに写しがない」を missing に数えるため、本文のない投稿があると 0 にならない（ここでは使わない）。
describe("#270 AC-9 本文のない投稿の索引", () => {
  async function postRaw(
    rawBody: string,
    attachmentIds: string[],
    parentMessageId?: string,
  ) {
    const { id, at } = nextId();
    const changes = await withMessages(env, (repo) =>
      parentMessageId === undefined
        ? repo.insertIfOrdered({
            id,
            roomId: ROOM,
            senderId: V,
            senderDisplayName: "テスト太郎",
            body: rawBody,
            createdAt: at,
            attachmentIds,
          })
        : repo.insertReplyIfOrdered({
            id,
            roomId: ROOM,
            parentMessageId,
            senderId: V,
            senderDisplayName: "テスト太郎",
            body: rawBody,
            createdAt: at,
            attachmentIds,
          }),
    );
    expect(changes).toBe(1);
    return { id, at };
  }

  const editTo = (messageId: string, rawBody: string) =>
    withMessages(env, (repo) =>
      repo.updateBodyIfModifiable({
        messageId,
        userId: V,
        body: rawBody,
        editedAt: new Date().toISOString(),
        roomId: ROOM,
        mentions: [],
      }),
    );

  it("#270 AC-9: 本文のない投稿の後、message の写しは0件で、添付の写しは1件（名前の MATCH・instr で引ける）", async () => {
    const attachment = await pending("索引本文なし子101.txt");
    const message = await postRaw(STORED_EMPTY_BODY, [attachment]);
    expect(await indexCountsOf(message.id)).toEqual({ documents: 0, fts: 0 });
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 1,
      fts: 1,
    });
    expect(await ftsMatchAttachmentIds("索引本文なし子101")).toEqual([
      attachment,
    ]);
    // 本文の検索では、半角の空白（目印）でも一致しない
    expect(await ftsInstrIds(" ")).not.toContain(message.id);
  });

  it("#270 AC-9: 本文のない返信の後も、message の写しは0件で、添付の写しは1件", async () => {
    const parent = await post(V, "本文なしの返信の親");
    const attachment = await pending("索引本文なし丑102.txt", {
      threadParentId: parent.id,
    });
    const replied = await postRaw(STORED_EMPTY_BODY, [attachment], parent.id);
    expect(await indexCountsOf(replied.id)).toEqual({ documents: 0, fts: 0 });
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 1,
      fts: 1,
    });
  });

  it("#270 AC-9: 目印の写しを手で入れてから、本文の組を目印で実行すると、古い写しとして消える", async () => {
    const attachment = await pending("索引本文なし寅103.txt");
    const message = await postRaw(STORED_EMPTY_BODY, [attachment]);
    // 実装の前は投稿で写しができているため、手で入れる前に、そのメッセージの message の写しを空にしてから1件だけ入れる
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_documents WHERE kind = 'message' AND ref_id = ?)",
      ).bind(message.id),
      env.DB.prepare(
        "DELETE FROM search_documents WHERE kind = 'message' AND ref_id = ?",
      ).bind(message.id),
    ]);
    await insertAttachmentIndexRow({
      kind: "message",
      attachmentId: message.id,
      roomId: ROOM,
      messageId: message.id,
      createdAt: message.at,
      sourceBody: STORED_EMPTY_BODY,
    });
    expect(await indexCountsOf(message.id)).toEqual({ documents: 1, fts: 1 });
    await runIndexStatements(message.id, STORED_EMPTY_BODY);
    expect(await indexCountsOf(message.id)).toEqual({ documents: 0, fts: 0 });
  });

  it("#270 AC-9: 本文を空にする編集で、前の本文の写しが消え、前の本文の語では一致しなくなる。添付の名前では引ける", async () => {
    const attachment = await pending("索引本文なし卯104.txt");
    const message = await postRaw(body("空にする前の語卯"), [attachment]);
    expect(await ftsMatchIds("空にする前の語卯")).toEqual([message.id]);
    expect(await editTo(message.id, STORED_EMPTY_BODY)).toBe(1);
    expect(await ftsMatchIds("空にする前の語卯")).toEqual([]);
    expect(await indexCountsOf(message.id)).toEqual({ documents: 0, fts: 0 });
    expect(await ftsMatchAttachmentIds("索引本文なし卯104")).toEqual([
      attachment,
    ]);
  });

  it("#270 AC-9: 本文のない投稿に本文を足す編集で、新しい本文の写しができ、その語で一致する", async () => {
    const attachment = await pending("索引本文なし辰105.txt");
    const message = await postRaw(STORED_EMPTY_BODY, [attachment]);
    expect(await editTo(message.id, body("足した本文の語辰"))).toBe(1);
    expect(await ftsMatchIds("足した本文の語辰")).toEqual([message.id]);
    expect(await messageDocumentBodies(message.id)).toEqual([
      body("足した本文の語辰"),
    ]);
  });

  it("#270 AC-9: reindexMessages で登録し直しても、本文のない投稿の message の写しは0件で、添付の写しは残る", async () => {
    const attachment = await pending("索引本文なし巳106.txt");
    const message = await postRaw(STORED_EMPTY_BODY, [attachment]);
    await buildSearchIndex();
    expect(await indexCountsOf(message.id)).toEqual({ documents: 0, fts: 0 });
    expect(await attachmentIndexCountsOf(attachment)).toEqual({
      documents: 1,
      fts: 1,
    });
  });
});
