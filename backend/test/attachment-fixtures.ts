// #140 のテストで使う、添付（message_attachments・R2 の ATTACHMENTS）の架空のテストデータの作成・読み取り・要求・後始末（識別子で消す）。
// 識別子：利用者は testuser_ で始め、部署名・チャンネル名・本文は [UNIT_TEST] を付ける。値はすべて架空のもの。
// 表の形は計画（#140「DB の変更」）：message_attachments(id, room_id, thread_parent_id, message_id, uploader_id, storage_key, original_name,
//   kind, content_type, size_bytes, created_at)。migration 0023。
// R2 は vitest-pool-workers（Miniflare）の手元の保存先だけを使う。本物のバケットには接続しない（wrangler.jsonc の r2_buckets の binding "ATTACHMENTS"）。
// このファイルは、まだない本番のコード（添付の Service・Repository）を読み込まない。読み込むと、これを使う既存のテストまで壊れるため。
import { env } from "cloudflare:workers";
import { API_ORIGIN } from "./api-request";
import {
  AUTH_TRACE_PREFIX,
  SESSION_COOKIE,
  TEST_IP,
  newThrottleKey,
} from "./auth-fixtures";
import { newPiiKey, newSetupToken } from "./random-secrets";
import { ulidAtMs } from "./read-position-fixtures";
import {
  TEST_TAG,
  cleanupReactionScenario,
  createThreadWorld,
  type ThreadWorld,
} from "./reaction-fixtures";
import { app } from "../src/index";

export { TEST_TAG, createThreadWorld };
export type { ThreadWorld };

/** テストの中で R2 に入った添付の実体のキーの接頭辞（計画：attachments/<ULID>） */
export const STORAGE_PREFIX = "attachments/";

/** 本番と同じ binding 名の R2（手元の Miniflare） */
export const bucket = () =>
  (env as unknown as { ATTACHMENTS: R2Bucket }).ATTACHMENTS;

const throttleKey = newThrottleKey();

/** 要求の env（必要なら DB・ATTACHMENTS を差し替えて、失敗を注入する） */
export function requestEnv(overrides: Record<string, unknown> = {}) {
  return {
    ...env,
    LOGIN_THROTTLE_KEY: throttleKey,
    SETUP_TOKEN: newSetupToken(),
    PII_ENCRYPTION_KEY: newPiiKey(),
    ...overrides,
  } as unknown as Env;
}

/** ヘッダー・本文を自由に指定できる要求（アップロードは JSON ではなくバイト列のため） */
export function rawRequest(
  method: string,
  path: string,
  options: {
    token?: string | null;
    headers?: Record<string, string>;
    body?: BodyInit | null;
    envOverrides?: Record<string, unknown>;
  } = {},
) {
  const headers: Record<string, string> = {
    Origin: API_ORIGIN,
    "CF-Connecting-IP": TEST_IP,
    "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
    ...options.headers,
  };
  if (options.token) headers.Cookie = `${SESSION_COOKIE}=${options.token}`;
  return app.request(
    path,
    { method, headers, body: options.body ?? undefined },
    requestEnv(options.envOverrides),
  );
}

// ---- アップロード・配信の API ----

export const roomUploadPath = (roomId: string) =>
  `/api/rooms/${roomId}/attachments`;
export const replyUploadPath = (parentId: string) =>
  `/api/messages/${parentId}/replies/attachments`;
export const attachmentPath = (attachmentId: string) =>
  `/api/attachments/${attachmentId}`;

export type UploadTarget =
  { kind: "room"; roomId: string } | { kind: "reply"; parentId: string };

export const uploadPathOf = (target: UploadTarget) =>
  target.kind === "room"
    ? roomUploadPath(target.roomId)
    : replyUploadPath(target.parentId);

/**
 * 添付を1件アップロードする（本文はバイト列そのまま。元の名前は X-File-Name に UTF-8 のパーセントエンコードで入れる。Content-Length は実際の長さ）。
 * headers で上書きできる（Content-Length を偽る・消すときは headers に入れる）。
 */
export function uploadFile(
  target: UploadTarget,
  name: string,
  bytes: Uint8Array,
  token: string | null,
  options: {
    headers?: Record<string, string>;
    omit?: readonly string[];
    envOverrides?: Record<string, unknown>;
  } = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(bytes.length),
    "X-File-Name": encodeURIComponent(name),
    ...options.headers,
  };
  for (const key of options.omit ?? []) delete headers[key];
  return rawRequest("POST", uploadPathOf(target), {
    token,
    headers,
    body: new Uint8Array(bytes),
    ...(options.envOverrides === undefined
      ? {}
      : { envOverrides: options.envOverrides }),
  });
}

export type UploadedAttachment = {
  id: string;
  name: string;
  kind: "image" | "document" | "video";
  contentType: string;
  size: number;
};

/** 201 を確かめて、本文（{ id, name, kind, contentType, size }）を返す */
export async function uploadedOk(response: Response) {
  if (response.status !== 201)
    throw new Error(
      `アップロードの応答が ${response.status} でした：${await response.text()}`,
    );
  return (await response.json()) as UploadedAttachment;
}

export function downloadAttachment(
  attachmentId: string,
  token: string | null,
  headers: Record<string, string> = {},
) {
  return rawRequest("GET", attachmentPath(attachmentId), { token, headers });
}

// ---- 状態の作成・読み取り ----

export type AttachmentRow = {
  id: string;
  room_id: string;
  thread_parent_id: string | null;
  message_id: string | null;
  uploader_id: string;
  storage_key: string;
  original_name: string;
  kind: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
};

let rowCounter = 0;

/** 未投稿などの添付の行を直接入れる（API・Repository を通さない）。R2 の実体は putObject で別に入れる */
export async function insertAttachmentRow(seed: {
  id?: string;
  roomId: string;
  uploaderId: string;
  threadParentId?: string | null;
  messageId?: string | null;
  storageKey?: string;
  originalName?: string;
  kind?: "image" | "document" | "video";
  contentType?: string;
  sizeBytes?: number;
  createdAt?: string;
}): Promise<string> {
  rowCounter += 1;
  const id = seed.id ?? ulidAtMs(Date.now() + rowCounter);
  await env.DB.prepare(
    `INSERT INTO message_attachments (id, room_id, thread_parent_id, message_id, uploader_id, storage_key, original_name, kind, content_type, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      seed.roomId,
      seed.threadParentId ?? null,
      seed.messageId ?? null,
      seed.uploaderId,
      seed.storageKey ?? `${STORAGE_PREFIX}${id}`,
      seed.originalName ?? "test.txt",
      seed.kind ?? "document",
      seed.contentType ?? "text/plain; charset=utf-8",
      seed.sizeBytes ?? 10,
      seed.createdAt ?? new Date().toISOString(),
    )
    .run();
  return id;
}

export async function attachmentRow(id: string) {
  return env.DB.prepare(
    "SELECT id, room_id, thread_parent_id, message_id, uploader_id, storage_key, original_name, kind, content_type, size_bytes, created_at FROM message_attachments WHERE id = ?",
  )
    .bind(id)
    .first<AttachmentRow>();
}

/** 1つのメッセージに結び付いた添付の ID（ID 昇順） */
export async function attachmentIdsOf(messageId: string) {
  const { results } = await env.DB.prepare(
    "SELECT id FROM message_attachments WHERE message_id = ? ORDER BY id",
  )
    .bind(messageId)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

export async function attachmentTotal(): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM message_attachments",
  ).first<{ n: number }>();
  if (row === null)
    throw new Error("message_attachments の件数を読めませんでした");
  return row.n;
}

/** R2 に実体を直接入れる */
export async function putObject(key: string, bytes: Uint8Array) {
  await bucket().put(key, bytes);
}

/** 手元の R2 の、添付の接頭辞のキーの一覧 */
export async function storedKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const listed = await bucket().list({
      prefix: STORAGE_PREFIX,
      ...(cursor === undefined ? {} : { cursor }),
    });
    keys.push(...listed.objects.map((object) => object.key));
    if (!listed.truncated) return keys.sort();
    cursor = listed.cursor;
  }
}

/** 行を入れ、同じキーで R2 に実体も入れる。ID を返す */
export async function seedStoredAttachment(
  seed: Parameters<typeof insertAttachmentRow>[0],
  bytes: Uint8Array,
): Promise<string> {
  const id = await insertAttachmentRow({ ...seed, sizeBytes: bytes.length });
  const row = await attachmentRow(id);
  if (row === null) throw new Error("添付の行を入れられませんでした");
  await putObject(row.storage_key, bytes);
  return id;
}

/** 応答の本文をバイト列で読む */
export async function bytesOf(response: Response) {
  return new Uint8Array(await response.arrayBuffer());
}

/** 本文を少しずつ流し、読まれたかを記録するストリーム（本文を読む前に拒否することの確認用） */
export function trackedBody(bytes: Uint8Array) {
  const state = { pulled: false };
  // highWaterMark を0にして、作っただけでは pull が呼ばれない（先読みしない）ようにする
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulled = true;
        controller.enqueue(bytes);
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

// ---- 失敗の注入 ----

/**
 * DB を包み、message_attachments への INSERT だけを失敗させる（D1 の登録の失敗の注入）。ほかの文は本物に流す。
 */
export function failingAttachmentInsertDb(real: D1Database): D1Database {
  const failing = /insert\s+into\s+["`]?message_attachments/i;
  return new Proxy(real, {
    get(target, property, receiver) {
      if (property === "prepare")
        return (query: string) => {
          if (failing.test(query))
            throw new Error("[UNIT_TEST] 注入した D1 の失敗");
          return target.prepare(query);
        };
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** R2 を包み、delete だけを失敗させる。put・get・list は本物に流す */
export function failingDeleteBucket(real: R2Bucket): R2Bucket {
  return new Proxy(real, {
    get(target, property, receiver) {
      if (property === "delete")
        return async () => {
          throw new Error("[UNIT_TEST] 注入した R2 の削除の失敗");
        };
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** R2 を包み、put だけを失敗させる（受け取ったストリームは読まない）。ほかは本物に流す */
export function failingPutBucket(real: R2Bucket): R2Bucket {
  return new Proxy(real, {
    get(target, property, receiver) {
      if (property === "put")
        return async () => {
          throw new Error("[UNIT_TEST] 注入した R2 の保存の失敗");
        };
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// ---- 後始末 ----

const TEST_USERS =
  "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";

/**
 * message_attachments を先に消し、その後、リアクション・スレッド・メッセージ・DM・チャンネル・部署・利用者を消す（cleanupReactionScenario）。
 * 外部キーの都合：添付は利用者・部屋・メッセージを指すため、それらより先に消す。
 * R2：手元の Miniflare の保存先にある、添付の接頭辞（attachments/）の実体を消す（テスト用の保存先だけ）。
 */
export async function cleanupAttachmentScenario() {
  const tagged = `${TEST_TAG}%`;
  try {
    const keys = await storedKeys();
    if (keys.length > 0) await bucket().delete(keys);
  } finally {
    try {
      await env.DB.prepare(
        `DELETE FROM message_attachments WHERE uploader_id IN (${TEST_USERS})
           OR room_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE name LIKE ?1) OR name LIKE ?1)
           OR message_id IN (SELECT id FROM messages WHERE sender_id IN (${TEST_USERS}))`,
      )
        .bind(tagged)
        .run();
    } finally {
      await cleanupReactionScenario();
    }
  }
}
