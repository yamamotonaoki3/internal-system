// 未読の件数の取得に失敗している間の表示。件数は出さず、失敗していることを伝える（成功したら呼び出し側が消す）。
export const UNREAD_COUNTS_ERROR_MESSAGE =
  "未読の件数を取得できません。しばらくすると自動で取り直します";

export function UnreadCountsError() {
  return (
    <p role="status" className="px-3 text-sm text-danger">
      {UNREAD_COUNTS_ERROR_MESSAGE}
    </p>
  );
}
