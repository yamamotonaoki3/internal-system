// #338 AC-2（コードレビュー1回目 重大3）：API クライアントの層で、進行中の書き込みの要求（GET・HEAD・OPTIONS 以外）の数を数える。
// 読み込み直しの入口が、MutationCache に載らない直接の送信（usePasswordChange など）も待てるようにするため。数えるのは数だけ（本文・秘密の値を持たない）。
// 要求の開始で増え、成功・失敗（HTTP のエラー）・取り消し・通信の失敗のどれでも必ず減る。負にならず、残り続けない。
// 通信はアダプターで返す（本物の通信をしない）。インターセプターはアダプターの前後で動く。データは架空。
// 前提にした口（実装の担当へ）：services/api-client.ts から
//   getPendingWriteCount(): number
//   subscribePendingWrites(listener: () => void): () => void（数が変わるたびに呼ぶ。返り値で解除）
import {
  AxiosError,
  CanceledError,
  type InternalAxiosRequestConfig,
} from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiClient,
  getPendingWriteCount,
  subscribePendingWrites,
} from "./api-client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Outcome = "success" | "http-error" | "network" | "cancel";

/** アダプターで応答を保留する要求。settle で結果を決める。done は成功・失敗のどちらでも解決する */
function held(
  method: "get" | "head" | "options" | "post" | "put" | "patch" | "delete",
) {
  const gate = deferred<Outcome>();
  const adapter = async (config: InternalAxiosRequestConfig) => {
    const outcome = await gate.promise;
    if (outcome === "success")
      return { data: {}, status: 200, statusText: "OK", headers: {}, config };
    if (outcome === "cancel")
      throw new CanceledError(undefined, undefined, config);
    if (outcome === "network")
      throw new AxiosError("Network Error", AxiosError.ERR_NETWORK, config);
    throw new AxiosError(
      "Request failed",
      AxiosError.ERR_BAD_RESPONSE,
      config,
      undefined,
      {
        data: { code: "INTERNAL_ERROR", message: "[UNIT_TEST]338失敗" },
        status: 500,
        statusText: "Internal Server Error",
        headers: {},
        config,
      },
    );
  };
  const url = `/[UNIT_TEST]338-${method}`;
  const request = apiClient.request({
    method,
    url,
    data: { value: 1 },
    adapter,
  });
  const done = request.then(
    () => "resolved" as const,
    () => "rejected" as const,
  );
  return { settle: gate.resolve, done };
}

/** インターセプター（非同期）の後まで進める */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#338 AC-2 進行中の書き込みの要求の数（コードレビュー1回目 重大3）", () => {
  it.each(["post", "put", "patch", "delete"] as const)(
    "#338 AC-2: %s の要求の開始で1増え、成功で0に戻る",
    async (method) => {
      expect(getPendingWriteCount()).toBe(0);
      const request = held(method);
      await flush();
      expect(getPendingWriteCount()).toBe(1);
      request.settle("success");
      expect(await request.done).toBe("resolved");
      expect(getPendingWriteCount()).toBe(0);
    },
  );

  it.each(["get", "head", "options"] as const)(
    "#338 AC-2: 読み取り（%s）は数えない",
    async (method) => {
      const request = held(method);
      await flush();
      expect(getPendingWriteCount()).toBe(0);
      request.settle("success");
      await request.done;
      expect(getPendingWriteCount()).toBe(0);
    },
  );

  it.each([
    ["HTTP のエラー（500）", "http-error"],
    ["通信の失敗", "network"],
    ["取り消し", "cancel"],
  ] as const)(
    "#338 AC-2: %s で終わっても、必ず減る（失敗はもみ消さず、呼び出し元へ伝わる）",
    async (_name, outcome) => {
      const request = held("post");
      await flush();
      expect(getPendingWriteCount()).toBe(1);
      request.settle(outcome);
      expect(await request.done).toBe("rejected");
      expect(getPendingWriteCount()).toBe(0);
    },
  );

  it("#338 AC-2: 重なった要求を、それぞれ数え、どの順で終わっても0に戻る（負にならない）", async () => {
    const first = held("post");
    const second = held("delete");
    const read = held("get");
    await flush();
    expect(getPendingWriteCount()).toBe(2);
    second.settle("network");
    await second.done;
    expect(getPendingWriteCount()).toBe(1);
    read.settle("success");
    await read.done;
    expect(getPendingWriteCount()).toBe(1);
    first.settle("http-error");
    await first.done;
    expect(getPendingWriteCount()).toBe(0);
  });

  it("#338 AC-2: 数が変わるたびに購読者に知らせ、解除の後は知らせない", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingWrites(listener);
    const request = held("post");
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    request.settle("success");
    await request.done;
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    const next = held("put");
    await flush();
    next.settle("success");
    await next.done;
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getPendingWriteCount()).toBe(0);
  });
});
