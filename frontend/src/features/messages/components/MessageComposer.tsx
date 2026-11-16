// メッセージの入力欄。Enter は改行、Ctrl+Enter（Mac は Cmd+Enter）か「送信」ボタンで送る。
// 送信中（投稿と一覧の取り直しが終わるまで）は「送信」を押せない。成功したら入力欄を空にする。
// 書きかけの本文は端末に下書きとして保存し（features/drafts）、入力欄を作り直すと復元する。送信に成功したら消す。
// 復元した値（なければ空）から変わっているあいだは、画面を離れる前に確認を出す（features/leave-guard）。
// 添付（#140）は選んだ順に送信前の一覧に持ち、送信時に1件ずつアップロードしてから投稿する。送信中は「送信を取り消す」で取り消せる。
// 失敗・取り消しでは投稿せず、一覧と本文を残す。添付は下書きに保存しない。
// parentMessageId を渡すと、そのスレッドへの返信の入力欄になる（名前は「返信」、下書きはスレッドごと）。部屋が替わっても、同じ部屋の別のスレッドへ替わっても、使う側が key で作り直す。
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type KeyboardEvent } from "react";
import type { Mention } from "../../../../../shared/message-rules";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import {
  isBlankDraft,
  roomDraftScope,
  threadDraftScope,
  useDraft,
} from "../../drafts";
import { useLeaveGuard } from "../../leave-guard";
import { describeError, isApiError } from "../describe-error";
import { AttachmentList } from "./AttachmentList";
import { AttachmentPicker } from "./AttachmentPicker";
import { MentionTextArea } from "./MentionTextArea";
import { AttachmentUploadError, usePostMessage } from "../hooks/usePostMessage";
import {
  messageFormSchema,
  type MessageFormValues,
} from "../schemas/message-form";

type MessageComposerProps = {
  roomId: string;
  /** 返信の入力欄にするときの、スレッドの親の ID */
  parentMessageId?: string;
  /** ログイン中の利用者のID。下書きのキーに使う。なければ下書きを読み書きしない */
  userId?: string;
  onPosted?: () => void;
  onPostError?: (error: unknown) => void;
};

export function MessageComposer({
  roomId,
  parentMessageId,
  userId,
  onPosted,
  onPostError,
}: MessageComposerProps) {
  const post = usePostMessage(roomId, parentMessageId);
  const draft = useDraft(
    userId,
    parentMessageId === undefined
      ? roomDraftScope(roomId)
      : threadDraftScope(roomId, parentMessageId),
  );
  const [mentions, setMentions] = useState<Mention[]>(draft.initialMentions);
  const [files, setFiles] = useState<File[]>([]);
  const [canceled, setCanceled] = useState(false);
  const [uploadController, setUploadController] =
    useState<AbortController | null>(null);
  const {
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
    const controller = new AbortController();
    setUploadController(controller);
    setCanceled(false);
    try {
      await post.mutateAsync({
        body: values.body,
        mentions,
        files,
        signal: controller.signal,
        // 投稿の要求を始めたら取り消せないため、ボタンを消す
        onUploaded: () => setUploadController(null),
      });
    } catch (e) {
      // 利用者が取り消したときは失敗として扱わず、取り消したことだけを伝える（投稿はしていない）
      if (e instanceof AttachmentUploadError && controller.signal.aborted) {
        setCanceled(true);
        return;
      }
      onPostError?.(e);
      if (e instanceof AttachmentUploadError) {
        setError("root.server", {
          message: `${e.fileName}：アップロードできませんでした（${describeError(e.cause)}）`,
        });
        return;
      }
      if (!isApiError(e)) throw e;
      // サーバーが返した fields に body があれば入力欄のエラーに、それ以外は上に出す
      if (e.status === 422 && (e.fields ?? []).includes("body"))
        setError("body", { message: e.message });
      else setError("root.server", { message: describeError(e) });
      return;
    } finally {
      setUploadController(null);
    }
    // 復元した値に戻さず、空にする
    reset({ body: "" });
    setMentions([]);
    setFiles([]);
    draft.discard();
    // 呼び出し側の後始末（一覧の取り直しなど）の失敗は、送信の失敗として表示しない。その場では受け止めず、外へ伝える（利用者の決定）
    onPosted?.();
  };

  const submitByShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      !event.nativeEvent.isComposing &&
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey)
    ) {
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
      <Controller
        name="body"
        control={control}
        render={({ field }) => (
          <MentionTextArea
            roomId={roomId}
            label={parentMessageId === undefined ? "メッセージ" : "返信"}
            hint="Enter で改行、Ctrl+Enter（Mac は Cmd+Enter）で送信します"
            error={errors.body?.message}
            body={field.value}
            mentions={mentions}
            onChange={(nextBody, nextMentions) => {
              field.onChange(nextBody);
              setMentions(nextMentions);
              draft.save(nextBody, nextMentions);
            }}
            inputRef={field.ref}
            onKeyDown={submitByShortcut}
          />
        )}
      />
      <AttachmentPicker
        files={files}
        disabled={isSubmitting}
        onAdd={(added) => setFiles((current) => [...current, ...added])}
      />
      <AttachmentList
        files={files}
        disabled={isSubmitting}
        onRemove={(index) =>
          setFiles((current) => current.filter((_, i) => i !== index))
        }
      />
      {canceled && (
        <Alert tone="info" role="status">
          送信を取り消しました。
        </Alert>
      )}
      {draft.unavailable && (
        <Alert tone="info" role="status">
          この環境では下書きを一時保存できません。
        </Alert>
      )}
      <Button type="submit" disabled={isSubmitting}>
        送信
      </Button>
      {uploadController !== null && files.length > 0 && (
        <Button variant="secondary" onClick={() => uploadController?.abort()}>
          送信を取り消す
        </Button>
      )}
    </form>
  );
}
