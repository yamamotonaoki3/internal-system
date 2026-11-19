// Service：案件の添付の一覧（#148 の 148-B-1。EP-5-19）と公開範囲の変更（148-B-2。EP-1-23）の業務ルール。HTTP を知らない。
// 判定の順（計画 148-B-1。クエリの検証〔422〕はルートが最初に行う）：
//   案件がない（404）→ 有効な参加者でない（403）→ perm.case.view → 読み取り（資格を SQL に入れる。資格がなければ 403）
// 管理の資格はあるが参加していない人（担当部署のオーナー・全体管理者）も 403。終了した案件でも、参加者は読める（5-1 AC-11）。
// 404・403 の拒否は logger.audit に残す（対象は案件の ID。ファイル名などの中身は入れない）。
//
// 公開範囲の変更（EP-1-23。要件 5-2 AC-9・R-85）の判定の順：
//   1. 見えない・存在しない添付（404「添付が見つかりません」。配信と同じ本文）
//   2. 未投稿の添付（1 と同じ 404）
//   3. 案件の部屋の添付でない（422 attachmentId。見える添付なので存在は漏れない）
//   4. 有効な参加者でない（1 と同じ 404。存在を漏らさない）
//   5. perm.case.view → perm.case.attachment.visibility.change（403）
//   6. 本人でも管理の資格（担当部署のオーナー・全体管理者）もない（403）
//   7. 本文の値（422 publicationVisibility）
//   8. 案件が終了（409）
//   9. 今と同じ値なら書かずに成功（監査も書かない）
//   10. 書き込みが0行なら 1 から読み直し、2〜8 と同じ応答。読み直した値が求めた値なら成功。どれにも当たらなければ 409（成功にしない）
// 404・403（6）・409 の拒否は logger.audit に残す（対象は添付の ID。ファイル名を入れない）。
import { z } from "zod";
import {
  AttachmentStateChangedError,
  withCaseAttachments,
  type AttachmentVisibilityFacts,
  type CaseAttachmentRepository,
} from "../db/case-attachment.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { createLogger } from "../lib/logger/logger";
import {
  PUBLICATION_VISIBILITIES,
  type PublicationVisibility,
} from "../../../shared/attachment-rules";
import { createAppAuthorizer } from "./authorizer";

export type CaseAttachmentActor = { userId: string; traceId: string };

/** 画面はこの文言をそのまま出す */
const NOT_FOUND_MESSAGE = "案件が見つかりません";
const PARTICIPANTS_ONLY_MESSAGE = "参加者だけが見られます（非公開）";

const VIEW_ACTION = "case.attachment.view";

const VISIBILITY_ACTION = "case.attachment.visibility.change";
const ATTACHMENT_NOT_FOUND_MESSAGE = "添付が見つかりません";
const VISIBILITY_FORBIDDEN_MESSAGE = "この添付の公開範囲は変更できません";
const VISIBILITY_CLOSED_MESSAGE =
  "終了した案件の添付の公開範囲は変更できません";
const VISIBILITY_STATE_CHANGED_MESSAGE =
  "状態が変わったため、変更できませんでした。読み込み直してからお試しください";

const visibilityBodySchema = z.object({
  publicationVisibility: z.enum(PUBLICATION_VISIBILITIES),
});

type VisibilityDenial =
  | "not_found"
  | "not_posted"
  | "not_participant"
  | "not_uploader_or_manager"
  | "case_closed"
  | "state_changed";

export function withCaseAttachmentService<T>(
  env: Env,
  run: (service: ReturnType<typeof createCaseAttachmentService>) => Promise<T>,
): Promise<T> {
  return withCaseAttachments(env, (repository, roles) =>
    run(createCaseAttachmentService(repository, roles)),
  );
}

export function createCaseAttachmentService(
  repository: CaseAttachmentRepository,
  roles: RoleAssignmentRepository,
) {
  const loggerOf = (actor: CaseAttachmentActor) =>
    createLogger({ traceId: actor.traceId, userId: actor.userId });

  function deny(
    actor: CaseAttachmentActor,
    caseId: string,
    reason: "not_found" | "not_participant",
  ): never {
    loggerOf(actor).audit(VIEW_ACTION, caseId, "failure", { reason });
    throw reason === "not_found"
      ? new AppError("NOT_FOUND", NOT_FOUND_MESSAGE)
      : new AppError("FORBIDDEN", PARTICIPANTS_ONLY_MESSAGE);
  }

  function denyVisibility(
    actor: CaseAttachmentActor,
    attachmentId: string,
    reason: VisibilityDenial,
  ): never {
    loggerOf(actor).audit(VISIBILITY_ACTION, attachmentId, "failure", {
      reason,
    });
    switch (reason) {
      case "not_found":
      case "not_posted":
      case "not_participant":
        throw new AppError("NOT_FOUND", ATTACHMENT_NOT_FOUND_MESSAGE);
      case "not_uploader_or_manager":
        throw new AppError("FORBIDDEN", VISIBILITY_FORBIDDEN_MESSAGE);
      case "case_closed":
        throw new AppError("CONFLICT", VISIBILITY_CLOSED_MESSAGE);
      case "state_changed":
        throw new AppError("CONFLICT", VISIBILITY_STATE_CHANGED_MESSAGE);
    }
  }

  // 判定の 1〜4（最初の判定と、書き込みが0行のときの読み直しで同じ順）。案件の添付の材料を返す
  async function readVisibilityFacts(
    actor: CaseAttachmentActor,
    attachmentId: string,
  ): Promise<AttachmentVisibilityFacts & { caseId: string }> {
    const facts = await repository.findVisibilityFacts({
      attachmentId,
      actorId: actor.userId,
    });
    if (facts === null) denyVisibility(actor, attachmentId, "not_found");
    if (facts.messageId === null)
      denyVisibility(actor, attachmentId, "not_posted");
    const { caseId } = facts;
    if (caseId === null)
      throw new AppError("VALIDATION_ERROR", "案件の添付ではありません", {
        fields: ["attachmentId"],
      });
    if (!facts.actorIsParticipant)
      denyVisibility(actor, attachmentId, "not_participant");
    return { ...facts, caseId };
  }

  // 判定の 6・8（権限の確認の後の、行の材料による判定。読み直しでも使う）
  function requireChangeable(
    actor: CaseAttachmentActor,
    attachmentId: string,
    facts: AttachmentVisibilityFacts,
  ) {
    if (facts.uploaderId !== actor.userId && !facts.actorCanManage)
      denyVisibility(actor, attachmentId, "not_uploader_or_manager");
  }

  function requireOpen(
    actor: CaseAttachmentActor,
    attachmentId: string,
    facts: AttachmentVisibilityFacts,
  ) {
    if (facts.caseStatus !== "active")
      denyVisibility(actor, attachmentId, "case_closed");
  }

  function parseVisibilityBody(body: unknown): PublicationVisibility {
    const parsed = visibilityBodySchema.safeParse(body);
    if (!parsed.success)
      throw new AppError("VALIDATION_ERROR", "公開範囲を選んでください", {
        fields: ["publicationVisibility"],
      });
    return parsed.data.publicationVisibility;
  }

  return {
    /** 一覧（EP-5-19） */
    async list(
      actor: CaseAttachmentActor,
      caseId: string,
      options: { limit: number; cursor: string | null },
    ) {
      const facts = await repository.findAttachmentListFacts({
        caseId,
        actorId: actor.userId,
      });
      if (facts === null) deny(actor, caseId, "not_found");
      if (!facts.isParticipant) deny(actor, caseId, "not_participant");
      await createAppAuthorizer(roles, { logger: loggerOf(actor) }).authorize(
        { userId: actor.userId },
        "perm.case.view",
        { type: "company" },
      );
      // 認可の後に無効化・参加の解除が確定した場合に備え、読み取りそのものに資格を入れている
      const page = await repository.listCaseAttachments({
        caseId,
        viewerId: actor.userId,
        ...options,
      });
      if (page === "not_found") deny(actor, caseId, "not_found");
      if (page === "not_visible") deny(actor, caseId, "not_participant");
      return page;
    },

    /** 公開範囲の変更（EP-1-23） */
    async changeVisibility(
      actor: CaseAttachmentActor,
      attachmentId: string,
      body: unknown,
    ): Promise<{ id: string; publicationVisibility: PublicationVisibility }> {
      const facts = await readVisibilityFacts(actor, attachmentId);
      const authorizer = createAppAuthorizer(roles, {
        logger: loggerOf(actor),
      });
      await authorizer.authorize({ userId: actor.userId }, "perm.case.view", {
        type: "company",
      });
      await authorizer.authorize(
        { userId: actor.userId },
        "perm.case.attachment.visibility.change",
        { type: "company" },
      );
      requireChangeable(actor, attachmentId, facts);
      const after = parseVisibilityBody(body);
      requireOpen(actor, attachmentId, facts);
      const result = { id: attachmentId, publicationVisibility: after };
      if (facts.publicationVisibility === after) return result;
      try {
        await repository.changeVisibility({
          attachmentId,
          actorId: actor.userId,
          caseId: facts.caseId,
          before: facts.publicationVisibility,
          after,
          traceId: actor.traceId,
        });
      } catch (error) {
        if (!(error instanceof AttachmentStateChangedError)) throw error;
        const reread = await readVisibilityFacts(actor, attachmentId);
        requireChangeable(actor, attachmentId, reread);
        requireOpen(actor, attachmentId, reread);
        if (reread.publicationVisibility === after) return result;
        denyVisibility(actor, attachmentId, "state_changed");
      }
      return result;
    },
  };
}
