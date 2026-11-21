// #270（270-A）AC-2・1-6 AC-4（R-26 と同じ種類の権限 perm.attachment.delete.own）：添付の削除の Service（createAttachmentService の remove）の権限の確かめを、
// 本物の DB・手元の R2 と偽の authorizer（dm-fixtures の fakeAuthorizer）で確かめる。固定ロールはすべて perm.attachment.delete.own を持つため、
// 結合テスト（routes/attachments.delete.test.ts）では、権限の確かめを削っても検出できない。拒否は偽の authorizer で作る
// （メッセージの編集・削除の前例：services/message.modify.test.ts の「③ 権限」、添付の権限の前例：services/attachment.service.test.ts）。
// 根拠：Issue #270 のコードレビューの指摘2、計画 4.2 の判定の順、要件 1-6 AC-4。
// 判定の順：① 見えるか（見えない・存在しない・削除済みは 404）→ 未投稿（409）→ ② 本人か（403）→ ③ perm.attachment.delete.own（403）
//   → ④ 部屋の状態（409 など）→ ⑥ 再認証（403 REAUTH_REQUIRED。最後）→ ⑦ 書き込み。
// 拒否の audit の記録は createAuthorizer の authorize が必ず行う（project-rules。lib/authorization のテストが固定）ので、ここでは重ねない。
// データは架空（testuser_attdelsvc_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_BYTES } from "../../test/attachment-files";
import {
  ATTACHMENT_DELETE_ACTION,
  auditRowsOf,
  cleanupAttachmentDeleteScenario,
  deletionOf,
  markAttachmentDeleted,
  recordingBucket,
} from "../../test/attachment-delete-fixtures";
import {
  attachmentRow,
  bucket,
  createThreadWorld,
  seedStoredAttachment,
  storedKeys,
  type ThreadWorld,
} from "../../test/attachment-fixtures";
import { fakeAuthorizer } from "../../test/dm-fixtures";
import {
  REAUTH_WINDOW_MS,
  deactivateDepartment,
  modifyTraceId,
} from "../../test/message-modify-fixtures";
import { seedParent } from "../../test/thread-fixtures";
import type { Permission } from "../lib/permissions";
import { createAttachmentService } from "./attachment.service";

const PERMISSION: Permission = "perm.attachment.delete.own";
const MISSING_ID = "01JZZZZZZZZZZZZZZZZZZZZZZZ";

let world: ThreadWorld;
let attachmentId: string;
let storageKey: string;

type Call = { userId: string | null; permission: string; scope: unknown };

/** 偽の authorizer（拒否する権限を指定）。authorize の引数（利用者・権限・範囲）を記録する */
function recordingAuthorizer(denied: readonly Permission[] = []) {
  const fake = fakeAuthorizer(denied);
  const calls: Call[] = [];
  return {
    calls,
    authorizer: {
      ...fake,
      authorize: async (
        principal: { userId: string } | null,
        permission: Permission,
        scope?: unknown,
      ) => {
        calls.push({ userId: principal?.userId ?? null, permission, scope });
        await fake.authorize(principal, permission);
      },
    },
  };
}

const reauthAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

/** 削除を実行し、結果（値か投げられた例外）と、R2 の delete の呼び出し・authorize の呼び出しを返す */
async function removeAs(
  userId: string,
  options: {
    denied?: readonly Permission[];
    reauthenticatedAt?: string | null;
    attachmentId?: string;
  } = {},
) {
  const { calls, authorizer } = recordingAuthorizer(options.denied ?? []);
  const recorded = recordingBucket(bucket());
  const service = createAttachmentService(
    { ...env, ATTACHMENTS: recorded.bucket } as unknown as Env,
    { authorizer: authorizer as never },
  );
  const error = await service
    .remove(
      {
        userId,
        traceId: modifyTraceId(),
        reauthenticatedAt:
          options.reauthenticatedAt === undefined
            ? reauthAgo(60_000)
            : options.reauthenticatedAt,
      },
      options.attachmentId ?? attachmentId,
    )
    .then(
      () => null,
      (thrown: unknown) => thrown as { code?: string; status?: number },
    );
  return { error, calls, deletes: recorded.deletes };
}

/** 何も変わっていない（印なし・実体あり・成功の監査なし・R2 の delete を呼んでいない） */
async function expectUntouched(deletes: readonly string[]) {
  expect(await deletionOf(attachmentId)).toEqual({
    deleted_at: null,
    deleted_by: null,
  });
  expect(await attachmentRow(attachmentId)).not.toBeNull();
  expect(await storedKeys()).toContain(storageKey);
  expect(await auditRowsOf(ATTACHMENT_DELETE_ACTION, attachmentId)).toEqual([]);
  expect(deletes).toEqual([]);
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("attdelsvc");
  const messageId = await seedParent(world.channel, world.alice.userId, 1);
  attachmentId = await seedStoredAttachment(
    { roomId: world.channel, uploaderId: world.alice.userId, messageId },
    TEXT_BYTES,
  );
  storageKey = (await attachmentRow(attachmentId))?.storage_key ?? "";
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAttachmentDeleteScenario();
});

describe("#270 AC-2 指摘2 perm.attachment.delete.own の拒否", () => {
  it("#270 AC-2（指摘2）: perm.attachment.delete.own が拒否されれば、本人の削除も 403 FORBIDDEN。印・監査・実体・R2 の delete のどれも変わらない", async () => {
    const outcome = await removeAs(world.alice.userId, {
      denied: [PERMISSION],
    });
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expectUntouched(outcome.deletes);
  });

  it("#270 AC-2（指摘2・判定の順 ③→⑥）: 拒否されれば、再認証がなくても REAUTH_REQUIRED ではなく 403 FORBIDDEN（未認可なら再認証を求めない）", async () => {
    const outcome = await removeAs(world.alice.userId, {
      denied: [PERMISSION],
      reauthenticatedAt: null,
    });
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expectUntouched(outcome.deletes);
  });

  it("#270 AC-2（指摘2・判定の順 ③→⑥）: 再認証から5分を超えていても、拒否なら 403 FORBIDDEN（REAUTH_REQUIRED ではない）", async () => {
    const outcome = await removeAs(world.alice.userId, {
      denied: [PERMISSION],
      reauthenticatedAt: reauthAgo(REAUTH_WINDOW_MS + 60_000),
    });
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN" });
    await expectUntouched(outcome.deletes);
  });

  it("#270 AC-2（指摘2・判定の順 ③→④）: 拒否されれば、部署が無効（部屋の状態が 409）でも 409 ではなく 403", async () => {
    await deactivateDepartment(world.dept.id);
    const outcome = await removeAs(world.alice.userId, {
      denied: [PERMISSION],
    });
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expectUntouched(outcome.deletes);
  });

  it("#270 AC-2（指摘2・判定の順 ①→③）: 存在しない添付は、拒否されていても 404 NOT_FOUND（権限を確かめる前に断る）", async () => {
    const outcome = await removeAs(world.alice.userId, {
      denied: [PERMISSION],
      attachmentId: MISSING_ID,
    });
    expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(outcome.calls.map((call) => call.permission)).not.toContain(
      PERMISSION,
    );
    await expectUntouched(outcome.deletes);
  });

  it("#270 AC-2（指摘2・判定の順 ①→③）: 削除済みの添付（見えない扱い）は、拒否されていても 404", async () => {
    await markAttachmentDeleted(attachmentId, world.alice.userId);
    const outcome = await removeAs(world.alice.userId, {
      denied: [PERMISSION],
    });
    expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(outcome.calls.map((call) => call.permission)).not.toContain(
      PERMISSION,
    );
  });

  it("#270 AC-2（指摘2・判定の順 ②→③）: 他人の添付は、拒否されていても、本人でない理由の 403 で断り、権限は確かめない", async () => {
    const outcome = await removeAs(world.bob.userId, { denied: [PERMISSION] });
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(outcome.calls.map((call) => call.permission)).not.toContain(
      PERMISSION,
    );
    await expectUntouched(outcome.deletes);
  });
});

describe("#270 AC-2 指摘2 拒否されなければ、権限を確かめて進む（対照）", () => {
  it('#270 AC-2（指摘2）: 拒否されない本人の削除は、perm.attachment.delete.own を本人の userId・範囲 { type: "company" } で確かめ、印を付けて実体と行を消す', async () => {
    const outcome = await removeAs(world.alice.userId);
    expect(outcome.error).toBeNull();
    expect(outcome.calls).toContainEqual({
      userId: world.alice.userId,
      permission: PERMISSION,
      scope: { type: "company" },
    });
    expect(outcome.deletes).toEqual([storageKey]);
    expect(await attachmentRow(attachmentId)).toBeNull();
    expect(await storedKeys()).toEqual([]);
    expect(
      await auditRowsOf(ATTACHMENT_DELETE_ACTION, attachmentId),
    ).toHaveLength(1);
  });

  it("#270 AC-3: 拒否されなくても、再認証がなければ 403 REAUTH_REQUIRED（権限の確かめの次に再認証）。何も変わらない", async () => {
    const outcome = await removeAs(world.alice.userId, {
      reauthenticatedAt: null,
    });
    expect(outcome.error).toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(outcome.calls.map((call) => call.permission)).toContain(PERMISSION);
    await expectUntouched(outcome.deletes);
  });
});
