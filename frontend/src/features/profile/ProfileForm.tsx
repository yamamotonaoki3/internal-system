// S-19 プロフィール設定。表示名のフォームと、ステータス（種類・戻り予定・一言メッセージ）のフォーム。
// 部署・役職・メール・内線・本名は表示だけ（変更は管理者の操作で、この画面では行わない）。値はサーバーの応答（useMyProfile）から作り、成功後は取り直す。
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import type { MyProfile } from "./api/profile-api";
import { useMyProfile } from "./hooks/useMyProfile";
import { useUpdateMyProfile } from "./hooks/useUpdateMyProfile";
import { isoToLocal, localToIso, returnAtBounds } from "./return-at";
import {
  displayNameFieldNames,
  displayNameFormSchema,
  statusFieldNames,
  statusFormSchema,
  type DisplayNameFormInput,
  type DisplayNameFormValues,
  type StatusFormInput,
  type StatusFormValues,
} from "./schemas/profile-form";
import { applyServerError } from "./server-errors";
import { StatusKindRadios } from "./StatusKindRadios";
import { describeError } from "./describe-error";

function DisplayNameForm({ profile }: { profile: MyProfile }) {
  const update = useUpdateMyProfile();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DisplayNameFormInput, unknown, DisplayNameFormValues>({
    resolver: zodResolver(displayNameFormSchema),
    values: { displayName: profile.displayName },
    resetOptions: { keepDirtyValues: true },
  });

  const onSubmit = async (values: DisplayNameFormValues) => {
    try {
      await update.mutateAsync({ displayName: values.displayName });
    } catch (error) {
      applyServerError(error, setError, displayNameFieldNames);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="mb-8">
      <h2 className="mb-2 text-lg font-bold">表示名</h2>
      <TextField
        label="表示名"
        hint="1〜30文字。ほかの人に表示される名前です"
        autoComplete="off"
        error={errors.displayName?.message}
        {...register("displayName")}
      />
      {errors.root?.server && (
        <Alert tone="error" role="alert" as="p">
          {errors.root.server.message}
        </Alert>
      )}
      <Button type="submit" disabled={isSubmitting}>
        表示名を保存
      </Button>
    </form>
  );
}

function StatusForm({ profile }: { profile: MyProfile }) {
  const update = useUpdateMyProfile();
  const [bounds] = useState(() => returnAtBounds(new Date()));
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<StatusFormInput, unknown, StatusFormValues>({
    resolver: zodResolver(statusFormSchema),
    values: {
      status: profile.status.kind,
      returnAt: isoToLocal(profile.status.returnAt),
      statusMessage: profile.status.message ?? "",
    },
    resetOptions: { keepDirtyValues: true },
  });

  const onSubmit = async (values: StatusFormValues) => {
    try {
      await update.mutateAsync({
        status: values.status,
        ...(values.returnAt === ""
          ? {}
          : { returnAt: localToIso(values.returnAt) }),
        statusMessage: values.statusMessage,
      });
    } catch (error) {
      applyServerError(error, setError, statusFieldNames);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="mb-8">
      <h2 className="mb-2 text-lg font-bold">ステータス</h2>
      <Controller
        control={control}
        name="status"
        render={({ field }) => (
          <StatusKindRadios
            value={field.value}
            onChange={(kind) => {
              field.onChange(kind);
              if (kind === "available") setValue("returnAt", "");
            }}
          />
        )}
      />
      <TextField
        label="戻り予定"
        type="datetime-local"
        min={bounds.min}
        max={bounds.max}
        error={errors.returnAt?.message}
        {...register("returnAt")}
      />
      <TextField
        label="一言メッセージ"
        hint="100文字まで"
        autoComplete="off"
        error={errors.statusMessage?.message}
        {...register("statusMessage")}
      />
      {errors.root?.server && (
        <Alert tone="error" role="alert" as="p">
          {errors.root.server.message}
        </Alert>
      )}
      <Button type="submit" disabled={isSubmitting}>
        ステータスを保存
      </Button>
    </form>
  );
}

function ReadOnlyItems({ profile }: { profile: MyProfile }) {
  const items: [string, string][] = [
    ["本名", profile.legalName],
    ["部署", profile.department?.name ?? "所属なし"],
    ["役職", profile.jobTitle ?? "未設定"],
    ["メール", profile.email],
    ["内線", profile.extension ?? "未設定"],
  ];
  return (
    <section aria-labelledby="profile-readonly-heading">
      <h2 id="profile-readonly-heading" className="mb-2 text-lg font-bold">
        登録されている情報
      </h2>
      <p className="mb-2 text-text-muted">
        この画面では変更できません。変更は管理者に依頼してください。
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {items.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-text-muted">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ProfileForm() {
  const profile = useMyProfile();
  if (profile.isPending) return <p role="status">読み込み中です</p>;
  if (profile.isError)
    return (
      <Alert tone="error" role="alert">
        {describeError(profile.error)}
      </Alert>
    );
  return (
    <>
      <DisplayNameForm profile={profile.data} />
      <StatusForm profile={profile.data} />
      <ReadOnlyItems profile={profile.data} />
    </>
  );
}
