// Workers の入口。DB につなぐ処理（db/）を、各ルートへ渡して組み込む。処理は app.ts・routes/・services/ に書く。
// fetch（HTTP）と scheduled（Cron Triggers）の両方を公開する。Cronのジョブは、機能のIssueが一覧に足す。
import { createApp } from "./app";
import { withAuth } from "./db/auth.repository";
import { withCredentials } from "./db/credential.repository";
import { withSampleUsers } from "./db/sample-user.repository";
import { withSessions } from "./db/session.repository";
import { withSetup } from "./db/setup.repository";
import { adminAccountRoutes } from "./routes/accounts";
import {
  attachmentRoutes,
  replyAttachmentRoutes,
  roomAttachmentRoutes,
} from "./routes/attachments";
import { authRoutes } from "./routes/auth";
import { channelRequestRoutes } from "./routes/channel-requests";
import { channelRoutes } from "./routes/channels";
import { adminClientRoutes, clientRoutes } from "./routes/clients";
import { adminDepartmentRoutes, departmentRoutes } from "./routes/departments";
import { dmRoutes } from "./routes/dms";
import { meRoutes } from "./routes/me";
import { messageItemRoutes, messageRoutes } from "./routes/messages";
import { notificationRoutes } from "./routes/notifications";
import { readPositionRoutes } from "./routes/read-positions";
import {
  adminRetirementRequestRoutes,
  retirementRequestRoutes,
} from "./routes/retirement-requests";
import { sampleUserRoutes } from "./routes/sample-users";
import { setupRoutes } from "./routes/setup";
import { threadReadPositionRoutes } from "./routes/thread-read-positions";
import { threadRoutes } from "./routes/threads";
import { unreadRoutes } from "./routes/unread";
import { userRoutes } from "./routes/users";
import { attachmentCleanupJob } from "./services/attachment.service";
import { authCleanupJob } from "./services/auth.service";
import { createScheduledHandler } from "./scheduled";

export const app = createApp({
  sessions: withSessions,
  routes: [
    { path: "/api/sample-users", app: sampleUserRoutes(withSampleUsers) },
    { path: "/api/setup", app: setupRoutes(withSetup, withAuth) },
    { path: "/api/auth", app: authRoutes(withAuth, withCredentials) },
    { path: "/api/me/notifications", app: notificationRoutes() },
    { path: "/api/me/unread", app: unreadRoutes() },
    { path: "/api/me/threads", app: threadRoutes() },
    { path: "/api/me", app: meRoutes(withCredentials) },
    { path: "/api/users", app: userRoutes() },
    { path: "/api/admin/clients", app: adminClientRoutes() },
    { path: "/api/clients", app: clientRoutes() },
    { path: "/api/admin/departments", app: adminDepartmentRoutes() },
    { path: "/api/departments", app: departmentRoutes() },
    { path: "/api/admin/accounts", app: adminAccountRoutes() },
    { path: "/api/channel-requests", app: channelRequestRoutes() },
    { path: "/api/retirement-requests", app: retirementRequestRoutes() },
    {
      path: "/api/admin/retirement-requests",
      app: adminRetirementRequestRoutes(),
    },
    { path: "/api/channels", app: channelRoutes() },
    { path: "/api/dms", app: dmRoutes() },
    { path: "/api/rooms", app: messageRoutes() },
    { path: "/api/rooms", app: roomAttachmentRoutes() },
    { path: "/api/messages", app: messageItemRoutes() },
    { path: "/api/messages", app: replyAttachmentRoutes() },
    { path: "/api/attachments", app: attachmentRoutes() },
    { path: "/api/messages", app: threadReadPositionRoutes() },
    { path: "/api/rooms", app: readPositionRoutes() },
  ],
});

export default {
  fetch: app.fetch,
  scheduled: createScheduledHandler([
    authCleanupJob(withAuth),
    attachmentCleanupJob(),
  ]),
} satisfies ExportedHandler<Env>;
