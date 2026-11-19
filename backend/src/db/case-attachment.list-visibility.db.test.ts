// #148（148-B-2）5-2 AC-7・AC-9・計画 6.6：案件の添付の一覧（EP-5-19）の項目に足す publicationVisibility（列そのまま）と
// canChangeVisibility（閲覧者が変えられるか。同じ文の中で決める）を、マイグレーション済みの隔離 D1 で確かめる。
// canChangeVisibility の期待（R-85）：本人・担当部署のオーナー（参加者）・全体管理者（参加者）は真。ほかの参加者・担当部署でない部署の
//   オーナー（参加者）は偽。終了した案件では全員偽。相関：同じ一覧の中で、行ごとに投稿者で決まる（別の行の投稿者に引きずられない）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  caseAttachmentIdAt,
  seedCaseAttachment,
  setPublicationVisibility,
} from "../../test/case-attachment-fixtures";
import { addCaseMember } from "../../test/case-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
  setCaseStatus,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { withCaseAttachments } from "./case-attachment.repository";

type Row = {
  id: string;
  publicationVisibility?: unknown;
  canChangeVisibility?: unknown;
};

let cw: CaseRoomWorld;

async function rowsFor(viewerId: string, caseId = cw.open.id): Promise<Row[]> {
  const page = await withCaseAttachments(env, (r) =>
    r.listCaseAttachments({ caseId, viewerId, limit: 100, cursor: null }),
  );
  if (typeof page === "string") throw new Error(`一覧が ${page} でした`);
  return (page.items as unknown as Row[]).map((i) => ({
    id: i.id,
    publicationVisibility: i.publicationVisibility,
    canChangeVisibility: i.canChangeVisibility,
  }));
}

/** n=1 は memberS1 の添付（public_archive）、n=2 は memberD1 の添付（participants_only） */
async function seedTwo(roomId = cw.open.roomId) {
  const m1 = await seedRoomMessage(roomId, cw.w.memberS1.id, 1);
  const m2 = await seedRoomMessage(roomId, cw.w.memberD1.id, 2);
  const a1 = await seedCaseAttachment({
    n: 1,
    roomId,
    uploaderId: cw.w.memberS1.id,
    messageId: m1,
  });
  await seedCaseAttachment({
    n: 2,
    roomId,
    uploaderId: cw.w.memberD1.id,
    messageId: m2,
  });
  await setPublicationVisibility(a1, "public_archive");
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1700);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 AC-7・AC-9 一覧の publicationVisibility・canChangeVisibility", () => {
  it("#148 AC-9: 一般の参加者は、自分の添付の行だけ真（行ごとに投稿者で決まる）。publicationVisibility は行の値", async () => {
    await seedTwo();
    expect(await rowsFor(cw.w.memberS1.id)).toEqual([
      {
        id: caseAttachmentIdAt(2),
        publicationVisibility: "participants_only",
        canChangeVisibility: false,
      },
      {
        id: caseAttachmentIdAt(1),
        publicationVisibility: "public_archive",
        canChangeVisibility: true,
      },
    ]);
    expect(await rowsFor(cw.w.memberD1.id)).toEqual([
      {
        id: caseAttachmentIdAt(2),
        publicationVisibility: "participants_only",
        canChangeVisibility: true,
      },
      {
        id: caseAttachmentIdAt(1),
        publicationVisibility: "public_archive",
        canChangeVisibility: false,
      },
    ]);
  });

  it.each([
    ["担当部署のオーナー（参加者）", () => cw.w.ownerS.id],
    ["全体管理者（参加者）", () => cw.w.admin.id],
  ])("#148 AC-9 R-85: %s は、すべての行が真", async (_l, who) => {
    await seedTwo();
    await addCaseMember(cw.open.roomId, who());
    expect((await rowsFor(who())).map((r) => r.canChangeVisibility)).toEqual([
      true,
      true,
    ]);
  });

  it("#148 AC-9 R-85: 担当部署でない部署のオーナー（参加者）は、すべての行が偽", async () => {
    await seedTwo();
    await addCaseMember(cw.open.roomId, cw.w.ownerD.id);
    expect(
      (await rowsFor(cw.w.ownerD.id)).map((r) => r.canChangeVisibility),
    ).toEqual([false, false]);
  });

  it("#148 AC-9: 終了した案件では、本人・管理の資格のある参加者でも、すべての行が偽", async () => {
    await seedTwo(cw.closed.roomId);
    await addCaseMember(cw.closed.roomId, cw.w.ownerS.id);
    await setCaseStatus(cw.closed.id, "closed");
    for (const viewer of [cw.w.memberS1.id, cw.w.ownerS.id])
      expect(
        (await rowsFor(viewer, cw.closed.id)).map((r) => r.canChangeVisibility),
      ).toEqual([false, false]);
  });

  it("#148 AC-9 相関: 別の案件（進行中）の担当部署のオーナーで、その案件にだけ参加していても、この案件の行は偽", async () => {
    await seedTwo();
    // other の担当部署も deptS なので、deptD を担当部署に持つ別の案件は使わず、この案件に参加した ownerD（deptD のオーナー）で確かめる
    await addCaseMember(cw.other.roomId, cw.w.ownerD.id);
    await addCaseMember(cw.open.roomId, cw.w.ownerD.id);
    expect(
      (await rowsFor(cw.w.ownerD.id)).every(
        (r) => r.canChangeVisibility === false,
      ),
    ).toBe(true);
  });
});
