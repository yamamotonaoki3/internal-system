// S-23 の入力フォーム。送信（submitAccount）は onSubmit で直接 await し、
// 成功の応答は onRegistered に渡すだけで、このコンポーネントには残さない（初期パスワードをキャッシュに残さない）。
// 入力値は React の状態の中だけに置き、localStorage・sessionStorage・URL には保存しない。
import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useRef } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import type { ApiError } from "../../services/api-client";
import {
  submitAccount,
  type AccountCreateRequest,
  type DepartmentOption,
} from "./account-api";
import { SelectField } from "../../components/SelectField";
import {
  accountFieldNames,
  accountFormSchema,
  initialDisplayName,
  type AccountFieldName,
  type AccountFormInput,
  type AccountFormValues,
} from "./schemas/account-form";

export type Registered = { loginId: string; initialPassword: string };

type AccountFormProps = {
  departments: DepartmentOption[];
  onRegistered: (registered: Registered) => void;
};

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error
  );
}

function toRequest(values: AccountFormValues): AccountCreateRequest {
  const { extension, jobTitle, ...required } = values;
  return {
    ...required,
    ...(extension !== "" && { extension }),
    ...(jobTitle !== "" && { jobTitle }),
  };
}

export function AccountForm({ departments, onRegistered }: AccountFormProps) {
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AccountFormInput, unknown, AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      loginId: "",
      legalName: "",
      displayName: "",
      email: "",
      departmentId: "",
      extension: "",
      jobTitle: "",
      emailConfirmed: false,
    },
  });
  const confirmErrorId = useId();
  // 表示名を利用者が書き換えたら、本名に合わせた初期値の入れ替えをやめる
  const displayNameEdited = useRef(false);

  const legalName = register("legalName");
  const displayName = register("displayName");

  const onSubmit = async (values: AccountFormValues) => {
    try {
      const result = await submitAccount(toRequest(values));
      onRegistered({
        loginId: result.loginId,
        initialPassword: result.initialPassword,
      });
    } catch (e) {
      if (!isApiError(e)) throw e;
      if (e.status === 422) {
        // サーバーが返した fields を、該当する入力欄のエラーにする
        const message = e.message || "入力内容を確かめてください";
        const fields = (e.fields ?? []).filter(
          (field): field is AccountFieldName =>
            (accountFieldNames as string[]).includes(field),
        );
        if (fields.length === 0) setError("root.server", { message });
        for (const field of fields) setError(field, { message });
      } else if (e.status === 409) {
        // 重複したユーザーID・メール。入力を残して直してもらう
        setError("root.server", {
          message: `${e.message}　別の値に直して再送信してください`,
        });
      } else if (e.status === 403) {
        setError("root.server", {
          message: "この操作を行う権限がありません",
        });
      } else if (e.status === 503) {
        setError("root.server", {
          message:
            "アカウントの登録を利用できません。運用者に、設定を確かめるよう伝えてください",
        });
      } else {
        setError("root.server", {
          message: "登録できませんでした。時間をおいて、もう一度お試しください",
        });
      }
    }
  };

  const message = (name: AccountFieldName) => errors[name]?.message;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <TextField
        label="社員ID"
        hint="半角英数字と「.」「_」「-」の3〜32文字。大文字と小文字は区別せず、重複できません"
        autoComplete="off"
        error={message("loginId")}
        {...register("loginId")}
      />
      <TextField
        label="本名"
        hint="1〜50文字。表示名の初期値になります"
        autoComplete="off"
        error={message("legalName")}
        {...legalName}
        onChange={(event) => {
          void legalName.onChange(event);
          if (!displayNameEdited.current)
            setValue("displayName", initialDisplayName(event.target.value));
        }}
      />
      <TextField
        label="表示名"
        hint="1〜30文字。ほかの人に表示される名前です"
        autoComplete="off"
        error={message("displayName")}
        {...displayName}
        onChange={(event) => {
          displayNameEdited.current = true;
          void displayName.onChange(event);
        }}
      />
      <TextField
        label="メールアドレス"
        type="email"
        autoComplete="off"
        error={message("email")}
        {...register("email")}
      />
      <SelectField
        label="所属部署"
        error={message("departmentId")}
        {...register("departmentId")}
      >
        <option value="">選択してください</option>
        {departments.map((department) => (
          <option key={department.id} value={department.id}>
            {department.name}
          </option>
        ))}
      </SelectField>
      <TextField
        label="内線番号（任意）"
        hint="半角数字とハイフンの10文字以内"
        autoComplete="off"
        error={message("extension")}
        {...register("extension")}
      />
      <TextField
        label="役職（任意）"
        autoComplete="off"
        error={message("jobTitle")}
        {...register("jobTitle")}
      />
      <div className="mb-4">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1 size-5 shrink-0"
            aria-invalid={errors.emailConfirmed ? true : undefined}
            aria-describedby={
              errors.emailConfirmed ? confirmErrorId : undefined
            }
            {...register("emailConfirmed")}
          />
          会社が発行したメールアドレスだと確認しました
        </label>
        {errors.emailConfirmed && (
          <p id={confirmErrorId} className="mt-1 text-sm text-danger">
            {errors.emailConfirmed.message}
          </p>
        )}
      </div>
      <p className="mb-3">
        初期パスワードは、登録の成功後に一度だけ表示します。
      </p>
      {errors.root?.server && (
        <Alert tone="error" role="alert" as="p">
          {errors.root.server.message}
        </Alert>
      )}
      <Button type="submit" disabled={isSubmitting}>
        登録する
      </Button>
    </form>
  );
}
