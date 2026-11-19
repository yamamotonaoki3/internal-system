// #148（148-B-2）5-2 AC-8・計画 6.3・6.8：アップロードの通信（uploadAttachment）の公開範囲。API は MSW。データは架空。
// 契約（実装の担当へ。テストが決めたもの）：
//   uploadAttachment(target, file, { signal?, publicationVisibility? })：値があるときだけクエリ ?publicationVisibility= を付ける。
//   応答は uploadedAttachmentSchema（id・name・kind・contentType・size・publicationVisibility〔2値か null〕）で検証する。
//   メッセージの表示の添付（roomMessageSchema の attachments）は変わらない（公開範囲を持たない）。
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { message } from "../../../test/message-handlers";
import { server } from "../../../test/server";
import { roomMessageSchema, uploadAttachment } from "./message-api";

const ROOM = "01JTESTROOM00000000000R001";
const PARENT = "01JTESTMSG0000000000000001";
const base = {
  id: "01JTESTATT0000000000000001",
  name: "memo148.txt",
  kind: "document",
  contentType: "text/plain; charset=utf-8",
  size: 10,
};
const file = () => new File(["[E2E_TEST]"], "memo148.txt");

function capture(path: string, body: Record<string, unknown>) {
  const queries: (string | null)[] = [];
  server.use(
    http.post(path, ({ request }) => {
      queries.push(
        new URL(request.url).searchParams.get("publicationVisibility"),
      );
      return HttpResponse.json(body, { status: 201 });
    }),
  );
  return queries;
}

describe("#148 AC-8 uploadAttachment の公開範囲", () => {
  it("#148 AC-8: 値を渡すと、部屋・返信の入口のクエリに付き、応答の値を返す", async () => {
    const room = capture(`/api/rooms/${ROOM}/attachments`, {
      ...base,
      publicationVisibility: "public_archive",
    });
    const reply = capture(`/api/messages/${PARENT}/replies/attachments`, {
      ...base,
      publicationVisibility: "participants_only",
    });
    const r1 = await uploadAttachment({ kind: "room", roomId: ROOM }, file(), {
      publicationVisibility: "public_archive",
    });
    const r2 = await uploadAttachment(
      { kind: "reply", parentMessageId: PARENT },
      file(),
      { publicationVisibility: "participants_only" },
    );
    expect(room).toEqual(["public_archive"]);
    expect(reply).toEqual(["participants_only"]);
    expect(r1).toEqual({ ...base, publicationVisibility: "public_archive" });
    expect(r2).toMatchObject({ publicationVisibility: "participants_only" });
  });

  it("#148 AC-8: 値を渡さなければクエリを付けず、応答の null を受け付ける", async () => {
    const room = capture(`/api/rooms/${ROOM}/attachments`, {
      ...base,
      publicationVisibility: null,
    });
    const result = await uploadAttachment(
      { kind: "room", roomId: ROOM },
      file(),
    );
    expect(room).toEqual([null]);
    expect(result).toEqual({ ...base, publicationVisibility: null });
  });

  it.each([
    ["公開範囲がない", base],
    ["一覧にない値", { ...base, publicationVisibility: "public" }],
  ])("#148 AC-8: 応答が契約と違う（%s）なら失敗にする", async (_l, body) => {
    capture(`/api/rooms/${ROOM}/attachments`, body);
    await expect(
      uploadAttachment({ kind: "room", roomId: ROOM }, file()),
    ).rejects.toBeTruthy();
  });

  it("#148 AC-8 計画 15章: メッセージの表示の添付は、公開範囲なしで従来どおり検証できる", () => {
    const parsed = roomMessageSchema.safeParse(
      message(1, { attachments: [base as never] }),
    );
    expect(parsed.success).toBe(true);
  });
});
