// チャンネルの名前・説明の編集（#143。EP-2-36）。再認証はしない。読んだ版と一緒に送り、ほかの人の変更と重なればサーバーが 409 にする。
// 画面の検査は shared/channel-name-rules.ts の規則（サーバーの検査は省略しない）。名前は canRename のときだけ出して送る。
// 入力を変えている間は、離れる前の確認（leave-guard）を登録し、キャンセルでも確認する。
// 「最新の内容を読み込む」の応答を待つ間は、入力欄と保存を無効にする（応答で入力が上書きされて失われないように。#290）。
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import {
  useForm,
  type FieldError,
  type UseFormSetError,
} from "react-hook-form";
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
  useLoadLatestChannel,
  useUpdateChannel,
} from "../hooks/useManageChannel";

const NAME_ERROR =
  "名前は1〜50文字の、ひらがな・カタカナ・漢字・英数字・「-」「_」で入力してください";
const DESCRIPTION_ERROR = "説明は500文字以内で入力してください";
const STALE_MESSAGE =
  "ほかの人が先に変更しました。最新の内容を読み込んでから、もう一度編集してください";

type EditInput = { name: string; description: string };

/** 欄のエラーの文：サーバーの文はそのまま、画面の検査は決まった文 */
function fieldMessage(
  error: FieldError | undefined,
  fallback: string,
): string | undefined {
  if (error === undefined) return undefined;
  return error.type === "server" ? error.message : fallback;
}

/** 「最新の内容を読み込む」で読む内容 */
export type LatestChannel = {
  name: string;
  description: string;
  version: number;
};

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
  loadLatest: loadLatestOverride,
}: {
  channel: Pick<
    ChannelDetail,
    "id" | "name" | "description" | "version" | "manage"
  >;
  onClose: () => void;
  onSaved: () => void;
  /** 最新の内容の読み方。省略時はチャンネルの詳細（EP-2-06）。S-39 は管理者用の1件（EP-2-43）を渡す */
  loadLatest?: () => Promise<LatestChannel>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const update = useUpdateChannel(channel.id);
  const loadLatestDetail = useLoadLatestChannel(channel.id);
  const loadLatest = loadLatestOverride ?? loadLatestDetail;
  // 送る版は、開いた時点（または「最新の内容を読み込む」の時点）のもの。背景の再取得で進んだ版で、古い入力を送らない
  const [baseVersion, setBaseVersion] = useState(channel.version);
  // 版の 409 の後は、最新の内容を読み込むまで保存しない
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);
  // 読み込みが終わり、欄が有効に戻った後に、フォーカスを入力欄へ戻す（無効にした間にフォーカスが外れるため）
  const focusAfterLoadRef = useRef(false);
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
  const focusField = canRename ? "name" : "description";

  useEffect(() => {
    if (loading || !focusAfterLoadRef.current) return;
    focusAfterLoadRef.current = false;
    setFocus(focusField);
  }, [loading, focusField, setFocus]);

  async function cancel() {
    if (busy) return;
    // 変えた入力を捨ててよいかを、画面の切り替えと同じ確認で尋ねる（提供元がなければ確認なしで閉じる）
    if (isDirty && leave !== null && !(await leave.confirmLeave())) return;
    onClose();
  }

  async function reload() {
    setLoading(true);
    try {
      const latest = await loadLatest();
      reset({ name: latest.name, description: latest.description });
      setBaseVersion(latest.version);
      setStale(false);
    } catch (error) {
      setError("root.server", { message: describeError(error) });
    } finally {
      focusAfterLoadRef.current = true;
      setLoading(false);
    }
  }

  const onSubmit = async (values: EditInput) => {
    if (stale) return;
    try {
      await update.mutateAsync({
        version: baseVersion,
        ...(canRename ? { name: values.name } : {}),
        ...(canEditDescription ? { description: values.description } : {}),
      });
    } catch (error) {
      // 名前の重複以外の 409 は、ほかの人の変更と重なった：入力を保ったまま、最新の内容の読み込みを求める
      if (
        isApiError(error) &&
        error.status === 409 &&
        error.message !== CHANNEL_NAME_TAKEN_MESSAGE
      ) {
        setStale(true);
        return;
      }
      applyServerError(error, setError);
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
            error={fieldMessage(errors.name, NAME_ERROR)}
            {...register("name")}
            disabled={loading}
          />
        )}
        {canEditDescription && (
          <TextAreaField
            label="説明"
            hint="500文字以内"
            error={fieldMessage(errors.description, DESCRIPTION_ERROR)}
            {...register("description")}
            disabled={loading}
          />
        )}
        {stale && (
          <Alert tone="error" role="alert">
            <p className="mb-2">{STALE_MESSAGE}</p>
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => void reload()}
            >
              最新の内容を読み込む
            </Button>
          </Alert>
        )}
        {errors.root?.server && (
          <Alert tone="error" role="alert" as="p">
            {errors.root.server.message}
          </Alert>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || loading}>
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
