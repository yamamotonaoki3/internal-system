// メッセージを投稿する。parentMessageId があれば、そのスレッドへの返信として投稿する。
// 部屋への投稿は、成功したら、その部屋の一覧を取り直す（再読込なしで自分の投稿が出る）。
// 返信は、スレッドを取り直し、部屋の一覧の親の replyCount を1増やす（返信は部屋の一覧に出ず、取り直しでは件数が変わらないため）。
// 取り直しが終わるまで送信中のままにして、二重に送らせない。
// 添付があれば、先に1件ずつアップロードし、全部成功してから attachmentIds（選んだ順）を付けて投稿する。
// どれかが失敗・取り消しになったら投稿せず、AttachmentUploadError（失敗したファイル名つき）で失敗にする。
import type { PublicationVisibility } from "../../../../../shared/attachment-rules";
import type { Mention } from "../../../../../shared/message-rules";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  postMessage,
  postReply,
  uploadAttachment,
  type AttachmentTarget,
  type RoomMessage,
} from "../api/message-api";
import { messageKeys } from "../api/query-keys";

export type PostMessageInput = {
  body: string;
  mentions: readonly Mention[];
  files?: readonly File[];
  /** 添付ごとの公開範囲（files と同じ順。案件の部屋だけ。なければ指定しない） */
  publicationVisibilities?: readonly PublicationVisibility[];
  /** 添付のアップロードを取り消すための signal */
  signal?: AbortSignal;
  /** アップロードが全部終わり、投稿の要求を送る直前に呼ぶ（ここから先は取り消せない） */
  onUploaded?: () => void;
};

/** 添付のアップロードに失敗した（取り消しを含む）。投稿はしていない */
export class AttachmentUploadError extends Error {
  readonly fileName: string;
  constructor(fileName: string, options: { cause: unknown }) {
    super("添付をアップロードできませんでした", options);
    this.name = "AttachmentUploadError";
    this.fileName = fileName;
  }
}

async function uploadAll(
  target: AttachmentTarget,
  files: readonly File[],
  publicationVisibilities: readonly PublicationVisibility[] | undefined,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, file] of files.entries()) {
    try {
      const uploaded = await uploadAttachment(target, file, {
        signal,
        publicationVisibility: publicationVisibilities?.[index],
      });
      // 応答の後に取り消されていたら、投稿の要求を送らない
      signal?.throwIfAborted();
      ids.push(uploaded.id);
    } catch (e) {
      throw new AttachmentUploadError(file.name, { cause: e });
    }
  }
  return ids;
}

export function usePostMessage(roomId: string, parentMessageId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: string | PostMessageInput): Promise<void> => {
      const content: PostMessageInput =
        typeof input === "string" ? { body: input, mentions: [] } : input;
      const target: AttachmentTarget =
        parentMessageId === undefined
          ? { kind: "room", roomId }
          : { kind: "reply", parentMessageId };
      const attachmentIds = await uploadAll(
        target,
        content.files ?? [],
        content.publicationVisibilities,
        content.signal,
      );
      content.onUploaded?.();
      if (parentMessageId === undefined)
        await postMessage(
          roomId,
          content.body,
          content.mentions,
          attachmentIds,
        );
      else
        await postReply(
          parentMessageId,
          content.body,
          content.mentions,
          attachmentIds,
        );
    },
    onSuccess: async () => {
      if (parentMessageId === undefined) {
        await queryClient.invalidateQueries({
          queryKey: messageKeys.room(roomId),
        });
        return;
      }
      // 実行中の2秒ごとの取得が、増やす前の一覧で上書きしないよう、先に止める
      const roomKey = messageKeys.room(roomId);
      await queryClient.cancelQueries({ queryKey: roomKey });
      queryClient.setQueryData<RoomMessage[]>(roomKey, (messages) =>
        messages?.map((message) =>
          message.id === parentMessageId
            ? { ...message, replyCount: message.replyCount + 1 }
            : message,
        ),
      );
      await queryClient.invalidateQueries({
        queryKey: messageKeys.thread(parentMessageId),
      });
    },
  });
}
