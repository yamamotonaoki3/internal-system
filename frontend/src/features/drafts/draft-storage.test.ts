// #239 AC-1〜AC-3（1-1 AC-4・C-82・C-117）：端末の下書きの保存・読み込み・消去の純粋な関数。
// 契約（実装前の仮置き。計画 plan-239 と改訂1〜5）：
//   features/drafts/draft-policy.ts：roomDraftScope(roomId) → "room:<roomId>"、draftKey(userId, scope) → "internal-system:draft:v1:<userId>:<scope>"
//   features/drafts/draft-storage.ts：
//     openDraftStorage(): Storage | null（window.localStorage の参照が SecurityError なら null。それ以外の例外は投げ直す）
//     readDraft(storage, userId, scope, now): string | null（期限切れ・壊れた値は、そのキーを消して null）
//     writeDraft(storage, userId, scope, body, now): void（空・空白だけはキーを消す。値は {"body","updatedAt"} の JSON）
//     removeDraft(storage, userId, scope): void
//     removeUserDrafts(storage, userId): void（その利用者の接頭辞のキーだけ）
//     purgeExpiredDrafts(storage, now): void（全利用者の、接頭辞が一致する期限切れ・壊れた値だけ）
//     purgeExpiredDraftsOnStartup(storage | null, now): void（null は何もしない。DraftStorageUnavailableError だけ受け止める）
//     DraftStorageUnavailableError（DOMException の SecurityError・QuotaExceededError をこれに変えて投げる。それ以外はそのまま）
// 期限：now - updatedAt >= 7日 で期限切れ。updatedAt > now + 5分（時計のずれの余裕）も壊れた値として消す（U-6 の改訂）。
// 期待値は本番の定義（DRAFT_TTL_MS・DRAFT_CLOCK_SKEW_MS）から作らず、下で独立に書く。データは架空。
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { draftKey, roomDraftScope } from "./draft-policy";
import {
  DraftStorageUnavailableError,
  openDraftStorage,
  purgeExpiredDrafts,
  purgeExpiredDraftsOnStartup,
  readDraft,
  removeDraft,
  removeUserDrafts,
  writeDraft,
} from "./draft-storage";

const DAY = 24 * 60 * 60 * 1000;
const TTL = 7 * 24 * 60 * 60 * 1000;
const SKEW = 5 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 13, 0, 0, 0);

const USER_A = "01JTESTUSER00000000000DA01";
const USER_B = "01JTESTUSER00000000000DB01";
const ROOM_1 = "01JTESTROOM00000000000D001";
const ROOM_2 = "01JTESTROOM00000000000D002";
const SCOPE_1 = `room:${ROOM_1}`;
const SCOPE_2 = `room:${ROOM_2}`;

/** 保存先のキー（本番の draftKey を使わず、決めた形を独立に書く） */
const keyOf = (userId: string, scope: string) =>
  `internal-system:draft:v1:${userId}:${scope}`;
const valueOf = (body: string, updatedAt: number) =>
  JSON.stringify({ body, updatedAt });

/** テスト用の保存先。throwOn に指定した操作で、指定した例外を投げる */
class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  throwOn: Partial<
    Record<"getItem" | "setItem" | "removeItem" | "key" | "length", unknown>
  > = {};

  private check(name: keyof MemoryStorage["throwOn"]) {
    if (name in this.throwOn) throw this.throwOn[name];
  }
  get length(): number {
    this.check("length");
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    this.check("getItem");
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    this.check("key");
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.check("removeItem");
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.check("setItem");
    this.map.set(key, value);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

const quota = () => new DOMException("容量を超えました", "QuotaExceededError");
const security = () => new DOMException("使えません", "SecurityError");

describe("#239 AC-1・AC-2 キーの形", () => {
  it("#239 AC-2: キーは接頭辞・利用者ID・scope（room:<部屋ID>）をつないだ形で、利用者ごとに分かれる", () => {
    expect(roomDraftScope(ROOM_1)).toBe(`room:${ROOM_1}`);
    expect(draftKey(USER_A, roomDraftScope(ROOM_1))).toBe(
      `internal-system:draft:v1:${USER_A}:room:${ROOM_1}`,
    );
    expect(draftKey(USER_A, SCOPE_1)).not.toBe(draftKey(USER_B, SCOPE_1));
    expect(draftKey(USER_A, SCOPE_1)).not.toBe(draftKey(USER_A, SCOPE_2));
  });
});

describe("#239 AC-1 書いて読む", () => {
  it("#239 AC-1: writeDraft で書いた本文を readDraft で同じまま読める（改行・前後の空白も保つ）", () => {
    const storage = new MemoryStorage();
    const body = "  [E2E_TEST]書きかけ\n2行目  ";
    writeDraft(storage, USER_A, SCOPE_1, body, NOW);
    expect(readDraft(storage, USER_A, SCOPE_1, NOW)).toBe(body);
  });

  it("#239 AC-1・AC-3: 値は本文と最終編集日時（数値）の JSON で、決めたキーに保存する", () => {
    const storage = new MemoryStorage();
    writeDraft(storage, USER_A, SCOPE_1, "[E2E_TEST]本文", NOW);
    expect(storage.keys()).toEqual([keyOf(USER_A, SCOPE_1)]);
    const saved: unknown = JSON.parse(
      storage.getItem(keyOf(USER_A, SCOPE_1)) ?? "null",
    );
    expect(saved).toEqual({ body: "[E2E_TEST]本文", updatedAt: NOW });
  });

  it("#239 AC-1: 書き直すと最終編集日時も新しくなる", () => {
    const storage = new MemoryStorage();
    writeDraft(storage, USER_A, SCOPE_1, "[E2E_TEST]1回目", NOW);
    writeDraft(storage, USER_A, SCOPE_1, "[E2E_TEST]2回目", NOW + 1000);
    expect(
      JSON.parse(storage.getItem(keyOf(USER_A, SCOPE_1)) ?? "null"),
    ).toEqual({ body: "[E2E_TEST]2回目", updatedAt: NOW + 1000 });
  });

  it.each([
    ["空", ""],
    ["空白だけ", " "],
    ["改行とタブと全角空白だけ", "\n\t　 \n"],
  ])(
    "#239 AC-1: %s を書くと、保存していた下書きのキーが消える",
    (_l, blank) => {
      const storage = new MemoryStorage();
      writeDraft(storage, USER_A, SCOPE_1, "[E2E_TEST]書きかけ", NOW);
      writeDraft(storage, USER_A, SCOPE_1, blank, NOW);
      expect(storage.getItem(keyOf(USER_A, SCOPE_1))).toBeNull();
      expect(readDraft(storage, USER_A, SCOPE_1, NOW)).toBeNull();
    },
  );

  it("#239 AC-1: 下書きがないときは null（キーを作らない）", () => {
    const storage = new MemoryStorage();
    expect(readDraft(storage, USER_A, SCOPE_1, NOW)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("#239 AC-1: 部屋が違えば別の下書きになる", () => {
    const storage = new MemoryStorage();
    writeDraft(storage, USER_A, SCOPE_1, "[E2E_TEST]部屋1", NOW);
    writeDraft(storage, USER_A, SCOPE_2, "[E2E_TEST]部屋2", NOW);
    expect(readDraft(storage, USER_A, SCOPE_1, NOW)).toBe("[E2E_TEST]部屋1");
    expect(readDraft(storage, USER_A, SCOPE_2, NOW)).toBe("[E2E_TEST]部屋2");
  });
});

describe("#239 AC-2 利用者ごとの分離", () => {
  it("#239 AC-2: A の下書きは、同じ部屋でも B の readDraft では読めず、A の下書きも消さない", () => {
    const storage = new MemoryStorage();
    writeDraft(storage, USER_A, SCOPE_1, "[E2E_TEST]Aの書きかけ", NOW);
    expect(readDraft(storage, USER_B, SCOPE_1, NOW)).toBeNull();
    expect(readDraft(storage, USER_A, SCOPE_1, NOW)).toBe(
      "[E2E_TEST]Aの書きかけ",
    );
  });

  it("#239 AC-2・AC-4: removeUserDrafts(A) は A の下書きをすべて消し、B の下書き・接頭辞の違うキーを残す", () => {
    const storage = new MemoryStorage();
    storage.setItem(keyOf(USER_A, SCOPE_1), valueOf("[E2E_TEST]A1", NOW));
    storage.setItem("other-app:setting", "keep");
    storage.setItem(keyOf(USER_A, SCOPE_2), valueOf("[E2E_TEST]A2", NOW));
    storage.setItem(keyOf(USER_B, SCOPE_1), valueOf("[E2E_TEST]B1", NOW));
    storage.setItem(
      `internal-system:draft:v2:${USER_A}:${SCOPE_1}`,
      valueOf("[E2E_TEST]版違い", NOW),
    );
    // 利用者IDの前方一致で別人を巻き込まない
    storage.setItem(
      keyOf(`${USER_A}X`, SCOPE_1),
      valueOf("[E2E_TEST]似たID", NOW),
    );
    removeUserDrafts(storage, USER_A);
    expect(storage.keys().sort()).toEqual(
      [
        "other-app:setting",
        keyOf(USER_B, SCOPE_1),
        `internal-system:draft:v2:${USER_A}:${SCOPE_1}`,
        keyOf(`${USER_A}X`, SCOPE_1),
      ].sort(),
    );
  });

  it("#239 AC-4: removeUserDrafts は、その利用者のキーが連続していても・全件がその利用者でも、取りこぼさない", () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < 5; i += 1)
      storage.setItem(
        keyOf(USER_A, `room:R${i}`),
        valueOf(`[E2E_TEST]${i}`, NOW),
      );
    removeUserDrafts(storage, USER_A);
    expect(storage.length).toBe(0);
  });

  it("#239 AC-4: removeDraft はその利用者・その部屋のキーだけを消す", () => {
    const storage = new MemoryStorage();
    storage.setItem(keyOf(USER_A, SCOPE_1), valueOf("[E2E_TEST]A1", NOW));
    storage.setItem(keyOf(USER_A, SCOPE_2), valueOf("[E2E_TEST]A2", NOW));
    storage.setItem(keyOf(USER_B, SCOPE_1), valueOf("[E2E_TEST]B1", NOW));
    removeDraft(storage, USER_A, SCOPE_1);
    expect(storage.keys().sort()).toEqual(
      [keyOf(USER_A, SCOPE_2), keyOf(USER_B, SCOPE_1)].sort(),
    );
  });
});

describe("#239 AC-3 期限（7日）と壊れた値", () => {
  it("#239 AC-3: 最終編集から 7日−1ms は期限内で読める", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      keyOf(USER_A, SCOPE_1),
      valueOf("[E2E_TEST]期限内", NOW - (TTL - 1)),
    );
    expect(readDraft(storage, USER_A, SCOPE_1, NOW)).toBe("[E2E_TEST]期限内");
    expect(storage.getItem(keyOf(USER_A, SCOPE_1))).not.toBeNull();
  });

  it("#239 AC-3: 最終編集からちょうど7日で期限切れ。readDraft は null を返し、そのキーを消す", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      keyOf(USER_A, SCOPE_1),
      valueOf("[E2E_TEST]期限切れ", NOW - TTL),
    );
    expect(readDraft(storage, USER_A, SCOPE_1, NOW)).toBeNull();
    expect(storage.getItem(keyOf(USER_A, SCOPE_1))).toBeNull();
  });

  it("#239 AC-3: 未来の日時は now + 5分 ちょうどまで期限内、+5分+1ms は壊れた値として消す", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      keyOf(USER_A, SCOPE_1),
      valueOf("[E2E_TEST]少し未来", NOW + SKEW),
    );
    storage.setItem(
      keyOf(USER_A, SCOPE_2),
      valueOf("[E2E_TEST]遠い未来", NOW + SKEW + 1),
    );
    expect(readDraft(storage, USER_A, SCOPE_1, NOW)).toBe("[E2E_TEST]少し未来");
    expect(readDraft(storage, USER_A, SCOPE_2, NOW)).toBeNull();
    expect(storage.getItem(keyOf(USER_A, SCOPE_2))).toBeNull();
  });

  it.each([
    ["JSON でない", "[E2E_TEST]壊れた値"],
    ["null", "null"],
    ["配列", "[]"],
    ["body が文字列でない", JSON.stringify({ body: 1, updatedAt: NOW })],
    ["updatedAt がない", JSON.stringify({ body: "[E2E_TEST]x" })],
    [
      "updatedAt が文字列",
      JSON.stringify({ body: "[E2E_TEST]x", updatedAt: String(NOW) }),
    ],
    [
      "updatedAt が小数",
      JSON.stringify({ body: "[E2E_TEST]x", updatedAt: NOW + 0.5 }),
    ],
    ["updatedAt が負", JSON.stringify({ body: "[E2E_TEST]x", updatedAt: -1 })],
    ["updatedAt が無限大", '{"body":"[E2E_TEST]x","updatedAt":1e400}'],
  ])(
    "#239 AC-3: 保存した値が %s ときは、下書きなし（null）としてそのキーを消す",
    (_l, raw) => {
      const storage = new MemoryStorage();
      storage.setItem(keyOf(USER_A, SCOPE_1), raw);
      expect(readDraft(storage, USER_A, SCOPE_1, NOW)).toBeNull();
      expect(storage.getItem(keyOf(USER_A, SCOPE_1))).toBeNull();
    },
  );

  it("#239 AC-3: purgeExpiredDrafts は、他の利用者の分も含めて期限切れ・壊れた値だけを消し、期限内・接頭辞の違うキーは残す", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      keyOf(USER_A, SCOPE_1),
      valueOf("[E2E_TEST]A期限切れ", NOW - 8 * DAY),
    );
    storage.setItem(
      keyOf(USER_A, SCOPE_2),
      valueOf("[E2E_TEST]A期限内", NOW - DAY),
    );
    storage.setItem(
      keyOf(USER_B, SCOPE_1),
      valueOf("[E2E_TEST]B期限切れ", NOW - TTL),
    );
    storage.setItem(
      keyOf(USER_B, SCOPE_2),
      valueOf("[E2E_TEST]Bぎりぎり", NOW - TTL + 1),
    );
    storage.setItem(keyOf(USER_B, "room:BROKEN"), "[E2E_TEST]壊れた値");
    storage.setItem(
      keyOf(USER_B, "room:FUTURE"),
      valueOf("[E2E_TEST]遠い未来", NOW + SKEW + 1),
    );
    storage.setItem("other-app:old", valueOf("[E2E_TEST]他", NOW - 30 * DAY));
    purgeExpiredDrafts(storage, NOW);
    expect(storage.keys().sort()).toEqual(
      [keyOf(USER_A, SCOPE_2), keyOf(USER_B, SCOPE_2), "other-app:old"].sort(),
    );
  });

  it("#239 AC-3: purgeExpiredDrafts は、期限切れが連続していても・全件が期限切れでも取りこぼさない", () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < 6; i += 1)
      storage.setItem(
        keyOf(i % 2 === 0 ? USER_A : USER_B, `room:R${i}`),
        valueOf(`[E2E_TEST]${i}`, NOW - TTL - i),
      );
    purgeExpiredDrafts(storage, NOW);
    expect(storage.length).toBe(0);
  });

  it("#239 AC-3（性質）: どんな最終編集日時・現在時刻でも、purge の後に残る下書きは now - updatedAt < 7日 かつ updatedAt <= now + 5分 のものだけで、それに当たるものは全部残る", () => {
    const offset = fc.oneof(
      fc.integer({ min: -2 * TTL, max: 2 * TTL }),
      fc.constantFrom(TTL, TTL - 1, TTL + 1, -SKEW, -SKEW - 1, -SKEW + 1, 0),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 3 * TTL, max: 2 ** 45 }),
        fc.array(fc.tuple(fc.constantFrom(USER_A, USER_B), offset), {
          maxLength: 12,
        }),
        (now, entries) => {
          const storage = new MemoryStorage();
          storage.setItem("other-app:keep", "x");
          const expected: string[] = ["other-app:keep"];
          entries.forEach(([userId, ago], index) => {
            const updatedAt = now - ago;
            const key = keyOf(userId, `room:P${index}`);
            storage.setItem(key, valueOf(`[E2E_TEST]${index}`, updatedAt));
            if (now - updatedAt < TTL && updatedAt <= now + SKEW)
              expected.push(key);
          });
          purgeExpiredDrafts(storage, now);
          expect(storage.keys().sort()).toEqual(expected.sort());
        },
      ),
    );
  });
});

describe("#239 保存できない環境（異常系）", () => {
  it.each([
    ["QuotaExceededError", quota],
    ["SecurityError", security],
  ])(
    "#239 AC-1: setItem が %s を投げたら、writeDraft は DraftStorageUnavailableError を投げる",
    (_l, make) => {
      const storage = new MemoryStorage();
      storage.throwOn.setItem = make();
      expect(() =>
        writeDraft(storage, USER_A, SCOPE_1, "[E2E_TEST]本文", NOW),
      ).toThrow(DraftStorageUnavailableError);
    },
  );

  it("#239 AC-1: getItem が SecurityError を投げたら、readDraft は DraftStorageUnavailableError を投げる（下書きなしにしない）", () => {
    const storage = new MemoryStorage();
    storage.throwOn.getItem = security();
    expect(() => readDraft(storage, USER_A, SCOPE_1, NOW)).toThrow(
      DraftStorageUnavailableError,
    );
  });

  it("#239 AC-4: removeItem が SecurityError を投げたら、removeDraft・removeUserDrafts は DraftStorageUnavailableError を投げる", () => {
    const storage = new MemoryStorage();
    storage.setItem(keyOf(USER_A, SCOPE_1), valueOf("[E2E_TEST]A1", NOW));
    storage.throwOn.removeItem = security();
    expect(() => removeDraft(storage, USER_A, SCOPE_1)).toThrow(
      DraftStorageUnavailableError,
    );
    expect(() => removeUserDrafts(storage, USER_A)).toThrow(
      DraftStorageUnavailableError,
    );
  });

  it.each([
    ["writeDraft の setItem", "setItem"],
    ["readDraft の getItem", "getItem"],
    ["removeUserDrafts の removeItem", "removeItem"],
    ["purgeExpiredDrafts の key", "key"],
  ] as const)(
    "#239: %s が想定外の例外を投げたら、変えずにそのまま投げ直す（もみ消さない）",
    (_l, method) => {
      const storage = new MemoryStorage();
      storage.setItem(
        keyOf(USER_A, SCOPE_1),
        valueOf("[E2E_TEST]A1", NOW - 8 * DAY),
      );
      const unexpected = new TypeError("[UNIT_TEST]想定外");
      storage.throwOn[method] = unexpected;
      const run = {
        setItem: () =>
          writeDraft(storage, USER_A, SCOPE_1, "[E2E_TEST]本文", NOW),
        getItem: () => readDraft(storage, USER_A, SCOPE_1, NOW),
        removeItem: () => removeUserDrafts(storage, USER_A),
        key: () => purgeExpiredDrafts(storage, NOW),
      }[method];
      let caught: unknown;
      try {
        run();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(unexpected);
    },
  );

  it("#239: QuotaExceededError でない DOMException（例：NotFoundError）は、変えずに投げ直す", () => {
    const storage = new MemoryStorage();
    const other = new DOMException("[UNIT_TEST]別の例外", "NotFoundError");
    storage.throwOn.setItem = other;
    let caught: unknown;
    try {
      writeDraft(storage, USER_A, SCOPE_1, "[E2E_TEST]本文", NOW);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(other);
  });
});

describe("#239 AC-3 アプリを開いたときの掃除（purgeExpiredDraftsOnStartup）", () => {
  it("#239 AC-3: 期限切れだけを消し、期限内は残す", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      keyOf(USER_A, SCOPE_1),
      valueOf("[E2E_TEST]期限切れ", NOW - 8 * DAY),
    );
    storage.setItem(
      keyOf(USER_B, SCOPE_1),
      valueOf("[E2E_TEST]期限内", NOW - DAY),
    );
    purgeExpiredDraftsOnStartup(storage, NOW);
    expect(storage.keys()).toEqual([keyOf(USER_B, SCOPE_1)]);
  });

  it("#239 AC-3: 保存先がない（null）ときは何もせず、例外も投げない", () => {
    expect(() => purgeExpiredDraftsOnStartup(null, NOW)).not.toThrow();
  });

  it("#239 AC-3: 保存先が使えない（SecurityError）ときは、起動を止めないよう投げない", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      keyOf(USER_A, SCOPE_1),
      valueOf("[E2E_TEST]期限切れ", NOW - 8 * DAY),
    );
    storage.throwOn.key = security();
    storage.throwOn.removeItem = security();
    expect(() => purgeExpiredDraftsOnStartup(storage, NOW)).not.toThrow();
  });

  it("#239 AC-3: 想定外の例外は受け止めずに投げ直す", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      keyOf(USER_A, SCOPE_1),
      valueOf("[E2E_TEST]期限切れ", NOW - 8 * DAY),
    );
    const unexpected = new TypeError("[UNIT_TEST]想定外");
    storage.throwOn.key = unexpected;
    storage.throwOn.removeItem = unexpected;
    expect(() => purgeExpiredDraftsOnStartup(storage, NOW)).toThrow(unexpected);
  });
});

describe("#239 保存先を開く（openDraftStorage）", () => {
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");
  afterEach(() => {
    if (original !== undefined)
      Object.defineProperty(window, "localStorage", original);
  });

  function replaceLocalStorage(get: () => Storage) {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get,
    });
  }

  it("#239: 使えるときは window.localStorage を返す", () => {
    expect(openDraftStorage()).toBe(window.localStorage);
  });

  it("#239: window.localStorage の参照が SecurityError なら null（保存先なし）", () => {
    replaceLocalStorage(() => {
      throw security();
    });
    expect(openDraftStorage()).toBeNull();
  });

  it("#239: window.localStorage の参照が想定外の例外なら、そのまま投げ直す", () => {
    const unexpected = new TypeError("[UNIT_TEST]想定外");
    replaceLocalStorage(() => {
      throw unexpected;
    });
    expect(() => openDraftStorage()).toThrow(unexpected);
  });
});
