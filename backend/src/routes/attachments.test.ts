// #140 AC-1（1-6 AC-1〜AC-3・AC-5〜AC-7・AC-9）・AC-2（1-4 AC-5）・AC-3（C-137・C-153）: 添付のアップロード（2つの入口）と配信を、
// 実際のアプリ入口（index.ts の app）・隔離 D1・手元の R2（Miniflare の ATTACHMENTS）で確かめる。
// 契約（計画「方式」「判定の順」「情報漏えいの経路と対策」。このテストが固定する）：
//   POST /api/rooms/:roomId/attachments（通常の投稿用）・POST /api/messages/:messageId/replies/attachments（返信用）
//     本文はファイルのバイト列そのまま（Content-Type: application/octet-stream）。元の名前は X-File-Name（UTF-8 のパーセントエンコード）。Content-Length は必須。
//     201 { id, name, kind, contentType, size }。行は message_id が NULL（未投稿）、thread_parent_id は通常の投稿用が NULL・返信用が親の ID。
//     キーは attachments/<乱数>（応答に出さず、元の名前を含まない）。
//     判定の順：401 → 通常の投稿用は requirePostable と同じ（404・403・409）／返信用は requireReplyable と同じ → perm.attachment.upload（403）→ 入力の誤り 422（VALIDATION_ERROR）。
//     本文を読む前に、ここまでと Content-Length（ない・100,000,000 を超える・種類の上限を超える）を判定する。
//     受信したバイト数が Content-Length と違う・形式が合わない：422 で、行も R2 の実体も残らない。
//     R2 に保存した後の D1 の登録の失敗：保存した実体を消してから元のエラー（500）を返す。消すのに失敗したら error ログに残し、元のエラーを返す。ログにファイル名・キーを出さない。
//   GET /api/attachments/:attachmentId
//     401 → 404（存在しない・メッセージが削除済み・部屋が見えない・他人の未投稿を区別しない）→ perm.attachment.download（403）。param の誤りは 422。
//     200 の本文は保存した実体。ヘッダー：Content-Type（サーバーの判定結果）・Content-Disposition（画像・動画は inline、それ以外は attachment、filename*）・
//     X-Content-Type-Options: nosniff・Content-Security-Policy: default-src 'none'; sandbox・Cross-Origin-Resource-Policy: same-origin・
//     Cache-Control: private, no-store・Accept-Ranges: bytes。正しい単一の Range は 206 と Content-Range、無効な Range は 200 で全体（解釈の全事例は byte-range の単体）。
//     R2 に実体がない（get が null）は 404（500 にしない）。
// 形式の検査の細部は attachment-inspection・ooxml-check の単体、Content-Disposition の組み立ての全事例は content-disposition の単体にある。ここは入口・組み合わせ・応答の形だけ（#271）。
// 権限（perm.attachment.upload・download）の拒否は、固定ロールがすべて持つため、services/attachment.service.test.ts で偽の authorizer を使って確かめる。
// テストの設定：wrangler.jsonc の r2_buckets に binding "ATTACHMENTS" が要る（実装の担当が足す）。
// データは架空（testuser_attapi_、[UNIT_TEST]、@example.com）。ファイルはテストの中でバイト列から組む。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  MP4_BYTES,
  PDF_BYTES,
  TEXT_BYTES,
  ascii,
  buildJpeg,
  buildOoxml,
  buildPng,
  includesBytes,
} from "../../test/attachment-files";
import {
  TEST_TAG,
  attachmentRow,
  attachmentTotal,
  bucket,
  bytesOf,
  cleanupAttachmentScenario,
  createThreadWorld,
  downloadAttachment,
  failingAttachmentInsertDb,
  failingDeleteBucket,
  insertAttachmentRow,
  seedStoredAttachment,
  storedKeys,
  trackedBody,
  uploadFile,
  uploadPathOf,
  uploadedOk,
  rawRequest,
  type ThreadWorld,
  type UploadTarget,
} from "../../test/attachment-fixtures";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { deactivateUser, insertDm } from "../../test/dm-fixtures";
import {
  archiveChannel,
  deactivateDepartment,
  leaveChannel,
  markDeleted,
} from "../../test/message-modify-fixtures";
import { codeOf, seedParent, seedReply } from "../../test/thread-fixtures";

let world: ThreadWorld;
let logLines: string[];
let errorLines: string[];
let room: UploadTarget;

const MB = 1_000_000;
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FIXED_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
  "cross-origin-resource-policy": "same-origin",
  "cache-control": "private, no-store",
};

const auditLines = (permission: string) =>
  logLines
    .filter((line) => line.startsWith("{"))
    .map(
      (line) =>
        JSON.parse(line) as {
          body?: string;
          attributes?: Record<string, unknown>;
        },
    )
    .filter(
      (line) =>
        line.attributes?.log_type === "audit" && line.body === permission,
    );

const postMessage = (roomId: string, token: string) =>
  apiRequest("POST", `/api/rooms/${roomId}/messages`, {
    token,
    body: { body: `${TEST_TAG}比較の投稿` },
  });

/** 本文を流すストリームで要求し、本文が読まれたかを返す */
async function uploadTracked(
  target: UploadTarget,
  token: string | null,
  headers: Record<string, string>,
  bytes = buildPng(),
) {
  const body = await bytes;
  const tracked = trackedBody(body);
  const response = await rawRequest("POST", uploadPathOf(target), {
    token,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent("image.png"),
      ...headers,
    },
    body: tracked.stream,
  });
  return { response, pulled: tracked.state.pulled };
}

const nothingStored = async () => {
  expect(await attachmentTotal()).toBe(0);
  expect(await storedKeys()).toEqual([]);
};

beforeEach(async () => {
  logLines = [];
  errorLines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    errorLines.push(String(line));
  });
  world = await createThreadWorld("attapi");
  room = { kind: "room", roomId: world.channel };
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAttachmentScenario();
});

describe("#140 AC-1（1-6 AC-1・AC-3・AC-6）通常の投稿用のアップロードの成功", () => {
  it("#140 AC-1（1-6 AC-3）: PNG を送ると 201 { id, name, kind, contentType, size }。未投稿の行と、乱数のキーの実体が R2 に1つ入る", async () => {
    const png = await buildPng();
    const body = await uploadedOk(
      await uploadFile(room, "image.png", png, world.alice.token),
    );
    expect(body).toEqual({
      id: expect.stringMatching(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
      name: "image.png",
      kind: "image",
      contentType: "image/png",
      size: png.length,
    });
    expect(Object.keys(body).sort()).toEqual(
      ["contentType", "id", "kind", "name", "size"].sort(),
    );
    const row = await attachmentRow(body.id);
    expect(row).toMatchObject({
      room_id: world.channel,
      thread_parent_id: null,
      message_id: null,
      uploader_id: world.alice.userId,
      original_name: "image.png",
      kind: "image",
      content_type: "image/png",
      size_bytes: png.length,
    });
    expect(row?.storage_key).toMatch(/^attachments\//);
    expect(row?.storage_key).not.toContain("image");
    expect(row?.storage_key).not.toContain(body.id);
    expect(await storedKeys()).toEqual([row?.storage_key]);
    const stored = await bucket().get(row?.storage_key ?? "");
    expect(Array.from(new Uint8Array(await stored!.arrayBuffer()))).toEqual(
      Array.from(png),
    );
  });

  it("#140 AC-1（1-6 AC-3）: 日本語の元の名前を返し、キーには名前を含まない", async () => {
    const name = "報告書 2026.pdf";
    const body = await uploadedOk(
      await uploadFile(room, name, PDF_BYTES, world.alice.token),
    );
    expect(body.name).toBe(name);
    const row = await attachmentRow(body.id);
    expect(row?.original_name).toBe(name);
    expect(row?.storage_key).not.toContain(encodeURIComponent(name));
    expect(row?.storage_key).not.toContain("報告書");
  });

  it("#140 AC-1: Exif を含む JPEG は、Exif を除いてから保存し、size は保存したバイト数", async () => {
    const body = await uploadedOk(
      await uploadFile(
        room,
        "photo.jpg",
        buildJpeg({ exif: true }),
        world.alice.token,
      ),
    );
    const row = await attachmentRow(body.id);
    const stored = new Uint8Array(
      await (await bucket().get(row?.storage_key ?? ""))!.arrayBuffer(),
    );
    expect(includesBytes(stored, ascii("[UNIT_TEST]GPS"))).toBe(false);
    expect(body.size).toBe(stored.length);
    expect(row?.size_bytes).toBe(stored.length);
  });

  it("#140 AC-1（1-6 AC-6）: 動画（MP4）を受け付け、送ったバイト列のまま保存する", async () => {
    const body = await uploadedOk(
      await uploadFile(room, "movie.mp4", MP4_BYTES, world.alice.token),
    );
    expect(body).toMatchObject({ kind: "video", contentType: "video/mp4" });
    const row = await attachmentRow(body.id);
    const stored = await bucket().get(row?.storage_key ?? "");
    expect(Array.from(new Uint8Array(await stored!.arrayBuffer()))).toEqual(
      Array.from(MP4_BYTES),
    );
  });

  it("#140 AC-1（1-6 AC-1）: DM の当事者もアップロードできる", async () => {
    const dm = await insertDm(world.alice.userId, world.carol.userId);
    const response = await uploadFile(
      { kind: "room", roomId: dm },
      "memo.txt",
      TEXT_BYTES,
      world.carol.token,
    );
    expect(response.status).toBe(201);
  });
});

describe("#140 AC-1（1-6 AC-1・AC-5・AC-6）アップロードの入力の誤り（422・保存しない）", () => {
  it("#140 AC-1（1-6 AC-5）: 拡張子を偽ったファイル（PNG の中身で .jpg）は 422 VALIDATION_ERROR で、行も R2 の実体も残らない", async () => {
    const response = await uploadFile(
      room,
      "photo.jpg",
      await buildPng(),
      world.alice.token,
    );
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe("VALIDATION_ERROR");
    await nothingStored();
  });

  it("#140 AC-1（C-137(1)）: Office の拡張子の一般の zip（[Content_Types].xml がない）は 422 で、保存しない", async () => {
    const response = await uploadFile(
      room,
      "doc.docx",
      await buildOoxml("docx", { omitContentTypes: true }),
      world.alice.token,
    );
    expect(response.status).toBe(422);
    await nothingStored();
  });

  it("#140 AC-1（1-6 AC-1）: 種類の上限を超える Content-Length（画像で10,000,001）は、本文を読まずに 422", async () => {
    const { response, pulled } = await uploadTracked(room, world.alice.token, {
      "Content-Length": String(10 * MB + 1),
    });
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe("VALIDATION_ERROR");
    expect(pulled).toBe(false);
    await nothingStored();
  });

  it("#140 AC-1（1-6 AC-6）: Content-Length が100,000,000を超えると、本文を読まずに 422", async () => {
    const { response, pulled } = await uploadTracked(
      room,
      world.alice.token,
      {
        "Content-Length": String(100 * MB + 1),
        "X-File-Name": encodeURIComponent("movie.mp4"),
      },
      Promise.resolve(MP4_BYTES),
    );
    expect(response.status).toBe(422);
    expect(pulled).toBe(false);
    await nothingStored();
  });

  it("#140 AC-1（1-6 AC-6）: Content-Length がないと、本文を読まずに 422", async () => {
    const { response, pulled } = await uploadTracked(
      room,
      world.alice.token,
      {},
    );
    expect(response.status).toBe(422);
    expect(pulled).toBe(false);
    await nothingStored();
  });

  it.each([
    ["画像（全体を読む）", "image.png", () => buildPng()],
    ["動画（ストリームで保存する）", "movie.mp4", async () => MP4_BYTES],
  ])(
    "#140 AC-1（1-6 AC-6）: %sで受信したバイト数が Content-Length より少ないと 422 で、行も R2 の実体も残らない",
    async (_label, name, make) => {
      const bytes = await make();
      const response = await uploadFile(room, name, bytes, world.alice.token, {
        headers: { "Content-Length": String(bytes.length + 100) },
      });
      expect(response.status).toBe(422);
      await nothingStored();
    },
  );

  it.each([
    ["X-File-Name がない", null],
    ['名前に「"」を含む', encodeURIComponent('a"b.png')],
    ["名前に改行を含む", encodeURIComponent("a\nb.png")],
    ["名前が256文字", encodeURIComponent(`${"a".repeat(252)}.png`)],
    ["パーセントエンコードとして壊れている", "%E5%A0"],
  ])(
    "#140 AC-1（1-6 AC-3）: %sと 422 で、保存しない",
    async (_label, header) => {
      const response = await uploadFile(
        room,
        "image.png",
        await buildPng(),
        world.alice.token,
        header === null
          ? { omit: ["X-File-Name"] }
          : { headers: { "X-File-Name": header } },
      );
      expect(response.status).toBe(422);
      await nothingStored();
    },
  );
});

describe("#140 AC-1 通常の投稿用のアップロードの判定の順（本文を読む前に拒否）", () => {
  it("#140 AC-1: 未認証は 401 で、本文を読まない", async () => {
    const { response, pulled } = await uploadTracked(room, null, {
      "Content-Length": "100",
    });
    expect(response.status).toBe(401);
    expect(pulled).toBe(false);
    await nothingStored();
  });

  it.each([
    ["存在しない部屋", "missing"],
    ["参加していない非公開チャンネル", "private"],
    ["当事者でない DM", "dm"],
    ["アーカイブ済みのチャンネル", "archived"],
  ] as const)(
    "#140 AC-1: %sは 404 で、本文を読まない（Content-Length が上限を超えていても 404 が先）",
    async (_label, kind) => {
      let roomId: string;
      if (kind === "missing") roomId = "01ZZZZZZZZZZZZZZZZZZZZZZZZ";
      else if (kind === "private") {
        roomId = await insertChannel({
          name: `${TEST_TAG}添付の非公開`,
          purpose: "normal",
          departmentId: world.dept.id,
          visibility: "private",
        });
        await insertMember(roomId, world.bob.userId);
      } else if (kind === "dm")
        roomId = await insertDm(world.bob.userId, world.dave.userId);
      else {
        roomId = world.channel;
        await archiveChannel(roomId);
      }
      const { response, pulled } = await uploadTracked(
        { kind: "room", roomId },
        world.alice.token,
        { "Content-Length": String(100 * MB + 1) },
      );
      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe("NOT_FOUND");
      expect(pulled).toBe(false);
      await nothingStored();
    },
  );

  it("#140 AC-1: 参加していない公開チャンネルは 403 で、本文を読まない", async () => {
    const { response, pulled } = await uploadTracked(room, world.carol.token, {
      "Content-Length": "100",
    });
    expect(response.status).toBe(403);
    expect(pulled).toBe(false);
    await nothingStored();
  });

  it.each([
    ["部署が無効のチャンネル", "department"],
    ["相手が無効の DM", "partner"],
  ] as const)(
    "#140 AC-1: %sは、通常の投稿（POST /api/rooms/:roomId/messages）と同じ応答になる（拒否なら保存しない）",
    async (_label, kind) => {
      let roomId = world.channel;
      if (kind === "department") await deactivateDepartment(world.dept.id);
      else {
        roomId = await insertDm(world.alice.userId, world.carol.userId);
        await deactivateUser(world.carol.userId);
      }
      // 計画は「requirePostable と同じ」。現在の投稿が部署の無効を拒否しない場合は、アップロードも同じ結果になる（報告の「確認が必要な点」）
      const posted = await postMessage(roomId, world.alice.token);
      const response = await uploadFile(
        { kind: "room", roomId },
        "image.png",
        await buildPng(),
        world.alice.token,
      );
      expect(response.status).toBe(posted.status);
      if (kind === "partner") expect(posted.status).toBe(409);
      if (posted.status !== 201) {
        expect(await codeOf(response)).toBe(await codeOf(posted));
        await nothingStored();
      }
    },
  );

  it("#140 AC-1（お知らせ専用）: 投稿権限のない参加者の、お知らせ専用チャンネルへの通常の投稿用のアップロードは 403 で、拒否が audit に残る", async () => {
    const announcement = world.dept.announcementChannelId;
    await insertMember(announcement, world.alice.userId);
    const { response, pulled } = await uploadTracked(
      { kind: "room", roomId: announcement },
      world.alice.token,
      { "Content-Length": "100" },
    );
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("FORBIDDEN");
    expect(pulled).toBe(false);
    expect(auditLines("perm.announcement.post")).toHaveLength(1);
    await nothingStored();
  });
});

describe("#140 AC-1（1-6 AC-9）・AC-2（1-4 AC-5）返信用のアップロード", () => {
  it("#140 AC-2（1-4 AC-5）: 返信用の入口で 201。行の thread_parent_id は親の ID", async () => {
    const parent = await seedParent(world.channel, world.bob.userId, 1);
    const body = await uploadedOk(
      await uploadFile(
        { kind: "reply", parentId: parent },
        "memo.txt",
        TEXT_BYTES,
        world.alice.token,
      ),
    );
    expect(body).toMatchObject({
      name: "memo.txt",
      kind: "document",
      contentType: "text/plain; charset=utf-8",
    });
    expect(await attachmentRow(body.id)).toMatchObject({
      room_id: world.channel,
      thread_parent_id: parent,
      message_id: null,
    });
  });

  it("#140 AC-1（お知らせ専用）: お知らせ専用チャンネルでも、参加者は返信用の入口でアップロードできる（通常の投稿用は 403）", async () => {
    const announcement = world.dept.announcementChannelId;
    await insertMember(announcement, world.alice.userId);
    await insertMember(announcement, world.bob.userId);
    const parent = await seedParent(announcement, world.bob.userId, 2);
    const reply = await uploadFile(
      { kind: "reply", parentId: parent },
      "image.png",
      await buildPng(),
      world.alice.token,
    );
    expect(reply.status).toBe(201);
    const normal = await uploadFile(
      { kind: "room", roomId: announcement },
      "image.png",
      await buildPng(),
      world.alice.token,
    );
    expect(normal.status).toBe(403);
  });

  it("#140 AC-1（1-6 AC-9）: 返信用でも同じ検査をする（拡張子の偽装は 422 で、保存しない）", async () => {
    const parent = await seedParent(world.channel, world.bob.userId, 1);
    const response = await uploadFile(
      { kind: "reply", parentId: parent },
      "photo.jpg",
      await buildPng(),
      world.alice.token,
    );
    expect(response.status).toBe(422);
    await nothingStored();
  });

  it.each([
    ["存在しない親", 404, "missing"],
    ["親が返信（返信への返信）", 404, "reply"],
    ["参加していない非公開チャンネルの親", 404, "private"],
    ["参加していない公開チャンネルの親", 403, "notJoined"],
    ["削除済みの親", 409, "deleted"],
  ] as const)(
    "#140 AC-2（1-4 AC-5）: %sは %i で、本文を読まない",
    async (_label, status, kind) => {
      let parentId: string;
      let token = world.alice.token;
      if (kind === "missing") parentId = "01ZZZZZZZZZZZZZZZZZZZZZZZZ";
      else if (kind === "reply") {
        const parent = await seedParent(world.channel, world.bob.userId, 1);
        parentId = await seedReply(world.channel, parent, world.bob.userId, 2);
      } else if (kind === "private") {
        const secret = await insertChannel({
          name: `${TEST_TAG}添付の返信の非公開`,
          purpose: "normal",
          departmentId: world.dept.id,
          visibility: "private",
        });
        await insertMember(secret, world.bob.userId);
        parentId = await seedParent(secret, world.bob.userId, 3);
      } else if (kind === "notJoined") {
        parentId = await seedParent(world.channel, world.bob.userId, 4);
        token = world.carol.token;
      } else {
        parentId = await seedParent(world.channel, world.bob.userId, 5);
        await markDeleted(parentId, world.bob.userId);
      }
      const { response, pulled } = await uploadTracked(
        { kind: "reply", parentId },
        token,
        { "Content-Length": "100" },
      );
      expect(response.status).toBe(status);
      expect(pulled).toBe(false);
      await nothingStored();
    },
  );
});

describe("#140 AC-1（1-6 AC-6）受信の途中の例外（コードレビュー1回目 軽微4）", () => {
  it("#140 AC-1（1-6 AC-6）: 動画の受信の途中で本文のストリームが例外になると、要求は待ち続けずに失敗の応答で終わり、行も R2 の実体も残らない", async () => {
    // 先頭（4,096 バイト以上）は正しい MP4 として渡し、2回目の読み取りで例外にする
    const head = new Uint8Array(8_192);
    head.set(MP4_BYTES);
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(head);
          else controller.error(new Error("[UNIT_TEST] 受信の途中の切断"));
        },
      },
      { highWaterMark: 0 },
    );
    const response = await rawRequest("POST", uploadPathOf(room), {
      token: world.alice.token,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": "20000",
        "X-File-Name": encodeURIComponent("movie.mp4"),
      },
      body,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(pulls).toBeGreaterThanOrEqual(2);
    await nothingStored();
  });
});

describe("#140 AC-1（1-6 AC-6）D1 の登録の失敗の補償", () => {
  it("#140 AC-1（1-6 AC-6）: R2 に保存した後に D1 の登録が失敗すると、保存した実体を消してから元のエラー（500）を返す。行も実体も残らない", async () => {
    const response = await uploadFile(
      room,
      "image.png",
      await buildPng(),
      world.alice.token,
      { envOverrides: { DB: failingAttachmentInsertDb(env.DB) } },
    );
    expect(response.status).toBe(500);
    await nothingStored();
  });

  it("#140 AC-1（1-6 AC-6）: 実体の削除も失敗したら error ログに残し、元のエラー（500）を返す。ログにファイル名・キーを出さない", async () => {
    const name = "秘密の資料.png";
    const response = await uploadFile(
      room,
      name,
      await buildPng(),
      world.alice.token,
      {
        envOverrides: {
          DB: failingAttachmentInsertDb(env.DB),
          ATTACHMENTS: failingDeleteBucket(bucket()),
        },
      },
    );
    expect(response.status).toBe(500);
    expect(await attachmentTotal()).toBe(0);
    const keys = await storedKeys();
    expect(keys).toHaveLength(1);
    expect(errorLines.length).toBeGreaterThanOrEqual(1);
    const allLogs = [...logLines, ...errorLines].join("\n");
    expect(allLogs).not.toContain(name);
    expect(allLogs).not.toContain(encodeURIComponent(name));
    expect(allLogs).not.toContain(keys[0]);
  });
});

describe("#140 AC-1（1-6 AC-2・AC-7）・AC-3 配信", () => {
  const seedPosted = async (
    roomId: string,
    name: string,
    bytes: Uint8Array,
    kind: "image" | "document" | "video",
    contentType: string,
    n = 1,
  ) => {
    const message = await seedParent(roomId, world.alice.userId, n);
    const id = await seedStoredAttachment(
      {
        roomId,
        uploaderId: world.alice.userId,
        messageId: message,
        originalName: name,
        kind,
        contentType,
      },
      bytes,
    );
    return { id, message };
  };

  it("#140 AC-3: 画像は 200・本文は保存した実体・inline・安全なヘッダー一式", async () => {
    const png = await buildPng();
    const { id } = await seedPosted(
      world.channel,
      "image.png",
      png,
      "image",
      "image/png",
    );
    const response = await downloadAttachment(id, world.bob.token);
    expect(response.status).toBe(200);
    expect(Array.from(await bytesOf(response))).toEqual(Array.from(png));
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="image.png"; filename*=UTF-8''image.png`,
    );
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe(String(png.length));
    for (const [header, value] of Object.entries(FIXED_HEADERS))
      expect(response.headers.get(header), header).toBe(value);
  });

  it.each([
    [
      "PDF",
      "報告書.pdf",
      PDF_BYTES,
      "document",
      "application/pdf",
      "attachment",
    ],
    [
      "テキスト",
      "memo.txt",
      TEXT_BYTES,
      "document",
      "text/plain; charset=utf-8",
      "attachment",
    ],
    ["動画", "movie.mp4", MP4_BYTES, "video", "video/mp4", "inline"],
  ] as const)(
    "#140 AC-3: %sは Content-Type が保存時の判定結果、Content-Disposition が %s の種類どおりで、安全なヘッダーが付く",
    async (_label, name, bytes, kind, contentType, disposition) => {
      const { id } = await seedPosted(
        world.channel,
        name,
        bytes,
        kind,
        contentType,
      );
      const response = await downloadAttachment(id, world.bob.token);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(contentType);
      const header = response.headers.get("content-disposition") ?? "";
      expect(header.startsWith(`${disposition}; filename="`)).toBe(true);
      expect(header).toContain(`filename*=UTF-8''${encodeURIComponent(name)}`);
      for (const [key, value] of Object.entries(FIXED_HEADERS))
        expect(response.headers.get(key), key).toBe(value);
    },
  );

  it("#140 AC-3: docx は attachment で、Content-Type は docx の種類", async () => {
    const docx = await buildOoxml("docx");
    const { id } = await seedPosted(
      world.channel,
      "doc.docx",
      docx,
      "document",
      DOCX,
    );
    const response = await downloadAttachment(id, world.bob.token);
    expect(response.headers.get("content-type")).toBe(DOCX);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("#140 AC-1（1-6 AC-7）: 正しい単一の Range は 206 と Content-Range で、その範囲だけを返す", async () => {
    const { id } = await seedPosted(
      world.channel,
      "movie.mp4",
      MP4_BYTES,
      "video",
      "video/mp4",
    );
    const response = await downloadAttachment(id, world.bob.token, {
      Range: "bytes=4-11",
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes 4-11/${MP4_BYTES.length}`,
    );
    expect(response.headers.get("content-length")).toBe("8");
    expect(Array.from(await bytesOf(response))).toEqual(
      Array.from(MP4_BYTES.slice(4, 12)),
    );
    for (const [key, value] of Object.entries(FIXED_HEADERS))
      expect(response.headers.get(key), key).toBe(value);
  });

  it("#140 AC-1（1-6 AC-7）: 無効な Range（複数の範囲）は無視して 200 で全体を返す", async () => {
    const { id } = await seedPosted(
      world.channel,
      "movie.mp4",
      MP4_BYTES,
      "video",
      "video/mp4",
    );
    const response = await downloadAttachment(id, world.bob.token, {
      Range: "bytes=0-1,4-5",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-range")).toBeNull();
    expect(Array.from(await bytesOf(response))).toEqual(Array.from(MP4_BYTES));
  });

  it("#140 AC-1（1-6 AC-2）: 公開チャンネルの未参加者（carol）も取得できる", async () => {
    const { id } = await seedPosted(
      world.channel,
      "memo.txt",
      TEXT_BYTES,
      "document",
      "text/plain; charset=utf-8",
    );
    expect((await downloadAttachment(id, world.carol.token)).status).toBe(200);
  });

  it("#140 AC-1（1-6 AC-2）: 未投稿の添付は、アップロードした本人は取得でき、ほかの参加者は 404", async () => {
    const id = await seedStoredAttachment(
      { roomId: world.channel, uploaderId: world.alice.userId },
      TEXT_BYTES,
    );
    expect((await downloadAttachment(id, world.alice.token)).status).toBe(200);
    const other = await downloadAttachment(id, world.bob.token);
    expect(other.status).toBe(404);
    expect(await codeOf(other)).toBe("NOT_FOUND");
  });

  it.each([
    ["存在しない添付", "missing"],
    ["メッセージが削除済みの添付", "deleted"],
    ["参加していない非公開チャンネルの添付", "private"],
    ["当事者でない DM の添付", "dm"],
  ] as const)(
    "#140 AC-1（1-6 AC-2）: %sは 404 NOT_FOUND で、ファイルの情報を返さない",
    async (_label, kind) => {
      let id = "01ZZZZZZZZZZZZZZZZZZZZZZZZ";
      let token = world.bob.token;
      if (kind === "deleted") {
        const seeded = await seedPosted(
          world.channel,
          "memo.txt",
          TEXT_BYTES,
          "document",
          "text/plain; charset=utf-8",
        );
        await markDeleted(seeded.message, world.alice.userId);
        id = seeded.id;
      } else if (kind === "private") {
        const secret = await insertChannel({
          name: `${TEST_TAG}添付の配信の非公開`,
          purpose: "normal",
          departmentId: world.dept.id,
          visibility: "private",
        });
        await insertMember(secret, world.alice.userId);
        id = (
          await seedPosted(
            secret,
            "memo.txt",
            TEXT_BYTES,
            "document",
            "text/plain; charset=utf-8",
            2,
          )
        ).id;
      } else if (kind === "dm") {
        const dm = await insertDm(world.alice.userId, world.dave.userId);
        id = (
          await seedPosted(
            dm,
            "memo.txt",
            TEXT_BYTES,
            "document",
            "text/plain; charset=utf-8",
            3,
          )
        ).id;
        token = world.carol.token;
      }
      const response = await downloadAttachment(id, token);
      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe("NOT_FOUND");
      expect(response.headers.get("content-disposition")).toBeNull();
    },
  );

  it("#140 AC-1（1-6 AC-7）: 取得のたびに判定する（取得できた参加者も、非公開チャンネルを抜けた直後は 404）", async () => {
    const secret = await insertChannel({
      name: `${TEST_TAG}添付の毎回の判定`,
      purpose: "normal",
      departmentId: world.dept.id,
      visibility: "private",
    });
    await insertMember(secret, world.alice.userId);
    await insertMember(secret, world.bob.userId);
    const { id } = await seedPosted(
      secret,
      "memo.txt",
      TEXT_BYTES,
      "document",
      "text/plain; charset=utf-8",
    );
    expect((await downloadAttachment(id, world.bob.token)).status).toBe(200);
    await leaveChannel(secret, world.bob.userId);
    expect((await downloadAttachment(id, world.bob.token)).status).toBe(404);
  });

  it("#140 AC-1（同時の操作）: 行はあるが R2 に実体がない（get が null）ときは 404（500 にしない）", async () => {
    const message = await seedParent(world.channel, world.alice.userId, 1);
    const id = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
      messageId: message,
    });
    const response = await downloadAttachment(id, world.bob.token);
    expect(response.status).toBe(404);
  });

  it("#140 AC-1: 未認証は 401", async () => {
    const { id } = await seedPosted(
      world.channel,
      "memo.txt",
      TEXT_BYTES,
      "document",
      "text/plain; charset=utf-8",
    );
    expect((await downloadAttachment(id, null)).status).toBe(401);
  });

  it("#140 AC-1: 添付の ID の形が正しくないと 422", async () => {
    const response = await downloadAttachment("not-a-ulid", world.bob.token);
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe("VALIDATION_ERROR");
  });
});
