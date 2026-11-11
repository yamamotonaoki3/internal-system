// API 層：通知の一覧・未読数・既読の通信はここに書く。共通の apiClient（services/）を使う（C-46）。
import { z } from "zod";
import { apiClient } from "../../../services/api-client";

const notificationItemSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  roomId: z.string().nullable(),
  messageId: z.string().nullable(),
  targetId: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
const notificationPageSchema = z.object({
  items: z.array(notificationItemSchema),
  nextCursor: z.string().nullable(),
});
const unreadCountSchema = z.object({ count: z.number().int().min(0) });

export type NotificationItem = z.infer<typeof notificationItemSchema>;
export type NotificationPage = z.infer<typeof notificationPageSchema>;

export async function fetchNotifications(
  cursor?: string,
): Promise<NotificationPage> {
  const response = await apiClient.get("/me/notifications", {
    params: { cursor },
  });
  return notificationPageSchema.parse(response.data);
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const response = await apiClient.get("/me/notifications/unread-count");
  return unreadCountSchema.parse(response.data).count;
}

export async function markNotificationRead(
  notificationId: string,
): Promise<void> {
  await apiClient.post(
    `/me/notifications/${encodeURIComponent(notificationId)}/read`,
  );
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.post("/me/notifications/read-all");
}
