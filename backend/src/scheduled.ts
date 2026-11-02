// Cron Triggersを受ける枠（AC-6）。ジョブの中身は、機能のIssueが index.ts の一覧に足す。
// 本番へのtriggersの設定（wrangler.jsonc）の適用は、利用者が行う。
import { createLogger } from "./lib/logger/logger";

export type CronJob = {
  /** wrangler.jsonc の triggers.crons と同じ式 */
  cron: string;
  name: string;
  run: (env: Env) => Promise<void>;
};

export function createScheduledHandler(
  jobs: readonly CronJob[],
): ExportedHandlerScheduledHandler<Env> {
  return async (controller, env) => {
    const logger = createLogger();
    const targets = jobs.filter((job) => job.cron === controller.cron);
    logger.info("Cronを受け取った", {
      cron: controller.cron,
      jobCount: targets.length,
    });
    if (jobs.length > 0 && targets.length === 0)
      logger.warn("該当するCronジョブがない", { cron: controller.cron });

    for (const job of targets) {
      logger.info("Cronジョブを開始", { job: job.name });
      try {
        await job.run(env);
      } catch (error) {
        logger.error("Cronジョブが失敗", { job: job.name, error });
        throw error;
      }
      logger.info("Cronジョブが完了", { job: job.name });
    }
  };
}
