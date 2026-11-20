// #155（155-A）D-5・D-5b・D-6・D-7：メッセージの書き込みと、検索の索引（search_documents・search_fts）の整合。
// 期待は、計画 4.2（索引の組は「いまの行の状態」と「渡した元の本文」だけで決まり、べき等で順序に依らない／7か所の書き込みに組み込む／
// 既存の戻り値〔書いた件数〕を変えない）、設計 4.2 の場面ごとの結果、3回目の計画レビューの軽微の指摘（削除済みのメッセージへの編集の拒否では、
// 写しは残らず元の語でも引けない。未削除のほかの人の投稿への編集の拒否では、写しが残り元の語で引ける）から決める。実装から写さない。
// 索引の確かめ方は、本番の検索（Repository）を通さず、test/search-fixtures.ts の直接の SQL（MATCH・instr・不一致の数）で行う。
// 書き込みは、本物の Repository（message.repository.ts の insertIfOrdered・insertReplyIfOrdered・updateBodyIfModifiable〔互換経路と batch の経路〕・
// deleteIfModifiable）を隔離 D1 に対して呼ぶ。7か所の一覧（計画 4.2 の表）：投稿／返信／本文の UPDATE（互換経路・batch の経路の確定の UPDATE・
// batch の経路の先頭のガードの UPDATE）／論理削除／添付の結び付けの確認の room_id の UPDATE。
// 準備：部署 deptS の利用者 V（memberS1）・O（memberS2）が参加する公開チャンネル ROOM。データは架空（testuser_casereq_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  NO_MISMATCH,
  buildSearchIndex,
  cleanupSearchIndex,
  ftsInstrIds,
  ftsMatchIds,
  indexCountsOf,
  indexMismatches,
  runIndexStatements,
  totalFtsRows,
} from "../../test/search-fixtures";
import { withMessages } from "./message.repository";

const BASE_MS = 1_870_000_000_000;
const ROOM = fixedIdAt(BASE_MS);
let sequence = 0;
/** 部屋の中で必ず増える ID と、その時刻 */
function nextId(): { id: string; at: string } {
  sequence += 1;
  const ms = BASE_MS + 10_000 + sequence * 1_000;
  return { id: fixedIdAt(ms), at: new Date(ms).toISOString() };
}

let w: CaseWorld;
let V: string;
let O: string;

const body = (text: string) => `${TEST_TAG}${text}`;
const traceId = () => `${AUTH_TRACE_PREFIX}search-${crypto.randomUUID()}`;

async function post(
  senderId: string,
  text: string,
  attachmentIds?: string[],
): Promise<{ id: string; changes: number }> {
  const { id, at } = nextId();
  const changes = await withMessages(env, (repo) =>
    repo.insertIfOrdered({
      id,
      roomId: ROOM,
      senderId,
      senderDisplayName: "テスト太郎",
      body: body(text),
      createdAt: at,
      ...(attachmentIds === undefined ? {} : { attachmentIds }),
    }),
  );
  return { id, changes };
}

async function reply(
  senderId: string,
  parentMessageId: string,
  text: string,
): Promise<{ id: string; changes: number }> {
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
    }),
  );
  return { id, changes };
}

/** 互換経路（roomId を渡さない単文の UPDATE） */
const editCompat = (messageId: string, userId: string, text: string) =>
  withMessages(env, (repo) =>
    repo.updateBodyIfModifiable({
      messageId,
      userId,
      body: body(text),
      editedAt: new Date().toISOString(),
    }),
  );

/** batch の経路（roomId を渡す。指名も同じ batch） */
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

async function currentBody(messageId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT body FROM messages WHERE id = ?")
    .bind(messageId)
    .first<{ body: string }>();
  if (row === null) throw new Error("メッセージがありません");
  return row.body;
}

async function expectConsistent(ids?: readonly string[]) {
  expect(await indexMismatches(ids)).toEqual(NO_MISMATCH);
}

beforeEach(async () => {
  sequence = 0;
  w = await setupCaseWorld();
  V = w.memberS1.id;
  O = w.memberS2.id;
  await insertChannel({
    id: ROOM,
    name: `${TEST_TAG}search-index`,
    purpose: "normal",
    departmentId: w.deptS.id,
    visibility: "public",
  });
  await insertMember(ROOM, V);
  await insertMember(ROOM, O);
});

afterEach(async () => {
  try {
    await cleanupSearchIndex();
  } finally {
    await cleanupRelatedReadsRooms([ROOM]);
    await cleanupCaseTestData();
  }
});

describe("#155 AC-3 D-5 状態の遷移（書き込みの後の索引）", () => {
  it("#155 AC-3 D-5: 投稿の後、3文字以上の語（MATCH）と2文字の語（instr）で引ける", async () => {
    const { id } = await post(V, "見積依頼書の提出について");
    expect(await ftsMatchIds("見積依頼書")).toEqual([id]);
    expect(await ftsInstrIds("提出")).toEqual([id]);
    await expectConsistent([id]);
  });

  it("#155 AC-3 D-5: 返信の後、引ける", async () => {
    const parent = await post(V, "親の投稿の文面");
    const child = await reply(O, parent.id, "返信の検収報告");
    expect(await ftsMatchIds("検収報告")).toEqual([child.id]);
    await expectConsistent([parent.id, child.id]);
  });

  it("#155 AC-3 D-5: 編集（互換経路）の後、新しい語で1件、古い語で0件", async () => {
    const { id } = await post(V, "旧文面の発注書");
    expect(await editCompat(id, V, "新文面の納品書")).toBe(1);
    expect(await ftsMatchIds("発注書")).toEqual([]);
    expect(await ftsMatchIds("納品書")).toEqual([id]);
    expect(await indexCountsOf(id)).toEqual({ documents: 1, fts: 1 });
    await expectConsistent([id]);
  });

  it("#155 AC-3 D-5: 編集（batch の経路）の後、新しい語で1件、古い語で0件", async () => {
    const { id } = await post(V, "旧文面の請求予定");
    expect(await editBatch(id, V, "新文面の支払予定")).toBe(1);
    expect(await ftsMatchIds("請求予定")).toEqual([]);
    expect(await ftsMatchIds("支払予定")).toEqual([id]);
    expect(await indexCountsOf(id)).toEqual({ documents: 1, fts: 1 });
    await expectConsistent([id]);
  });

  it("#155 AC-3 D-5: 返信の編集の後も、新しい語で引ける", async () => {
    const parent = await post(V, "親の投稿の文面");
    const child = await reply(V, parent.id, "返信の旧語句です");
    expect(await editBatch(child.id, V, "返信の新語句です")).toBe(1);
    expect(await ftsMatchIds("旧語句")).toEqual([]);
    expect(await ftsMatchIds("新語句")).toEqual([child.id]);
    await expectConsistent([parent.id, child.id]);
  });

  it("#155 AC-3 D-5: 論理削除の後、引けず、写し（対応の行・検索用の行）が残らない", async () => {
    const { id } = await post(V, "削除予定の議事録");
    const before = await totalFtsRows();
    expect(await remove(id, V)).toBe(1);
    expect(await ftsMatchIds("議事録")).toEqual([]);
    expect(await ftsInstrIds("議事")).toEqual([]);
    expect(await indexCountsOf(id)).toEqual({ documents: 0, fts: 0 });
    expect(await totalFtsRows()).toBe(before - 1);
    await expectConsistent([id]);
  });

  it("#155 AC-3 D-5: 同じ本文への更新では、写しは1件のまま（引ける）", async () => {
    const { id } = await post(V, "同じ本文の報告書");
    expect(await editCompat(id, V, "同じ本文の報告書")).toBe(1);
    expect(await editBatch(id, V, "同じ本文の報告書")).toBe(1);
    expect(await ftsMatchIds("報告書")).toEqual([id]);
    expect(await indexCountsOf(id)).toEqual({ documents: 1, fts: 1 });
    await expectConsistent([id]);
  });

  it("#155 AC-3 D-5: 添付の結び付けの確認に失敗した投稿は、取り消され、索引にも残らない", async () => {
    const missingAttachment = fixedIdAt(BASE_MS + 999_000);
    const { at } = nextId();
    const id = fixedIdAt(Date.parse(at));
    const before = await totalFtsRows();
    await expect(
      withMessages(env, (repo) =>
        repo.insertIfOrdered({
          id,
          roomId: ROOM,
          senderId: V,
          senderDisplayName: "テスト太郎",
          body: body("取り消される投稿の文面"),
          createdAt: at,
          attachmentIds: [missingAttachment],
        }),
      ),
    ).rejects.toThrow();
    expect(await ftsMatchIds("取り消される投稿")).toEqual([]);
    expect(await indexCountsOf(id)).toEqual({ documents: 0, fts: 0 });
    expect(await totalFtsRows()).toBe(before);
  });

  it("#155 AC-3 D-5: 投稿の条件を満たさない（参加していない）投稿は 0 件で、索引にも残らない", async () => {
    const outsider = w.memberD1.id;
    const before = await totalFtsRows();
    const { id, changes } = await post(outsider, "参加者でない人の投稿");
    expect(changes).toBe(0);
    expect(await ftsMatchIds("参加者でない人")).toEqual([]);
    expect(await indexCountsOf(id)).toEqual({ documents: 0, fts: 0 });
    expect(await totalFtsRows()).toBe(before);
  });
});

describe("#155 AC-3 D-5b 順序に依らない一致（拒否・割り込み・べき等）", () => {
  it("#155 AC-3 D-5b(a): 未削除のほかの人の投稿への編集の拒否（互換経路）は 0 件で、写しが残り、元の語で引ける", async () => {
    const { id } = await post(O, "他人の元の文面です");
    expect(await editCompat(id, V, "書き換えの文面です")).toBe(0);
    expect(await ftsMatchIds("他人の元の")).toEqual([id]);
    expect(await ftsMatchIds("書き換えの")).toEqual([]);
    expect(await indexCountsOf(id)).toEqual({ documents: 1, fts: 1 });
    await expectConsistent([id]);
  });

  it("#155 AC-3 D-5b(a): 未削除のほかの人の投稿への編集の拒否（batch の経路）は 0 件で、写しが残り、元の語で引ける", async () => {
    const { id } = await post(O, "他人の元の文面です");
    expect(await editBatch(id, V, "書き換えの文面です")).toBe(0);
    expect(await ftsMatchIds("他人の元の")).toEqual([id]);
    expect(await ftsMatchIds("書き換えの")).toEqual([]);
    expect(await indexCountsOf(id)).toEqual({ documents: 1, fts: 1 });
    await expectConsistent([id]);
  });

  it("#155 AC-3 D-5b(a'): 削除済みのメッセージへの編集の拒否（互換経路・batch の経路）は 0 件で、写しは無いまま、元の語でも新しい語でも引けない", async () => {
    const { id } = await post(V, "削除済みの元文面");
    expect(await remove(id, V)).toBe(1);
    expect(await editCompat(id, V, "削除後の新文面")).toBe(0);
    expect(await editBatch(id, V, "削除後の新文面")).toBe(0);
    expect(await ftsMatchIds("削除済みの元")).toEqual([]);
    expect(await ftsMatchIds("削除後の新")).toEqual([]);
    expect(await indexCountsOf(id)).toEqual({ documents: 0, fts: 0 });
    await expectConsistent([id]);
  });

  it("#155 AC-3 D-5b(b): ほかの人の投稿の削除の拒否は 0 件で、写しが残る", async () => {
    const { id } = await post(O, "消されない文面です");
    expect(await remove(id, V)).toBe(0);
    expect(await ftsMatchIds("消されない")).toEqual([id]);
    expect(await indexCountsOf(id)).toEqual({ documents: 1, fts: 1 });
    await expectConsistent([id]);
  });

  it("#155 AC-3 D-5b(c): 登録が A を読む → 編集で B が確定 → 登録が A の組を実行しても、B の写しが残り、A では引けない", async () => {
    const { id } = await post(V, "甲案の文面です");
    const readByReindex = await currentBody(id);
    expect(await editBatch(id, V, "乙案の文面です")).toBe(1);
    await runIndexStatements(id, readByReindex);
    expect(await ftsMatchIds("甲案の文面")).toEqual([]);
    expect(await ftsMatchIds("乙案の文面")).toEqual([id]);
    expect(await indexCountsOf(id)).toEqual({ documents: 1, fts: 1 });
    await expectConsistent([id]);
  });

  it("#155 AC-3 D-5b(c): 写しがない状態（登録の前）でも、古い本文の組は写しを入れず、編集の組が新しい本文で入れる", async () => {
    const { id } = await post(V, "丙案の文面です");
    // 写しを消して「登録の前」を作る（直接の SQL）
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_documents WHERE kind = 'message' AND ref_id = ?)",
      ).bind(id),
      env.DB.prepare(
        "DELETE FROM search_documents WHERE kind = 'message' AND ref_id = ?",
      ).bind(id),
    ]);
    const readByReindex = await currentBody(id);
    expect(await editCompat(id, V, "丁案の文面です")).toBe(1);
    await runIndexStatements(id, readByReindex);
    expect(await ftsMatchIds("丙案の文面")).toEqual([]);
    expect(await ftsMatchIds("丁案の文面")).toEqual([id]);
    await expectConsistent([id]);
  });

  it("#155 AC-3 D-5b(d): 逆の順（A の組 → 編集で B）は、B だけが残る", async () => {
    const { id } = await post(V, "戊案の文面です");
    await runIndexStatements(id, await currentBody(id));
    expect(await editCompat(id, V, "己案の文面です")).toBe(1);
    expect(await ftsMatchIds("戊案の文面")).toEqual([]);
    expect(await ftsMatchIds("己案の文面")).toEqual([id]);
    expect(await indexCountsOf(id)).toEqual({ documents: 1, fts: 1 });
    await expectConsistent([id]);
  });

  it("#155 AC-3 D-5b(e): 削除の確定の後に、古い本文の組を実行しても、写しは入らない", async () => {
    const { id } = await post(V, "庚案の文面です");
    const readByReindex = await currentBody(id);
    expect(await remove(id, V)).toBe(1);
    await runIndexStatements(id, readByReindex);
    expect(await ftsMatchIds("庚案の文面")).toEqual([]);
    expect(await indexCountsOf(id)).toEqual({ documents: 0, fts: 0 });
    await expectConsistent([id]);
  });

  it("#155 AC-3 D-5b(f): 同じ組を2回実行しても、写しの数は同じ（べき等）", async () => {
    const { id } = await post(V, "辛案の文面です");
    const before = await totalFtsRows();
    await runIndexStatements(id, await currentBody(id));
    await runIndexStatements(id, await currentBody(id));
    expect(await indexCountsOf(id)).toEqual({ documents: 1, fts: 1 });
    expect(await totalFtsRows()).toBe(before);
    expect(await ftsMatchIds("辛案の文面")).toEqual([id]);
    await expectConsistent([id]);
  });

  it("#155 AC-3 D-5b: 存在しないメッセージの組は、何も入れない", async () => {
    const missing = fixedIdAt(BASE_MS + 888_000);
    const before = await totalFtsRows();
    await runIndexStatements(missing, body("存在しない文面"));
    expect(await indexCountsOf(missing)).toEqual({ documents: 0, fts: 0 });
    expect(await totalFtsRows()).toBe(before);
  });

  it("#155 AC-3 D-5b: 登録の処理（reindexMessages）を2回実行しても、書き込みで作った写しと重ならない（不一致0件）", async () => {
    const a = await post(V, "壬案の文面です");
    const b = await post(O, "癸案の文面です");
    await buildSearchIndex();
    await buildSearchIndex();
    expect(await indexCountsOf(a.id)).toEqual({ documents: 1, fts: 1 });
    expect(await indexCountsOf(b.id)).toEqual({ documents: 1, fts: 1 });
    await expectConsistent();
  });
});

describe("#155 AC-3 D-6 既存の戻り値の契約（書いた件数）", () => {
  it("#155 AC-3 D-6: 投稿・返信は 1、条件を満たさなければ 0", async () => {
    const parent = await post(V, "戻り値の確認の親");
    expect(parent.changes).toBe(1);
    expect((await reply(O, parent.id, "戻り値の確認の返信")).changes).toBe(1);
    expect((await post(w.memberD1.id, "参加者でない人")).changes).toBe(0);
  });

  it("#155 AC-3 D-6: 編集（両方の経路）と削除は、本人なら 1、拒否なら 0（索引の書き込みの数を含めない）", async () => {
    const mine = await post(V, "戻り値の確認の本文");
    const others = await post(O, "戻り値の確認の他人");
    expect(await editCompat(mine.id, V, "戻り値の確認の一")).toBe(1);
    expect(await editBatch(mine.id, V, "戻り値の確認の二")).toBe(1);
    expect(await editCompat(others.id, V, "戻り値の確認の三")).toBe(0);
    expect(await editBatch(others.id, V, "戻り値の確認の四")).toBe(0);
    expect(await remove(others.id, V)).toBe(0);
    expect(await remove(mine.id, V)).toBe(1);
    expect(await remove(mine.id, V)).toBe(0);
  });
});

describe("#155 AC-3 D-7 書き込みの経路の一覧（それぞれの後で、索引と元の表の不一致0件）", () => {
  it("#155 AC-3 D-7: 7か所（投稿・返信・本文の UPDATE〔互換・batch〕・batch の拒否のガード・論理削除・添付の結び付けの確認）の後、不一致0件", async () => {
    const steps: { name: string; run: () => Promise<unknown> }[] = [];
    const ids: string[] = [];
    let parentId = "";
    let pendingAttachment = "";
    steps.push({
      name: "投稿",
      run: async () => {
        const r = await post(V, "経路一覧の投稿です");
        parentId = r.id;
        ids.push(r.id);
      },
    });
    steps.push({
      name: "返信",
      run: async () =>
        ids.push((await reply(O, parentId, "経路一覧の返信")).id),
    });
    steps.push({
      name: "本文の UPDATE（互換経路）",
      run: () => editCompat(parentId, V, "経路一覧の互換編集"),
    });
    steps.push({
      name: "本文の UPDATE（batch の経路）",
      run: () => editBatch(parentId, V, "経路一覧の一括編集"),
    });
    steps.push({
      name: "batch の経路の拒否（先頭のガードの UPDATE）",
      run: () => editBatch(ids[1] ?? "", V, "経路一覧の拒否編集"),
    });
    steps.push({
      name: "添付の結び付けの確認の UPDATE（添付つきの投稿）",
      run: async () => {
        pendingAttachment = await insertAttachmentRow({
          roomId: ROOM,
          uploaderId: V,
          messageId: null,
          threadParentId: null,
          originalName: `${TEST_TAG}経路一覧.txt`,
        });
        const r = await post(V, "経路一覧の添付投稿", [pendingAttachment]);
        expect(r.changes).toBe(1);
        ids.push(r.id);
      },
    });
    steps.push({
      name: "論理削除",
      run: () => remove(parentId, V),
    });
    for (const step of steps) {
      await step.run();
      expect({ step: step.name, ...(await indexMismatches()) }).toEqual({
        step: step.name,
        ...NO_MISMATCH,
      });
    }
    expect(ids).toHaveLength(3);
    expect(await ftsMatchIds("経路一覧の添付投稿")).toEqual([ids[2]]);
    expect(await ftsMatchIds("経路一覧の一括編集")).toEqual([]);
    expect(await ftsMatchIds("経路一覧の返信")).toEqual([ids[1]]);
  });
});
