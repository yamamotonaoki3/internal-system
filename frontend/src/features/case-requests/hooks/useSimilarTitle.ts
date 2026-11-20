// 類似件名の確認。取引先と件名（整形の後に1〜100文字）がそろったときだけ問い合わせる。
// 入力のたびに送らないよう、呼び出し側が入力の止まった値を渡す。
// excludeCaseId は、案件の内容の編集（#150 の 150-C）が、編集中の案件自身を「似た案件」に数えないために渡す。
import { useQuery } from "@tanstack/react-query";
import { caseTitleSchema } from "../../../../../shared/case-rules";
import { checkSimilarTitle } from "../api/case-request-api";
import { caseRequestKeys } from "../api/query-keys";

export function useSimilarTitle(
  clientId: string,
  title: string,
  options: { excludeCaseId?: string; enabled?: boolean } = {},
) {
  const { excludeCaseId, enabled = true } = options;
  return useQuery({
    queryKey: caseRequestKeys.similar(clientId, title, excludeCaseId ?? null),
    queryFn: () =>
      checkSimilarTitle({
        clientId,
        title,
        ...(excludeCaseId === undefined ? {} : { excludeCaseId }),
      }),
    enabled:
      enabled && clientId !== "" && caseTitleSchema.safeParse(title).success,
    retry: false,
  });
}
