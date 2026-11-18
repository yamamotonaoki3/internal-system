// Service：自分のスレッドの一覧（#137。EP-3-08）の業務ルール。HTTP も DB のライブラリも知らない。
// 権限は perm.notification.own（R-55。会社の範囲）。拒否は authorize が監査に記録する。
// DM のスレッドは perm.dm.message.view、案件専用チャンネルのスレッドは perm.case.view（#148）がある利用者にだけ返す。
// 見える範囲（参加中の未アーカイブのチャンネル・当事者の DM）の絞り込みは、Repository の SQL が行う（U-4）。
import { withRoleAssignments } from "../db/role-assignment.repository";
import { withThreads, type ThreadRepository } from "../db/thread.repository";
import type { CursorPayload } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";

export type ThreadActor = { userId: string; traceId: string };

type Dependencies = {
  authorizer: Pick<ReturnType<typeof createAppAuthorizer>, "authorize" | "can">;
};

export function withThreadService<T>(
  env: Env,
  actor: ThreadActor,
  run: (service: ReturnType<typeof createThreadService>) => Promise<T>,
): Promise<T> {
  return withThreads(env, (repository) =>
    withRoleAssignments(env, (roles) =>
      run(
        createThreadService(repository, {
          authorizer: createAppAuthorizer(roles, {
            logger: createLogger({
              traceId: actor.traceId,
              userId: actor.userId,
            }),
          }),
        }),
      ),
    ),
  );
}

export function createThreadService(
  repository: Pick<ThreadRepository, "listThreads">,
  { authorizer }: Dependencies,
) {
  return {
    async list(
      actor: ThreadActor,
      options: { limit: number; cursor?: CursorPayload },
    ) {
      await authorizer.authorize(
        { userId: actor.userId },
        "perm.notification.own",
        { type: "company" },
      );
      // DM の本文を読む権限（perm.dm.message.view）がなければ、DM のスレッドだけ除く。一覧自体は成功させる
      // 表示の判定なので can（真偽。拒否を監査に残さない。2秒ごとの取り直しで拒否が溜まらないように）
      const includeDirect = await authorizer.can(
        { userId: actor.userId },
        "perm.dm.message.view",
        { type: "company" },
      );
      const includeCase = await authorizer.can(
        { userId: actor.userId },
        "perm.case.view",
        { type: "company" },
      );
      return repository.listThreads(actor.userId, {
        ...options,
        includeDirect,
        includeCase,
      });
    },
  };
}
