// #140 AC-1（1-6 AC-2・AC-7、権限 R-32・R-33）: 添付の Service の権限（perm.attachment.upload・perm.attachment.download）の判定の順を、
// 本物の DB・手元の R2 と偽の authorizer（dm-fixtures の fakeAuthorizer）で確かめる。固定ロールはすべて両方の権限を持つため、拒否は偽の authorizer で作る。
// 拒否の audit の記録は createAuthorizer の authorize が必ず行う（project-rules。lib/authorization のテストが固定）ので、ここでは重ねない（#271）。
// 判定の順（計画）：
//   アップロード：部屋（または親）の判定 → perm.attachment.upload（403）→ 本文を読む。権限の拒否では本文を読まず、行も実体も作らない。
//   配信：見えるかの判定（見えなければ 404。権限は確かめない）→ perm.attachment.download（403）。
//
// 実装が前提とする約束（このテストが固定する）：
//   services/attachment.service.ts が createAttachmentService(env: Env, { authorizer }) を公開する。
//   service.uploadToRoom(actor, roomId, upload) ／ service.uploadToReply(actor, parentId, upload)
//     upload: { name: string; contentLength: number | null; body: ReadableStream<Uint8Array> }
//   service.download(actor, attachmentId, range: string | null)
//   actor: { userId: string; traceId: string }。拒否は AppError（code FORBIDDEN・NOT_FOUND）を投げる。
// データは架空（testuser_attsvc_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_BYTES, buildPng } from "../../test/attachment-files";
import {
  attachmentTotal,
  cleanupAttachmentScenario,
  createThreadWorld,
  seedStoredAttachment,
  storedKeys,
  trackedBody,
  type ThreadWorld,
} from "../../test/attachment-fixtures";
import { fakeAuthorizer, insertDm } from "../../test/dm-fixtures";
import { modifyTraceId } from "../../test/message-modify-fixtures";
import { seedParent } from "../../test/thread-fixtures";
import type { Permission } from "../lib/permissions";
import { createAttachmentService } from "./attachment.service";

let world: ThreadWorld;

const serviceWith = (denied: Permission[]) => {
  const fake = fakeAuthorizer(denied);
  return {
    fake,
    service: createAttachmentService(env, { authorizer: fake as never }),
  };
};

const actorOf = (userId: string) => ({ userId, traceId: modifyTraceId() });

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error as { code?: string },
  );

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("attsvc");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAttachmentScenario();
});

describe("#140 AC-1 perm.attachment.upload", () => {
  it.each(["room", "reply"] as const)(
    "#140 AC-1: %s の入口で perm.attachment.upload を拒否すると FORBIDDEN。本文を読まず、行も実体も作らない",
    async (entry) => {
      const { fake, service } = serviceWith(["perm.attachment.upload"]);
      const png = await buildPng();
      const tracked = trackedBody(png);
      const upload = {
        name: "image.png",
        contentLength: png.length,
        body: tracked.stream,
      };
      const actor = actorOf(world.alice.userId);
      const error = await errorOf(
        entry === "room"
          ? service.uploadToRoom(actor, world.channel, upload)
          : service.uploadToReply(
              actor,
              await seedParent(world.channel, world.bob.userId, 1),
              upload,
            ),
      );
      expect(error?.code).toBe("FORBIDDEN");
      expect(fake.calls.map((call) => call.permission)).toContain(
        "perm.attachment.upload",
      );
      expect(tracked.state.pulled).toBe(false);
      expect(await attachmentTotal()).toBe(0);
      expect(await storedKeys()).toEqual([]);
    },
  );

  it("#140 AC-1: 部屋が見えないときは、perm.attachment.upload を確かめる前に NOT_FOUND", async () => {
    const { fake, service } = serviceWith(["perm.attachment.upload"]);
    const error = await errorOf(
      service.uploadToRoom(
        actorOf(world.alice.userId),
        "01ZZZZZZZZZZZZZZZZZZZZZZZZ",
        {
          name: "memo.txt",
          contentLength: TEXT_BYTES.length,
          body: trackedBody(TEXT_BYTES).stream,
        },
      ),
    );
    expect(error?.code).toBe("NOT_FOUND");
    expect(fake.calls.map((call) => call.permission)).not.toContain(
      "perm.attachment.upload",
    );
  });
});

describe("#140 AC-1（1-6 AC-2・AC-7）perm.attachment.download", () => {
  const seedPosted = async () => {
    const message = await seedParent(world.channel, world.alice.userId, 1);
    return seedStoredAttachment(
      {
        roomId: world.channel,
        uploaderId: world.alice.userId,
        messageId: message,
      },
      TEXT_BYTES,
    );
  };

  it("#140 AC-1: 見える添付で perm.attachment.download を拒否すると FORBIDDEN", async () => {
    const id = await seedPosted();
    const { fake, service } = serviceWith(["perm.attachment.download"]);
    const error = await errorOf(
      service.download(actorOf(world.bob.userId), id, null),
    );
    expect(error?.code).toBe("FORBIDDEN");
    expect(fake.calls.map((call) => call.permission)).toEqual([
      "perm.attachment.download",
    ]);
  });

  it("#140 AC-1（存在を漏らさない）: 見えない添付（他人の未投稿）は、権限を確かめずに NOT_FOUND", async () => {
    const id = await seedStoredAttachment(
      { roomId: world.channel, uploaderId: world.alice.userId },
      TEXT_BYTES,
    );
    const { fake, service } = serviceWith(["perm.attachment.download"]);
    const error = await errorOf(
      service.download(actorOf(world.bob.userId), id, null),
    );
    expect(error?.code).toBe("NOT_FOUND");
    expect(fake.calls).toEqual([]);
  });
});

// #140 ミューテーション（絞った診断）への対応：認可の引数（利用者・権限・範囲）と順を、呼び出しの記録で確かめる。
// 期待（計画「権限」・設計書）：添付の権限は会社全体の範囲（{ type: "company" }）で、本人の userId で確かめる。
//   DM の添付の配信は、perm.dm.message.view（会社全体）→ perm.attachment.download の順。チャンネルの添付では DM の権限を確かめない。
//   DM の権限の拒否は FORBIDDEN で、R2 を読まない。
describe("#140 AC-1 認可の引数と順", () => {
  type Call = { userId: string | null; permission: string; scope: unknown };

  const recording = (denied: Permission[] = []) => {
    const fake = fakeAuthorizer(denied);
    const calls: Call[] = [];
    const authorizer = {
      ...fake,
      authorize: async (
        principal: { userId: string } | null,
        permission: Permission,
        scope?: unknown,
      ) => {
        calls.push({ userId: principal?.userId ?? null, permission, scope });
        await fake.authorize(principal, permission);
      },
    };
    return { calls, authorizer };
  };

  /** R2 を読んだ回数を数える（get だけを包む） */
  const countingEnv = () => {
    const counter = { gets: 0 };
    const real = (env as unknown as { ATTACHMENTS: R2Bucket }).ATTACHMENTS;
    const wrapped = new Proxy(real, {
      get(target, property, receiver) {
        if (property === "get")
          return (...args: Parameters<R2Bucket["get"]>) => {
            counter.gets += 1;
            return target.get(...args);
          };
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return {
      counter,
      env: { ...env, ATTACHMENTS: wrapped } as unknown as Env,
    };
  };

  const seedDmAttachment = async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const message = await seedParent(dm, world.alice.userId, 1);
    return seedStoredAttachment(
      { roomId: dm, uploaderId: world.alice.userId, messageId: message },
      TEXT_BYTES,
    );
  };

  it('#140 AC-1: アップロードは perm.attachment.upload を、本人の userId・範囲 { type: "company" } で確かめる', async () => {
    const { calls, authorizer } = recording();
    const service = createAttachmentService(env, {
      authorizer: authorizer as never,
    });
    await service.uploadToRoom(actorOf(world.alice.userId), world.channel, {
      name: "memo.txt",
      contentLength: TEXT_BYTES.length,
      body: trackedBody(TEXT_BYTES).stream,
    });
    expect(
      calls.filter((call) => call.permission === "perm.attachment.upload"),
    ).toEqual([
      {
        userId: world.alice.userId,
        permission: "perm.attachment.upload",
        scope: { type: "company" },
      },
    ]);
  });

  it('#140 AC-1（1-6 AC-2）: DM の添付の配信は、perm.dm.message.view → perm.attachment.download の順に、本人の userId・範囲 { type: "company" } で確かめる', async () => {
    const id = await seedDmAttachment();
    const { calls, authorizer } = recording();
    const service = createAttachmentService(env, {
      authorizer: authorizer as never,
    });
    await service.download(actorOf(world.bob.userId), id, null);
    expect(calls).toEqual([
      {
        userId: world.bob.userId,
        permission: "perm.dm.message.view",
        scope: { type: "company" },
      },
      {
        userId: world.bob.userId,
        permission: "perm.attachment.download",
        scope: { type: "company" },
      },
    ]);
  });

  it("#140 AC-1（1-6 AC-2）: DM の権限（perm.dm.message.view）の拒否は FORBIDDEN で、perm.attachment.download を確かめず、R2 を読まない", async () => {
    const id = await seedDmAttachment();
    const { calls, authorizer } = recording(["perm.dm.message.view"]);
    const counted = countingEnv();
    const service = createAttachmentService(counted.env, {
      authorizer: authorizer as never,
    });
    const error = await errorOf(
      service.download(actorOf(world.bob.userId), id, null),
    );
    expect(error?.code).toBe("FORBIDDEN");
    expect(calls.map((call) => call.permission)).toEqual([
      "perm.dm.message.view",
    ]);
    expect(counted.counter.gets).toBe(0);
  });

  it("#140 AC-1: perm.attachment.download の拒否でも R2 を読まない", async () => {
    const message = await seedParent(world.channel, world.alice.userId, 2);
    const id = await seedStoredAttachment(
      {
        roomId: world.channel,
        uploaderId: world.alice.userId,
        messageId: message,
      },
      TEXT_BYTES,
    );
    const { authorizer } = recording(["perm.attachment.download"]);
    const counted = countingEnv();
    const service = createAttachmentService(counted.env, {
      authorizer: authorizer as never,
    });
    const error = await errorOf(
      service.download(actorOf(world.bob.userId), id, null),
    );
    expect(error?.code).toBe("FORBIDDEN");
    expect(counted.counter.gets).toBe(0);
  });

  it("#140 AC-1: チャンネルの添付の配信では DM の権限を確かめない（perm.attachment.download だけ。本人・会社全体）", async () => {
    const message = await seedParent(world.channel, world.alice.userId, 3);
    const id = await seedStoredAttachment(
      {
        roomId: world.channel,
        uploaderId: world.alice.userId,
        messageId: message,
      },
      TEXT_BYTES,
    );
    const { calls, authorizer } = recording();
    const service = createAttachmentService(env, {
      authorizer: authorizer as never,
    });
    await service.download(actorOf(world.bob.userId), id, null);
    expect(calls).toEqual([
      {
        userId: world.bob.userId,
        permission: "perm.attachment.download",
        scope: { type: "company" },
      },
    ]);
  });
});
