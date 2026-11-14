// 「（退職者）」を併記する投稿者か。サーバーの isActive に加えて、画面の文脈（DM の相手など）で渡された利用者ID。
import type { RoomMessage } from "./api/message-api";

export function isRetiredAuthor(
  author: RoomMessage["author"],
  retiredAuthorIds: readonly string[],
): boolean {
  return !author.isActive || retiredAuthorIds.includes(author.id);
}
