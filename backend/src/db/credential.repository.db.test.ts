import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import {
  AUTH_TRACE_PREFIX,
  TEST_PASSWORD_HASH,
  authAuditRows,
  loginAttemptRow,
  sessionRow,
} from "../../test/auth-fixtures";
import {
  credentialFixture,
  credentialSnapshot,
  FIXED_NOW,
  seedCredentialFailures,
  type CredentialFixture,
} from "../../test/credential-fixtures";
import { createCredentialRepository } from "./credential.repository";

const repository = createCredentialRepository(drizzle(env.DB, { schema }));
const NEXT_HASH = "$scrypt$ln=16,r=8,p=2$dGVzdHNhbHQx$bmV3aGFzaDE";
const SECOND_HASH = "$scrypt$ln=16,r=8,p=2$dGVzdHNhbHQy$bmV3aGFzaDI";
let fixture: CredentialFixture;
beforeEach(async () => {
  fixture = await credentialFixture(true);
  await seedCredentialFailures(fixture);
});
afterEach(async () => {
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_credential_fail_audit");
  await fixture.cleanup();
});

function input() {
  return {
    userId: fixture.userId,
    sessionId: fixture.current.id,
    passwordHash: TEST_PASSWORD_HASH,
    accountKey: fixture.accountKey,
    traceId: `${AUTH_TRACE_PREFIX}credential`,
    now: FIXED_NOW,
  };
}
const change = (
  overrides: Partial<ReturnType<typeof input>> = {},
  nextHash = NEXT_HASH,
) =>
  repository.changePassword({
    ...input(),
    ...overrides,
    newPasswordHash: nextHash,
  });

async function failAudit() {
  await env.DB.exec(
    "CREATE TRIGGER unit_credential_fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'unit audit failure'); END",
  );
}

describe("#123 0-3 AC-4 password変更の同時確定", () => {
  it("#123 0-3 AC-4: password・初回印・他session・監査・失敗数resetを同時に確定する", async () => {
    expect(await change()).toBe(true);
    const snapshot = await credentialSnapshot(fixture);
    expect(snapshot.user).toEqual({
      password_hash: NEXT_HASH,
      must_change_password: 0,
    });
    expect((await sessionRow(fixture.current.id))?.revoked_at).toBeNull();
    expect((await sessionRow(fixture.other.id))?.revoked_at).toBe(
      FIXED_NOW.toISOString(),
    );
    expect(await loginAttemptRow("account", fixture.accountKey)).toBeNull();
    expect(await authAuditRows()).toEqual([
      expect.objectContaining({
        actor_id: fixture.userId,
        action: "auth.password_change",
        result: "success",
      }),
    ]);
  });

  it("#123 0-3 AC-4: 監査INSERT失敗でpassword・印・session・社員ID失敗数をすべて元に戻す", async () => {
    const before = await credentialSnapshot(fixture);
    await failAudit();
    await expect(change()).rejects.toThrow();
    expect(await credentialSnapshot(fixture)).toEqual(before);
  });

  it.each(["hash", "session", "user", "idle", "age"] as const)(
    "#123 0-3 AC-4: %sが確定前に変わったCAS敗者は副作用ゼロ",
    async (kind) => {
      if (kind === "hash")
        await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
          .bind(SECOND_HASH, fixture.userId)
          .run();
      if (kind === "session")
        await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?")
          .bind(FIXED_NOW.toISOString(), fixture.current.id)
          .run();
      if (kind === "user")
        await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
          .bind(fixture.userId)
          .run();
      if (kind === "idle")
        await env.DB.prepare(
          "UPDATE sessions SET last_active_at = ? WHERE id = ?",
        )
          .bind(
            new Date(FIXED_NOW.getTime() - 1_800_000).toISOString(),
            fixture.current.id,
          )
          .run();
      if (kind === "age")
        await env.DB.prepare("UPDATE sessions SET created_at = ? WHERE id = ?")
          .bind(
            new Date(FIXED_NOW.getTime() - 86_400_000).toISOString(),
            fixture.current.id,
          )
          .run();
      const before = await credentialSnapshot(fixture);
      expect(await change()).toBe(false);
      expect(await credentialSnapshot(fixture)).toEqual(before);
    },
  );

  it("#123 0-3 AC-4: 別利用者のsessionを現在sessionとして指定しても確定できない", async () => {
    const before = await credentialSnapshot(fixture);
    expect(await change({ sessionId: "f".repeat(64) })).toBe(false);
    expect(await credentialSnapshot(fixture)).toEqual(before);
  });

  it("#123 0-3 AC-4: 同じ旧hashから同時に変更した2要求は1件だけ確定し、監査も1件", async () => {
    const results = await Promise.all([change(), change({}, SECOND_HASH)]);
    expect(results.sort()).toEqual([false, true]);
    const snapshot = await credentialSnapshot(fixture);
    expect([NEXT_HASH, SECOND_HASH]).toContain(
      (snapshot.user as { password_hash: string }).password_hash,
    );
    expect(await authAuditRows()).toHaveLength(1);
  });
});

describe("#123 0-5 AC-1/3 再認証の同時確定", () => {
  it("#123 0-5 AC-1/3: 現session時刻・成功監査・社員ID失敗数resetを同時に確定する", async () => {
    expect(await repository.reauthenticate(input())).toBe(true);
    const rows = (await credentialSnapshot(fixture)).sessions;
    expect(rows).toContainEqual({
      id: fixture.current.id,
      reauthenticated_at: FIXED_NOW.toISOString(),
      revoked_at: null,
    });
    expect(rows).toContainEqual({
      id: fixture.other.id,
      reauthenticated_at: null,
      revoked_at: null,
    });
    expect(await loginAttemptRow("account", fixture.accountKey)).toBeNull();
    expect(await authAuditRows()).toEqual([
      expect.objectContaining({
        action: "auth.reauthenticate",
        actor_id: fixture.userId,
        result: "success",
      }),
    ]);
  });

  it("#123 0-5 AC-3: 監査失敗は再認証時刻と社員ID失敗数resetを取り消す", async () => {
    const before = await credentialSnapshot(fixture);
    await failAudit();
    await expect(repository.reauthenticate(input())).rejects.toThrow();
    expect(await credentialSnapshot(fixture)).toEqual(before);
  });

  it.each(
    (["hash", "session", "user", "idle", "age"] as const).flatMap((kind) =>
      [
        null,
        new Date(FIXED_NOW.getTime() - 30_000).toISOString(),
        FIXED_NOW.toISOString(),
      ].map((at) => [kind, at] as const),
    ),
  )(
    "#123 0-5 AC-1/3: %sだけが不成立なら、既存再認証時刻%sでも更新・監査・resetはゼロ",
    async (kind, at) => {
      await env.DB.prepare(
        "UPDATE sessions SET created_at = ?, reauthenticated_at = ? WHERE id = ?",
      )
        .bind(
          new Date(FIXED_NOW.getTime() - 60_000).toISOString(),
          at,
          fixture.current.id,
        )
        .run();
      if (kind === "hash")
        await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
          .bind(SECOND_HASH, fixture.userId)
          .run();
      if (kind === "session")
        await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?")
          .bind(FIXED_NOW.toISOString(), fixture.current.id)
          .run();
      if (kind === "user")
        await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
          .bind(fixture.userId)
          .run();
      if (kind === "idle")
        await env.DB.prepare(
          "UPDATE sessions SET last_active_at = ? WHERE id = ?",
        )
          .bind(
            new Date(FIXED_NOW.getTime() - 1_800_000).toISOString(),
            fixture.current.id,
          )
          .run();
      if (kind === "age")
        await env.DB.prepare("UPDATE sessions SET created_at = ? WHERE id = ?")
          .bind(
            new Date(FIXED_NOW.getTime() - 86_400_000).toISOString(),
            fixture.current.id,
          )
          .run();
      const before = await credentialSnapshot(fixture);
      expect(await repository.reauthenticate(input())).toBe(false);
      expect(await credentialSnapshot(fixture)).toEqual(before);
    },
  );
});
