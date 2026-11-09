// 部署作成の入力（S-08）。オーナーを指名しなければ、作った全体管理者がオーナーになる。成功したら一覧へ移る。
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";
import {
  departmentDescriptionSchema,
  departmentNameSchema,
} from "../../../../shared/department-rules";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { fetchOwnerCandidates } from "./department-api";
import { needsSuccessor } from "./owner-selection";
import { OwnerSelectFields } from "./OwnerSelectFields";
import { departmentKeys } from "./query-keys";
import { useDepartmentMutations } from "./useDepartmentMutations";
import { describeWriteError } from "./write-errors";

const formSchema = z.object({
  name: departmentNameSchema,
  description: departmentDescriptionSchema,
});
type FormValues = z.infer<typeof formSchema>;

export function DepartmentCreateForm() {
  const navigate = useNavigate();
  const { create } = useDepartmentMutations();
  const candidates = useQuery({
    queryKey: departmentKeys.ownerCandidates,
    queryFn: fetchOwnerCandidates,
    retry: false,
  });
  const [ownerUserId, setOwnerUserId] = useState("");
  const [successorUserId, setSuccessorUserId] = useState("");
  const [successorError, setSuccessorError] = useState<string>();
  const [serverError, setServerError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "" },
  });

  const submit = async (values: FormValues) => {
    setServerError(undefined);
    const owner = candidates.data?.find((c) => c.id === ownerUserId);
    if (needsSuccessor(owner) && successorUserId === "") {
      setSuccessorError("元部署の後任を選んでください");
      return;
    }
    setSuccessorError(undefined);
    try {
      await create.mutateAsync({
        name: values.name,
        description: values.description,
        ...(ownerUserId === "" ? {} : { ownerUserId }),
        ...(successorUserId === ""
          ? {}
          : { previousDepartmentSuccessorUserId: successorUserId }),
      });
    } catch (error) {
      const message = describeWriteError(error);
      if (message === null) throw error;
      setServerError(message);
      return;
    }
    await navigate("/departments");
  };

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <TextField
        label="部署名"
        maxLength={50}
        error={errors.name ? "部署名を1〜50文字で入力してください" : undefined}
        {...register("name")}
      />
      <TextField
        label="説明"
        maxLength={500}
        error={
          errors.description ? "説明は500文字以内で入力してください" : undefined
        }
        {...register("description")}
      />
      {candidates.isError && (
        <Alert tone="error" role="alert">
          オーナーの候補を取得できませんでした。再読み込みしてください。
        </Alert>
      )}
      <OwnerSelectFields
        ownerLabel="オーナー"
        noneLabel="指名しない（作成した自分がオーナー）"
        candidates={candidates.data ?? []}
        ownerUserId={ownerUserId}
        successorUserId={successorUserId}
        successorError={successorError}
        onOwnerChange={setOwnerUserId}
        onSuccessorChange={setSuccessorUserId}
      />
      {serverError && (
        <Alert tone="error" role="alert">
          {serverError}
        </Alert>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "作成中" : "作成"}
      </Button>
    </form>
  );
}
