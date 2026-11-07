// #120 AC-3：試行制限の HMAC の鍵 LOGIN_THROTTLE_KEY の読み込み（計画：43文字の base64url。未設定・不正は null にして、ログインと setup の POST だけを 503 にする）。
// 値はテストの中で乱数から作る（実際の値を書かない）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBase64Url } from "../test/random-secrets";
import { loadConfig } from "./config";

const base = { APP_ENV: "test", ALLOWED_ORIGINS: "http://localhost:5173" };

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("LOGIN_THROTTLE_KEY の読み込み", () => {
  it("#181 AC-2/3: 試行制限鍵も英数・_-を許可し、前後空白と禁止文字を拒否する", () => {
    const value = `Az09_-${randomBase64Url(32).slice(6)}`;
    expect(
      loadConfig({ ...base, LOGIN_THROTTLE_KEY: value }).loginThrottleKey,
    ).toBe(value);
    for (const invalid of [
      ` ${value}`,
      `${value} `,
      `/${value.slice(1)}`,
      `=${value.slice(1)}`,
      ` ${value.slice(1)}`,
      `あ${value.slice(1)}`,
    ]) {
      errorSpy.mockClear();
      expect(
        loadConfig({ ...base, LOGIN_THROTTLE_KEY: invalid }).loginThrottleKey,
      ).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
      const output = errorSpy.mock.calls
        .map((call: unknown[]) => call.join(" "))
        .join("\n");
      expect(output).toContain("LOGIN_THROTTLE_KEY");
      expect(output).not.toContain(invalid);
      expect(output).not.toContain(value);
    }
  });

  it("#120 AC-3: 43文字の base64url は、そのまま loginThrottleKey になる", () => {
    const key = randomBase64Url(32);
    expect(
      loadConfig({ ...base, LOGIN_THROTTLE_KEY: key }).loginThrottleKey,
    ).toBe(key);
  });

  it("#120 AC-3: 未設定・空は null（アプリ全体は止めない）", () => {
    expect(loadConfig(base).loginThrottleKey).toBeNull();
    expect(
      loadConfig({ ...base, LOGIN_THROTTLE_KEY: "" }).loginThrottleKey,
    ).toBeNull();
  });

  it("#120 AC-3: 42文字・44文字・使えない文字を含む値は null で、logger.error に記録し値は出さない", () => {
    const key = randomBase64Url(32);
    for (const bad of [key.slice(0, 42), `${key}A`, `+${key.slice(1)}`]) {
      errorSpy.mockClear();
      expect(
        loadConfig({ ...base, LOGIN_THROTTLE_KEY: bad }).loginThrottleKey,
      ).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
      const output = errorSpy.mock.calls
        .map((c: unknown[]) => c.join(" "))
        .join("\n");
      expect(output).toContain("LOGIN_THROTTLE_KEY");
      expect(output).not.toContain(bad);
    }
  });
});
