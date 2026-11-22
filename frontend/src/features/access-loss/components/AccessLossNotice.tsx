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

const LOST_TEXT =
  "この案件を表示できなくなったため、画面を読み込み直しました。保存していない入力は消えています。";
const LEFT_TEXT = "案件から退出しました。";
// 保存先が使えないままなら、ログアウトでも消せないため、消えると言い切らない（#340 計画レビュー2回目の軽微）
const DRAFTS_REMAIN_TEXT =
  "この案件のメッセージの書きかけが、この端末に残っている可能性があります。共用の端末では、ブラウザの設定から、このサイトのサイトデータを削除してください。";

const NOTICE_TEXTS = {
  lost: LOST_TEXT,
  left: LEFT_TEXT,
  lostDraftsRemain: `${LOST_TEXT}${DRAFTS_REMAIN_TEXT}`,
  leftDraftsRemain: `${LEFT_TEXT}${DRAFTS_REMAIN_TEXT}`,
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
