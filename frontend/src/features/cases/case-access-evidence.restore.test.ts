// #342 AC-2（計画 plan342a2 の 3-2、7 節の U1・U2）：復元の守りが確かめる対象の全件 caseAccessTargets(queryClient, userId)。
// 対象：案件の ID を持つ取得済みの返信・スレッド一覧の読み込み済みの全ページの案件の行・案件との対応が分かる部屋の取得済みのメッセージ（空の配列も）・
// その利用者の参加者の概要。案件の ID で重なりを除き、案件の ID と部屋の ID（分からなければ null）だけを返す（本文・入力値を写さない）。
// 除くもの：案件一覧の行・案件の詳細だけ・チャンネルの詳細だけ（対応だけの情報）・検索だけの結果・通常の部屋・DM・ほかの利用者の概要・非参加の概要。
// U2：実績がある案件の部屋の ID は、caseRoomEvidence と同じ読み方（同じ優先順）で決める。実績が無い案件の caseRoomEvidence は undefined のまま。
// 順序は決めていないので、案件の ID で並べて比べる。キーは本番の関数を使わず、リテラルで書く。取得の実績は実際の取得（fetchQuery）で作る。
// データはすべて架空（testuser_・[UNIT_TEST]）。
// 前提にした口（実装の担当へ）：case-access-evidence.ts の caseAccessTargets(queryClient, userId): { caseId: string; roomId: string | null }[]
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_USER } from "../../test/auth-handlers";
import {
  caseDetail,
  caseId as caseIdOf,
  caseRoomId,
  caseSummary,
  outsiderSummary,
} from "../../test/case-handlers";
import { message, reply } from "../../test/message-handlers";
import { threadItem } from "../../test/thread-handlers";
import { caseAccessTargets, caseRoomEvidence } from "./case-access-evidence";

const USER = TEST_USER.id;
const OTHER_USER = "01JTESTUSER342000000000EV2";
const PLAIN_ROOM = "01JTESTROOM342000000000EV1";
const DM_ROOM = "01JTESTROOM342000000000EV2";

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["auth", "session"], {
    user: TEST_USER,
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  });
});
afterEach(() => {
  client.clear();
});

async function fetched(queryKey: unknown[], data: unknown) {
  await client.fetchQuery({ queryKey, queryFn: () => Promise.resolve(data) });
}

function repliesData(parentN: number, roomId: string, caseId: string | null) {
  const parent = message(parentN, { roomId, replyCount: 1 });
  return {
    parent,
    replies: [reply(parent, 1)],
    replyBlockedReason: null,
    joined: true,
    roomWritable: true,
    caseRoom: caseId !== null,
    caseId,
  };
}

function channelDetail(roomId: string, caseId: string | null) {
  return {
    id: roomId,
    roomId,
    name: "[UNIT_TEST]342チャンネル",
    caseId,
  };
}

const sorted = (
  targets: readonly { caseId: string; roomId: string | null }[],
) => [...targets].sort((a, b) => a.caseId.localeCompare(b.caseId));

describe("#342 AC-2 U1 対象の全件", () => {
  it("#342 AC-2 U1: 返信・一覧の全ページ・対応の分かる部屋の空のメッセージ・参加者の概要から、案件の ID で重なりを除いて、案件と部屋の ID だけを返す", async () => {
    // 返信（案件 1）
    await fetched(
      ["messages", "thread", "p3421"],
      repliesData(1, caseRoomId(3421), caseIdOf(3421)),
    );
    // スレッド一覧の2ページ目だけにある案件 2。1ページ目には案件 1 の行もある（重なり）
    await fetched(["threads", "list"], {
      pages: [
        {
          items: [
            threadItem(11, {
              room: {
                kind: "channel",
                id: caseRoomId(3421),
                name: "[UNIT_TEST]342部屋1",
              },
              caseId: caseIdOf(3421),
            }),
          ],
          nextCursor: "p1",
        },
        {
          items: [
            threadItem(12, {
              room: {
                kind: "channel",
                id: caseRoomId(3422),
                name: "[UNIT_TEST]342部屋2",
              },
              caseId: caseIdOf(3422),
            }),
          ],
          nextCursor: null,
        },
      ],
      pageParams: [undefined, "p1"],
    });
    // 案件 3：詳細で部屋が分かり、その部屋のメッセージを取得した（空の配列）
    client.setQueryData(
      ["cases", "detail", USER, caseIdOf(3423)],
      caseDetail(3423),
    );
    await fetched(["messages", "room", caseRoomId(3423)], []);
    // 案件 4：チャンネルの詳細で部屋が分かり、その部屋のメッセージを取得した
    const room4 = "01JTESTROOM342000000000EV4";
    await fetched(
      ["channels", "detail", room4],
      channelDetail(room4, caseIdOf(3424)),
    );
    await fetched(["messages", "room", room4], [message(1, { roomId: room4 })]);
    // 案件 5：参加者の概要だけ
    client.setQueryData(
      ["cases", "summary", USER, caseIdOf(3425)],
      caseSummary(3425),
    );

    expect(sorted(caseAccessTargets(client, USER))).toEqual(
      sorted([
        { caseId: caseIdOf(3421), roomId: caseRoomId(3421) },
        { caseId: caseIdOf(3422), roomId: caseRoomId(3422) },
        { caseId: caseIdOf(3423), roomId: caseRoomId(3423) },
        { caseId: caseIdOf(3424), roomId: room4 },
        { caseId: caseIdOf(3425), roomId: caseRoomId(3425) },
      ]),
    );
  });

  it("#342 AC-2 U1: 返す値は案件の ID と部屋の ID だけ（本文・名前などを写さない）", async () => {
    await fetched(
      ["messages", "thread", "p3421"],
      repliesData(1, caseRoomId(3421), caseIdOf(3421)),
    );
    const targets = caseAccessTargets(client, USER);
    expect(targets).toHaveLength(1);
    for (const target of targets)
      expect(Object.keys(target).sort()).toEqual(["caseId", "roomId"]);
  });

  it("#342 AC-2 U1: 案件一覧の行・案件の詳細だけ・チャンネルの詳細だけ・対応の分からない部屋・検索だけの結果・通常の部屋と DM の返信と行・非参加の概要は、対象にしない", async () => {
    client.setQueryData(["cases", "list", USER, "joined", "active"], {
      pages: [{ items: [caseSummary(3431)], nextCursor: null }],
      pageParams: [undefined],
    });
    client.setQueryData(
      ["cases", "detail", USER, caseIdOf(3432)],
      caseDetail(3432),
    );
    await fetched(
      ["channels", "detail", caseRoomId(3433)],
      channelDetail(caseRoomId(3433), caseIdOf(3433)),
    );
    await fetched(
      ["messages", "room", PLAIN_ROOM],
      [message(1, { roomId: PLAIN_ROOM })],
    );
    await fetched(["search", "messages", { q: "[UNIT_TEST]342" }], {
      items: [{ caseId: caseIdOf(3434), roomId: caseRoomId(3434) }],
      nextCursor: null,
    });
    await fetched(["search", "cases", { q: "[UNIT_TEST]342" }], {
      items: [caseSummary(3434)],
      nextCursor: null,
    });
    await fetched(
      ["messages", "thread", "pplain"],
      repliesData(2, PLAIN_ROOM, null),
    );
    await fetched(["threads", "list"], {
      pages: [
        {
          items: [
            threadItem(21, {
              room: {
                kind: "direct",
                id: DM_ROOM,
                partner: {
                  id: "01JTESTUSER342000000000EV3",
                  displayName: "testuser_342_dm",
                  isActive: true,
                },
              },
            }),
          ],
          nextCursor: null,
        },
      ],
      pageParams: [undefined],
    });
    client.setQueryData(
      ["cases", "summary", USER, caseIdOf(3435)],
      outsiderSummary(3435),
    );

    expect(caseAccessTargets(client, USER)).toEqual([]);
  });

  it("#342 AC-2 U1: ほかの利用者の概要は、対象にしない", () => {
    client.setQueryData(
      ["cases", "summary", OTHER_USER, caseIdOf(3441)],
      caseSummary(3441),
    );
    expect(caseAccessTargets(client, USER)).toEqual([]);
    expect(caseAccessTargets(client, OTHER_USER)).toEqual([
      { caseId: caseIdOf(3441), roomId: caseRoomId(3441) },
    ]);
  });

  it("#342 AC-2 U1: 何も無ければ0件", () => {
    expect(caseAccessTargets(client, USER)).toEqual([]);
  });
});

describe("#342 AC-2 U2 実績と部屋の ID は、caseRoomEvidence と同じ読み方で決める", () => {
  it("#342 AC-2 U2: 返信の部屋と詳細の部屋が違っても、実績の部屋は caseRoomEvidence と同じ（返信が先）", async () => {
    const otherRoom = "01JTESTROOM342000000000EV9";
    client.setQueryData(
      ["cases", "detail", USER, caseIdOf(3451)],
      caseDetail(3451, { channelId: otherRoom }),
    );
    await fetched(["messages", "room", otherRoom], []);
    await fetched(
      ["messages", "thread", "p3451"],
      repliesData(1, caseRoomId(3451), caseIdOf(3451)),
    );
    const evidence = caseRoomEvidence(client, USER, caseIdOf(3451));
    expect(evidence).toEqual({ roomId: caseRoomId(3451) });
    expect(caseAccessTargets(client, USER)).toEqual([
      { caseId: caseIdOf(3451), roomId: evidence?.roomId ?? null },
    ]);
  });

  it("#342 AC-2 U2: 参加者の概要もある案件でも、実績があれば、部屋の ID は実績の読み方のもの", async () => {
    const listedRoom = "01JTESTROOM342000000000EV8";
    client.setQueryData(
      ["cases", "summary", USER, caseIdOf(3452)],
      caseSummary(3452),
    );
    await fetched(["threads", "list"], {
      pages: [
        {
          items: [
            threadItem(31, {
              room: {
                kind: "channel",
                id: listedRoom,
                name: "[UNIT_TEST]342一覧の部屋",
              },
              caseId: caseIdOf(3452),
            }),
          ],
          nextCursor: null,
        },
      ],
      pageParams: [undefined],
    });
    const evidence = caseRoomEvidence(client, USER, caseIdOf(3452));
    expect(evidence).toEqual({ roomId: listedRoom });
    expect(caseAccessTargets(client, USER)).toEqual([
      { caseId: caseIdOf(3452), roomId: listedRoom },
    ]);
  });

  it("#342 AC-2 U2: 参加者の概要だけの案件は対象になるが、caseRoomEvidence は実績なし（undefined）のまま", () => {
    client.setQueryData(
      ["cases", "summary", USER, caseIdOf(3453)],
      caseSummary(3453),
    );
    expect(caseRoomEvidence(client, USER, caseIdOf(3453))).toBeUndefined();
    expect(caseAccessTargets(client, USER)).toEqual([
      { caseId: caseIdOf(3453), roomId: caseRoomId(3453) },
    ]);
  });

  it("#342 AC-2 U2: ほかの利用者の概要は、実績の部屋の対応にも使わない（その部屋のメッセージがあっても対象にしない）", async () => {
    client.setQueryData(
      ["cases", "summary", OTHER_USER, caseIdOf(3454)],
      caseSummary(3454),
    );
    await fetched(["messages", "room", caseRoomId(3454)], []);
    expect(caseRoomEvidence(client, USER, caseIdOf(3454))).toBeUndefined();
    expect(caseAccessTargets(client, USER)).toEqual([]);
  });
});

// ミューテーション診断（2026-11-28）の後の補い：関係の無い Query・まだデータの無い Query・案件と結び付かないチャンネルが混ざっても、
// 対象の捕捉を例外で止めず、関係する案件だけを返す（捕捉が例外になると、隠したまま再試行になり、資格があっても外れない。C-212 の (b)）
describe("#342 AC-2 T35〜T37 混ざった Query の中から、関係する案件だけを返す", () => {
  async function fetchedCaseReply() {
    await fetched(
      ["messages", "thread", "p3461"],
      repliesData(1, caseRoomId(3461), caseIdOf(3461)),
    );
  }

  it("#342 AC-2 T35: 関係の無いキーに、正常な値として null を持つ Query があっても、例外にせず、関係する案件だけを返す", async () => {
    await fetchedCaseReply();
    client.setQueryData(["unrelated", "342", "null-value"], null);
    client.setQueryData(["cases", "list", USER, "joined", "active"], null);
    await fetched(["profiles", "342"], {
      id: caseIdOf(3462),
      name: "[UNIT_TEST]342",
    });
    expect(caseAccessTargets(client, USER)).toEqual([
      { caseId: caseIdOf(3461), roomId: caseRoomId(3461) },
    ]);
  });

  it.each([
    ["案件の概要", ["cases", "summary", USER, caseIdOf(3463)]],
    ["案件の詳細", ["cases", "detail", USER, caseIdOf(3463)]],
    ["チャンネルの詳細", ["channels", "detail", caseRoomId(3463)]],
  ] as [string, unknown[]][])(
    "#342 AC-2 T36: まだデータの無い%sの Query があっても、例外にせず、取得済みの正しい対象だけを返す",
    async (_label, queryKey) => {
      await fetchedCaseReply();
      // 取得の途中（データが無い）の Query を作る
      client.getQueryCache().build(client, { queryKey });
      expect(client.getQueryData(queryKey)).toBeUndefined();
      expect(caseAccessTargets(client, USER)).toEqual([
        { caseId: caseIdOf(3461), roomId: caseRoomId(3461) },
      ]);
    },
  );

  it("#342 AC-2 T37: 案件と結び付かない通常のチャンネルの詳細（caseId が null）と、通常のスレッドの行があっても、通常のチャンネルを案件として返さない", async () => {
    await fetched(
      ["channels", "detail", PLAIN_ROOM],
      channelDetail(PLAIN_ROOM, null),
    );
    await fetched(
      ["messages", "room", PLAIN_ROOM],
      [message(1, { roomId: PLAIN_ROOM })],
    );
    await fetched(["threads", "list"], {
      pages: [
        {
          items: [
            threadItem(41, {
              room: {
                kind: "channel",
                id: PLAIN_ROOM,
                name: "[UNIT_TEST]342通常の部屋",
              },
            }),
          ],
          nextCursor: null,
        },
      ],
      pageParams: [undefined],
    });
    await fetched(
      ["messages", "thread", "pplain342"],
      repliesData(2, PLAIN_ROOM, null),
    );
    expect(caseAccessTargets(client, USER)).toEqual([]);
  });
});
