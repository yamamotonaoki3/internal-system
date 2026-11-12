// S-10 の申請フォーム。作る場所（自部署／会社直属）・公開範囲・名前・説明を送る。部署は送らない（サーバーが本人の所属から決める）。
// 所属がない社員は「自部署のチャンネル」を選べない（所属は自分のプロフィールから知る）。
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type UseFormSetError } from "react-hook-form";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { SelectField } from "../../../components/SelectField";
import { TextAreaField } from "../../../components/TextAreaField";
import { TextField } from "../../../components/TextField";
import { useMyProfile } from "../../profile";
import { describeError, isApiError } from "../describe-error";
import { useCreateChannelRequest } from "../hooks/useCreateChannelRequest";
import {
  channelRequestFieldNames,
  channelRequestFormSchema,
  type ChannelRequestFormInput,
  type ChannelRequestFormValues,
} from "../schemas/channel-request-form";

const CASE_GUIDE =
  "案件に関する話題のチャンネルは、非公開をおすすめします。案件ごとのやり取りは、案件の作成が承認されると自動でできる非公開の専用チャンネルで行えます。";

/** サーバーの 422 の fields は該当の欄へ、それ以外（409 など）は欄の外のエラーにする。ApiError でないものは握りつぶさず投げ直す */
function applyServerError(
  error: unknown,
  setError: UseFormSetError<ChannelRequestFormInput>,
): void {
  if (!isApiError(error)) throw error;
  const fields =
    error.status === 422
      ? channelRequestFieldNames.filter((name) => error.fields?.includes(name))
      : [];
  if (fields.length === 0) {
    setError("root.server", { message: describeError(error) });
    return;
  }
  for (const field of fields)
    setError(field, { type: "server", message: error.message });
}

function RequestFields({ hasDepartment }: { hasDepartment: boolean }) {
  const create = useCreateChannelRequest();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChannelRequestFormInput, unknown, ChannelRequestFormValues>({
    resolver: zodResolver(channelRequestFormSchema),
    defaultValues: {
      scope: hasDepartment ? "department" : "company",
      visibility: "public",
      name: "",
      description: "",
    },
  });

  const onSubmit = async (values: ChannelRequestFormValues) => {
    try {
      await create.mutateAsync(values);
    } catch (error) {
      applyServerError(error, setError);
      return;
    }
    // 作る場所・公開範囲は、続けて申請しやすいよう残す
    reset({ ...values, name: "", description: "" });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="mb-8">
      <SelectField
        label="作る場所"
        error={errors.scope?.message}
        {...register("scope")}
      >
        <option value="department" disabled={!hasDepartment}>
          自部署のチャンネル
        </option>
        <option value="company">会社直属のチャンネル</option>
      </SelectField>
      <SelectField
        label="公開範囲"
        error={errors.visibility?.message}
        {...register("visibility")}
      >
        <option value="public">公開</option>
        <option value="private">非公開</option>
      </SelectField>
      <Alert tone="info" as="p">
        {CASE_GUIDE}
      </Alert>
      <TextField
        label="チャンネル名"
        hint="1〜50文字。ひらがな・カタカナ・漢字・英数字と「-」「_」が使えます（空白は使えません）"
        autoComplete="off"
        error={
          errors.name?.type === "server"
            ? errors.name.message
            : errors.name
              ? "チャンネル名は1〜50文字の、ひらがな・カタカナ・漢字・英数字・「-」「_」で入力してください"
              : undefined
        }
        {...register("name")}
      />
      <TextAreaField
        label="説明"
        hint="500文字以内"
        error={
          errors.description?.type === "server"
            ? errors.description.message
            : errors.description
              ? "説明は500文字以内で入力してください"
              : undefined
        }
        {...register("description")}
      />
      {errors.root?.server && (
        <Alert tone="error" role="alert" as="p">
          {errors.root.server.message}
        </Alert>
      )}
      <Button type="submit" disabled={isSubmitting}>
        申請する
      </Button>
    </form>
  );
}

export function ChannelRequestForm() {
  const profile = useMyProfile();
  if (profile.isPending) return <p role="status">入力欄を準備しています</p>;
  if (profile.isError)
    return (
      <Alert tone="error" role="alert">
        {describeError(profile.error)}
      </Alert>
    );
  return <RequestFields hasDepartment={profile.data.department !== null} />;
}
