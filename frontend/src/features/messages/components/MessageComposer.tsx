// メッセージの入力欄。Enter は改行、Ctrl+Enter（Mac は Cmd+Enter）か「送信」ボタンで送る。
// 送信中（投稿と一覧の取り直しが終わるまで）は「送信」を押せない。成功したら入力欄を空にする。
// 書きかけの本文は端末に下書きとして保存し（features/drafts）、入力欄を作り直すと復元する。送信に成功したら消す。
// 復元した値（なければ空）から変わっているあいだは、画面を離れる前に確認を出す（features/leave-guard）。
import { zodResolver } from "@hookform/resolvers/zod";
import type { ChangeEvent, KeyboardEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { TextAreaField } from "../../../components/TextAreaField";
import { isBlankDraft, roomDraftScope, useDraft } from "../../drafts";
import { useLeaveGuard } from "../../leave-guard";
import { describeError, isApiError } from "../describe-error";
import { usePostMessage } from "../hooks/usePostMessage";
import {
  messageFormSchema,
  type MessageFormValues,
} from "../schemas/message-form";

type MessageComposerProps = {
  roomId: string;
  /** ログイン中の利用者のID。下書きのキーに使う。なければ下書きを読み書きしない */
  userId?: string;
  onPosted?: () => void;
  onPostError?: (error: unknown) => void;
};

export function MessageComposer({
  roomId,
  userId,
  onPosted,
  onPostError,
}: MessageComposerProps) {
  const post = usePostMessage(roomId);
  const draft = useDraft(userId, roomDraftScope(roomId));
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setFocus,
    control,
    formState: { errors, isSubmitting },
  } = useForm<MessageFormValues>({
    resolver: zodResolver(messageFormSchema),
    defaultValues: { body: draft.initialBody },
  });
  const body = useWatch({ control, name: "body" });
  useLeaveGuard({
    isDirty: !isBlankDraft(body) && body !== draft.initialBody,
    onDiscard: draft.discard,
    focus: () => setFocus("body"),
  });

  const onSubmit = async (values: MessageFormValues) => {
    try {
      await post.mutateAsync(values.body);
    } catch (e) {
      onPostError?.(e);
      if (!isApiError(e)) throw e;
      // サーバーが返した fields に body があれば入力欄のエラーに、それ以外は上に出す
      if (e.status === 422 && (e.fields ?? []).includes("body"))
        setError("body", { message: e.message });
      else setError("root.server", { message: describeError(e) });
      return;
    }
    // 復元した値に戻さず、空にする
    reset({ body: "" });
    draft.discard();
    // 呼び出し側の後始末（一覧の取り直しなど）の失敗は、送信の失敗として表示しない。その場では受け止めず、外へ伝える（利用者の決定）
    onPosted?.();
  };

  const submitByShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!isSubmitting) void handleSubmit(onSubmit)();
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
        label="メッセージ"
        hint="Enter で改行、Ctrl+Enter（Mac は Cmd+Enter）で送信します"
        error={errors.body?.message}
        {...register("body", {
          onChange: (event: ChangeEvent<HTMLTextAreaElement>) =>
            draft.save(event.target.value),
        })}
        onKeyDown={submitByShortcut}
      />
      {draft.unavailable && (
        <Alert tone="info" role="status">
          この環境では下書きを一時保存できません。
        </Alert>
      )}
      <Button type="submit" disabled={isSubmitting}>
        送信
      </Button>
    </form>
  );
}
