// メッセージのサーバーの状態のキー。部屋ごと・スレッドごとに1つ（別の部屋・スレッドへ移ったときに混ざらない）。
export const messageKeys = {
  room: (roomId: string) => ["messages", "room", roomId] as const,
  thread: (parentMessageId: string) =>
    ["messages", "thread", parentMessageId] as const,
};
