// 類似件名の確認。取引先と件名（整形の後に1〜100文字）がそろったときだけ問い合わせる。
// 入力のたびに送らないよう、呼び出し側が入力の止まった値を渡す。
import { useQuery } from "@tanstack/react-query";
import { caseTitleSchema } from "../../../../../shared/case-rules";
import { checkSimilarTitle } from "../api/case-request-api";
import { caseRequestKeys } from "../api/query-keys";

export function useSimilarTitle(clientId: string, title: string) {
  return useQuery({
    queryKey: caseRequestKeys.similar(clientId, title),
    queryFn: () => checkSimilarTitle({ clientId, title }),
    enabled: clientId !== "" && caseTitleSchema.safeParse(title).success,
    retry: false,
  });
}
