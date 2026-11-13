// ログアウトの失敗の案内（共通レイアウトの、ヘッダーの直下）。
// 確認ダイアログ（showModal）でアバターメニュー（popover）が閉じると、メニューの中の表示が見えなくなるため、メニューの外にも出す。
// 直近のログアウトが失敗の間は、別の画面へ移っても、再読み込みか次のログアウトまで出し続ける。
import { useMutationState } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Alert } from "../../../components/Alert";
import { authKeys } from "../api/query-keys";
import { shouldFocusLogoutFailure } from "./logout-failure-focus";
import { LOGOUT_FAILED_MESSAGE } from "./logout-failed-message";

export function LogoutFailureNotice() {
  const latest = useMutationState({
    filters: { mutationKey: authKeys.logout },
    select: (mutation) => ({
      status: mutation.state.status,
      submittedAt: mutation.state.submittedAt,
    }),
  }).at(-1);
  const failed = latest?.status === "error";
  const submittedAt = latest?.submittedAt;
  const ref = useRef<HTMLDivElement>(null);
  // マウントした時点で出ている失敗では、フォーカスを奪わない
  const handled = useRef(failed ? submittedAt : undefined);

  useEffect(() => {
    const element = ref.current;
    if (!failed || element === null || submittedAt === handled.current) return;
    handled.current = submittedAt;
    const isVisible =
      "checkVisibility" in element
        ? (target: Element) => target.checkVisibility()
        : undefined;
    if (shouldFocusLogoutFailure(document.activeElement, isVisible))
      element.focus();
    else element.scrollIntoView({ block: "nearest" });
  }, [failed, submittedAt]);

  if (!failed) return null;
  return (
    <div ref={ref} role="alert" tabIndex={-1}>
      <Alert tone="error">{LOGOUT_FAILED_MESSAGE}</Alert>
    </div>
  );
}
