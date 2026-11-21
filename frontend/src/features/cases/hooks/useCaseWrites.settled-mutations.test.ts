// #323 コードレビュー1回目 重大3（PR #328 の絞ったミューテーション診断の生き残りへの追加）：資格を失ったとき、
// この案件の操作（TODO の書き込み・案件の書き込み）のうち、進行中のものは取り消さず残し、完了した時点で MutationCache から取り除く（ADR-0030）。
// ほかの案件・ほかのキーの操作は残す。状態が途中で変わる通知（再試行の前の失敗）では、まだ取り除かない。
// 見張る対象がなくなったら、MutationCache の購読を終える（hasListeners で観測する。購読が残り続けない）。
// 否定の確認が空振りしないよう、先に MutationCache にあることを確かめる。キーは期待の独立のため、配列で直接書く。データは架空（[UNIT_TEST]）。
import {
  MutationObserver,
  QueryClient,
  type MutationKey,
} from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { forgetCaseContent } from "./useCaseWrites";

const USER = "01JTESTUSER323000000000SM1";
const CASE = "01JTESTCASE323000000000SM1";
const OTHER_CASE = "01JTESTCASE323000000000SM2";

const TODO_WRITE = ["caseTodoWrite", CASE] as const;
const WRITE = ["caseWrite", CASE] as const;
const OTHER_CASE_WRITE = ["caseWrite", OTHER_CASE] as const;
const OTHER_KEY = ["messageSend", "01JTESTROOM323000000000SM1"] as const;

function deferred() {
  let resolve: (value: string) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 操作を始める（mutationFn が返す Promise を、テストが決める） */
function start(
  client: QueryClient,
  mutationKey: readonly string[],
  mutationFn: () => Promise<string>,
  retry: number = 0,
) {
  const observer = new MutationObserver(client, {
    mutationKey: [...mutationKey],
    mutationFn,
    retry,
    retryDelay: 0,
  });
  void observer.mutate(undefined).catch(() => undefined);
}

/** すぐに完了する操作 */
async function completed(client: QueryClient, mutationKey: readonly string[]) {
  const observer = new MutationObserver(client, {
    mutationKey: [...mutationKey],
    mutationFn: () => Promise.resolve("[UNIT_TEST]323完了した応答"),
  });
  await observer.mutate(undefined);
}

const find = (client: QueryClient, mutationKey: MutationKey) =>
  client.getMutationCache().find({ mutationKey, exact: true });

const statusOf = (client: QueryClient, mutationKey: readonly string[]) =>
  find(client, [...mutationKey])?.state.status;

const newClient = () => new QueryClient();

describe("#323 重大3 forgetCaseContent：この案件の操作を、完了した時点で MutationCache から取り除く", () => {
  it("#323 AC-1: 完了した操作はすぐに取り除き、進行中の TODO の書き込み・案件の書き込みは、完了するまで残し、完了した後に取り除く", async () => {
    const client = newClient();
    const todo = deferred();
    const write = deferred();
    start(client, TODO_WRITE, () => todo.promise);
    start(client, WRITE, () => write.promise);
    expect(statusOf(client, TODO_WRITE)).toBe("pending");
    expect(statusOf(client, WRITE)).toBe("pending");

    void forgetCaseContent(client, USER, CASE);

    // 進行中のものは残す
    expect(statusOf(client, TODO_WRITE)).toBe("pending");
    expect(statusOf(client, WRITE)).toBe("pending");

    todo.resolve("[UNIT_TEST]323TODO の応答");
    await waitFor(() => expect(find(client, [...TODO_WRITE])).toBeUndefined());
    expect(statusOf(client, WRITE)).toBe("pending");

    write.reject(new Error("[UNIT_TEST]323失敗"));
    await waitFor(() => expect(find(client, [...WRITE])).toBeUndefined());
  });

  it("#323 AC-1: 呼んだ時点で完了していた操作は、その場で取り除く", async () => {
    const client = newClient();
    await completed(client, TODO_WRITE);
    await completed(client, WRITE);
    expect(statusOf(client, TODO_WRITE)).toBe("success");
    expect(statusOf(client, WRITE)).toBe("success");

    void forgetCaseContent(client, USER, CASE);

    expect(find(client, [...TODO_WRITE])).toBeUndefined();
    expect(find(client, [...WRITE])).toBeUndefined();
  });

  it("#323 AC-2: 見張っている間に完了した、ほかの案件・ほかのキーの操作は取り除かない", async () => {
    const client = newClient();
    const own = deferred();
    const otherCase = deferred();
    const otherKey = deferred();
    start(client, WRITE, () => own.promise);
    start(client, OTHER_CASE_WRITE, () => otherCase.promise);
    start(client, OTHER_KEY, () => otherKey.promise);

    void forgetCaseContent(client, USER, CASE);
    otherCase.resolve("[UNIT_TEST]323ほかの案件の応答");
    otherKey.resolve("[UNIT_TEST]323ほかのキーの応答");
    await waitFor(() => {
      expect(statusOf(client, OTHER_CASE_WRITE)).toBe("success");
      expect(statusOf(client, OTHER_KEY)).toBe("success");
    });
    // 見張りがまだ続いている（この案件の操作が進行中）ことを確かめてから、ほかの操作が残っていることを見る
    expect(statusOf(client, WRITE)).toBe("pending");
    expect(client.getMutationCache().hasListeners()).toBe(true);

    own.resolve("[UNIT_TEST]323この案件の応答");
    await waitFor(() => expect(find(client, [...WRITE])).toBeUndefined());
    expect(statusOf(client, OTHER_CASE_WRITE)).toBe("success");
    expect(statusOf(client, OTHER_KEY)).toBe("success");
  });

  it("#323 AC-1: 進行中のまま状態が変わる通知（再試行の前の失敗）では、まだ取り除かず、完了した後に取り除く", async () => {
    const client = newClient();
    const second = deferred();
    let calls = 0;
    start(
      client,
      WRITE,
      () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("[UNIT_TEST]323最初の失敗"))
          : second.promise;
      },
      1,
    );

    void forgetCaseContent(client, USER, CASE);
    await waitFor(() => expect(calls).toBe(2));
    expect(find(client, [...WRITE])?.state.failureCount).toBe(1);
    expect(statusOf(client, WRITE)).toBe("pending");

    second.resolve("[UNIT_TEST]323再試行の応答");
    await waitFor(() => expect(find(client, [...WRITE])).toBeUndefined());
  });
});

describe("#323 重大3 forgetCaseContent：見張る操作がなくなったら、MutationCache の購読を終える", () => {
  it("#323: 進行中の操作がなければ、購読を始めない", async () => {
    const client = newClient();
    await completed(client, WRITE);
    expect(client.getMutationCache().hasListeners()).toBe(false);

    void forgetCaseContent(client, USER, CASE);

    expect(client.getMutationCache().hasListeners()).toBe(false);
  });

  it("#323: 進行中の操作が複数あるとき、すべてが完了するまで購読し、すべてが完了したら購読を終える", async () => {
    const client = newClient();
    const todo = deferred();
    const write = deferred();
    start(client, TODO_WRITE, () => todo.promise);
    start(client, WRITE, () => write.promise);
    expect(client.getMutationCache().hasListeners()).toBe(false);

    void forgetCaseContent(client, USER, CASE);
    expect(client.getMutationCache().hasListeners()).toBe(true);

    todo.resolve("[UNIT_TEST]323TODO の応答");
    await waitFor(() => expect(find(client, [...TODO_WRITE])).toBeUndefined());
    expect(client.getMutationCache().hasListeners()).toBe(true);

    write.resolve("[UNIT_TEST]323案件の応答");
    await waitFor(() => expect(find(client, [...WRITE])).toBeUndefined());
    expect(client.getMutationCache().hasListeners()).toBe(false);
  });

  it("#323: 進行中の操作が、完了の前にほかの理由で MutationCache から取り除かれたとき（ログアウトの片付け等）も、購読を終える", () => {
    const client = newClient();
    const write = deferred();
    start(client, WRITE, () => write.promise);
    void forgetCaseContent(client, USER, CASE);
    const mutation = find(client, [...WRITE]);
    expect(mutation?.state.status).toBe("pending");
    expect(client.getMutationCache().hasListeners()).toBe(true);

    if (mutation !== undefined) client.getMutationCache().remove(mutation);

    expect(client.getMutationCache().hasListeners()).toBe(false);
  });
});
