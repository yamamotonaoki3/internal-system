// #148（148-B-1）5-2 AC-7（参加者の部分）・5-1 AC-11・C-62・R-62・R-64、EP-5-19：案件の添付の一覧 GET /api/cases/:caseId/attachments を、
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// この層で確かめるもの（計画 148-B-1 のテストケース「AC-7・HTTP」）：状態コードと結線・応答の形の完全一致（保存キーを含まない）・noStore・
//   クエリの検証（limit・cursor の不正は 422 fields。ルートの検証なので、非参加者・存在しない案件でも 422 が先）・存在しない案件は 404・
//   非参加者（参加していない担当部署のオーナー・全体管理者を含む）は 403 で添付の中身を出さない・終了した案件でも 200・既定の limit。
// 一覧に出る範囲・資格の SQL は DB のテスト（db/case-attachment.repository.db.test.ts）、判定の順の細部は Service のテスト、
// 割り込みは services/case-attachment.interleave.test.ts で確かめ、ここでは重ねない。
// 契約（実装前の仮置き。実装の担当へ）：
//   200 { items: [{ id, name, kind, contentType, size, uploadedAt, messageId, threadParentId, uploader: { id, displayName, isActive } }], nextCursor }
//   limit は 1〜100・既定 50（計画 148-B-1「API」）。cursor は lib/cursor の形
//   404 { code: "NOT_FOUND", message: "案件が見つかりません" }・403 { code: "FORBIDDEN", message: "参加者だけが見られます（非公開）" }
//   422 { code: "VALIDATION_ERROR", fields: [...] }
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  CASE_ATTACHMENT_ITEM_KEYS,
  CASE_ATTACHMENT_UPLOADER_KEYS,
  caseAttachmentIdAt,
  caseAttachmentIsoAt,
  caseAttachmentName,
  seedCaseAttachment,
  seedManyCaseAttachments,
} from "../../test/case-attachment-fixtures";
import {
  CASES_BASE,
  CASE_MESSAGES,
  MISSING_CASE_ID,
  setDisplayName,
} from "../../test/case-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
  seedRoomReply,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";

type ErrorBody = { code: string; message: string; fields?: string[] };
type Item = {
  publicationVisibility: string;
  canChangeVisibility: boolean;
  id: string;
  name: string;
  kind: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  messageId: string;
  threadParentId: string | null;
  uploader: { id: string; displayName: string; isActive: boolean };
};
type Page = { items: Item[]; nextCursor: string | null };

const NAME_S1 = "テスト投稿者148B結合";

let cw: CaseRoomWorld;

const attachmentsPath = (caseId: string) =>
  `${CASES_BASE}/${caseId}/attachments`;
const listOf = (caseId: string, token: string | null, query = "") =>
  apiRequest("GET", `${attachmentsPath(caseId)}${query}`, { token });

async function expectError(
  res: Response,
  status: number,
  expected: Partial<ErrorBody>,
) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
  const text = await res.text();
  expect(JSON.parse(text)).toMatchObject(expected);
  return text;
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1590);
  await setDisplayName(cw.w.memberS1.id, NAME_S1);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

async function seedOpenAttachments() {
  const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
  const reply = await seedRoomReply(
    cw.open.roomId,
    parent,
    cw.w.memberS1.id,
    2,
  );
  await seedCaseAttachment({
    n: 1,
    roomId: cw.open.roomId,
    uploaderId: cw.w.memberS1.id,
    messageId: parent,
  });
  await seedCaseAttachment({
    n: 2,
    roomId: cw.open.roomId,
    uploaderId: cw.w.memberS1.id,
    messageId: reply,
    threadParentId: parent,
  });
  return { parent, reply };
}

describe("#148 AC-7 EP-5-19 認証とパスの形", () => {
  it("#148 AC-7: ログインしていなければ 401", async () => {
    await seedOpenAttachments();
    const res = await listOf(cw.open.id, null);
    expect(res.status).toBe(401);
  });

  it("#148 AC-7: パスの caseId が ULID の形でなければ 422", async () => {
    await expectError(await listOf("not-a-ulid", cw.w.memberS1.token), 422, {
      code: "VALIDATION_ERROR",
    });
  });
});

describe("#148 AC-7 EP-5-19 一覧", () => {
  it("#148 AC-7 C-62: 参加者には、項目（保存キーを含まない）と nextCursor を返す。noStore", async () => {
    const { parent, reply } = await seedOpenAttachments();
    const res = await listOf(cw.open.id, cw.w.memberD1.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    const text = await res.text();
    expect(text).not.toContain("attachments/");
    expect(text).not.toContain("storage");
    const body = JSON.parse(text) as Page;
    expect(Object.keys(body).sort()).toEqual(["items", "nextCursor"]);
    expect(body).toEqual({
      items: [
        {
          id: caseAttachmentIdAt(2),
          name: caseAttachmentName(2),
          kind: "document",
          contentType: "text/plain; charset=utf-8",
          size: 12,
          uploadedAt: caseAttachmentIsoAt(2),
          messageId: reply,
          threadParentId: parent,
          uploader: {
            id: cw.w.memberS1.id,
            displayName: NAME_S1,
            isActive: true,
          },
          // #148（148-B-2）で加わる項目：既定は参加者限定。閲覧者 memberD1 は投稿者でも管理の資格もない
          publicationVisibility: "participants_only",
          canChangeVisibility: false,
        },
        {
          id: caseAttachmentIdAt(1),
          name: caseAttachmentName(1),
          kind: "document",
          contentType: "text/plain; charset=utf-8",
          size: 11,
          uploadedAt: caseAttachmentIsoAt(1),
          messageId: parent,
          threadParentId: null,
          uploader: {
            id: cw.w.memberS1.id,
            displayName: NAME_S1,
            isActive: true,
          },
          // #148（148-B-2）で加わる項目：既定は参加者限定。閲覧者 memberD1 は投稿者でも管理の資格もない
          publicationVisibility: "participants_only",
          canChangeVisibility: false,
        },
      ],
      nextCursor: null,
    });
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual([...CASE_ATTACHMENT_ITEM_KEYS]);
      expect(Object.keys(item.uploader).sort()).toEqual([
        ...CASE_ATTACHMENT_UPLOADER_KEYS,
      ]);
    }
  });

  it("#148 AC-7: 添付がなければ items は空", async () => {
    const res = await listOf(cw.open.id, cw.w.memberS1.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it("#148 AC-7 5-1 AC-11: 終了した案件でも、参加者は一覧を読める（200）", async () => {
    const parent = await seedRoomMessage(cw.closed.roomId, cw.w.memberS1.id, 1);
    await seedCaseAttachment({
      n: 1,
      roomId: cw.closed.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: parent,
    });
    const res = await listOf(cw.closed.id, cw.w.memberD1.token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Page).items.map((i) => i.id)).toEqual([
      caseAttachmentIdAt(1),
    ]);
  });

  it("#148 AC-7 計画「API」: limit の既定は 50。51件なら 50件と nextCursor、続きで1件", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
    await seedManyCaseAttachments({
      from: 100,
      count: 51,
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: parent,
    });
    const first = (await (
      await listOf(cw.open.id, cw.w.memberS1.token)
    ).json()) as Page;
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = (await (
      await listOf(
        cw.open.id,
        cw.w.memberS1.token,
        `?cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
      )
    ).json()) as Page;
    expect(second.items.map((i) => i.id)).toEqual([caseAttachmentIdAt(100)]);
    expect(second.nextCursor).toBeNull();
  });

  it("#148 AC-7: limit=100 は受け付ける（最大）", async () => {
    const res = await listOf(cw.open.id, cw.w.memberS1.token, "?limit=100");
    expect(res.status).toBe(200);
  });
});

describe("#148 AC-7 EP-5-19 クエリの検証（ルートで最初に 422）", () => {
  const BAD_QUERIES: [string, string, string][] = [
    ["limit=101（最大は100）", "?limit=101", "limit"],
    ["limit=0", "?limit=0", "limit"],
    ["limit が数でない", "?limit=abc", "limit"],
    ["cursor が壊れている", "?cursor=%%%broken", "cursor"],
  ];

  it.each(BAD_QUERIES)(
    "#148 AC-7 error-api: %s は 422 で fields にその項目",
    async (_l, query, field) => {
      await expectError(
        await listOf(cw.open.id, cw.w.memberS1.token, query),
        422,
        { code: "VALIDATION_ERROR", fields: [field] },
      );
    },
  );

  it.each(BAD_QUERIES)(
    "#148 AC-7 計画「判定の順」0: 非参加者・存在しない案件でも、%s は 422 が先（ルートの検証）",
    async (_l, query) => {
      const outsider = await listOf(cw.open.id, cw.w.memberS2.token, query);
      expect(outsider.status).toBe(422);
      const missing = await listOf(MISSING_CASE_ID, cw.w.memberS1.token, query);
      expect(missing.status).toBe(422);
    },
  );
});

describe("#148 AC-7 R-62・R-64 EP-5-19 拒否と存在の扱い", () => {
  it("#148 AC-7: 案件がなければ 404「案件が見つかりません」", async () => {
    await expectError(await listOf(MISSING_CASE_ID, cw.w.memberS1.token), 404, {
      code: "NOT_FOUND",
      message: CASE_MESSAGES.notFound,
    });
  });

  it.each([
    ["非参加の一般社員（ほかの案件の参加者）", () => cw.w.memberS2.token],
    ["参加していない担当部署のオーナー", () => cw.w.ownerS.token],
    ["参加していない全体管理者", () => cw.w.admin.token],
    ["所属のない非参加の社員", () => cw.w.noDept.token],
  ])(
    "#148 AC-7 R-62・R-64: %s は 403「参加者だけが見られます（非公開）」で、ファイル名・投稿者・件数を出さない",
    async (_label, token) => {
      await seedOpenAttachments();
      const text = await expectError(await listOf(cw.open.id, token()), 403, {
        code: "FORBIDDEN",
        message: CASE_MESSAGES.participantsOnly,
      });
      expect(text).not.toContain(caseAttachmentName(1));
      expect(text).not.toContain(NAME_S1);
      expect(Object.keys(JSON.parse(text) as object)).not.toContain("items");
    },
  );

  it("#148 AC-7: 終了した案件でも、非参加者は 403（終了しただけでは公開しない。C-62）", async () => {
    const parent = await seedRoomMessage(cw.closed.roomId, cw.w.memberS1.id, 1);
    await seedCaseAttachment({
      n: 1,
      roomId: cw.closed.roomId,
      uploaderId: cw.w.memberS1.id,
      messageId: parent,
    });
    await expectError(await listOf(cw.closed.id, cw.w.ownerS.token), 403, {
      code: "FORBIDDEN",
      message: CASE_MESSAGES.participantsOnly,
    });
  });
});
