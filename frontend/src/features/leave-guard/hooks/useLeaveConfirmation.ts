// ログアウトなど、画面の切り替え以外の「離れる操作」の前に確認を出すための入口。提供元がなければ null（確認なしで進む）。
import { useContext } from "react";
import { LeaveGuardContext } from "../leave-guard-context";

export function useLeaveConfirmation() {
  const context = useContext(LeaveGuardContext);
  if (context === null) return null;
  return {
    hasChanges: context.hasChanges,
    confirmLeave: context.confirmLeave,
  };
}
