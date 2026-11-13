// API 層：未読の件数と既読の通信はここに書く。共通の apiClient（services/）を使う（C-46）。
import { z } from "zod";
import { UNREAD_COUNT_LIMIT } from "../../../../../shared/unread-rules";
import { apiClient } from "../../../services/api-client";

const unreadPageSchema = z.object({
  items: z.array(
    z.object({
      roomId: z.string().min(1),
      count: z.number().int().min(1).max(UNREAD_COUNT_LIMIT),
    }),
  ),
  nextCursor: z.string().nullable(),
});

/** 1ページに調べる部屋の最大数（API の limit の上限） */
const PAGE_LIMIT = 100;
/** 全ページの取得の上限。100部屋 × 20 = 2,000部屋まで。超えたら一部だけの件数を出さず、エラーにする */
const UNREAD_MAX_PAGES = 20;

/**
 * 未読の部屋と件数を、nextCursor が null になるまで続けて取り、部屋の ID で引ける対応表にする。
 * 1ページの items は limit より少なく、空でも nextCursor がありうる（対象の部屋を limit 件ずつ調べるため）。
 */
export async function fetchUnreadCounts(): Promise<
  ReadonlyMap<string, number>
> {
  const counts = new Map<string, number>();
  let cursor: string | undefined;
  for (let page = 0; page < UNREAD_MAX_PAGES; page += 1) {
    const response = await apiClient.get("/me/unread", {
      params: { limit: PAGE_LIMIT, cursor },
    });
    const parsed = unreadPageSchema.parse(response.data);
    for (const item of parsed.items) counts.set(item.roomId, item.count);
    if (parsed.nextCursor === null) return counts;
    cursor = parsed.nextCursor;
  }
  throw new Error("未読の件数のページが多すぎます");
}

/** 部屋の既読位置を、指定したメッセージまで進める（サーバーは後戻りさせない） */
export async function markRoomRead(
  roomId: string,
  lastReadMessageId: string,
): Promise<void> {
  await apiClient.put(`/rooms/${encodeURIComponent(roomId)}/read-position`, {
    lastReadMessageId,
  });
}
