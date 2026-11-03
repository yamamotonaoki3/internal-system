// #119 AC-1・AC-4：初回セットアップの Service（setup.service.ts）の単体テスト。Repository はスタブにする。
// 503／403 の分岐、監査（logger.audit）の action、409 の理由ごとのメッセージ、返す値を確かめる。
import { SCRYPT_TEST_TIMEOUT_MS } from "../../test/auth-fixtures";
import { describe, expect, it, vi } from "vitest";
import { newPiiKey, randomBase64Url } from "../../test/random-secrets";
import {
  SetupConflictError,
  type InitialAdminInput,
  type SetupConflictReason,
  type SetupRepository,
} from "../db/setup.repository";
import { AppError } from "../lib/app-error";
import type { Logger } from "../lib/logger/logger";
import { decryptLegalName } from "../lib/pii-crypto";
import { verifyPassword } from "../lib/password";
import {
  authenticateSetup,
  completeSetup,
  getSetupStatus,
  type SetupInput,
} from "./setup.service";

const errorOf = (p: Promise<unknown>) => p.catch((e: unknown) => e);

function makeLogger() {
  const audit = vi.fn();
  return { logger: { audit } as unknown as Logger, audit };
}

function stubRepository(
  options: {
    completed?: boolean;
    create?: (input: InitialAdminInput) => Promise<void>;
  } = {},
) {
  const created: InitialAdminInput[] = [];
  const repository: SetupRepository = {
    isSetupCompleted: vi.fn(async () => options.completed ?? false),
    createInitialAdmin: vi.fn(async (input: InitialAdminInput) => {
      created.push(input);
      if (options.create) await options.create(input);
    }),
  };
  return { repository, created };
}

const input: SetupInput = {
  companyName: "[UNIT_TEST]テスト株式会社",
  departmentName: "[UNIT_TEST]経営企画部",
  loginId: "testuser_001",
  legalName: "テスト太郎",
  email: "testuser_001@example.com",
  extension: "0000",
  jobTitle: "代表取締役社長",
};

describe("getSetupStatus", { timeout: SCRYPT_TEST_TIMEOUT_MS }, () => {
  it("#119 AC-4: 完了していなければ setupRequired: true", async () => {
    const { repository } = stubRepository({ completed: false });
    expect(await getSetupStatus(repository)).toEqual({ setupRequired: true });
  });

  it("#119 AC-4: 完了していれば setupRequired: false", async () => {
    const { repository } = stubRepository({ completed: true });
    expect(await getSetupStatus(repository)).toEqual({ setupRequired: false });
  });
});

describe(
  "authenticateSetup（503・403 の分岐）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#119 AC-1: トークンと鍵が使えて、トークンが一致すれば、暗号鍵を返し、監査に記録しない", async () => {
      const token = randomBase64Url(32);
      const key = newPiiKey();
      const { logger, audit } = makeLogger();
      expect(
        await authenticateSetup(
          { setupToken: token, piiEncryptionKey: key },
          token,
          logger,
        ),
      ).toEqual({ piiEncryptionKey: key });
      expect(audit).not.toHaveBeenCalled();
    });

    it.each<[string, string | null, string | null]>([
      ["トークンが未設定", null, "key"],
      ["鍵が未設定", "token", null],
      ["両方が未設定", null, null],
    ])(
      "#119 AC-1: %s は 503（SERVICE_UNAVAILABLE）で、決まったメッセージ。監査に記録しない",
      async (_label, setupToken, piiEncryptionKey) => {
        const { logger, audit } = makeLogger();
        const err = await errorOf(
          authenticateSetup(
            {
              setupToken: setupToken === null ? null : randomBase64Url(32),
              piiEncryptionKey: piiEncryptionKey === null ? null : newPiiKey(),
            },
            randomBase64Url(32),
            logger,
          ),
        );
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("SERVICE_UNAVAILABLE");
        expect((err as AppError).status).toBe(503);
        expect((err as AppError).userMessage).toBe(
          "初回セットアップは現在使えません。運用担当者に連絡してください",
        );
        expect(audit).not.toHaveBeenCalled();
      },
    );

    it.each<[string, unknown]>([
      ["別のトークン", randomBase64Url(32)],
      ["空文字", ""],
      ["undefined", undefined],
      ["null", null],
      ["数値", 12345],
    ])(
      "#119 AC-1: トークンが誤り（%s）は 403（FORBIDDEN）で、決まったメッセージ。logger.audit に action・対象・failure・理由を記録する",
      async (_label, given) => {
        const token = randomBase64Url(32);
        const { logger, audit } = makeLogger();
        const err = await errorOf(
          authenticateSetup(
            { setupToken: token, piiEncryptionKey: newPiiKey() },
            given,
            logger,
          ),
        );
        expect((err as AppError).code).toBe("FORBIDDEN");
        expect((err as AppError).status).toBe(403);
        expect((err as AppError).userMessage).toBe(
          "セットアップ用のトークンが正しくありません",
        );
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0]).toEqual([
          "setup.initial_admin.create",
          "setup",
          "failure",
          { reason: "invalid_token" },
        ]);
        expect(JSON.stringify(audit.mock.calls)).not.toContain(token);
      },
    );

    it("#119 AC-1: 設定の不備（503）は、トークンの照合（403）より先に判定する", async () => {
      const { logger, audit } = makeLogger();
      const err = await errorOf(
        authenticateSetup(
          { setupToken: randomBase64Url(32), piiEncryptionKey: null },
          "wrong",
          logger,
        ),
      );
      expect((err as AppError).code).toBe("SERVICE_UNAVAILABLE");
      expect(audit).not.toHaveBeenCalled();
    });
  },
);

describe("completeSetup", { timeout: SCRYPT_TEST_TIMEOUT_MS }, () => {
  const context = () => ({
    piiEncryptionKey: newPiiKey(),
    traceId: "trace-unit-setup",
  });

  it("#119 AC-1: 完了済みなら 409 で、メッセージは「完了しています」。作成を呼ばない", async () => {
    const { repository } = stubRepository({ completed: true });
    const err = await errorOf(completeSetup(repository, input, context()));
    expect((err as AppError).code).toBe("CONFLICT");
    expect((err as AppError).status).toBe(409);
    expect((err as AppError).userMessage).toBe(
      "初回セットアップはすでに完了しています",
    );
    expect(repository.createInitialAdmin).not.toHaveBeenCalled();
  });

  it.each<[SetupConflictReason, string]>([
    ["already_completed", "初回セットアップはすでに完了しています"],
    ["login_id", "その社員IDはすでに使われています"],
    ["email", "そのメールアドレスはすでに使われています"],
    ["department_name", "その部署名はすでに使われています"],
  ])(
    "#119 AC-1: Repository が競合（%s）を知らせたら 409（CONFLICT）で、メッセージは「%s」。原因を cause に残す",
    async (reason, message) => {
      const conflict = new SetupConflictError(reason);
      const { repository } = stubRepository({
        create: async () => {
          throw conflict;
        },
      });
      const err = await errorOf(completeSetup(repository, input, context()));
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("CONFLICT");
      expect((err as AppError).userMessage).toBe(message);
      expect((err as AppError).details).toEqual({});
      expect((err as AppError).cause).toBe(conflict);
    },
  );

  it("#119 AC-1: 競合以外のエラーは、409 に変えずにそのまま伝える", async () => {
    const failure = new Error("unit test failure");
    const { repository } = stubRepository({
      create: async () => {
        throw failure;
      },
    });
    expect(await errorOf(completeSetup(repository, input, context()))).toBe(
      failure,
    );
  });

  it("#119 AC-1: 作成に渡す値：本名は暗号化（AAD は利用者のID）、パスワードはハッシュ、表示名は本名、日時・trace を渡す", async () => {
    const { repository, created } = stubRepository();
    const ctx = context();
    const result = await completeSetup(repository, input, ctx);
    expect(created).toHaveLength(1);
    const c = created[0]!;
    expect(c.userId).toBe(result.user.id);
    expect(c.departmentId).not.toBe(c.userId);
    expect(c.companyName).toBe(input.companyName);
    expect(c.departmentName).toBe(input.departmentName);
    expect(c.loginId).toBe("testuser_001");
    expect(c.displayName).toBe("テスト太郎");
    expect(c.email).toBe("testuser_001@example.com");
    expect(c.extension).toBe("0000");
    expect(c.jobTitle).toBe("代表取締役社長");
    expect(c.traceId).toBe("trace-unit-setup");
    expect(c.now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(c.legalNameEncrypted).not.toContain("テスト太郎");
    expect(
      await decryptLegalName(
        c.legalNameEncrypted,
        ctx.piiEncryptionKey,
        c.userId,
      ),
    ).toBe("テスト太郎");
    expect(await verifyPassword(result.initialPassword, c.passwordHash)).toBe(
      true,
    );
    expect(result).toEqual({
      user: {
        id: c.userId,
        loginId: "testuser_001",
        displayName: "テスト太郎",
      },
      initialPassword: result.initialPassword,
    });
    expect(result.initialPassword).toHaveLength(16);
  });

  it("#119 AC-1: 内線・役職を省くと null を渡す", async () => {
    const { repository, created } = stubRepository();
    const rest: SetupInput = {
      companyName: input.companyName,
      departmentName: input.departmentName,
      loginId: input.loginId,
      legalName: input.legalName,
      email: input.email,
    };
    await completeSetup(repository, rest, context());
    expect(created[0]?.extension).toBeNull();
    expect(created[0]?.jobTitle).toBeNull();
  });
});
