// 本文の整形（動的に読み込む部品）の失敗を受け止める。画面全体を壊さず、その本文だけを、書いたままの文字と案内に替える。
// 受け止めるのは、失敗を利用者に明示した代替表示にするため（黙って原文に戻さない）。例外の詳細・ファイル名は出さない。
// 読み込みの失敗（再読み込みで直りうる）と、読み込み後の描画の例外（再読み込みでは直らない）は、案内を分ける。
// ログは足さない（共通の記録口ができる #234 で足す）。
import { Component, type ReactNode } from "react";
import { Alert } from "../../../components/Alert";

/** 整形の部品の動的読み込みの失敗。描画中の例外と区別するため、読み込みの失敗だけをこの型に包む */
export class MarkdownLoadError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("整形の部品を読み込めませんでした", options);
    this.name = "MarkdownLoadError";
  }
}

type Props = { body: string; children: ReactNode };
type State = { error: unknown };

export class MessageBodyBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    // null や undefined が投げられても失敗として扱う
    return { error: error ?? new Error("不明な描画の失敗") };
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <>
        <p className="whitespace-pre-wrap break-words">{this.props.body}</p>
        <Alert tone="warning" role="status" as="p">
          {error instanceof MarkdownLoadError
            ? "書式つきの表示を読み込めませんでした。再読み込みしてください。"
            : "この本文は書式つきで表示できませんでした。"}
        </Alert>
      </>
    );
  }
}
