// #150（150-A）計画 6.2：終了・再開の判定の関数（純粋関数）の表。最初の判定と、前提が崩れた後の読み直しで同じ関数を使う。
// 順（変えない）：案件がない（404・logger.audit）→ 操作者が有効な参加者でない（403・logger.audit。状態の判定より先：
//   外された人・無効になった人に、終了・進行中を漏らさない）→ 状態（終了で closed なら 409 already_closed、再開で active なら 409 already_active）→ 通る（null）。
// 権限（authorize）は 403 と 409 の間に Service が行う（ここでは扱わない。結合のテストで確かめる）。
// 契約（実装前の仮置き。実装の担当へ）：backend/src/services/case.service.ts から
//   export function decideClose(facts: CaseWriteFacts | null): Decision
//   export function decideReopen(facts: CaseWriteFacts | null): Decision
//   Decision は既存の形（{ kind: "deny", reason, error } | { kind: "error", error } | null。error は AppError）。
// 期待値は計画 150-A 6.1・6.2 から決める。データは架空。
import { describe, expect, it } from "vitest";
import type { CaseWriteFacts } from "../db/case.repository";
import { AppError } from "../lib/app-error";
import { decideClose, decideReopen } from "./case.service";

const DEPT = "01JTESTCASE150DEPT00000001";

function facts(overrides: Partial<CaseWriteFacts> = {}): CaseWriteFacts {
  return {
    status: "active",
    dueDate: null,
    version: 1,
    actorIsParticipant: true,
    actorCanManage: false,
    activeParticipantCount: 2,
    caseDepartmentIds: [DEPT],
    target: null,
    ...overrides,
  };
}

type Outcome = {
  kind: string;
  code: string;
  message: string;
  reason: unknown;
  denyReason: unknown;
} | null;

function outcome(decision: ReturnType<typeof decideClose>): Outcome {
  if (decision === null) return null;
  const error: unknown = decision.error;
  if (!(error instanceof AppError)) throw new Error("AppError ではありません");
  return {
    kind: decision.kind,
    code: error.code,
    message: error.message,
    reason: error.details.reason,
    denyReason: "reason" in decision ? decision.reason : undefined,
  };
}

const NOT_FOUND = {
  kind: "deny",
  code: "NOT_FOUND",
  message: "案件が見つかりません",
  reason: undefined,
  denyReason: "not_found",
};
const NOT_PARTICIPANT = {
  kind: "deny",
  code: "FORBIDDEN",
  message: "参加者だけが操作できます",
  reason: undefined,
  denyReason: "not_participant",
};

describe("#150 150-A 計画 6.2 終了の判定（decideClose）", () => {
  it.each([
    {
      name: "案件がない → 404",
      input: () => null,
      expected: NOT_FOUND,
    },
    {
      name: "参加者でない（進行中）→ 403",
      input: () => facts({ actorIsParticipant: false }),
      expected: NOT_PARTICIPANT,
    },
    {
      name: "参加者でない（終了中）→ 403（状態を漏らさない。409 より先）",
      input: () => facts({ actorIsParticipant: false, status: "closed" }),
      expected: NOT_PARTICIPANT,
    },
    {
      name: "参加していない管理の資格のある人（全体管理者・オーナー）→ 403（R-77）",
      input: () => facts({ actorIsParticipant: false, actorCanManage: true }),
      expected: NOT_PARTICIPANT,
    },
    {
      name: "参加者で、すでに終了 → 409 already_closed",
      input: () => facts({ status: "closed" }),
      expected: {
        kind: "error",
        code: "CONFLICT",
        message: "この案件はすでに終了しています",
        reason: "already_closed",
        denyReason: undefined,
      },
    },
    {
      name: "参加者で、進行中 → 通る",
      input: () => facts(),
      expected: null,
    },
    {
      name: "参加者で、管理の資格もある（自動参加）・進行中 → 通る",
      input: () => facts({ actorCanManage: true }),
      expected: null,
    },
  ])("#150 5-1 AC-9: $name", ({ input, expected }) => {
    expect(outcome(decideClose(input()))).toEqual(expected);
  });
});

describe("#150 150-A 計画 6.2 再開の判定（decideReopen）", () => {
  it.each([
    {
      name: "案件がない → 404",
      input: () => null,
      expected: NOT_FOUND,
    },
    {
      name: "参加者でない（終了中）→ 403",
      input: () => facts({ actorIsParticipant: false, status: "closed" }),
      expected: NOT_PARTICIPANT,
    },
    {
      name: "参加者でない（進行中）→ 403（状態を漏らさない。409 より先）",
      input: () => facts({ actorIsParticipant: false }),
      expected: NOT_PARTICIPANT,
    },
    {
      name: "参加者で、すでに進行中 → 409 already_active",
      input: () => facts(),
      expected: {
        kind: "error",
        code: "CONFLICT",
        message: "この案件はすでに進行中です",
        reason: "already_active",
        denyReason: undefined,
      },
    },
    {
      name: "参加者で、終了中 → 通る",
      input: () => facts({ status: "closed" }),
      expected: null,
    },
  ])("#150 5-1 AC-10: $name", ({ input, expected }) => {
    expect(outcome(decideReopen(input()))).toEqual(expected);
  });
});
