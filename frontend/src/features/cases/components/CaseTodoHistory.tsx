// TODO の変更履歴（#149 の 149-C。5-4 AC-10・AC-11・AC-14）。行の「履歴」で、行の中に開く（詳細画面は作らない）。
// 1件ずつ「日時・操作した人・内容」を古い順に出す。名前は有効な人はプロフィールカードのボタン、無効な人は「（退職者）」つきの文字（AC-6）。
// 4つの状態（読み込み中・エラーと再試行・0件・あり）を分け、続きの失敗では読み込み済みの行を隠さない。開いている間だけ取り直す（useCaseTodoEvents）。
import type { ReactNode } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { formatMessageTime } from "../../messages";
import type { CaseTodoEvent, TodoPerson } from "../api/case-todo-api";
import { useCaseTodoEvents } from "../hooks/useCaseTodoEvents";
import {
  CASE_TODO_HISTORY_TEXTS as TEXTS,
  CASE_TODO_MORE_TEXT,
  CASE_TODO_NO_ASSIGNEE_TEXT,
} from "../labels";
import { PersonName } from "./CaseTodoPerson";

/** 「{題名}の履歴」の開閉のボタン（読み取りだけなので、送信中・終了中でも押せる） */
export function CaseTodoHistoryButton({
  title,
  open,
  onToggle,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      aria-expanded={open}
      aria-label={TEXTS.historyButton(title)}
      onClick={onToggle}
    >
      {TEXTS.history}
    </Button>
  );
}

/** 記録の内容の文言。名前は部品（name）で出す */
function describeEvent(
  event: CaseTodoEvent,
  name: (person: TodoPerson | null) => ReactNode,
): ReactNode {
  switch (event.kind) {
    case "create":
      return <>追加（担当：{name(event.assignee)}）</>;
    case "title_change":
      return TEXTS.titleChange(event.previousTitle ?? "", event.title ?? "");
    case "assignee_change":
      return (
        <>
          担当を{name(event.previousAssignee)}から{name(event.assignee)}
          に変更
        </>
      );
    case "complete":
      return <>完了（担当：{name(event.assignee)}）</>;
    case "uncomplete":
      return TEXTS.uncomplete;
    case "auto_unassign":
      return (
        <>
          担当者が外れたため{CASE_TODO_NO_ASSIGNEE_TEXT}（以前の担当：
          {name(event.assignee)}）
        </>
      );
    case "delete":
      return TEXTS.delete;
    case "restore":
      return TEXTS.restoreEvent;
  }
}

export function CaseTodoHistory({
  caseId,
  todoId,
  title,
  selfId,
}: {
  caseId: string;
  todoId: string;
  title: string;
  selfId: string | undefined;
}) {
  const events = useCaseTodoEvents(caseId, todoId, true);
  const name = (person: TodoPerson | null) =>
    person === null ? (
      CASE_TODO_NO_ASSIGNEE_TEXT
    ) : (
      <PersonName person={person} selfId={selfId} />
    );

  function renderBody() {
    if (events.isError && !events.isFetchNextPageError)
      return (
        <Alert tone="error">
          <p>{TEXTS.historyLoadError}</p>
          <Button variant="secondary" onClick={() => void events.refetch()}>
            {TEXTS.retry}
          </Button>
        </Alert>
      );
    if (events.isPending) return <p role="status">{TEXTS.historyLoading}</p>;
    const items = events.data.pages.flatMap((page) => page.items);
    if (items.length === 0) return <p>{TEXTS.historyEmpty}</p>;
    return (
      <>
        <ul>
          {items.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap gap-x-2 border-b border-border py-1 text-sm"
            >
              <time dateTime={event.createdAt}>
                {formatMessageTime(event.createdAt)}
              </time>
              <span>{name(event.actor)}</span>
              <span>{describeEvent(event, name)}</span>
            </li>
          ))}
        </ul>
        {events.isFetchNextPageError && (
          <Alert tone="error" role="alert">
            {TEXTS.historyMoreError}
          </Alert>
        )}
        {events.hasNextPage && (
          <div className="mt-1">
            <Button
              variant="secondary"
              disabled={events.isFetchingNextPage}
              onClick={() => void events.fetchNextPage()}
            >
              {CASE_TODO_MORE_TEXT}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <section aria-label={TEXTS.historyRegion(title)} className="w-full pl-4">
      {renderBody()}
    </section>
  );
}
