import { clientNameKey } from "../../../shared/client-rules";
import {
  DuplicateClientError,
  withClients,
  type ClientListOptions,
  type ClientRepository,
} from "../db/client.repository";
import {
  withClientRateLimit,
  type ClientRateBucket,
  type ClientRateConsumption,
} from "../db/client-rate-limit.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { createLogger } from "../lib/logger/logger";
import { newUlid } from "../lib/ulid";
import { createAppAuthorizer } from "./authorizer";

export type ClientActor = { userId: string; traceId: string };
export type { ClientRateBucket } from "../db/client-rate-limit.repository";

export function consumeClientApiRateLimit(
  env: Env,
  input: {
    userId: string;
    bucket: ClientRateBucket;
    nowMs: number;
    limit: number;
  },
): Promise<ClientRateConsumption> {
  return withClientRateLimit(env, (repository) => repository.consume(input));
}

export function withClientService<T>(
  env: Env,
  run: (service: ReturnType<typeof createClientService>) => Promise<T>,
): Promise<T> {
  return withClients(env, (repository, roles) =>
    run(createClientService(repository, roles)),
  );
}

export function createClientService(
  repository: ClientRepository,
  roles: RoleAssignmentRepository,
) {
  async function authorize(actor: ClientActor): Promise<void> {
    const logger = createLogger({
      traceId: actor.traceId,
      userId: actor.userId,
    });
    await createAppAuthorizer(roles, { logger }).authorize(
      { userId: actor.userId },
      "perm.client.manage",
      { type: "company" },
    );
  }

  function conflict(message: string): AppError {
    return new AppError("CONFLICT", message);
  }

  return {
    async listAdmin(actor: ClientActor, options: ClientListOptions) {
      await authorize(actor);
      return repository.listAdmin(options);
    },
    listPublic(options: ClientListOptions) {
      return repository.listPublic(options);
    },
    listCandidates(options: ClientListOptions) {
      return repository.listCandidates(options);
    },
    async create(actor: ClientActor, input: { code: string; name: string }) {
      await authorize(actor);
      const name = input.name.trim();
      try {
        return await repository.create(
          {
            id: newUlid(),
            code: input.code,
            name,
            nameNormalized: clientNameKey(name),
          },
          { actorId: actor.userId, traceId: actor.traceId },
        );
      } catch (error) {
        if (error instanceof DuplicateClientError) {
          throw new AppError(
            "CONFLICT",
            "同じ名前またはコードの取引先があります。内容を確かめてください",
            {},
            { cause: error },
          );
        }
        throw error;
      }
    },
    async rename(
      actor: ClientActor,
      id: string,
      input: { name: string; version: number },
    ) {
      await authorize(actor);
      const current = await repository.findById(id);
      if (current === null) {
        throw new AppError("NOT_FOUND", "取引先が見つかりません");
      }
      if (!current.active) {
        throw conflict("無効な取引先の名前は変更できません");
      }
      if (current.version !== input.version) {
        throw conflict("他の人が先に更新しました。読み込み直してください");
      }
      try {
        const updated = await repository.rename(
          id,
          input.version,
          input.name.trim(),
          clientNameKey(input.name),
          { actorId: actor.userId, traceId: actor.traceId },
        );
        if (updated === null) {
          throw conflict("他の人が先に更新しました。読み込み直してください");
        }
        return updated;
      } catch (error) {
        if (error instanceof DuplicateClientError) {
          throw new AppError(
            "CONFLICT",
            "同じ名前の取引先があります。別の名前を入力してください",
            {},
            { cause: error },
          );
        }
        throw error;
      }
    },
    async deactivate(
      actor: ClientActor,
      id: string,
      input: { active: false; version: number },
    ) {
      await authorize(actor);
      const current = await repository.findById(id);
      if (current === null) {
        throw new AppError("NOT_FOUND", "取引先が見つかりません");
      }
      if (current.code === "INT") {
        throw conflict("社内の取引先は無効にできません");
      }
      if (!current.active) {
        throw conflict("無効な取引先は再変更できません");
      }
      if (current.version !== input.version) {
        throw conflict("他の人が先に更新しました。読み込み直してください");
      }
      const updated = await repository.deactivate(id, input.version, {
        actorId: actor.userId,
        traceId: actor.traceId,
      });
      if (updated === null) {
        throw conflict("他の人が先に更新しました。読み込み直してください");
      }
      return updated;
    },
  };
}
