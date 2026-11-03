// #119 AC-1：初回専用の認証（SETUP_TOKEN）と本名の暗号鍵（PII_ENCRYPTION_KEY）の設定の読み込み（改訂版 3.1・最終の修正 3）。
// 未設定・形式不正は null にして、セットアップだけを 503 にする（アプリ全体は止めない）。形式不正は logger.error に記録し、値は出さない。
// 値はテストの中で乱数から作る（実際の値を書かない）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBase64Url } from "../test/random-secrets";
import { loadConfig } from "./config";

const base = { APP_ENV: "test", ALLOWED_ORIGINS: "http://localhost:5173" };

// workerd では console.* の .mock を直接読めないため、spyOn の戻り値から呼び出しを読む
let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const allOutput = () =>
  [...errorSpy.mock.calls, ...warnSpy.mock.calls, ...logSpy.mock.calls]
    .map((c) => c.map(String).join(" "))
    .join("\n");

describe("SETUP_TOKEN の読み込み", () => {
  it("#119 AC-1: 32バイトの base64url（ちょうど43文字）は、そのまま setupToken になる", () => {
    const token = randomBase64Url(32);
    expect(token).toHaveLength(43);
    expect(loadConfig({ ...base, SETUP_TOKEN: token }).setupToken).toBe(token);
  });

  it("#119 AC-1: 未設定・空は null（例外にしない）", () => {
    expect(loadConfig(base).setupToken).toBeNull();
    expect(loadConfig({ ...base, SETUP_TOKEN: "" }).setupToken).toBeNull();
  });

  it("#119 AC-1: 42文字・44文字は null（ちょうど43文字のみ。^[A-Za-z0-9_-]{43}$）", () => {
    const token = randomBase64Url(32);
    expect(
      loadConfig({ ...base, SETUP_TOKEN: token.slice(0, 42) }).setupToken,
    ).toBeNull();
    expect(
      loadConfig({ ...base, SETUP_TOKEN: `${token}A` }).setupToken,
    ).toBeNull();
    expect(
      loadConfig({ ...base, SETUP_TOKEN: randomBase64Url(48) }).setupToken,
    ).toBeNull();
  });

  it("#119 AC-1: base64url で使えない文字（+ / = 空白・日本語）を含むと null", () => {
    const token = randomBase64Url(32);
    for (const bad of ["+", "/", "=", " ", "あ"]) {
      const value = bad + token.slice(1);
      expect(value).toHaveLength(43);
      expect(loadConfig({ ...base, SETUP_TOKEN: value }).setupToken).toBeNull();
    }
  });

  it("#119 AC-1: 形式が不正なとき、logger.error に記録し、値は出力しない", () => {
    const value = `${randomBase64Url(32)}A`;
    loadConfig({ ...base, SETUP_TOKEN: value });
    expect(errorSpy).toHaveBeenCalled();
    expect(allOutput()).not.toContain(value);
  });

  it("#119 AC-1: SETUP_TOKEN が不正でも、ほかの設定は読める（アプリ全体は止めない）", () => {
    const config = loadConfig({ ...base, SETUP_TOKEN: "short" });
    expect(config.appEnv).toBe("test");
    expect(config.allowedOrigins).toEqual(["http://localhost:5173"]);
  });

  it("#118: APP_ENV の欠落は、これまでどおり例外", () => {
    expect(() => loadConfig({ SETUP_TOKEN: randomBase64Url(32) })).toThrow();
  });
});

describe("PII_ENCRYPTION_KEY の読み込み", () => {
  it("#119 AC-1: base64url をデコードしてちょうど32バイトの鍵は、piiEncryptionKey になる", () => {
    const key = randomBase64Url(32);
    expect(
      loadConfig({ ...base, PII_ENCRYPTION_KEY: key }).piiEncryptionKey,
    ).toBe(key);
  });

  it("#119 AC-1: 未設定・空は null", () => {
    expect(loadConfig(base).piiEncryptionKey).toBeNull();
    expect(
      loadConfig({ ...base, PII_ENCRYPTION_KEY: "" }).piiEncryptionKey,
    ).toBeNull();
  });

  it("#119 AC-1: デコード後が32バイトでない鍵（16・31・33・64バイト）は null", () => {
    for (const bytes of [16, 31, 33, 64]) {
      expect(
        loadConfig({ ...base, PII_ENCRYPTION_KEY: randomBase64Url(bytes) })
          .piiEncryptionKey,
      ).toBeNull();
    }
  });

  it("#119 AC-1: base64url で使えない文字を含む鍵は null で、logger.error に記録し、値は出さない", () => {
    const key = `+${randomBase64Url(32).slice(1)}`;
    expect(
      loadConfig({ ...base, PII_ENCRYPTION_KEY: key }).piiEncryptionKey,
    ).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    expect(allOutput()).not.toContain(key);
  });
});
