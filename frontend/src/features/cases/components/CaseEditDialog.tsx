// S-17 の「内容を編集」（#150 の 150-C。EP-5-20）。件名・説明（有効な参加者だけ）・取引先・担当部署を編集する。案件番号は表示だけ。
// 基準（入力の初期値・比べる値・送る衝突の検知の値）は、開いた時点の1つの応答から呼び出し側が作り、開いている間は差し替えない
// （背景の取り直しで基準が変わると、古い入力を新しい版で送ってしまうため）。送る本文は、基準と比べて変えた項目と、基準の version か expected。
// いまの取引先・部署が無効でも「（無効）」を付けて選ばれたまま残す（C-140(4)・Q1＝A）。件名か取引先を変えたときだけ類似件名を確かめる（警告だけ）。
// サーバーの 422 は欄（当たる欄がなければダイアログの中）に出し、それ以外の失敗は呼び出し側に渡して、ダイアログを閉じて外に出す。
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, type ReactNode } from "react";
import {
  Controller,
  useForm,
  useWatch,
  type FieldError,
} from "react-hook-form";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { SelectField } from "../../../components/SelectField";
import { TextAreaField } from "../../../components/TextAreaField";
import { TextField } from "../../../components/TextField";
import { useSettledValue } from "../../../lib/useSettledValue";
import {
  DepartmentCheckboxes,
  SimilarTitleNotice,
  TITLE_CAUTION,
  useClientChoices,
  useDepartmentChoices,
  useSimilarTitle,
  type Choice,
} from "../../case-requests/form-parts";
import { useLeaveConfirmation, useLeaveGuard } from "../../leave-guard";
import type { CaseEditBody } from "../api/case-api";
import { describeError, isApiError } from "../describe-error";
import { useEditCase } from "../hooks/useCaseWrites";
import { CASE_EDIT_TEXTS, nameWithMark } from "../labels";
import {
  caseEditFieldNames,
  caseEditFormSchema,
  type CaseEditFormValues,
} from "../schemas/case-edit-form";

const SIMILAR_DELAY_MS = 400;

type Named = { id: string; name: string; isActive: boolean };

/** 開いた時点の基準。description は有効な参加者だけ（参加していない管理者は null で、説明の欄を出さない） */
export type CaseEditBasis = {
  caseNumber: string;
  title: string;
  description: string | null;
  client: Named;
  departments: Named[];
  conflict:
    | { version: number }
    | {
        expected: { title: string; clientId: string; departmentIds: string[] };
      };
};

type Props = {
  caseId: string;
  basis: CaseEditBasis;
  onSaved: (titleFormatted: boolean) => void;
  /** 422 以外の失敗（ダイアログを閉じて外に出す） */
  onFailed: (message: string) => void;
  onClose: () => void;
};

type Changes = Omit<CaseEditBody, "version" | "expected">;

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** 基準と比べて変えた項目。何も変えていなければ null */
function changesOf(
  basis: CaseEditBasis,
  values: CaseEditFormValues,
): Changes | null {
  const changes: Changes = {};
  if (values.title !== basis.title) changes.title = values.title;
  if (basis.description !== null && values.description !== basis.description)
    changes.description = values.description;
  if (values.clientId !== basis.client.id) changes.clientId = values.clientId;
  const departmentIds = basis.departments.map((d) => d.id);
  if (!sameSet(values.departmentIds, departmentIds))
    changes.departmentIds = values.departmentIds;
  return Object.keys(changes).length === 0 ? null : changes;
}

/** 候補に、基準の無効な（候補にない）ものを「（無効）」付きで足す */
function withBasis(
  choices: readonly Choice[],
  current: readonly Named[],
): Choice[] {
  const missing = current
    .filter((item) => !choices.some((choice) => choice.id === item.id))
    .map((item) => ({ id: item.id, name: nameWithMark(item) }));
  return [...missing, ...choices];
}

/** 欄のエラーの文：サーバーの 422 はサーバーの文、入力チェックの誤りは決めた文 */
function messageOf(
  error: FieldError | undefined,
  fallback: string,
): string | undefined {
  if (error?.type === "server") return error.message;
  return error === undefined ? undefined : fallback;
}

function EditDialogFrame({
  busy,
  onCancel,
  children,
}: {
  busy: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-label={CASE_EDIT_TEXTS.title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      className="w-full max-w-lg rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <h2 className="mb-4 text-xl font-bold">{CASE_EDIT_TEXTS.title}</h2>
      {children}
    </dialog>
  );
}

export function CaseEditDialog(props: Props) {
  const clients = useClientChoices();
  const departments = useDepartmentChoices();
  if (clients.isError || departments.isError)
    return (
      <EditDialogFrame busy={false} onCancel={props.onClose}>
        <Alert tone="error" role="alert">
          {describeError(clients.error ?? departments.error)}
        </Alert>
        <Button variant="ghost" onClick={props.onClose}>
          {CASE_EDIT_TEXTS.cancel}
        </Button>
      </EditDialogFrame>
    );
  // 欄と候補を一度にそろえて出す（候補の読み込みの途中で、選ばれた値が候補にない状態を作らない）
  if (clients.isPending || departments.isPending)
    return <p role="status">{CASE_EDIT_TEXTS.preparing}</p>;
  return (
    <CaseEditForm
      {...props}
      clientChoices={withBasis(clients.data, [props.basis.client])}
      departmentChoices={withBasis(departments.data, props.basis.departments)}
    />
  );
}

function CaseEditForm({
  caseId,
  basis,
  clientChoices,
  departmentChoices,
  onSaved,
  onFailed,
  onClose,
}: Props & { clientChoices: Choice[]; departmentChoices: Choice[] }) {
  const edit = useEditCase(caseId);
  const leave = useLeaveConfirmation();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<CaseEditFormValues>({
    resolver: zodResolver(caseEditFormSchema),
    defaultValues: {
      title: basis.title,
      description: basis.description ?? "",
      clientId: basis.client.id,
      departmentIds: basis.departments.map((d) => d.id),
    },
  });
  const [title, description, clientId, departmentIds] = useWatch({
    control,
    name: ["title", "description", "clientId", "departmentIds"],
  });
  const changes = changesOf(basis, {
    title,
    description,
    clientId,
    departmentIds,
  });
  const busy = isSubmitting || edit.isPending;
  useLeaveGuard({
    isDirty: changes !== null,
    onDiscard: () => reset(),
    focus: () => setFocus("title"),
  });
  const similar = useSimilarTitle(
    useSettledValue(clientId, SIMILAR_DELAY_MS),
    useSettledValue(title, SIMILAR_DELAY_MS),
    {
      excludeCaseId: caseId,
      enabled: title !== basis.title || clientId !== basis.client.id,
    },
  );

  async function cancel() {
    if (busy) return;
    // 変えた入力を捨ててよいかを、画面の切り替えと同じ確認で尋ねる（提供元がなければ確認なしで閉じる）
    if (changes !== null && leave !== null && !(await leave.confirmLeave()))
      return;
    onClose();
  }

  const onSubmit = async (values: CaseEditFormValues) => {
    const changed = changesOf(basis, values);
    if (changed === null) return;
    let result;
    try {
      result = await edit.mutateAsync({ ...basis.conflict, ...changed });
    } catch (error) {
      if (isApiError(error) && error.status === 422) {
        const fields = caseEditFieldNames.filter((name) =>
          (error.fields ?? []).includes(name),
        );
        for (const field of fields)
          setError(field, { type: "server", message: error.message });
        if (fields.length === 0)
          setError("root.server", { message: describeError(error) });
        return;
      }
      onFailed(describeError(error));
      return;
    }
    onSaved(result.titleFormatted);
  };

  return (
    <EditDialogFrame busy={busy} onCancel={() => void cancel()}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <dl className="mb-4">
          <dt className="text-sm font-bold">{CASE_EDIT_TEXTS.caseNumber}</dt>
          <dd>{basis.caseNumber}</dd>
        </dl>
        <TextField
          label="件名"
          hint={TITLE_CAUTION}
          autoComplete="off"
          error={messageOf(errors.title, CASE_EDIT_TEXTS.titleError)}
          {...register("title")}
        />
        <SimilarTitleNotice similar={similar} />
        {basis.description !== null && (
          <TextAreaField
            label="説明"
            hint="2000文字以内（任意）"
            error={messageOf(
              errors.description,
              CASE_EDIT_TEXTS.descriptionError,
            )}
            {...register("description")}
          />
        )}
        <SelectField
          label="取引先"
          error={messageOf(errors.clientId, CASE_EDIT_TEXTS.clientError)}
          {...register("clientId")}
        >
          {clientChoices.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </SelectField>
        <Controller
          control={control}
          name="departmentIds"
          render={({ field, fieldState }) => (
            <DepartmentCheckboxes
              departments={departmentChoices}
              value={field.value}
              error={messageOf(
                fieldState.error,
                CASE_EDIT_TEXTS.departmentsError,
              )}
              onChange={field.onChange}
            />
          )}
        />
        {errors.root?.server && (
          <Alert tone="error" role="alert" as="p">
            {errors.root.server.message}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || changes === null}>
            {CASE_EDIT_TEXTS.save}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void cancel()}>
            {CASE_EDIT_TEXTS.cancel}
          </Button>
        </div>
      </form>
    </EditDialogFrame>
  );
}
