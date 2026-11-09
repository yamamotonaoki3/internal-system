// Service：アカウントの個別発行と管理者用の一覧。HTTP（Hono）も DB のライブラリも知らない。
// 処理の順序：認可（全体管理者だけ）→ 部署の確認（422）→ 初期パスワードと本名の保護 → 保存 → 重複は 409。
// 初期パスワードは、ハッシュにしたものだけを保存する。平文は呼び出し元への戻り値にだけ入れ、ログ・監査・エラーには入れない。
import {
  AccountConflictError,
  withAccounts,
  type AccountConflictReason,
  type AccountListOptions,
  type AccountRepository,
} from "../db/account.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { createLogger } from "../lib/logger/logger";
import { generateInitialPassword, hashPassword } from "../lib/password";
import { encryptLegalName } from "../lib/pii-crypto";
import { newUlid } from "../lib/ulid";
import { createAppAuthorizer } from "./authorizer";

export type AccountActor = { userId: string; traceId: string };

export type AccountCreateRequest = {
  loginId: string;
  legalName: string;
  displayName: string;
  email: string;
  extension?: string | undefined;
  jobTitle?: string | undefined;
  departmentId: string;
};

export type AccountCreated = {
  id: string;
  loginId: string;
  displayName: string;
  departmentId: string;
  mustChangePassword: true;
  createdAt: string;
  /** 一度だけ画面に表示する。保存しない */
  initialPassword: string;
};

// 重複した値は書かない（どの項目かだけを伝える）
const CONFLICT_MESSAGES: Record<AccountConflictReason, string> = {
  login_id: "そのユーザーIDはすでに使われています",
  email: "そのメールアドレスはすでに使われています",
};

export function withAccountService<T>(
  env: Env,
  run: (service: ReturnType<typeof createAccountService>) => Promise<T>,
): Promise<T> {
  return withAccounts(env, (repository, roles) =>
    run(createAccountService(repository, roles)),
  );
}

export function createAccountService(
  repository: AccountRepository,
  roles: RoleAssignmentRepository,
) {
  async function authorize(actor: AccountActor): Promise<void> {
    const logger = createLogger({
      traceId: actor.traceId,
      userId: actor.userId,
    });
    await createAppAuthorizer(roles, { logger }).authorize(
      { userId: actor.userId },
      "perm.account.create",
      { type: "company" },
    );
  }

  return {
    /** 管理者かどうかだけを確かめる（入力の検証より前に、Controller が呼ぶ） */
    authorize,
    async create(
      actor: AccountActor,
      input: AccountCreateRequest,
      secrets: { piiKey: string },
    ): Promise<AccountCreated> {
      await authorize(actor);
      const department = await repository.findActiveDepartment(
        input.departmentId,
      );
      if (department === null) {
        throw new AppError("VALIDATION_ERROR", "入力内容を確かめてください", {
          fields: ["departmentId"],
        });
      }

      const id = newUlid();
      const initialPassword = generateInitialPassword();
      const now = new Date().toISOString();
      const [passwordHash, legalNameEncrypted] = await Promise.all([
        hashPassword(initialPassword),
        encryptLegalName(input.legalName, secrets.piiKey, id),
      ]);

      try {
        await repository.createAccount({
          id,
          loginId: input.loginId,
          displayName: input.displayName,
          legalNameEncrypted,
          email: input.email,
          departmentId: department.id,
          extension: input.extension ?? null,
          jobTitle: input.jobTitle ?? null,
          passwordHash,
          actorId: actor.userId,
          now,
          traceId: actor.traceId,
        });
      } catch (error) {
        if (error instanceof AccountConflictError) {
          throw new AppError(
            "CONFLICT",
            CONFLICT_MESSAGES[error.reason],
            {},
            { cause: error },
          );
        }
        throw error;
      }
      return {
        id,
        loginId: input.loginId,
        displayName: input.displayName,
        departmentId: department.id,
        mustChangePassword: true,
        createdAt: now,
        initialPassword,
      };
    },
    async listAdmin(actor: AccountActor, options: AccountListOptions) {
      await authorize(actor);
      return repository.listAdmin(options);
    },
    async departmentOptions(actor: AccountActor) {
      await authorize(actor);
      return { items: await repository.listActiveDepartments() };
    },
  };
}
