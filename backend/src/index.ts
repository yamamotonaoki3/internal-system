// Workers の入口。DB につなぐ処理（db/）を、サンプルの利用者のルートへ渡して組み込む。処理は app.ts・routes/・services/ に書く。
// fetch（HTTP）と scheduled（Cron Triggers）の両方を公開する。Cronのジョブは、機能のIssueが一覧に足す。
import { createApp } from "./app";
import { withSampleUsers } from "./db/sample-user.repository";
import { withSetup } from "./db/setup.repository";
import { sampleUserRoutes } from "./routes/sample-users";
import { setupRoutes } from "./routes/setup";
import { createScheduledHandler } from "./scheduled";

export const app = createApp({
  routes: [
    { path: "/api/sample-users", app: sampleUserRoutes(withSampleUsers) },
    { path: "/api/setup", app: setupRoutes(withSetup) },
  ],
});

export default {
  fetch: app.fetch,
  scheduled: createScheduledHandler([]),
} satisfies ExportedHandler<Env>;
