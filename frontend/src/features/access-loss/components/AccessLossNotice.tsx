// 読み込み直した後の知らせ（#338 AC-5）。共通レイアウトの、ログアウトの失敗の案内の直後に置く。
// 出す・捨てるの判定は access-loss-notice.ts が持ち、ここは表示と「閉じる」だけ。
import { useSyncExternalStore } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import {
  dismissAccessLossNotice,
  getShownAccessLossNotice,
  subscribeAccessLossNotice,
  type AccessLossNoticeKind,
} from "../access-loss-notice";

const NOTICE_TEXTS = {
  lost: "この案件を表示できなくなったため、画面を読み込み直しました。保存していない入力は消えています。",
  left: "案件から退出しました。",
} as const satisfies Record<AccessLossNoticeKind, string>;

export function AccessLossNotice() {
  const kind = useSyncExternalStore(
    subscribeAccessLossNotice,
    getShownAccessLossNotice,
  );
  if (kind === null) return null;
  return (
    <div role="status">
      <Alert tone="info">
        <div className="flex items-start justify-between gap-2">
          <p>{NOTICE_TEXTS[kind]}</p>
          <Button variant="ghost" onClick={dismissAccessLossNotice}>
            閉じる
          </Button>
        </div>
      </Alert>
    </div>
  );
}
