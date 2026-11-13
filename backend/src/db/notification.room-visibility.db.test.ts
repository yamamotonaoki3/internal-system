// #237 AC-3（3-1 AC-3）：部屋の閲覧権限を失った場合、その部屋の内容を含む通知を通知一覧から除く。
// 仕組み（計画「4.」）：visibleToRecipient の「部屋の内容を含む種類（containsRoomContent: true）」の条件に、
//   「閲覧できる部屋であること」＝ 未アーカイブで（公開 または 自分が参加中）のチャンネル、または自分が当事者の DM を足す。
//   一覧・未読数・1件既読・すべて既読の4経路が同じ条件を通る。今の本番の定義（部屋の内容を含む種類が0件）では条件が付かない。
// 閲覧の条件は canViewChannel（lib/channel-rules.ts）と同じ規則を SQL で書く二重定義になるため、全組で一致することを固定する。
// テストは定義の差し替え（createNotificationRepository(db, { definitions })）で行い、本番の定義元にテスト用の種類を足さない。
// データは架空（testuser_notifroom_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { cleanupDmScenario, insertDm } from "../../test/dm-fixtures";
import {
  cleanupNotificationScenario,
  insertNotification,
  notificationIdAt,
  notificationRow,
} from "../../test/notification-fixtures";
import {
  joinAt,
  removeMember,
  setArchived,
  setVisibility,
} from "../../test/read-position-fixtures";
import {
  TEST_TAG,
  insertDepartment,
  insertUser,
  testId,
} from "../../test/role-fixtures";
import { canViewChannel } from "../lib/channel-rules";
import { withDatabase } from "./database";
import { createNotificationRepository } from "./notification.repository";

const NOW = "2026-11-13T00:00:00.000Z";
const DEFINITIONS = {
  test_room_kind: { containsRoomContent: true },
  test_plain_kind: { containsRoomContent: false },
} as const;

let deptId: string;
let viewer: string;
let other: string;
let third: string;
let sequence = 0;

const repo = <T>(
  run: (r: ReturnType<typeof createNotificationRepository>) => Promise<T>,
  definitions: Readonly<
    Record<string, { containsRoomContent: boolean }>
  > = DEFINITIONS,
) =>
  withDatabase(env, (db) =>
    run(createNotificationRepository(db, { definitions })),
  );

async function notify(roomId: string | null, kind = "test_room_kind") {
  sequence += 1;
  return insertNotification({
    userId: viewer,
    id: notificationIdAt(1_800_000_000_000 + sequence),
    kind,
    roomId,
  });
}

/** 4経路で見え方を調べる：一覧に出るか・未読数に入るか・1件既読できるか・すべて既読で既読になるか */
async function visibility(notificationId: string) {
  const page = await repo((r) => r.listForRecipient(viewer, { limit: 100 }));
  const listed = page.items.some((item) => item.id === notificationId);
  return { listed };
}

async function channel(
  label: string,
  options: { visibility?: "public" | "private"; archived?: boolean } = {},
) {
  return insertChannel({
    name: `${TEST_TAG}通知の部屋${label}`,
    purpose: "normal",
    departmentId: deptId,
    visibility: options.visibility ?? "public",
    archived: options.archived ?? false,
  });
}

beforeEach(async () => {
  deptId = await insertDepartment("通知の部屋");
  viewer = await insertUser("testuser_notifroom_viewer", deptId);
  other = await insertUser("testuser_notifroom_other", deptId);
  third = await insertUser("testuser_notifroom_third", deptId);
});

afterEach(async () => {
  await cleanupNotificationScenario(cleanupDmScenario);
});

describe("#237 AC-3（3-1 AC-3）閲覧できない部屋の、部屋の内容を含む通知は4経路すべてから除く", () => {
  it("#237 AC-3: 非公開で参加していない・アーカイブ済み・他人の DM・存在しない部屋の通知は、一覧・未読数・1件既読・すべて既読から除かれる", async () => {
    const privateUnjoined = await channel("非公開の未参加", {
      visibility: "private",
    });
    await insertMember(privateUnjoined, other);
    const archived = await channel("アーカイブ");
    await insertMember(archived, viewer);
    await setArchived(archived, true);
    const othersDm = await insertDm(other, third);
    const hiddenIds: string[] = [];
    for (const roomId of [
      privateUnjoined,
      archived,
      othersDm,
      testId("NOROOM"),
    ])
      hiddenIds.push(await notify(roomId));

    const page = await repo((r) => r.listForRecipient(viewer, { limit: 100 }));
    expect(page.items).toEqual([]);
    expect(await repo((r) => r.countUnread(viewer))).toBe(0);
    for (const id of hiddenIds)
      expect(await repo((r) => r.markRead(viewer, id, NOW))).toBe(false);
    expect(await repo((r) => r.markAllRead(viewer, NOW))).toBe(0);
    for (const id of hiddenIds)
      expect((await notificationRow(id))?.read_at).toBeNull();
  });

  it("#237 AC-3: 閲覧できる部屋（公開は未参加でも・参加中の非公開・当事者の DM）の通知は、4経路すべてに残る", async () => {
    const publicUnjoined = await channel("公開の未参加");
    const privateJoined = await channel("非公開の参加中", {
      visibility: "private",
    });
    await insertMember(privateJoined, viewer);
    const ownDm = await insertDm(viewer, other);
    const ids: string[] = [];
    for (const roomId of [publicUnjoined, privateJoined, ownDm])
      ids.push(await notify(roomId));

    const page = await repo((r) => r.listForRecipient(viewer, { limit: 100 }));
    expect(page.items.map((item) => item.id).sort()).toEqual([...ids].sort());
    expect(await repo((r) => r.countUnread(viewer))).toBe(3);
    expect(await repo((r) => r.markRead(viewer, ids[0] ?? "", NOW))).toBe(true);
    expect(await repo((r) => r.markAllRead(viewer, NOW))).toBe(2);
    for (const id of ids)
      expect((await notificationRow(id))?.read_at).toBe(NOW);
  });

  it("#237 AC-3: 非公開のチャンネルから外れると除かれ、参加し直すと再び見える", async () => {
    const roomId = await channel("外れて戻る", { visibility: "private" });
    await insertMember(roomId, viewer);
    const id = await notify(roomId);
    expect(await visibility(id)).toEqual({ listed: true });
    await removeMember(roomId, viewer);
    expect(await visibility(id)).toEqual({ listed: false });
    expect(await repo((r) => r.countUnread(viewer))).toBe(0);
    await joinAt(roomId, viewer, NOW);
    expect(await visibility(id)).toEqual({ listed: true });
    expect(await repo((r) => r.countUnread(viewer))).toBe(1);
  });

  it("#237 AC-3: アーカイブで除かれ、アーカイブを戻すと再び見える。参加していない人が公開から非公開にされたときも除かれる", async () => {
    const archived = await channel("アーカイブの往復");
    await insertMember(archived, viewer);
    const archivedNotice = await notify(archived);
    await setArchived(archived, true);
    expect(await visibility(archivedNotice)).toEqual({ listed: false });
    await setArchived(archived, false);
    expect(await visibility(archivedNotice)).toEqual({ listed: true });

    const turnedPrivate = await channel("非公開になる");
    const privateNotice = await notify(turnedPrivate);
    expect(await visibility(privateNotice)).toEqual({ listed: true });
    await setVisibility(turnedPrivate, "private");
    expect(await visibility(privateNotice)).toEqual({ listed: false });
  });

  it("#237 AC-3（申し送り②）: 公開チャンネルは抜けても閲覧できるため、その通知は残る", async () => {
    const roomId = await channel("公開から抜ける");
    await insertMember(roomId, viewer);
    const id = await notify(roomId);
    await removeMember(roomId, viewer);
    expect(await visibility(id)).toEqual({ listed: true });
  });

  it("#237 AC-3: 部屋の内容を含まない種類（containsRoomContent: false）は、閲覧できない部屋の ID を持っていても残る", async () => {
    const privateUnjoined = await channel("含まない種類", {
      visibility: "private",
    });
    const id = await notify(privateUnjoined, "test_plain_kind");
    expect(await visibility(id)).toEqual({ listed: true });
    expect(await repo((r) => r.countUnread(viewer))).toBe(1);
  });

  it("#237 AC-3: 今の本番の定義（channel_request.* はすべて部屋の内容を含まない）では、閲覧できない部屋の ID を持つ通知も残る", async () => {
    const privateUnjoined = await channel("本番の定義", {
      visibility: "private",
    });
    const id = await notify(privateUnjoined, "channel_request.approved");
    const page = await withDatabase(env, (db) =>
      createNotificationRepository(db).listForRecipient(viewer, { limit: 100 }),
    );
    expect(page.items.map((item) => item.id)).toEqual([id]);
  });
});

describe("#237 AC-3 SQL の閲覧の条件と canViewChannel が、全組で一致する", () => {
  const cases = (["public", "private"] as const).flatMap((visibility) =>
    [true, false].flatMap((joined) =>
      [false, true].map((archived) => ({ visibility, joined, archived })),
    ),
  );

  it.each(cases)(
    "#237 AC-3: 公開範囲 $visibility・参加 $joined・アーカイブ $archived",
    async ({ visibility: scope, joined, archived }) => {
      const roomId = await channel(`${scope}${joined}${archived}`, {
        visibility: scope,
      });
      if (joined) await insertMember(roomId, viewer);
      if (archived) await setArchived(roomId, true);
      const id = await notify(roomId);
      const expected = canViewChannel(
        { visibility: scope, deletedAt: archived ? NOW : null },
        joined,
      );
      expect(await visibility(id)).toEqual({ listed: expected });
      expect(await repo((r) => r.countUnread(viewer))).toBe(expected ? 1 : 0);
    },
  );
});
