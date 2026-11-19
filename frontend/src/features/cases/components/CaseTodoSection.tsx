// S-17 の TODO の区画（#149。5-4 AC-1〜AC-4・AC-6・AC-8・AC-9）。見出し「TODO」、進捗、追加の欄（進行中だけ）、項目の一覧。
// 4つの状態（読み込み中・エラーと再試行・0件「項目なし」・あり）を分ける。一覧は 2 秒ごとに取り直す（useCaseTodos。取得は CaseDetailView が持つ）。
// 操作の結果（追加・編集・削除の完了・エラー）と、編集・削除のダイアログの開閉は、この部品（行の外）で持つ：取り直しで行が消えても残す。
// 送信中は、追加・完了・取り消し・編集・削除のすべてを止める（useCaseTodoBusy）。
// 取得が 403 になったら、前の TODO を出さずに非公開の表示にする。外されたかの確かめ（概要の取り直し）は useCaseAccessLoss（#308）が行う。
// 終了した案件では「閲覧のみ」を示し、追加・完了・取り消し・編集・削除を出さない（表示の制御。認可はサーバー）。
import { useId, useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { useSignedInUserId } from "../../auth";
import type { CaseParticipant } from "../api/case-api";
import type { CaseTodo } from "../api/case-todo-api";
import { describeError, isApiError } from "../describe-error";
import type { useCaseTodos } from "../hooks/useCaseTodos";
import {
  useCaseTodoBusy,
  useDeleteCaseTodo,
  useSetCaseTodoCompleted,
} from "../hooks/useCaseTodoWrites";
import {
  CASE_TODO_ADDED_TEXT,
  CASE_TODO_EDIT_TEXTS,
  CASE_TODO_HEADING,
  CASE_TODO_LOAD_ERROR_TEXT,
  CASE_TODO_MORE_TEXT,
  CASE_TODO_READ_ONLY_TEXT,
  PARTICIPANTS_ONLY_TEXT,
} from "../labels";
import { CaseConfirmDialog } from "./CaseConfirmDialog";
import { CaseTodoAddForm } from "./CaseTodoAddForm";
import { CaseTodoEditDialog } from "./CaseTodoEditDialog";
import { CaseTodoItem } from "./CaseTodoItem";
import { CaseTodoProgress } from "./CaseTodoProgress";

type Props = {
  caseId: string;
  closed: boolean;
  participants: CaseParticipant[];
  todos: ReturnType<typeof useCaseTodos>;
};

/** 開いているダイアログ。利用者が替わったら出さない（前の利用者の TODO・入力を残さない。#284） */
type Opened = { kind: "edit" | "delete"; userId: string; todo: CaseTodo };

export function CaseTodoSection({
  caseId,
  closed,
  participants,
  todos,
}: Props) {
  const headingId = useId();
  const selfId = useSignedInUserId();
  const [done, setDone] = useState<string>();
  const [error, setError] = useState<string>();
  const [opened, setOpened] = useState<Opened>();
  const showError = (cause: unknown) => setError(describeError(cause));
  const busy = useCaseTodoBusy(caseId);
  const toggle = useSetCaseTodoCompleted(caseId, showError);
  const remove = useDeleteCaseTodo(caseId, (cause) => {
    setOpened(undefined);
    showError(cause);
  });
  const forbidden = isApiError(todos.error) && todos.error.status === 403;
  // 一覧を持っている間だけダイアログを出す（利用者の切り替え・資格の喪失で一覧が消えたら閉じる）
  const current =
    opened !== undefined &&
    opened.userId === selfId &&
    !forbidden &&
    todos.data !== undefined
      ? opened
      : undefined;

  function start() {
    setDone(undefined);
    setError(undefined);
  }

  // 先の操作の失敗（409 など）は、後の操作の送信では消さず、成功したときに消す（利用者が見落とさないため）
  function succeeded(text?: string) {
    setDone(text);
    setError(undefined);
  }

  // 送信中は、どの行の操作も受け付けない（応答の順と結果の表示を1つに保つ）
  function onToggle(todo: CaseTodo) {
    if (busy) return;
    setDone(undefined);
    toggle.mutate(
      { todoId: todo.id, completed: !todo.completed },
      { onSuccess: () => succeeded() },
    );
  }

  function open(kind: Opened["kind"], todo: CaseTodo) {
    if (busy || selfId === undefined) return;
    setDone(undefined);
    setOpened({ kind, userId: selfId, todo });
  }

  function confirmDelete(todo: CaseTodo) {
    remove.mutate(todo.id, {
      onSuccess: () => {
        setOpened(undefined);
        succeeded(CASE_TODO_EDIT_TEXTS.deleted);
      },
    });
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
            busy={busy}
            onStart={start}
            onAdded={() => succeeded(CASE_TODO_ADDED_TEXT)}
            onError={showError}
          />
        )}
        {items.length > 0 && (
          <ul>
            {items.map((todo) => (
              <CaseTodoItem
                key={todo.id}
                todo={todo}
                readOnly={closed}
                busy={busy}
                selfId={selfId}
                onToggle={onToggle}
                onEdit={(target) => open("edit", target)}
                onDelete={(target) => open("delete", target)}
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
      {done !== undefined && <p role="status">{done}</p>}
      {error !== undefined && (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      )}
      {renderBody()}
      {current?.kind === "edit" && (
        <CaseTodoEditDialog
          caseId={caseId}
          todo={current.todo}
          participants={participants}
          todos={todos}
          busy={busy}
          onSaved={() => {
            setOpened(undefined);
            succeeded(CASE_TODO_EDIT_TEXTS.updated);
          }}
          onClose={() => setOpened(undefined)}
        />
      )}
      {current?.kind === "delete" && (
        <CaseConfirmDialog
          title={CASE_TODO_EDIT_TEXTS.deleteTitle}
          confirmLabel={CASE_TODO_EDIT_TEXTS.deleteConfirm}
          pending={busy}
          onConfirm={() => confirmDelete(current.todo)}
          onClose={() => setOpened(undefined)}
        >
          {CASE_TODO_EDIT_TEXTS.deleteBody(current.todo.title)}
        </CaseConfirmDialog>
      )}
    </section>
  );
}
