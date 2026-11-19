// #149（149-B）計画 6.2.2・10節（判定の関数の単体テスト）：編集・削除の判定の関数（decideEdit・decideDelete。export する純粋関数）を、
// 材料（TodoWriteFacts）を直接作って、分岐を1つずつ確かめる。403 までの判定（案件がない・非参加）は 149-A の decideWriteGate が受け持つため、
// ここでは「TODO がない」以降の分岐だけを扱う（計画 10節 #4〜#10）。
// 判定の順（計画 6.2.2）：
//   編集：TODO がない 404 → 削除済み 409 todo_deleted → 完了済みで担当を指定 409 todo_completed → 担当を変えるときだけ、新しい担当が有効な参加者でない 422
//     → 終了中 409 closed → 版が違う 409 todo_changed → いまと同じ値なら { result }（何も書かない）→ 通れば null
//   削除：TODO がない 404 → 終了中 409 closed → すでに削除済みなら { result }（何も書かない）→ 通れば null
// 契約（実装前の仮置き。実装の担当へ）：backend/src/services/case-todo.service.ts
//   decideEdit(facts: TodoWriteFacts, request: { version: number; title?: string; assigneeId?: string | null })
//     request.title は整形の後の値。担当の「同じ」は ID で比べる。
//   decideDelete(facts: TodoWriteFacts)
//   戻り値：null（通る）／{ kind: "deny", reason, error: AppError }（404。logger.audit に残す）／{ kind: "error", error: AppError }／{ result: … }（何も書かない）
//   TodoWriteFacts.todo に title・assigneeId を足す（計画 6.2.2）。
// データは架空（testuser_・[UNIT_TEST]）。
import { describe, expect, it } from "vitest";
import type { TodoWriteFacts } from "../db/case-todo.repository";
import { AppError } from "../lib/app-error";
import { decideDelete, decideEdit } from "./case-todo.service";

const B = "01JTESTUSER149B0000000000B";
const C = "01JTESTUSER149B0000000000C";

type Todo = NonNullable<TodoWriteFacts["todo"]>;

function factsOf(
  todo: Partial<Todo> | null,
  overrides: Partial<Omit<TodoWriteFacts, "todo">> = {},
): TodoWriteFacts {
  return {
    status: "active",
    actorIsParticipant: true,
    todo:
      todo === null
        ? null
        : ({
            deleted: false,
            completed: false,
            version: 1,
            title: "[UNIT_TEST]149B見積書の作成",
            assigneeId: B,
            ...todo,
          } as Todo),
    assigneeIsParticipant: true,
    progress: { done: 0, total: 1 },
    ...overrides,
  } as TodoWriteFacts;
}

type Outcome =
  | { kind: "pass" }
  | { kind: "unchanged" }
  | {
      kind: "error";
      code: string;
      status: number;
      reason?: unknown;
      fields?: unknown;
      deny?: string;
    };

function outcomeOf(decision: unknown): Outcome {
  if (decision === null) return { kind: "pass" };
  if (typeof decision === "object" && decision !== null && "result" in decision)
    return { kind: "unchanged" };
  const d = decision as { kind?: string; reason?: string; error?: unknown };
  if (!(d.error instanceof AppError))
    throw new Error(`判定の結果の形が想定外：${JSON.stringify(decision)}`);
  return {
    kind: "error",
    code: d.error.code,
    status: d.error.status,
    reason: d.error.details.reason,
    fields: d.error.details.fields,
    ...(d.kind === "deny" && d.reason !== undefined ? { deny: d.reason } : {}),
  };
}

describe("#149 AC-1 149-B decideEdit（計画 6.2.2・10節 #4〜#10）", () => {
  it("#149 AC-1 計画 10節 #4: TODO がない（ほかの案件の TODO を含む）なら 404「TODOが見つかりません」で、logger.audit の理由は todo_not_found", () => {
    const outcome = outcomeOf(
      decideEdit(factsOf(null), { version: 1, title: "a" }),
    );
    expect(outcome).toMatchObject({
      kind: "error",
      code: "NOT_FOUND",
      status: 404,
      deny: "todo_not_found",
    });
  });

  it("#149 AC-1 計画 10節 #5: 削除済みなら、担当が非参加・版が古い・終了中でも 409 todo_deleted", () => {
    const outcome = outcomeOf(
      decideEdit(
        factsOf(
          { deleted: true, completed: true, version: 5 },
          { status: "closed", assigneeIsParticipant: false },
        ),
        { version: 1, assigneeId: C },
      ),
    );
    expect(outcome).toMatchObject({
      code: "CONFLICT",
      reason: "todo_deleted",
    });
  });

  it.each([
    ["別の人", C],
    ["担当なし（null）", null],
    ["いまと同じ人", B],
  ])(
    "#149 AC-1 決定 Q1 計画 10節 #6: 完了済みの TODO で担当（%s）を指定すると、担当が非参加・終了中・版が古くても 409 todo_completed",
    (_l, assigneeId) => {
      const outcome = outcomeOf(
        decideEdit(
          factsOf(
            { completed: true, version: 3 },
            { status: "closed", assigneeIsParticipant: false },
          ),
          { version: 1, assigneeId },
        ),
      );
      expect(outcome).toMatchObject({
        code: "CONFLICT",
        reason: "todo_completed",
      });
    },
  );

  it("#149 AC-1 決定 Q1: 完了済みの TODO でも、題名だけなら通る（null）", () => {
    expect(
      outcomeOf(
        decideEdit(factsOf({ completed: true, version: 2 }), {
          version: 2,
          title: "[UNIT_TEST]149B改題",
        }),
      ),
    ).toEqual({ kind: "pass" });
  });

  it("#149 AC-1 5-4 AC-6 計画 10節 #7: 新しい担当が有効な参加者でなければ、終了中・版が古くても 422（fields assigneeUserId・同じ文）", () => {
    const outcome = outcomeOf(
      decideEdit(
        factsOf(
          { version: 4 },
          { status: "closed", assigneeIsParticipant: false },
        ),
        { version: 1, assigneeId: C },
      ),
    );
    expect(outcome).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      fields: ["assigneeUserId"],
    });
  });

  it("#149 AC-1 計画 10節 #12: いまの担当と同じ ID なら、その人がいま参加者でなくても 422 にしない（変更なしで何も書かない）", () => {
    expect(
      outcomeOf(
        decideEdit(factsOf({}, { assigneeIsParticipant: false }), {
          version: 1,
          assigneeId: B,
        }),
      ),
    ).toEqual({ kind: "unchanged" });
  });

  it("#149 AC-1 計画 10節 #7: 担当を「なし」（null）にするときは、参加者かどうかを見ない（422 にしない）", () => {
    expect(
      outcomeOf(
        decideEdit(factsOf({}, { assigneeIsParticipant: null }), {
          version: 1,
          assigneeId: null,
        }),
      ),
    ).toEqual({ kind: "pass" });
  });

  it.each([
    ["担当の資格を読んでいない（null）", null],
    ["いまの担当が参加者でない（false）", false],
  ])(
    "#149 AC-1 5-4 AC-6 決定 Q3 計画 10節 #7: 担当を「なし」（null）にする編集は、新しい担当の材料が %s でも 422 にならず通る",
    (_l, assigneeIsParticipant) => {
      expect(
        outcomeOf(
          decideEdit(factsOf({}, { assigneeIsParticipant }), {
            version: 1,
            assigneeId: null,
          }),
        ),
      ).toEqual({ kind: "pass" });
    },
  );

  it("#149 AC-1 5-4 AC-9 計画 10節 #8: 終了中なら、版が古くても 409 closed（todo_changed より先）", () => {
    expect(
      outcomeOf(
        decideEdit(factsOf({ version: 7 }, { status: "closed" }), {
          version: 1,
          title: "[UNIT_TEST]149B改題",
        }),
      ),
    ).toMatchObject({ code: "CONFLICT", reason: "closed" });
  });

  it.each([
    ["古い版", 1, 2],
    ["新しすぎる版", 3, 2],
  ])(
    "#149 AC-1 計画 10節 #9: %s なら 409 todo_changed",
    (_l, sent, current) => {
      expect(
        outcomeOf(
          decideEdit(factsOf({ version: current }), {
            version: sent,
            title: "[UNIT_TEST]149B改題",
          }),
        ),
      ).toMatchObject({ code: "CONFLICT", reason: "todo_changed" });
    },
  );

  it("#149 AC-1 計画 10節 #9: 版が違えば、求めた値がいまと同じでも 409 todo_changed（同じ値の 200 より先）", () => {
    expect(
      outcomeOf(
        decideEdit(factsOf({ version: 2 }), {
          version: 1,
          title: "[UNIT_TEST]149B見積書の作成",
        }),
      ),
    ).toMatchObject({ reason: "todo_changed" });
  });

  it.each([
    ["題名だけ同じ", { title: "[UNIT_TEST]149B見積書の作成" }],
    ["担当だけ同じ", { assigneeId: B }],
    [
      "題名と担当が同じ",
      { title: "[UNIT_TEST]149B見積書の作成", assigneeId: B },
    ],
  ])(
    "#149 AC-1 決定 Q3 計画 10節 #10: 版が一致し、%s なら、何も書かない結果（result）",
    (_l, request) => {
      expect(
        outcomeOf(decideEdit(factsOf({}), { version: 1, ...request })),
      ).toEqual({ kind: "unchanged" });
    },
  );

  it("#149 AC-1 決定 Q3: 担当なしの TODO に担当なし（null）を送るのも、何も書かない結果", () => {
    expect(
      outcomeOf(
        decideEdit(factsOf({ assigneeId: null }), {
          version: 1,
          assigneeId: null,
        }),
      ),
    ).toEqual({ kind: "unchanged" });
  });

  it.each([
    ["題名だけ変える", { title: "[UNIT_TEST]149B改題" }],
    ["担当だけ変える", { assigneeId: C }],
    ["担当をなしにする", { assigneeId: null }],
    [
      "題名は同じで担当を変える",
      { title: "[UNIT_TEST]149B見積書の作成", assigneeId: C },
    ],
  ])("#149 AC-1 5-4 AC-8: %s なら通る（null）", (_l, request) => {
    expect(
      outcomeOf(decideEdit(factsOf({}), { version: 1, ...request })),
    ).toEqual({ kind: "pass" });
  });
});

describe("#149 AC-1 149-B decideDelete（計画 6.2.2・10節 #24・#26）", () => {
  it("#149 AC-1 計画 10節 #26: TODO がないなら 404（理由 todo_not_found）", () => {
    expect(outcomeOf(decideDelete(factsOf(null)))).toMatchObject({
      code: "NOT_FOUND",
      deny: "todo_not_found",
    });
  });

  it("#149 AC-1 5-4 AC-9 計画 10節 #26: 終了中なら、削除済みでも 409 closed（何も書かない 204 より先）", () => {
    expect(
      outcomeOf(decideDelete(factsOf({ deleted: true }, { status: "closed" }))),
    ).toMatchObject({ code: "CONFLICT", reason: "closed" });
  });

  it("#149 AC-1 決定 Q2 計画 10節 #24: 進行中で削除済みなら、何も書かない結果（result）", () => {
    expect(outcomeOf(decideDelete(factsOf({ deleted: true })))).toEqual({
      kind: "unchanged",
    });
  });

  it.each([
    ["未完了", { completed: false }],
    ["完了済み（AC-8 に制限なし）", { completed: true }],
  ])("#149 AC-1 5-4 AC-8: %s の TODO は削除へ進む（null）", (_l, todo) => {
    expect(outcomeOf(decideDelete(factsOf(todo)))).toEqual({ kind: "pass" });
  });
});
