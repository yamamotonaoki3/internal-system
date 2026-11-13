// #239 AC-1・AC-2・AC-4（1-1 AC-4・C-82）：入力欄の下書きのフック useDraft(userId, scope) の、保存先が使えないときと利用者が替わったときの扱い。
// 契約（計画 plan-239 と改訂1〜5）：
//   マウントしたときに端末から復元し（initialBody）、save(body) で同期して保存し、discard() で消す。
//   利用者がわからない（userId なし）ときは、読みも書きもせず、保存できない案内（unavailable）も出さない。
//   保存先が使えない（SecurityError・QuotaExceededError）ときだけ受け止め、unavailable にして以後の書き込みを止める。
//   ただし消す操作（空白だけの本文の保存・discard）は止めない。それ以外の例外は受け止めずに投げ直す（エラーをもみ消さない）。
//   描画したまま利用者が替わったら（マウント時と違う userId・userId なし）、前の利用者の本文を新しい利用者のキーに書かない。
// キーの形は "internal-system:draft:v1:<userId>:room:<roomId>"。期待値は本番の定義から作らず、下で独立に書く。データは架空。
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDraft } from "./useDraft";

const USER_A = "01JTESTUSER00000000000UA01";
const USER_B = "01JTESTUSER00000000000UB01";
const ROOM = "01JTESTROOM00000000000UD01";
const SCOPE = `room:${ROOM}`;
const keyOf = (userId: string) =>
  `internal-system:draft:v1:${userId}:room:${ROOM}`;
const putDraft = (userId: string, body: string) =>
  window.localStorage.setItem(
    keyOf(userId),
    JSON.stringify({ body, updatedAt: Date.now() }),
  );
const savedBody = (userId: string): string | null => {
  const raw = window.localStorage.getItem(keyOf(userId));
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null && "body" in parsed
    ? String(parsed.body)
    : null;
};

const securityError = () => new DOMException("使えません", "SecurityError");
const quotaError = () =>
  new DOMException("容量を超えました", "QuotaExceededError");

const original = Object.getOwnPropertyDescriptor(window, "localStorage");
function denyStorageAccess() {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw securityError();
    },
  });
}

afterEach(() => {
  if (original !== undefined)
    Object.defineProperty(window, "localStorage", original);
  vi.restoreAllMocks();
});

type Props = { userId: string | undefined };

function renderDraft(userId: string | undefined) {
  return renderHook(({ userId: id }: Props) => useDraft(id, SCOPE), {
    initialProps: { userId },
  });
}

describe("#239 AC-1 保存先が使えないとき（useDraft）", () => {
  it("#239 AC-1: 読み込み（getItem）が SecurityError なら、復元せずに空で始め、保存できない案内（unavailable）を出す", () => {
    putDraft(USER_A, "[E2E_TEST]読めない下書き");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw securityError();
    });
    const { result } = renderDraft(USER_A);
    expect(result.current.initialBody).toBe("");
    expect(result.current.unavailable).toBe(true);
  });

  it("#239 AC-1: 読み込みが保存先の例外で失敗した後は、空白でない本文を書かず、保存・消す操作で例外も出さない", () => {
    putDraft(USER_A, "[E2E_TEST]読めない下書き");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw quotaError();
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderDraft(USER_A);
    expect(result.current.unavailable).toBe(true);
    expect(() => {
      act(() => result.current.save("[E2E_TEST]書けない"));
      act(() => result.current.save("   "));
      act(() => result.current.discard());
    }).not.toThrow();
    expect(setItem).not.toHaveBeenCalled();
    expect(result.current.unavailable).toBe(true);
  });

  it("#239 AC-1: 読み込みが保存先の例外でない失敗（想定外の例外）なら、受け止めずに投げ直す", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new TypeError("[E2E_TEST]想定外の失敗");
    });
    expect(() => renderDraft(USER_A)).toThrow("[E2E_TEST]想定外の失敗");
  });

  it("#239 AC-1: localStorage の参照が SecurityError のときに、空白だけの本文の保存・消す操作をしても、例外を出さない", () => {
    denyStorageAccess();
    const { result } = renderDraft(USER_A);
    expect(result.current.unavailable).toBe(true);
    expect(result.current.initialBody).toBe("");
    expect(() => {
      act(() => result.current.save(""));
      act(() => result.current.save(" \n "));
      act(() => result.current.discard());
    }).not.toThrow();
    expect(result.current.unavailable).toBe(true);
  });

  it("#239 AC-1: 書き込みが一度 QuotaExceededError になったら、その後に保存先が空いても、空白でない本文は書かない（書き込みを止める）", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => {
        throw quotaError();
      });
    const { result } = renderDraft(USER_A);
    expect(result.current.unavailable).toBe(false);
    act(() => result.current.save("[E2E_TEST]満杯"));
    expect(result.current.unavailable).toBe(true);
    act(() => result.current.save("[E2E_TEST]満杯の後"));
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(savedBody(USER_A)).toBeNull();
  });

  it("#239 AC-4: 書き込みを止めた後でも、空白だけの本文の保存で、前に保存できていた下書きを消す", () => {
    putDraft(USER_A, "[E2E_TEST]前の下書き");
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw quotaError();
    });
    const { result } = renderDraft(USER_A);
    act(() => result.current.save("[E2E_TEST]満杯"));
    expect(result.current.unavailable).toBe(true);
    expect(savedBody(USER_A)).toBe("[E2E_TEST]前の下書き");
    act(() => result.current.save("  "));
    expect(window.localStorage.getItem(keyOf(USER_A))).toBeNull();
  });

  it("#239 AC-1: 書き込みが保存先の例外でない失敗（想定外の例外）なら、受け止めずに投げ直し、保存できない案内にもしない", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new TypeError("[E2E_TEST]想定外の書き込みの失敗");
    });
    const { result } = renderDraft(USER_A);
    expect(() => result.current.save("[E2E_TEST]本文")).toThrow(
      "[E2E_TEST]想定外の書き込みの失敗",
    );
    expect(result.current.unavailable).toBe(false);
  });

  it("#239 AC-4: 消す操作（discard）が保存先の例外でない失敗なら、受け止めずに投げ直す", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new TypeError("[E2E_TEST]想定外の消去の失敗");
    });
    const { result } = renderDraft(USER_A);
    expect(() => result.current.discard()).toThrow(
      "[E2E_TEST]想定外の消去の失敗",
    );
  });
});

describe("#239 AC-2 利用者がわからない・替わったとき（useDraft）", () => {
  it("#239 AC-2: userId がないときは、端末を読まず（復元しない）、書かず、保存できない案内も出さない", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const { result } = renderDraft(undefined);
    expect(result.current.initialBody).toBe("");
    expect(result.current.unavailable).toBe(false);
    act(() => result.current.save("[E2E_TEST]誰のでもない"));
    act(() => result.current.save(""));
    act(() => result.current.discard());
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("#239 AC-2: userId がないときは、localStorage の参照が SecurityError でも、保存できない案内を出さない", () => {
    denyStorageAccess();
    const { result } = renderDraft(undefined);
    expect(result.current.unavailable).toBe(false);
    expect(result.current.initialBody).toBe("");
  });

  it("#239 AC-2: 描画したまま利用者が A→B に替わったら、A の本文を B のキーに書かず、A の下書きも変えない", () => {
    putDraft(USER_A, "[E2E_TEST]Aの下書き");
    const { result, rerender } = renderDraft(USER_A);
    expect(result.current.initialBody).toBe("[E2E_TEST]Aの下書き");
    rerender({ userId: USER_B });
    act(() => result.current.save("[E2E_TEST]Aが書いた続き"));
    expect(window.localStorage.getItem(keyOf(USER_B))).toBeNull();
    expect(savedBody(USER_A)).toBe("[E2E_TEST]Aの下書き");
    act(() => result.current.discard());
    expect(savedBody(USER_A)).toBe("[E2E_TEST]Aの下書き");
  });

  it("#239 AC-2: 描画したまま利用者がわからなくなったら（A→なし）、書き込みも消去もしない", () => {
    putDraft(USER_A, "[E2E_TEST]Aの下書き");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const { result, rerender } = renderDraft(USER_A);
    rerender({ userId: undefined });
    act(() => result.current.save("[E2E_TEST]続き"));
    act(() => result.current.save(""));
    act(() => result.current.discard());
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(savedBody(USER_A)).toBe("[E2E_TEST]Aの下書き");
  });

  it("#239 AC-1: 同じ利用者のままなら、保存・空白で消す・discard で消す、がそのキーに対して働く", () => {
    const { result, rerender } = renderDraft(USER_A);
    rerender({ userId: USER_A });
    act(() => result.current.save("[E2E_TEST]本文"));
    expect(savedBody(USER_A)).toBe("[E2E_TEST]本文");
    act(() => result.current.save(" "));
    expect(window.localStorage.getItem(keyOf(USER_A))).toBeNull();
    act(() => result.current.save("[E2E_TEST]もう一度"));
    act(() => result.current.discard());
    expect(window.localStorage.getItem(keyOf(USER_A))).toBeNull();
  });
});
