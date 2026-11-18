// Service：チャンネルの管理（#143。名前・説明の変更 EP-2-36、アーカイブ EP-2-37、復元 EP-2-38）の業務ルール。HTTP も DB のライブラリも知らない。
// 判定の順（この順を変えない）：
//   名前・説明：行がない・アーカイブ済み → 404 → 見えない かつ 管理できない（can）→ 404 → authorize → 403
//              → 案件 → 409、名前を送り通常のチャンネルでない → 409 → 版の不一致 → 409 → 書き込み
//   アーカイブ：行がない → 404 → 見えない かつ 管理できない → 404 → authorize → 403 → 再認証 → 403 REAUTH_REQUIRED
//              → アーカイブできない種類 → 409 → すでにアーカイブ済み → 409 → 版の不一致 → 409 → 書き込み
//   復元：アーカイブと同じ順。状態は「アーカイブされていない」→ 409
// 再認証を権限の後に置くのは、権限のない人に再認証を求めないため。種類・状態の 409 を権限と再認証の後に置くのは、範囲外の人に漏らさないため。
// 見えないチャンネルの 404 は拒否の監査に残さない（can で判定する）。監査に残る拒否は authorize の 403 だけ。
// 書き込みが0行・前提の確認の失敗の後は、操作者が有効か（401）→ 同じ順で読み直す（再認証はやり直さない）。
//   アーカイブ・復元で、どれにも当たらない（版は同じで宛先だけが変わった）なら、宛先を読み直して同じ版で1回だけやり直す。
//   それ以外でどれにも当たらなければ例外（成功にしない）。
import { CHANNEL_NAME_TAKEN_MESSAGE } from "../../../shared/channel-name-rules";
import {
  ChannelManageConflictError,
  ChannelNameTakenError,
  withChannels,
  type ChannelArchived,
  type ChannelManageRow,
  type ChannelRepository,
  type ChannelRestored,
  type ChannelUpdated,
} from "../db/channel.repository";
import {
  withRoleAssignments,
  type RoleAssignmentRepository,
} from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import {
  canViewChannel,
  channelManageActions,
  channelScopeOf,
} from "../lib/channel-rules";
import { createLogger } from "../lib/logger/logger";
import type { Permission } from "../lib/permissions";
import { newUlid } from "../lib/ulid";
import { createAppAuthorizer } from "./authorizer";
import { assertRecentReauth } from "./credentials.service";

export type ChannelManageActor = { userId: string; traceId: string };

/** アーカイブ・復元は再認証が必要（2-6 AC-6） */
export type ChannelManageReauthActor = ChannelManageActor & {
  reauthenticatedAt: string | null;
};

type Authorizer = Pick<
  ReturnType<typeof createAppAuthorizer>,
  "can" | "authorize"
>;

type ChannelManageDependencies = {
  /** 権限の判定。省略時は roles から操作者ごとに組む */
  authorizer?: Authorizer;
  roles?: RoleAssignmentRepository;
};

type Operation = "update" | "archive" | "restore";

const NOT_FOUND_MESSAGE = "チャンネルが見つかりません";
const ALREADY_PROCESSED_MESSAGE = "この項目はすでに処理されています";
const VERSION_MISMATCH_MESSAGE =
  "ほかの人が先に変更しました。読み込み直してください";
/** 宛先の読み直しで1回やり直しても前提が崩れたときの文言（案件の終了・再開も同じ文言を使う） */
export const RETRY_CONFLICT_MESSAGE =
  "ほかの操作と重なりました。もう一度お試しください";
const CASE_CHANNEL_MESSAGE = "案件専用のチャンネルは、ここでは変更できません";
const RENAME_NOT_ALLOWED_MESSAGE = "このチャンネルの名前は変更できません";
const ARCHIVE_NOT_ALLOWED_MESSAGE = "このチャンネルはアーカイブできません";
const RESTORE_NOT_ALLOWED_MESSAGE = "このチャンネルは復元できません";

export function withChannelManageService<T>(
  env: Env,
  run: (service: ReturnType<typeof createChannelManageService>) => Promise<T>,
): Promise<T> {
  return withChannels(env, (repository) =>
    withRoleAssignments(env, (roles) =>
      run(createChannelManageService(repository, { roles })),
    ),
  );
}

export function createChannelManageService(
  repository: ChannelRepository,
  deps: ChannelManageDependencies,
) {
  function authorizerFor(actor: ChannelManageActor): Authorizer {
    if (deps.authorizer !== undefined) return deps.authorizer;
    if (deps.roles === undefined)
      throw new Error("権限の判定に必要な Repository が渡されていません");
    return createAppAuthorizer(deps.roles, {
      logger: createLogger({ traceId: actor.traceId, userId: actor.userId }),
    });
  }

  function permissionOf(operation: Operation): Permission {
    return operation === "update" ? "perm.channel.edit" : "perm.channel.delete";
  }

  /** 種類・状態の 409（権限と再認証の後） */
  function assertState(
    operation: Operation,
    channel: ChannelManageRow,
    renaming: boolean,
  ): void {
    const actions = channelManageActions(channel);
    if (operation === "update") {
      if (channel.purpose === "case")
        throw new AppError("CONFLICT", CASE_CHANNEL_MESSAGE);
      if (renaming && !actions.rename)
        throw new AppError("CONFLICT", RENAME_NOT_ALLOWED_MESSAGE);
      return;
    }
    if (channel.purpose !== "normal")
      throw new AppError(
        "CONFLICT",
        operation === "archive"
          ? ARCHIVE_NOT_ALLOWED_MESSAGE
          : RESTORE_NOT_ALLOWED_MESSAGE,
      );
    if (operation === "archive" ? !actions.archive : !actions.restore)
      throw new AppError("CONFLICT", ALREADY_PROCESSED_MESSAGE);
  }

  /**
   * 判定の順のとおりに確かめ、通れば読んだ行を返す。
   * 最初の判定では beforeState で再認証を確かめ、書き込みの後の読み直しでは渡さない。
   */
  async function assertCanManage(
    actor: ChannelManageActor,
    roomId: string,
    request: { operation: Operation; version: number; renaming: boolean },
    beforeState?: () => void,
  ): Promise<ChannelManageRow> {
    const channel = await repository.findForManage(roomId, actor.userId);
    // 名前・説明の変更は、アーカイブ済みを管理できる人にも 404（EP-2-36）
    if (
      channel === null ||
      (request.operation === "update" && channel.deletedAt !== null)
    )
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    const authorizer = authorizerFor(actor);
    const permission = permissionOf(request.operation);
    const scope = channelScopeOf(channel);
    // 見えないチャンネルは、管理できる人にだけ次へ進める（範囲外の人には存在を伝えず、拒否の監査にも残さない）
    if (
      !canViewChannel(channel, channel.isMember) &&
      !(await authorizer.can({ userId: actor.userId }, permission, scope))
    )
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    await authorizer.authorize({ userId: actor.userId }, permission, scope);
    beforeState?.();
    assertState(request.operation, channel, request.renaming);
    if (channel.version !== request.version)
      throw new AppError("CONFLICT", VERSION_MISMATCH_MESSAGE);
    return channel;
  }

  /** 書き込みの後の読み直し：操作者が有効か（401）→ 判定の順。理由に当たれば、その応答を投げる */
  async function reassert(
    actor: ChannelManageActor,
    roomId: string,
    request: { operation: Operation; version: number; renaming: boolean },
  ): Promise<void> {
    if (!(await repository.isUserActive(actor.userId)))
      throw new AppError("UNAUTHENTICATED", "ログインしてください");
    await assertCanManage(actor, roomId, request);
  }

  /**
   * アーカイブ・復元の書き込み。前提の確認の失敗で、読み直してもどれにも当たらなければ、宛先を読み直して1回だけやり直す。
   * 0行（行が消えた）でどれにも当たらなければ例外にする。
   */
  async function writeWithRecipients<R>(
    actor: ChannelManageActor,
    roomId: string,
    request: { operation: Operation; version: number; renaming: boolean },
    write: (recipientIds: string[]) => Promise<R | null>,
  ): Promise<R> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const recipientIds = await repository.listNotifyRecipients(
        roomId,
        actor.userId,
      );
      let result: R | null;
      try {
        result = await write(recipientIds);
      } catch (error) {
        if (!(error instanceof ChannelManageConflictError)) throw error;
        await reassert(actor, roomId, request);
        continue;
      }
      if (result !== null) return result;
      await reassert(actor, roomId, request);
      throw new Error(
        `チャンネルの${request.operation}の書き込みが0行になった原因を特定できません`,
      );
    }
    throw new AppError("CONFLICT", RETRY_CONFLICT_MESSAGE);
  }

  return {
    async update(
      actor: ChannelManageActor,
      roomId: string,
      input: { version: number; name?: string; description?: string },
    ): Promise<ChannelUpdated> {
      const request = {
        operation: "update" as const,
        version: input.version,
        renaming: input.name !== undefined,
      };
      await assertCanManage(actor, roomId, request);
      let updated: ChannelUpdated | null;
      try {
        updated = await repository.update({
          roomId,
          actorId: actor.userId,
          version: input.version,
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          traceId: actor.traceId,
        });
      } catch (error) {
        if (error instanceof ChannelNameTakenError)
          throw new AppError("CONFLICT", CHANNEL_NAME_TAKEN_MESSAGE);
        if (!(error instanceof ChannelManageConflictError)) throw error;
        updated = null;
      }
      if (updated !== null) return updated;
      await reassert(actor, roomId, request);
      throw new Error(
        "チャンネルの名前・説明の書き込みが0行になった原因を特定できません",
      );
    },

    async archive(
      actor: ChannelManageReauthActor,
      roomId: string,
      input: { version: number; reason: string | null },
    ): Promise<ChannelArchived> {
      const request = {
        operation: "archive" as const,
        version: input.version,
        renaming: false,
      };
      await assertCanManage(actor, roomId, request, () =>
        assertRecentReauth(actor.reauthenticatedAt),
      );
      return writeWithRecipients(actor, roomId, request, (recipientIds) =>
        repository.archive({
          roomId,
          actorId: actor.userId,
          version: input.version,
          reason: input.reason,
          eventId: newUlid(),
          recipientIds,
          traceId: actor.traceId,
        }),
      );
    },

    async restore(
      actor: ChannelManageReauthActor,
      roomId: string,
      input: { version: number },
    ): Promise<ChannelRestored> {
      const request = {
        operation: "restore" as const,
        version: input.version,
        renaming: false,
      };
      const channel = await assertCanManage(actor, roomId, request, () =>
        assertRecentReauth(actor.reauthenticatedAt),
      );
      const eventId = channel.openArchiveEventId;
      if (eventId === null)
        throw new Error(
          "アーカイブ中のチャンネルに、開いている記録がありません",
        );
      return writeWithRecipients(actor, roomId, request, (recipientIds) =>
        repository.restore({
          roomId,
          actorId: actor.userId,
          version: input.version,
          eventId,
          recipientIds,
          traceId: actor.traceId,
        }),
      );
    },
  };
}
