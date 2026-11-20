// #150（150-C）5-1 AC-20・計画 4.2：案件の再編集の判定（純粋関数 decideEdit）の表。最初の判定と、前提が崩れた後の読み直しで同じ関数を使う。
// 順（変えない。計画 4.2）：
//   2 案件がない → 404（deny）
//   3 有効な参加者でも管理の資格もない → 403「案件を編集できるのは、参加者・担当部署のオーナー・全体管理者だけです」（deny。状態より先）
//   （4 authorize(perm.case.edit) は Service。ここでは扱わない）
//   5 有効な参加者でないのに、本文に description か version がある → 403「説明を変更できるのは参加者だけです」
//   （6 本文の形〔422〕は Service。services/case-edit.service.test.ts で確かめる）
//   7 終了中 → 409 closed
//   8 衝突：version がいまの版と違う、または expected がいまの件名・取引先・担当部署の集合と違う → 409 stale
//   9 取引先をいまと違う値にするのに、ない・無効 → 422 fields ["clientId"]（いまと同じ値なら無効でも通す：C-140(4)）
//   10 新たに足す部署がない・無効 → 422 fields ["departmentIds"]（すでに担当の無効な部署は残せる：Q1＝A）
//   → 通る（null）
// 各行は「その段より後の条件も崩した材料」で、先の段が勝つことを確かめる。
// 契約（実装前の仮置き。計画 150-C 4.2・4.3。実装の担当へ。テストが決めた形）：
//   backend/src/db/case.repository.ts から export type CaseEditFacts = {
//     status, version, title, description, actorIsParticipant, actorCanManage,
//     client: { id, code, name },                                           // いまの取引先
//     requestedClient: { id, code, name, isActive } | null,                 // 本文の clientId の取引先（指定なし・存在しないなら null）
//     departmentIds: string[],                                              // いまの担当部署（昇順）
//     requestedDepartments: { id, isActive }[],                             // 本文の departmentIds のうち、存在する部署
//     joinUserIds: string[],                                                // 足す部署の有効なオーナーで、参加の行がない人（重複なし・昇順）
//   }
//   backend/src/services/case.service.ts から export type CaseEditBody（形の検証を通った本文。title は整形後）=
//     { title?, description?, clientId?, departmentIds?, version?: number, expected?: { title, clientId, departmentIds } }
//   export function decideEdit(facts: CaseEditFacts | null, body: CaseEditBody, actorId: string): Decision（既存の形）
// 422 の取引先・部署の文言は計画で決まっていないため、本文は確かめず、「ない」と「無効」が同じ本文であること（存在・状態を明かさない）だけを確かめる。
// 期待値は計画 150-C 4.2 と要件 5-1 AC-20・C-122・C-129・C-130・C-140 から決める。データは架空。
import { describe, expect, it } from "vitest";
import type { CaseEditFacts } from "../db/case.repository";
import { AppError } from "../lib/app-error";
import { decideEdit, type CaseEditBody } from "./case.service";

const ACTOR = "01JTESTCASE150CACT00000001";
const CLIENT_A = "01JTESTCASE150CC0000000001";
const CLIENT_B = "01JTESTCASE150CC0000000002";
const CLIENT_OFF = "01JTESTCASE150CC0000000003";
const DEPT_S = "01JTESTCASE150CDPT0000001S";
const DEPT_D = "01JTESTCASE150CDPT0000001D";
const DEPT_H = "01JTESTCASE150CDPT0000001H";
const DEPT_OLD_OFF = "01JTESTCASE150CDPT000000FF";
const DEPT_MISSING = "01JTESTCASE150CDPT0000009Z";
const OWNER_D = "01JTESTCASE150C0WN0000000D";
const TITLE = "[UNIT_TEST]150C判定の件名";

function facts(overrides: Partial<CaseEditFacts> = {}): CaseEditFacts {
  return {
    status: "active",
    version: 4,
    title: TITLE,
    description: "[UNIT_TEST]150C判定の説明",
    actorIsParticipant: true,
    actorCanManage: false,
    client: { id: CLIENT_A, code: "QZA", name: "[UNIT_TEST]テスト商事A" },
    requestedClient: {
      id: CLIENT_B,
      code: "QZB",
      name: "[UNIT_TEST]テスト商事B",
      isActive: true,
    },
    departmentIds: [DEPT_S],
    requestedDepartments: [
      { id: DEPT_S, isActive: true },
      { id: DEPT_D, isActive: true },
    ],
    joinUserIds: [OWNER_D],
    ...overrides,
  };
}

/** 非参加の管理者（担当部署のオーナー・全体管理者）の材料 */
const managerFacts = (overrides: Partial<CaseEditFacts> = {}) =>
  facts({ actorIsParticipant: false, actorCanManage: true, ...overrides });

const expectedOf = (
  overrides: Partial<NonNullable<CaseEditBody["expected"]>> = {},
) => ({
  title: TITLE,
  clientId: CLIENT_A,
  departmentIds: [DEPT_S],
  ...overrides,
});

type Outcome = {
  kind: string;
  code: string;
  message: string;
  reason: unknown;
  fields: unknown;
} | null;

function outcome(decision: ReturnType<typeof decideEdit>): Outcome {
  if (decision === null) return null;
  const error: unknown = decision.error;
  if (!(error instanceof AppError)) throw new Error("AppError ではありません");
  return {
    kind: decision.kind,
    code: error.code,
    message: error.message,
    reason: error.details.reason,
    fields: error.details.fields,
  };
}

const NOT_FOUND = {
  kind: "deny",
  code: "NOT_FOUND",
  message: "案件が見つかりません",
  reason: undefined,
  fields: undefined,
};
const CANNOT_EDIT = {
  kind: "deny",
  code: "FORBIDDEN",
  message:
    "案件を編集できるのは、参加者・担当部署のオーナー・全体管理者だけです",
  reason: undefined,
  fields: undefined,
};
/** 計画 4.2 の 5：logger.audit に残すかは計画で決まっていないため、kind は確かめない */
const DESCRIPTION_ONLY = {
  code: "FORBIDDEN",
  message: "説明を変更できるのは参加者だけです",
  reason: undefined,
  fields: undefined,
};
const conflictOf = (reason: string, message: string) => ({
  kind: "error",
  code: "CONFLICT",
  message,
  reason,
  fields: undefined,
});
const CLOSED = conflictOf("closed", "終了した案件は変更できません");
const STALE = conflictOf(
  "stale",
  "ほかの人が先にこの案件を変更しました。画面を確かめてから、もう一度操作してください",
);

type Row = {
  name: string;
  input: () => { f: CaseEditFacts | null; b: CaseEditBody };
  expected: Partial<NonNullable<Outcome>> | null;
};

const ROWS: Row[] = [
  {
    name: "案件がない → 404",
    input: () => ({ f: null, b: { version: 4, title: "x" } }),
    expected: NOT_FOUND,
  },
  {
    name: "参加者でも管理の資格もない（終了中・版も違う・説明も送る）→ 403（状態・版を漏らさない）",
    input: () => ({
      f: facts({
        actorIsParticipant: false,
        actorCanManage: false,
        status: "closed",
        version: 9,
      }),
      b: { version: 1, description: "x" },
    }),
    expected: CANNOT_EDIT,
  },
  {
    name: "参加者でも管理の資格もない（expected）→ 403",
    input: () => ({
      f: facts({ actorIsParticipant: false, actorCanManage: false }),
      b: { expected: expectedOf(), title: "[UNIT_TEST]150C新しい件名" },
    }),
    expected: CANNOT_EDIT,
  },
  {
    name: "非参加の管理者が description を送る（終了中でも）→ 403「説明を変更できるのは参加者だけです」（409 closed より先）",
    input: () => ({
      f: managerFacts({ status: "closed" }),
      b: { expected: expectedOf(), description: "[UNIT_TEST]150C書き換え" },
    }),
    expected: DESCRIPTION_ONLY,
  },
  {
    name: "非参加の管理者が version を送る（版が合っていても）→ 403（409／200 の違いで版の一致を答えない：重大4）",
    input: () => ({
      f: managerFacts(),
      b: { version: 4, title: "[UNIT_TEST]150C新しい件名" },
    }),
    expected: DESCRIPTION_ONLY,
  },
  {
    name: "非参加の管理者が version を送る（版が違う）→ 403（409 stale ではない）",
    input: () => ({
      f: managerFacts(),
      b: { version: 1, title: "[UNIT_TEST]150C新しい件名" },
    }),
    expected: DESCRIPTION_ONLY,
  },
  {
    name: "終了中（版も違う・取引先も無効）→ 409 closed（stale より先）",
    input: () => ({
      f: facts({
        status: "closed",
        requestedClient: {
          id: CLIENT_OFF,
          code: "QZX",
          name: "[UNIT_TEST]無効",
          isActive: false,
        },
      }),
      b: { version: 1, clientId: CLIENT_OFF },
    }),
    expected: CLOSED,
  },
  {
    name: "非参加の管理者の終了中 → 409 closed",
    input: () => ({
      f: managerFacts({ status: "closed" }),
      b: { expected: expectedOf(), title: "[UNIT_TEST]150C新しい件名" },
    }),
    expected: CLOSED,
  },
  {
    name: "参加者の版がいまと違う（取引先も無効）→ 409 stale（422 より先）",
    input: () => ({
      f: facts({
        requestedClient: {
          id: CLIENT_OFF,
          code: "QZX",
          name: "[UNIT_TEST]無効",
          isActive: false,
        },
      }),
      b: { version: 3, clientId: CLIENT_OFF },
    }),
    expected: STALE,
  },
  {
    name: "参加者の版が新しすぎる → 409 stale",
    input: () => ({ f: facts(), b: { version: 5, title: "x" } }),
    expected: STALE,
  },
  {
    name: "expected の件名がいまと違う → 409 stale",
    input: () => ({
      f: managerFacts(),
      b: {
        expected: expectedOf({ title: "[UNIT_TEST]150C古い件名" }),
        title: "[UNIT_TEST]150C新しい件名",
      },
    }),
    expected: STALE,
  },
  {
    name: "expected の取引先がいまと違う → 409 stale",
    input: () => ({
      f: managerFacts(),
      b: {
        expected: expectedOf({ clientId: CLIENT_B }),
        title: "[UNIT_TEST]150C新しい件名",
      },
    }),
    expected: STALE,
  },
  {
    name: "expected の担当部署の集合がいまと違う（1つ多い）→ 409 stale",
    input: () => ({
      f: managerFacts(),
      b: {
        expected: expectedOf({ departmentIds: [DEPT_S, DEPT_H] }),
        title: "[UNIT_TEST]150C新しい件名",
      },
    }),
    expected: STALE,
  },
  {
    name: "expected の担当部署の集合がいまと違う（入れ替わり・同じ数）→ 409 stale",
    input: () => ({
      f: managerFacts({ departmentIds: [DEPT_S, DEPT_D] }),
      b: {
        expected: expectedOf({ departmentIds: [DEPT_S, DEPT_H] }),
        title: "[UNIT_TEST]150C新しい件名",
      },
    }),
    expected: STALE,
  },
  {
    name: "取引先をいまと違う値にし、その取引先が無効（足す部署も無効）→ 422 clientId（部署より先）",
    input: () => ({
      f: facts({
        requestedClient: {
          id: CLIENT_OFF,
          code: "QZX",
          name: "[UNIT_TEST]無効",
          isActive: false,
        },
        requestedDepartments: [
          { id: DEPT_S, isActive: true },
          { id: DEPT_D, isActive: false },
        ],
      }),
      b: { version: 4, clientId: CLIENT_OFF, departmentIds: [DEPT_S, DEPT_D] },
    }),
    expected: { kind: "error", code: "VALIDATION_ERROR", fields: ["clientId"] },
  },
  {
    name: "取引先をいまと違う値にし、その取引先がない → 422 clientId",
    input: () => ({
      f: facts({ requestedClient: null }),
      b: { version: 4, clientId: CLIENT_B },
    }),
    expected: { kind: "error", code: "VALIDATION_ERROR", fields: ["clientId"] },
  },
  {
    name: "新たに足す部署が無効 → 422 departmentIds",
    input: () => ({
      f: facts({
        requestedDepartments: [
          { id: DEPT_S, isActive: true },
          { id: DEPT_D, isActive: false },
        ],
      }),
      b: { version: 4, departmentIds: [DEPT_S, DEPT_D] },
    }),
    expected: {
      kind: "error",
      code: "VALIDATION_ERROR",
      fields: ["departmentIds"],
    },
  },
  {
    name: "新たに足す部署がない → 422 departmentIds",
    input: () => ({
      f: facts({ requestedDepartments: [{ id: DEPT_S, isActive: true }] }),
      b: { version: 4, departmentIds: [DEPT_S, DEPT_MISSING] },
    }),
    expected: {
      kind: "error",
      code: "VALIDATION_ERROR",
      fields: ["departmentIds"],
    },
  },
  {
    name: "非参加の管理者が無効な取引先に変える → 422 clientId",
    input: () => ({
      f: managerFacts({
        requestedClient: {
          id: CLIENT_OFF,
          code: "QZX",
          name: "[UNIT_TEST]無効",
          isActive: false,
        },
      }),
      b: { expected: expectedOf(), clientId: CLIENT_OFF },
    }),
    expected: { kind: "error", code: "VALIDATION_ERROR", fields: ["clientId"] },
  },
  // ---- 通る ----
  {
    name: "C-140(4): いまの取引先が無効でも、同じ値を送れば通る（件名だけ直す）",
    input: () => ({
      f: facts({
        client: { id: CLIENT_OFF, code: "QZX", name: "[UNIT_TEST]無効" },
        requestedClient: {
          id: CLIENT_OFF,
          code: "QZX",
          name: "[UNIT_TEST]無効",
          isActive: false,
        },
      }),
      b: {
        version: 4,
        clientId: CLIENT_OFF,
        title: "[UNIT_TEST]150C直した件名",
      },
    }),
    expected: null,
  },
  {
    name: "C-140(4): いまの取引先が無効でも、取引先を送らなければ他の項目は通る",
    input: () => ({
      f: facts({
        client: { id: CLIENT_OFF, code: "QZX", name: "[UNIT_TEST]無効" },
        requestedClient: null,
      }),
      b: { version: 4, description: "[UNIT_TEST]150C説明だけ" },
    }),
    expected: null,
  },
  {
    name: "Q1＝A: すでに担当の無効な部署は、そのまま残せる（新しく足す部署だけを確かめる）",
    input: () => ({
      f: facts({
        departmentIds: [DEPT_OLD_OFF, DEPT_S],
        requestedDepartments: [
          { id: DEPT_OLD_OFF, isActive: false },
          { id: DEPT_S, isActive: true },
          { id: DEPT_D, isActive: true },
        ],
      }),
      b: { version: 4, departmentIds: [DEPT_OLD_OFF, DEPT_S, DEPT_D] },
    }),
    expected: null,
  },
  {
    name: "部署を外すだけ（足さない）→ 通る",
    input: () => ({
      f: facts({
        departmentIds: [DEPT_S, DEPT_D],
        requestedDepartments: [{ id: DEPT_S, isActive: true }],
        joinUserIds: [],
      }),
      b: { version: 4, departmentIds: [DEPT_S] },
    }),
    expected: null,
  },
  {
    name: "参加者が件名・説明・取引先・担当部署をまとめて変える → 通る",
    input: () => ({
      f: facts(),
      b: {
        version: 4,
        title: "[UNIT_TEST]150C新しい件名",
        description: "[UNIT_TEST]150C新しい説明",
        clientId: CLIENT_B,
        departmentIds: [DEPT_S, DEPT_D],
      },
    }),
    expected: null,
  },
  {
    name: "参加者で、管理の資格もある人の版の方式 → 通る",
    input: () => ({
      f: facts({ actorCanManage: true }),
      b: { version: 4, description: "[UNIT_TEST]150C説明" },
    }),
    expected: null,
  },
  {
    name: "非参加の管理者の expected（部署の並びが違っても集合が同じ）→ 通る",
    input: () => ({
      f: managerFacts({ departmentIds: [DEPT_D, DEPT_S] }),
      b: {
        expected: expectedOf({ departmentIds: [DEPT_S, DEPT_D] }),
        title: "[UNIT_TEST]150C新しい件名",
        clientId: CLIENT_B,
      },
    }),
    expected: null,
  },
];

describe("#150 150-C 計画 4.2 再編集の判定の順（decideEdit）", () => {
  it.each(ROWS)("#150 5-1 AC-20: $name", ({ input, expected }) => {
    const { f, b } = input();
    const result = outcome(decideEdit(f, b, ACTOR));
    if (expected === null) expect(result).toBeNull();
    else expect(result).toMatchObject(expected);
  });

  it("#150 C-129(1)・security: 取引先が「ない」と「無効」は同じ本文の 422（取引先の有無・状態を本文の違いで明かさない）", () => {
    const missing = outcome(
      decideEdit(
        facts({ requestedClient: null }),
        { version: 4, clientId: CLIENT_B },
        ACTOR,
      ),
    );
    const inactive = outcome(
      decideEdit(
        facts({
          requestedClient: {
            id: CLIENT_B,
            code: "QZB",
            name: "[UNIT_TEST]テスト商事B",
            isActive: false,
          },
        }),
        { version: 4, clientId: CLIENT_B },
        ACTOR,
      ),
    );
    expect(missing).not.toBeNull();
    expect(missing).toEqual(inactive);
  });

  it("#150 C-130・security: 足す部署が「ない」と「無効」は同じ本文の 422", () => {
    const missing = outcome(
      decideEdit(
        facts({ requestedDepartments: [{ id: DEPT_S, isActive: true }] }),
        { version: 4, departmentIds: [DEPT_S, DEPT_D] },
        ACTOR,
      ),
    );
    const inactive = outcome(
      decideEdit(
        facts({
          requestedDepartments: [
            { id: DEPT_S, isActive: true },
            { id: DEPT_D, isActive: false },
          ],
        }),
        { version: 4, departmentIds: [DEPT_S, DEPT_D] },
        ACTOR,
      ),
    );
    expect(missing).not.toBeNull();
    expect(missing).toEqual(inactive);
  });

  it("#150 重大7・security: 判定のどの拒否の本文にも、いまの説明の本文が入らない", () => {
    const secret = "[UNIT_TEST]150C漏れてはいけない説明";
    const results = ROWS.map(({ input }) => {
      const { f, b } = input();
      return decideEdit(
        f === null ? null : { ...f, description: secret },
        b,
        ACTOR,
      );
    }).filter((d) => d !== null);
    expect(results.length).toBeGreaterThan(0);
    for (const decision of results)
      expect(
        JSON.stringify({ ...decision.error, m: decision.error.message }),
      ).not.toContain(secret);
  });
});
