// #140 AC-1（1-6 AC-6）: 添付のアップロードの API の呼び方（message-api.ts の uploadAttachment）。API は MSW。データは架空。
// 契約（計画「方式」2・「画面」。このテストが固定する）：
//   uploadAttachment(target, file, { signal? }) → { id, name, kind, contentType, size }
//     target: { kind: "room"; roomId } → POST /api/rooms/:roomId/attachments
//             { kind: "reply"; parentMessageId } → POST /api/messages/:parentMessageId/replies/attachments
//     本文はファイルのバイト列（Content-Type: application/octet-stream）、元の名前は X-File-Name に encodeURIComponent で入れる。
//     既存の axios クライアント（services/api-client）を通し、時間切れは共通の10秒ではなく、この要求だけの長い値にする（100MB を想定）。
//     signal を渡すと、取り消せる（取り消したら失敗として返り、成功の値を返さない）。
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "../../../test/server";
import { apiClient } from "../../../services/api-client";
import { uploadAttachment } from "./message-api";

const ROOM = "01JTESTROOM00000000000R001";
const PARENT = "01JTESTMSG0000000000000001";
const CREATED = {
  id: "01JTESTATT0000000000000001",
  name: "報告書.pdf",
  kind: "document",
  contentType: "application/pdf",
  size: 10,
  // #148（148-B-2）アップロードの応答（UploadedAttachmentItem）に加わる項目。案件でない部屋は null
  publicationVisibility: null,
};

let ejectId: number | null = null;
afterEach(() => {
  if (ejectId !== null) apiClient.interceptors.request.eject(ejectId);
  ejectId = null;
});

describe("#140 AC-1（1-6 AC-6）uploadAttachment", () => {
  it("#140 AC-1: 通常の投稿用の入口に、バイト列と X-File-Name（パーセントエンコード）で送り、応答を返す", async () => {
    const seen: { name: string | null; type: string | null; size: number }[] =
      [];
    server.use(
      http.post(`/api/rooms/${ROOM}/attachments`, async ({ request }) => {
        seen.push({
          name: request.headers.get("X-File-Name"),
          type: request.headers.get("Content-Type"),
          size: (await request.arrayBuffer()).byteLength,
        });
        return HttpResponse.json(CREATED, { status: 201 });
      }),
    );
    const file = new File(["[E2E_TEST]本文"], "報告書.pdf");
    const result = await uploadAttachment({ kind: "room", roomId: ROOM }, file);
    expect(result).toEqual(CREATED);
    expect(seen).toEqual([
      {
        name: encodeURIComponent("報告書.pdf"),
        type: "application/octet-stream",
        size: file.size,
      },
    ]);
  });

  it("#140 AC-2（1-4 AC-5）: 返信用の入口に送る", async () => {
    const paths: string[] = [];
    server.use(
      http.post(
        `/api/messages/${PARENT}/replies/attachments`,
        ({ request }) => {
          paths.push(new URL(request.url).pathname);
          return HttpResponse.json(CREATED, { status: 201 });
        },
      ),
    );
    await uploadAttachment(
      { kind: "reply", parentMessageId: PARENT },
      new File(["x"], "memo.txt"),
    );
    expect(paths).toEqual([`/api/messages/${PARENT}/replies/attachments`]);
  });

  it("#140 AC-1（1-6 AC-6）: 時間切れは共通の10秒（10,000ミリ秒）より長い、この要求だけの値にする", async () => {
    const timeouts: (number | undefined)[] = [];
    ejectId = apiClient.interceptors.request.use((config) => {
      timeouts.push(config.timeout);
      return config;
    });
    server.use(
      http.post(`/api/rooms/${ROOM}/attachments`, () =>
        HttpResponse.json(CREATED, { status: 201 }),
      ),
    );
    await uploadAttachment(
      { kind: "room", roomId: ROOM },
      new File(["x"], "memo.txt"),
    );
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBeGreaterThan(10_000);
    expect(apiClient.defaults.timeout).toBe(10_000);
  });

  it("#140 AC-1: 取り消した signal を渡すと失敗として返る", async () => {
    server.use(
      http.post(`/api/rooms/${ROOM}/attachments`, () =>
        HttpResponse.json(CREATED, { status: 201 }),
      ),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadAttachment(
        { kind: "room", roomId: ROOM },
        new File(["x"], "memo.txt"),
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });
});
