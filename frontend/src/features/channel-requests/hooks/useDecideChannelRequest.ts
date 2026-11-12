// 申請の承認・却下（再認証が要る操作）。再認証（必要なら）を挟んで書き込む。再認証が完了しなかった場合は、要求を送らずに NotSentError にする。
// 承認では、チャンネルが増え申請者が参加するため、チャンネルの一覧も取り直す。成功しても失敗（すでに処理されていた等）しても、申請の一覧を取り直す。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { channelKeys } from "../../channels";
import { useReauth } from "../../auth";
import {
  approveChannelRequest,
  rejectChannelRequest,
} from "../api/channel-request-api";
import { channelRequestKeys } from "../api/query-keys";
import { NotSentError } from "../describe-error";

export type DecideInput =
  | { kind: "approve"; requestId: string }
  | { kind: "reject"; requestId: string; reason: string };

const TITLES = {
  approve: "チャンネル作成の承認",
  reject: "チャンネル作成の却下",
};

type WithReauth = <T>(title: string, operation: () => Promise<T>) => Promise<T>;

async function sendWithReauth(
  withReauth: WithReauth,
  title: string,
  operation: () => Promise<unknown>,
): Promise<unknown> {
  let sent = false;
  try {
    return await withReauth(title, () => {
      sent = true;
      return operation();
    });
  } catch (error) {
    if (sent) throw error;
    throw new NotSentError({ cause: error });
  }
}

export function useDecideChannelRequest() {
  const queryClient = useQueryClient();
  const { withReauth } = useReauth();
  return {
    decide: useMutation({
      mutationFn: (input: DecideInput) =>
        sendWithReauth(withReauth, TITLES[input.kind], () =>
          input.kind === "approve"
            ? approveChannelRequest(input.requestId)
            : rejectChannelRequest(input.requestId, input.reason),
        ),
      onSuccess: (_result, input) =>
        input.kind === "approve"
          ? queryClient.invalidateQueries({ queryKey: channelKeys.all })
          : undefined,
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: channelRequestKeys.all }),
    }),
    // 却下の理由を入力する前に、再認証だけを済ませる（再認証が要るときは、理由のダイアログより先に出す）
    confirmReauth: useMutation({
      mutationFn: () =>
        sendWithReauth(withReauth, TITLES.reject, () => Promise.resolve()),
    }),
  };
}
