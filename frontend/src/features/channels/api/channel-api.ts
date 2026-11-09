// API 層：チャンネルの一覧・詳細・参加の通信はここに書く。共通の apiClient（services/）を使う（C-46）。
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
