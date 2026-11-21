// メッセージのサーバーの状態のキー。部屋ごと・スレッドごとに1つ（別の部屋・スレッドへ移ったときに混ざらない）。
const mentionCandidatesOfRoom = (roomId: string) =>
  ["message-mention-candidates", roomId] as const;

export const messageKeys = {
  room: (roomId: string) => ["messages", "room", roomId] as const,
  thread: (parentMessageId: string) =>
    ["messages", "thread", parentMessageId] as const,
  /** メンションの候補（部屋の参加者の名前）。入力の文字ごとのキー */
  mentionCandidates: (roomId: string, query: string) =>
    [...mentionCandidatesOfRoom(roomId), query] as const,
  /** その部屋のすべてのメンションの候補（前方一致で使う） */
  roomMentionCandidates: (roomId: string) => mentionCandidatesOfRoom(roomId),
};
