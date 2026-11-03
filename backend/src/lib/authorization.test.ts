// #118 AC-4：権限判定の枠。ロール×操作の判定を呼び出す共通部品があり、未定義の操作は拒否する。
// テスト専用の権限一覧とスタブResolverを使う（本番の権限一覧はロールのIssueで定義する）。
import { describe, expect, it, vi } from "vitest";
import { AppError } from "./app-error";
import type { Logger } from "./logger/logger";
import {
  createAuthorizer,
  type PermissionResolver,
  type Principal,
  type Scope,
} from "./authorization";

const KNOWN = ["test.example.read", "test.example.write"] as const;
type TestPermission = (typeof KNOWN)[number] | "test.example.unknown";

const user: Principal = { userId: "testuser_001" };
const deptA: Scope = { type: "department", departmentId: "dept_a" };
const deptB: Scope = { type: "department", departmentId: "dept_b" };
const company: Scope = { type: "company" };

// 部署Aでは全部、会社範囲では read のみ、という割り当てのスタブ
const resolve: PermissionResolver<TestPermission> = async (userId, scope) => {
  if (userId !== "testuser_001") return new Set<TestPermission>();
  if (scope.type === "department" && scope.departmentId === "dept_a")
    return new Set<TestPermission>([
      "test.example.read",
      "test.example.write",
      "test.example.unknown",
    ]);
  if (scope.type === "company")
    return new Set<TestPermission>(["test.example.read"]);
  return new Set<TestPermission>();
};

// logger は必須（認可の拒否は必ず audit で記録する）。記録の中身を見ないテストでは、何もしない audit を渡す
const quietLogger = { audit: vi.fn() } as unknown as Logger;
const authorizer = createAuthorizer<TestPermission>(KNOWN, resolve, {
  logger: quietLogger,
});

const errorOf = (p: Promise<unknown>) => p.catch((e: unknown) => e);

describe("権限判定の枠", () => {
  it("#118 AC-4: 許可された権限は通る", async () => {
    expect(await authorizer.can(user, "test.example.write", deptA)).toBe(true);
    await expect(
      authorizer.authorize(user, "test.example.write", deptA),
    ).resolves.toBeUndefined();
  });

  it("#118 AC-4: 未認証（principal が null）は 401（UNAUTHENTICATED）", async () => {
    expect(await authorizer.can(null, "test.example.read", deptA)).toBe(false);
    const err = await errorOf(
      authorizer.authorize(null, "test.example.read", deptA),
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("UNAUTHENTICATED");
    expect((err as AppError).status).toBe(401);
  });

  it("#118 AC-4: 権限がなければ 403（FORBIDDEN）", async () => {
    const other: Principal = { userId: "testuser_002" };
    expect(await authorizer.can(other, "test.example.read", deptA)).toBe(false);
    const err = await errorOf(
      authorizer.authorize(other, "test.example.read", deptA),
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("FORBIDDEN");
    expect((err as AppError).status).toBe(403);
  });

  it("#118 AC-4: 未定義の操作（known にないID）は、Resolverが許可しても拒否する", async () => {
    expect(await authorizer.can(user, "test.example.unknown", deptA)).toBe(
      false,
    );
    const err = await errorOf(
      authorizer.authorize(user, "test.example.unknown", deptA),
    );
    expect((err as AppError).code).toBe("FORBIDDEN");
  });

  it("#118 AC-4: 部署Aの権限を部署Bで使うと 403", async () => {
    expect(await authorizer.can(user, "test.example.write", deptB)).toBe(false);
    const err = await errorOf(
      authorizer.authorize(user, "test.example.write", deptB),
    );
    expect((err as AppError).status).toBe(403);
  });

  it("#118 AC-4: 部署の権限を会社範囲で使うと 403", async () => {
    expect(await authorizer.can(user, "test.example.write", company)).toBe(
      false,
    );
    const err = await errorOf(
      authorizer.authorize(user, "test.example.write", company),
    );
    expect((err as AppError).status).toBe(403);
    expect(await authorizer.can(user, "test.example.read", company)).toBe(true);
  });

  it("#118 AC-4: Resolverが失敗したら、許可扱いにせず例外を伝える", async () => {
    const broken = createAuthorizer<TestPermission>(
      KNOWN,
      async () => {
        throw new Error("resolver failed");
      },
      { logger: quietLogger },
    );
    await expect(broken.can(user, "test.example.read", deptA)).rejects.toThrow(
      "resolver failed",
    );
  });

  // 認可の拒否は audit で記録する（Skill logger）。createAuthorizer の3番目の引数 { logger } で渡す。
  // audit(操作＝権限ID, 対象＝範囲, 結果, attributes) の形（logger.ts に合わせる）
  describe("拒否の監査記録", () => {
    const makeLogger = () => {
      const audit = vi.fn();
      return { logger: { audit } as unknown as Logger, audit };
    };
    const withLogger = (logger: Logger) =>
      createAuthorizer<TestPermission>(KNOWN, resolve, { logger });

    it("#118 AC-4: 403で拒否するとき、audit を1回呼ぶ（操作＝権限ID、対象＝範囲、結果＝failure）", async () => {
      const { logger, audit } = makeLogger();
      await errorOf(
        withLogger(logger).authorize(user, "test.example.write", deptB),
      );
      expect(audit).toHaveBeenCalledTimes(1);
      expect(audit.mock.calls[0]?.slice(0, 3)).toEqual([
        "test.example.write",
        "department:dept_b",
        "failure",
      ]);
    });

    it("#118 AC-4: 会社範囲の拒否は、対象が company になる", async () => {
      const { logger, audit } = makeLogger();
      await errorOf(
        withLogger(logger).authorize(user, "test.example.write", company),
      );
      expect(audit.mock.calls[0]?.slice(0, 3)).toEqual([
        "test.example.write",
        "company",
        "failure",
      ]);
    });

    it("#118 AC-4: knownにない操作の拒否も記録する", async () => {
      const { logger, audit } = makeLogger();
      await errorOf(
        withLogger(logger).authorize(user, "test.example.unknown", deptA),
      );
      expect(audit).toHaveBeenCalledTimes(1);
    });

    it("#118 AC-4: 未認証（401）でも audit を1回呼ぶ。ユーザーIDは含めない（決定）", async () => {
      const { logger, audit } = makeLogger();
      await errorOf(
        withLogger(logger).authorize(null, "test.example.read", deptA),
      );
      expect(audit).toHaveBeenCalledTimes(1);
      expect(audit.mock.calls[0]?.slice(0, 3)).toEqual([
        "test.example.read",
        "department:dept_a",
        "failure",
      ]);
      expect(JSON.stringify(audit.mock.calls[0])).not.toContain("testuser_");
    });

    it("#118 AC-4: 許可されたときは audit を呼ばない", async () => {
      const { logger, audit } = makeLogger();
      await withLogger(logger).authorize(user, "test.example.write", deptA);
      expect(audit).not.toHaveBeenCalled();
    });

    it("#118 AC-4: 記録に、Resolverが返した権限の集合などの内部情報を含めない", async () => {
      const { logger, audit } = makeLogger();
      await errorOf(
        withLogger(logger).authorize(user, "test.example.write", deptB),
      );
      const logged = JSON.stringify(audit.mock.calls[0]);
      expect(logged).not.toContain("test.example.read");
    });

    it("#118 AC-4: 403 は reason が forbidden で、AppError の code とメッセージが決まっている", async () => {
      const { logger, audit } = makeLogger();
      const err = await errorOf(
        withLogger(logger).authorize(user, "test.example.write", deptB),
      );
      expect(audit.mock.calls[0]?.[3]).toEqual({ reason: "forbidden" });
      expect((err as AppError).code).toBe("FORBIDDEN");
      expect((err as AppError).userMessage).toBe(
        "この操作を行う権限がありません",
      );
    });

    it("#118 AC-4: 401 は reason が unauthenticated で、AppError の code とメッセージが決まっている", async () => {
      const { logger, audit } = makeLogger();
      const err = await errorOf(
        withLogger(logger).authorize(null, "test.example.read", deptA),
      );
      expect(audit.mock.calls[0]?.[3]).toEqual({ reason: "unauthenticated" });
      expect((err as AppError).code).toBe("UNAUTHENTICATED");
      expect((err as AppError).userMessage).toBe("ログインしてください");
    });

    it("#118 AC-4: logger は型として必須（省略すると型エラー）", () => {
      // @ts-expect-error 第3引数（logger）を省略できない
      createAuthorizer<TestPermission>(KNOWN, resolve);
      // @ts-expect-error logger を省略した options も渡せない
      createAuthorizer<TestPermission>(KNOWN, resolve, {});
    });
  });
});
