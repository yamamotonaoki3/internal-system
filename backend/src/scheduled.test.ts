// #118 AC-6：Cron Triggersを受ける枠。中身が空でも、起動とログ出力が確認できる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduledHandler, type CronJob } from "./scheduled";

const controller = (cron: string) =>
  ({
    cron,
    scheduledTime: 1_700_000_000_000,
    type: "scheduled",
  }) as unknown as ScheduledController;
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;
const env = {} as Env;

type Spy = { mock: { calls: unknown[][] } };
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const records = (spy: Spy) =>
  spy.mock.calls.map(
    (c) => JSON.parse(String(c[0])) as Record<string, unknown>,
  );

describe("Cron Triggersを受ける枠", () => {
  it("#118 AC-6: cronが一致するジョブだけを実行し、開始と終了をINFOで記録する", async () => {
    const hit = vi.fn(async () => {});
    const miss = vi.fn(async () => {});
    const jobs: CronJob[] = [
      { cron: "0 * * * *", name: "test.hit", run: hit },
      { cron: "5 * * * *", name: "test.miss", run: miss },
    ];
    await createScheduledHandler(jobs)(controller("0 * * * *"), env, ctx);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(miss).not.toHaveBeenCalled();
    const infos = records(logSpy).filter((r) => r.severity_text === "INFO");
    expect(infos.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(infos)).toContain("test.hit");
  });

  it("#118 AC-6: ジョブが0件でも、例外を投げずINFOを出力する（起動を確認できる）", async () => {
    await expect(
      createScheduledHandler([])(controller("0 * * * *"), env, ctx),
    ).resolves.toBeUndefined();
    const infos = records(logSpy).filter((r) => r.severity_text === "INFO");
    expect(infos.length).toBeGreaterThanOrEqual(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("#118 AC-6: 該当するジョブがないcronは、WARNを出して成功で終わる", async () => {
    const run = vi.fn(async () => {});
    await createScheduledHandler([{ cron: "0 * * * *", name: "test.a", run }])(
      controller("30 3 * * *"),
      env,
      ctx,
    );
    expect(run).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(records(warnSpy)[0]?.severity_text).toBe("WARN");
  });

  it("#118 AC-6: ジョブが失敗したら、ERRORを記録して例外を投げ直す", async () => {
    const jobs: CronJob[] = [
      {
        cron: "0 * * * *",
        name: "test.fail",
        run: async () => {
          throw new Error("job failed [UNIT_TEST]");
        },
      },
    ];
    await expect(
      createScheduledHandler(jobs)(controller("0 * * * *"), env, ctx),
    ).rejects.toThrow("job failed [UNIT_TEST]");
    expect(errorSpy).toHaveBeenCalled();
    expect(records(errorSpy)[0]?.severity_text).toBe("ERROR");
  });
});
