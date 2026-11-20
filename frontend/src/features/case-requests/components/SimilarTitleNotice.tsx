// 類似件名の確認の結果。申請の画面（S-18）と、案件の内容の編集（S-17。#150 の 150-C）が使う。
// 失敗は「類似なし」にせず、知らせて取り直せるようにする（送信は止めない）。
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import type { useSimilarTitle } from "../hooks/useSimilarTitle";

export function SimilarTitleNotice({
  similar,
}: {
  similar: ReturnType<typeof useSimilarTitle>;
}) {
  if (similar.isError) {
    return (
      <Alert tone="error" role="alert">
        <p>類似の件名を確認できませんでした</p>
        <Button
          variant="secondary"
          disabled={similar.isFetching}
          onClick={() => void similar.refetch()}
        >
          もう一度確認
        </Button>
      </Alert>
    );
  }
  if (similar.data?.hasSimilar !== true) return null;
  return (
    <Alert tone="info" as="p">
      似た案件があります
    </Alert>
  );
}
