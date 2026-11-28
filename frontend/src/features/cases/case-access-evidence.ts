// 案件の資格の確かめに使う、その場の Query のキャッシュの読み取り（#339。C-210）。
// 取得の実績（その案件の部屋・スレッドを正常に取得したこと）と、案件と部屋の対応を、いまのキャッシュから求める。
// 別の台帳に写さないのは、片付け・Query の削除・利用者の切り替えでキャッシュが消えたとき、実績も一緒に消えるようにするため。
// 案件一覧の行・案件の詳細・概要は、対応（部屋の ID）を知るためにだけ使い、新しい部屋・スレッドの実績にはしない。
import type { QueryClient } from "@tanstack/react-query";
import { authKeys, type SessionInfo } from "../auth";
import { messageKeys, type ThreadRepliesData } from "../messages";
import { channelKeys, type ChannelDetail } from "../channels";
import { threadKeys, type ThreadPage } from "../threads";
import type { CaseDetail, CaseSummary } from "./api/case-api";
import { caseKeys } from "./api/query-keys";

/** スレッド一覧の行のうち、比べるのに要る分だけ（本文は写さない） */
export type ThreadListRow = {
  parentId: string;
  caseId: string | null;
  roomId: string;
};

type ThreadListData = { pages: ThreadPage[] };

export function sessionUserId(queryClient: QueryClient): string | undefined {
  return queryClient.getQueryData<SessionInfo>(authKeys.session)?.user.id;
}

/** スレッド一覧のデータ（読み込み済みの全ページ）の行。親の ID が重なる行は1つにまとめる */
export function threadListRows(data: unknown): ThreadListRow[] {
  const pages = (data as ThreadListData | undefined)?.pages ?? [];
  const rows = new Map<string, ThreadListRow>();
  for (const page of pages)
    for (const item of page.items)
      rows.set(item.parent.id, {
        parentId: item.parent.id,
        caseId: item.caseId,
        roomId: item.room.id,
      });
  return [...rows.values()];
}

/** 返信のデータの案件・部屋（案件の ID を持つ成功のデータだけ） */
export function repliesCaseRoom(
  data: unknown,
): { caseId: string; roomId: string } | null {
  const replies = data as Partial<ThreadRepliesData> | undefined;
  if (typeof replies?.caseId !== "string" || replies.parent === undefined)
    return null;
  return { caseId: replies.caseId, roomId: replies.parent.roomId };
}

function cachedReplies(queryClient: QueryClient) {
  return queryClient
    .getQueriesData<ThreadRepliesData>({ queryKey: ["messages", "thread"] })
    .map(([, data]) => repliesCaseRoom(data))
    .filter((pair) => pair !== null);
}

function cachedListRows(queryClient: QueryClient): ThreadListRow[] {
  return threadListRows(
    queryClient.getQueryData(threadKeys.list) as ThreadListData | undefined,
  );
}

/** 返信・スレッド一覧から分かる、その案件の部屋の ID（成功のデータだけ） */
function fetchedRoomIdsOf(queryClient: QueryClient, caseId: string): string[] {
  return [
    ...cachedReplies(queryClient)
      .filter((pair) => pair.caseId === caseId)
      .map((pair) => pair.roomId),
    ...cachedListRows(queryClient)
      .filter((row) => row.caseId === caseId)
      .map((row) => row.roomId),
  ];
}

/** チャンネルの詳細から分かる、その案件の部屋の ID（通常のチャンネルは caseId が null なので含まない） */
function channelRoomIdsOf(queryClient: QueryClient, caseId: string): string[] {
  return queryClient
    .getQueriesData<ChannelDetail>({
      queryKey: channelKeys.all,
      predicate: (query) => query.queryKey[1] === "detail",
    })
    .map(([, data]) => data)
    .filter((data) => data?.caseId === caseId)
    .map((data) => data?.roomId)
    .filter((roomId) => typeof roomId === "string");
}

/** 部屋の ID から案件を求める（返信・スレッド一覧・その利用者の概要と詳細の、既知の対応だけ） */
export function caseIdOfRoom(
  queryClient: QueryClient,
  userId: string,
  roomId: string,
): string | null {
  const fromReplies = cachedReplies(queryClient).find(
    (pair) => pair.roomId === roomId,
  );
  if (fromReplies !== undefined) return fromReplies.caseId;
  const fromList = cachedListRows(queryClient).find(
    (row) => row.roomId === roomId && row.caseId !== null,
  );
  if (fromList?.caseId != null) return fromList.caseId;
  const channel = queryClient.getQueryData<ChannelDetail>(
    channelKeys.detail(roomId),
  );
  if (typeof channel?.caseId === "string") return channel.caseId;
  for (const kind of ["summary", "detail"] as const)
    for (const [, data] of queryClient.getQueriesData<CaseSummary | CaseDetail>(
      { queryKey: ["cases", kind, userId] },
    ))
      if (data?.channelId === roomId) return data.id;
  return null;
}

/**
 * その案件の部屋・スレッドを、正常に取得した実績がいまのキャッシュにあるか。あれば、実績の部屋の ID（分からなければ null）、無ければ null でなく undefined。
 * 実績：案件の ID つきの返信、スレッド一覧のその案件の行、対応の分かる部屋（概要・詳細・チャンネルの詳細）の正常に取得したメッセージ（空の配列を含む）。
 * 判定と部屋の ID を、同じ読み方から求める（初回の確定の片付け・下書きの消去に、判定に使った部屋を渡すため）。
 * 利用者をキーに持たない Query は、利用者の切り替えで見張りが捨てるので、残っているものはいまの利用者のもの
 */
export function caseRoomEvidence(
  queryClient: QueryClient,
  userId: string,
  caseId: string,
): { roomId: string | null } | undefined {
  const fetched = fetchedRoomIdsOf(queryClient, caseId);
  if (fetched.length > 0) return { roomId: fetched[0] ?? null };
  // 対応だけの情報は、その部屋のメッセージの正常な取得と組み合わせて、実績にする
  const knownRooms = [
    queryClient.getQueryData<CaseDetail>(caseKeys.detail(userId, caseId))
      ?.channelId,
    queryClient.getQueryData<CaseSummary>(caseKeys.summary(userId, caseId))
      ?.channelId,
    ...channelRoomIdsOf(queryClient, caseId),
  ].filter((roomId) => typeof roomId === "string");
  const roomId = knownRooms.find(
    (room) => queryClient.getQueryData(messageKeys.room(room)) !== undefined,
  );
  return roomId === undefined ? undefined : { roomId };
}

/** 復元の守りが確かめる対象。案件と部屋の ID だけ（本文・入力値を写さない） */
export type CaseAccessTarget = { caseId: string; roomId: string | null };

/** 実績を持ちうる案件の ID（返信・スレッド一覧・その利用者の概要と詳細・チャンネルの詳細に現れるもの） */
function evidenceCandidates(
  queryClient: QueryClient,
  userId: string,
): Set<string> {
  const candidates = new Set<string>();
  for (const pair of cachedReplies(queryClient)) candidates.add(pair.caseId);
  for (const row of cachedListRows(queryClient))
    if (row.caseId !== null) candidates.add(row.caseId);
  for (const kind of ["summary", "detail"] as const)
    for (const [, data] of queryClient.getQueriesData<CaseSummary | CaseDetail>(
      { queryKey: ["cases", kind, userId] },
    ))
      if (data !== undefined) candidates.add(data.id);
  for (const [, data] of queryClient.getQueriesData<ChannelDetail>({
    queryKey: channelKeys.all,
    predicate: (query) => query.queryKey[1] === "detail",
  }))
    if (typeof data?.caseId === "string") candidates.add(data.caseId);
  return candidates;
}

/**
 * 復元の守り（#342）が確かめる対象の全件：取得の実績がある案件と、その利用者の参加者の概要の案件。案件の ID で重なりを除く。
 * 実績の判定と部屋の ID は caseRoomEvidence と同じ読み方にする（別々に判定すると食い違うため）。実績の無い参加者の概要は、概要の部屋の ID を使う
 */
export function caseAccessTargets(
  queryClient: QueryClient,
  userId: string,
): CaseAccessTarget[] {
  const targets = new Map<string, CaseAccessTarget>();
  for (const caseId of evidenceCandidates(queryClient, userId)) {
    const evidence = caseRoomEvidence(queryClient, userId, caseId);
    if (evidence !== undefined)
      targets.set(caseId, { caseId, roomId: evidence.roomId });
  }
  for (const [, summary] of queryClient.getQueriesData<CaseSummary>({
    queryKey: ["cases", "summary", userId],
  }))
    if (summary?.isParticipant === true && !targets.has(summary.id))
      targets.set(summary.id, {
        caseId: summary.id,
        roomId: summary.channelId,
      });
  return [...targets.values()];
}
