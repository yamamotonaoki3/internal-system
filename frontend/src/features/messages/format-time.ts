// メッセージの日時の表示（ja-JP の短い形式）。投稿・スレッド一覧で同じ形にそろえる。
export function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
