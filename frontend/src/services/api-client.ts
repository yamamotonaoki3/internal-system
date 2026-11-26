// API通信の共通部分（C-46）。Axiosのインスタンスはここで1つだけ作り、全体で使う。
import axios, { type AxiosError } from "axios";
import { EXPECTED_USER_ID_HEADER } from "../../../shared/session-user-header";

export type ApiError = {
  status: number;
  code: string;
  message: string;
  fields?: string[];
};

let onUnauthenticated: ((error: ApiError) => void) | undefined;

// 401を受けたときの処理（認証の更新・ログイン画面への遷移）を、認証方式に合わせて登録する（C-15）
export function setUnauthenticatedHandler(handler: (error: ApiError) => void) {
  onUnauthenticated = handler;
}

/** 画面の利用者と、セッションの利用者が食い違ったときに、サーバーが返すエラーのコード（#298・ADR-0035） */
const SESSION_USER_MISMATCH = "SESSION_USER_MISMATCH";

/** 要求ヘッダーに付ける、想定の利用者を決める関数が受け取る、要求の情報 */
export type ExpectedUserIdRequest = { method: string; url: string };

let expectedUserIdProvider:
  ((request: ExpectedUserIdRequest) => string | undefined) | undefined;
let onSessionUserMismatch: ((error: ApiError) => void) | undefined;

// どの利用者として送るかは認証の機能が決める（ここは機能を知らない）。main.tsx が1回だけ登録する（#298）
export function setExpectedUserIdProvider(
  provider: (request: ExpectedUserIdRequest) => string | undefined,
) {
  expectedUserIdProvider = provider;
}

// 409 SESSION_USER_MISMATCH を受けたときの処理（セッションの取り直し）を登録する（#298）
export function setSessionUserMismatchHandler(
  handler: (error: ApiError) => void,
) {
  onSessionUserMismatch = handler;
}

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api",
  timeout: 10_000,
  withCredentials: true,
});

// 要求：リクエストIDを付ける（C-30）
apiClient.interceptors.request.use((config) => {
  config.headers.set("X-Request-Id", crypto.randomUUID());
  return config;
});

// 要求：想定の利用者を付ける（#298）。サーバーは、セッションの利用者と違えば断る（認可には使わない）
apiClient.interceptors.request.use((config) => {
  const userId = expectedUserIdProvider?.({
    method: config.method ?? "get",
    url: config.url ?? "",
  });
  if (userId !== undefined) config.headers.set(EXPECTED_USER_ID_HEADER, userId);
  return config;
});

// 進行中の書き込みの要求（GET・HEAD・OPTIONS 以外）の数。資格を失ったときの読み込み直しが、MutationCache に載らない
// 直接の送信も待つため（#338）。持つのは数だけ（本文・URL を覚えない）
const READ_METHODS: readonly string[] = ["get", "head", "options"];
let pendingWrites = 0;
const pendingWriteListeners = new Set<() => void>();

function changePendingWrites(delta: number): void {
  pendingWrites += delta;
  pendingWriteListeners.forEach((listener) => listener());
}

export function getPendingWriteCount(): number {
  return pendingWrites;
}

export function subscribePendingWrites(listener: () => void): () => void {
  pendingWriteListeners.add(listener);
  return () => pendingWriteListeners.delete(listener);
}

// アダプター（実際の送信）を包んで数える。数えるのはアダプターの間だけなので、要求のインターセプターの例外・送信の前の取り消しでは
// 増えず、アダプターがどう終わっても finally で必ず減る
apiClient.interceptors.request.use((config) => {
  const method = (config.method ?? "get").toLowerCase();
  if (READ_METHODS.includes(method)) return config;
  const send = axios.getAdapter(config.adapter ?? apiClient.defaults.adapter);
  config.adapter = async (sending) => {
    changePendingWrites(1);
    try {
      return await send(sending);
    } finally {
      changePendingWrites(-1);
    }
  };
  return config;
});

// 応答：エラーを共通の形に変換する。もみ消さず、必ず失敗として返す（C-71・C-73）
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<Partial<ApiError>>) => {
    const status = error.response?.status ?? 0;
    const data = error.response?.data;
    const body = data !== null && typeof data === "object" ? data : {};
    const apiError: ApiError = {
      status,
      code: body.code ?? (status === 0 ? "NETWORK_ERROR" : "UNKNOWN_ERROR"),
      message:
        body.message ??
        (status === 0
          ? "通信できませんでした。接続を確かめてください"
          : "エラーが発生しました"),
      fields: body.fields,
    };
    if (status === 401) onUnauthenticated?.(apiError);
    if (isSessionUserMismatchError(apiError)) onSessionUserMismatch?.(apiError);
    return Promise.reject(apiError);
  },
);

// 競合（版の衝突・重複）の判定。ステータスだけでなくコードでも見る（409 には、競合ではないコードのものもあるため）
export function isConflictError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 409 &&
    "code" in error &&
    error.code === "CONFLICT"
  );
}

// 画面の利用者と、セッションの利用者の食い違い（#298）。競合（CONFLICT）とは別のものとして扱う
export function isSessionUserMismatchError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 409 &&
    "code" in error &&
    error.code === SESSION_USER_MISMATCH
  );
}
