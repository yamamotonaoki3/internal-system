// #120 AC-3・0-2 AC-4：接続元・社員IDの試行制限のキー（ADR-0008・C-150）。
// 接続元は CF-Connecting-IP だけを使い、IPv6 は /64 に丸める。保存するのは HMAC-SHA256(LOGIN_THROTTLE_KEY, 値) だけ（生のIP・社員IDを残さない）。
// ヘッダーが無い・不正なときは、本番は 503 と logger.error、開発・テストは固定の値 "local"（D-5）。
// IP は文書用のアドレス（192.0.2.0/24・2001:db8::/32）だけを使う。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hmacHex, newThrottleKey } from "../../test/auth-fixtures";
import { AppError } from "./app-error";
import { createLogger } from "./logger/logger";
import {
  accountBucketKey,
  hmacKey,
  normalizeSourceIp,
  sourceBucketKey,
} from "./source-key";

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("normalizeSourceIp（IPの正規化）", () => {
  it("#120 AC-3: IPv4 はそのまま同じ値になり、違うIPは違う値になる", () => {
    expect(normalizeSourceIp("192.0.2.10")).toBe(
      normalizeSourceIp("192.0.2.10"),
    );
    expect(normalizeSourceIp("192.0.2.10")).not.toBe(
      normalizeSourceIp("192.0.2.11"),
    );
    expect(normalizeSourceIp("192.0.2.10")).not.toBeNull();
  });

  it("#120 AC-3: IPv6 は /64 に丸める（同じ /64 は同じ値、違う /64 は違う値）", () => {
    const a = normalizeSourceIp("2001:db8::1");
    expect(a).not.toBeNull();
    expect(normalizeSourceIp("2001:db8::ffff:1234")).toBe(a);
    expect(normalizeSourceIp("2001:db8:0:0:abcd::1")).toBe(a);
    expect(normalizeSourceIp("2001:db8:0:1::1")).not.toBe(a);
  });

  it("#120 AC-3: IPv6 の省略形・展開形・大文字小文字は同じ値になる", () => {
    const a = normalizeSourceIp("2001:db8::1");
    expect(normalizeSourceIp("2001:0DB8:0000:0000:0000:0000:0000:0001")).toBe(
      a,
    );
    expect(normalizeSourceIp("2001:DB8::1")).toBe(a);
  });

  it("#120 AC-3: IPv4 を埋め込んだ IPv6（::ffff:192.0.2.10）は IPv4 として扱う", () => {
    expect(normalizeSourceIp("::ffff:192.0.2.10")).toBe(
      normalizeSourceIp("192.0.2.10"),
    );
  });

  it("#120 AC-3: 不正な値・空は null（例外にしない）", () => {
    for (const bad of [
      "",
      " ",
      "999.0.2.1",
      "192.0.2",
      "192.0.2.10.5",
      "2001:db8:::1",
      "2001:db8::g",
      "localhost",
      "192.0.2.10, 192.0.2.20",
      "<script>",
    ]) {
      expect(normalizeSourceIp(bad), bad).toBeNull();
    }
    expect(normalizeSourceIp(undefined)).toBeNull();
  });
});

describe("HMAC のキー", () => {
  it("#120 AC-3: hmacKey は HMAC-SHA256(鍵, 値) の16進（独立に計算した値と一致）", async () => {
    const key = newThrottleKey();
    expect(await hmacKey(key, "192.0.2.10")).toBe(
      await hmacHex(key, "192.0.2.10"),
    );
  });

  it("#120 AC-3: 鍵が違えば、同じ値でも違うキーになる", async () => {
    expect(await hmacKey(newThrottleKey(), "192.0.2.10")).not.toBe(
      await hmacKey(newThrottleKey(), "192.0.2.10"),
    );
  });

  it("#120 0-2 AC-4: 社員IDのキーは、大文字小文字を区別しない（小文字にしてから HMAC）", async () => {
    const key = newThrottleKey();
    const a = await accountBucketKey("TestUser_001", key);
    expect(a).toBe(await accountBucketKey("testuser_001", key));
    expect(a).toBe(await hmacHex(key, "testuser_001"));
    expect(a).not.toContain("testuser");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sourceBucketKey（接続元のキー）", () => {
  const logger = createLogger();

  it("#120 AC-3: CF-Connecting-IP の IPv4 から、生のIPを含まない HMAC のキーを作る", async () => {
    const key = newThrottleKey();
    const bucket = await sourceBucketKey("192.0.2.10", {
      appEnv: "production",
      throttleKey: key,
      logger,
    });
    expect(bucket).toMatch(/^[0-9a-f]{64}$/);
    expect(bucket).not.toContain("192.0.2");
  });

  it("#120 AC-3: 同じ /64 の IPv6 は同じキー、違う /64 は違うキー", async () => {
    const key = newThrottleKey();
    const opts = { appEnv: "production", throttleKey: key, logger };
    const a = await sourceBucketKey("2001:db8::1", opts);
    expect(await sourceBucketKey("2001:db8::2", opts)).toBe(a);
    expect(await sourceBucketKey("2001:db8:0:1::1", opts)).not.toBe(a);
  });

  it("#120 AC-3（D-5）: 本番でヘッダーが無い・不正なときは 503（SERVICE_UNAVAILABLE）と logger.error。値は出力しない", async () => {
    const key = newThrottleKey();
    for (const header of [undefined, "not-an-ip"]) {
      errorSpy.mockClear();
      const error = await sourceBucketKey(header, {
        appEnv: "production",
        throttleKey: key,
        logger,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("SERVICE_UNAVAILABLE");
      expect(errorSpy).toHaveBeenCalled();
      const output = errorSpy.mock.calls
        .map((c: unknown[]) => c.join(" "))
        .join("\n");
      expect(output).not.toContain(key);
      expect(output).not.toContain("not-an-ip");
    }
  });

  it("#120 AC-3（D-5）: 開発・テストでヘッダーが無い・不正なときは、固定の値 local のキーにする", async () => {
    const key = newThrottleKey();
    const expected = await hmacHex(key, "local");
    for (const appEnv of ["development", "test"]) {
      for (const header of [undefined, "not-an-ip"]) {
        expect(
          await sourceBucketKey(header, { appEnv, throttleKey: key, logger }),
          `${appEnv} ${String(header)}`,
        ).toBe(expected);
      }
    }
  });
});
