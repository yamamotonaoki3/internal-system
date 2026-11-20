// #150（150-C）5-1 AC-20・C-122・C-124・C-129・C-130・C-133・C-140：案件の再編集の Repository（本物の db.batch。隔離 D1）。
// この層で確かめるもの（計画 150-C 6章の「DB」「D1 の上限」「2回目 重大2」の行）：
//   - 材料の読み取り（findEditFacts）：いまの値・求めた取引先と部署・自動参加させる人（足す部署の有効なオーナーで参加の行がない人。
//     兼任でも1人・無効なオーナーとすでに参加の人は入らない）。案件がなければ null。ほかの案件の行がある状態（#294）
//   - 成功：各項目の更新・版 +1・case_number／number_client_id／due_date は変わらない、監査 case.edit の detail のキーと型（平ら・説明の本文なし）、
//     通知が増えない（C-124・C-140(3)）、自動参加の行、外した部署のオーナーは参加者として残る（C-133(2)）
//   - 重大1：存在しない案件 ID では監査が増えない（何も残らない）
//   - 前提（計画 4.4 の editCondition）を1つずつ崩すと、CaseStateChangedError で何も残らない
//   - 文を差し替えて（計画 4.4 の件数の確認）：余分な削除・余分な追加・自動参加 0 行（重大2）・余分な自動参加・更新 0 行・監査 0 行・
//     末尾の不変条件（担当部署 1 件以上）で全体が取り消される（差し替えない文の列は成功する＝仕組みの確認）
//   - 2回目 重大2：expected の方式で、読んだ後に説明・納期だけが変わっても成功し、ほかの人の値は残る。版の方式では同じ変化で崩れる
//   - D1 の上限：部署 120 件の追加・兼任のオーナー多数で成り立ち、生成したすべての文の束縛値が 100 以下、文の数が 12 以下
// 判定の順・応答は Service・結合のテストで確かめ、ここでは重ねない。
// 契約（実装前の仮置き。計画 150-C 4.3・4.4。実装の担当へ。テストが決めた形）：backend/src/db/case.repository.ts に
//   export type CaseEditFacts（services/case-edit.decide.test.ts の冒頭を参照）
//   createCaseRepository(db).findEditFacts(input: { caseId, actorId, clientId?: string, departmentIds?: readonly string[] }): Promise<CaseEditFacts | null>
//     joinUserIds は「departmentIds のうち、いまの担当部署にない部署」の有効なオーナー（scope_type = 'department'）で、参加の行がない人
//   export type CaseEditWriteInput = {
//     caseId, actorId, traceId,
//     basis: { version: number } | { expected: { title, clientId, departmentIds: readonly string[] } },
//     before: { title, client: { id, code, name }, departmentIds: readonly string[] },   // 読んだ材料（監査の前の値・「読んだまま」の前提）
//     title?, description?, client?: { id, code, name }, departmentIds?: readonly string[], // 変える項目だけ（件名は整形後）
//     joinUserIds: readonly string[],
//   }
//   export function buildEditStatements(db: Database, input: CaseEditWriteInput): BatchItem[]（計画 4.4 の順：1 前提 → 2 監査 → 2a →
//     3 部署の削除 → 3a → 4 部署の追加 → 4a → 5 自動参加 → 5a → 6 案件の更新〔RETURNING〕→ 6a → 7 不変条件。件数の確認は対象の文の直後）
//   createCaseRepository(db).editCase(input: CaseEditWriteInput): Promise<void>（前提が崩れていたら CaseStateChangedError）
// 監査の detail（計画 4.4。変えた項目のキーだけ）：caseId、changedFields（"title,description,client,departments" のうち変えたものを、この順に「,」でつなぐ）、
//   titleBefore・titleAfter、descriptionChanged: true、clientIdBefore・clientCodeBefore・clientNameBefore・clientIdAfter・clientCodeAfter・clientNameAfter、
//   departmentIdsBefore・departmentIdsAfter（ID の昇順を「,」でつなぐ）、departmentAddedCount・departmentRemovedCount・caseJoinCount（部署を変えたとき）
// 時刻は EDIT_NOW に固定する。データは架空（testuser_casereq_・testuser_case150c_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cases } from "../../db/schema";
import {
  MISSING_CASE_ID,
  addCaseMember,
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import { bumpCaseVersion } from "../../test/case-close-fixtures";
import {
  assignOwners,
  replaceOwner,
  caseDepartmentIdsOf,
  caseEditAudits,
  caseEditRow,
  caseEditSnapshot,
  insertBulkDepartments,
  insertBulkEditUsers,
  notificationCount,
  setCaseColumns,
} from "../../test/case-edit-fixtures";
import {
  isFlat,
  parseDetail,
  participantIdsOf,
  setCaseStatus,
} from "../../test/case-participant-fixtures";
import {
  casereqTraceId,
  removeOwner,
  setClientActive,
  setDepartmentActive,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { insertDepartmentWithChannels } from "../../test/department-fixtures";
import {
  CaseStateChangedError,
  buildEditStatements,
  runWriteBatch,
  withCases,
  type CaseEditFacts,
  type CaseEditWriteInput,
} from "./case.repository";
import { withDatabase, type Database } from "./database";

const EDIT_NOW = "2026-11-20T02:00:00.000Z";
const TITLE = "[UNIT_TEST]150C再編集の前の件名";
const DESCRIPTION = "[UNIT_TEST]150C再編集の前の説明";

let w: CaseWorld;
/**
 * 進行中・deptS 担当・clientA：memberS1（操作者）・memberS2・ownerS（自動参加の担当部署のオーナー）・admin（全体管理者）・inactive（退職者の行）。
 * memberD1・ownerD・ownerH・noDept は参加していない
 */
let room: SeededCase;
/** 進行中・deptD 担当・clientB：memberD1・ownerD（変わらないことを確かめる別の案件。#294 の「ほかの行」） */
let other: SeededCase;

const sorted = (ids: readonly string[]) => [...ids].sort();

const factsFor = (input: {
  caseId: string;
  actorId: string;
  clientId?: string;
  departmentIds?: readonly string[];
}) => withCases(env, (r) => r.findEditFacts(input));

type Change = {
  caseId?: string;
  actorId?: string;
  basis?: "version" | "expected";
  version?: number;
  title?: string;
  description?: string;
  clientId?: string;
  departmentIds?: string[];
};

/** 読んだ時点の材料から、再編集の入力を作る（Service が組むものと同じ意味。計画 4.3・4.4） */
async function inputFor(change: Change = {}): Promise<CaseEditWriteInput> {
  const caseId = change.caseId ?? room.id;
  const actorId = change.actorId ?? w.memberS1.id;
  const read = await factsFor({
    caseId,
    actorId,
    ...(change.clientId === undefined ? {} : { clientId: change.clientId }),
    ...(change.departmentIds === undefined
      ? {}
      : { departmentIds: change.departmentIds }),
  });
  // 案件がないときは、ほかの案件の材料の形を借りる（存在しない案件 ID への書き込みを試すため）
  const f: CaseEditFacts =
    read ??
    ({
      status: "active",
      version: 1,
      title: TITLE,
      description: DESCRIPTION,
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
    basis:
      change.basis === "expected"
        ? {
            expected: {
              title: f.title,
              clientId: f.client.id,
              departmentIds: f.departmentIds,
            },
          }
        : { version: change.version ?? f.version },
    before: {
      title: f.title,
      client: f.client,
      departmentIds: f.departmentIds,
    },
    ...(change.title === undefined ? {} : { title: change.title }),
    ...(change.description === undefined
      ? {}
      : { description: change.description }),
    ...(change.clientId === undefined
      ? {}
      : {
          client:
            requested === null
              ? { id: change.clientId, code: "QZZ", name: "[UNIT_TEST]不明" }
              : {
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

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(EDIT_NOW));
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1631,
    clientId: w.clientA.id,
    code: "QZA",
    title: TITLE,
    description: DESCRIPTION,
    dueDate: "2026-12-24",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberS2.id, joinedAt: joinedAt(2) },
      { userId: w.ownerS.id, joinedAt: joinedAt(3) },
      { userId: w.admin.id, joinedAt: joinedAt(4) },
      { userId: w.inactive.id, joinedAt: joinedAt(5) },
    ],
  });
  other = await seedCase({
    n: 1632,
    clientId: w.clientB.id,
    code: "QZB",
    title: "[UNIT_TEST]150C別の案件",
    createdBy: w.memberD1.id,
    departmentIds: [w.deptD.id],
    members: [
      { userId: w.memberD1.id, joinedAt: joinedAt(1) },
      { userId: w.ownerD.id, joinedAt: joinedAt(2) },
    ],
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanupCaseTestData();
});

describe("#150 150-C 材料の読み取り（findEditFacts。計画 4.3）", () => {
  it("#150 4.3: いまの件名・説明・取引先（コード・名前）・担当部署・版・資格と、求めた取引先・部署を返す", async () => {
    const facts = await factsFor({
      caseId: room.id,
      actorId: w.memberS1.id,
      clientId: w.clientOff.id,
      departmentIds: [w.deptS.id, w.deptD.id],
    });
    expect(facts).toMatchObject({
      status: "active",
      version: 1,
      title: TITLE,
      description: DESCRIPTION,
      actorIsParticipant: true,
      actorCanManage: false,
      client: { id: w.clientA.id, code: "QZA", name: w.clientA.name },
      requestedClient: {
        id: w.clientOff.id,
        code: "QZX",
        name: w.clientOff.name,
        isActive: false,
      },
      departmentIds: [w.deptS.id],
    });
    expect(
      sorted(
        (facts?.requestedDepartments ?? []).map((d) => `${d.id}:${d.isActive}`),
      ),
    ).toEqual(sorted([`${w.deptS.id}:true`, `${w.deptD.id}:true`]));
  });

  it("#150 4.3: 非参加の担当部署のオーナー（ownerD は deptD のオーナー。room を deptD 担当にする前は資格なし）と全体管理者の資格", async () => {
    const owner = await factsFor({ caseId: room.id, actorId: w.ownerH.id });
    expect(owner).toMatchObject({
      actorIsParticipant: false,
      actorCanManage: false,
    });
    // admin は参加しているので、参加していない全体管理者の代わりに、参加していない担当部署のオーナーを作る
    await replaceOwner(w.memberD1.id, w.deptS.id);
    expect(
      await factsFor({ caseId: room.id, actorId: w.memberD1.id }),
    ).toMatchObject({ actorIsParticipant: false, actorCanManage: true });
  });

  it("#150 4.3・重大2: 自動参加させる人は、足す部署の有効なオーナーで参加の行がない人。兼任（deptD・deptH の両方のオーナー）でも1人", async () => {
    await replaceOwner(w.ownerD.id, w.deptH.id);
    const facts = await factsFor({
      caseId: room.id,
      actorId: w.memberS1.id,
      departmentIds: [w.deptS.id, w.deptD.id, w.deptH.id],
    });
    // deptH のオーナーを ownerD に入れ替えた（ownerD が deptD・deptH の両方のオーナー）→ 1人だけ
    expect(facts?.joinUserIds).toEqual([w.ownerD.id]);
  });

  it("#150 4.3・重大2: 無効なオーナー・すでに参加の行があるオーナー・いまの担当部署（足さない部署）のオーナーは入らない", async () => {
    await setUserActive(w.ownerH.id, false);
    await replaceOwner(w.memberS2.id, w.deptD.id);
    const facts = await factsFor({
      caseId: room.id,
      actorId: w.memberS1.id,
      departmentIds: [w.deptS.id, w.deptD.id, w.deptH.id],
    });
    // deptD のオーナー：memberS2（参加している）→ なし。deptH：ownerH（無効）→ なし。deptS（ownerS）：足さない
    expect(facts?.joinUserIds).toEqual([]);
  });

  it("#150 4.3: 部署を送らなければ、自動参加させる人はいない", async () => {
    expect(
      (await factsFor({ caseId: room.id, actorId: w.memberS1.id }))
        ?.joinUserIds,
    ).toEqual([]);
  });

  it("#150 4.3: 案件がなければ null", async () => {
    expect(
      await factsFor({ caseId: MISSING_CASE_ID, actorId: w.memberS1.id }),
    ).toBeNull();
  });

  it("#294: ほかの案件（other）の参加者・担当部署の行があっても、room の資格・担当部署に混ざらない", async () => {
    const facts = await factsFor({ caseId: room.id, actorId: w.memberD1.id });
    expect(facts).toMatchObject({
      actorIsParticipant: false,
      actorCanManage: false,
      departmentIds: [w.deptS.id],
    });
    const ownerOfOther = await factsFor({
      caseId: room.id,
      actorId: w.ownerD.id,
    });
    expect(ownerOfOther).toMatchObject({
      actorIsParticipant: false,
      actorCanManage: false,
    });
  });
});

describe("#150 150-C 成功（5-1 AC-20・C-122・C-124・C-129・C-130・C-133）", () => {
  it("#150 AC-20: 件名・説明・取引先を変え、deptS を外し deptD を足すと、1回の batch で全部そろい、版 +1・案件番号・納期は変わらない", async () => {
    const before = await caseEditRow(room.id);
    const notificationsBefore = await notificationCount();
    await edit(
      await inputFor({
        title: "[UNIT_TEST]150C再編集の後の件名",
        description: "[UNIT_TEST]150C再編集の後の説明",
        clientId: w.clientB.id,
        departmentIds: [w.deptD.id],
      }),
    );
    expect(await caseEditRow(room.id)).toEqual({
      ...before,
      title: "[UNIT_TEST]150C再編集の後の件名",
      description: "[UNIT_TEST]150C再編集の後の説明",
      client_id: w.clientB.id,
      version: 2,
      updated_at: EDIT_NOW,
    });
    // 案件番号・番号の取引先は変えない（C-129(2)）
    expect(before.case_number).toBe(room.caseNumber);
    expect(before.number_client_id).toBe(w.clientA.id);
    expect(await caseDepartmentIdsOf(room.id)).toEqual([w.deptD.id]);
    // 足した deptD の有効なオーナーが参加する（C-133(3)）。外した deptS のオーナー ownerS は一般の参加者として残る（C-133(2)）
    expect(await participantIdsOf(room.roomId)).toEqual(
      sorted([
        w.memberS1.id,
        w.memberS2.id,
        w.ownerS.id,
        w.admin.id,
        w.inactive.id,
        w.ownerD.id,
      ]),
    );
    // 通知しない（C-124・C-140(3)）
    expect(await notificationCount()).toBe(notificationsBefore);
    // 別の案件は変わらない
    expect(await caseDepartmentIdsOf(other.id)).toEqual([w.deptD.id]);
    expect(await participantIdsOf(other.roomId)).toEqual(
      sorted([w.memberD1.id, w.ownerD.id]),
    );
  });

  it("#150 C-122(5)・C-129(3)・C-130(3): 監査 case.edit は1件で、detail は平らで、変えた項目の前後（取引先は ID・コード・名前）と件数を持ち、説明の本文を持たない", async () => {
    await edit(
      await inputFor({
        title: "[UNIT_TEST]150C監査の後の件名",
        description: "[UNIT_TEST]150C監査に出てはいけない説明",
        clientId: w.clientB.id,
        departmentIds: [w.deptD.id, w.deptH.id],
      }),
    );
    const audits = await caseEditAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.memberS1.id,
      action: "case.edit",
      target_type: "case",
      target_id: room.id,
      result: "success",
    });
    const detail = parseDetail(audits[0]?.detail ?? null);
    expect(detail).toEqual({
      caseId: room.id,
      changedFields: "title,description,client,departments",
      titleBefore: TITLE,
      titleAfter: "[UNIT_TEST]150C監査の後の件名",
      descriptionChanged: true,
      clientIdBefore: w.clientA.id,
      clientCodeBefore: "QZA",
      clientNameBefore: w.clientA.name,
      clientIdAfter: w.clientB.id,
      clientCodeAfter: "QZB",
      clientNameAfter: w.clientB.name,
      departmentIdsBefore: w.deptS.id,
      departmentIdsAfter: sorted([w.deptD.id, w.deptH.id]).join(","),
      departmentAddedCount: 2,
      departmentRemovedCount: 1,
      caseJoinCount: 2,
    });
    expect(isFlat(detail)).toBe(true);
    expect(audits[0]?.detail ?? "").not.toContain("監査に出てはいけない説明");
    expect(audits[0]?.detail ?? "").not.toContain(DESCRIPTION);
  });

  it("#150 4.4: 説明だけを変えると、detail は caseId・changedFields・descriptionChanged だけ（真偽値の true）。件名・取引先・部署・参加は変わらない", async () => {
    const before = await caseEditSnapshot();
    await edit(await inputFor({ description: "[UNIT_TEST]150C説明だけ" }));
    expect(parseDetail((await caseEditAudits())[0]?.detail ?? null)).toEqual({
      caseId: room.id,
      changedFields: "description",
      descriptionChanged: true,
    });
    const after = await caseEditSnapshot();
    expect(after.departments).toEqual(before.departments);
    expect(after.members).toEqual(before.members);
    expect(await caseEditRow(room.id)).toMatchObject({
      title: TITLE,
      client_id: w.clientA.id,
      description: "[UNIT_TEST]150C説明だけ",
      version: 2,
    });
  });

  it("#150 4.4: 件名だけを変えると、detail は caseId・changedFields・titleBefore・titleAfter だけ", async () => {
    await edit(await inputFor({ title: "[UNIT_TEST]150C件名だけ" }));
    expect(parseDetail((await caseEditAudits())[0]?.detail ?? null)).toEqual({
      caseId: room.id,
      changedFields: "title",
      titleBefore: TITLE,
      titleAfter: "[UNIT_TEST]150C件名だけ",
    });
  });

  it("#150 4.4・重大2: 兼任のオーナー（ownerD が deptD・deptH の両方）がいても、参加の行は1行だけ増え、caseJoinCount は 1", async () => {
    await replaceOwner(w.ownerD.id, w.deptH.id);
    const before = await participantIdsOf(room.roomId);
    await edit(
      await inputFor({ departmentIds: [w.deptS.id, w.deptD.id, w.deptH.id] }),
    );
    const after = await participantIdsOf(room.roomId);
    expect(after.filter((id) => !before.includes(id))).toEqual([w.ownerD.id]);
    expect(after.filter((id) => id === w.ownerD.id)).toHaveLength(1);
    expect(
      parseDetail((await caseEditAudits())[0]?.detail ?? null),
    ).toMatchObject({
      departmentAddedCount: 2,
      departmentRemovedCount: 0,
      caseJoinCount: 1,
    });
  });

  it("#150 4.4・重大2: 無効なオーナー・すでに参加しているオーナーは増えない（caseJoinCount 0）", async () => {
    await setUserActive(w.ownerH.id, false);
    await replaceOwner(w.memberS2.id, w.deptH.id);
    const before = await participantIdsOf(room.roomId);
    await edit(await inputFor({ departmentIds: [w.deptS.id, w.deptH.id] }));
    expect(await participantIdsOf(room.roomId)).toEqual(before);
    expect(
      parseDetail((await caseEditAudits())[0]?.detail ?? null),
    ).toMatchObject({
      departmentAddedCount: 1,
      caseJoinCount: 0,
    });
  });

  it("#150 C-140(4): いまの取引先が無効でも、件名だけを直せる（取引先は変わらない）", async () => {
    await setClientActive(w.clientA.id, false);
    await edit(await inputFor({ title: "[UNIT_TEST]150C無効の取引先の件名" }));
    expect(await caseEditRow(room.id)).toMatchObject({
      title: "[UNIT_TEST]150C無効の取引先の件名",
      client_id: w.clientA.id,
    });
  });

  it("#150 Q1＝A: すでに担当の無効な部署は残したまま、ほかの部署を足せる", async () => {
    await setDepartmentActive(w.deptS.id, false);
    await edit(await inputFor({ departmentIds: [w.deptS.id, w.deptD.id] }));
    expect(await caseDepartmentIdsOf(room.id)).toEqual(
      sorted([w.deptS.id, w.deptD.id]),
    );
  });

  it("#150 Q3＝C: 非参加の管理者（deptS のオーナーにした memberD1）は expected の方式で件名・取引先・部署を変えられる", async () => {
    await replaceOwner(w.memberD1.id, w.deptS.id);
    await edit(
      await inputFor({
        actorId: w.memberD1.id,
        basis: "expected",
        title: "[UNIT_TEST]150C管理者の件名",
        clientId: w.clientB.id,
      }),
    );
    expect(await caseEditRow(room.id)).toMatchObject({
      title: "[UNIT_TEST]150C管理者の件名",
      client_id: w.clientB.id,
      description: DESCRIPTION,
      version: 2,
    });
    // 非参加の管理者は、自動参加しない限り参加者にならない
    expect(await participantIdsOf(room.roomId)).not.toContain(w.memberD1.id);
  });
});

describe("#150 150-C 2回目 重大2：expected の方式は、読んだ後の説明・納期だけの変更で崩れない", () => {
  it.each([
    {
      name: "説明だけ",
      change: () =>
        setCaseColumns(room.id, {
          description: "[UNIT_TEST]150C参加者の新しい説明",
        }),
      column: { description: "[UNIT_TEST]150C参加者の新しい説明" },
    },
    {
      name: "納期だけ",
      change: () => setCaseColumns(room.id, { due_date: "2027-01-15" }),
      column: { due_date: "2027-01-15" },
    },
  ])(
    "#150 4.4.1: 非参加の管理者の材料を読んだ後に、ほかの人が$nameを変えて版を進めても、編集は成功し、ほかの人の値は残り、版は2つ進み、監査は1件",
    async ({ change, column }) => {
      await replaceOwner(w.memberD1.id, w.deptS.id);
      const input = await inputFor({
        actorId: w.memberD1.id,
        basis: "expected",
        title: "[UNIT_TEST]150C管理者の件名",
      });
      await change();
      await bumpCaseVersion(room.id);
      await edit(input);
      expect(await caseEditRow(room.id)).toMatchObject({
        ...column,
        title: "[UNIT_TEST]150C管理者の件名",
        version: 3,
      });
      expect(await caseEditAudits()).toHaveLength(1);
    },
  );

  it("#150 4.4.1: 版の方式（参加者）では、読んだ後にほかの人が説明を変えて版を進めると崩れ、説明は上書きされない", async () => {
    const input = await inputFor({
      description: "[UNIT_TEST]150C古い画面の説明",
    });
    await setCaseColumns(room.id, {
      description: "[UNIT_TEST]150C先の人の説明",
    });
    await bumpCaseVersion(room.id);
    const before = await caseEditSnapshot();
    await expect(edit(input)).rejects.toBeInstanceOf(CaseStateChangedError);
    expect(await caseEditSnapshot()).toEqual(before);
    expect((await caseEditRow(room.id)).description).toBe(
      "[UNIT_TEST]150C先の人の説明",
    );
  });
});

describe("#150 150-C 前提（計画 4.4 の editCondition）：崩れていたら何も残さない", () => {
  type Case = { name: string; input: () => Promise<CaseEditWriteInput> };
  const changeAll = () => ({
    title: "[UNIT_TEST]150C崩れる件名",
    clientId: w.clientB.id,
    departmentIds: [w.deptS.id, w.deptD.id],
  });
  // 表には関数だけを書く（beforeEach で代入する変数は、呼ばれた時点で読む）
  const CASES: Case[] = [
    {
      name: "重大1：案件がない（監査も残らない）",
      input: () =>
        inputFor({ caseId: MISSING_CASE_ID, title: "[UNIT_TEST]150Cない案件" }),
    },
    {
      name: "終了中",
      input: async () => {
        const input = await inputFor(changeAll());
        await setCaseStatus(room.id, "closed");
        return input;
      },
    },
    {
      name: "版が読んだ値と違う",
      input: () => inputFor({ ...changeAll(), version: 2 }),
    },
    {
      name: "expected の件名がいまと違う",
      input: async () => {
        await replaceOwner(w.memberD1.id, w.deptS.id);
        const input = await inputFor({
          actorId: w.memberD1.id,
          basis: "expected",
          title: "[UNIT_TEST]150C管理者の件名",
        });
        await setCaseColumns(room.id, { title: "[UNIT_TEST]150C先の人の件名" });
        return input;
      },
    },
    {
      name: "expected の取引先がいまと違う",
      input: async () => {
        await replaceOwner(w.memberD1.id, w.deptS.id);
        const input = await inputFor({
          actorId: w.memberD1.id,
          basis: "expected",
          title: "[UNIT_TEST]150C管理者の件名",
        });
        await setCaseColumns(room.id, { client_id: w.clientB.id });
        return input;
      },
    },
    {
      name: "expected の担当部署の集合がいまと違う（ほかの案件の deptD の行がある状態：#294）",
      input: async () => {
        await replaceOwner(w.memberD1.id, w.deptS.id);
        const input = await inputFor({
          actorId: w.memberD1.id,
          basis: "expected",
          title: "[UNIT_TEST]150C管理者の件名",
        });
        await env.DB.prepare(
          "INSERT INTO case_departments (case_id, department_id) VALUES (?, ?)",
        )
          .bind(room.id, w.deptD.id)
          .run();
        return input;
      },
    },
    {
      name: "操作者が参加者でも管理の資格もない（参加していない社員）",
      input: () => inputFor({ actorId: w.noDept.id, title: "[UNIT_TEST]150C" }),
    },
    {
      name: "操作者がほかの案件（other）だけの参加者（#294）",
      input: () =>
        inputFor({ actorId: w.memberD1.id, title: "[UNIT_TEST]150C" }),
    },
    {
      name: "操作者が無効になった（参加の行は残る）",
      input: async () => {
        const input = await inputFor(changeAll());
        await setUserActive(w.memberS1.id, false);
        return input;
      },
    },
    {
      name: "非参加の管理者がオーナーでなくなった",
      input: async () => {
        await replaceOwner(w.memberD1.id, w.deptS.id);
        const input = await inputFor({
          actorId: w.memberD1.id,
          basis: "expected",
          title: "[UNIT_TEST]150C管理者の件名",
        });
        await removeOwner(w.memberD1.id, w.deptS.id);
        return input;
      },
    },
    {
      name: "説明を、有効な参加者でない人（非参加の管理者）が変える",
      input: async () => {
        await replaceOwner(w.memberD1.id, w.deptS.id);
        return inputFor({
          actorId: w.memberD1.id,
          basis: "expected",
          description: "[UNIT_TEST]150C管理者が書いてはいけない説明",
        });
      },
    },
    {
      name: "読んだ後に、新しい取引先が無効になった",
      input: async () => {
        const input = await inputFor(changeAll());
        await setClientActive(w.clientB.id, false);
        return input;
      },
    },
    {
      name: "読んだ後に、足す部署が無効になった",
      input: async () => {
        const input = await inputFor(changeAll());
        await setDepartmentActive(w.deptD.id, false);
        return input;
      },
    },
    {
      name: "読んだ後に、担当部署の集合が変わった（版は進まない）",
      input: async () => {
        const input = await inputFor(changeAll());
        await env.DB.prepare(
          "INSERT INTO case_departments (case_id, department_id) VALUES (?, ?)",
        )
          .bind(room.id, w.deptH.id)
          .run();
        return input;
      },
    },
    // コードレビュー1回目の指摘2・決定 C-199(8)：担当部署を変えない版の方式の要求でも、読んだ集合と違えば崩れる
    ...(
      [
        [
          "件名だけ",
          () => ({ title: "[UNIT_TEST]150C部署が変わった後の件名" }),
        ],
        [
          "説明だけ",
          () => ({ description: "[UNIT_TEST]150C部署が変わった後の説明" }),
        ],
        ["取引先だけ", () => ({ clientId: w.clientB.id })],
      ] as const
    ).map(([label, change]): Case => ({
      name: `C-199(8)：${label}を変える版の方式で、読んだ後に担当部署の集合が変わった（版は進まない）`,
      input: async () => {
        const input = await inputFor(change());
        await env.DB.prepare(
          "INSERT INTO case_departments (case_id, department_id) VALUES (?, ?)",
        )
          .bind(room.id, w.deptH.id)
          .run();
        return input;
      },
    })),
    {
      name: "読んだ後に、足す部署のオーナーが交代した（自動参加させる人の集合が変わった）",
      input: async () => {
        const input = await inputFor(changeAll());
        await replaceOwner(w.noDept.id, w.deptD.id);
        return input;
      },
    },
    {
      name: "読んだ後に、自動参加させる予定のオーナーが無効になった",
      input: async () => {
        const input = await inputFor(changeAll());
        await setUserActive(w.ownerD.id, false);
        return input;
      },
    },
    {
      name: "読んだ後に、自動参加させる予定のオーナーが参加した",
      input: async () => {
        const input = await inputFor(changeAll());
        await addCaseMember(room.roomId, w.ownerD.id);
        return input;
      },
    },
  ];

  it.each(CASES)(
    "#150 4.4: $name → CaseStateChangedError で、案件・担当部署・参加・監査・通知のどれも変わらない",
    async ({ input }) => {
      const value = await input();
      const before = await caseEditSnapshot();
      await expect(edit(value)).rejects.toBeInstanceOf(CaseStateChangedError);
      expect(await caseEditSnapshot()).toEqual(before);
    },
  );

  it("#150 重大1: 存在しない案件 ID の書き込みの後、case.edit の監査は1件もない", async () => {
    await expect(
      edit(
        await inputFor({
          caseId: MISSING_CASE_ID,
          title: "[UNIT_TEST]150Cない案件",
          departmentIds: [w.deptD.id],
        }),
      ),
    ).rejects.toBeInstanceOf(CaseStateChangedError);
    expect(await caseEditAudits()).toEqual([]);
  });
});

// ---- 計画 4.4：文を差し替えて、各変更の直後の件数の確認を試す ----

type Statements = ReturnType<typeof buildEditStatements>;
type Item = Statements[number];

type Compiled = { sql: string; params: unknown[] };
function compiledOf(item: unknown): Compiled {
  const query = item as {
    toSQL?: () => Compiled;
    getQuery?: () => Compiled;
  };
  if (typeof query.toSQL === "function") return query.toSQL();
  if (typeof query.getQuery === "function") return query.getQuery();
  return { sql: "", params: [] };
}

/** 計画 4.4 の文を、SQL の形で見つける（見つからなければ、契約と違うので止める） */
function indexOf(statements: readonly Item[], pattern: RegExp): number {
  const found = statements
    .map((item, index) => ({ index, text: compiledOf(item).sql }))
    .filter(({ text }) => pattern.test(text));
  const hit = found[0];
  if (hit === undefined)
    throw new Error(
      `計画 4.4 の文（${String(pattern)}）が buildEditStatements にありません`,
    );
  return hit.index;
}

const DELETE_DEPARTMENTS = /^\s*delete\s+from\s+"?case_departments"?/i;
const INSERT_DEPARTMENTS = /^\s*insert\s+into\s+"?case_departments"?/i;
const INSERT_MEMBERS = /^\s*insert\s+into\s+"?channel_members"?/i;
const INSERT_AUDITS = /^\s*insert\s+into\s+"?audit_logs"?/i;
const UPDATE_CASE_RETURNING = /^\s*update\s+"?cases"?[\s\S]*returning/i;

async function runStatements(db: Database, statements: Item[]) {
  await runWriteBatch(() =>
    db.batch(statements as unknown as Parameters<Database["batch"]>[0]),
  );
}

/** 0 行の書き込み（何も変えない文。直後の件数の確認が 0 を見る） */
const noop = (db: Database) =>
  db
    .update(cases)
    .set({ version: sql`${cases.version}` })
    .where(sql`0`);

/** 差し替えの例で足す部署（オーナーは ownerH。deptH のオーナーと兼任）と、オーナーのいない予備の部署 */
let extraDept: { id: string };
let spareDept: { id: string };

/**
 * 差し替えの例の前提：room の担当を deptS・deptH にしておき、deptH を外して deptD・extraDept を足す
 * （1件の削除・2件の追加・ownerD と ownerH の2人の自動参加）
 */
async function prepareSwapWorld() {
  extraDept = await insertDepartmentWithChannels("150C差し替えの部署");
  spareDept = await insertDepartmentWithChannels("150C予備の部署");
  await replaceOwner(w.ownerH.id, extraDept.id);
  await env.DB.prepare(
    "INSERT INTO case_departments (case_id, department_id) VALUES (?, ?)",
  )
    .bind(room.id, w.deptH.id)
    .run();
}

const baseChange = () => ({
  title: "[UNIT_TEST]150C差し替えの件名",
  departmentIds: [w.deptS.id, w.deptD.id, extraDept.id],
});

describe("#150 150-C 計画 4.4 各変更の直後の件数の確認（文を差し替えて、わざと崩す）", () => {
  beforeEach(prepareSwapWorld);

  it("#150 4.4: 差し替えない文の列は、そのまま db.batch に渡すと成り立つ（差し替えの仕組みの確認）", async () => {
    const input = await inputFor(baseChange());
    await withDatabase(env, async (db) => {
      await runStatements(db, [...buildEditStatements(db, input)]);
    });
    expect(await caseDepartmentIdsOf(room.id)).toEqual(
      sorted([w.deptS.id, w.deptD.id, extraDept.id]),
    );
    const members = await participantIdsOf(room.roomId);
    expect(members).toContain(w.ownerD.id);
    expect(members).toContain(w.ownerH.id);
  });

  type Swap = {
    name: string;
    swap: (db: Database, statements: Item[], input: CaseEditWriteInput) => void;
  };
  const SWAPS: Swap[] = [
    {
      name: "余分な部署の削除（残すはずの deptS まで消す文）",
      swap: (db, statements, input) => {
        const wider = buildEditStatements(db, {
          ...input,
          departmentIds: [w.deptD.id, extraDept.id],
        });
        statements[indexOf(statements, DELETE_DEPARTMENTS)] = wider[
          indexOf(wider, DELETE_DEPARTMENTS)
        ] as Item;
      },
    },
    {
      name: "余分な部署の追加（指定していない予備の部署まで足す文）",
      swap: (db, statements, input) => {
        const wider = buildEditStatements(db, {
          ...input,
          departmentIds: [w.deptS.id, w.deptD.id, extraDept.id, spareDept.id],
        });
        statements[indexOf(statements, INSERT_DEPARTMENTS)] = wider[
          indexOf(wider, INSERT_DEPARTMENTS)
        ] as Item;
      },
    },
    {
      name: "部署の追加が足りない（deptD だけ足す文）",
      swap: (db, statements, input) => {
        const narrow = buildEditStatements(db, {
          ...input,
          departmentIds: [w.deptS.id, w.deptD.id],
        });
        statements[indexOf(statements, INSERT_DEPARTMENTS)] = narrow[
          indexOf(narrow, INSERT_DEPARTMENTS)
        ] as Item;
      },
    },
    {
      name: "重大2：自動参加が 0 行",
      swap: (db, statements) => {
        statements[indexOf(statements, INSERT_MEMBERS)] = noop(db) as Item;
      },
    },
    {
      name: "重大2：自動参加が多い（指定していない noDept まで参加させる文）",
      swap: (db, statements, input) => {
        const wider = buildEditStatements(db, {
          ...input,
          joinUserIds: [...input.joinUserIds, w.noDept.id],
        });
        statements[indexOf(statements, INSERT_MEMBERS)] = wider[
          indexOf(wider, INSERT_MEMBERS)
        ] as Item;
      },
    },
    {
      name: "重大2：自動参加が足りない（1人だけ参加させる文）",
      swap: (db, statements, input) => {
        const narrow = buildEditStatements(db, {
          ...input,
          joinUserIds: input.joinUserIds.slice(0, 1),
        });
        statements[indexOf(statements, INSERT_MEMBERS)] = narrow[
          indexOf(narrow, INSERT_MEMBERS)
        ] as Item;
      },
    },
    {
      name: "案件の更新が 0 行（別の ID を更新する）",
      swap: (db, statements) => {
        statements[indexOf(statements, UPDATE_CASE_RETURNING)] = db
          .update(cases)
          .set({ title: "[UNIT_TEST]150C別の行" })
          .where(eq(cases.id, MISSING_CASE_ID))
          .returning({ id: cases.id }) as unknown as Item;
      },
    },
    {
      name: "監査 case.edit が 0 行",
      swap: (db, statements) => {
        statements[indexOf(statements, INSERT_AUDITS)] = noop(db) as Item;
      },
    },
    {
      name: "末尾の不変条件：担当部署を全部消し、直後の件数の確認・追加を素通りにする（C-130(1)）",
      swap: (db, statements, input) => {
        const deleteAt = indexOf(statements, DELETE_DEPARTMENTS);
        const insertAt = indexOf(statements, INSERT_DEPARTMENTS);
        const passThrough = () =>
          db
            .update(cases)
            .set({ version: sql`${cases.version}` })
            .where(eq(cases.id, room.id)) as Item;
        const everything = buildEditStatements(db, {
          ...input,
          departmentIds: [],
        });
        statements[deleteAt] = everything[
          indexOf(everything, DELETE_DEPARTMENTS)
        ] as Item;
        statements[deleteAt + 1] = passThrough();
        statements[insertAt] = noop(db) as Item;
        statements[insertAt + 1] = passThrough();
      },
    },
  ];

  it.each(SWAPS)(
    "#150 4.4: $name → CaseStateChangedError で、案件・担当部署・参加・監査・通知が全部前のまま",
    async ({ swap }) => {
      const input = await inputFor(baseChange());
      expect(input.joinUserIds.length).toBe(2);
      const before = await caseEditSnapshot();
      await withDatabase(env, async (db) => {
        const statements = [...buildEditStatements(db, input)];
        swap(db, statements, input);
        await expect(runStatements(db, statements)).rejects.toBeInstanceOf(
          CaseStateChangedError,
        );
      });
      expect(await caseEditSnapshot()).toEqual(before);
    },
  );
});

describe("#150 150-C D1 の上限（1文 100 パラメータ・batch の文の数。計画 12）", () => {
  it("#150 D1 の上限: 部署 120 件を足し、兼任のオーナー 60 人（1人2部署）が自動参加する再編集が1回で成り立ち、すべての文の束縛値が 100 以下・文は 12 以下", async () => {
    const departments = await insertBulkDepartments(120);
    const owners = await insertBulkEditUsers(60, w.deptS.id);
    await assignOwners(
      departments.map((departmentId, i) => ({
        userId: owners[Math.floor(i / 2)] ?? "",
        departmentId,
      })),
    );
    const input = await inputFor({
      title: "[UNIT_TEST]150C大人数の件名",
      description: "[UNIT_TEST]150C大人数の説明",
      clientId: w.clientB.id,
      departmentIds: [...departments],
    });
    expect(input.joinUserIds).toHaveLength(60);
    await withDatabase(env, async (db) => {
      const statements = buildEditStatements(db, input);
      expect(statements.length).toBeGreaterThan(0);
      expect(statements.length).toBeLessThanOrEqual(12);
      const counts = statements.map((s) => compiledOf(s).params.length);
      expect(
        counts.every((n) => n <= 100),
        JSON.stringify(counts),
      ).toBe(true);
    });
    await edit(input);
    expect(await caseDepartmentIdsOf(room.id)).toEqual(sorted(departments));
    const members = await participantIdsOf(room.roomId);
    expect(owners.every((id) => members.includes(id))).toBe(true);
    expect(
      parseDetail((await caseEditAudits())[0]?.detail ?? null),
    ).toMatchObject({
      departmentAddedCount: 120,
      departmentRemovedCount: 1,
      caseJoinCount: 60,
    });
  });
});
