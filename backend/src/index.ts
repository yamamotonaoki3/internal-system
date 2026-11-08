// Workers の入口。DB につなぐ処理（db/）を、各ルートへ渡して組み込む。処理は app.ts・routes/・services/ に書く。
// fetch（HTTP）と scheduled（Cron Triggers）の両方を公開する。Cronのジョブは、機能のIssueが一覧に足す。
import { createApp } from "./app";
import { withAuth } from "./db/auth.repository";
import { withCredentials } from "./db/credential.repository";
import { withSampleUsers } from "./db/sample-user.repository";
import { withSessions } from "./db/session.repository";
import { withSetup } from "./db/setup.repository";
import { authRoutes } from "./routes/auth";
import { adminClientRoutes, clientRoutes } from "./routes/clients";
import { meRoutes } from "./routes/me";
import { sampleUserRoutes } from "./routes/sample-users";
import { setupRoutes } from "./routes/setup";
import { authCleanupJob } from "./services/auth.service";
import { createScheduledHandler } from "./scheduled";

export const app = createApp({
  sessions: withSessions,
  routes: [
    { path: "/api/sample-users", app: sampleUserRoutes(withSampleUsers) },
    { path: "/api/setup", app: setupRoutes(withSetup, withAuth) },
    { path: "/api/auth", app: authRoutes(withAuth, withCredentials) },
    { path: "/api/me", app: meRoutes(withCredentials) },
    { path: "/api/admin/clients", app: adminClientRoutes() },
    { path: "/api/clients", app: clientRoutes() },
  ],
});

export default {
  fetch: app.fetch,
  scheduled: createScheduledHandler([authCleanupJob(withAuth)]),
} satisfies ExportedHandler<Env>;
