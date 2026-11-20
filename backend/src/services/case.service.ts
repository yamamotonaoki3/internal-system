// Service：案件の一覧・概要・詳細（#147 の 147-A）と、参加者の追加・削除・納期の変更（147-B）の業務ルール。HTTP を知らない。
// 判定の順（計画 147-A。変えない）：
//   一覧：perm.case.summary.view（会社の範囲。拒否は authorize が記録）
//   概要：perm.case.summary.view → 案件がない（404。logger.audit）
//   詳細：案件がない（404）→ 有効な参加者でない（403。logger.audit）→ perm.case.view（会社の範囲）
// 全体管理者・担当部署のオーナーでも、参加していなければ詳細は見られない（AC-2・AC-21）。
// 判定の順（計画 147-B「API と判定の順」。変えない）：
//   追加：案件がない（404）→ 操作者が有効な参加者でない（403）→ perm.case.participant.edit → 本文の形（422）
//     → 対象の社員がいない・無効（422。同じ本文）→ 終了中（409 closed）→ すでに参加者（409 already_participant）→ batch
//   削除・退出：404 → 403 → perm.case.participant.edit → 対象が参加者でない（404）→ 409 closed
//     → 自動参加の人（409 auto_participant。本人の退出も。Q2）→ 最後の有効な参加者（409 last_active_participant。Q1）→ batch
//   納期：404 → 編集できない（403。有効な参加者か管理の資格）→ perm.case.edit → 形・今日より前（422）→ 409 closed
//     → 今と同じ値（何も書かない）→ batch
// batch の前提が崩れたら（CaseStateChangedError）、最初と同じ判定の関数で読み直す。理由に当たればそれを返し、当たらなければ
// 成功にせず元のエラーを投げる。読み直しも最初と同じ順なので、外された・無効になった操作者には 403 が先に返り、案件の状態を漏らさない。
// 147-B の操作はどれも再認証を求めない（5-1 AC-3、C-122）。
// 終了・再開（#150 の 150-A。EP-5-11・12）：404 → 有効な参加者でない（403。状態より先：状態を漏らさない）→ perm.case.close
//   → 状態（409 already_closed／already_active）→ batch。再認証は求めない（C-81）。
//   前提が崩れたら読み直し、理由に当たればそれを返す。版だけが変わっていれば 409 stale（状態が一度変わって戻った場合）。
//   どれにも当たらなければ宛先が変わったとみて、最初の版のまま宛先を読み直して1回だけやり直し、それでも崩れたら 409 retry。
// 再開の選び直し（150-B。計画 6.1。変えない）：404 → 403 → perm.case.close → 本文の形（422）→ 409 already_active
//   → 409 participants_changed（画面で見た参加者といまの有効な参加者が違う）→ 422 本人を外す → 409 auto_participant
//   → 422 追加の人がいない・無効（同じ本文）→ 409 already_participant → batch。読み直しと版・やり直しの扱いは終了と同じ。
import { z } from "zod";
import {
  caseDescriptionSchema,
  caseDueDateSchema,
  caseTitleSchema,
  isDueDateBeforeToday,
} from "../../../shared/case-rules";
import {
  CaseStateChangedError,
  withCases,
  type CaseEditFacts,
  type CaseEditWriteInput,
  type CaseListScope,
  type CaseRepository,
  type CaseStatus,
  type CaseReopenFacts,
  type CaseStatus as Status,
  type CaseWriteFacts,
} from "../db/case.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import {
  autoRoleOf,
  canRemoveParticipant,
} from "../lib/case-participant-rules";
import type { CursorPayload } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import type { Permission } from "../lib/permissions";
import { isUlid } from "../lib/ulid";
import { createAppAuthorizer } from "./authorizer";
import { BUSY_MESSAGE, MAX_ID_RETRIES } from "./case-todo.service";
import { RETRY_CONFLICT_MESSAGE } from "./channel-manage.service";

// 一覧の範囲と状態（route が入力の形に使う。routes は db を直接参照しない）
export { CASE_LIST_SCOPES, CASE_STATUSES } from "../db/case.repository";

export type CaseActor = { userId: string; traceId: string };

/** 画面はこの文言をそのまま出す */
const NOT_FOUND_MESSAGE = "案件が見つかりません";
const PARTICIPANTS_ONLY_MESSAGE = "参加者だけが見られます（非公開）";
const PARTICIPANTS_ONLY_TO_EDIT_MESSAGE = "参加者だけが操作できます";
const PARTICIPANT_NOT_FOUND_MESSAGE = "参加者が見つかりません";
const DUE_DATE_FORBIDDEN_MESSAGE =
  "納期を変更できるのは、参加者・担当部署のオーナー・全体管理者だけです";
const VALIDATION_MESSAGE = "入力内容を確かめてください";
/** 対象の社員がいない・無効のどちらでも同じ本文にする（社員の有無・状態を本文の違いで明かさない） */
const TARGET_INVALID_MESSAGE = "追加できる社員を選んでください";
const CANNOT_REMOVE_SELF_MESSAGE = "再開する本人は外せません";
const EDIT_FORBIDDEN_MESSAGE =
  "案件を編集できるのは、参加者・担当部署のオーナー・全体管理者だけです";
const DESCRIPTION_PARTICIPANTS_ONLY_MESSAGE =
  "説明を変更できるのは参加者だけです";

/** 再開の選び直しの上限（決定 Q4。画面で見た参加者には上限を置かない） */
export const REOPEN_ADD_LIMIT = 100;
export const REOPEN_REMOVE_LIMIT = 100;

export type CaseConflictReason =
  | "closed"
  | "already_participant"
  | "auto_participant"
  | "last_active_participant"
  | "already_closed"
  | "already_active"
  | "participants_changed"
  | "stale"
  | "retry";

const CONFLICT_MESSAGES: Record<CaseConflictReason, string> = {
  closed: "終了した案件は変更できません",
  already_participant: "この社員はすでに参加者です",
  auto_participant: "担当部署のオーナー・全体管理者は外せません",
  last_active_participant:
    "最後の参加者は外せません。先にほかの社員を追加してください",
  already_closed: "この案件はすでに終了しています",
  already_active: "この案件はすでに進行中です",
  participants_changed:
    "参加者がほかの操作で変わりました。画面を確かめてから、もう一度操作してください",
  stale:
    "ほかの人が先にこの案件を変更しました。画面を確かめてから、もう一度操作してください",
  retry: RETRY_CONFLICT_MESSAGE,
};

type ViewAction = "case.summary.view" | "case.view";
type WriteAction =
  | "case.participant.add"
  | "case.participant.remove"
  | "case.due_date.change"
  | "case.close"
  | "case.reopen"
  | "case.edit";

const addBodySchema = z.object({ userId: z.string().refine(isUlid) }).strict();
const dueDateBodySchema = z
  .object({ dueDate: caseDueDateSchema.nullable() })
  .strict();

const ulidListSchema = z.array(z.string().refine(isUlid));
const hasDuplicates = (ids: readonly string[]) =>
  new Set(ids).size !== ids.length;

const reopenBodySchema = z
  .object({
    participantIds: ulidListSchema,
    addUserIds: ulidListSchema.max(REOPEN_ADD_LIMIT),
    removeUserIds: ulidListSchema.max(REOPEN_REMOVE_LIMIT),
  })
  .strict()
  .superRefine((body, context) => {
    const invalid = (field: keyof typeof body) =>
      context.addIssue({ code: "custom", path: [field], message: "" });
    for (const field of [
      "participantIds",
      "addUserIds",
      "removeUserIds",
    ] as const)
      if (hasDuplicates(body[field])) invalid(field);
    const seen = new Set(body.participantIds);
    if (body.removeUserIds.some((id) => !seen.has(id)))
      invalid("removeUserIds");
    if (
      body.addUserIds.some(
        (id) => seen.has(id) || body.removeUserIds.includes(id),
      )
    )
      invalid("addUserIds");
  });

export type CaseReopenBody = z.infer<typeof reopenBodySchema>;

const validationError = (fields: string[], message = VALIDATION_MESSAGE) =>
  new AppError("VALIDATION_ERROR", message, { fields });

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw validationError([
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ]);
  return parsed.data;
}

/** 判定の結果。deny は logger.audit に残す（404・403）。null は通ること */
type Decision =
  | { kind: "deny"; reason: string; error: AppError }
  | { kind: "error"; error: AppError }
  | null;

const conflictError = (reason: CaseConflictReason) =>
  new AppError("CONFLICT", CONFLICT_MESSAGES[reason], { reason });
const conflict = (reason: CaseConflictReason): Decision => ({
  kind: "error",
  error: conflictError(reason),
});
const notFound = (): Decision => ({
  kind: "deny",
  reason: "not_found",
  error: new AppError("NOT_FOUND", NOT_FOUND_MESSAGE),
});

/** 追加・削除・終了・再開の 403 までの判定 */
function decideParticipantGate(
  facts: { actorIsParticipant: boolean } | null,
): Decision {
  if (facts === null) return notFound();
  if (!facts.actorIsParticipant)
    return {
      kind: "deny",
      reason: "not_participant",
      error: new AppError("FORBIDDEN", PARTICIPANTS_ONLY_TO_EDIT_MESSAGE),
    };
  return null;
}

/** 追加の、認可・本文の形の後の判定 */
function decideAdd(facts: CaseWriteFacts): Decision {
  const target = facts.target;
  if (target === null || !target.isActive)
    return {
      kind: "error",
      error: validationError(["userId"], TARGET_INVALID_MESSAGE),
    };
  if (facts.status !== "active") return conflict("closed");
  if (target.isParticipant) return conflict("already_participant");
  return null;
}

/** 削除・退出の、認可の後の判定 */
function decideRemove(facts: CaseWriteFacts): Decision {
  const target = facts.target;
  if (target === null || !target.isParticipant)
    return {
      kind: "deny",
      reason: "participant_not_found",
      error: new AppError("NOT_FOUND", PARTICIPANT_NOT_FOUND_MESSAGE),
    };
  if (facts.status !== "active") return conflict("closed");
  const targetAutoRole = autoRoleOf({
    isActive: target.isActive,
    isGlobalAdmin: target.isGlobalAdmin,
    ownedDepartmentIds: target.ownedDepartmentIds,
    caseDepartmentIds: facts.caseDepartmentIds,
  });
  if (targetAutoRole !== null) return conflict("auto_participant");
  const activeCountAfter =
    facts.activeParticipantCount - (target.isActive ? 1 : 0);
  if (!canRemoveParticipant({ targetAutoRole, activeCountAfter }))
    return conflict("last_active_participant");
  return null;
}

/** 納期の 403 までの判定（有効な参加者か、管理の資格。R-82） */
function decideDueDateGate(facts: CaseWriteFacts | null): Decision {
  if (facts === null) return notFound();
  if (!facts.actorIsParticipant && !facts.actorCanManage)
    return {
      kind: "deny",
      reason: "cannot_edit",
      error: new AppError("FORBIDDEN", DUE_DATE_FORBIDDEN_MESSAGE),
    };
  return null;
}

/** 403 までの判定を通った材料（案件がある）。判定で null を除いた後にだけ呼ぶ */
function present<T>(facts: T | null): T {
  if (facts === null)
    throw new Error("案件の材料がありません（404 の判定の前に呼ばれました）");
  return facts;
}

/** 納期の、本文の検証の後の判定 */
function decideDueDate(facts: CaseWriteFacts): Decision {
  return facts.status === "active" ? null : conflict("closed");
}

/** 終了の判定（最初の判定と読み直しで同じ）：404 → 403 → 409 already_closed */
export function decideClose(facts: CaseWriteFacts | null): Decision {
  return (
    decideParticipantGate(facts) ??
    (present(facts).status === "closed" ? conflict("already_closed") : null)
  );
}

/** 再開の判定（最初の判定と読み直しで同じ）：404 → 403 → 409 already_active */
export function decideReopen(
  facts: { actorIsParticipant: boolean; status: Status } | null,
): Decision {
  return (
    decideParticipantGate(facts) ??
    (present(facts).status === "active" ? conflict("already_active") : null)
  );
}

const sameMembers = (a: readonly string[], b: readonly string[]) => {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((id) => set.has(id));
};

/**
 * 再開の選び直しの判定（最初の判定と読み直しで同じ）。body は形の検証を通った後のもの。
 * 404 → 403 → already_active → participants_changed → 本人を外す（422）→ auto_participant → 追加の人が無効（422）→ already_participant
 */
export function decideReopenReselect(
  facts: CaseReopenFacts | null,
  body: CaseReopenBody,
  actorId: string,
): Decision {
  const head = decideReopen(facts);
  if (head !== null) return head;
  const current = present(facts);
  if (!sameMembers(current.activeParticipantIds, body.participantIds))
    return conflict("participants_changed");
  if (body.removeUserIds.includes(actorId))
    return {
      kind: "error",
      error: validationError(["removeUserIds"], CANNOT_REMOVE_SELF_MESSAGE),
    };
  const targetOf = (userId: string) =>
    current.targets.find((t) => t.userId === userId);
  const isAuto = (userId: string) => {
    const target = targetOf(userId);
    return (
      target !== undefined &&
      autoRoleOf({
        ...target,
        caseDepartmentIds: current.caseDepartmentIds,
      }) !== null
    );
  };
  if (body.removeUserIds.some(isAuto)) return conflict("auto_participant");
  if (body.addUserIds.some((id) => targetOf(id)?.isActive !== true))
    return {
      kind: "error",
      error: validationError(["addUserIds"], TARGET_INVALID_MESSAGE),
    };
  if (body.addUserIds.some((id) => targetOf(id)?.hasMembershipRow === true))
    return conflict("already_participant");
  return null;
}

// ---- 再編集（#150 の 150-C。EP-5-20。計画 4.2） ----

const departmentIdsSchema = ulidListSchema
  .min(1)
  .refine((ids) => !hasDuplicates(ids));

/** 本文（strict）。変える項目と、衝突の検知の version（参加者）か expected（非参加の管理者が概要で見た値）のどちらか1つ */
const editBodySchema = z
  .object({
    title: caseTitleSchema.optional(),
    description: caseDescriptionSchema.optional(),
    clientId: z.string().refine(isUlid).optional(),
    departmentIds: departmentIdsSchema.optional(),
    version: z.number().int().min(1).optional(),
    expected: z
      .object({
        title: z.string(),
        clientId: z.string().refine(isUlid),
        departmentIds: departmentIdsSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (body) => (body.version === undefined) !== (body.expected === undefined),
    { path: ["version"] },
  );

export type CaseEditBody = z.infer<typeof editBodySchema>;

/** 本文の形を確かめる。未知の項目（caseNumber・dueDate を含む）は、項目名を fields に入れる */
function parseEditBody(body: unknown): CaseEditBody {
  const parsed = editBodySchema.safeParse(body);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.flatMap((issue) =>
    issue.code === "unrecognized_keys"
      ? issue.keys
      : [String(issue.path[0] ?? "")],
  );
  throw validationError([...new Set(fields)]);
}

/** 本文に、参加者だけが送れる項目（説明・版）があるか。本文の形より先に見る（非参加者に版の一致を答えないため） */
const hasParticipantOnlyField = (body: unknown) =>
  typeof body === "object" &&
  body !== null &&
  ("description" in body || "version" in body);

/** 再編集の 403 までの判定（有効な参加者か、管理の資格） */
function decideEditGate(facts: CaseEditFacts | null): Decision {
  if (facts === null) return notFound();
  if (!facts.actorIsParticipant && !facts.actorCanManage)
    return {
      kind: "deny",
      reason: "cannot_edit",
      error: new AppError("FORBIDDEN", EDIT_FORBIDDEN_MESSAGE),
    };
  return null;
}

const descriptionParticipantsOnly = (): Decision => ({
  kind: "deny",
  reason: "description_participants_only",
  error: new AppError("FORBIDDEN", DESCRIPTION_PARTICIPANTS_ONLY_MESSAGE),
});

/** 公開項目（件名・取引先・担当部署の集合）が、読んだときと同じか */
const samePublicFields = (a: CaseEditFacts, b: CaseEditFacts) =>
  a.title === b.title &&
  a.client.id === b.client.id &&
  sameMembers(a.departmentIds, b.departmentIds);

/**
 * 再編集の判定（最初の判定と読み直しで同じ）。body は形の検証を通った後のもの（件名は整形後）。
 * 404 → 403（資格なし）→ 403（非参加者の説明・版）→ 409 closed → 409 stale → 422 取引先 → 422 部署。
 * 取引先・部署の「ない」と「無効」は同じ本文にする（存在・状態を明かさない）。いまと同じ取引先・すでに担当の部署は無効でも通す
 */
/** 衝突：版がいまと違う、または expected がいまの件名・取引先・担当部署の集合と違う */
function isStale(current: CaseEditFacts, body: CaseEditBody): boolean {
  const expected = body.expected;
  if (expected === undefined) return body.version !== current.version;
  return (
    expected.title !== current.title ||
    expected.clientId !== current.client.id ||
    !sameMembers(expected.departmentIds, current.departmentIds)
  );
}

/** 取引先・足す部署の 422（「ない」と「無効」は同じ本文） */
function decideEditTargets(
  current: CaseEditFacts,
  body: CaseEditBody,
): Decision {
  const changesClient =
    body.clientId !== undefined && body.clientId !== current.client.id;
  if (changesClient && current.requestedClient?.isActive !== true)
    return { kind: "error", error: validationError(["clientId"]) };
  const added = (body.departmentIds ?? []).filter(
    (id) => !current.departmentIds.includes(id),
  );
  const isUsable = (id: string) =>
    current.requestedDepartments.some((d) => d.id === id && d.isActive);
  if (!added.every(isUsable))
    return { kind: "error", error: validationError(["departmentIds"]) };
  return null;
}

/** 判定の関数の形（操作者の ID も受ける）をほかの操作とそろえる。再編集の判定は、材料の資格の値だけで決まる */
export const decideEdit: (
  facts: CaseEditFacts | null,
  body: CaseEditBody,
  actorId: string,
) => Decision = (facts, body) => {
  const gate = decideEditGate(facts);
  if (gate !== null) return gate;
  const current = present(facts);
  if (
    !current.actorIsParticipant &&
    (body.description !== undefined || body.version !== undefined)
  )
    return descriptionParticipantsOnly();
  if (current.status !== "active") return conflict("closed");
  if (isStale(current, body)) return conflict("stale");
  return decideEditTargets(current, body);
};

/** 本文の項目のうち、いまの値と違うもの（件名は整形後で比べる。取引先は監査に使うコード・名前つき） */
function changedFieldsOf(
  facts: CaseEditFacts,
  body: CaseEditBody,
): Pick<
  CaseEditWriteInput,
  "title" | "description" | "client" | "departmentIds"
> {
  const changed: Pick<
    CaseEditWriteInput,
    "title" | "description" | "client" | "departmentIds"
  > = {};
  if (body.title !== undefined && body.title !== facts.title)
    changed.title = body.title;
  if (body.description !== undefined && body.description !== facts.description)
    changed.description = body.description;
  const requested = facts.requestedClient;
  if (
    requested !== null &&
    body.clientId !== facts.client.id &&
    requested.id === body.clientId
  )
    changed.client = {
      id: requested.id,
      code: requested.code,
      name: requested.name,
    };
  const departmentIds = body.departmentIds;
  if (
    departmentIds !== undefined &&
    !sameMembers(departmentIds, facts.departmentIds)
  )
    changed.departmentIds = [...departmentIds].sort();
  return changed;
}

/** 判定を通った本文から、書き込みの入力を作る。変える項目がなければ null（何も書かない） */
function editPlanOf(
  facts: CaseEditFacts,
  body: CaseEditBody,
  base: Pick<CaseEditWriteInput, "caseId" | "actorId" | "traceId">,
): CaseEditWriteInput | null {
  const changed = changedFieldsOf(facts, body);
  if (Object.keys(changed).length === 0) return null;
  return {
    ...base,
    basis:
      body.expected === undefined
        ? { version: facts.version }
        : { expected: body.expected },
    before: {
      title: facts.title,
      client: facts.client,
      departmentIds: facts.departmentIds,
    },
    ...changed,
    joinUserIds: changed.departmentIds === undefined ? [] : facts.joinUserIds,
  };
}

const STATUS_OPERATIONS = {
  close: {
    action: "case.close",
    decide: decideClose,
    write: "closeCase",
    status: "closed",
  },
} as const;

export function withCaseService<T>(
  env: Env,
  run: (service: ReturnType<typeof createCaseService>) => Promise<T>,
): Promise<T> {
  return withCases(env, (repository, roles) =>
    run(createCaseService(repository, roles)),
  );
}

export function createCaseService(
  repository: CaseRepository,
  roles: RoleAssignmentRepository,
) {
  const loggerOf = (actor: CaseActor) =>
    createLogger({ traceId: actor.traceId, userId: actor.userId });

  async function authorize(
    actor: CaseActor,
    permission: Permission,
  ): Promise<void> {
    await createAppAuthorizer(roles, { logger: loggerOf(actor) }).authorize(
      { userId: actor.userId },
      permission,
      { type: "company" },
    );
  }

  function deny(
    actor: CaseActor,
    action: ViewAction | WriteAction,
    caseId: string,
    reason: string,
    error: AppError,
  ): never {
    loggerOf(actor).audit(action, caseId, "failure", { reason });
    throw error;
  }

  /** 判定が理由を返したら投げる（404・403 は logger.audit に残す） */
  function raiseIf(
    actor: CaseActor,
    action: WriteAction,
    caseId: string,
    decision: Decision,
  ): void {
    if (decision === null) return;
    if (decision.kind === "deny")
      deny(actor, action, caseId, decision.reason, decision.error);
    throw decision.error;
  }

  /**
   * 書き込む。前提が崩れていたら（CaseStateChangedError）、最初と同じ判定で読み直して理由を返す。
   * どの理由にも当たらなければ、成功にせず元のエラーを投げる。それ以外のエラーは、そのまま伝える
   */
  async function writeOrRedecide(
    actor: CaseActor,
    action: WriteAction,
    caseId: string,
    write: () => Promise<void>,
    redecide: () => Promise<Decision>,
  ): Promise<void> {
    try {
      await write();
    } catch (error) {
      if (!(error instanceof CaseStateChangedError)) throw error;
      raiseIf(actor, action, caseId, await redecide());
      throw error;
    }
  }

  /** 終了・再開。判定の材料（版を含む）を、宛先より先に読む */
  async function changeStatus<K extends keyof typeof STATUS_OPERATIONS>(
    actor: CaseActor,
    caseId: string,
    operation: (typeof STATUS_OPERATIONS)[K],
  ): Promise<{
    caseId: string;
    status: (typeof STATUS_OPERATIONS)[K]["status"];
  }> {
    const { action, decide } = operation;
    const read = () =>
      repository.findWriteFacts({ caseId, actorId: actor.userId });
    const first = await read();
    raiseIf(actor, action, caseId, decideParticipantGate(first));
    await authorize(actor, "perm.case.close");
    raiseIf(actor, action, caseId, decide(first));
    // 版は最初に読んだものを使い続ける（再試行でも新しい版に差し替えない）
    const { version } = present(first);
    for (let attempt = 0; ; attempt += 1) {
      const recipientIds = await repository.listCaseNotifyRecipients(
        caseId,
        actor.userId,
      );
      try {
        await repository[operation.write]({
          caseId,
          actorId: actor.userId,
          version,
          recipientIds,
          traceId: actor.traceId,
        });
        return { caseId, status: operation.status };
      } catch (error) {
        if (!(error instanceof CaseStateChangedError)) throw error;
        const again = await read();
        raiseIf(actor, action, caseId, decide(again));
        if (present(again).version !== version) throw conflictError("stale");
        if (attempt >= 1) throw conflictError("retry");
      }
    }
  }

  async function findOrNotFound(
    actor: CaseActor,
    action: ViewAction,
    caseId: string,
  ) {
    const summary = await repository.findSummary({
      actorId: actor.userId,
      caseId,
    });
    if (summary === null)
      deny(
        actor,
        action,
        caseId,
        "not_found",
        new AppError("NOT_FOUND", NOT_FOUND_MESSAGE),
      );
    return summary;
  }

  return {
    async list(
      actor: CaseActor,
      options: {
        scope: CaseListScope;
        status: CaseStatus;
        limit: number;
        cursor?: CursorPayload;
      },
    ) {
      await authorize(actor, "perm.case.summary.view");
      return repository.list({ actorId: actor.userId, ...options });
    },

    async summary(actor: CaseActor, caseId: string) {
      await authorize(actor, "perm.case.summary.view");
      return findOrNotFound(actor, "case.summary.view", caseId);
    },

    async detail(actor: CaseActor, caseId: string) {
      const summary = await findOrNotFound(actor, "case.view", caseId);
      if (!summary.isParticipant)
        deny(
          actor,
          "case.view",
          caseId,
          "not_participant",
          new AppError("FORBIDDEN", PARTICIPANTS_ONLY_MESSAGE),
        );
      await authorize(actor, "perm.case.view");
      // 認可の後に無効化・参加の解除が確定した場合に備え、詳細の読み取りそのものが有効な参加者かを確かめる
      const extras = await repository.findDetailExtras({
        caseId,
        actorId: actor.userId,
      });
      if (extras === "not_found")
        deny(
          actor,
          "case.view",
          caseId,
          "not_found",
          new AppError("NOT_FOUND", NOT_FOUND_MESSAGE),
        );
      if (extras === "not_visible")
        deny(
          actor,
          "case.view",
          caseId,
          "not_participant",
          new AppError("FORBIDDEN", PARTICIPANTS_ONLY_MESSAGE),
        );
      // 先に読んだ概要は資格の判定にだけ使い、応答は詳細の1回の読み取りの値にする（古い件名と新しい版を混ぜない）
      return extras;
    },

    /**
     * 案件の内容の再編集（EP-5-20）。body は検証前の本文（403 までの判定の後に形を確かめる。存在の非開示）。
     * 前提が崩れたら読み直して理由を返す。読んだ公開項目が版を進めずに変わっていれば 409 stale。
     * どれでもなく自動参加させる人の集合だけが違えば、読み直した材料で1回だけやり直し、それでも崩れたら 409 retry
     */
    async edit(
      actor: CaseActor,
      caseId: string,
      body: unknown,
    ): Promise<{ caseId: string; titleFormatted: boolean }> {
      const action = "case.edit";
      const gate = await repository.findEditFacts({
        caseId,
        actorId: actor.userId,
      });
      raiseIf(actor, action, caseId, decideEditGate(gate));
      await authorize(actor, "perm.case.edit");
      if (!present(gate).actorIsParticipant && hasParticipantOnlyField(body))
        raiseIf(actor, action, caseId, descriptionParticipantsOnly());
      const edit = parseEditBody(body);
      // 説明の衝突を版で見るため、有効な参加者は expected を使えない
      if (present(gate).actorIsParticipant && edit.expected !== undefined)
        throw validationError(["version"]);
      const rawTitle = (body as { title?: unknown }).title;
      const result = {
        caseId,
        titleFormatted: edit.title !== undefined && rawTitle !== edit.title,
      };
      const read = () =>
        repository.findEditFacts({
          caseId,
          actorId: actor.userId,
          ...(edit.clientId === undefined ? {} : { clientId: edit.clientId }),
          ...(edit.departmentIds === undefined
            ? {}
            : { departmentIds: edit.departmentIds }),
        });
      let facts = await read();
      raiseIf(actor, action, caseId, decideEdit(facts, edit, actor.userId));
      const base = { caseId, actorId: actor.userId, traceId: actor.traceId };
      for (let attempt = 0; ; attempt += 1) {
        const plan = editPlanOf(present(facts), edit, base);
        if (plan === null) return result;
        try {
          await repository.editCase(plan);
          return result;
        } catch (error) {
          if (!(error instanceof CaseStateChangedError)) throw error;
          const again = await read();
          raiseIf(actor, action, caseId, decideEdit(again, edit, actor.userId));
          if (!samePublicFields(present(again), present(facts)))
            throw conflictError("stale");
          if (
            sameMembers(present(again).joinUserIds, present(facts).joinUserIds)
          )
            throw error;
          if (attempt >= 1) throw conflictError("retry");
          facts = again;
        }
      }
    },
    /** 終了（EP-5-11） */
    close(actor: CaseActor, caseId: string) {
      return changeStatus(actor, caseId, STATUS_OPERATIONS.close);
    },

    /**
     * 再開（EP-5-12）と参加者の選び直し。body は検証前の本文（403 までの判定の後に形を確かめる。存在の非開示）。
     * 版は最初に読んだものを使い続ける。宛先は、読んだ宛先から外す人を除き、追加の人を足したもの（3-3 AC-2）
     */
    async reopen(
      actor: CaseActor,
      caseId: string,
      body: unknown,
    ): Promise<{ caseId: string; status: "active" }> {
      const action = "case.reopen";
      const first = await repository.findReopenFacts({
        caseId,
        actorId: actor.userId,
        addUserIds: [],
        removeUserIds: [],
      });
      raiseIf(actor, action, caseId, decideParticipantGate(first));
      await authorize(actor, "perm.case.close");
      const reselect = parseBody(reopenBodySchema, body);
      const { version } = present(first);
      const decide = async () => {
        const facts = await repository.findReopenFacts({
          caseId,
          actorId: actor.userId,
          addUserIds: reselect.addUserIds,
          removeUserIds: reselect.removeUserIds,
        });
        return {
          facts,
          decision: decideReopenReselect(facts, reselect, actor.userId),
        };
      };
      raiseIf(actor, action, caseId, (await decide()).decision);
      const removed = new Set(reselect.removeUserIds);
      for (let attempt = 0; ; attempt += 1) {
        const readRecipientIds = await repository.listCaseNotifyRecipients(
          caseId,
          actor.userId,
        );
        const recipientIds = [
          ...readRecipientIds.filter((id) => !removed.has(id)),
          ...reselect.addUserIds,
        ].sort();
        try {
          await repository.reopenCase({
            caseId,
            actorId: actor.userId,
            version,
            ...reselect,
            readRecipientIds,
            recipientIds,
            traceId: actor.traceId,
          });
          return { caseId, status: "active" };
        } catch (error) {
          if (!(error instanceof CaseStateChangedError)) throw error;
          const again = await decide();
          raiseIf(actor, action, caseId, again.decision);
          if (present(again.facts).version !== version)
            throw conflictError("stale");
          if (attempt >= 1) throw conflictError("retry");
        }
      }
    },

    /** 参加者の追加（EP-5-09）。body は検証前の本文（403 までの判定の後に形を確かめる。存在の非開示） */
    async addParticipant(
      actor: CaseActor,
      caseId: string,
      body: unknown,
    ): Promise<{ caseId: string; userId: string }> {
      const action = "case.participant.add";
      const gate = await repository.findWriteFacts({
        caseId,
        actorId: actor.userId,
      });
      raiseIf(actor, action, caseId, decideParticipantGate(gate));
      await authorize(actor, "perm.case.participant.edit");
      const { userId } = parseBody(addBodySchema, body);
      const decide = async (): Promise<Decision> => {
        const facts = await repository.findWriteFacts({
          caseId,
          actorId: actor.userId,
          targetId: userId,
        });
        return decideParticipantGate(facts) ?? decideAdd(present(facts));
      };
      raiseIf(actor, action, caseId, await decide());
      await writeOrRedecide(
        actor,
        action,
        caseId,
        () =>
          repository.addParticipant({
            caseId,
            actorId: actor.userId,
            userId,
            traceId: actor.traceId,
          }),
        decide,
      );
      return { caseId, userId };
    },

    /** 参加者の削除・本人の退出（EP-5-10。userId が本人なら退出） */
    async removeParticipant(
      actor: CaseActor,
      caseId: string,
      userId: string,
    ): Promise<void> {
      const action = "case.participant.remove";
      const read = () =>
        repository.findWriteFacts({
          caseId,
          actorId: actor.userId,
          targetId: userId,
        });
      const facts = await read();
      raiseIf(actor, action, caseId, decideParticipantGate(facts));
      await authorize(actor, "perm.case.participant.edit");
      raiseIf(actor, action, caseId, decideRemove(present(facts)));
      // 外れた人の TODO の件数・記録の ID が読み取りの後に変わっても、理由に当たらなければ呼び直す（Repository が読み直す。149-D 計画 6.3.7）
      for (let retry = 0; ; retry += 1) {
        try {
          await repository.removeParticipant({
            caseId,
            actorId: actor.userId,
            userId,
            traceId: actor.traceId,
          });
          return;
        } catch (error) {
          if (!(error instanceof CaseStateChangedError)) throw error;
          const again = await read();
          raiseIf(
            actor,
            action,
            caseId,
            decideParticipantGate(again) ?? decideRemove(present(again)),
          );
          if (retry >= MAX_ID_RETRIES) break;
        }
      }
      loggerOf(actor).warn("参加者の削除のやり直しが上限を超えた", { caseId });
      throw new AppError("SERVICE_UNAVAILABLE", BUSY_MESSAGE);
    },

    /** 納期の変更。非参加の担当部署のオーナー・全体管理者もできる（AC-21・Q6）。null は未定に戻す */
    async changeDueDate(
      actor: CaseActor,
      caseId: string,
      body: unknown,
    ): Promise<{ caseId: string; dueDate: string | null }> {
      const action = "case.due_date.change";
      const read = () =>
        repository.findWriteFacts({ caseId, actorId: actor.userId });
      const read0 = await read();
      raiseIf(actor, action, caseId, decideDueDateGate(read0));
      const facts = present(read0);
      await authorize(actor, "perm.case.edit");
      const { dueDate } = parseBody(dueDateBodySchema, body);
      if (dueDate !== null && isDueDateBeforeToday(dueDate, new Date()))
        throw validationError(["dueDate"]);
      raiseIf(actor, action, caseId, decideDueDate(facts));
      const result = { caseId, dueDate };
      // 今と同じ値なら何も書かない（版・監査を変えない）
      if (facts.dueDate === dueDate) return result;
      try {
        await repository.changeDueDate({
          caseId,
          actorId: actor.userId,
          before: facts.dueDate,
          after: dueDate,
          traceId: actor.traceId,
        });
      } catch (error) {
        if (!(error instanceof CaseStateChangedError)) throw error;
        const again = await read();
        raiseIf(
          actor,
          action,
          caseId,
          decideDueDateGate(again) ?? decideDueDate(present(again)),
        );
        // ほかの人が同じ値にしていたら、求めた結果になっている（何も書かない）
        if (present(again).dueDate === dueDate) return result;
        throw error;
      }
      return result;
    },
  };
}
