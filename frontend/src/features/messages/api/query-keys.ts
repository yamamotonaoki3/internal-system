// メッセージのサーバーの状態のキー。部屋ごとに1つ（別の部屋へ移ったときに混ざらない）。
export const messageKeys = {
  room: (roomId: string) => ["messages", "room", roomId] as const,
};
