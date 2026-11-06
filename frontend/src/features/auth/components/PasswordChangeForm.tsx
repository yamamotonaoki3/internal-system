import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { SecretField } from "../../../components/SecretField";
import type { ApiError } from "../../../services/api-client";
import { usePasswordChange } from "../hooks/usePasswordChange";
import { useSession } from "../hooks/useSession";
import {
  createPasswordChangeSchema,
  type PasswordChangeFormValues,
} from "../schemas/password-change-form";

type Props = { onSuccess: () => void; onCancel?: () => void };

const TOGGLE_LABELS = {
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

export function PasswordChangeForm({ onSuccess, onCancel }: Props) {
  const { data } = useSession();
  const changePassword = usePasswordChange();
  if (!data) throw new Error("パスワード変更にはログイン状態が必要です");
  return (
    <PasswordChangeFields
      schema={createPasswordChangeSchema(data.user)}
      changePassword={changePassword}
      onSuccess={onSuccess}
      onCancel={onCancel}
    />
  );
}

type Schema = ReturnType<typeof createPasswordChangeSchema>;
type FieldsProps = Props & {
  schema: Schema;
  changePassword: ReturnType<typeof usePasswordChange>;
};

function PasswordChangeFields({
  schema,
  changePassword,
  onSuccess,
  onCancel,
}: FieldsProps) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordChangeFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmation: "" },
  });

  const onSubmit = async (values: PasswordChangeFormValues) => {
    try {
      const changed = await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      if (changed) onSuccess();
    } catch (error) {
      if (!isApiError(error)) throw error;
      if (error.status === 422 && error.fields?.length) {
        for (const field of error.fields) {
          if (field === "currentPassword" || field === "newPassword") {
            setError(field, {
              message: error.message || "入力内容を確認してください",
            });
          }
        }
      } else if (error.status === 429) {
        setError("root.server", { message: "しばらくしてからお試しください" });
      } else if (error.status === 409) {
        setError("root.server", {
          message: "状態が変わりました。もう一度お試しください",
        });
      } else {
        setError("root.server", {
          message: "変更できませんでした。時間をおいて、もう一度お試しください",
        });
      }
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <p className="mb-4 text-text-muted">
        8〜128文字で、大文字・数字・半角記号を含めてください。
      </p>
      <SecretField
        label="現在のパスワード"
        toggleLabels={TOGGLE_LABELS}
        autoComplete="current-password"
        error={errors.currentPassword?.message}
        {...register("currentPassword")}
      />
      <SecretField
        label="新しいパスワード"
        toggleLabels={TOGGLE_LABELS}
        autoComplete="new-password"
        error={errors.newPassword?.message}
        {...register("newPassword")}
      />
      <SecretField
        label="新しいパスワード（確認）"
        toggleLabels={TOGGLE_LABELS}
        autoComplete="new-password"
        error={errors.confirmation?.message}
        {...register("confirmation")}
      />
      {errors.root?.server && (
        <Alert tone="error" role="alert" as="p">
          {errors.root.server.message}
        </Alert>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "変更中" : "パスワードを変更"}
        </Button>
        {onCancel && (
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            キャンセル
          </Button>
        )}
      </div>
    </form>
  );
}
