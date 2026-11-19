// S-17 の TODO の区画（#149。5-4 AC-1〜AC-4・AC-6・AC-8・AC-9）。見出し「TODO」、進捗、追加の欄（進行中だけ）、項目の一覧。
// 4つの状態（読み込み中・エラーと再試行・0件「項目なし」・あり）を分ける。一覧は 2 秒ごとに取り直す（useCaseTodos。取得は CaseDetailView が持つ）。
// 操作の結果（追加の完了・エラー）は、この部品（行の外）で持つ：取り直しで行が消えても残す。
// 取得が 403（外された）になったら、前の TODO を出さずに非公開の表示にし、概要・詳細を取り直す（ヘッダー・本文も非参加に切り替えるため）。
// 終了した案件では「閲覧のみ」を示し、追加・完了・取り消しを出さない（表示の制御。認可はサーバー）。
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import type { CaseParticipant } from "../api/case-api";
import type { CaseTodo } from "../api/case-todo-api";
import { caseKeys } from "../api/query-keys";
import { describeError, isApiError } from "../describe-error";
import type { useCaseTodos } from "../hooks/useCaseTodos";
import { useSetCaseTodoCompleted } from "../hooks/useCaseTodoWrites";
import {
  CASE_TODO_ADDED_TEXT,
  CASE_TODO_HEADING,
  CASE_TODO_LOAD_ERROR_TEXT,
  CASE_TODO_MORE_TEXT,
  CASE_TODO_READ_ONLY_TEXT,
  PARTICIPANTS_ONLY_TEXT,
} from "../labels";
import { CaseTodoAddForm } from "./CaseTodoAddForm";
import { CaseTodoItem } from "./CaseTodoItem";
import { CaseTodoProgress } from "./CaseTodoProgress";

type Props = {
  caseId: string;
  selfId: string;
  closed: boolean;
  participants: CaseParticipant[];
  todos: ReturnType<typeof useCaseTodos>;
};

export function CaseTodoSection({
  caseId,
  selfId,
  closed,
  participants,
  todos,
}: Props) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string>();
  const toggle = useSetCaseTodoCompleted(caseId, (cause) =>
    setError(describeError(cause)),
  );
  const forbidden = isApiError(todos.error) && todos.error.status === 403;

  useEffect(() => {
    if (!forbidden) return;
    void queryClient.invalidateQueries({
      queryKey: caseKeys.summary(selfId, caseId),
    });
    void queryClient.invalidateQueries({
      queryKey: caseKeys.detail(selfId, caseId),
    });
  }, [forbidden, queryClient, selfId, caseId]);

  function start() {
    setAdded(false);
    setError(undefined);
  }

  // 送信中は、どの行の操作も受け付けない（応答の順と結果の表示を1つに保つ）。
  // 先の操作の失敗（409 など）は、後の操作で消さずに出し続ける（利用者が見落とさないため）
  function onToggle(todo: CaseTodo) {
    if (toggle.isPending) return;
    setAdded(false);
    // 操作が成功したら、先の失敗の表示を消す（取り直しの成功では消さない）。送信中はほかの操作を受け付けないので、この呼び出しの結果は失われない
    toggle.mutate(
      { todoId: todo.id, completed: !todo.completed },
      { onSuccess: () => setError(undefined) },
    );
  }

  function renderBody() {
    if (forbidden) return <p>{PARTICIPANTS_ONLY_TEXT}</p>;
    if (todos.isError)
      return (
        <Alert tone="error">
          <p>{CASE_TODO_LOAD_ERROR_TEXT}</p>
          <Button variant="secondary" onClick={() => void todos.refetch()}>
            再試行
          </Button>
        </Alert>
      );
    if (todos.isPending) return <p role="status">読み込み中です</p>;
    const pages = todos.data.pages;
    const items = pages.flatMap((page) => page.items);
    // どのページの取得でも全体から数えた進捗が返る。最後に取得したページの値を使う
    const progress = pages.at(-1)?.progress ?? null;
    return (
      <>
        <p className="mb-2">
          <CaseTodoProgress progress={progress} />
        </p>
        {closed ? (
          <p className="mb-2 text-sm text-text-muted">
            {CASE_TODO_READ_ONLY_TEXT}
          </p>
        ) : (
          <CaseTodoAddForm
            caseId={caseId}
            participants={participants}
            onStart={start}
            onAdded={() => setAdded(true)}
            onError={(cause) => setError(describeError(cause))}
          />
        )}
        {items.length > 0 && (
          <ul>
            {items.map((todo) => (
              <CaseTodoItem
                key={todo.id}
                todo={todo}
                readOnly={closed}
                busy={toggle.isPending}
                onToggle={onToggle}
              />
            ))}
          </ul>
        )}
        {todos.hasNextPage && (
          <div className="mt-2">
            <Button
              variant="secondary"
              disabled={todos.isFetchingNextPage}
              onClick={() => void todos.fetchNextPage()}
            >
              {CASE_TODO_MORE_TEXT}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h2 id={headingId} className="mb-2 text-lg font-bold">
        {CASE_TODO_HEADING}
      </h2>
      {added && <p role="status">{CASE_TODO_ADDED_TEXT}</p>}
      {error !== undefined && (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      )}
      {renderBody()}
    </section>
  );
}
