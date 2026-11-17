// チャンネルの管理（#143）：名前・説明の変更、アーカイブ・復元。アーカイブ・復元は再認証（S-26）を挟む。
// 成功したら、一覧・サイドバー・詳細を取り直す（channels の all）。取り直しが終わるまで送信中のままにして、二重に送らせない。
// アーカイブ・復元は、未読・スレッド・通知も取り直す（#143-b。復元したチャンネルが再読み込みなしでサイドバー・未読に戻る）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReauth } from "../../auth";
import { notificationKeys } from "../../notifications";
import { threadKeys } from "../../threads";
import { unreadKeys } from "../../unread";
import {
  archiveChannel,
  fetchChannel,
  restoreChannel,
  updateChannel,
  type ChannelUpdateInput,
} from "../api/channel-api";
import { channelKeys } from "../api/query-keys";

/** 再認証が中止・失敗し、要求は送っていない */
export class ReauthNotCompletedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("再認証が完了しなかったため、操作は実行していません", options);
    this.name = "ReauthNotCompletedError";
  }
}

function isDetailOf(queryKey: readonly unknown[], channelId: string): boolean {
  const detail = channelKeys.detail(channelId);
  return (
    queryKey.length === detail.length &&
    detail.every((part, index) => queryKey[index] === part)
  );
}

/** アーカイブ・復元で、チャンネルとともに中身が変わる、ほかの機能のキー */
const ROOM_EFFECT_KEYS = [
  unreadKeys.all,
  threadKeys.all,
  notificationKeys.all,
] as const;

type WithReauth = ReturnType<typeof useReauth>["withReauth"];

/** 再認証（必要なら）の後に送る。送る前に止まったものだけを ReauthNotCompletedError にし、送った後の失敗はそのまま投げる */
async function afterReauth<T>(
  withReauth: WithReauth,
  title: string,
  send: () => Promise<T>,
): Promise<T> {
  const state = { sent: false };
  try {
    return await withReauth(title, () => {
      state.sent = true;
      return send();
    });
  } catch (error) {
    if (state.sent) throw error;
    throw new ReauthNotCompletedError({ cause: error });
  }
}

export function useUpdateChannel(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChannelUpdateInput) => updateChannel(channelId, input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: channelKeys.all }),
  });
}

export function useArchiveChannel(channelId: string) {
  const queryClient = useQueryClient();
  const { withReauth } = useReauth();
  return useMutation({
    mutationFn: (input: { version: number; reason?: string }) =>
      afterReauth(withReauth, "チャンネルのアーカイブ", () =>
        archiveChannel(channelId, input),
      ),
    // アーカイブしたチャンネルの詳細は取り直さない（もう見られず 404 になる。画面は一覧へ移る）
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: channelKeys.all,
          predicate: (query) => !isDetailOf(query.queryKey, channelId),
        }),
        ...ROOM_EFFECT_KEYS.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ]),
  });
}

export function useRestoreChannel(channelId: string) {
  const queryClient = useQueryClient();
  const { withReauth } = useReauth();
  return useMutation({
    mutationFn: (version: number) =>
      afterReauth(withReauth, "チャンネルの復元", () =>
        restoreChannel(channelId, { version }),
      ),
    onSuccess: () =>
      Promise.all(
        [channelKeys.all, ...ROOM_EFFECT_KEYS].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

/** 409（ほかの操作が先に確定した）の後に、詳細を取り直す */
export function useRefetchChannelDetail(channelId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: channelKeys.detail(channelId) });
}

/** 詳細を取り直し、最新の内容を返す（版の 409 の後に、編集の基準を入れ替えるため） */
export function useLoadLatestChannel(channelId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.fetchQuery({
      queryKey: channelKeys.detail(channelId),
      queryFn: () => fetchChannel(channelId),
      staleTime: 0,
    });
}
