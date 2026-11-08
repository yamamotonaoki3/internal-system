import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  clientCodeSchema,
  clientNameSchema,
} from "../../../../shared/client-rules";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import type { ApiError } from "../../services/api-client";
import type { Client } from "./client-api";

const formSchema = z.object({
  code: clientCodeSchema,
  name: clientNameSchema,
});

type FormValues = z.infer<typeof formSchema>;
type ClientFormProps = {
  client?: Client;
  onSave: (values: FormValues) => Promise<void>;
  onCancel: () => void;
};

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error
  );
}

export function ClientForm({ client, onSave, onCancel }: ClientFormProps) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { code: client?.code ?? "", name: client?.name ?? "" },
  });

  const submit = async (values: FormValues) => {
    try {
      await onSave(values);
    } catch (error) {
      if (!isApiError(error)) throw error;
      if (error.status === 422 && error.fields?.length) {
        for (const field of error.fields) {
          if (field === "code" || field === "name") {
            setError(field, {
              message: error.message || "入力内容を確認してください",
            });
          }
        }
        return;
      }
      setError("root.server", {
        message:
          error.status === 409
            ? error.message ||
              "保存できませんでした。入力内容を確認してください。"
            : error.status === 403
              ? "取引先を管理する権限がありません。"
              : "保存できませんでした。時間をおいて、もう一度お試しください。",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      {client ? (
        <p className="mb-4">取引先コード：{client.code}</p>
      ) : (
        <TextField
          label="取引先コード"
          hint="英大文字3文字で入力してください"
          maxLength={3}
          error={
            errors.code?.message
              ? "取引先コードは英大文字3文字で入力してください"
              : undefined
          }
          {...register("code")}
        />
      )}
      <TextField
        label="取引先名"
        maxLength={50}
        error={
          errors.name?.message
            ? "取引先名を1〜50文字で入力してください"
            : undefined
        }
        {...register("name")}
      />
      {errors.root?.server && (
        <Alert tone="error" role="alert">
          {errors.root.server.message}
        </Alert>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "保存中" : client ? "保存" : "登録"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}
