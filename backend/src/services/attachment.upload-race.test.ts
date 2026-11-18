// #148（148-A）5-2 AC-2・5-1 AC-11・計画「レビュー1回目への対応」重大1：添付のアップロードで、事前の確認（Service）を通った後、
// ファイルの受信中に資格を失ったとき、未投稿の添付の行が登録されず、R2 に保存した実体が後始末され、応答が 404／403／409 になることを確かめる。
// 挟み方：アップロードの本文を、読み出されたとき（＝事前の確認の後、R2 への保存の最中）に状態を変えてから中身を流すストリームにする。
//   状態の変え方：案件の終了（cases.status='closed'）・参加の解除（channel_members の行を消す）・無効化（users.is_active=0）。
//   挟めたことは、ストリームが読み出されたこと（pulled）で確かめる。
// 部屋への添付（POST /api/rooms/:roomId/attachments）と、返信への添付（POST /api/messages/:parentId/replies/attachments）の両方で確かめる。
// 退行なし：通常のチャンネル・DM のアップロードは、有効な利用者ならこれまでどおり 201。通常のチャンネル・DM でも、受信中に資格を失えば登録されない。
// 期待する応答（計画 148-A「差の表」の添付のアップロード：資格と状態を最初と同じ順で読み直す）：
//   案件の部屋：終了 → 409、参加の解除・無効化 → 404（非公開の部屋なので、非参加者には見えない）
//   通常の公開チャンネル：アーカイブ → 404、参加の解除 → 403（公開なので見えるが未参加）
//   DM：相手の無効化 → 409（既存の「相手が無効」の扱い）
// 本物の外部 API は呼ばない（R2 は Miniflare の手元の保存先）。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  rawRequest,
  replyUploadPath,
  roomUploadPath,
  storedKeys,
  uploadFile,
} from "../../test/attachment-fixtures";
import { ascii } from "../../test/attachment-files";
import {
  CASE_CLOSED_MESSAGES,
  attachmentCountIn,
  cleanupCaseRoomWorld,
  insertCaseWorldDm,
  seedRoomMessage,
  setCaseStatus,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { removeCaseMember } from "../../test/case-fixtures";
import {
  removeOwner,
  setDepartmentActive,
  setUserActive,
} from "../../test/case-request-fixtures";
import { archiveChannel } from "../../test/message-modify-fixtures";

const TEXT = ascii("[UNIT_TEST]148 memo");

let cw: CaseRoomWorld;

/** 読み出されたときに interrupt を実行してから中身を流す本文 */
function interruptingBody(interrupt: () => Promise<void>) {
  const state = { pulled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        state.pulled = true;
        await interrupt();
        controller.enqueue(TEXT);
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

async function uploadWhile(
  path: string,
  token: string,
  interrupt: () => Promise<void>,
) {
  const { stream, state } = interruptingBody(interrupt);
  const response = await rawRequest("POST", path, {
    token,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(TEXT.length),
      "X-File-Name": encodeURIComponent("memo148.txt"),
    },
    body: stream,
  });
  return { response, pulled: state.pulled };
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1530);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 5-1 AC-11 受信中に案件が終了・参加の解除・無効化（案件の部屋）", () => {
  type Case = {
    label: string;
    target: "room" | "reply";
    interrupt: (cw: CaseRoomWorld) => Promise<void>;
    status: number;
    code: string;
    message?: string;
  };
  const cases: Case[] = [];
  for (const target of ["room", "reply"] as const) {
    cases.push(
      {
        label: `${target === "room" ? "部屋" : "返信"}への添付：案件の終了は 409`,
        target,
        interrupt: (c) => setCaseStatus(c.open.id, "closed"),
        status: 409,
        code: "CONFLICT",
        message: CASE_CLOSED_MESSAGES.upload,
      },
      {
        label: `${target === "room" ? "部屋" : "返信"}への添付：参加の解除は 404`,
        target,
        interrupt: (c) => removeCaseMember(c.open.roomId, c.w.memberS1.id),
        status: 404,
        code: "NOT_FOUND",
      },
      {
        label: `${target === "room" ? "部屋" : "返信"}への添付：無効化は 404`,
        target,
        interrupt: (c) => setUserActive(c.w.memberS1.id, false),
        status: 404,
        code: "NOT_FOUND",
      },
    );
  }

  it.each(cases)(
    "#148 5-2 AC-2・5-1 AC-11: $label で、行が登録されず、R2 の実体も残らない",
    async ({ target, interrupt, status, code, message }) => {
      const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 1);
      const path =
        target === "room"
          ? roomUploadPath(cw.open.roomId)
          : replyUploadPath(parent);
      const { response, pulled } = await uploadWhile(
        path,
        cw.w.memberS1.token,
        () => interrupt(cw),
      );
      expect(pulled).toBe(true);
      expect(response.status).toBe(status);
      const body = (await response.json()) as { code: string; message: string };
      expect(body.code).toBe(code);
      if (message !== undefined) expect(body.message).toBe(message);
      expect(await attachmentCountIn(cw.open.roomId)).toBe(0);
      expect(await storedKeys()).toEqual([]);
    },
  );
});

describe("#148 退行なし：通常のチャンネル・DM のアップロード", () => {
  it("#148 退行なし: 有効な参加者は、通常のチャンネル・DM に、これまでどおりアップロードできる（201）", async () => {
    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    const toChannel = await uploadFile(
      { kind: "room", roomId: cw.normal },
      "memo148.txt",
      TEXT,
      cw.w.memberS1.token,
    );
    const toDm = await uploadFile(
      { kind: "room", roomId: dm },
      "memo148.txt",
      TEXT,
      cw.w.memberS1.token,
    );
    expect([toChannel.status, toDm.status]).toEqual([201, 201]);
    expect(await attachmentCountIn(cw.normal)).toBe(1);
    expect(await attachmentCountIn(dm)).toBe(1);
  });

  it("#148 退行なし: 進行中の案件の部屋にも、有効な参加者はアップロードできる（201）", async () => {
    const response = await uploadFile(
      { kind: "room", roomId: cw.open.roomId },
      "memo148.txt",
      TEXT,
      cw.w.memberS1.token,
    );
    expect(response.status).toBe(201);
  });

  it("#148 重大1: 通常のチャンネルで、受信中にアーカイブされると 404、参加を解除されると 403 で、どちらも登録されない", async () => {
    const archived = await uploadWhile(
      roomUploadPath(cw.normal),
      cw.w.memberS1.token,
      () => archiveChannel(cw.normal),
    );
    expect(archived.pulled).toBe(true);
    expect(archived.response.status).toBe(404);
    await cleanupArchive(cw.normal);
    const left = await uploadWhile(
      roomUploadPath(cw.normal),
      cw.w.memberD1.token,
      () => removeCaseMember(cw.normal, cw.w.memberD1.id),
    );
    expect(left.pulled).toBe(true);
    expect(left.response.status).toBe(403);
    expect(await attachmentCountIn(cw.normal)).toBe(0);
    expect(await storedKeys()).toEqual([]);
  });

  it("#148 重大1: DM で、受信中に相手が無効になると 409 で、登録されない", async () => {
    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    const { response, pulled } = await uploadWhile(
      roomUploadPath(dm),
      cw.w.memberS1.token,
      () => setUserActive(cw.w.memberD1.id, false),
    );
    expect(pulled).toBe(true);
    expect(response.status).toBe(409);
    expect(await attachmentCountIn(dm)).toBe(0);
    expect(await storedKeys()).toEqual([]);
  });
});

/** アーカイブを戻す（同じテストの中で、次の挟み方を試すための復元） */
async function cleanupArchive(roomId: string) {
  await env.DB.prepare(
    "UPDATE channels SET deleted_at = NULL WHERE room_id = ?",
  )
    .bind(roomId)
    .run();
}

// #148 コードレビュー1回目の重大1：保存の時点の条件を、最初の判定（requirePostable・requireReplyable）と一致させる。
// 最初の判定が見ている DB の条件のうち、保存の時点の条件になかったもの：
//   ・お知らせ専用のチャンネルへの投稿の資格（perm.announcement.post。その部署のオーナーか全体管理者）… requirePostable
//   ・返信先の部屋の部署が有効であること（部署のないチャンネルは有効扱い）… requireReplyable
// 応答は最初の判定と同じ：投稿の資格を失えば 403 FORBIDDEN、部署が無効なら 409 CONFLICT「部署が無効になっているため、返信できません」。
describe("#148 重大1 受信中に、お知らせ専用の投稿の資格・返信先の部署の有効性を失う", () => {
  it("#148 重大1(a): お知らせ専用のチャンネルへのアップロードの受信中に、オーナーでなくなると 403 で、登録されず、R2 の実体も残らない", async () => {
    const room = cw.w.deptS.announcementChannelId;
    const { response, pulled } = await uploadWhile(
      roomUploadPath(room),
      cw.w.ownerS.token,
      () => removeOwner(cw.w.ownerS.id, cw.w.deptS.id),
    );
    expect(pulled).toBe(true);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      "FORBIDDEN",
    );
    expect(await attachmentCountIn(room)).toBe(0);
    expect(await storedKeys()).toEqual([]);
  });

  it("#148 重大1(b): 返信への添付の受信中に、部屋の部署が無効になると 409 で、登録されず、R2 の実体も残らない", async () => {
    const room = cw.w.deptS.dedicatedChannelId;
    const parent = await seedRoomMessage(room, cw.w.memberS2.id, 70);
    const { response, pulled } = await uploadWhile(
      replyUploadPath(parent),
      cw.w.memberS1.token,
      () => setDepartmentActive(cw.w.deptS.id, false),
    );
    expect(pulled).toBe(true);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "CONFLICT",
      message: "部署が無効になっているため、返信できません",
    });
    expect(await attachmentCountIn(room)).toBe(0);
    expect(await storedKeys()).toEqual([]);
    await setDepartmentActive(cw.w.deptS.id, true);
  });

  it("#148 重大1(c) 退行なし: 資格を持ったままのオーナーはお知らせ専用のチャンネルに、部署が有効なら返信に、アップロードできる（201）", async () => {
    const announcement = await uploadFile(
      { kind: "room", roomId: cw.w.deptS.announcementChannelId },
      "memo148.txt",
      TEXT,
      cw.w.ownerS.token,
    );
    const parent = await seedRoomMessage(
      cw.w.deptS.dedicatedChannelId,
      cw.w.memberS2.id,
      71,
    );
    const toReply = await uploadFile(
      { kind: "reply", parentId: parent },
      "memo148.txt",
      TEXT,
      cw.w.memberS1.token,
    );
    expect([announcement.status, toReply.status]).toEqual([201, 201]);
  });
});

// #148 ミューテーションの生き残りへの対応（決定 C-184(10)）：未投稿の添付の登録が0行で、読み直しでは、どの拒否の理由にも当たらないとき
// （資格は保たれているのに登録できなかった）は、409「状態が変わったため、添付できませんでした。読み込み直してからお試しください」で、保存した物を後始末する。
// 作り方：要求の DB を包み、message_attachments への INSERT だけを「実行せずに 0 行」として返す（ほかの文は本物に流す。読み直しは本物の状態で通る）。
function zeroRowAttachmentInsertDb(real: D1Database): D1Database {
  const target = /insert\s+into\s+["`]?message_attachments/i;
  const zero = { success: true, results: [], meta: { changes: 0 } };
  const fakeStatement = (): D1PreparedStatement =>
    ({
      bind: () => fakeStatement(),
      run: async () => zero,
      all: async () => zero,
      raw: async () => [],
      first: async () => null,
    }) as unknown as D1PreparedStatement;
  return new Proxy(real, {
    get(source, property, receiver) {
      if (property === "prepare")
        return (query: string) =>
          target.test(query) ? fakeStatement() : source.prepare(query);
      const value = Reflect.get(source, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(source) : value;
    },
  });
}

describe("#148 C-184(10) 登録が0行で、どの拒否の理由にも当たらない", () => {
  it.each(["room", "reply"] as const)(
    "#148 C-184(10): %s への添付は 409「状態が変わったため、添付できませんでした。読み込み直してからお試しください」で、R2 の実体を後始末する",
    async (target) => {
      const parent = await seedRoomMessage(
        cw.open.roomId,
        cw.w.memberD1.id,
        95,
      );
      const response = await uploadFile(
        target === "room"
          ? { kind: "room", roomId: cw.open.roomId }
          : { kind: "reply", parentId: parent },
        "memo148.txt",
        TEXT,
        cw.w.memberS1.token,
        { envOverrides: { DB: zeroRowAttachmentInsertDb(env.DB) } },
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "CONFLICT",
        message:
          "状態が変わったため、添付できませんでした。読み込み直してからお試しください",
      });
      expect(await attachmentCountIn(cw.open.roomId)).toBe(0);
      expect(await storedKeys()).toEqual([]);
    },
  );
});
