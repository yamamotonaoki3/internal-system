// 409 SESSION_USER_MISMATCH（画面の利用者とセッションの利用者の食い違い。#298・ADR-0035）を受けたときの処理。
// セッションのクエリを1回だけ取り直し（同時の 409 は進行中の1つにまとめる）、結果を4つに分ける。
//   switched：別の利用者が返った。渡された切り替えの入口を呼んでから返す
//   same：文書の利用者が返った
//   unauthenticated：401（既存の 401 の処理が、api-client から動く）
//   unknown：5xx・通信の失敗・取り消し等で、答えが分からない。中身を隠す（RequireAuth の「確認できませんでした」）
// 取り直しの答えは、この取り直しで Query の更新の回数が増えたかで見分ける（取り消しの revert は、保存済みのデータを成功として返すため）。
// 下書き（端末の保存）には触れない。features/access-loss には依存しない（入口は main.tsx が関数で渡す）。
import type { Query, QueryClient } from "@tanstack/react-query";
import type { ApiError } from "../../services/api-client";
import { fetchSession, type SessionInfo } from "./api/auth-api";
import { authKeys } from "./api/query-keys";
import { getDocumentUserId, reportOtherUser } from "./document-user";

export type SessionUserOutcome =
  "switched" | "same" | "unauthenticated" | "unknown";

type Options = {
  queryClient: QueryClient;
  onOtherUser: () => void;
};

/** same が続けてこの回数になったら、その回を unknown にする（食い違いの応答と same の答えが繰り返す状態を止める） */
const SAME_STREAK_LIMIT = 3;
/** 最後の same から、この時間 409 が無ければ、続いた回数を戻す */
const SAME_STREAK_RESET_MS = 30_000;

/** same が続いて答えを確かめられないときに、セッションのクエリに置くエラー（RequireAuth は UNAUTHENTICATED 以外を「確認できませんでした」にする） */
const UNCONFIRMED_SESSION_ERROR: ApiError = {
  status: 409,
  code: "SESSION_USER_MISMATCH",
  message: "ログイン状態を確認できませんでした",
};

let options: Options | undefined;
let inFlight: Promise<SessionUserOutcome> | null = null;
let sameStreak = 0;
let lastSameAt = 0;

function readUserId(queryClient: QueryClient): string | undefined {
  return queryClient.getQueryData<SessionInfo>(authKeys.session)?.user.id;
}

function isUnauthenticated(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 401
  );
}

/** セッションを取り直す。進行中の取得は取り消して新しく取る（409 の前に始まった取得の答えを使わない） */
async function refetchSession(
  queryClient: QueryClient,
  query: Query<SessionInfo, Error, SessionInfo, typeof authKeys.session>,
): Promise<void> {
  // 一度も取得していない・ログアウトで消えた後は、refetchQueries の対象にならないので、新しく取る
  if (query.isDisabled()) {
    await queryClient.prefetchQuery({
      queryKey: authKeys.session,
      queryFn: fetchSession,
      retry: false,
    });
    return;
  }
  await queryClient.refetchQueries({
    queryKey: authKeys.session,
    exact: true,
  });
}

async function judge(registered: Options): Promise<SessionUserOutcome> {
  const { queryClient, onOtherUser } = registered;
  const expected = getDocumentUserId() ?? readUserId(queryClient);
  const query = queryClient
    .getQueryCache()
    .build<SessionInfo, Error, SessionInfo, typeof authKeys.session>(
      queryClient,
      { queryKey: authKeys.session, queryFn: fetchSession, retry: false },
    );
  const dataBefore = query.state.dataUpdateCount;
  const errorBefore = query.state.errorUpdateCount;
  await refetchSession(queryClient, query);
  const dataGrew = query.state.dataUpdateCount - dataBefore;
  const errorGrew = query.state.errorUpdateCount - errorBefore;
  // 待つ間に登録し直された（テストの枠は、テストごとに登録する）：前の登録の結果で、入口を呼ばない
  if (options !== registered) return "unknown";

  let current: string | undefined;
  if (dataGrew === 1 && errorGrew === 0) current = query.state.data?.user.id;
  else if (dataGrew === 0 && errorGrew === 1)
    return isUnauthenticated(query.state.error) ? "unauthenticated" : "unknown";
  else if (dataGrew === 0 && errorGrew === 0)
    // 答えが無い（ほかの処理に取り消された等）：その時点のセッションが別の利用者と分かるときだけ切り替え。取り消しで失敗の状態にはしない
    current = readUserId(queryClient);
  else return "unknown";

  if (current === undefined) return "unknown";
  if (expected !== undefined && current !== expected) {
    reportOtherUser(onOtherUser);
    return "switched";
  }
  return dataGrew === 1 ? "same" : "unknown";
}

function countSame(
  queryClient: QueryClient,
  outcome: SessionUserOutcome,
): SessionUserOutcome {
  if (outcome !== "same") {
    sameStreak = 0;
    return outcome;
  }
  const now = Date.now();
  if (now - lastSameAt >= SAME_STREAK_RESET_MS) sameStreak = 0;
  sameStreak += 1;
  lastSameAt = now;
  if (sameStreak < SAME_STREAK_LIMIT) return outcome;
  sameStreak = 0;
  queryClient
    .getQueryCache()
    .find<SessionInfo, ApiError>({ queryKey: authKeys.session, exact: true })
    ?.setState({
      status: "error",
      error: UNCONFIRMED_SESSION_ERROR,
      fetchStatus: "idle",
    });
  return "unknown";
}

/**
 * 409 の後のセッションの確かめの結果。進行中の取り直しがあれば合流し、無ければ始める（資格の確かめが先に求めた場合も、その時点の事実を取る）
 */
export function confirmSessionUserAfterMismatch(): Promise<SessionUserOutcome> {
  if (inFlight !== null) return inFlight;
  if (options === undefined)
    return Promise.reject(
      new Error(
        "409 の後の処理（createSessionUserMismatchHandler）が未登録です",
      ),
    );
  const registered = options;
  const started = judge(registered)
    .then((outcome) => countSame(registered.queryClient, outcome))
    .finally(() => {
      if (inFlight === started) inFlight = null;
    });
  inFlight = started;
  return started;
}

/** 409 SESSION_USER_MISMATCH の処理を作る（main.tsx が setSessionUserMismatchHandler に1回だけ渡す）。呼び出し元へのエラーは待たせない */
export function createSessionUserMismatchHandler(
  registered: Options,
): (error: ApiError) => void {
  options = registered;
  // 前の登録の進行中の取り直し・続いた回数を、新しい登録に持ち越さない
  inFlight = null;
  sameStreak = 0;
  return () => {
    confirmSessionUserAfterMismatch().catch((error: unknown) =>
      reportError(error),
    );
  };
}
