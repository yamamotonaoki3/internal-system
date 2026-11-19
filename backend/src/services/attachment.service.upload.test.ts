// #140 AC-1（1-6 AC-1・AC-5・AC-6）: 添付のアップロードの Service（createAttachmentService の uploadToRoom）の、受信・検査・保存の分岐を、
// 本物の DB・手元の R2（必要なら包んで失敗を注入）と偽の authorizer で確かめる（ミューテーションの絞った再診断への対応）。
// 期待（計画「方式」2・3、設計書 docs/design/attachments.md）：
//   - Content-Length は正の安全な整数だけ。違えば VALIDATION_ERROR・fields ["Content-Length"]。名前の誤りは fields ["X-File-Name"]、形式の誤りは fields ["file"]。
//   - 先頭の検査は通るが Exif の除去で壊れた画像と分かるものは、「画像を読み取れませんでした」（fields ["file"]）で、保存しない（位置情報を除けなかった画像を残さない）。
//   - 動画：受信が Content-Length と1バイトでも違えば「ファイルを最後まで受け取れませんでした」（fields ["Content-Length"]）。先頭の検査の段階で分かれば、保存を始めない。
//   - 受信の失敗・保存（put）の失敗は、その元のエラーで失敗し（長さの誤りにすり替えない）、行も実体も残さない。
// データは架空（testuser_attup_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MP4_BYTES,
  TEXT_BYTES,
  buildJpeg,
  buildPng,
  buildWebp,
} from "../../test/attachment-files";
import {
  attachmentTotal,
  bucket,
  cleanupAttachmentScenario,
  createThreadWorld,
  failingPutBucket,
  storedKeys,
  type ThreadWorld,
} from "../../test/attachment-fixtures";
import { fakeAuthorizer } from "../../test/dm-fixtures";
import { modifyTraceId } from "../../test/message-modify-fixtures";
import { createAttachmentService } from "./attachment.service";

let world: ThreadWorld;

type Failure = {
  code?: string;
  userMessage?: string;
  message?: string;
  details?: { fields?: unknown };
};

/** put の回数を数え、必要なら put を差し替える R2 */
function bucketWith(
  put?: (key: string, value: ReadableStream | Uint8Array) => Promise<never>,
) {
  const counter = { puts: 0 };
  const real = bucket();
  const wrapped = new Proxy(real, {
    get(target, property, receiver) {
      if (property === "put")
        return (key: string, value: ReadableStream | Uint8Array) => {
          counter.puts += 1;
          return put === undefined ? target.put(key, value) : put(key, value);
        };
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { counter, bucket: wrapped };
}

/** 決まったかたまりを順に渡し、errorAt 番目の読み取りで例外にするストリーム */
function chunked(chunks: readonly Uint8Array[], errorAt?: number) {
  let index = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (index === errorAt) {
          controller.error(new Error("[UNIT_TEST] 受信の途中の切断"));
          return;
        }
        const next = chunks[index];
        index += 1;
        if (next === undefined) controller.close();
        else controller.enqueue(next);
      },
    },
    { highWaterMark: 0 },
  );
}

async function upload(
  name: string,
  contentLength: number | null,
  body: ReadableStream<Uint8Array> | null,
  attachments: R2Bucket = bucket(),
): Promise<{ error: Failure | null; result: unknown }> {
  const service = createAttachmentService(
    { ...env, ATTACHMENTS: attachments } as unknown as Env,
    { authorizer: fakeAuthorizer([]) as never },
  );
  try {
    const result = await service.uploadToRoom(
      { userId: world.alice.userId, traceId: modifyTraceId() },
      world.channel,
      // #148（148-B-2）公開範囲の指定（クエリ）なし＝既定の参加者限定
      { name, contentLength, body, publicationVisibility: undefined },
    );
    return { error: null, result };
  } catch (error) {
    return { error: error as Failure, result: null };
  }
}

const bytesOf = (bytes: Uint8Array) => chunked([bytes]);

const nothingStored = async () => {
  expect(await attachmentTotal()).toBe(0);
  expect(await storedKeys()).toEqual([]);
};

const LENGTH_MESSAGE = "ファイルを最後まで受け取れませんでした";
const UNSUPPORTED_MESSAGE = "このファイルの形式は添付できません";

/** 先頭の検査（4,096 バイト）より長い、先頭が MP4 の本文 */
const longVideo = (length: number) => {
  const bytes = new Uint8Array(length);
  bytes.set(MP4_BYTES);
  return bytes;
};

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("attup");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAttachmentScenario();
});

describe("#140 AC-1（1-6 AC-3・AC-6）入力の検証（fields）", () => {
  it.each([
    ["null", null],
    ["小数", 1.5],
    ["NaN", Number.NaN],
    ["0", 0],
    ["負", -1],
  ])(
    '#140 AC-1（1-6 AC-6）: Content-Length が%sなら VALIDATION_ERROR・fields ["Content-Length"] で、保存しない',
    async (_label, length) => {
      const { counter, bucket: wrapped } = bucketWith();
      const { error } = await upload(
        "memo.txt",
        length,
        bytesOf(TEXT_BYTES),
        wrapped,
      );
      expect(error?.code).toBe("VALIDATION_ERROR");
      expect(error?.details?.fields).toEqual(["Content-Length"]);
      expect(counter.puts).toBe(0);
      await nothingStored();
    },
  );

  it('#140 AC-1（1-6 AC-3）: 名前の誤りは fields ["X-File-Name"]', async () => {
    const { error } = await upload('a"b.txt', 10, bytesOf(TEXT_BYTES));
    expect(error?.code).toBe("VALIDATION_ERROR");
    expect(error?.details?.fields).toEqual(["X-File-Name"]);
  });

  it('#140 AC-1（1-6 AC-1）: 上限を超える Content-Length は fields ["Content-Length"]', async () => {
    const { error } = await upload("image.png", 10_000_001, null);
    expect(error?.code).toBe("VALIDATION_ERROR");
    expect(error?.details?.fields).toEqual(["Content-Length"]);
  });

  it("#140 AC-1（1-6 AC-6）: 画像・文書で本文がない（null）と「ファイルを最後まで受け取れませんでした」", async () => {
    const { error } = await upload("memo.txt", TEXT_BYTES.length, null);
    expect(error?.code).toBe("VALIDATION_ERROR");
    expect(error?.userMessage).toBe(LENGTH_MESSAGE);
    await nothingStored();
  });

  it("#140 AC-1（1-6 AC-6）: 動画で本文がない（null）と「ファイルを最後まで受け取れませんでした」で、保存を始めない", async () => {
    const { counter, bucket: wrapped } = bucketWith();
    const { error } = await upload("movie.mp4", 5_000, null, wrapped);
    expect(error?.userMessage).toBe(LENGTH_MESSAGE);
    expect(counter.puts).toBe(0);
  });
});

describe("#140 AC-1（1-6 AC-5）形式の検査と画像の読み取り", () => {
  it('#140 AC-1（1-6 AC-5）: 画像の拡張子で中身が違う（PNG を .jpg）と fields ["file"]・「このファイルの形式は添付できません」で、保存しない', async () => {
    const png = await buildPng();
    const { counter, bucket: wrapped } = bucketWith();
    const { error } = await upload(
      "photo.jpg",
      png.length,
      bytesOf(png),
      wrapped,
    );
    expect(error?.code).toBe("VALIDATION_ERROR");
    expect(error?.userMessage).toBe(UNSUPPORTED_MESSAGE);
    expect(error?.details?.fields).toEqual(["file"]);
    expect(counter.puts).toBe(0);
  });

  it("#140 AC-1（1-6 AC-5）: 動画の拡張子で中身が画像（PNG を .mp4）だと「このファイルの形式は添付できません」で、保存を始めない", async () => {
    const png = await buildPng();
    const { counter, bucket: wrapped } = bucketWith();
    const { error } = await upload(
      "movie.mp4",
      png.length,
      bytesOf(png),
      wrapped,
    );
    expect(error?.userMessage).toBe(UNSUPPORTED_MESSAGE);
    expect(counter.puts).toBe(0);
    await nothingStored();
  });

  it.each([
    [
      "JPEG（セグメントの長さが残りを超える）",
      "photo.jpg",
      async () => {
        const jpeg = buildJpeg({ exif: true });
        return jpeg.slice(0, 12);
      },
    ],
    [
      "PNG（IEND の長さが残りを超える）",
      "image.png",
      async () => {
        const png = (await buildPng()).slice();
        png.set([0, 0, 0, 1], png.length - 12);
        return png;
      },
    ],
    [
      "WebP（RIFF のサイズが実際より大きい）",
      "pic.webp",
      async () => {
        const webp = buildWebp().slice();
        new DataView(webp.buffer).setUint32(4, webp.length - 8 + 2, true);
        return webp;
      },
    ],
  ])(
    '#140 AC-1: 先頭の検査は通るが %s の除去で壊れていると分かる画像は「画像を読み取れませんでした」・fields ["file"] で、保存しない',
    async (_label, name, make) => {
      const bytes = await make();
      const { counter, bucket: wrapped } = bucketWith();
      const { error } = await upload(
        name,
        bytes.length,
        bytesOf(bytes),
        wrapped,
      );
      expect(error?.code).toBe("VALIDATION_ERROR");
      expect(error?.userMessage).toBe("画像を読み取れませんでした");
      expect(error?.details?.fields).toEqual(["file"]);
      expect(counter.puts).toBe(0);
      await nothingStored();
    },
  );
});

describe("#140 AC-1（1-6 AC-6）動画の受信量", () => {
  it("#140 AC-1（1-6 AC-6）: 先頭の検査に必要な長さに届かないまま本文が終わり、Content-Length にも1バイト足りないと、保存を始めずに長さの誤り", async () => {
    const { counter, bucket: wrapped } = bucketWith();
    const { error } = await upload(
      "movie.mp4",
      MP4_BYTES.length + 1,
      bytesOf(MP4_BYTES),
      wrapped,
    );
    expect(error?.userMessage).toBe(LENGTH_MESSAGE);
    expect(error?.details?.fields).toEqual(["Content-Length"]);
    expect(counter.puts).toBe(0);
    await nothingStored();
  });

  it("#140 AC-1（1-6 AC-6）: 先頭の読み取りの段階で Content-Length より1バイト多く届くと、保存を始めずに長さの誤り", async () => {
    const { counter, bucket: wrapped } = bucketWith();
    const { error } = await upload(
      "movie.mp4",
      4_500,
      bytesOf(longVideo(4_501)),
      wrapped,
    );
    expect(error?.userMessage).toBe(LENGTH_MESSAGE);
    expect(counter.puts).toBe(0);
    await nothingStored();
  });

  it("#140 AC-1（1-6 AC-6）: 先頭の検査より長い本文が Content-Length ちょうどなら保存し、受け取った長さを返す", async () => {
    const bytes = longVideo(6_000);
    const { error, result } = await upload(
      "movie.mp4",
      bytes.length,
      chunked([bytes.slice(0, 4_096), bytes.slice(4_096)]),
    );
    expect(error).toBeNull();
    expect(result).toMatchObject({ kind: "video", size: 6_000 });
    expect(await storedKeys()).toHaveLength(1);
  });

  it("#140 AC-1（1-6 AC-6）: 先頭の後の受信で Content-Length を1バイト超えると、そこで打ち切って長さの誤りにし、行も実体も残さない", async () => {
    const bytes = longVideo(6_001);
    const { error } = await upload(
      "movie.mp4",
      6_000,
      chunked([
        bytes.slice(0, 4_096),
        bytes.slice(4_096, 6_000),
        bytes.slice(6_000),
      ]),
    );
    expect(error?.code).toBe("VALIDATION_ERROR");
    expect(error?.userMessage).toBe(LENGTH_MESSAGE);
    await nothingStored();
  });

  it("#140 AC-1（1-6 AC-6）: 先頭の後の受信が Content-Length に1バイト足りないと、長さの誤りにし、行も実体も残さない", async () => {
    const bytes = longVideo(5_999);
    const { error } = await upload(
      "movie.mp4",
      6_000,
      chunked([bytes.slice(0, 4_096), bytes.slice(4_096)]),
    );
    expect(error?.userMessage).toBe(LENGTH_MESSAGE);
    await nothingStored();
  });
});

describe("#140 AC-1（1-6 AC-6）受信と保存の失敗", () => {
  it("#140 AC-1（1-6 AC-6）: 先頭の後の受信が例外になると、その元のエラーで失敗し（長さの誤りにしない）、行も実体も残さない", async () => {
    const bytes = longVideo(8_000);
    const { error } = await upload(
      "movie.mp4",
      bytes.length,
      chunked([bytes.slice(0, 4_096), bytes.slice(4_096)], 1),
    );
    expect(error?.code).toBeUndefined();
    expect(error?.message).toContain("[UNIT_TEST] 受信の途中の切断");
    await nothingStored();
  });

  it("#140 AC-1（1-6 AC-6）: 保存（put）がすぐ失敗すると、その元のエラーで失敗し（長さの誤りにしない）、受信を止めて、行も実体も残さない", async () => {
    const bytes = longVideo(8_000);
    let cancelled = false;
    let index = 0;
    const parts = [bytes.slice(0, 4_096), bytes.slice(4_096)];
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const next = parts[index];
          index += 1;
          if (next === undefined) return new Promise<void>(() => {}); // 止められるまで届かない
          controller.enqueue(next);
          return undefined;
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const { error } = await upload(
      "movie.mp4",
      bytes.length + 10,
      body,
      failingPutBucket(bucket()),
    );
    expect(error?.code).toBeUndefined();
    expect(error?.message).toContain("[UNIT_TEST] 注入した R2 の保存の失敗");
    expect(cancelled).toBe(true);
    await nothingStored();
  });

  it("#140 AC-1（1-6 AC-6）: 受信が最後まで終わった後に保存（put）が失敗しても、成功にせず元のエラーで失敗し、行も実体も残さない", async () => {
    const bytes = longVideo(6_000);
    const { bucket: wrapped } = bucketWith(async (_key, value) => {
      // 受け取ったストリームを最後まで読んでから失敗する
      if (value instanceof ReadableStream)
        await new Response(value).arrayBuffer();
      throw new Error("[UNIT_TEST] 読み終えた後の保存の失敗");
    });
    const { error, result } = await upload(
      "movie.mp4",
      bytes.length,
      chunked([bytes.slice(0, 4_096), bytes.slice(4_096)]),
      wrapped,
    );
    expect(result).toBeNull();
    expect(error?.message).toContain("[UNIT_TEST] 読み終えた後の保存の失敗");
    await nothingStored();
  });
});
