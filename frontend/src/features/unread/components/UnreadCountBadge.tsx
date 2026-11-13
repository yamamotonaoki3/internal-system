// 未読の件数の印。1件以上のときだけ出す（0・取得前・取得失敗は何も出さない。誤った件数を出さない）。
// 色だけに頼らず、件数の文字を出す（非機能要件 6・C-80）。見える印は読み上げず、読み上げ用の文を別に持つ。
import {
  UNREAD_COUNT_DISPLAY_MAX,
  formatUnreadCount,
} from "../../../../../shared/unread-rules";

export function UnreadCountBadge({ count }: { count: number | undefined }) {
  if (count === undefined || count < 1) return null;
  const spoken =
    count > UNREAD_COUNT_DISPLAY_MAX
      ? `未読 ${UNREAD_COUNT_DISPLAY_MAX}件以上`
      : `未読 ${count}件`;
  return (
    <>
      <span
        aria-hidden="true"
        className="ml-2 rounded-md bg-danger px-1 text-xs font-bold text-on-primary"
      >
        {formatUnreadCount(count)}
      </span>
      <span className="sr-only">{spoken}</span>
    </>
  );
}
