import { afterEach, describe, expect, it, vi } from "vitest";
import { assertRecentReauth } from "./credentials.service";

const NOW = new Date("2026-11-06T00:05:00.000Z");
afterEach(() => vi.useRealTimers());

describe("#123 0-5 AC-1/2 再認証済み判定", () => {
  it.each([0, 1, 299_999])(
    "#123 0-5 AC-2: %ims前の再認証を許可する",
    (elapsed) => {
      expect(() =>
        assertRecentReauth(
          new Date(NOW.getTime() - elapsed).toISOString(),
          NOW,
        ),
      ).not.toThrow();
    },
  );
  it.each([
    null,
    "invalid",
    "",
    new Date(NOW.getTime() + 1).toISOString(),
    new Date(NOW.getTime() - 300_000).toISOString(),
    new Date(NOW.getTime() - 300_001).toISOString(),
  ])(
    "#123 0-5 AC-1/2: 未確認・不正・未来・5分以上は403 REAUTH_REQUIRED（%s）",
    (at) => {
      expect(() => assertRecentReauth(at, NOW)).toThrow(
        expect.objectContaining({ status: 403, code: "REAUTH_REQUIRED" }),
      );
    },
  );
  it("#123 0-5 AC-2: 明示時刻がなければサーバー時刻で判定する", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    expect(() => assertRecentReauth("2026-11-06T00:00:00.000Z")).toThrow(
      expect.objectContaining({ code: "REAUTH_REQUIRED" }),
    );
  });
  it("#123 0-5 AC-1/3: 再認証が切れた後続操作は、業務確定と業務監査をどちらも呼ばない", () => {
    const commitBusinessAndAudit = vi.fn();
    const operation = () => {
      assertRecentReauth(null, NOW);
      commitBusinessAndAudit();
    };
    expect(operation).toThrow();
    expect(commitBusinessAndAudit).not.toHaveBeenCalled();
    assertRecentReauth(NOW.toISOString(), NOW);
    commitBusinessAndAudit();
    expect(commitBusinessAndAudit).toHaveBeenCalledTimes(1);
  });
});
