// 既存の一覧と新着を、IDで重複を除いて、ID昇順に並べる。取りこぼし・重複の防止の土台（引数は書き換えない）。
import type { RoomMessage } from "./api/message-api";

export function mergeMessages(
  current: readonly RoomMessage[],
  incoming: readonly RoomMessage[],
): RoomMessage[] {
  const byId = new Map<string, RoomMessage>();
  for (const message of [...current, ...incoming])
    byId.set(message.id, message);
  return [...byId.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}
