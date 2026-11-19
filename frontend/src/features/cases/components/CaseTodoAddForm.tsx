// TODO の追加の欄（5-4 AC-2・AC-6）。題名は送る前に shared の規則で確かめ、欄にエラーを出す（サーバーも同じ規則で確かめる）。
// 担当者の候補は「担当なし」と、有効な参加者だけ。サーバーの 422 は fields に応じて各欄に、それ以外（409・403 など）は onError で欄の外に出す。
// 成功したら題名を空にする。区画のどれかの操作の送信中は「追加する」を押せない。
import { useState, type FormEvent } from "react";
import { caseTodoTitleSchema } from "../../../../../shared/case-todo-rules";
import { Button } from "../../../components/Button";
import { SelectField } from "../../../components/SelectField";
import { TextField } from "../../../components/TextField";
import type { CaseParticipant } from "../api/case-api";
import { isApiError } from "../describe-error";
import { useAddCaseTodo } from "../hooks/useCaseTodoWrites";
import { CASE_TODO_TITLE_ERROR } from "../labels";
import { CaseTodoAssigneeOptions } from "./CaseTodoAssigneeOptions";

type Props = {
  caseId: string;
  participants: CaseParticipant[];
  /** 区画のどれかの操作が送信中なら押せない */
  busy: boolean;
  onAdded: () => void;
  onStart: () => void;
  onError: (cause: unknown) => void;
};

export function CaseTodoAddForm({
  caseId,
  participants,
  busy,
  onAdded,
  onStart,
  onError,
}: Props) {
  const add = useAddCaseTodo(caseId);
  const [title, setTitle] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [titleError, setTitleError] = useState<string>();
  const [assigneeError, setAssigneeError] = useState<string>();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    onStart();
    setTitleError(undefined);
    setAssigneeError(undefined);
    const parsed = caseTodoTitleSchema.safeParse(title);
    if (!parsed.success) {
      setTitleError(CASE_TODO_TITLE_ERROR);
      return;
    }
    add.mutate(
      {
        title: parsed.data,
        assigneeUserId: assigneeUserId === "" ? null : assigneeUserId,
      },
      {
        onSuccess: () => {
          setTitle("");
          onAdded();
        },
        onError: (cause) => {
          if (!isApiError(cause) || cause.status !== 422) {
            onError(cause);
            return;
          }
          if (cause.fields?.includes("assigneeUserId"))
            setAssigneeError(cause.message);
          else setTitleError(cause.message);
        },
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="mb-4">
      <TextField
        label="題名"
        value={title}
        error={titleError}
        onChange={(event) => setTitle(event.target.value)}
      />
      <SelectField
        label="担当者"
        value={assigneeUserId}
        error={assigneeError}
        onChange={(event) => setAssigneeUserId(event.target.value)}
      >
        <CaseTodoAssigneeOptions participants={participants} />
      </SelectField>
      <Button type="submit" disabled={busy}>
        追加する
      </Button>
    </form>
  );
}
