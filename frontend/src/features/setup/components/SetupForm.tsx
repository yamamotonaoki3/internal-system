// S-34 の入力フォーム。送信（submitSetup）は onSubmit で直接 await し、
// 成功の応答は onRegistered に渡すだけで、このコンポーネントには残さない。
import { zodResolver } from "@hookform/resolvers/zod";
import { useId, type ComponentProps } from "react";
import { useForm } from "react-hook-form";
import type { ApiError } from "../../../services/api-client";
import { submitSetup, type SetupRequest } from "../api/setup-api";
import {
  setupFieldNames,
  setupFormSchema,
  type SetupFieldName,
  type SetupFormInput,
  type SetupFormValues,
} from "../schemas/setup-form";
import { SecretField } from "./SecretField";

export type Registered = { loginId: string; initialPassword: string };

type SetupFormProps = {
  onRegistered: (registered: Registered) => void;
  // 状態を取り直し、まだ未設定なら true を返す
  onConflict: () => Promise<boolean>;
};

type TextFieldProps = Omit<ComponentProps<"input">, "id"> & {
  label: string;
  hint?: string;
  error?: string;
};

function TextField({ label, hint, error, ...inputProps }: TextFieldProps) {
  const id = useId();
  const describedBy =
    [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        {...inputProps}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint && <p id={`${id}-hint`}>{hint}</p>}
      {error && <p id={`${id}-error`}>{error}</p>}
    </div>
  );
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error
  );
}

function toRequest(values: SetupFormValues): SetupRequest {
  const { extension, jobTitle, ...required } = values;
  return {
    ...required,
    ...(extension !== "" && { extension }),
    ...(jobTitle !== "" && { jobTitle }),
  };
}

export function SetupForm({ onRegistered, onConflict }: SetupFormProps) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SetupFormInput, unknown, SetupFormValues>({
    resolver: zodResolver(setupFormSchema),
    defaultValues: {
      setupToken: "",
      companyName: "",
      departmentName: "",
      loginId: "",
      legalName: "",
      email: "",
      extension: "",
      jobTitle: "",
      emailConfirmed: false,
    },
  });
  const confirmErrorId = useId();

  const onSubmit = async (values: SetupFormValues) => {
    try {
      const result = await submitSetup(toRequest(values));
      onRegistered({
        loginId: result.user.loginId,
        initialPassword: result.initialPassword,
      });
    } catch (e) {
      if (!isApiError(e)) throw e;
      if (e.status === 422) {
        // サーバーが返した fields を、該当する入力欄のエラーにする
        const message = e.message || "入力内容を確かめてください";
        const fields = (e.fields ?? []).filter(
          (field): field is SetupFieldName =>
            (setupFieldNames as string[]).includes(field),
        );
        if (fields.length === 0) setError("root.server", { message });
        for (const field of fields) setError(field, { message });
      } else if (e.status === 403 && e.code === "FORBIDDEN_ORIGIN") {
        setError("root.server", {
          message:
            "接続元が許可されていません。接続先と許可設定（運用者）を確認してください",
        });
      } else if (e.status === 403) {
        setError("setupToken", {
          message:
            "トークンが正しくありません。運用者から受け取ったトークンを確かめてください",
        });
      } else if (e.status === 409) {
        // 登録済みになっていれば呼び出し側が「完了済み」を示す。
        // 未設定のまま（社員ID・メール・部署名などの重複）なら、入力を残して直してもらう
        if (await onConflict()) {
          setError("root.server", {
            message: `${e.message}　別の値に直して再送信してください`,
          });
        }
      } else if (e.status === 503) {
        setError("root.server", {
          message:
            "初回セットアップを利用できません。運用者に、セットアップの設定を確かめるよう伝えてください",
        });
      } else {
        setError("root.server", {
          message: "登録できませんでした。時間をおいて、もう一度お試しください",
        });
      }
    }
  };

  const message = (name: SetupFieldName) => errors[name]?.message;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <h2>初回セットアップ</h2>
      <p>
        この登録は、代表取締役社長本人が行います。本人かどうかは、運用者から受け取ったトークンを持っていることで確かめます。
      </p>
      <ol>
        <li>
          <fieldset>
            <legend>手順1　トークンを入力する</legend>
            <SecretField
              label="セットアップ用のトークン"
              error={message("setupToken")}
              {...register("setupToken")}
            />
          </fieldset>
        </li>
        <li>
          <fieldset>
            <legend>手順2　会社と部署を入力する</legend>
            <TextField
              label="会社名"
              autoComplete="off"
              error={message("companyName")}
              {...register("companyName")}
            />
            <TextField
              label="部署名"
              hint="あなたが所属する部署の名前です"
              autoComplete="off"
              error={message("departmentName")}
              {...register("departmentName")}
            />
          </fieldset>
        </li>
        <li>
          <fieldset>
            <legend>手順3　自分の社員アカウントを入力する</legend>
            <TextField
              label="社員ID"
              hint="半角英数字と「.」「_」「-」の3〜32文字"
              autoComplete="off"
              error={message("loginId")}
              {...register("loginId")}
            />
            <TextField
              label="本名"
              hint="1〜30文字。表示名にも使います"
              autoComplete="off"
              error={message("legalName")}
              {...register("legalName")}
            />
            <TextField
              label="メールアドレス"
              type="email"
              autoComplete="off"
              error={message("email")}
              {...register("email")}
            />
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
            <div>
              <label>
                <input
                  type="checkbox"
                  aria-invalid={errors.emailConfirmed ? true : undefined}
                  aria-describedby={
                    errors.emailConfirmed ? confirmErrorId : undefined
                  }
                  {...register("emailConfirmed")}
                />
                会社が発行した自分のメールアドレスだと確認しました
              </label>
              {errors.emailConfirmed && (
                <p id={confirmErrorId}>{errors.emailConfirmed.message}</p>
              )}
            </div>
          </fieldset>
        </li>
        <li>
          <p>
            内容を確かめて登録します。初期パスワードは、登録の成功後に一度だけ表示します。
          </p>
          {errors.root?.server && (
            <p role="alert">{errors.root.server.message}</p>
          )}
          <button type="submit" disabled={isSubmitting}>
            登録する
          </button>
        </li>
      </ol>
    </form>
  );
}
