// #118 AC-6：Workersの入口（default export）が fetch と scheduled の両方を持つ。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { app } from "./index";

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

let logSpy: { mock: { calls: unknown[][] } };
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("Workersの入口", () => {
  it("#118 AC-6: 名前付きの app も公開している", () => {
    expect(typeof app.request).toBe("function");
  });

  it("#118 AC-6: default の fetch が /api/health に 200 で応答する", async () => {
    const res = await worker.fetch!(
      new Request("http://example.com/api/health"),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it("#118 AC-6: default の scheduled は、ジョブ0件でも成功し、INFOを出力する", async () => {
    await expect(
      worker.scheduled!(
        {
          cron: "0 * * * *",
          scheduledTime: 1_700_000_000_000,
          type: "scheduled",
        } as unknown as ScheduledController,
        env,
        ctx,
      ),
    ).resolves.toBeUndefined();
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('"INFO"'))).toBe(
      true,
    );
  });
});
