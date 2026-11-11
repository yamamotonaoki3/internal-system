// ヘッダーの通知（C-65）。押すと通知の一覧（S-14）へ直接移る。未読が 1 件以上なら件数の印を出す（99 を超えたら「99+」）。
// 件数は読み上げ用の名前（aria-label）にも含める。取得に失敗している間は、誤った件数を出さない。
import { Link } from "react-router";
import { useUnreadNotificationCount } from "./hooks/useUnreadNotificationCount";

const BADGE_MAX = 99;

export function NotificationBell() {
  const unread = useUnreadNotificationCount();
  const count = unread.isError ? 0 : (unread.data ?? 0);
  const badge = count > BADGE_MAX ? `${BADGE_MAX}+` : String(count);
  return (
    <Link
      to="/notifications"
      aria-label={
        count > 0
          ? `通知（未読 ${count > BADGE_MAX ? `${BADGE_MAX}件以上` : `${count}件`}）`
          : "通知"
      }
      className="inline-flex min-h-11 items-center gap-1 rounded-md px-3 font-bold text-text hover:bg-bg md:min-h-10"
    >
      <span aria-hidden="true">通知</span>
      {count > 0 && (
        <span
          aria-hidden="true"
          className="rounded-md bg-danger px-1 text-xs text-on-primary"
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
