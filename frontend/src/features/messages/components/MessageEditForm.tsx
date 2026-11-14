// メッセージのその場の編集欄。Enter は改行、Ctrl+Enter（Mac は Cmd+Enter）か「保存」で保存、Esc か「キャンセル」でやめる。
// 本文が元と同じとき・保存中は「保存」を押せない。投稿の入力欄と違い、端末の下書きと離脱の確認の対象にしない（C-170(5)）。
import { zodResolver } from "@hookform/resolvers/zod";
import type { KeyboardEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { TextAreaField } from "../../../components/TextAreaField";
import { describeError, isApiError } from "../describe-error";
import { useEditMessage } from "../hooks/useEditMessage";
import {
  messageFormSchema,
  type MessageFormValues,
} from "../schemas/message-form";

type MessageEditFormProps = {
  roomId: string;
  messageId: string;
  /** 編集の前の本文 */
  originalBody: string;
  onClose: () => void;
};

export function MessageEditForm({
  roomId,
  messageId,
  originalBody,
  onClose,
}: MessageEditFormProps) {
  const edit = useEditMessage(roomId);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<MessageFormValues>({
    resolver: zodResolver(messageFormSchema),
    defaultValues: { body: originalBody },
  });
  const unchanged = useWatch({ control, name: "body" }) === originalBody;

  const onSubmit = async (values: MessageFormValues) => {
    try {
      await edit.mutateAsync({ messageId, body: values.body });
    } catch (e) {
      if (!isApiError(e)) throw e;
      // サーバーが返した fields に body があれば入力欄のエラーに、それ以外は上に出す
      if (e.status === 422 && (e.fields ?? []).includes("body"))
        setError("body", { message: e.message });
      else setError("root.server", { message: describeError(e) });
      return;
    }
    onClose();
  };

  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      onClose();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!isSubmitting && !unchanged) void handleSubmit(onSubmit)();
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      {errors.root?.server?.message && (
        <Alert tone="error" role="alert">
          {errors.root.server.message}
        </Alert>
      )}
      <TextAreaField
        label="メッセージの編集"
        hint="Enter で改行、Ctrl+Enter（Mac は Cmd+Enter）で保存、Esc でやめます"
        error={errors.body?.message}
        {...register("body")}
        onKeyDown={handleKey}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting || unchanged}>
          保存
        </Button>
        <Button variant="secondary" onClick={onClose}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}
