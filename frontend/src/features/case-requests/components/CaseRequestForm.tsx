// S-18 の申請フォーム。取引先・件名・説明・納期・担当部署（複数）・追加の候補を送る。
// 件名と取引先が入って入力が止まったら類似件名を確かめ、似ていれば警告を出す（送信は止めない。5-3 AC-14）。
// 所属がなく全体管理者でもない社員には申請できない旨を出し、送らせない（サーバーも 403 にする）。
// 説明だけを下書きとして保存し（C-120）、送信が成功したら消す。失敗したら残す。
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import {
  Controller,
  useForm,
  useWatch,
  type FieldError,
  type UseFormSetError,
} from "react-hook-form";
import {
  isDueDateBeforeToday,
  jstDateOf,
} from "../../../../../shared/case-rules";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { SelectField } from "../../../components/SelectField";
import { TextAreaField } from "../../../components/TextAreaField";
import { TextField } from "../../../components/TextField";
import type { useDraft } from "../../drafts";
import type {
  CandidateUser,
  CaseRequestItem,
  Choice,
  CreateCaseRequestInput,
} from "../api/case-request-api";
import { describeError, isApiError } from "../describe-error";
import { useCreateCaseRequest } from "../hooks/useCreateCaseRequest";
import { useSettledValue } from "../hooks/useSettledValue";
import { useSimilarTitle } from "../hooks/useSimilarTitle";
import {
  caseRequestFieldNames,
  caseRequestFormSchema,
  type CaseRequestFormValues,
} from "../schemas/case-request-form";
import { CandidatePicker } from "./CandidatePicker";

const TITLE_CAUTION =
  "件名は参加していない人にも見える場合があります。機密情報を書かないでください";
const SIMILAR_DELAY_MS = 400;
const DUE_DATE_ERROR = "納期は今日以降の日付を選んでください";

type Draft = ReturnType<typeof useDraft>;

type Props = {
  /** 読み込み中は undefined */
  clients: Choice[] | undefined;
  departments: Choice[] | undefined;
  /** 所属がある、または全体管理者。判定に要るものを読み込み中は undefined（送らせない） */
  canRequest: boolean | undefined;
  userId: string | undefined;
  draft: Draft;
  /** 「修正して再申請」の元の申請。フォームに値を入れ、送るときに resubmitOf を付ける */
  resubmit: CaseRequestItem | null;
};

const blankValues = (description: string): CaseRequestFormValues => ({
  clientId: "",
  title: "",
  description,
  dueDate: "",
  departmentIds: [],
});

const valuesOf = (item: CaseRequestItem): CaseRequestFormValues => ({
  clientId: item.client.id,
  title: item.title,
  description: item.description,
  dueDate: item.dueDate ?? "",
  departmentIds: item.departments.map((department) => department.id),
});

const candidatesOf = (item: CaseRequestItem | null): CandidateUser[] =>
  (item?.candidates ?? []).map(({ userId, displayName }) => ({
    id: userId,
    displayName,
  }));

/** 送る本文。納期が空なら送らない（納期なし）。再申請のときだけ元の申請の ID を付ける */
const inputOf = (
  values: CaseRequestFormValues,
  candidates: readonly CandidateUser[],
  resubmitOf: string | null,
): CreateCaseRequestInput => ({
  clientId: values.clientId,
  title: values.title,
  description: values.description,
  ...(values.dueDate === "" ? {} : { dueDate: values.dueDate }),
  departmentIds: values.departmentIds,
  candidateIds: candidates.map((user) => user.id),
  ...(resubmitOf === null ? {} : { resubmitOf }),
});

/** 欄のエラーの文：サーバーの 422 はサーバーの文、入力チェックの誤りは決めた文。invalid は値から分かる誤り */
function messageOf(
  error: FieldError | undefined,
  fallback: string,
  invalid = false,
): string | undefined {
  if (error?.type === "server") return error.message;
  return error !== undefined || invalid ? fallback : undefined;
}

function DepartmentCheckboxes({
  departments,
  value,
  error,
  onChange,
}: {
  departments: Choice[] | undefined;
  value: string[];
  error: string | undefined;
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="mb-4" aria-invalid={error ? true : undefined}>
      <legend className="mb-1 text-sm font-bold">担当部署</legend>
      {departments === undefined && <p>部署の候補を準備しています</p>}
      {departments?.map((department) => (
        <label key={department.id} className="mr-4 inline-flex gap-1">
          <input
            type="checkbox"
            checked={value.includes(department.id)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...value, department.id]
                  : value.filter((id) => id !== department.id),
              )
            }
          />
          {department.name}
        </label>
      ))}
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </fieldset>
  );
}

/** サーバーの 422 の fields は該当の欄へ、それ以外（409・403 など）は欄の外のエラーにする。ApiError でないものは投げ直す */
function applyServerError(
  error: unknown,
  setError: UseFormSetError<CaseRequestFormValues>,
  setCandidateError: (message: string) => void,
): void {
  if (!isApiError(error)) throw error;
  const fields = error.status === 422 ? (error.fields ?? []) : [];
  const formFields = caseRequestFieldNames.filter((name) =>
    fields.includes(name),
  );
  for (const field of formFields)
    setError(field, { type: "server", message: error.message });
  if (fields.includes("candidateIds")) setCandidateError(error.message);
  if (formFields.length === 0 && !fields.includes("candidateIds"))
    setError("root.server", { message: describeError(error) });
}

export function CaseRequestForm({
  clients,
  departments,
  canRequest,
  userId,
  draft,
  resubmit,
}: Props) {
  const create = useCreateCaseRequest();
  const [candidates, setCandidates] = useState(() => candidatesOf(resubmit));
  const [resubmitOf, setResubmitOf] = useState(resubmit?.id ?? null);
  const [candidateError, setCandidateError] = useState<string>();
  const [result, setResult] = useState<{ titleFormatted: boolean } | null>(
    null,
  );
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CaseRequestFormValues>({
    resolver: zodResolver(caseRequestFormSchema),
    defaultValues:
      resubmit === null ? blankValues(draft.initialBody) : valuesOf(resubmit),
  });
  const [clientId, title, dueDate] = useWatch({
    control,
    name: ["clientId", "title", "dueDate"],
  });
  const similar = useSimilarTitle(
    useSettledValue(clientId, SIMILAR_DELAY_MS),
    useSettledValue(title, SIMILAR_DELAY_MS),
  );
  // 過去の納期（再申請で元の値を入れたときを含む）は、送る前から欄のエラーにする
  const dueDateIsPast =
    dueDate !== "" && isDueDateBeforeToday(dueDate, new Date());

  const onSubmit = async (values: CaseRequestFormValues) => {
    if (canRequest !== true) return;
    setResult(null);
    setCandidateError(undefined);
    let created;
    try {
      created = await create.mutateAsync(
        inputOf(values, candidates, resubmitOf),
      );
    } catch (error) {
      applyServerError(error, setError, setCandidateError);
      return;
    }
    draft.discard();
    reset(blankValues(""));
    setCandidates([]);
    setResubmitOf(null);
    setResult({ titleFormatted: created.titleFormatted });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="mb-8">
      {canRequest === false && (
        <Alert tone="error" as="p">
          所属部署がないため申請できません
        </Alert>
      )}
      {clients === undefined ? (
        <p className="mb-4">取引先の候補を準備しています</p>
      ) : (
        <SelectField
          label="取引先"
          error={messageOf(errors.clientId, "取引先を選んでください")}
          {...register("clientId")}
        >
          <option value="">選んでください</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </SelectField>
      )}
      <TextField
        label="件名"
        hint={TITLE_CAUTION}
        autoComplete="off"
        error={messageOf(errors.title, "件名は1〜100文字で入力してください")}
        {...register("title")}
      />
      {similar.data?.hasSimilar === true && (
        <Alert tone="info" as="p">
          似た案件があります
        </Alert>
      )}
      <TextAreaField
        label="説明"
        hint="2000文字以内（任意）"
        error={messageOf(
          errors.description,
          "説明は2000文字以内で入力してください",
        )}
        {...register("description", {
          onChange: (event: { target: { value: string } }) =>
            draft.save(event.target.value),
        })}
      />
      {draft.unavailable && (
        <Alert tone="info" as="p">
          この環境では下書きを一時保存できません。
        </Alert>
      )}
      <TextField
        label="納期"
        type="date"
        min={jstDateOf(new Date()).date}
        error={messageOf(errors.dueDate, DUE_DATE_ERROR, dueDateIsPast)}
        {...register("dueDate")}
      />
      <Controller
        control={control}
        name="departmentIds"
        render={({ field, fieldState }) => (
          <DepartmentCheckboxes
            departments={departments}
            value={field.value}
            error={messageOf(
              fieldState.error,
              "担当部署を1つ以上選んでください",
            )}
            onChange={field.onChange}
          />
        )}
      />
      <CandidatePicker
        selfId={userId}
        selected={candidates}
        error={candidateError}
        onChange={(next) => {
          setCandidateError(undefined);
          setCandidates(next);
        }}
      />
      {errors.root?.server && (
        <Alert tone="error" role="alert" as="p">
          {errors.root.server.message}
        </Alert>
      )}
      {result !== null && (
        <div role="status" className="mb-4">
          <p>案件の作成を申請しました。承認されると案件が作られます</p>
          {result.titleFormatted && <p>表記を整えて保存しました</p>}
        </div>
      )}
      <Button type="submit" disabled={canRequest !== true || isSubmitting}>
        申請する
      </Button>
    </form>
  );
}
