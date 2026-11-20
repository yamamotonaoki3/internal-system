// Service：メッセージの検索（#155・EP-4-01）の業務ルール。HTTP も DB のライブラリも知らない。
// 入口の権限は perm.search.message（R-58。拒否は authorize が監査に記録する）。
// DM は perm.dm.message.view、案件専用チャンネルは perm.case.view がある利用者にだけ含める（スレッドの一覧と同じ作り。検索自体は成功させる）。
// 見える範囲（部屋の資格・削除済みの除外）の絞り込みは、Repository の SQL が LIMIT より前に行う。検索語はログに出さない。
import { jstDayStart, jstNextDayStart } from "../db/audit-log.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { withSearch, type SearchRepository } from "../db/search.repository";
import type { CursorPayload } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";

export type SearchActor = { userId: string; traceId: string };

export type SearchMessagesInput = {
  /** 前後の空白を除いた検索語（Route が検証済み） */
  q: string;
  limit: number;
  cursor?: CursorPayload;
  roomId?: string;
  /** JST の日付（YYYY-MM-DD）。その日の 00:00 JST 以降 */
  from?: string;
  /** JST の日付（YYYY-MM-DD）。その日の終わりまで */
  to?: string;
};

type Dependencies = {
  authorizer: Pick<ReturnType<typeof createAppAuthorizer>, "authorize" | "can">;
};

export function withSearchService<T>(
  env: Env,
  actor: SearchActor,
  run: (service: ReturnType<typeof createSearchService>) => Promise<T>,
): Promise<T> {
  return withSearch(env, (repository) =>
    withRoleAssignments(env, (roles) =>
      run(
        createSearchService(repository, {
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

export function createSearchService(
  repository: Pick<SearchRepository, "searchMessages">,
  { authorizer }: Dependencies,
) {
  return {
    async searchMessages(actor: SearchActor, input: SearchMessagesInput) {
      await authorizer.authorize(
        { userId: actor.userId },
        "perm.search.message",
        { type: "company" },
      );
      // 表示の判定なので can（拒否を監査に残さない）。権限のない部屋は SQL の条件で除き、ページの件数とカーソルをずらさない
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
      return repository.searchMessages(actor.userId, {
        term: input.q,
        limit: input.limit,
        includeDirect,
        includeCase,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
        ...(input.from === undefined
          ? {}
          : { createdFrom: jstDayStart(input.from) }),
        ...(input.to === undefined
          ? {}
          : { createdBefore: jstNextDayStart(input.to) }),
      });
    },
  };
}
