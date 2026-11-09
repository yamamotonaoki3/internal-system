// 部署名の変更（EP-2-23）。改名すると、専用チャンネル2つの名前も追従する。
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { departmentNameSchema } from "../../../../shared/department-rules";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import type { Department } from "./department-api";
import { describeWriteError } from "./write-errors";

const formSchema = z.object({ name: departmentNameSchema });
type FormValues = z.infer<typeof formSchema>;

type Props = {
  department: Department;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
};

export function DepartmentRenameForm({ department, onSave, onCancel }: Props) {
  const [serverError, setServerError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: department.name },
  });

  const submit = async (values: FormValues) => {
    setServerError(undefined);
    try {
      await onSave(values.name);
    } catch (error) {
      const message = describeWriteError(error);
      if (message === null) throw error;
      setServerError(message);
    }
  };

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <TextField
        label="部署名"
        maxLength={50}
        error={errors.name ? "部署名を1〜50文字で入力してください" : undefined}
        {...register("name")}
      />
      {serverError && (
        <Alert tone="error" role="alert">
          {serverError}
        </Alert>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "保存中" : "保存"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}
