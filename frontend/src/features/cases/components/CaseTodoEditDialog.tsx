// TODO の編集のダイアログ（#149 の 149-B。5-4 AC-6・AC-8、決定 Q1）。題名と担当者（完了済みは題名だけ）。
// 開いた時点の版を持ち、変わった項目だけを送る（何も変わらなければ送らずに閉じる）。題名は送る前に shared の規則で確かめる。
// 422 は各欄に、409・403 などは欄の外（role=alert）に出し、入力は残す。409 の理由はサーバーの文言で見分ける（ApiError に理由を持たないため）：
//   削除済み：保存を押せなくする。
//   ほかの人の変更：一覧の取り直し（onSettled の invalidate）を待ち、取得済みのページに項目があれば最新の内容を出して、次の保存は最新の版で送る。
//   項目がなければ削除とは言わずに閉じて確かめるよう案内し、取り直しが失敗したら再試行を出す。それまでは保存を押せない。
// 取り直しが終わったかは、409 を受けた時点の一覧の取得の成功・失敗の回数を控え、それより増えたかで導く（時刻は比べない。状態をコピーしない）。
// 409 の直後に invalidate が走り、取得中のものは取り消されて取り直される。なので、回数が増えたのは 409 の後に始まった取得の結果。
import { useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { caseTodoTitleSchema } from "../../../../../shared/case-todo-rules";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { SelectField } from "../../../components/SelectField";
import { TextField } from "../../../components/TextField";
import { useSignedInUserId } from "../../auth";
import { caseKeys } from "../api/query-keys";
import type { CaseParticipant } from "../api/case-api";
import type { CaseTodo, CaseTodoEdit } from "../api/case-todo-api";
import { describeError, isApiError } from "../describe-error";
import type { useCaseTodos } from "../hooks/useCaseTodos";
import { useEditCaseTodo } from "../hooks/useCaseTodoWrites";
import {
  CASE_TODO_EDIT_TEXTS,
  CASE_TODO_NO_ASSIGNEE_TEXT,
  CASE_TODO_TITLE_ERROR,
  retiredName,
} from "../labels";
import { CaseTodoAssigneeOptions } from "./CaseTodoAssigneeOptions";
import { isConflictError } from "../../../services/api-client";

type Props = {
  caseId: string;
  /** 開いた時点の項目 */
  todo: CaseTodo;
  participants: CaseParticipant[];
  todos: ReturnType<typeof useCaseTodos>;
  busy: boolean;
  onSaved: () => void;
  onClose: () => void;
};

type Latest =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "missing" }
  | { kind: "found"; item: CaseTodo };

/** 409 を受けた時点の、一覧の取得の成功・失敗の回数 */
type FetchCounts = { data: number; error: number };

function latestOf(
  todos: ReturnType<typeof useCaseTodos>,
  todoId: string,
  counts: FetchCounts,
  recorded: FetchCounts | null,
): Latest {
  if (recorded === null) return { kind: "none" };
  // キャッシュが作り直されて回数が控えより小さくなったら、0 から数え直す（永久に読み込み中にしない）
  const since =
    counts.data < recorded.data || counts.error < recorded.error
      ? { data: 0, error: 0 }
      : recorded;
  if (
    todos.data !== undefined &&
    todos.status === "success" &&
    counts.data > since.data
  ) {
    const item = todos.data.pages
      .flatMap((page) => page.items)
      .find((candidate) => candidate.id === todoId);
    return item === undefined ? { kind: "missing" } : { kind: "found", item };
  }
  if (todos.status === "error" && counts.error > since.error)
    return { kind: "failed" };
  return { kind: "loading" };
}

/**
 * 一覧の取得の成功・失敗の回数。キャッシュの変化を購読するので、データが変わらない成功（同じ内容の取得）でも描画が起きる。
 * 回数は、キャッシュが作り直されると 0 に戻る。
 */
function useFetchCounts(caseId: string) {
  const queryClient = useQueryClient();
  const userId = useSignedInUserId();
  const key = caseKeys.todos(userId ?? "", caseId);
  const subscribe = (notify: () => void) =>
    queryClient.getQueryCache().subscribe(notify);
  const data = useSyncExternalStore(
    subscribe,
    () => queryClient.getQueryState(key)?.dataUpdateCount ?? 0,
  );
  const error = useSyncExternalStore(
    subscribe,
    () => queryClient.getQueryState(key)?.errorUpdateCount ?? 0,
  );
  return { data, error };
}

const assigneeName = (todo: CaseTodo) => {
  const shown = todo.completed ? todo.completedAssignee : todo.assignee;
  if (shown === null) return CASE_TODO_NO_ASSIGNEE_TEXT;
  return shown.isActive ? shown.displayName : retiredName(shown.displayName);
};

export function CaseTodoEditDialog({
  caseId,
  todo,
  participants,
  todos,
  busy,
  onSaved,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(todo.title);
  const [assigneeId, setAssigneeId] = useState(todo.assignee?.userId ?? "");
  const [titleError, setTitleError] = useState<string>();
  const [assigneeError, setAssigneeError] = useState<string>();
  const [error, setError] = useState<string>();
  const [deleted, setDeleted] = useState(false);
  const counts = useFetchCounts(caseId);
  /** ほかの人の変更（409 todo_changed）を受けた時点の取得の回数。最新の内容の取り直しを待つ基準 */
  const [since, setSince] = useState<FetchCounts | null>(null);
  const edit = useEditCaseTodo(caseId, (cause) => {
    if (isApiError(cause) && cause.status === 422) {
      if (cause.fields?.includes("assigneeUserId"))
        setAssigneeError(cause.message);
      else setTitleError(cause.message);
      return;
    }
    setError(describeError(cause));
    if (!isApiError(cause) || !isConflictError(cause)) return;
    if (cause.message === CASE_TODO_EDIT_TEXTS.todoDeleted) setDeleted(true);
    else if (cause.message === CASE_TODO_EDIT_TEXTS.todoChanged)
      setSince(counts);
  });

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const latest = latestOf(todos, todo.id, counts, since);
  // 最新の内容が届いたら、それを基準に比べ、その版で送る
  const base = latest.kind === "found" ? latest.item : todo;
  const blocked =
    deleted || (latest.kind !== "none" && latest.kind !== "found");
  const pending = busy || edit.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || blocked) return;
    setTitleError(undefined);
    setAssigneeError(undefined);
    const parsed = caseTodoTitleSchema.safeParse(title);
    if (!parsed.success) {
      setTitleError(CASE_TODO_TITLE_ERROR);
      return;
    }
    const body: CaseTodoEdit = { version: base.version };
    if (parsed.data !== base.title) body.title = parsed.data;
    const chosen = assigneeId === "" ? null : assigneeId;
    if (!todo.completed && chosen !== (base.assignee?.userId ?? null))
      body.assigneeUserId = chosen;
    if (body.title === undefined && body.assigneeUserId === undefined) {
      onClose();
      return;
    }
    edit.mutate(
      { todoId: todo.id, body },
      {
        onSuccess: () => {
          setError(undefined);
          onSaved();
        },
      },
    );
  }

  function retry() {
    if (pending) return;
    setSince(counts);
    void todos.refetch();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={CASE_TODO_EDIT_TEXTS.editTitle}
      onCancel={(event) => {
        event.preventDefault();
        if (!edit.isPending) onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <h2 className="mb-4 text-xl font-bold">
        {CASE_TODO_EDIT_TEXTS.editTitle}
      </h2>
      {error !== undefined && (
        <Alert tone="error" role="alert">
          <p>{error}</p>
          {latest.kind === "loading" && (
            <p>{CASE_TODO_EDIT_TEXTS.latestLoading}</p>
          )}
          {latest.kind === "found" && (
            <p>
              {CASE_TODO_EDIT_TEXTS.latest(
                latest.item.title,
                assigneeName(latest.item),
              )}
            </p>
          )}
          {latest.kind === "missing" && (
            <p>{CASE_TODO_EDIT_TEXTS.latestOutOfPage}</p>
          )}
          {latest.kind === "failed" && (
            <>
              <p>{CASE_TODO_EDIT_TEXTS.latestLoadFailed}</p>
              <Button variant="secondary" disabled={pending} onClick={retry}>
                {CASE_TODO_EDIT_TEXTS.retry}
              </Button>
            </>
          )}
        </Alert>
      )}
      <form onSubmit={submit} noValidate>
        <TextField
          label="題名"
          value={title}
          error={titleError}
          onChange={(event) => setTitle(event.target.value)}
        />
        {!todo.completed && (
          <SelectField
            label="担当者"
            value={assigneeId}
            error={assigneeError}
            onChange={(event) => setAssigneeId(event.target.value)}
          >
            <CaseTodoAssigneeOptions
              participants={participants}
              current={todo.assignee}
            />
          </SelectField>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending || blocked}>
            {CASE_TODO_EDIT_TEXTS.save}
          </Button>
          <Button
            variant="secondary"
            disabled={edit.isPending}
            onClick={onClose}
          >
            {CASE_TODO_EDIT_TEXTS.cancel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
