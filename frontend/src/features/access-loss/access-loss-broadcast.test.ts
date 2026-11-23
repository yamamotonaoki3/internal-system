// #341 AC-6・AC-8（計画 plan-341 の 5・9・13 の T-B1〜T-B4）：資格の喪失の「確かめのきっかけ」の合図（BroadcastChannel）。
// 伝える中身は、版・利用者の ID・案件の ID だけ（理由・部屋の ID・案件の中身を載せない）。保存先に何も残さない。
// 受けた値は外部からの入力として検証し、形の違う値・知らない版は捨てる。チャンネルが無い・作るときに SecurityError なら、送受信しない。
// ほかの例外はもみ消さない：受信の側は投げる。送る側は、呼び出し元（続く下書きの消去）を止めないよう、reportError に渡す（利用者の決定 Q5）。
// 期待値（チャンネルの名前・値の形）は、本番の定数を使わず、計画 5 から独立にリテラルで書く。
// チャンネルは、テスト専用の差し替え（test/fake-broadcast-channel.ts）。モジュールの中の「遅れて作る1つのチャンネル」を作り直すため、テストごとに vi.resetModules する。
// 前提にした口（実装の担当へ）：features/access-loss/access-loss-broadcast.ts の
//   announceCaseAccessLoss({ userId, caseId }): void
//   subscribeCaseAccessLoss(listener: (hint: { userId: string; caseId: string }) => void): () => void（解除の関数を返す）
//   グローバルの BroadcastChannel は、チャンネルを作る時点（最初の送受信）に読む。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeBroadcastChannel,
  flushTasks,
  postFromOtherTab,
} from "../../test/fake-broadcast-channel";

vi.unmock("./access-loss-broadcast");

const CHANNEL = "internal-system:access-loss:v1";
const USER_A = "01JTESTUSER341A0000000000A1";
const CASE_1 = "01JTESTCASE3410000000000C01";

type Broadcast = typeof import("./access-loss-broadcast");

let reportError: ReturnType<typeof vi.fn>;

async function load(): Promise<Broadcast> {
  vi.resetModules();
  return import("./access-loss-broadcast");
}

beforeEach(() => {
  FakeBroadcastChannel.closeAll();
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  reportError = vi.fn();
  vi.stubGlobal("reportError", reportError);
});
afterEach(() => {
  vi.restoreAllMocks();
  FakeBroadcastChannel.closeAll();
  vi.unstubAllGlobals();
});

describe("#341 AC-6 T-B1 送る値の形", () => {
  it("#341 AC-6 T-B1: 送る値のキーは v・userId・caseId だけで、版は 1、名前は internal-system:access-loss:v1。保存先には何も書かない", async () => {
    const broadcast = await load();
    broadcast.announceCaseAccessLoss({ userId: USER_A, caseId: CASE_1 });
    const sent = FakeBroadcastChannel.sent(CHANNEL);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toStrictEqual({ v: 1, userId: USER_A, caseId: CASE_1 });
    expect(Object.keys(sent[0] as object).sort()).toEqual([
      "caseId",
      "userId",
      "v",
    ]);
    // ほかの名前のチャンネルには送らない
    expect(FakeBroadcastChannel.onPost).toHaveBeenCalledTimes(1);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("#341 AC-6 T-B1: チャンネルは、読み込んだだけでは作らず（遅れて作る）、送受信を重ねても文書ごとに1つ", async () => {
    const broadcast = await load();
    expect(FakeBroadcastChannel.instances).toHaveLength(0);
    const stop = broadcast.subscribeCaseAccessLoss(() => undefined);
    broadcast.announceCaseAccessLoss({ userId: USER_A, caseId: CASE_1 });
    broadcast.announceCaseAccessLoss({ userId: USER_A, caseId: CASE_1 });
    expect(
      FakeBroadcastChannel.instances.filter((c) => c.name === CHANNEL),
    ).toHaveLength(1);
    stop();
  });

  it("#341 AC-6: ほかのタブから届いた正しい合図は、利用者の ID と案件の ID を購読者に渡す。解除した後は渡さない", async () => {
    const broadcast = await load();
    const listener = vi.fn();
    const stop = broadcast.subscribeCaseAccessLoss(listener);
    postFromOtherTab(CHANNEL, { v: 1, userId: USER_A, caseId: CASE_1 });
    await flushTasks();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_A, caseId: CASE_1 }),
    );
    stop();
    postFromOtherTab(CHANNEL, { v: 1, userId: USER_A, caseId: CASE_1 });
    await flushTasks();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("#341 AC-6 T-B2 形の違う合図・知らない版は捨てる", () => {
  it.each([
    ["版が 2", { v: 2, userId: USER_A, caseId: CASE_1 }],
    ["版がない", { userId: USER_A, caseId: CASE_1 }],
    ["版が文字列", { v: "1", userId: USER_A, caseId: CASE_1 }],
    ["案件の ID がない", { v: 1, userId: USER_A }],
    ["利用者の ID がない", { v: 1, caseId: CASE_1 }],
    ["利用者の ID が数", { v: 1, userId: 341, caseId: CASE_1 }],
    ["案件の ID が null", { v: 1, userId: USER_A, caseId: null }],
    ["文字列", "internal-system:access-loss"],
    ["null", null],
    ["配列", [1, USER_A, CASE_1]],
  ] as const)(
    "#341 AC-6 T-B2: %s の値は、購読者に渡さない（エラーにもしない）",
    async (_name, data) => {
      const broadcast = await load();
      const listener = vi.fn();
      const stop = broadcast.subscribeCaseAccessLoss(listener);
      postFromOtherTab(CHANNEL, data);
      await flushTasks();
      expect(listener).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
      stop();
    },
  );

  it("#341 AC-6 T-B2: ほかの名前のチャンネルの値は、購読者に渡さない", async () => {
    const broadcast = await load();
    const listener = vi.fn();
    const stop = broadcast.subscribeCaseAccessLoss(listener);
    postFromOtherTab("internal-system:access-loss:v2", {
      v: 1,
      userId: USER_A,
      caseId: CASE_1,
    });
    await flushTasks();
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});

describe("#341 AC-8 T-B3 チャンネルが使えない環境", () => {
  it("#341 AC-8 T-B3: BroadcastChannel が無い：送っても受けても例外にならず、何も起きない", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const broadcast = await load();
    expect(() =>
      broadcast.announceCaseAccessLoss({ userId: USER_A, caseId: CASE_1 }),
    ).not.toThrow();
    const stop = broadcast.subscribeCaseAccessLoss(() => undefined);
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("#341 AC-8 T-B3: 作るときに SecurityError：送っても受けても例外にならず、何も起きない", async () => {
    const constructed = vi.fn();
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          constructed();
          throw new DOMException("denied", "SecurityError");
        }
      },
    );
    const broadcast = await load();
    expect(() =>
      broadcast.announceCaseAccessLoss({ userId: USER_A, caseId: CASE_1 }),
    ).not.toThrow();
    const stop = broadcast.subscribeCaseAccessLoss(() => undefined);
    expect(typeof stop).toBe("function");
    stop();
    expect(constructed).toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("#341 AC-8 T-B3: 作るときに想定外の例外（TypeError）：受信の側（購読）は、もみ消さずに投げる", async () => {
    const failure = new TypeError("[UNIT_TEST]341想定外");
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw failure;
        }
      },
    );
    const broadcast = await load();
    expect(() => broadcast.subscribeCaseAccessLoss(() => undefined)).toThrow(
      failure,
    );
  });

  it("#341 AC-8 T-B3・T-B4: 作るときに想定外の例外（TypeError）：送る側は、呼び出し元に投げず、reportError に1回渡す（もみ消さない）", async () => {
    const failure = new TypeError("[UNIT_TEST]341想定外");
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw failure;
        }
      },
    );
    const broadcast = await load();
    expect(() =>
      broadcast.announceCaseAccessLoss({ userId: USER_A, caseId: CASE_1 }),
    ).not.toThrow();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(failure);
  });
});

describe("#341 計画 7（軽微4）T-B4 送る処理の想定外の例外", () => {
  it("#341 T-B4: postMessage が想定外の例外：reportError に1回渡し、呼び出し元に投げない", async () => {
    const failure = new Error("[UNIT_TEST]341送れない");
    const broadcast = await load();
    vi.spyOn(FakeBroadcastChannel.prototype, "postMessage").mockImplementation(
      () => {
        throw failure;
      },
    );
    expect(() =>
      broadcast.announceCaseAccessLoss({ userId: USER_A, caseId: CASE_1 }),
    ).not.toThrow();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(failure);
  });
});

// #341 AC-8（計画 plan-341 の 9）：受け止めてチャンネルなしにするのは、作るときの SecurityError（DOMException）だけ。
// ブラウザが作るときに投げる SecurityError は DOMException なので、名前だけが SecurityError の、DOMException でないエラーは、想定外として扱う
describe("#341 AC-8 T-B3 SecurityError でない例外は、もみ消さない", () => {
  function failOnConstruct(failure: unknown) {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw failure;
        }
      },
    );
  }

  it.each([
    [
      "InvalidStateError の DOMException",
      () => new DOMException("x", "InvalidStateError"),
    ],
    [
      "DataCloneError の DOMException",
      () => new DOMException("x", "DataCloneError"),
    ],
    [
      "名前だけが SecurityError の Error（DOMException でない）",
      () =>
        Object.assign(new Error("[UNIT_TEST]341"), { name: "SecurityError" }),
    ],
  ])(
    "#341 AC-8 T-B3: 作るときに %s：受ける側は投げ、送る側は reportError に1回渡す",
    async (_name, make) => {
      const failure = make();
      failOnConstruct(failure);
      const receiving = await load();
      expect(() => receiving.subscribeCaseAccessLoss(() => undefined)).toThrow(
        failure as Error,
      );
      const sending = await load();
      expect(() =>
        sending.announceCaseAccessLoss({ userId: USER_A, caseId: CASE_1 }),
      ).not.toThrow();
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(failure);
    },
  );
});
