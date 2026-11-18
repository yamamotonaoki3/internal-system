// #148（148-A）R-62〜R-64・計画「案件の権限を確かめる経路」・レビュー1回目の重大2：案件の権限（perm.case.view／perm.case.post）だけを外したとき、
// 案件の部屋に触れるすべての経路で拒否される（または、混ざる一覧から SQL の側で除かれる）ことを確かめる。
// 外し方：固定ロールはすべて perm.case.* を持つため、偽の authorizer（dm-fixtures の fakeAuthorizer。指定した権限だけを FORBIDDEN にする）を
//   各 Service に渡す。Repository は本物（隔離 D1）。
//   ※ 計画では結合（リゾルバーを包む vi.mock）としたが、この環境（Windows の vitest-pool-workers）では vi.mock がアプリの判定に効かないことを
//     確かめたため（前提の確認のテストが 200 のまま）、既存の慣例（services/message.dm-authorize.test.ts）の Service の層にした。
// 経路（計画の表のすべての行）：
//   perm.case.view：メッセージの一覧・返信の一覧・メンションの候補（message.case-room.test.ts で確かめた）、
//                   既読（部屋・スレッド。unread.service）・添付の配信（attachment.service の download）・チャンネルの詳細（channel.service の get）→ 403
//                   スレッドの一覧 S-35（thread.service）・未読の対象（unread.service の list）→ 案件の部屋が出ない（通常のチャンネル・DM は出る）
//   perm.case.post：投稿・返信・編集・削除（message.case-room.test.ts）・リアクションの追加と取り消し・添付のアップロード（部屋・返信）→ 403
// 参加者（memberS1）で確かめる。
// 実装の担当への約束：channel.service の get は、deps.authorizer を渡されたらそれで perm.case.view を判定する（省略時は roles から組む）。
//   thread.service・unread.service の一覧は、authorize か can で perm.case.view を確かめ、なければ SQL に includeCase=false を渡す。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedStoredAttachment } from "../../test/attachment-fixtures";
import { ascii } from "../../test/attachment-files";
import {
  cleanupCaseRoomWorld,
  insertCaseWorldDm,
  seedRoomMessage,
  seedRoomReply,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { fakeAuthorizer } from "../../test/dm-fixtures";
import { withChannels } from "../db/channel.repository";
import { withMessages } from "../db/message.repository";
import { withReadPositions } from "../db/read-position.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { withThreads } from "../db/thread.repository";
import type { Permission } from "../lib/permissions";
import { createAttachmentService } from "./attachment.service";
import { createChannelService } from "./channel.service";
import { createMessageService } from "./message.service";
import { createThreadService } from "./thread.service";
import { createUnreadService } from "./unread.service";

const TEXT = ascii("[UNIT_TEST]148 perm");
let cw: CaseRoomWorld;

const actor = (userId: string) => ({
  userId,
  traceId: "unit-148-permissions",
  reauthenticatedAt: new Date().toISOString(),
});

async function settle<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ value, error: null as unknown }),
    (error: unknown) => ({ value: null as T | null, error }),
  );
}

const withMessageService = <T>(
  denied: readonly Permission[],
  run: (s: ReturnType<typeof createMessageService>) => Promise<T>,
) =>
  settle(
    withMessages(env, (repository) =>
      run(
        createMessageService(repository, {
          authorizer: fakeAuthorizer(denied),
        }),
      ),
    ),
  );

const withUnread = <T>(
  denied: readonly Permission[],
  run: (s: ReturnType<typeof createUnreadService>) => Promise<T>,
) =>
  settle(
    withReadPositions(env, (readPositions) =>
      withMessages(env, (rooms) =>
        run(
          createUnreadService(readPositions, rooms, {
            authorizer: fakeAuthorizer(denied),
          }),
        ),
      ),
    ),
  );

const withThreadService = <T>(
  denied: readonly Permission[],
  run: (s: ReturnType<typeof createThreadService>) => Promise<T>,
) =>
  settle(
    withThreads(env, (repository) =>
      run(
        createThreadService(repository, { authorizer: fakeAuthorizer(denied) }),
      ),
    ),
  );

const withChannelService = <T>(
  denied: readonly Permission[],
  run: (s: ReturnType<typeof createChannelService>) => Promise<T>,
) =>
  settle(
    withChannels(env, (repository) =>
      withRoleAssignments(env, (roles) =>
        run(
          createChannelService(repository, roles, {
            authorizer: fakeAuthorizer(denied),
          }),
        ),
      ),
    ),
  );

const attachmentService = (denied: readonly Permission[]) =>
  createAttachmentService(env, { authorizer: fakeAuthorizer(denied) });

const upload = () => ({
  name: "memo148.txt",
  contentLength: TEXT.length,
  body: new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(TEXT);
      controller.close();
    },
  }),
});

async function threadParentIds(denied: readonly Permission[]) {
  const ids: string[] = [];
  const { value, error } = await withThreadService(denied, (s) =>
    s.list(actor(cw.w.memberS1.id), { limit: 100 }),
  );
  if (error !== null) throw error;
  ids.push(
    ...(value as { items: { parent: { id: string } }[] }).items.map(
      (item) => item.parent.id,
    ),
  );
  return ids;
}

async function unreadRoomIds(denied: readonly Permission[]) {
  const { value, error } = await withUnread(denied, (s) =>
    s.list(actor(cw.w.memberS1.id), { limit: 100 }),
  );
  if (error !== null) throw error;
  return (value as { items: { roomId: string }[] }).items.map(
    (item) => item.roomId,
  );
}

const FORBIDDEN = { code: "FORBIDDEN", status: 403 };

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1570);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 R-62・R-64 perm.case.view だけを外す", () => {
  it("#148 R-62: 部屋の既読・スレッドの既読が 403", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 1);
    const reply = await seedRoomReply(
      cw.open.roomId,
      parent,
      cw.w.memberD1.id,
      2,
    );
    const me = actor(cw.w.memberS1.id);
    const room = await withUnread(["perm.case.view"], (s) =>
      s.markRead(me, cw.open.roomId, parent),
    );
    const thread = await withUnread(["perm.case.view"], (s) =>
      s.markThreadRead(me, parent, reply),
    );
    expect(room.error).toMatchObject(FORBIDDEN);
    expect(thread.error).toMatchObject(FORBIDDEN);
  });

  it("#148 R-64: 案件の部屋の添付の配信が 403（通常のチャンネルの添付は配信される）", async () => {
    const caseMessage = await seedRoomMessage(
      cw.open.roomId,
      cw.w.memberD1.id,
      3,
    );
    const normalMessage = await seedRoomMessage(cw.normal, cw.w.memberD1.id, 4);
    const inCase = await seedStoredAttachment(
      {
        roomId: cw.open.roomId,
        uploaderId: cw.w.memberD1.id,
        messageId: caseMessage,
      },
      TEXT,
    );
    const inNormal = await seedStoredAttachment(
      {
        roomId: cw.normal,
        uploaderId: cw.w.memberD1.id,
        messageId: normalMessage,
      },
      TEXT,
    );
    const service = attachmentService(["perm.case.view"]);
    const me = actor(cw.w.memberS1.id);
    expect(
      (await settle(service.download(me, inCase, null))).error,
    ).toMatchObject(FORBIDDEN);
    expect(
      (await settle(service.download(me, inNormal, null))).error,
    ).toBeNull();
  });

  it("#148 R-62: 案件の部屋のチャンネルの詳細が 403（通常のチャンネルは 200 相当）", async () => {
    const me = actor(cw.w.memberS1.id);
    const denied = await withChannelService(["perm.case.view"], (s) =>
      s.get(me, cw.open.roomId),
    );
    const normal = await withChannelService(["perm.case.view"], (s) =>
      s.get(me, cw.normal),
    );
    expect(denied.error).toMatchObject(FORBIDDEN);
    expect(normal.error).toBeNull();
  });

  it("#148 R-62・重大2: スレッドの一覧 S-35 に案件の部屋のスレッドが出ない（通常のチャンネル・DM のスレッドは出る）", async () => {
    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    const parents: Record<string, string> = {};
    let n = 10;
    for (const [label, roomId] of [
      ["case", cw.open.roomId],
      ["normal", cw.normal],
      ["dm", dm],
    ] as const) {
      n += 2;
      parents[label] = await seedRoomMessage(roomId, cw.w.memberS1.id, n);
      await seedRoomReply(roomId, parents[label], cw.w.memberD1.id, n + 1);
    }
    // 権限があるときは3つとも出る（対象でない行を別に置いた確認の前提）
    expect(await threadParentIds([])).toEqual(
      expect.arrayContaining([parents.case, parents.normal, parents.dm]),
    );
    const ids = await threadParentIds(["perm.case.view"]);
    expect(ids).not.toContain(parents.case);
    expect(ids).toEqual(expect.arrayContaining([parents.normal, parents.dm]));
  });

  it("#148 R-62・重大2: 未読の対象に案件の部屋が出ない（通常のチャンネル・DM は出る）", async () => {
    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    // 参加の時刻（joinedAt）より後のメッセージにする（未読の数の対象）
    await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 500_030);
    await seedRoomMessage(cw.normal, cw.w.memberD1.id, 500_031);
    await seedRoomMessage(dm, cw.w.memberD1.id, 500_032);
    expect(await unreadRoomIds([])).toEqual(
      expect.arrayContaining([cw.open.roomId, cw.normal, dm]),
    );
    const ids = await unreadRoomIds(["perm.case.view"]);
    expect(ids).not.toContain(cw.open.roomId);
    expect(ids).toEqual(expect.arrayContaining([cw.normal, dm]));
  });
});

describe("#148 R-63 perm.case.post だけを外す", () => {
  it("#148 R-63: リアクションの追加・取り消しが 403", async () => {
    const own = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 40);
    const me = actor(cw.w.memberS1.id);
    const added = await withMessageService(["perm.case.post"], (s) =>
      s.addReaction(me, own, "emoji", "👍"),
    );
    const removed = await withMessageService(["perm.case.post"], (s) =>
      s.removeReaction(me, own, "emoji", "👍"),
    );
    expect(added.error).toMatchObject(FORBIDDEN);
    expect(removed.error).toMatchObject(FORBIDDEN);
  });

  it("#148 R-63: 添付のアップロード（部屋・返信）が 403", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 41);
    const service = attachmentService(["perm.case.post"]);
    const me = actor(cw.w.memberS1.id);
    const toRoom = await settle(
      service.uploadToRoom(me, cw.open.roomId, upload()),
    );
    const toReply = await settle(service.uploadToReply(me, parent, upload()));
    expect(toRoom.error).toMatchObject(FORBIDDEN);
    expect(toReply.error).toMatchObject(FORBIDDEN);
  });

  it("#148 退行なし: perm.case.view・perm.case.post を外しても、通常のチャンネルへのアップロード・リアクションは通る", async () => {
    const message = await seedRoomMessage(cw.normal, cw.w.memberD1.id, 42);
    const denied: Permission[] = ["perm.case.view", "perm.case.post"];
    const me = actor(cw.w.memberS1.id);
    const uploaded = await settle(
      attachmentService(denied).uploadToRoom(me, cw.normal, upload()),
    );
    const reacted = await withMessageService(denied, (s) =>
      s.addReaction(me, message, "emoji", "👍"),
    );
    expect(uploaded.error).toBeNull();
    expect(reacted.error).toBeNull();
  });
});
