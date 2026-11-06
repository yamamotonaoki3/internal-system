// #123: 後続業務APIはまだないため、テスト専用の操作で共通判定と業務監査の接続を検証する。
// 製品へ仮のAPIを追加しない。再認証の監査を業務の監査の代わりにしない。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTH_TRACE_PREFIX, authAuditRows } from "../test/auth-fixtures";
import {
  credentialFixture,
  FIXED_NOW,
  type CredentialFixture,
} from "../test/credential-fixtures";
import { assertRecentReauth } from "./services/credentials.service";

let fixture: CredentialFixture;
beforeEach(async () => {
  fixture = await credentialFixture();
});
afterEach(async () => {
  await fixture.cleanup();
});

async function businessOperation(at: string | null, invalidAudit = false) {
  assertRecentReauth(at, FIXED_NOW);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET job_title = ? WHERE id = ?").bind(
      "testjob_123",
      fixture.userId,
    ),
    env.DB.prepare(
      "INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, result, trace_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      crypto.randomUUID(),
      fixture.userId,
      "unit.business_update",
      "user",
      fixture.userId,
      invalidAudit ? "invalid" : "success",
      `${AUTH_TRACE_PREFIX}business`,
    ),
  ]);
}
const jobTitle = () =>
  env.DB.prepare("SELECT job_title FROM users WHERE id = ?")
    .bind(fixture.userId)
    .first<{ job_title: string | null }>();

describe("#123 0-5 AC-1/3 後続業務との結合", () => {
  it("#123 0-5 AC-1/3: 未再認証なら業務データも業務監査も変わらない", async () => {
    await expect(businessOperation(null)).rejects.toMatchObject({
      status: 403,
      code: "REAUTH_REQUIRED",
    });
    expect((await jobTitle())?.job_title).toBeNull();
    expect(await authAuditRows()).toEqual([]);
  });
  it("#123 0-5 AC-3: 再認証済みなら業務更新と固有の操作監査を同じbatchで確定する", async () => {
    await businessOperation(FIXED_NOW.toISOString());
    expect((await jobTitle())?.job_title).toBe("testjob_123");
    expect(await authAuditRows()).toEqual([
      expect.objectContaining({
        actor_id: fixture.userId,
        action: "unit.business_update",
        target_id: fixture.userId,
        result: "success",
      }),
    ]);
  });
  it("#123 0-5 AC-3: 業務監査が書けなければ業務更新も確定しない", async () => {
    await expect(
      businessOperation(FIXED_NOW.toISOString(), true),
    ).rejects.toThrow();
    expect((await jobTitle())?.job_title).toBeNull();
    expect(await authAuditRows()).toEqual([]);
  });
});
