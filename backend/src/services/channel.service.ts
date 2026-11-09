// Service：チャンネルの一覧・詳細・参加の業務ルール（#200）。HTTP も DB のライブラリも知らない。
// 認可は「ログイン済みの有効な社員」で足りる（セッションの層で無効な社員は 401）。見てよいかはチャンネルごとに判定する。
// 参加の判定の順（この順を変えない）：
//   ① 見えるか（見えなければ 404。非公開・アーカイブ済み・存在しないものを区別しない）
//   → ② 参加済みならそのまま 200（べき等。監査ログは書かない）
//   → ③ 参加できるか（できなければ 404）→ 参加する。
import { canPostToChannel } from "../../../shared/message-rules";
import {
  withChannels,
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
  canJoinChannel,
  canViewChannel,
  type ChannelVisibility,
} from "../lib/channel-rules";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";

export type ChannelActor = { userId: string; traceId: string };

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

const NOT_FOUND_MESSAGE = "チャンネルが見つかりません";

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
export function createChannelService(
  repository: ChannelRepository,
  roles?: RoleAssignmentRepository,
) {
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
      // 確認の後にアーカイブ・非公開化されたときは、参加の行が作られない
      if (joinedAt === null) throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
      return { channelId: roomId, roomId, joinedAt };
    },
  };
}
