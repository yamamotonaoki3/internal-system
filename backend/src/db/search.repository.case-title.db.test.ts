// #155（155-C）R-0：案件の件名の写し（kind = 'case_title'。部屋・メッセージの列が NULL）が、メッセージの検索（EP-4-01 の searchMessages）に出ないこと。
// 期待は、計画 0-A の1（メッセージの検索は、メッセージとの内部結合・部屋の一致・種類ごとの適格の条件で、件名の行を落とす。SQL は変えない）、
//   2章（件名の行の room_id を案件の部屋にしない：メッセージの検索の部屋・期間の絞り込みに混ざらないため）から決める。
// 否定の確認が常に通る形にならないよう、件名と同じ固定の語を本文に持つメッセージを対照に置き、対照が1件出ることを先に確かめる。
// 件名の行は、案件の書き込みの組（syncCaseTitleIndexStatements）で作る。データは架空（testuser_casereq_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
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
} from "../../test/related-reads-fixtures";
import {
  cleanupCaseTitleIndex,
  ftsMatchCaseIds,
  runCaseTitleIndexStatements,
} from "../../test/search-case-fixtures";
import {
  buildSearchIndex,
  cleanupSearchIndex,
} from "../../test/search-fixtures";
import { withSearch } from "./search.repository";

const BASE_MS = 1_881_000_000_000;
const ROOM = fixedIdAt(BASE_MS);
/** 件名と本文の両方にある語（3文字以上・2文字） */
const SHARED = "鶯谷倉庫";
const SHARED_PAIR = "鶯谷";
/** 件名だけにある語 */
const TITLE_ONLY = "鶺鴒倉庫";
const TITLE_ONLY_PAIR = "鶺鴒";

let w: CaseWorld;
let joined: SeededCase;
let messageId: string;

async function messageIds(
  term: string,
  options: {
    roomId?: string;
    createdFrom?: string;
    createdBefore?: string;
  } = {},
) {
  const page = await withSearch(env, (repo) =>
    repo.searchMessages(w.memberS1.id, {
      term,
      limit: 50,
      includeDirect: true,
      includeCase: true,
      ...options,
    }),
  );
  return page.items.map((item) => item.messageId);
}

beforeEach(async () => {
  w = await setupCaseWorld();
  await insertChannel({
    id: ROOM,
    name: `${TEST_TAG}search-155c-r0`,
    purpose: "normal",
    departmentId: w.deptS.id,
    visibility: "public",
  });
  await insertMember(ROOM, w.memberS1.id);
  messageId = fixedIdAt(BASE_MS + 10_000);
  await env.DB.prepare(
    `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at)
     VALUES (?, ?, ?, 'テスト太郎', ?, ?)`,
  )
    .bind(
      messageId,
      ROOM,
      w.memberS1.id,
      `${TEST_TAG}本文の${SHARED}の話`,
      new Date(BASE_MS + 10_000).toISOString(),
    )
    .run();
  // 閲覧者が参加している案件（参加していれば、案件の部屋のメッセージは検索に出る。件名の行は出てはいけない）
  joined = await seedCase({
    n: 1781,
    clientId: w.clientA.id,
    code: "QZA",
    title: `${TEST_TAG}155C${SHARED}と${TITLE_ONLY}の案件`,
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [{ userId: w.memberS1.id, joinedAt: joinedAt(1) }],
  });
  await buildSearchIndex();
  await runCaseTitleIndexStatements(joined.id);
});

afterEach(async () => {
  try {
    await cleanupSearchIndex();
  } finally {
    await cleanupRelatedReadsRooms([ROOM]);
    await cleanupCaseTestData();
    await cleanupCaseTitleIndex();
  }
});

describe("#155 4-1 AC-1 R-0 件名の行はメッセージの検索に出ない", () => {
  it("#155 R-0: 件名の行があること（索引を直接引いて1件）を先に確かめる", async () => {
    expect(await ftsMatchCaseIds(TITLE_ONLY)).toEqual([joined.id]);
    expect(await ftsMatchCaseIds(SHARED)).toEqual([joined.id]);
  });

  it("#155 R-0: 件名と本文の両方にある語（3文字以上・2文字）では、本文のメッセージ1件だけが出る（対照）", async () => {
    expect(await messageIds(SHARED)).toEqual([messageId]);
    expect(await messageIds(SHARED_PAIR)).toEqual([messageId]);
  });

  it("#155 R-0: 件名だけにある語（3文字以上・2文字）では、メッセージの検索は0件", async () => {
    expect(await messageIds(SHARED)).toEqual([messageId]);
    expect(await messageIds(TITLE_ONLY)).toEqual([]);
    expect(await messageIds(TITLE_ONLY_PAIR)).toEqual([]);
  });

  it("#155 R-0: 案件の部屋（roomId）・期間の絞り込みをつけても、件名の行は出ない（対照の部屋・期間では本文が出る）", async () => {
    const from = new Date(BASE_MS).toISOString();
    const before = new Date(BASE_MS + 1_000_000).toISOString();
    expect(
      await messageIds(SHARED, {
        roomId: ROOM,
        createdFrom: from,
        createdBefore: before,
      }),
    ).toEqual([messageId]);
    expect(await messageIds(TITLE_ONLY, { roomId: joined.roomId })).toEqual([]);
    expect(await messageIds(SHARED, { roomId: joined.roomId })).toEqual([]);
    // 件名の行の作成日時（案件の作成日時）を含む期間でも出ない
    expect(
      await messageIds(TITLE_ONLY, {
        createdFrom: "2000-01-01T00:00:00.000Z",
        createdBefore: "2100-01-01T00:00:00.000Z",
      }),
    ).toEqual([]);
  });
});
