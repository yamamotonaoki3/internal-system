// 削除済みの TODO の一覧（#149 の 149-C。5-4 AC-12・AC-13）。TODO の区画の中で開閉し、開いたときだけ取得する（useDeletedCaseTodos）。
// 各行は読み取り専用（題名・担当・完了の状態・削除した人・日時・「履歴」）。進行中の案件だけ「復元」を出す（表示の制御。認可はサーバー）。
// 復元の送信と結果の表示は区画（CaseTodoSection）が持つ。開閉の状態はこの部品の状態（利用者が替わったら区画ごと描き直されて閉じる）。
import { useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { formatMessageTime } from "../../messages";
import type { DeletedCaseTodo } from "../api/case-todo-api";
import { useDeletedCaseTodos } from "../hooks/useDeletedCaseTodos";
import {
  CASE_TODO_DONE_TEXT,
  CASE_TODO_HISTORY_TEXTS as TEXTS,
  CASE_TODO_MORE_TEXT,
} from "../labels";
import { CaseTodoHistory, CaseTodoHistoryButton } from "./CaseTodoHistory";
import { Assignee, PersonName } from "./CaseTodoPerson";

type RowProps = {
  caseId: string;
  todo: DeletedCaseTodo;
  closed: boolean;
  busy: boolean;
  selfId: string | undefined;
  onRestore: (todo: DeletedCaseTodo) => void;
};

function DeletedRow({
  caseId,
  todo,
  closed,
  busy,
  selfId,
  onRestore,
}: RowProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2">
      {todo.completed && (
        <span className="rounded-md bg-info-bg px-2 text-sm font-bold text-info-text">
          {CASE_TODO_DONE_TEXT}
        </span>
      )}
      <span className="font-bold">{todo.title}</span>
      <span className="text-sm text-text-muted">
        担当：
        <Assignee todo={todo} selfId={selfId} />
      </span>
      <span className="text-sm text-text-muted">
        {TEXTS.deletedBy}
        <PersonName person={todo.deletedBy} selfId={selfId} />
      </span>
      <time dateTime={todo.deletedAt} className="text-sm">
        {formatMessageTime(todo.deletedAt)}
      </time>
      <CaseTodoHistoryButton
        title={todo.title}
        open={historyOpen}
        onToggle={() => setHistoryOpen((open) => !open)}
      />
      {!closed && (
        <Button
          variant="secondary"
          disabled={busy}
          aria-label={TEXTS.restoreButton(todo.title)}
          onClick={() => onRestore(todo)}
        >
          {TEXTS.restore}
        </Button>
      )}
      {historyOpen && (
        <CaseTodoHistory
          caseId={caseId}
          todoId={todo.id}
          title={todo.title}
          selfId={selfId}
        />
      )}
    </li>
  );
}

function DeletedList(props: Omit<RowProps, "todo">) {
  const deleted = useDeletedCaseTodos(props.caseId, true);
  if (deleted.isError && !deleted.isFetchNextPageError)
    return (
      <Alert tone="error">
        <p>{TEXTS.deletedLoadError}</p>
        <Button variant="secondary" onClick={() => void deleted.refetch()}>
          {TEXTS.retry}
        </Button>
      </Alert>
    );
  if (deleted.isPending) return <p role="status">{TEXTS.deletedLoading}</p>;
  const items = deleted.data.pages.flatMap((page) => page.items);
  if (items.length === 0) return <p>{TEXTS.deletedEmpty}</p>;
  return (
    <>
      <ul>
        {items.map((todo) => (
          <DeletedRow key={todo.id} {...props} todo={todo} />
        ))}
      </ul>
      {deleted.isFetchNextPageError && (
        <Alert tone="error" role="alert">
          {TEXTS.deletedMoreError}
        </Alert>
      )}
      {deleted.hasNextPage && (
        <div className="mt-2">
          <Button
            variant="secondary"
            disabled={deleted.isFetchingNextPage}
            onClick={() => void deleted.fetchNextPage()}
          >
            {CASE_TODO_MORE_TEXT}
          </Button>
        </div>
      )}
    </>
  );
}

export function CaseDeletedTodos(props: Omit<RowProps, "todo">) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4">
      <Button
        variant="ghost"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {TEXTS.deleted}
      </Button>
      {open && (
        <section aria-label={TEXTS.deleted} className="mt-2">
          <DeletedList {...props} />
        </section>
      )}
    </div>
  );
}
