// #340 AC-1・AC-2・AC-5（計画 plan-340 改訂1 の「消去の失敗の扱い」D-3・D-4）：資格を失った案件の部屋の下書きを消す関数 forgetCaseRoomDrafts。
// 消せた（対象が無かった場合を含む）と、消せなかった（保存先を開けない・SecurityError）を区別して返す。それ以外の例外は、投げる（もみ消さない）。
// 前提にした口（実装の担当へ）：useCaseWrites.ts の forgetCaseRoomDrafts(userId: string, roomId: string | null): "removed" | "failed"。
//   roomId が null のときは、保存先に触れない。
// 保存先は jsdom の localStorage。キーは本番の関数を使わず、リテラルで独立に書く。データは架空（[UNIT_TEST]）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetCaseRoomDrafts } from "./useCaseWrites";

const USER = "01JTESTUSER340000000000FW1";
const OTHER_USER = "01JTESTUSER340000000000FW2";
const ROOM = "01JTESTROOM340000000000FW1";
const OTHER_ROOM = "01JTESTROOM340000000000FW2";
const PARENT = "01JTESTMSG3400000000000FW1";

const keyOf = (userId: string, scope: string) =>
  `internal-system:draft:v1:${userId}:${scope}`;
const value = (label: string) =>
  JSON.stringify({ body: `[UNIT_TEST]340${label}`, updatedAt: Date.now() });

const OWN_ROOM = keyOf(USER, `room:${ROOM}`);
const OWN_THREAD = keyOf(USER, `thread:${ROOM}:${PARENT}`);
const KEPT = [
  keyOf(USER, `room:${OTHER_ROOM}`),
  keyOf(USER, "case-request:new"),
  keyOf(OTHER_USER, `room:${ROOM}`),
];

function seed() {
  window.localStorage.setItem(OWN_ROOM, value("部屋"));
  window.localStorage.setItem(OWN_THREAD, value("返信"));
  for (const key of KEPT) window.localStorage.setItem(key, value(key));
}

const keys = () => Object.keys(window.localStorage).sort();

/** localStorage の下書きのキーの削除だけを失敗させる（sessionStorage・ほかの操作は本物のまま） */
function failDraftRemoval(error: unknown) {
  const original = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
    this: Storage,
    key: string,
  ) {
    if (
      this === window.localStorage &&
      key.startsWith("internal-system:draft:")
    )
      throw error;
    original.call(this, key);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#340 forgetCaseRoomDrafts：その部屋の下書きを消し、結果を区別して返す", () => {
  it("#340 AC-1・AC-2: 持ち主のその部屋の下書き（投稿・スレッドの返信）を消して removed を返す。ほかの部屋・申請・ほかの利用者は残る", () => {
    seed();
    expect(forgetCaseRoomDrafts(USER, ROOM)).toBe("removed");
    expect(keys()).toEqual([...KEPT].sort());
  });

  it("#340 AC-1: 消す対象が無くても removed（消せなかったとは扱わない）", () => {
    window.localStorage.setItem(KEPT[2] ?? "", value("他人"));
    expect(forgetCaseRoomDrafts(USER, ROOM)).toBe("removed");
    expect(keys()).toEqual([KEPT[2]]);
  });

  it("#340 AC-3: 部屋の ID が分からない（null）ときは、保存先に触れない（例外にもならない）", () => {
    seed();
    expect(() => forgetCaseRoomDrafts(USER, null)).not.toThrow();
    expect(keys()).toEqual([OWN_ROOM, OWN_THREAD, ...KEPT].sort());
  });

  it("#340 AC-5 D-3: 削除だけが SecurityError を投げる（保存した後に使えなくなった）とき、例外にせず failed を返す。下書きは残っている（成功と取り違えない）", () => {
    seed();
    failDraftRemoval(new DOMException("denied", "SecurityError"));
    expect(forgetCaseRoomDrafts(USER, ROOM)).toBe("failed");
    expect(window.localStorage.getItem(OWN_ROOM)).not.toBeNull();
  });

  it("#340 AC-5 D-4: 保存先を開けない（localStorage の参照が SecurityError）とき、確かめられないので failed を返す", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(forgetCaseRoomDrafts(USER, ROOM)).toBe("failed");
  });

  it("#340 AC-5: 想定外の例外（TypeError）は、受け止めずに投げる", () => {
    seed();
    const unexpected = new TypeError("[UNIT_TEST]340想定外");
    failDraftRemoval(unexpected);
    expect(() => forgetCaseRoomDrafts(USER, ROOM)).toThrow(unexpected);
  });
});
