import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import {
  SCRYPT_TEST_TIMEOUT_MS,
  TEST_PASSWORD,
  TEST_PASSWORD_HASH,
  authAuditRows,
  loginAttemptRow,
  sessionRow,
  setUserPassword,
} from "../../test/auth-fixtures";
import {
  CREDENTIAL_LOGIN,
  credentialFixture,
  credentialSnapshot,
  FIXED_NOW,
  NEW_PASSWORD,
  seedCredentialFailures,
  type CredentialFixture,
} from "../../test/credential-fixtures";
import { verifyPassword } from "../lib/password";

let fixture: CredentialFixture;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  fixture = await credentialFixture();
});
afterEach(async () => {
  await fixture.cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#123 本人の認証情報API", { timeout: SCRYPT_TEST_TIMEOUT_MS }, () => {
  it("#123 0-3 AC-1: 本人の現在passwordを確認して変更できる", async () => {
    const response = await fixture.request("/api/me/password", "PUT", {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { id: fixture.userId },
      mustChangePassword: false,
      reauthenticatedAt: null,
    });
  });
  it("#123 0-5 AC-1: 再認証すると現在sessionの確認時刻を返す", async () => {
    const response = await fixture.request("/api/auth/reauthenticate", "POST", {
      password: TEST_PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reauthenticatedAt: FIXED_NOW.toISOString(),
    });
  });

  it("#123 0-3 AC-4: 現tokenと再認証時刻は保持し、別sessionをすべて失効させ、旧passwordを拒否する", async () => {
    const reauthenticatedAt = new Date(
      FIXED_NOW.getTime() - 60_000,
    ).toISOString();
    await env.DB.prepare(
      "UPDATE sessions SET reauthenticated_at = ? WHERE id = ?",
    )
      .bind(reauthenticatedAt, fixture.current.id)
      .run();
    const response = await fixture.request("/api/me/password", "PUT", {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      user: {
        id: fixture.userId,
        loginId: CREDENTIAL_LOGIN,
        displayName: "テスト太郎",
      },
      mustChangePassword: false,
      reauthenticatedAt,
    });
    expect((await fixture.request("/api/auth/session")).status).toBe(200);
    expect(
      (
        await fixture.request("/api/auth/session", "GET", undefined, {
          token: fixture.other.token,
        })
      ).status,
    ).toBe(401);
    expect((await sessionRow(fixture.current.id))?.revoked_at).toBeNull();
    expect((await sessionRow(fixture.other.id))?.revoked_at).toBe(
      FIXED_NOW.toISOString(),
    );
    const row = await env.DB.prepare(
      "SELECT password_hash FROM users WHERE id = ?",
    )
      .bind(fixture.userId)
      .first<{ password_hash: string }>();
    expect(await verifyPassword(NEW_PASSWORD, row?.password_hash ?? "")).toBe(
      true,
    );
    expect(await verifyPassword(TEST_PASSWORD, row?.password_hash ?? "")).toBe(
      false,
    );
  });

  it("#123 0-3 AC-1: 誤った現在passwordは422でcurrentPassword欄を示し、変更しない", async () => {
    const before = await credentialSnapshot(fixture);
    const response = await fixture.request("/api/me/password", "PUT", {
      currentPassword: "Wrong456!",
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["currentPassword"],
    });
    expect((await credentialSnapshot(fixture)).user).toEqual(before.user);
    expect((await credentialSnapshot(fixture)).sessions).toEqual(
      before.sessions,
    );
    expect(
      (await loginAttemptRow("account", fixture.accountKey))?.failed_count,
    ).toBe(1);
  });

  it("#123 0-3 AC-2/3: 事前に分かる規則違反は共通受付枠も社員ID失敗数も消費しない", async () => {
    for (const newPassword of [
      "short",
      "lowercase123!",
      "NoDigitsHere!",
      "NoSymbol123",
      "Password123!",
      "A1!testuser_credential_001",
      "Same\nAb12!",
    ]) {
      const response = await fixture.request("/api/me/password", "PUT", {
        currentPassword: "Wrong456!",
        newPassword,
      });
      expect(response.status, newPassword).toBe(422);
      expect(await response.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        fields: ["newPassword"],
        message: "このパスワードは使えません",
      });
    }
    expect(await loginAttemptRow("source", fixture.sourceKey)).toBeNull();
    expect(await loginAttemptRow("account", fixture.accountKey)).toBeNull();
    expect(await authAuditRows()).toEqual([]);
  });

  it("#123 0-3 AC-2: 現在と同じpasswordへの変更を拒否する", async () => {
    const before = await credentialSnapshot(fixture);
    const response = await fixture.request("/api/me/password", "PUT", {
      currentPassword: TEST_PASSWORD,
      newPassword: TEST_PASSWORD,
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ fields: ["newPassword"] });
    expect((await credentialSnapshot(fixture)).user).toEqual(before.user);
    expect((await credentialSnapshot(fixture)).sessions).toEqual(
      before.sessions,
    );
  });

  it("#123 0-3 AC-5: 初回変更は許可され、印が解除されるまで再認証と業務APIは403", async () => {
    await setUserPassword(fixture.userId, TEST_PASSWORD_HASH, {
      mustChangePassword: true,
    });
    expect(
      (
        await fixture.request("/api/auth/reauthenticate", "POST", {
          password: TEST_PASSWORD,
        })
      ).status,
    ).toBe(403);
    expect((await fixture.request("/api/sample-users")).status).toBe(403);
    const response = await fixture.request("/api/me/password", "PUT", {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mustChangePassword: false,
      reauthenticatedAt: null,
    });
    expect(
      await (await fixture.request("/api/auth/session")).json(),
    ).toMatchObject({ mustChangePassword: false });
  });

  it("#123 0-5 AC-1/2: 再認証は本人の現在sessionだけに記録し、別sessionへ共有しない", async () => {
    await fixture.request("/api/auth/reauthenticate", "POST", {
      password: TEST_PASSWORD,
    });
    expect(
      await (await fixture.request("/api/auth/session")).json(),
    ).toMatchObject({ reauthenticatedAt: FIXED_NOW.toISOString() });
    expect(
      await (
        await fixture.request("/api/auth/session", "GET", undefined, {
          token: fixture.other.token,
        })
      ).json(),
    ).toMatchObject({ reauthenticatedAt: null });
  });

  it("#123 0-5 AC-1/3: 誤った再認証は403 REAUTH_FAILED、成功/失敗監査に秘密が含まれない", async () => {
    const response = await fixture.request("/api/auth/reauthenticate", "POST", {
      password: "Wrong456!",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "REAUTH_FAILED" });
    expect(
      await (await fixture.request("/api/auth/session")).json(),
    ).toMatchObject({ reauthenticatedAt: null });
    expect(
      (
        await fixture.request("/api/auth/reauthenticate", "POST", {
          password: TEST_PASSWORD,
        })
      ).status,
    ).toBe(200);
    const rows = await authAuditRows();
    expect(
      rows
        .filter((row) => row.action === "auth.reauthenticate")
        .map((row) => row.result)
        .sort(),
    ).toEqual(["failure", "success"]);
    for (const value of [
      TEST_PASSWORD,
      "Wrong456!",
      fixture.current.token,
      CREDENTIAL_LOGIN,
      "192.0.2.10",
    ])
      expect(JSON.stringify(rows)).not.toContain(value);
  });

  it("#123 0-5 AC-4: login・再認証・現在passwordの失敗を同じ社員ID枠へ加算し、成功で戻す", async () => {
    await fixture.request(
      "/api/auth/login",
      "POST",
      { loginId: CREDENTIAL_LOGIN, password: "Wrong456!" },
      { token: null },
    );
    await fixture.request("/api/auth/reauthenticate", "POST", {
      password: "Wrong456!",
    });
    await fixture.request("/api/me/password", "PUT", {
      currentPassword: "Wrong456!",
      newPassword: NEW_PASSWORD,
    });
    expect(
      (await loginAttemptRow("account", fixture.accountKey))?.failed_count,
    ).toBe(3);
    expect(
      (await loginAttemptRow("source", fixture.sourceKey))?.attempt_count,
    ).toBe(3);
    expect(
      (
        await fixture.request("/api/auth/reauthenticate", "POST", {
          password: TEST_PASSWORD,
        })
      ).status,
    ).toBe(200);
    const account = await loginAttemptRow("account", fixture.accountKey);
    expect(account === null || account.failed_count === 0).toBe(true);
    expect(
      (await loginAttemptRow("source", fixture.sourceKey))?.attempt_count,
    ).toBe(4);
  });

  it("#123 0-5 AC-4: 共有接続元の30回目は許可、31回目は429、15分後に解除する", async () => {
    await env.DB.prepare(
      "INSERT INTO login_attempts (bucket_type, bucket_key, attempt_count, window_started_at, updated_at) VALUES ('source', ?, 29, ?, ?)",
    )
      .bind(fixture.sourceKey, FIXED_NOW.toISOString(), FIXED_NOW.toISOString())
      .run();
    expect(
      (
        await fixture.request("/api/auth/reauthenticate", "POST", {
          password: TEST_PASSWORD,
        })
      ).status,
    ).toBe(200);
    const blocked = await fixture.request("/api/me/password", "PUT", {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("900");
    expect(
      (
        await fixture.request(
          "/api/auth/login",
          "POST",
          { loginId: CREDENTIAL_LOGIN, password: TEST_PASSWORD },
          { token: null },
        )
      ).status,
    ).toBe(429);
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 900_000));
    expect(
      (
        await fixture.request("/api/me/password", "PUT", {
          currentPassword: TEST_PASSWORD,
          newPassword: NEW_PASSWORD,
        })
      ).status,
    ).toBe(200);
  });

  it.each([
    [3, 0, "reauth"],
    [4, 1000, "password"],
    [5, 2000, "reauth"],
    [6, 4000, "password"],
  ] as const)(
    "#123 0-5 AC-4: 社員ID失敗%i回の共有枠を%ims待って%sで確認する",
    async (failed, delay, operation) => {
      await seedCredentialFailures(fixture, failed);
      // 実待機は維持し、壁時計の揺れでなく指定された遅延を観測する。
      const timer = vi.spyOn(globalThis, "setTimeout");
      const response =
        operation === "reauth"
          ? await fixture.request("/api/auth/reauthenticate", "POST", {
              password: "Wrong456!",
            })
          : await fixture.request("/api/me/password", "PUT", {
              currentPassword: "Wrong456!",
              newPassword: NEW_PASSWORD,
            });
      expect(response.status).toBe(operation === "reauth" ? 403 : 422);
      const waits = timer.mock.calls
        .map((args) => args[1])
        .filter((ms) => ms === 1000 || ms === 2000 || ms === 4000);
      expect(waits).toEqual(delay === 0 ? [] : [delay]);
      expect(
        (await loginAttemptRow("account", fixture.accountKey))?.failed_count,
      ).toBe(failed + 1);
    },
  );

  it("#123 0-5 AC-4: 最後の失敗から15分ちょうどで遅延を解除し、失敗数を1から数え直す", async () => {
    await seedCredentialFailures(
      fixture,
      6,
      new Date(FIXED_NOW.getTime() - 900_000),
    );
    const timer = vi.spyOn(globalThis, "setTimeout");
    expect(
      (
        await fixture.request("/api/auth/reauthenticate", "POST", {
          password: "Wrong456!",
        })
      ).status,
    ).toBe(403);
    expect(timer.mock.calls.filter((args) => args[1] === 4000)).toHaveLength(0);
    expect(
      (await loginAttemptRow("account", fixture.accountKey))?.failed_count,
    ).toBe(1);
  });

  it.each([
    [
      "/api/me/password",
      "PUT",
      { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD },
    ],
    ["/api/auth/reauthenticate", "POST", { password: TEST_PASSWORD }],
  ] as const)(
    "#123 0-3 AC-1/0-5 AC-1: %sは未認証401・Origin403・no-store",
    async (path, method, body) => {
      expect(
        (await fixture.request(path, method, body, { token: null })).status,
      ).toBe(401);
      for (const origin of [null, "null", "https://untrusted.invalid"]) {
        const response = await fixture.request(path, method, body, { origin });
        expect(response.status).toBe(403);
      }
      const response = await fixture.request(path, method, body);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    },
  );

  it.each([
    [
      "/api/me/password",
      "PUT",
      { currentPassword: "", newPassword: NEW_PASSWORD },
    ],
    [
      "/api/me/password",
      "PUT",
      { currentPassword: "x".repeat(1025), newPassword: NEW_PASSWORD },
    ],
    ["/api/auth/reauthenticate", "POST", {}],
    ["/api/auth/reauthenticate", "POST", { password: "" }],
    ["/api/auth/reauthenticate", "POST", { password: 123 }],
    ["/api/auth/reauthenticate", "POST", { password: "x".repeat(1025) }],
  ] as const)(
    "#123 0-3 AC-1/0-5 AC-1: %sの入力不備は422で枠を消費しない",
    async (path, method, body) => {
      expect((await fixture.request(path, method, body)).status).toBe(422);
      expect(await loginAttemptRow("source", fixture.sourceKey)).toBeNull();
    },
  );
});
