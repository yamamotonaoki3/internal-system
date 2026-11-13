// ログイン画面の案内：ログアウトで端末の下書きを消せなかったときだけ出す。
// 履歴の state に残るため、ログイン画面を再読み込みするとまた出る（既知の動き）。
import { useLocation } from "react-router";
import { z } from "zod";
import { Alert } from "../../../components/Alert";

const stateSchema = z.object({ draftCleanupFailed: z.literal(true) });

export function DraftCleanupNotice() {
  // 履歴の state は何でも入りうるので、unknown として受けて検証する
  const state: unknown = useLocation().state;
  if (!stateSchema.safeParse(state).success) return null;
  return (
    <Alert tone="warning">
      この端末の下書きを消せませんでした。共用の端末では、ブラウザのサイトデータを削除してください。
    </Alert>
  );
}
