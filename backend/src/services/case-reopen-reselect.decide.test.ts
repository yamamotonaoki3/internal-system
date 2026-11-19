// #150（150-B）5-1 AC-16・計画 6.1・6.2：再開のときの参加者の選び直しの判定（純粋関数 decideReopenReselect）の表。
// 最初の判定と、前提が崩れた後の読み直しで同じ関数を使う。順（変えない。計画 6.1）：
//   404（案件がない）→ 403（操作者が有効な参加者でない。状態・参加者を漏らさない）→（authorize と本文の形は Service・ルートで。ここでは扱わない）
//   → 409 already_active → 409 participants_changed（画面で見た参加者の集合 ≠ いまの有効な参加者の集合）
//   → 422 fields ["removeUserIds"]「再開する本人は外せません」→ 409 auto_participant（自動参加の人を外す）
//   → 422 fields ["addUserIds"]「追加できる社員を選んでください」（いない・無効を同じ本文）→ 409 already_participant（無効な人の行を含む）→ 通る（null）
// 各行は「その段より後の条件も崩した材料」で、先の段が勝つことを確かめる。
// 契約（実装前の仮置き。計画 150-B 6.2。実装の担当へ）：
//   backend/src/db/case.repository.ts から export type CaseReopenFacts = {
//     status, version, actorIsParticipant, actorCanManage, caseDepartmentIds,   // CaseWriteFacts と同じ意味
//     activeParticipantIds: string[],                                              // いまの有効な参加者（無効な人の行は含まない）
//     targets: { userId, isActive, hasMembershipRow, isGlobalAdmin, ownedDepartmentIds }[] // 本文の追加・除外に出た社員のうち、存在する人だけ
//   }
//   backend/src/services/case.service.ts から export function decideReopenReselect(facts: CaseReopenFacts | null, body: ReopenBody, actorId: string): Decision
//     body は形の検証（ULID・重複・重なり・上限・removeUserIds ⊆ participantIds・addUserIds ∩ participantIds = ∅）を通った後のもの。
//     Decision は既存の形。422 は { kind: "error", error: AppError("VALIDATION_ERROR", 文言, { fields }) }。
// 自動参加の規則は autoRoleOf と同じ（有効な全体管理者、または案件の担当部署の有効なオーナー）。
// 期待値は計画 150-B 6.1 と要件 5-1 AC-16 から決める。データは架空。
import { describe, expect, it } from "vitest";
import type { CaseReopenFacts } from "../db/case.repository";
import { AppError } from "../lib/app-error";
import { decideReopenReselect } from "./case.service";

const DEPT = "01JTESTCASE150BDEPT0000001";
const OTHER_DEPT = "01JTESTCASE150BDEPT0000002";
const ACTOR = "01JTESTCASE150BACT00000001";
const MEMBER_A = "01JTESTCASE150BMEM0000000A";
const MEMBER_B = "01JTESTCASE150BMEM0000000B";
const ADMIN = "01JTESTCASE150BADM00000001";
const OWNER = "01JTESTCASE150B0WN00000001";
const NEWCOMER = "01JTESTCASE150BNEW00000001";
const INACTIVE_ROW = "01JTESTCASE150BXNA00000001";

type Target = CaseReopenFacts["targets"][number];

const target = (userId: string, overrides: Partial<Target> = {}): Target => ({
  userId,
  isActive: true,
  hasMembershipRow: true,
  isGlobalAdmin: false,
  ownedDepartmentIds: [],
  ...overrides,
});

function facts(overrides: Partial<CaseReopenFacts> = {}): CaseReopenFacts {
  return {
    status: "closed",
    version: 3,
    actorIsParticipant: true,
    actorCanManage: false,
    caseDepartmentIds: [DEPT],
    activeParticipantIds: [ACTOR, MEMBER_A, MEMBER_B, ADMIN, OWNER],
    targets: [target(MEMBER_A), target(NEWCOMER, { hasMembershipRow: false })],
    ...overrides,
  };
}

type Body = Parameters<typeof decideReopenReselect>[1];

const body = (overrides: Partial<Body> = {}): Body => ({
  participantIds: [ACTOR, MEMBER_A, MEMBER_B, ADMIN, OWNER],
  addUserIds: [NEWCOMER],
  removeUserIds: [MEMBER_A],
  ...overrides,
});

type Outcome = {
  kind: string;
  code: string;
  message: string;
  reason: unknown;
  fields: unknown;
  denyReason: unknown;
} | null;

function outcome(decision: ReturnType<typeof decideReopenReselect>): Outcome {
  if (decision === null) return null;
  const error: unknown = decision.error;
  if (!(error instanceof AppError)) throw new Error("AppError ではありません");
  return {
    kind: decision.kind,
    code: error.code,
    message: error.message,
    reason: error.details.reason,
    fields: error.details.fields,
    denyReason: "reason" in decision ? decision.reason : undefined,
  };
}

const NOT_FOUND = {
  kind: "deny",
  code: "NOT_FOUND",
  message: "案件が見つかりません",
  reason: undefined,
  fields: undefined,
  denyReason: "not_found",
};
const NOT_PARTICIPANT = {
  kind: "deny",
  code: "FORBIDDEN",
  message: "参加者だけが操作できます",
  reason: undefined,
  fields: undefined,
  denyReason: "not_participant",
};
const conflictOf = (reason: string, message: string) => ({
  kind: "error",
  code: "CONFLICT",
  message,
  reason,
  fields: undefined,
  denyReason: undefined,
});
const validationOf = (field: string, message: string) => ({
  kind: "error",
  code: "VALIDATION_ERROR",
  message,
  reason: undefined,
  fields: [field],
  denyReason: undefined,
});

const ALREADY_ACTIVE = conflictOf(
  "already_active",
  "この案件はすでに進行中です",
);
const PARTICIPANTS_CHANGED = conflictOf(
  "participants_changed",
  "参加者がほかの操作で変わりました。画面を確かめてから、もう一度操作してください",
);
const CANNOT_REMOVE_SELF = validationOf(
  "removeUserIds",
  "再開する本人は外せません",
);
const AUTO_PARTICIPANT = conflictOf(
  "auto_participant",
  "担当部署のオーナー・全体管理者は外せません",
);
const TARGET_INVALID = validationOf(
  "addUserIds",
  "追加できる社員を選んでください",
);
const ALREADY_PARTICIPANT = conflictOf(
  "already_participant",
  "この社員はすでに参加者です",
);

describe("#150 150-B 計画 6.1 再開の選び直しの判定の順（decideReopenReselect）", () => {
  // 表には関数だけを書く
  it.each([
    {
      name: "案件がない → 404",
      input: () => ({ f: null, b: body() }),
      expected: NOT_FOUND,
    },
    {
      name: "参加者でない（終了中）・本文に崩れがあっても → 403（参加者・状態を漏らさない）",
      input: () => ({
        f: facts({ actorIsParticipant: false }),
        b: body({ removeUserIds: [ACTOR], participantIds: [ACTOR] }),
      }),
      expected: NOT_PARTICIPANT,
    },
    {
      name: "参加者でない（進行中）→ 403（409 already_active より先）",
      input: () => ({
        f: facts({ actorIsParticipant: false, status: "active" }),
        b: body(),
      }),
      expected: NOT_PARTICIPANT,
    },
    {
      name: "参加していない管理の資格のある人（全体管理者・オーナー）→ 403（R-77）",
      input: () => ({
        f: facts({ actorIsParticipant: false, actorCanManage: true }),
        b: body(),
      }),
      expected: NOT_PARTICIPANT,
    },
    {
      name: "進行中で、参加者の集合も違う → 409 already_active（participants_changed より先）",
      input: () => ({
        f: facts({ status: "active", activeParticipantIds: [ACTOR] }),
        b: body(),
      }),
      expected: ALREADY_ACTIVE,
    },
    {
      name: "いまの有効な参加者に、画面で見ていない人が増えた → 409 participants_changed（本人を外す 422 より先）",
      input: () => ({
        f: facts({
          activeParticipantIds: [
            ACTOR,
            MEMBER_A,
            MEMBER_B,
            ADMIN,
            OWNER,
            NEWCOMER,
          ],
        }),
        b: body({ removeUserIds: [ACTOR], addUserIds: [] }),
      }),
      expected: PARTICIPANTS_CHANGED,
    },
    {
      name: "画面で見た人が、いまの有効な参加者にいない（外された・無効になった）→ 409 participants_changed",
      input: () => ({
        f: facts({ activeParticipantIds: [ACTOR, MEMBER_A, ADMIN, OWNER] }),
        b: body(),
      }),
      expected: PARTICIPANTS_CHANGED,
    },
    {
      name: "人数が同じで、入れ替わっている → 409 participants_changed",
      input: () => ({
        f: facts({
          activeParticipantIds: [ACTOR, MEMBER_A, NEWCOMER, ADMIN, OWNER],
        }),
        b: body(),
      }),
      expected: PARTICIPANTS_CHANGED,
    },
    {
      name: "本人を外す（自動参加の人も外す・追加が無効）→ 422 removeUserIds「再開する本人は外せません」（auto_participant より先）",
      input: () => ({
        f: facts({
          targets: [
            target(ACTOR),
            target(ADMIN, { isGlobalAdmin: true }),
            target(NEWCOMER, { hasMembershipRow: false, isActive: false }),
          ],
        }),
        b: body({ removeUserIds: [ACTOR, ADMIN] }),
      }),
      expected: CANNOT_REMOVE_SELF,
    },
    {
      name: "自動参加の本人（全体管理者）を外す → 422（本人の規則が先）",
      input: () => ({
        f: facts({
          actorCanManage: true,
          targets: [target(ACTOR, { isGlobalAdmin: true })],
        }),
        b: body({ removeUserIds: [ACTOR], addUserIds: [] }),
      }),
      expected: CANNOT_REMOVE_SELF,
    },
    {
      name: "全体管理者を外す（追加も無効）→ 409 auto_participant（追加の 422 より先）",
      input: () => ({
        f: facts({
          targets: [
            target(ADMIN, { isGlobalAdmin: true }),
            target(NEWCOMER, { hasMembershipRow: false, isActive: false }),
          ],
        }),
        b: body({ removeUserIds: [ADMIN] }),
      }),
      expected: AUTO_PARTICIPANT,
    },
    {
      name: "担当部署のオーナーを外す → 409 auto_participant",
      input: () => ({
        f: facts({
          targets: [
            target(OWNER, { ownedDepartmentIds: [DEPT] }),
            target(NEWCOMER, { hasMembershipRow: false }),
          ],
        }),
        b: body({ removeUserIds: [OWNER] }),
      }),
      expected: AUTO_PARTICIPANT,
    },
    {
      name: "全体管理者で、担当部署のオーナーでもある人を外す → 409 auto_participant",
      input: () => ({
        f: facts({
          targets: [
            target(ADMIN, { isGlobalAdmin: true, ownedDepartmentIds: [DEPT] }),
            target(NEWCOMER, { hasMembershipRow: false }),
          ],
        }),
        b: body({ removeUserIds: [ADMIN] }),
      }),
      expected: AUTO_PARTICIPANT,
    },
    {
      name: "担当部署でない部署のオーナーは、自動参加でないので外せる → 通る",
      input: () => ({
        f: facts({
          targets: [
            target(OWNER, { ownedDepartmentIds: [OTHER_DEPT] }),
            target(NEWCOMER, { hasMembershipRow: false }),
          ],
        }),
        b: body({ removeUserIds: [OWNER] }),
      }),
      expected: null,
    },
    {
      name: "追加の人がいない（材料にない）・すでに参加の行もある別の人 → 422 addUserIds（already_participant より先）",
      input: () => ({
        f: facts({
          targets: [
            target(MEMBER_A),
            target(INACTIVE_ROW, { isActive: true, hasMembershipRow: true }),
          ],
        }),
        b: body({ addUserIds: [NEWCOMER, INACTIVE_ROW] }),
      }),
      expected: TARGET_INVALID,
    },
    {
      name: "追加の人が無効 → 422 addUserIds（いない場合と同じ本文。社員の有無・状態を明かさない）",
      input: () => ({
        f: facts({
          targets: [
            target(MEMBER_A),
            target(NEWCOMER, { hasMembershipRow: false, isActive: false }),
          ],
        }),
        b: body(),
      }),
      expected: TARGET_INVALID,
    },
    {
      name: "追加の人が無効で、参加の行が残っている → 422 addUserIds（無効な人は選べない）",
      input: () => ({
        f: facts({
          targets: [
            target(MEMBER_A),
            target(INACTIVE_ROW, { isActive: false, hasMembershipRow: true }),
          ],
        }),
        b: body({ addUserIds: [INACTIVE_ROW] }),
      }),
      expected: TARGET_INVALID,
    },
    {
      name: "追加の人が有効で、参加の行を持つ（判定の後に自動参加で入った等）→ 409 already_participant",
      input: () => ({
        f: facts({
          targets: [
            target(MEMBER_A),
            target(NEWCOMER, { hasMembershipRow: true }),
          ],
        }),
        b: body(),
      }),
      expected: ALREADY_PARTICIPANT,
    },
    {
      name: "1人を外し1人を足す（全部通る）→ null",
      input: () => ({ f: facts(), b: body() }),
      expected: null,
    },
    {
      name: "選び直しなし（追加・除外が空）→ null（150-A と同じ経路）",
      input: () => ({
        f: facts({ targets: [] }),
        b: body({ addUserIds: [], removeUserIds: [] }),
      }),
      expected: null,
    },
    {
      name: "participantIds の並びが違っても、集合が同じなら → null",
      input: () => ({
        f: facts(),
        b: body({ participantIds: [OWNER, ADMIN, MEMBER_B, MEMBER_A, ACTOR] }),
      }),
      expected: null,
    },
    {
      name: "自動参加の本人（全体管理者）が、ほかの人を外して再開 → null",
      input: () => ({
        f: facts({ actorCanManage: true }),
        b: body(),
      }),
      expected: null,
    },
  ])("#150 5-1 AC-16: $name", ({ input, expected }) => {
    const { f, b } = input();
    expect(outcome(decideReopenReselect(f, b, ACTOR))).toEqual(expected);
  });
});
