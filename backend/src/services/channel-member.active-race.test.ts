// #147（147-C-1）計画レビュー2回目の重大への対応：「認証（セッションの確認）→ 無効化（参加の行は残す）→ 取得・書き込み」の順を固定する。
// 処理の途中に操作を挟む既存の先例（services/message.modify-race.test.ts）に合わせ、Service の層で確かめる：
//   ① 操作者の principal（actor）を作る（セッションの確認を通った後の状態）
//   ② 操作者を無効にする。参加の行は消さない（147-C-2 の後の状態。C-142(1)）
//   ③ 同じ actor で Service を呼ぶ
// 権限の判定（authorizer）は、無効化より前に通ったものとして、すべて許す偽物にする（判定の後に無効化が確定した場合の、最後の守りの SQL を確かめるため）。
// Repository は本物（隔離 D1）、R2 は手元のもの。
// 期待（計画 147-C-1 のテストケース「読み取りの競合」、C-182）：非公開の部屋のメッセージの一覧・返信・スレッドの一覧・添付の取得・チャンネルの詳細とメンバーの一覧が、
// 本文・添付・メンバーを返さない（404）。添付のアップロードは、行も R2 のオブジェクトも残さない。対として、無効化しなければ同じ呼び出しが成り立つ。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_BYTES } from "../../test/attachment-files";
import {
  bucket,
  insertAttachmentRow,
  storedKeys,
} from "../../test/attachment-fixtures";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  casereqTraceId,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { fakeAuthorizer } from "../../test/dm-fixtures";
import { withChannels } from "../db/channel.repository";
import { withMessages } from "../db/message.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { withThreads } from "../db/thread.repository";
import { createUlidFactory } from "../lib/ulid";
import { createAttachmentService } from "./attachment.service";
import { createChannelService } from "./channel.service";
import { createChannelManageService } from "./channel-manage.service";
import { createMessageService } from "./message.service";
import { createThreadService } from "./thread.service";

/** 同じ ms には必ず同じ ID を返す（乱数の部分を 0 に固定する） */
function fixedIdAt(ms: number): string {
  return createUlidFactory({
    now: () => ms,
    random: (length) => new Uint8Array(length),
  })();
}

const AT = "2026-11-17T03:00:00.000Z";
const ROOT_ID = fixedIdAt(1_862_000_001_000);
const REPLY_ID = fixedIdAt(1_862_000_002_000);
const ATTACHMENT_ID = fixedIdAt(1_862_000_003_000);
const SECRET_BODY = "[UNIT_TEST]非公開の本文";

let w: CaseWorld;
let room: SeededCase;
/** このテストより前からある R2 のキー（後始末で、このテストが作ったものだけを消すため） */
let keysAtStart: string[];

type Actor = {
  userId: string;
  traceId: string;
  reauthenticatedAt: string | null;
};

/** ① principal（actor）を作る */
const actorOf = (userId: string): Actor => ({
  userId,
  traceId: casereqTraceId(),
  reauthenticatedAt: new Date().toISOString(),
});

/** 権限の判定はすべて通す（無効化より前に通ったものとして扱う） */
const allowAll = () => fakeAuthorizer([]);

type Outcome = { value: unknown; error: unknown };
async function outcomeOf(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { value: await run(), error: null };
  } catch (error) {
    return { value: null, error };
  }
}

type RaceCase = {
  name: string;
  run: (actor: Actor) => Promise<unknown>;
};

// 表には関数だけを書く（beforeEach で代入する変数は、呼ばれた時点で読む）
const READS: RaceCase[] = [
  {
    name: "メッセージの一覧（message.service の list）",
    run: (actor) =>
      withMessages(env, (repository) =>
        createMessageService(repository, {
          authorizer: allowAll(),
        }).list(actor, room.roomId, { limit: 50 }),
      ),
  },
  {
    name: "返信の取得（message.service の listReplies）",
    run: (actor) =>
      withMessages(env, (repository) =>
        createMessageService(repository, {
          authorizer: allowAll(),
        }).listReplies(actor, ROOT_ID, { limit: 50 }),
      ),
  },
  {
    name: "メンションの候補（message.service の mentionCandidates）",
    run: (actor) =>
      withMessages(env, (repository) =>
        createMessageService(repository, {
          authorizer: allowAll(),
        }).mentionCandidates(actor, room.roomId, { limit: 20 }),
      ),
  },
  {
    name: "チャンネルの詳細とメンバーの一覧（channel.service の get）",
    run: (actor) =>
      withChannels(env, (repository) =>
        withRoleAssignments(env, (roles) =>
          createChannelService(repository, roles, {
            authorizer: allowAll(),
          }).get(actor, room.roomId),
        ),
      ),
  },
  {
    name: "添付の取得（attachment.service の download）",
    run: (actor) =>
      createAttachmentService(env, {
        authorizer: allowAll() as never,
      }).download(actor, ATTACHMENT_ID, null),
  },
];

/** 結果に、非公開の本文・添付・メンバーが含まれるか（JSON にして探す） */
function leaks(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = JSON.stringify(value);
  return (
    text.includes(SECRET_BODY) ||
    text.includes(ATTACHMENT_ID) ||
    text.includes(w.memberS2.id)
  );
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  keysAtStart = await storedKeys();
  w = await setupCaseWorld();
  room = await seedCase({
    n: 33,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]認証の後の無効化",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberS2.id, joinedAt: joinedAt(2) },
    ],
  });
  const insert = (id: string, senderId: string, parentId: string | null) =>
    env.DB.prepare(
      `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, parent_message_id)
       VALUES (?, ?, ?, 'テスト太郎', ?, ?, ?)`,
    )
      .bind(id, room.roomId, senderId, SECRET_BODY, AT, parentId)
      .run();
  await insert(ROOT_ID, w.memberS1.id, null);
  await insert(REPLY_ID, w.memberS2.id, ROOT_ID);
  await insertAttachmentRow({
    id: ATTACHMENT_ID,
    roomId: room.roomId,
    uploaderId: w.memberS2.id,
    messageId: ROOT_ID,
    createdAt: AT,
  });
  // 配信の対（有効な参加者）のため、実体も置く
  await bucket().put(`attachments/${ATTACHMENT_ID}`, TEXT_BYTES);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const key of await storedKeys())
    if (!keysAtStart.includes(key)) await bucket().delete(key);
  await cleanupCaseTestData();
});

describe("#147 147-C-1 認証 → 無効化（参加の行は残す）→ 取得：非公開の本文・添付・メンバーを返さない", () => {
  it.each(READS)(
    "#147 147-C-1 有効な参加者（対）: $name は成り立ち、非公開の内容を返す",
    async ({ run }) => {
      const outcome = await outcomeOf(() => run(actorOf(w.memberS1.id)));
      expect(outcome.error).toBeNull();
      // メンションの候補・添付の配信は、本文を含まない形で返す（成り立つことだけを確かめる）
      expect(outcome.value).not.toBeNull();
    },
  );

  it.each(READS)(
    "#147 147-C-1 C-142(1): principal を作った後に無効化が確定すると、$name は 404 で、非公開の内容を返さない",
    async ({ run }) => {
      const actor = actorOf(w.memberS1.id);
      await setUserActive(w.memberS1.id, false);
      const member = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM channel_members WHERE channel_id = ? AND user_id = ?",
      )
        .bind(room.roomId, w.memberS1.id)
        .first<{ n: number }>();
      expect(member?.n).toBe(1);
      const outcome = await outcomeOf(() => run(actor));
      expect(leaks(outcome.value)).toBe(false);
      expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    },
  );

  it("#147 147-C-1 C-142(1): principal を作った後に無効化が確定すると、スレッドの一覧（thread.service の list）に、その部屋のスレッドを出さない", async () => {
    const list = (actor: Actor) =>
      withThreads(env, (repository) =>
        createThreadService(repository, { authorizer: allowAll() }).list(
          actor,
          { limit: 20 },
        ),
      );
    // 対：無効化しなければ出る（空振りしないこと）
    expect(
      (await list(actorOf(w.memberS1.id))).items.map((item) => item.parent.id),
    ).toEqual([ROOT_ID]);
    const actor = actorOf(w.memberS1.id);
    await setUserActive(w.memberS1.id, false);
    const page = await list(actor);
    expect(page.items.map((item) => item.parent.id)).toEqual([]);
    expect(leaks(page)).toBe(false);
  });
});

describe("#147 147-C-1 認証 → 無効化（参加の行は残す）→ 添付のアップロード：行も R2 のオブジェクトも残さない", () => {
  const upload = (actor: Actor) =>
    createAttachmentService(env, {
      authorizer: allowAll() as never,
    }).uploadToRoom(actor, room.roomId, {
      name: "[UNIT_TEST]memo.txt",
      contentLength: TEXT_BYTES.length,
      // #148（148-B-2）公開範囲の指定（クエリ）なし＝既定の参加者限定
      publicationVisibility: undefined,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(TEXT_BYTES);
          controller.close();
        },
      }),
    });
  const pendingRows = async () =>
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM message_attachments WHERE room_id = ? AND message_id IS NULL",
      )
        .bind(room.roomId)
        .first<{ n: number }>()
    )?.n;

  it("#147 147-C-1 有効な参加者（対）: アップロードは成り立ち、未投稿の行と R2 のオブジェクトが1つずつ増える", async () => {
    const keysBefore = (await storedKeys()).length;
    const outcome = await outcomeOf(() => upload(actorOf(w.memberS1.id)));
    expect(outcome.error).toBeNull();
    expect(await pendingRows()).toBe(1);
    expect((await storedKeys()).length).toBe(keysBefore + 1);
  });

  it("#147 147-C-1 C-142(1): principal を作った後に無効化が確定すると、アップロードは 404 で、未投稿の行も R2 のオブジェクトも残さない", async () => {
    const actor = actorOf(w.memberS1.id);
    await setUserActive(w.memberS1.id, false);
    const keysBefore = await storedKeys();
    const outcome = await outcomeOf(() => upload(actor));
    expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await pendingRows()).toBe(0);
    expect(await storedKeys()).toEqual(keysBefore);
  });
});

describe("#147 147-C-1 認証 → 無効化（参加の行は残す）→ チャンネルの管理（channel-manage.service）：管理の権限のない人は 404 で、書き込みを呼ばない", () => {
  const PRIVATE_ID = fixedIdAt(1_862_000_010_000);
  const ARCHIVED_ID = fixedIdAt(1_862_000_011_000);

  beforeEach(async () => {
    await insertChannel({
      id: PRIVATE_ID,
      name: "casereq管理の確認",
      purpose: "normal",
      departmentId: w.deptS.id,
      visibility: "private",
    });
    await insertChannel({
      id: ARCHIVED_ID,
      name: "casereq管理の確認（アーカイブ済み）",
      purpose: "normal",
      departmentId: w.deptS.id,
      visibility: "private",
      archived: true,
    });
    await insertMember(PRIVATE_ID, w.memberS1.id);
    await insertMember(ARCHIVED_ID, w.memberS1.id);
  });

  afterEach(async () => {
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM channel_members WHERE channel_id IN (?, ?)",
      ).bind(PRIVATE_ID, ARCHIVED_ID),
      env.DB.prepare("DELETE FROM channels WHERE room_id IN (?, ?)").bind(
        PRIVATE_ID,
        ARCHIVED_ID,
      ),
      env.DB.prepare("DELETE FROM rooms WHERE id IN (?, ?)").bind(
        PRIVATE_ID,
        ARCHIVED_ID,
      ),
    ]);
  });

  type ManageCase = {
    name: string;
    roomId: () => string;
    run: (
      service: ReturnType<typeof createChannelManageService>,
      actor: Actor,
      roomId: string,
    ) => Promise<unknown>;
  };
  const MANAGES: ManageCase[] = [
    {
      name: "名前の変更（update）",
      roomId: () => PRIVATE_ID,
      run: (service, actor, roomId) =>
        service.update(actor, roomId, {
          version: 1,
          name: "casereq変更後の名前",
        }),
    },
    {
      name: "アーカイブ（archive）",
      roomId: () => PRIVATE_ID,
      run: (service, actor, roomId) =>
        service.archive(actor, roomId, { version: 1, reason: null }),
    },
    {
      name: "復元（restore。アーカイブ済みの非公開は、有効な参加者にも見えない）",
      roomId: () => ARCHIVED_ID,
      run: (service, actor, roomId) =>
        service.restore(actor, roomId, { version: 1 }),
    },
  ];

  it.each(MANAGES)(
    "#147 147-C-1 C-142(1): principal を作った後に無効化が確定すると、管理の権限のない人の $name は 404 NOT_FOUND で、書き込みを呼ばない",
    async ({ roomId, run }) => {
      const actor = actorOf(w.memberS1.id);
      await setUserActive(w.memberS1.id, false);
      const versionBefore = await env.DB.prepare(
        "SELECT version, name, deleted_at FROM channels WHERE room_id = ?",
      )
        .bind(roomId())
        .first();
      expect(versionBefore).not.toBeNull();
      const writes: string[] = [];
      const outcome = await withChannels(env, (repository) => {
        const spied = {
          ...repository,
          update: (input: Parameters<typeof repository.update>[0]) => {
            writes.push("update");
            return repository.update(input);
          },
          archive: (input: Parameters<typeof repository.archive>[0]) => {
            writes.push("archive");
            return repository.archive(input);
          },
          restore: (input: Parameters<typeof repository.restore>[0]) => {
            writes.push("restore");
            return repository.restore(input);
          },
        };
        // 管理の権限なし（can は偽、authorize は 403）
        const service = createChannelManageService(spied, {
          authorizer: fakeAuthorizer([
            "perm.channel.edit",
            "perm.channel.delete",
          ]),
        } as never);
        return outcomeOf(() => run(service, actor, roomId()));
      });
      expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(writes).toEqual([]);
      expect(
        await env.DB.prepare(
          "SELECT version, name, deleted_at FROM channels WHERE room_id = ?",
        )
          .bind(roomId())
          .first(),
      ).toEqual(versionBefore);
    },
  );
});
