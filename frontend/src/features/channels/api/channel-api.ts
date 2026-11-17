// API 層：チャンネルの一覧・詳細・参加・招待・管理（名前・説明の変更、アーカイブ・復元。#143）の通信はここに書く。共通の apiClient（services/）を使う（C-46）。
import { z } from "zod";
import { apiClient } from "../../../services/api-client";

const channelItemSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  name: z.string(),
  visibility: z.enum(["public", "private"]),
  departmentId: z.string().nullable(),
  departmentName: z.string().nullable(),
  joined: z.boolean(),
});
const channelPageSchema = z.object({
  items: z.array(channelItemSchema),
  nextCursor: z.string().nullable(),
});
const channelDetailSchema = z
  .object({
    id: z.string().min(1),
    roomId: z.string().min(1),
    name: z.string(),
    description: z.string(),
    visibility: z.enum(["public", "private"]),
    departmentId: z.string().nullable(),
    joined: z.boolean(),
    isCaseChannel: z.boolean(),
    // このチャンネルに投稿できるか（参加者で、お知らせ専用なら権限がある）
    canPost: z.boolean(),
    // 部署が無効で、読み取り専用か。真のあいだは、自分の投稿の編集・削除もできない
    readOnly: z.boolean(),
    // 管理の操作（#143）が送る版
    version: z.number().int(),
    // 閲覧者に出してよい管理の操作（表示用。判定はサーバーが毎回行う）
    manage: z.object({
      canRename: z.boolean(),
      canEditDescription: z.boolean(),
      canArchive: z.boolean(),
    }),
    // 参加者にだけ返る
    memberCount: z.number().int().optional(),
    members: z
      .array(z.object({ id: z.string().min(1), displayName: z.string() }))
      .optional(),
  })
  // 参加済みなのに参加者の情報がない応答は、サーバーの不具合として検証エラーにする
  .refine(
    (detail) =>
      !detail.joined ||
      (detail.memberCount !== undefined && detail.members !== undefined),
    { message: "参加済みのチャンネルに参加者の情報がありません" },
  );
const joinedSchema = z.object({
  channelId: z.string().min(1),
  roomId: z.string().min(1),
  joinedAt: z.string(),
});

const invitedSchema = z.object({
  channelId: z.string().min(1),
  userId: z.string().min(1),
  joinedAt: z.string(),
});

const updatedSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  version: z.number().int(),
  updatedAt: z.string(),
});

const archivedSchema = z.object({
  id: z.string().min(1),
  version: z.number().int(),
  deletedAt: z.string(),
});

const restoredSchema = z.object({
  id: z.string().min(1),
  version: z.number().int(),
  restoredAt: z.string(),
});

export type ChannelItem = z.infer<typeof channelItemSchema>;
export type ChannelPage = z.infer<typeof channelPageSchema>;
export type ChannelDetail = z.infer<typeof channelDetailSchema>;

export type ChannelListFilter = {
  /** 空なら絞り込まない */
  departmentId?: string;
  /** true は参加中だけ */
  joined?: boolean;
};

export async function fetchChannels(
  filter: ChannelListFilter,
  cursor?: string,
): Promise<ChannelPage> {
  const response = await apiClient.get("/channels", {
    params: {
      cursor,
      departmentId: filter.departmentId || undefined,
      joined: filter.joined,
    },
  });
  return channelPageSchema.parse(response.data);
}

export async function fetchChannel(channelId: string): Promise<ChannelDetail> {
  const response = await apiClient.get(
    `/channels/${encodeURIComponent(channelId)}`,
  );
  return channelDetailSchema.parse(response.data);
}

export async function joinChannel(channelId: string) {
  const response = await apiClient.post(
    `/channels/${encodeURIComponent(channelId)}/join`,
  );
  return joinedSchema.parse(response.data);
}

export async function inviteToChannel(channelId: string, userId: string) {
  const response = await apiClient.post(
    `/channels/${encodeURIComponent(channelId)}/invitations`,
    { userId },
  );
  return invitedSchema.parse(response.data);
}

export type ChannelUpdateInput = {
  version: number;
  name?: string;
  description?: string;
};

/** 名前・説明の変更（EP-2-36）。送らない項目は変えない */
export async function updateChannel(
  channelId: string,
  input: ChannelUpdateInput,
) {
  const response = await apiClient.patch(
    `/channels/${encodeURIComponent(channelId)}`,
    input,
  );
  return updatedSchema.parse(response.data);
}

/** アーカイブ（EP-2-37）。理由は任意（空なら送らない） */
export async function archiveChannel(
  channelId: string,
  input: { version: number; reason?: string },
) {
  const response = await apiClient.post(
    `/channels/${encodeURIComponent(channelId)}/delete`,
    input,
  );
  return archivedSchema.parse(response.data);
}

/** 復元（EP-2-38） */
export async function restoreChannel(
  channelId: string,
  input: { version: number },
) {
  const response = await apiClient.post(
    `/channels/${encodeURIComponent(channelId)}/restore`,
    input,
  );
  return restoredSchema.parse(response.data);
}
