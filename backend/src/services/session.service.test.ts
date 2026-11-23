// #298 AC-1：resolveSession に想定の利用者（expectedUserId。任意の4つ目の引数）を渡すと、
// セッションの読み取り・期限の判定の後、最終操作の時刻の更新（touchSession）より前に比べ、食い違えば更新せずに「食い違い」を返す。
// 前提にする契約（テストで決めたもの。報告に明記）：食い違いの結果は { mismatch: true } を含む値。一致・省略のときの結果は今どおり
// （利用者の情報。{ principal } で包む形でも読めるようにしてある）。期限切れ・失効・無効の利用者は、食い違いより先に null。
// 更新の間隔は、方針（C-149）の1分を、本番の定数を読まずに独立に書く。Repository は差し替える（DB を使わない単体）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SessionRecord,
  SessionRepository,
} from "../db/session.repository";
import { createLogger } from "../lib/logger/logger";
import { resolveSession } from "./session.service";

const TOUCH_INTERVAL_MS = 60_000;
const NOW = new Date("2026-11-23T03:00:00.000Z");
const USER_A = "01JA0000000000000000000AAA";
const USER_B = "01JB0000000000000000000BBB";

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    userId: USER_B,
    displayName: "テスト太郎",
    loginId: "testuser_mismatch_b",
    mustChangePassword: false,
    reauthenticatedAt: null,
    isActive: true,
    createdAt: new Date(NOW.getTime() - 10 * TOUCH_INTERVAL_MS).toISOString(),
    lastActiveAt: new Date(NOW.getTime() - 5 * TOUCH_INTERVAL_MS).toISOString(),
    revokedAt: null,
    ...overrides,
  };
}

function fakeRepository(found: SessionRecord | null) {
  const touchSession = vi.fn(async () => true);
  const repository: SessionRepository = {
    findSession: vi.fn(async () => found),
    touchSession,
  };
  return { repository, touchSession };
}

const resolve = (repository: SessionRepository, expectedUserId?: string) =>
  resolveSession(
    repository,
    "test-token-298",
    { now: () => NOW, logger: createLogger() },
    expectedUserId,
  ) as Promise<unknown>;

const isMismatch = (result: unknown) =>
  typeof result === "object" &&
  result !== null &&
  (result as { mismatch?: unknown }).mismatch === true;

/** 一致・省略のときの利用者（今どおりの値、または { principal } で包んだ値） */
const principalOf = (result: unknown) =>
  typeof result === "object" && result !== null && "principal" in result
    ? (result as { principal: unknown }).principal
    : result;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("#298 AC-1 resolveSession の想定の利用者の比較", () => {
  it.each([
    ["ちょうど1分", TOUCH_INTERVAL_MS],
    ["5分", 5 * TOUCH_INTERVAL_MS],
    ["1分−1ms", TOUCH_INTERVAL_MS - 1],
  ])(
    "#298 AC-1: 最終操作から%s経っていても、食い違えば touchSession を呼ばずに食い違いを返す",
    async (_label, elapsed) => {
      const { repository, touchSession } = fakeRepository(
        record({
          lastActiveAt: new Date(NOW.getTime() - elapsed).toISOString(),
        }),
      );
      const result = await resolve(repository, USER_A);
      expect(isMismatch(result)).toBe(true);
      expect(principalOf(result)).not.toMatchObject({ userId: USER_B });
      expect(touchSession).not.toHaveBeenCalled();
    },
  );

  it("#298 AC-1: 一致すれば今どおり（ちょうど1分なら touchSession を呼び、利用者を返す）", async () => {
    const lastActiveAt = new Date(
      NOW.getTime() - TOUCH_INTERVAL_MS,
    ).toISOString();
    const { repository, touchSession } = fakeRepository(
      record({ lastActiveAt }),
    );
    const result = await resolve(repository, USER_B);
    expect(isMismatch(result)).toBe(false);
    expect(principalOf(result)).toMatchObject({ userId: USER_B });
    expect(touchSession).toHaveBeenCalledTimes(1);
    expect(touchSession).toHaveBeenCalledWith(
      expect.any(String),
      lastActiveAt,
      NOW,
    );
  });

  it("#298 AC-1: 一致して1分−1msなら、今どおり touchSession を呼ばない", async () => {
    const { repository, touchSession } = fakeRepository(
      record({
        lastActiveAt: new Date(
          NOW.getTime() - (TOUCH_INTERVAL_MS - 1),
        ).toISOString(),
      }),
    );
    const result = await resolve(repository, USER_B);
    expect(principalOf(result)).toMatchObject({ userId: USER_B });
    expect(touchSession).not.toHaveBeenCalled();
  });

  it("#298 AC-1: 想定の利用者を渡さなければ今どおり（利用者を返し、間隔を過ぎていれば更新する）", async () => {
    const { repository, touchSession } = fakeRepository(record());
    const result = await resolve(repository);
    expect(isMismatch(result)).toBe(false);
    expect(principalOf(result)).toMatchObject({ userId: USER_B });
    expect(touchSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "期限切れ（無操作30分ちょうど）",
      record({
        lastActiveAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
      }),
    ],
    [
      "期限切れ（ログインから24時間ちょうど）",
      record({
        createdAt: new Date(NOW.getTime() - 24 * 60 * 60_000).toISOString(),
      }),
    ],
    [
      "失効",
      record({
        revokedAt: new Date(NOW.getTime() - TOUCH_INTERVAL_MS).toISOString(),
      }),
    ],
    ["無効化された利用者", record({ isActive: false })],
    ["存在しないトークン", null],
  ] as const)(
    "#298 AC-1: %sは、食い違いより先に null（食い違いにしない・更新しない）",
    async (_label, found) => {
      const { repository, touchSession } = fakeRepository(found);
      const result = await resolve(repository, USER_A);
      expect(result).toBeNull();
      expect(touchSession).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["空", ""],
    ["空白だけ", "   "],
  ])(
    "#298 AC-1: 値が%sなら食い違いとして返し、touchSession を呼ばない",
    async (_label, value) => {
      const { repository, touchSession } = fakeRepository(record());
      const result = await resolve(repository, value);
      expect(isMismatch(result)).toBe(true);
      expect(touchSession).not.toHaveBeenCalled();
    },
  );

  it("#298 AC-1: 65文字の値は、先頭が利用者の ID と同じでも食い違い（切り詰めて比べない）", async () => {
    const { repository, touchSession } = fakeRepository(record());
    const result = await resolve(repository, USER_B.padEnd(65, "0"));
    expect(isMismatch(result)).toBe(true);
    expect(touchSession).not.toHaveBeenCalled();
  });
});
