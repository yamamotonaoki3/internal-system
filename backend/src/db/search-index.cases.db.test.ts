// #155（155-C）4-2 AC-1：案件の書き込みと、件名の索引（search_documents の kind = 'case_title'・search_fts）の整合。計画 7章 I-1〜I-4。
// 期待は、計画 2章（件名の行の形：ref_id=案件 ID・room_id/message_id は NULL・created_at=案件の作成日時・source_body=いまの件名。記号を除かない）、
//   3章（組は案件 ID だけで決まり、いまの案件の行を写す。べき等。承認・再編集の batch の末尾に足し、ガードと件数の確認を変えない）、
//   R1-1（再編集の結果は、更新の文の位置で読む。存在しない案件・版・状態・権限・担当部署の不変条件の崩れは、引き続き拒否で、索引も変わらない）、
//   0-A の3（件名を変える経路は承認と再編集の2つだけ。終了・再開・納期・参加者・取引先の改名・部署の改名は索引を変えない）から決める。実装から写さない。
// 索引の確かめ方は、本番の検索（Repository の searchCases）を通さず、test/search-case-fixtures.ts の直接の SQL で行う。
// 書き込みは、本物の Repository（case-request.repository.ts の approve・case.repository.ts の editCase）と、実際の API（終了・再開・納期・参加者）で行う。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiRequest } from "../../test/api-request";
import { closePath, reopenPath } from "../../test/case-close-fixtures";
import { caseEditSnapshot } from "../../test/case-edit-fixtures";
import {
  CASES_BASE,
  MISSING_CASE_ID,
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  CASEREQ_NOW,
  TEST_TAG,
  casereqTraceId,
  insertCaseRequest,
  setClientActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { setCaseStatus } from "../../test/case-participant-fixtures";
import { noReselectBody } from "../../test/case-reopen-fixtures";
import {
  NO_CASE_TITLE_MISMATCH,
  caseTitleIndexMismatches,
  caseTitleIndexRowsOf,
  caseTitleIndexSnapshot,
  cleanupCaseTitleIndex,
  ftsInstrCaseIds,
  ftsMatchCaseIds,
  insertCaseTitleIndexRow,
  insertOrphanFtsRow,
  runCaseTitleIndexStatements,
  totalCaseTitleDocuments,
} from "../../test/search-case-fixtures";
import { cleanupSearchIndex } from "../../test/search-fixtures";
import {
  CaseStateChangedError,
  withCases,
  type CaseEditFacts,
  type CaseEditWriteInput,
} from "./case.repository";
import { withCaseRequests } from "./case-request.repository";

const OLD_TITLE = "[UNIT_TEST]155C檜皮倉庫の点検";
const NEW_TITLE = "[UNIT_TEST]155C黄櫨工房の改修";
/** OLD_TITLE だけに続いた形で含まれる語（3文字以上・2文字） */
const OLD_WORD = "檜皮倉庫";
const OLD_PAIR = "檜皮";
/** NEW_TITLE だけに続いた形で含まれる語 */
const NEW_WORD = "黄櫨工房";
const NEW_PAIR = "黄櫨";

let w: CaseWorld;
/** 進行中・deptS 担当・clientA：memberS1（操作者）・memberS2。件名は OLD_TITLE。索引は beforeEach で作る */
let room: SeededCase;

const editFacts = (input: {
  caseId: string;
  actorId: string;
  clientId?: string;
  departmentIds?: readonly string[];
}) => withCases(env, (r) => r.findEditFacts(input));

type Change = {
  caseId?: string;
  actorId?: string;
  version?: number;
  title?: string;
  description?: string;
  clientId?: string;
  departmentIds?: string[];
};

/** 読んだ材料から、再編集の入力を作る（case-edit.repository.db.test.ts の inputFor と同じ意味。版の方式だけ） */
async function editInput(change: Change = {}): Promise<CaseEditWriteInput> {
  const caseId = change.caseId ?? room.id;
  const actorId = change.actorId ?? w.memberS1.id;
  const read = await editFacts({
    caseId,
    actorId,
    ...(change.clientId === undefined ? {} : { clientId: change.clientId }),
    ...(change.departmentIds === undefined
      ? {}
      : { departmentIds: change.departmentIds }),
  });
  const f: CaseEditFacts =
    read ??
    ({
      status: "active",
      version: 1,
      title: OLD_TITLE,
      description: "",
      actorIsParticipant: true,
      actorCanManage: false,
      client: { id: w.clientA.id, code: w.clientA.code, name: w.clientA.name },
      requestedClient: null,
      departmentIds: [w.deptS.id],
      requestedDepartments: [],
      joinUserIds: [],
    } satisfies CaseEditFacts);
  const requested = f.requestedClient;
  return {
    caseId,
    actorId,
    traceId: casereqTraceId(),
    basis: { version: change.version ?? f.version },
    before: {
      title: f.title,
      client: f.client,
      departmentIds: f.departmentIds,
    },
    ...(change.title === undefined ? {} : { title: change.title }),
    ...(change.description === undefined
      ? {}
      : { description: change.description }),
    ...(change.clientId === undefined || requested === null
      ? {}
      : {
          client: {
            id: requested.id,
            code: requested.code,
            name: requested.name,
          },
        }),
    ...(change.departmentIds === undefined
      ? {}
      : { departmentIds: change.departmentIds }),
    joinUserIds: f.joinUserIds,
  };
}

const edit = (input: CaseEditWriteInput) =>
  withCases(env, (r) => r.editCase(input));

const sorted = (values: readonly string[]) => [...values].sort();

async function caseRow(caseId: string) {
  const row = await env.DB.prepare(
    "SELECT title, created_at, version FROM cases WHERE id = ?",
  )
    .bind(caseId)
    .first<{ title: string; created_at: string; version: number }>();
  if (row === null) throw new Error(`案件 ${caseId} がありません`);
  return row;
}

beforeEach(async () => {
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1771,
    clientId: w.clientA.id,
    code: "QZA",
    title: OLD_TITLE,
    description: "[UNIT_TEST]155C索引の説明",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberS2.id, joinedAt: joinedAt(2) },
    ],
  });
  await runCaseTitleIndexStatements(room.id);
});

afterEach(async () => {
  try {
    await cleanupSearchIndex();
  } finally {
    await cleanupCaseTestData();
    await cleanupCaseTitleIndex();
  }
});

describe("#155 4-2 AC-1 I-1 件名の行の形と、組のべき等", () => {
  it("#155 4-2 AC-1 I-1: 組を当てた案件の件名の行は1行で、ref_id=案件 ID・部屋とメッセージは NULL・作成日時は案件の作成日時・元の件名と検索用の文はいまの件名", async () => {
    const created = (await caseRow(room.id)).created_at;
    const rows = await caseTitleIndexRowsOf(room.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "case_title",
      ref_id: room.id,
      room_id: null,
      message_id: null,
      created_at: created,
      source_body: OLD_TITLE,
      fts_text: OLD_TITLE,
    });
    expect(await ftsMatchCaseIds(OLD_WORD)).toEqual([room.id]);
    expect(await ftsInstrCaseIds(OLD_PAIR)).toEqual([room.id]);
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
  });

  it("#155 4-2 AC-1 I-1: 件名の記号は除かずに写す（マークダウンの記号・下線・角かっこを含む件名でも、検索用の文はいまの件名と同じ）", async () => {
    const symbolic = await seedCase({
      n: 1772,
      clientId: w.clientA.id,
      code: "QZA",
      title: "[UNIT_TEST]**蘇芳**_見積_v2 #1",
      createdBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
      members: [{ userId: w.memberS1.id, joinedAt: joinedAt(1) }],
    });
    await runCaseTitleIndexStatements(symbolic.id);
    const [row] = await caseTitleIndexRowsOf(symbolic.id);
    expect(row?.source_body).toBe("[UNIT_TEST]**蘇芳**_見積_v2 #1");
    expect(row?.fts_text).toBe("[UNIT_TEST]**蘇芳**_見積_v2 #1");
    expect(await ftsMatchCaseIds("**蘇芳**")).toEqual([symbolic.id]);
  });

  it("#155 4-2 AC-1 I-1: 組を2回当てても、件名の行は1行のまま（行の id も変わらない）", async () => {
    const before = await caseTitleIndexRowsOf(room.id);
    expect(before).toHaveLength(1);
    await runCaseTitleIndexStatements(room.id);
    expect(await caseTitleIndexRowsOf(room.id)).toEqual(before);
    expect(await totalCaseTitleDocuments()).toBe(1);
  });

  it("#155 4-2 AC-1 I-1: 存在しない案件の ID で組を当てても、件名の行は増えない", async () => {
    const before = await caseTitleIndexSnapshot();
    await runCaseTitleIndexStatements(MISSING_CASE_ID);
    expect(await caseTitleIndexSnapshot()).toEqual(before);
  });
});

describe("#155 4-2 AC-1 I-1 承認（案件の作成）の batch", () => {
  const approve = (requestId: string) =>
    withCaseRequests(env, (repository) =>
      repository.approve({
        requestId,
        version: 1,
        deciderId: w.ownerS.id,
        additionalCandidateIds: [],
        now: CASEREQ_NOW,
        traceId: casereqTraceId(),
      }),
    );

  it("#155 4-2 AC-1 I-1: 承認すると、作られた案件の件名で引け（3文字以上・2文字）、件名の行は案件の作成日時・いまの件名で1行。不一致は0件", async () => {
    const requestId = await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}155C藍染工房の承認`,
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
    });
    const { caseId } = await approve(requestId);
    expect(await ftsMatchCaseIds("藍染工房")).toEqual([caseId]);
    expect(await ftsInstrCaseIds("藍染")).toEqual([caseId]);
    const created = await caseRow(caseId);
    expect(await caseTitleIndexRowsOf(caseId)).toEqual([
      expect.objectContaining({
        ref_id: caseId,
        room_id: null,
        message_id: null,
        created_at: created.created_at,
        source_body: `${TEST_TAG}155C藍染工房の承認`,
        fts_text: `${TEST_TAG}155C藍染工房の承認`,
      }),
    ]);
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
  });

  it("#155 4-2 AC-1 I-4: 承認が前提の崩れ（取引先が無効）で失敗したら、件名の行は増えず、件名でも引けない", async () => {
    const requestId = await insertCaseRequest({
      clientId: w.clientB.id,
      title: `${TEST_TAG}155C浅葱工房の承認`,
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
    });
    await setClientActive(w.clientB.id, false);
    const before = await caseTitleIndexSnapshot();
    await expect(approve(requestId)).rejects.toThrow();
    expect(await caseTitleIndexSnapshot()).toEqual(before);
    expect(await ftsMatchCaseIds("浅葱工房")).toEqual([]);
  });
});

describe("#155 4-2 AC-1 I-1 再編集（EP-5-20）の batch", () => {
  it("#155 4-2 AC-1 I-1: 件名を変えると、新しい件名の語で引け、古い件名の語では引けない（3文字以上・2文字）。行は1行で、不一致は0件", async () => {
    // 先に「ある」を確かめる
    expect(await ftsMatchCaseIds(OLD_WORD)).toEqual([room.id]);
    await edit(await editInput({ title: NEW_TITLE }));
    expect(await ftsMatchCaseIds(NEW_WORD)).toEqual([room.id]);
    expect(await ftsInstrCaseIds(NEW_PAIR)).toEqual([room.id]);
    expect(await ftsMatchCaseIds(OLD_WORD)).toEqual([]);
    expect(await ftsInstrCaseIds(OLD_PAIR)).toEqual([]);
    const rows = await caseTitleIndexRowsOf(room.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source_body: NEW_TITLE,
      fts_text: NEW_TITLE,
    });
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
  });

  it("#155 4-2 AC-1 I-4: 件名を変える再編集の成功で、版 +1・監査 case.edit 1件・自動参加（足した部署の有効なオーナー）は既存どおり", async () => {
    const auditsBefore = (await caseEditSnapshot()).audits.length;
    await edit(
      await editInput({
        title: NEW_TITLE,
        departmentIds: [w.deptS.id, w.deptD.id],
      }),
    );
    expect((await caseRow(room.id)).version).toBe(2);
    const after = await caseEditSnapshot();
    expect(after.audits.filter((a) => a.action === "case.edit")).toHaveLength(
      1,
    );
    expect(after.audits.length).toBe(auditsBefore + 1);
    expect(
      after.members
        .filter((m) => m.channel_id === room.roomId)
        .map((m) => m.user_id),
    ).toContain(w.ownerD.id);
    expect(await ftsMatchCaseIds(NEW_WORD)).toEqual([room.id]);
  });

  it.each([
    { name: "取引先だけ", change: () => ({ clientId: w.clientB.id }) },
    {
      name: "担当部署だけ",
      change: () => ({ departmentIds: [w.deptS.id, w.deptD.id] }),
    },
    {
      name: "説明だけ",
      change: () => ({ description: "[UNIT_TEST]155C新しい説明" }),
    },
  ])(
    "#155 4-2 AC-1 I-3: 件名を変えない再編集（$name）の後も、件名の行は同じ行（id・中身とも）のままで、いまの件名で引け、不一致は0件",
    async ({ change }) => {
      const before = await caseTitleIndexRowsOf(room.id);
      expect(before).toHaveLength(1);
      await edit(await editInput(change()));
      expect((await caseRow(room.id)).version).toBe(2);
      expect(await caseTitleIndexRowsOf(room.id)).toEqual(before);
      expect(await ftsMatchCaseIds(OLD_WORD)).toEqual([room.id]);
      expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
    },
  );

  type Rejection = { name: string; input: () => Promise<CaseEditWriteInput> };
  const REJECTIONS: Rejection[] = [
    {
      name: "存在しない案件（計画 R1-1：更新の結果を読む位置がずれると通ってしまう）",
      input: () => editInput({ caseId: MISSING_CASE_ID, title: NEW_TITLE }),
    },
    {
      name: "版が読んだ値と違う",
      input: () => editInput({ title: NEW_TITLE, version: 2 }),
    },
    {
      name: "状態が違う（終了）",
      input: async () => {
        const input = await editInput({ title: NEW_TITLE });
        await setCaseStatus(room.id, "closed");
        return input;
      },
    },
    {
      name: "権限がない（参加者でも管理の資格もない社員）",
      input: () => editInput({ actorId: w.noDept.id, title: NEW_TITLE }),
    },
    {
      name: "担当部署の不変条件の崩れ（読んだ後に担当部署の集合が変わった）",
      input: async () => {
        const input = await editInput({ title: NEW_TITLE });
        await env.DB.prepare(
          "INSERT INTO case_departments (case_id, department_id) VALUES (?, ?)",
        )
          .bind(room.id, w.deptH.id)
          .run();
        return input;
      },
    },
  ];

  it.each(REJECTIONS)(
    "#155 4-2 AC-1 I-4: $name → CaseStateChangedError で、案件・監査と、件名の索引（行・行数・検索用の行）のどれも変わらず、古い件名で引ける",
    async ({ input }) => {
      const value = await input();
      const caseBefore = await caseEditSnapshot();
      const indexBefore = await caseTitleIndexSnapshot();
      expect(indexBefore.documents).toHaveLength(1);
      await expect(edit(value)).rejects.toBeInstanceOf(CaseStateChangedError);
      expect(await caseEditSnapshot()).toEqual(caseBefore);
      expect(await caseTitleIndexSnapshot()).toEqual(indexBefore);
      expect(await ftsMatchCaseIds(OLD_WORD)).toEqual([room.id]);
      expect(await ftsMatchCaseIds(NEW_WORD)).toEqual([]);
    },
  );
});

describe("#155 4-2 AC-1 I-3 件名を変えない経路（終了・再開・納期・参加者・取引先と部署の改名・無効化）", () => {
  const token = () => w.memberS1.token;

  it("#155 4-2 AC-1 I-3: 終了 → 再開の後も、件名の行は同じ行のままで、不一致は0件", async () => {
    const before = await caseTitleIndexRowsOf(room.id);
    expect(
      (await apiRequest("POST", closePath(room.id), { token: token() })).status,
    ).toBe(200);
    expect(await caseTitleIndexRowsOf(room.id)).toEqual(before);
    expect(
      (
        await apiRequest("POST", reopenPath(room.id), {
          token: token(),
          body: await noReselectBody(room.id),
        })
      ).status,
    ).toBe(200);
    expect(await caseTitleIndexRowsOf(room.id)).toEqual(before);
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
  });

  it("#155 4-2 AC-1 I-3: 納期の変更・参加者の追加・参加者の削除の後も、件名の行は同じ行のままで、不一致は0件", async () => {
    const before = await caseTitleIndexRowsOf(room.id);
    expect(
      (
        await apiRequest("PATCH", `${CASES_BASE}/${room.id}/due-date`, {
          token: token(),
          body: { dueDate: "2027-01-15" },
        })
      ).status,
    ).toBe(200);
    expect(await caseTitleIndexRowsOf(room.id)).toEqual(before);
    expect(
      (
        await apiRequest("POST", `${CASES_BASE}/${room.id}/participants`, {
          token: token(),
          body: { userId: w.memberD1.id },
        })
      ).status,
    ).toBeLessThan(300);
    expect(await caseTitleIndexRowsOf(room.id)).toEqual(before);
    expect(
      (
        await apiRequest(
          "DELETE",
          `${CASES_BASE}/${room.id}/participants/${w.memberD1.id}`,
          { token: token() },
        )
      ).status,
    ).toBeLessThan(300);
    expect(await caseTitleIndexRowsOf(room.id)).toEqual(before);
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
  });

  it("#155 4-2 AC-1 I-3: 取引先の改名・無効化、部署の改名の後も、件名の行は同じ行のまま（取引先名・部署名は検索の時に元の表で読む）", async () => {
    const before = await caseTitleIndexRowsOf(room.id);
    await env.DB.prepare(
      "UPDATE clients SET name = ?, name_normalized = ? WHERE id = ?",
    )
      .bind(
        `${TEST_TAG}155C改名後の取引先`,
        `${TEST_TAG}155C改名後の取引先`.toLowerCase(),
        w.clientA.id,
      )
      .run();
    await setClientActive(w.clientA.id, false);
    await env.DB.prepare("UPDATE departments SET name = ? WHERE id = ?")
      .bind(`${TEST_TAG}155C改名後の部署`, w.deptS.id)
      .run();
    expect(await caseTitleIndexRowsOf(room.id)).toEqual(before);
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
  });
});

describe("#155 4-2 AC-1 I-2 件名の索引と cases の不一致の数え（わざと壊した行を1件と数えることを先に確かめる）", () => {
  it("#155 I-2: 案件に件名の行が無い → missing 1。組を当てると0", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_documents WHERE kind = 'case_title' AND ref_id = ?)",
      ).bind(room.id),
      env.DB.prepare(
        "DELETE FROM search_documents WHERE kind = 'case_title' AND ref_id = ?",
      ).bind(room.id),
    ]);
    expect(await caseTitleIndexMismatches()).toEqual({
      ...NO_CASE_TITLE_MISMATCH,
      missing: 1,
    });
    await runCaseTitleIndexStatements(room.id);
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
  });

  it("#155 I-2: 元の案件の無い件名の行 → missingCase 1。その ID で組を当てると0（孤立の行は消える）", async () => {
    await insertCaseTitleIndexRow({
      caseId: MISSING_CASE_ID,
      createdAt: CASEREQ_NOW,
      sourceBody: "[UNIT_TEST]155C孤立した件名",
    });
    expect(await caseTitleIndexMismatches()).toEqual({
      ...NO_CASE_TITLE_MISMATCH,
      missingCase: 1,
    });
    await runCaseTitleIndexStatements(MISSING_CASE_ID);
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
    expect(await ftsMatchCaseIds("孤立した件名")).toEqual([]);
  });

  it("#155 I-2: 件名が DB の上で変わり、組を当てていない → wrongTitle 1。組を当てると0で、新しい件名で引け、古い件名で引けない", async () => {
    await env.DB.prepare("UPDATE cases SET title = ? WHERE id = ?")
      .bind(NEW_TITLE, room.id)
      .run();
    expect(await caseTitleIndexMismatches()).toEqual({
      ...NO_CASE_TITLE_MISMATCH,
      wrongTitle: 1,
    });
    await runCaseTitleIndexStatements(room.id);
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
    expect(await ftsMatchCaseIds(NEW_WORD)).toEqual([room.id]);
    expect(await ftsMatchCaseIds(OLD_WORD)).toEqual([]);
  });

  it("#155 I-2: 写しの作成日時が案件と違う → wrongCreatedAt 1。組を当てると0", async () => {
    await env.DB.prepare(
      "UPDATE search_documents SET created_at = ? WHERE kind = 'case_title' AND ref_id = ?",
    )
      .bind("2020-01-01T00:00:00.000Z", room.id)
      .run();
    expect(await caseTitleIndexMismatches()).toEqual({
      ...NO_CASE_TITLE_MISMATCH,
      wrongCreatedAt: 1,
    });
    await runCaseTitleIndexStatements(room.id);
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
  });

  it("#155 I-2: 件名の行の部屋・メッセージの列が NULL でない → wrongColumns 1", async () => {
    await env.DB.prepare(
      "UPDATE search_documents SET room_id = ? WHERE kind = 'case_title' AND ref_id = ?",
    )
      .bind(room.roomId, room.id)
      .run();
    expect(await caseTitleIndexMismatches()).toEqual({
      ...NO_CASE_TITLE_MISMATCH,
      wrongColumns: 1,
    });
  });

  it("#155 I-2 R1-7: 対応の行だけ（検索用の行が無い）→ withoutFts 1", async () => {
    const other = await seedCase({
      n: 1773,
      clientId: w.clientA.id,
      code: "QZA",
      title: "[UNIT_TEST]155C対応だけの件名",
      createdBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
    });
    await insertCaseTitleIndexRow({
      caseId: other.id,
      createdAt: CASEREQ_NOW,
      sourceBody: "[UNIT_TEST]155C対応だけの件名",
      withFts: false,
    });
    expect(await caseTitleIndexMismatches()).toEqual({
      ...NO_CASE_TITLE_MISMATCH,
      withoutFts: 1,
    });
  });

  it("#155 I-2 R1-7: 検索用の行だけ（対応の行が無い）→ orphanFts 1", async () => {
    await insertOrphanFtsRow(987_654_321, "[UNIT_TEST]155C検索用だけの件名");
    expect(await caseTitleIndexMismatches()).toEqual({
      ...NO_CASE_TITLE_MISMATCH,
      orphanFts: 1,
    });
  });

  it("#155 I-2: 検索用の行の文が、対応の行の元の件名と違う → wrongFtsText 1", async () => {
    const other = await seedCase({
      n: 1774,
      clientId: w.clientA.id,
      code: "QZA",
      title: "[UNIT_TEST]155C文の違う件名",
      createdBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
    });
    await insertCaseTitleIndexRow({
      caseId: other.id,
      createdAt: CASEREQ_NOW,
      sourceBody: "[UNIT_TEST]155C文の違う件名",
      ftsText: "[UNIT_TEST]155C別の文",
    });
    expect(await caseTitleIndexMismatches()).toEqual({
      ...NO_CASE_TITLE_MISMATCH,
      wrongFtsText: 1,
    });
  });

  it("#155 I-3: 承認・再編集（件名あり・なし）・終了の各経路を続けて通した後、件名の索引の不一致は0件（案件は2件・行も2行）", async () => {
    const requestId = await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}155C通し経路の承認`,
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
    });
    const { caseId } = await withCaseRequests(env, (repository) =>
      repository.approve({
        requestId,
        version: 1,
        deciderId: w.ownerS.id,
        additionalCandidateIds: [],
        now: CASEREQ_NOW,
        traceId: casereqTraceId(),
      }),
    );
    await edit(await editInput({ title: NEW_TITLE }));
    await edit(await editInput({ description: "[UNIT_TEST]155C通しの説明" }));
    expect(
      (
        await apiRequest("POST", closePath(room.id), {
          token: w.memberS1.token,
        })
      ).status,
    ).toBe(200);
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
    expect(await totalCaseTitleDocuments()).toBe(2);
    expect(sorted(await ftsMatchCaseIds("155C"))).toEqual(
      sorted([room.id, caseId]),
    );
  });
});

describe("#155 4-2 AC-1 I-2 組は、写しの形の崩れも直す（計画 2章の写しの形：部屋・メッセージの列は NULL・検索用の文は件名。組を当てると、いまの行と一致する）", () => {
  it.each([
    {
      name: "写しの部屋の列が NULL でない",
      breakIt: () =>
        env.DB.prepare(
          "UPDATE search_documents SET room_id = ? WHERE kind = 'case_title' AND ref_id = ?",
        )
          .bind(room.roomId, room.id)
          .run(),
      broken: { wrongColumns: 1 },
    },
    {
      name: "写しのメッセージの列が NULL でない",
      breakIt: () =>
        env.DB.prepare(
          "UPDATE search_documents SET message_id = ? WHERE kind = 'case_title' AND ref_id = ?",
        )
          .bind(room.roomId, room.id)
          .run(),
      broken: { wrongColumns: 1 },
    },
    {
      name: "検索用の行が無い（対応の行だけ）",
      breakIt: () =>
        env.DB.prepare(
          "DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_documents WHERE kind = 'case_title' AND ref_id = ?)",
        )
          .bind(room.id)
          .run(),
      broken: { withoutFts: 1 },
    },
    {
      name: "検索用の行の文が件名と違う",
      breakIt: () =>
        env.DB.prepare(
          "UPDATE search_fts SET text = ? WHERE rowid IN (SELECT id FROM search_documents WHERE kind = 'case_title' AND ref_id = ?)",
        )
          .bind("[UNIT_TEST]155C壊れた検索用の文", room.id)
          .run(),
      broken: { wrongFtsText: 1 },
    },
  ])(
    "#155 I-2: $name → 先に1件と数え、組を当てると不一致が0件になり、いまの件名で引ける",
    async ({ breakIt, broken }) => {
      await breakIt();
      expect(await caseTitleIndexMismatches()).toEqual({
        ...NO_CASE_TITLE_MISMATCH,
        ...broken,
      });
      await runCaseTitleIndexStatements(room.id);
      expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
      expect(await ftsMatchCaseIds(OLD_WORD)).toEqual([room.id]);
      expect(await caseTitleIndexRowsOf(room.id)).toHaveLength(1);
    },
  );
});

describe("#155 4-2 AC-1 I-1 組は、その案件の件名の写しだけを扱う（ほかの種類・ほかの案件の行に触れない。SQL の条件を外す手での確認で見つけた不足）", () => {
  it("#155 I-1: 同じ ref_id の、種類の違う行（kind=message）は、組を当てても消えず、検索用の行も足されない（対照：その案件の件名の写しは直る）", async () => {
    // 種類の違う行：部屋の列があり（件名の写しとしては崩れた形）、検索用の行が無い
    const otherKind = await insertCaseTitleIndexRow({
      caseId: room.id,
      kind: "message",
      roomId: room.roomId,
      messageId: room.roomId,
      createdAt: CASEREQ_NOW,
      sourceBody: "[UNIT_TEST]155C種類の違う行",
      withFts: false,
    });
    await env.DB.prepare("UPDATE cases SET title = ? WHERE id = ?")
      .bind(NEW_TITLE, room.id)
      .run();
    await runCaseTitleIndexStatements(room.id);
    // 対照：件名の写しは新しい件名に直る
    expect(await ftsMatchCaseIds(NEW_WORD)).toEqual([room.id]);
    const kept = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM search_documents WHERE id = ?1) AS documents,
              (SELECT COUNT(*) FROM search_fts WHERE rowid = ?1) AS fts`,
    )
      .bind(otherKind)
      .first<{ documents: number; fts: number }>();
    expect(kept).toEqual({ documents: 1, fts: 0 });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM search_documents WHERE id = ?").bind(
        otherKind,
      ),
    ]);
  });

  it("#155 I-1: ほかの案件の崩れた写し（件名が違う・検索用の行が無い）は、この案件の組では直さない（対照：この案件の写しは直る）", async () => {
    const other = await seedCase({
      n: 1775,
      clientId: w.clientA.id,
      code: "QZA",
      title: "[UNIT_TEST]155C別の案件の件名",
      createdBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
    });
    await runCaseTitleIndexStatements(other.id);
    await env.DB.prepare("UPDATE cases SET title = ? WHERE id = ?")
      .bind("[UNIT_TEST]155C別の案件の新しい件名", other.id)
      .run();
    const third = await seedCase({
      n: 1776,
      clientId: w.clientA.id,
      code: "QZA",
      title: "[UNIT_TEST]155C三つ目の案件の件名",
      createdBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
    });
    await insertCaseTitleIndexRow({
      caseId: third.id,
      createdAt: CASEREQ_NOW,
      sourceBody: "[UNIT_TEST]155C三つ目の案件の件名",
      withFts: false,
    });
    await env.DB.prepare("UPDATE cases SET title = ? WHERE id = ?")
      .bind(NEW_TITLE, room.id)
      .run();
    expect(await caseTitleIndexMismatches()).toEqual({
      ...NO_CASE_TITLE_MISMATCH,
      wrongTitle: 2,
      withoutFts: 1,
    });
    await runCaseTitleIndexStatements(room.id);
    expect(await ftsMatchCaseIds(NEW_WORD)).toEqual([room.id]);
    // ほかの2件の崩れは残る（それぞれの組か、登録の処理で直す）
    expect(await caseTitleIndexMismatches()).toEqual({
      ...NO_CASE_TITLE_MISMATCH,
      wrongTitle: 1,
      withoutFts: 1,
    });
  });

  it("#155 I-2: 元の案件の無い写しは、ほかの案件と件名・作成日時が同じでも、組を当てると消える（案件の実在は ref_id で確かめる）", async () => {
    const created = (await caseRow(room.id)).created_at;
    await insertCaseTitleIndexRow({
      caseId: MISSING_CASE_ID,
      createdAt: created,
      sourceBody: OLD_TITLE,
    });
    expect(await caseTitleIndexMismatches()).toEqual({
      ...NO_CASE_TITLE_MISMATCH,
      missingCase: 1,
    });
    await runCaseTitleIndexStatements(MISSING_CASE_ID);
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
    expect(await ftsMatchCaseIds(OLD_WORD)).toEqual([room.id]);
  });
});
