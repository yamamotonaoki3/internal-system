// S-02 の入力フォーム。送信は onSubmit で直接 await し、失敗の理由は
// 「どちらが違うか」を示さない文言にする（0-2 AC-7）。
import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { SecretField } from "../../../components/SecretField";
import type { ApiError } from "../../../services/api-client";
import { useLogin } from "../hooks/useLogin";
import {
  loginFieldNames,
  loginFormSchema,
  type LoginFieldName,
  type LoginFormValues,
} from "../schemas/login-form";

const PASSWORD_TOGGLE_LABELS = {
  show: "パスワードを表示",
  hide: "パスワードを隠す",
};

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error
  );
}

export function LoginForm() {
  const login = useLogin();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { loginId: "", password: "" },
  });
  const loginIdId = useId();

  const onSubmit = async (values: LoginFormValues) => {
    try {
      await login(values);
      void navigate("/", { replace: true });
    } catch (e) {
      if (!isApiError(e)) throw e;
      if (e.status === 401 && e.code === "INVALID_CREDENTIALS") {
        setError("root.server", {
          message: "ユーザーIDまたはパスワードが違います",
        });
      } else if (e.status === 429) {
        setError("root.server", {
          message: "しばらくしてからお試しください",
        });
      } else if (e.status === 422) {
        const fields = (e.fields ?? []).filter(
          (field): field is LoginFieldName =>
            (loginFieldNames as string[]).includes(field),
        );
        if (fields.length === 0)
          setError("root.server", { message: "入力内容を確かめてください" });
        for (const field of fields)
          setError(field, { message: "入力内容を確かめてください" });
      } else if (e.code === "NETWORK_ERROR") {
        setError("root.server", {
          message: "接続できませんでした。もう一度お試しください",
        });
      } else {
        setError("root.server", {
          message:
            "ログインできませんでした。時間をおいて、もう一度お試しください",
        });
      }
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div>
        <label htmlFor={loginIdId}>ユーザーID</label>
        <input
          id={loginIdId}
          type="text"
          autoComplete="username"
          aria-invalid={errors.loginId ? true : undefined}
          aria-describedby={errors.loginId ? `${loginIdId}-error` : undefined}
          {...register("loginId")}
        />
        {errors.loginId && (
          <p id={`${loginIdId}-error`}>{errors.loginId.message}</p>
        )}
      </div>
      <SecretField
        label="パスワード"
        toggleLabels={PASSWORD_TOGGLE_LABELS}
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      {errors.root?.server && <p role="alert">{errors.root.server.message}</p>}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "ログイン中" : "ログイン"}
      </button>
    </form>
  );
}
