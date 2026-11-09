// メッセージの入力欄。Enter は改行、Ctrl+Enter（Mac は Cmd+Enter）か「送信」ボタンで送る。
// 送信中（投稿と一覧の取り直しが終わるまで）は「送信」を押せない。成功したら入力欄を空にする。
import { zodResolver } from "@hookform/resolvers/zod";
import type { KeyboardEvent } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { TextAreaField } from "../../../components/TextAreaField";
import { describeError, isApiError } from "../describe-error";
import { usePostMessage } from "../hooks/usePostMessage";
import {
  messageFormSchema,
  type MessageFormValues,
} from "../schemas/message-form";

export function MessageComposer({ roomId }: { roomId: string }) {
  const post = usePostMessage(roomId);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<MessageFormValues>({
    resolver: zodResolver(messageFormSchema),
    defaultValues: { body: "" },
  });

  const onSubmit = async (values: MessageFormValues) => {
    try {
      await post.mutateAsync(values.body);
      reset();
    } catch (e) {
      if (!isApiError(e)) throw e;
      // サーバーが返した fields に body があれば入力欄のエラーに、それ以外は上に出す
      if (e.status === 422 && (e.fields ?? []).includes("body"))
        setError("body", { message: e.message });
      else setError("root.server", { message: describeError(e) });
    }
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
        {...register("body")}
        onKeyDown={submitByShortcut}
      />
      <Button type="submit" disabled={isSubmitting}>
        送信
      </Button>
    </form>
  );
}
