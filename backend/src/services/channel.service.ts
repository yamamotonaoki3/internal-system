// Service：チャンネルの一覧・詳細・参加の業務ルール（#200）。HTTP も DB のライブラリも知らない。
// 認可は「ログイン済みの有効な社員」で足りる（セッションの層で無効な社員は 401）。見てよいかはチャンネルごとに判定する。
// 参加の判定の順（この順を変えない）：
//   ① 見えるか（見えなければ 404。非公開・アーカイブ済み・存在しないものを区別しない）
//   → ② 参加済みならそのまま 200（べき等。監査ログは書かない）
//   → ③ 参加できるか（できなければ 404）→ 参加する。
// 招待（#135）の判定の順（この順を変えない）：
//   閲覧可否（404）→ 招待者の参加（公開で未参加は 403。audit に記録）→ 権限 perm.channel.invite（403）→ 再認証（403 REAUTH_REQUIRED）
//   → チャンネルの状態（案件・部署が無効は 409）→ 相手の有効性（存在しない・無効は同じ 404）→ 参加済み（409）→ 書き込み。
//   書き込みが0行なら、招待者が有効か（401）→ 同じ順で読み直す（再認証はやり直さない）。どれにも当たらなければ例外（成功にしない）。
//   参加済みの判定を最後にするので、招待者が見えなくなった場合に相手の参加状態は漏れない。
import { canPostToChannel } from "../../../shared/message-rules";
import {
  withChannels,
  type ChannelInvitee,
  type ChannelListOptions,
  type ChannelMember,
  type ChannelRepository,
} from "../db/channel.repository";
import {
  withRoleAssignments,
  type RoleAssignmentRepository,
} from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import {
  MEMBERS_PREVIEW_LIMIT,
  canInviteToChannel,
  canJoinChannel,
  canViewChannel,
  type ChannelVisibility,
} from "../lib/channel-rules";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";
import { assertRecentReauth } from "./credentials.service";

export type ChannelActor = { userId: string; traceId: string };

/** 招待は再認証が必要（#135） */
export type ChannelInviteActor = ChannelActor & {
  reauthenticatedAt: string | null;
};

export type ChannelDetail = {
  id: string;
  roomId: string;
  name: string;
  description: string;
  visibility: ChannelVisibility;
  departmentId: string | null;
  joined: boolean;
  /** このチャンネルに投稿できるか（参加者で、お知らせ専用なら部署のオーナーか全体管理者）。EP-2-06 */
  canPost: boolean;
  /** チャンネルの部署が無効で読み取り専用か（C-143(1)）。投稿の権限とは別で、編集・削除のボタンの表示に使う */
  readOnly: boolean;
  /** 案件チャンネル（#134 以降）。今はつねに false */
  isCaseChannel: false;
  /** 参加者にだけ返す */
  memberCount?: number;
  members?: ChannelMember[];
};

export type ChannelJoined = {
  channelId: string;
  roomId: string;
  joinedAt: string;
};

export type ChannelInvited = {
  channelId: string;
  userId: string;
  joinedAt: string;
};

const NOT_FOUND_MESSAGE = "チャンネルが見つかりません";
// 相手が存在しない・無効を区別しない
const INVITEE_NOT_FOUND_MESSAGE = "社員が見つかりません";
const INVITE_FORBIDDEN_MESSAGE =
  "このチャンネルに参加していないため、招待できません";
const CASE_CHANNEL_MESSAGE = "案件専用のチャンネルには招待できません";
const DEPARTMENT_INACTIVE_MESSAGE =
  "部署が無効になっているため、招待できません";
const ALREADY_JOINED_MESSAGE = "この社員はすでにチャンネルに参加済みです";

export function withChannelService<T>(
  env: Env,
  run: (service: ReturnType<typeof createChannelService>) => Promise<T>,
): Promise<T> {
  return withChannels(env, (repository) =>
    withRoleAssignments(env, (roles) =>
      run(createChannelService(repository, roles)),
    ),
  );
}

// roles は詳細の canPost（お知らせ専用の権限）の判定に使う。canPost の判定は `can` で行い、拒否を監査に記録しない（記録するのは投稿APIだけ）
type ChannelServiceDependencies = {
  /** 招待の権限（perm.channel.invite）の判定。省略時は roles から操作者ごとに組む */
  authorizer?: Pick<ReturnType<typeof createAppAuthorizer>, "authorize">;
};

export function createChannelService(
  repository: ChannelRepository,
  roles?: RoleAssignmentRepository,
  deps: ChannelServiceDependencies = {},
) {
  // 拒否は authorize が logger.audit に記録し、FORBIDDEN を投げる
  async function authorizeInvite(actor: ChannelActor): Promise<void> {
    if (deps.authorizer !== undefined)
      return deps.authorizer.authorize(
        { userId: actor.userId },
        "perm.channel.invite",
        { type: "company" },
      );
    if (roles === undefined)
      throw new Error("権限の判定に必要な Repository が渡されていません");
    return createAppAuthorizer(roles, {
      logger: createLogger({ traceId: actor.traceId, userId: actor.userId }),
    }).authorize({ userId: actor.userId }, "perm.channel.invite", {
      type: "company",
    });
  }

  async function canPostAnnouncement(
    actor: ChannelActor,
    departmentId: string | null,
  ): Promise<boolean> {
    // お知らせ専用は部署に属する（DBの CHECK）。部署がなければ権限の範囲を決められないため、投稿できない
    if (departmentId === null) return false;
    if (roles === undefined)
      throw new Error("権限の判定に必要な Repository が渡されていません");
    return createAppAuthorizer(roles, {
      logger: createLogger({ traceId: actor.traceId, userId: actor.userId }),
    }).can({ userId: actor.userId }, "perm.announcement.post", {
      type: "department",
      departmentId,
    });
  }

  // 見えるチャンネルだけを返す。見えないものは、理由を区別せず 404 にする
  async function requireVisible(roomId: string, actor: ChannelActor) {
    const channel = await repository.findForViewer(roomId, actor.userId);
    if (channel === null || !canViewChannel(channel, channel.joinedAt !== null))
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    return channel;
  }

  /**
   * 招待の判定（閲覧可否 → 招待の権限 →（beforeState）→ チャンネルの状態）。
   * 最初の判定では beforeState で再認証を確かめ、0行の後の読み直しでは渡さない。
   */
  async function assertCanInvite(
    actor: ChannelActor,
    roomId: string,
    beforeState?: () => void,
  ): Promise<void> {
    const channel = await repository.findForViewer(roomId, actor.userId);
    const decision =
      channel === null
        ? "not_found"
        : canInviteToChannel(channel, channel.joinedAt !== null);
    if (decision === "not_found")
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (decision === "not_member") {
      createLogger({ traceId: actor.traceId, userId: actor.userId }).audit(
        "channel.invite",
        roomId,
        "failure",
        { reason: "not_member" },
      );
      throw new AppError("FORBIDDEN", INVITE_FORBIDDEN_MESSAGE);
    }
    // 権限は見えるチャンネルの参加者についてだけ確かめる（見えないチャンネルを拒否の監査に残さない）
    await authorizeInvite(actor);
    beforeState?.();
    if (decision === "case_channel")
      throw new AppError("CONFLICT", CASE_CHANNEL_MESSAGE);
    if (decision === "department_inactive")
      throw new AppError("CONFLICT", DEPARTMENT_INACTIVE_MESSAGE);
  }

  /** 相手の有効性（404）→ 参加済み（409） */
  function assertInvitee(invitee: ChannelInvitee | null): void {
    if (invitee === null || !invitee.isActive)
      throw new AppError("NOT_FOUND", INVITEE_NOT_FOUND_MESSAGE);
    if (invitee.joined) throw new AppError("CONFLICT", ALREADY_JOINED_MESSAGE);
  }

  return {
    async list(actor: ChannelActor, options: ChannelListOptions) {
      if (
        options.departmentId !== undefined &&
        !(await repository.departmentExists(options.departmentId))
      )
        throw new AppError("NOT_FOUND", "部署が見つかりません");
      return repository.list(actor.userId, options);
    },
    async get(actor: ChannelActor, roomId: string): Promise<ChannelDetail> {
      const channel = await requireVisible(roomId, actor);
      const base = {
        id: channel.roomId,
        roomId: channel.roomId,
        name: channel.name,
        description: channel.description,
        visibility: channel.visibility,
        departmentId: channel.departmentId,
        isCaseChannel: false,
        readOnly: !channel.departmentIsActive,
      } as const;
      if (channel.joinedAt === null)
        return { ...base, joined: false, canPost: false };
      const [memberCount, members, canPostByRole] = await Promise.all([
        repository.countMembers(roomId),
        repository.listMembers(roomId, MEMBERS_PREVIEW_LIMIT),
        channel.purpose === "announcement"
          ? canPostAnnouncement(actor, channel.departmentId)
          : Promise.resolve(false),
      ]);
      const canPost = canPostToChannel({
        purpose: channel.purpose,
        isMember: true,
        canPostAnnouncement: canPostByRole,
      });
      return { ...base, joined: true, canPost, memberCount, members };
    },
    async join(actor: ChannelActor, roomId: string): Promise<ChannelJoined> {
      const channel = await requireVisible(roomId, actor);
      if (channel.joinedAt !== null)
        return { channelId: roomId, roomId, joinedAt: channel.joinedAt };
      if (!canJoinChannel(channel))
        throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
      const joinedAt = await repository.join({
        roomId,
        userId: actor.userId,
        traceId: actor.traceId,
      });
      if (joinedAt !== null) return { channelId: roomId, roomId, joinedAt };
      // 確認の後に本人が無効化されたときは 401、アーカイブ・非公開化されたときは 404（参加の行は作られない）
      if (!(await repository.isUserActive(actor.userId)))
        throw new AppError("UNAUTHENTICATED", "ログインしてください");
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    },
    async invite(
      actor: ChannelInviteActor,
      roomId: string,
      inviteeId: string,
    ): Promise<ChannelInvited> {
      await assertCanInvite(actor, roomId, () =>
        assertRecentReauth(actor.reauthenticatedAt),
      );
      assertInvitee(await repository.findInvitee(roomId, inviteeId));
      const joinedAt = await repository.invite({
        roomId,
        inviterId: actor.userId,
        inviteeId,
        traceId: actor.traceId,
      });
      if (joinedAt !== null)
        return { channelId: roomId, userId: inviteeId, joinedAt };
      // 確認から書き込みまでの間に状態が変わった。招待者が無効ならセッションの層と同じ 401（チャンネルの状態を伝えない）
      if (!(await repository.isUserActive(actor.userId)))
        throw new AppError("UNAUTHENTICATED", "ログインしてください");
      await assertCanInvite(actor, roomId);
      assertInvitee(await repository.findInvitee(roomId, inviteeId));
      throw new Error("招待の書き込みが0行になった原因を特定できません");
    },
  };
}
