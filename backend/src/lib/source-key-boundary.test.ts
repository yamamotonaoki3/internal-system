// #120 AC-3：接続元の正規化の境界（変異テストで生き残った変異を殺す）。
// 期待値は計画から決める：IPv4 はそのまま、IPv6 は先頭の4組（/64）を4桁の16進で「xxxx:xxxx:xxxx:xxxx::/64」、
// IPv4 を埋め込んだ IPv6（::ffff:a.b.c.d）は IPv4。IP は文書用のアドレスだけを使う。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hmacHex, newThrottleKey } from "../../test/auth-fixtures";
import { createLogger } from "./logger/logger";
import { normalizeSourceIp, sourceBucketKey } from "./source-key";

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("IPv4 の境界", () => {
  it("#120 AC-3: 0 と 255 は受け付け、256 は不正", () => {
    expect(normalizeSourceIp("0.0.0.0")).toBe("0.0.0.0");
    expect(normalizeSourceIp("255.255.255.255")).toBe("255.255.255.255");
    expect(normalizeSourceIp("192.0.2.255")).toBe("192.0.2.255");
    expect(normalizeSourceIp("192.0.2.256")).toBeNull();
    expect(normalizeSourceIp("256.0.2.1")).toBeNull();
  });

  it("#120 AC-3: 先頭が 0 の組（01・002）は不正。0 の1文字は受け付ける", () => {
    expect(normalizeSourceIp("192.0.2.01")).toBeNull();
    expect(normalizeSourceIp("192.0.002.1")).toBeNull();
    expect(normalizeSourceIp("192.0.2.0")).toBe("192.0.2.0");
  });

  it("#120 AC-3: 前後に余計な文字があれば不正", () => {
    expect(normalizeSourceIp("x192.0.2.1")).toBeNull();
    expect(normalizeSourceIp("192.0.2.1x")).toBeNull();
    expect(normalizeSourceIp("1192.0.2.1")).toBeNull();
  });
});

describe("IPv6 の形", () => {
  it("#120 AC-3: /64 の表し方は、先頭4組を4桁の16進で ::/64 を付ける", () => {
    expect(normalizeSourceIp("2001:db8::1")).toBe("2001:0db8:0000:0000::/64");
    expect(normalizeSourceIp("2001:db8:a:b:c:d:e:f")).toBe(
      "2001:0db8:000a:000b::/64",
    );
  });

  it("#120 AC-3: 省略なしの8組は受け付け、7組・9組は不正", () => {
    expect(normalizeSourceIp("2001:db8:1:2:3:4:5:6")).toBe(
      "2001:0db8:0001:0002::/64",
    );
    expect(normalizeSourceIp("2001:db8:1:2:3:4:5")).toBeNull();
    expect(normalizeSourceIp("2001:db8:1:2:3:4:5:6:7")).toBeNull();
  });

  it("#120 AC-3: :: を使うときは7組まで（8組と :: は不正）。:: だけ・末尾の :: も受け付ける", () => {
    expect(normalizeSourceIp("2001:db8:1:2:3:4:5::")).toBe(
      "2001:0db8:0001:0002::/64",
    );
    expect(normalizeSourceIp("2001:db8:1:2:3:4:5:6::")).toBeNull();
    expect(normalizeSourceIp("::")).toBe("0000:0000:0000:0000::/64");
    expect(normalizeSourceIp("::1")).toBe("0000:0000:0000:0000::/64");
    expect(normalizeSourceIp("2001:db8::")).toBe("2001:0db8:0000:0000::/64");
  });

  it("#120 AC-3: :: が2つ・5桁の組・16進でない文字は不正", () => {
    expect(normalizeSourceIp("2001::db8::1")).toBeNull();
    expect(normalizeSourceIp("2001:db8:12345::1")).toBeNull();
    expect(normalizeSourceIp("2001:db8::x")).toBeNull();
    expect(normalizeSourceIp("2001:db8::1 ")).toBeNull();
  });

  it("#120 AC-3: ::ffff: の後の IPv4 は、点の形でも16進の形でも IPv4 として扱う", () => {
    expect(normalizeSourceIp("::ffff:192.0.2.10")).toBe("192.0.2.10");
    expect(normalizeSourceIp("::ffff:c000:20a")).toBe("192.0.2.10");
    expect(normalizeSourceIp("::FFFF:192.0.2.255")).toBe("192.0.2.255");
  });

  it("#120 AC-3: ::ffff: 以外の前置き（::fffe:・1::ffff:・0:0:0:0:1:ffff:）は IPv4 扱いにしない", () => {
    expect(normalizeSourceIp("::fffe:192.0.2.10")).toBe(
      "0000:0000:0000:0000::/64",
    );
    expect(normalizeSourceIp("1::ffff:192.0.2.10")).toBe(
      "0001:0000:0000:0000::/64",
    );
    expect(normalizeSourceIp("0:0:0:0:1:ffff:c000:20a")).toBe(
      "0000:0000:0000:0000::/64",
    );
  });

  it("#120 AC-3: 埋め込んだ IPv4 が不正なら、全体が不正", () => {
    expect(normalizeSourceIp("::ffff:192.0.2.256")).toBeNull();
    expect(normalizeSourceIp("::ffff:192.0.2")).toBeNull();
  });
});

describe("sourceBucketKey のログ", () => {
  it("#120 AC-3（D-5）: 本番で失敗したときの理由は、ヘッダーなし=header_missing、不正=header_invalid", async () => {
    const key = newThrottleKey();
    const logger = createLogger();
    for (const [header, reason] of [
      [undefined, "header_missing"],
      ["not-an-ip", "header_invalid"],
      ["", "header_invalid"],
    ] as const) {
      errorSpy.mockClear();
      await sourceBucketKey(header, {
        appEnv: "production",
        throttleKey: key,
        logger,
      }).catch(() => {});
      const rec = JSON.parse(String(errorSpy.mock.calls[0]?.[0])) as {
        attributes: Record<string, unknown>;
      };
      expect(rec.attributes.reason, String(header)).toBe(reason);
    }
  });

  it("#120 AC-3: 正しいヘッダーなら、本番でもログを出さず、正規化した値の HMAC を返す", async () => {
    const key = newThrottleKey();
    expect(
      await sourceBucketKey("2001:db8::1", {
        appEnv: "production",
        throttleKey: key,
        logger: createLogger(),
      }),
    ).toBe(await hmacHex(key, "2001:0db8:0000:0000::/64"));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("#120 AC-3（D-5）: development・test 以外の環境名（staging 等）は、本番と同じく拒否する", async () => {
    await expect(
      sourceBucketKey(undefined, {
        appEnv: "staging",
        throttleKey: newThrottleKey(),
        logger: createLogger(),
      }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
