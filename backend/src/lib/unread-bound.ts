// 未読を数える下限（この ID より大きいメッセージだけを数える）を作る（#237。C-169 (2)）。
// 下限 = 既読位置（なければ空文字）と、参加の時刻の ULID の時刻部分（10文字）の、文字列として大きい方。
// 時刻部分の10文字は、同じ時刻のどの26文字の ID よりも小さい。そのため、参加と同じミリ秒の投稿は数える側に入る（数え漏れより1件多く数える側に倒す）。
// created_at ではなく ID の範囲で比べるのは、messages_room_id_id_idx の範囲検索で、参加の前の履歴を読まずに済ませるため。
import { MAX_TIME, ulidTimePrefix } from "./ulid";

export function unreadLowerBound(input: {
  lastReadMessageId: string | null;
  joinedAt: string | null;
}): string {
  const lastRead = input.lastReadMessageId ?? "";
  if (input.joinedAt === null) return lastRead;
  const joinedMs = Date.parse(input.joinedAt);
  // 読めない・ULID の時刻の範囲外の値は、参加の下限を付けない（未読を隠さない側に倒す）
  if (!Number.isInteger(joinedMs) || joinedMs < 0 || joinedMs > MAX_TIME)
    return lastRead;
  const joinedPrefix = ulidTimePrefix(joinedMs);
  return joinedPrefix > lastRead ? joinedPrefix : lastRead;
}
