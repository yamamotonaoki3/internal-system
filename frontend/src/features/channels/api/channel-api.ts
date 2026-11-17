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

// #143-b：S-39（チャンネル管理）と S-38（アーカイブ）。管理者用の読み取り（EP-2-42・EP-2-43・EP-2-40）
const adminDepartmentSchema = z
  .object({ id: z.string().min(1), name: z.string(), isActive: z.boolean() })
  .nullable();
const personSchema = z.object({
  id: z.string().min(1),
  displayName: z.string(),
});

const adminChannelSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  purpose: z.enum(["normal", "department", "announcement", "company_general"]),
  visibility: z.enum(["public", "private"]),
  department: adminDepartmentSchema,
  state: z.enum(["active", "archived"]),
  version: z.number().int(),
  memberCount: z.number().int(),
  archive: z
    .object({
      archivedBy: personSchema,
      archivedAt: z.string(),
      reason: z.string().nullable(),
    })
    .nullable(),
  manage: z.object({
    canRename: z.boolean(),
    canEditDescription: z.boolean(),
    canArchive: z.boolean(),
    canRestore: z.boolean(),
  }),
});
const adminChannelPageSchema = z.object({
  items: z.array(adminChannelSchema),
  nextCursor: z.string().nullable(),
});

const archivedChannelSchema = z.object({
  type: z.literal("channel"),
  id: z.string().min(1),
  name: z.string(),
  caseNumber: z.null(),
  deletedBy: personSchema,
  deletedAt: z.string(),
  reason: z.string().nullable(),
  version: z.number().int(),
  department: adminDepartmentSchema,
  canRestore: z.boolean(),
});
const archivedChannelPageSchema = z.object({
  items: z.array(archivedChannelSchema),
  nextCursor: z.string().nullable(),
});

export type AdminChannel = z.infer<typeof adminChannelSchema>;
export type AdminChannelPage = z.infer<typeof adminChannelPageSchema>;
export type ArchivedChannel = z.infer<typeof archivedChannelSchema>;
export type ArchivedChannelPage = z.infer<typeof archivedChannelPageSchema>;

export type AdminChannelState = "all" | "active" | "archived";

export type AdminChannelFilter = {
  /** 名前の部分一致。空なら絞り込まない */
  q?: string;
  state: AdminChannelState;
};

/** S-39 の一覧（EP-2-42） */
export async function fetchAdminChannels(
  filter: AdminChannelFilter,
  cursor?: string,
): Promise<AdminChannelPage> {
  const response = await apiClient.get("/admin/channels", {
    params: { q: filter.q || undefined, state: filter.state, cursor },
  });
  return adminChannelPageSchema.parse(response.data);
}

/** S-39 の1件（EP-2-43。編集の「最新の内容を読み込む」。参加していない非公開も読める） */
export async function fetchAdminChannel(
  channelId: string,
): Promise<AdminChannel> {
  const response = await apiClient.get(
    `/admin/channels/${encodeURIComponent(channelId)}`,
  );
  return adminChannelSchema.parse(response.data);
}

/** S-38 のアーカイブしたチャンネル（EP-2-40） */
export async function fetchArchivedChannels(
  cursor?: string,
): Promise<ArchivedChannelPage> {
  const response = await apiClient.get("/admin/deleted-items", {
    params: { type: "channel", cursor },
  });
  return archivedChannelPageSchema.parse(response.data);
}
