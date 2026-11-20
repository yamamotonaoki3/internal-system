// 検索（#155・S-15）のサーバーの状態のキー。利用者の ID を含める（ログインし直した別の利用者に、前の利用者の結果を見せないため。ADR-0030）。
// 資格を失ったときは、どの部屋の抜粋が入っているかをキーから決められないため、その利用者の検索の結果を全部取り除く（user の前方一致）。
export type MessageSearchConditions = {
  q: string;
  roomId?: string;
  from?: string;
  to?: string;
};

export const searchKeys = {
  user: (userId: string) => ["search", userId] as const,
  /** pageCount は1ページ目から取るページ数（「さらに表示」で増える） */
  messages: (
    userId: string,
    conditions: MessageSearchConditions,
    pageCount: number,
  ) => ["search", userId, "messages", conditions, pageCount] as const,
};
