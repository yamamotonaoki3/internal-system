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
import { fakeAuthorizer } from "../../test/dm-fixtures";
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
