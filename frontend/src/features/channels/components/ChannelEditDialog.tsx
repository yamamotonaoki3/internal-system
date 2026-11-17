// チャンネルの名前・説明の編集（#143。EP-2-36）。再認証はしない。読んだ版と一緒に送り、ほかの人の変更と重なればサーバーが 409 にする。
// 画面の検査は shared/channel-name-rules.ts の規則（サーバーの検査は省略しない）。名前は canRename のときだけ出して送る。
// 入力を変えている間は、離れる前の確認（leave-guard）を登録し、キャンセルでも確認する。
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm, type UseFormSetError } from "react-hook-form";
import { z } from "zod";
import {
  CHANNEL_NAME_TAKEN_MESSAGE,
  channelRequestDescriptionSchema,
  channelRequestNameSchema,
} from "../../../../../shared/channel-name-rules";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { TextAreaField } from "../../../components/TextAreaField";
import { TextField } from "../../../components/TextField";
import { useLeaveConfirmation, useLeaveGuard } from "../../leave-guard";
import type { ChannelDetail } from "../api/channel-api";
import { describeError, isApiError } from "../describe-error";
import {
  useRefetchChannelDetail,
  useUpdateChannel,
} from "../hooks/useManageChannel";

const NAME_ERROR =
  "名前は1〜50文字の、ひらがな・カタカナ・漢字・英数字・「-」「_」で入力してください";
const DESCRIPTION_ERROR = "説明は500文字以内で入力してください";

type EditInput = { name: string; description: string };

/** 名前を変えられないチャンネルでは、名前の欄を検査しない（送らない） */
function editSchema(canRename: boolean) {
  return z.object({
    name: canRename ? channelRequestNameSchema : z.string(),
    description: channelRequestDescriptionSchema,
  });
}

/** 422 の fields と名前の重複の 409 は該当の欄へ、それ以外は欄の外へ。ApiError でないものは握りつぶさず投げ直す */
function applyServerError(
  error: unknown,
  setError: UseFormSetError<EditInput>,
): void {
  if (!isApiError(error)) throw error;
  if (error.status === 409 && error.message === CHANNEL_NAME_TAKEN_MESSAGE) {
    setError("name", { type: "server", message: error.message });
    return;
  }
  const fields =
    error.status === 422
      ? (["name", "description"] as const).filter((field) =>
          error.fields?.includes(field),
        )
      : [];
  if (fields.length === 0) {
    setError("root.server", { message: describeError(error) });
    return;
  }
  for (const field of fields)
    setError(field, { type: "server", message: error.message });
}

export function ChannelEditDialog({
  channel,
  onClose,
  onSaved,
}: {
  channel: Pick<
    ChannelDetail,
    "id" | "name" | "description" | "version" | "manage"
  >;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const update = useUpdateChannel(channel.id);
  const refetchDetail = useRefetchChannelDetail(channel.id);
  const leave = useLeaveConfirmation();
  const { canRename, canEditDescription } = channel.manage;
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<EditInput, unknown, EditInput>({
    resolver: zodResolver(editSchema(canRename)),
    defaultValues: { name: channel.name, description: channel.description },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useLeaveGuard({
    isDirty,
    onDiscard: () => reset(),
    focus: () => setFocus(canRename ? "name" : "description"),
  });

  const busy = isSubmitting || update.isPending;

  async function cancel() {
    if (busy) return;
    // 変えた入力を捨ててよいかを、画面の切り替えと同じ確認で尋ねる（提供元がなければ確認なしで閉じる）
    if (isDirty && leave !== null && !(await leave.confirmLeave())) return;
    onClose();
  }

  const onSubmit = async (values: EditInput) => {
    try {
      await update.mutateAsync({
        version: channel.version,
        ...(canRename ? { name: values.name } : {}),
        ...(canEditDescription ? { description: values.description } : {}),
      });
    } catch (error) {
      applyServerError(error, setError);
      // ほかの人の変更・アーカイブと重なった：今の状態を読み直す
      if (isApiError(error) && error.status === 409) await refetchDetail();
      return;
    }
    // 送った値を基準にして、離れる前の確認を外してから閉じる
    reset(values);
    onSaved();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label="チャンネルの編集"
      onCancel={(event) => {
        event.preventDefault();
        void cancel();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <h2 className="mb-4 text-xl font-bold">チャンネルの編集</h2>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        {canRename && (
          <TextField
            label="名前"
            hint="1〜50文字。ひらがな・カタカナ・漢字・英数字と「-」「_」が使えます"
            autoComplete="off"
            error={
              errors.name?.type === "server"
                ? errors.name.message
                : errors.name
                  ? NAME_ERROR
                  : undefined
            }
            {...register("name")}
          />
        )}
        {canEditDescription && (
          <TextAreaField
            label="説明"
            hint="500文字以内"
            error={
              errors.description?.type === "server"
                ? errors.description.message
                : errors.description
                  ? DESCRIPTION_ERROR
                  : undefined
            }
            {...register("description")}
          />
        )}
        {errors.root?.server && (
          <Alert tone="error" role="alert" as="p">
            {errors.root.server.message}
          </Alert>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            保存
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void cancel()}
          >
            キャンセル
          </Button>
        </div>
      </form>
    </dialog>
  );
}
