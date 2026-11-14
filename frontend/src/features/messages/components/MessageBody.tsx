// メッセージの本文。マークダウンの部品（react-markdown など）は、初回の JavaScript を増やさないよう、動的に読み込む（ADR-0026）。
// 読み込むまでは、今までの表示（書いたままの文字・改行を保つ）にする。
import { lazy, Suspense } from "react";
import { MarkdownLoadError, MessageBodyBoundary } from "./MessageBodyBoundary";

const MarkdownBody = lazy(() =>
  import("../markdown/MarkdownBody").then(
    (module) => ({ default: module.MarkdownBody }),
    // 読み込みの失敗だけを専用のエラーに包んで投げ直す（もみ消さない）。境界が、描画中の例外と区別する
    (cause: unknown) => {
      throw new MarkdownLoadError({ cause });
    },
  ),
);

export function MessageBody({ body }: { body: string }) {
  return (
    <MessageBodyBoundary body={body}>
      <Suspense
        fallback={<p className="whitespace-pre-wrap break-words">{body}</p>}
      >
        <MarkdownBody body={body} />
      </Suspense>
    </MessageBodyBoundary>
  );
}
