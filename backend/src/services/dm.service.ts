// Service：DM（1対1の会話。#136）の業務ルール。HTTP も DB のライブラリも知らない。
// 判定の順（この順を変えない）：
//   開始：perm.dm.message.send → 自分宛て（422）→ 相手なし（404）→ 無効な相手（422）→ 既存を返す／作る
//   一覧：perm.dm.message.view
//   詳細：当事者か（違えば 404。存在しない・チャンネルの部屋と区別しない）→ perm.dm.message.view（403）
//   ※ 形の検証（422）は Controller が先に行う。
// 同じ2人の DM が同時に作られた場合は、一意制約の違反を受けて読み直し、先に作られた部屋を返す。
import {
  withConversations,
  DirectConversationExistsError,
  type ConversationRepository,
} from "../db/conversation.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import type { CursorPayload } from "../lib/cursor";
import { directKeyOf } from "../lib/dm-rules";
import { createLogger } from "../lib/logger/logger";
import { newUlid } from "../lib/ulid";
import { createAppAuthorizer } from "./authorizer";

export type DmActor = { userId: string; traceId: string };

type Dependencies = {
  authorizer: Pick<ReturnType<typeof createAppAuthorizer>, "authorize">;
};

export function withDmService<T>(
  env: Env,
  actor: DmActor,
  run: (service: ReturnType<typeof createDmService>) => Promise<T>,
): Promise<T> {
  return withConversations(env, (repository) =>
    withRoleAssignments(env, (roles) =>
      run(
        createDmService(repository, {
          authorizer: createAppAuthorizer(roles, {
            logger: createLogger({
              traceId: actor.traceId,
              userId: actor.userId,
            }),
          }),
        }),
      ),
    ),
  );
}

export function createDmService(
  repository: ConversationRepository,
  { authorizer }: Dependencies,
) {
  const company = { type: "company" } as const;

  return {
    async start(actor: DmActor, partnerUserId: string) {
      await authorizer.authorize(
        { userId: actor.userId },
        "perm.dm.message.send",
        company,
      );
      if (partnerUserId === actor.userId)
        throw new AppError("VALIDATION_ERROR", "自分自身には DM を送れません", {
          fields: ["partnerUserId"],
        });
      const partner = await repository.findPartnerCandidate(partnerUserId);
      if (partner === null)
        throw new AppError("NOT_FOUND", "社員が見つかりません");
      if (!partner.isActive)
        throw new AppError(
          "VALIDATION_ERROR",
          "無効な社員には DM を送れません",
          { fields: ["partnerUserId"] },
        );
      const directKey = directKeyOf(actor.userId, partner.id);
      const result = {
        partner: { id: partner.id, displayName: partner.displayName },
      };
      const existing = await repository.findRoomIdByDirectKey(directKey);
      if (existing !== null) return { roomId: existing, ...result };
      const roomId = newUlid();
      try {
        await repository.create({
          roomId,
          directKey,
          userIds: [actor.userId, partner.id],
        });
      } catch (error) {
        if (!(error instanceof DirectConversationExistsError)) throw error;
        // 確認から作成までの間に、別の要求が同じ2人の DM を作った。読み直せなければ、想定外としてそのまま伝える
        const created = await repository.findRoomIdByDirectKey(directKey);
        if (created === null) throw error;
        return { roomId: created, ...result };
      }
      return { roomId, ...result };
    },

    async list(
      actor: DmActor,
      query: { limit: number; cursor?: CursorPayload },
    ) {
      await authorizer.authorize(
        { userId: actor.userId },
        "perm.dm.message.view",
        company,
      );
      const page = await repository.listForUser(actor.userId, query);
      return {
        items: page.items.map(({ partner, ...item }) => ({
          ...item,
          partner: {
            ...partner,
            // 無効な社員のステータスは、古い値を見せない
            status: partner.isActive ? partner.status : null,
          },
        })),
        nextCursor: page.nextCursor,
      };
    },

    async get(actor: DmActor, roomId: string) {
      const detail = await repository.findForMember(roomId, actor.userId);
      if (detail === null)
        throw new AppError("NOT_FOUND", "DM が見つかりません");
      await authorizer.authorize(
        { userId: actor.userId },
        "perm.dm.message.view",
        company,
      );
      const { partner } = detail;
      return {
        roomId: detail.roomId,
        partner: {
          ...partner,
          status: partner.isActive ? partner.status : null,
        },
        canPost: partner.isActive,
      };
    },
  };
}
