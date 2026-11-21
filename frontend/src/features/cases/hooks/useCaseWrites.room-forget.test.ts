// #323（PR #328 の絞ったミューテーション診断の生き残りへの追加）：資格を失った案件の、部屋の分の片付け（forgetCaseContent）と、
// 部屋の ID の求め方（cachedCaseRoomId）。期待は設計書 docs/design/cases.md の「資格の喪失の後片付け」と、関数の説明から決める。
// - cachedCaseRoomId：詳細の channelId、なければ概要の channelId、どちらもなければ null（退出の後片付けでは、概要の channelId が先に null になる）
// - "room"：親のメッセージの部屋がこの部屋のスレッドだけを取り除く（移動先のスレッドを巻き込まない）
// - スレッドの一覧：この部屋の行だけを、呼び出しの中で（同期に）除く。取得の途中なら取り消す。roomId が null なら触れない
// 否定の確認が空振りしないよう、先に「ある」ことを確かめてから操作する。キーは期待の独立のため、配列で直接書く。
// 案件・部屋・人は互いに別の値にする。データは架空（testuser_323_・[UNIT_TEST]）。
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { cachedCaseRoomId, forgetCaseContent } from "./useCaseWrites";

const USER = "01JTESTUSER323000000000RF1";
const CASE = "01JTESTCASE323000000000RF1";
const ROOM = "01JTESTROOM323000000000RF1";
const OTHER_ROOM = "01JTESTROOM323000000000RF2";
const SUMMARY_ROOM = "01JTESTROOM323000000000RF3";
const PARENT = "01JTESTMSG3230000000000RF1";
const OTHER_PARENT = "01JTESTMSG3230000000000RF2";
const LOADING_PARENT = "01JTESTMSG3230000000000RF3";
const SHAPELESS_PARENT = "01JTESTMSG3230000000000RF4";
const SECRET = "[UNIT_TEST]323部屋の中身 testuser_323_member";

const DETAIL = ["cases", "detail", USER, CASE] as const;
const SUMMARY = ["cases", "summary", USER, CASE] as const;
const THREAD_LIST = ["threads", "list"] as const;
const UNREAD_COUNTS = ["unread", "counts"] as const;

const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

const has = (client: QueryClient, key: readonly string[]) =>
  client.getQueryCache().find({ queryKey: [...key], exact: true }) !==
  undefined;

const threadRow = (roomId: string, n: number) => ({
  parent: { id: `01JTESTMSG3230000000000RT${n}`, body: SECRET },
  room: { kind: "channel", id: roomId, name: "[UNIT_TEST]323部屋" },
  lastReplyAt: "2026-11-20T00:00:00.000Z",
  unreadCount: 1,
});

const threadList = () => ({
  pages: [
    { items: [threadRow(ROOM, 1), threadRow(OTHER_ROOM, 2)] },
    { items: [threadRow(ROOM, 3)] },
  ],
  pageParams: [undefined, "cursor-2"],
});

type ThreadPages = ReturnType<typeof threadList>;

const threadRoomIds = (client: QueryClient) =>
  (client.getQueryData<ThreadPages>([...THREAD_LIST])?.pages ?? [])
    .flatMap((page) => page.items)
    .map((row) => row.room.id);

/** 応答を返さない取得を始める（取得の途中の状態を作る） */
function startPendingFetch(client: QueryClient, queryKey: readonly string[]) {
  void client
    .fetchQuery({
      queryKey: [...queryKey],
      queryFn: () => new Promise<never>(() => undefined),
      staleTime: 0,
    })
    .catch(() => undefined);
}

const fetchStatusOf = (client: QueryClient, key: readonly string[]) =>
  client.getQueryState([...key])?.fetchStatus;

describe("#323 cachedCaseRoomId：案件の部屋の ID を、詳細、なければ概要から求める", () => {
  it("#323 AC-1: 詳細だけがあるときは、詳細の channelId", () => {
    const client = newClient();
    client.setQueryData([...DETAIL], { channelId: ROOM });
    expect(cachedCaseRoomId(client, USER, CASE)).toBe(ROOM);
  });

  it("#323 AC-1: 概要だけがあるとき（詳細がまだない・先に消えた）は、概要の channelId", () => {
    const client = newClient();
    client.setQueryData([...SUMMARY], { channelId: SUMMARY_ROOM });
    expect(cachedCaseRoomId(client, USER, CASE)).toBe(SUMMARY_ROOM);
  });

  it("#323 AC-1 退出の後片付けの順: 詳細が channelId を持ち、概要の channelId が null（非参加の形に書き換え済み）なら、詳細のもの", () => {
    const client = newClient();
    client.setQueryData([...DETAIL], { channelId: ROOM });
    client.setQueryData([...SUMMARY], { channelId: null });
    expect(cachedCaseRoomId(client, USER, CASE)).toBe(ROOM);
  });

  it("#323 AC-1: 詳細と概要で channelId が違うときは、詳細のものを優先する", () => {
    const client = newClient();
    client.setQueryData([...DETAIL], { channelId: ROOM });
    client.setQueryData([...SUMMARY], { channelId: SUMMARY_ROOM });
    expect(cachedCaseRoomId(client, USER, CASE)).toBe(ROOM);
  });

  it("#323 AC-1: 詳細も概要もないときは null（例外を投げない）", () => {
    const client = newClient();
    expect(cachedCaseRoomId(client, USER, CASE)).toBeNull();
  });
});

describe('#323 forgetCaseContent の "room"：この部屋のスレッドだけを取り除く', () => {
  const THREAD = ["messages", "thread", PARENT] as const;
  const OTHER_THREAD = ["messages", "thread", OTHER_PARENT] as const;
  const LOADING_THREAD = ["messages", "thread", LOADING_PARENT] as const;
  const SHAPELESS_THREAD = ["messages", "thread", SHAPELESS_PARENT] as const;
  /** スレッドではないキー（データの形が似ていても、スレッドの絞り込みの対象にしない） */
  const NOT_A_THREAD = ["notifications", "list", USER] as const;

  function seed() {
    const client = newClient();
    client.setQueryData([...THREAD], {
      parent: { id: PARENT, roomId: ROOM, body: SECRET },
    });
    client.setQueryData([...OTHER_THREAD], {
      parent: { id: OTHER_PARENT, roomId: OTHER_ROOM, body: SECRET },
    });
    // 取得の途中で、まだデータのないスレッド（部屋が分からない）
    startPendingFetch(client, LOADING_THREAD);
    // 親を持たない形のデータ
    client.setQueryData([...SHAPELESS_THREAD], { items: [] });
    client.setQueryData([...NOT_A_THREAD], {
      parent: { id: PARENT, roomId: ROOM, body: SECRET },
    });
    for (const key of [
      THREAD,
      OTHER_THREAD,
      LOADING_THREAD,
      SHAPELESS_THREAD,
      NOT_A_THREAD,
    ])
      expect(has(client, key)).toBe(true);
    return client;
  }

  it("#323 AC-1 / AC-2: 親の roomId がこの部屋のスレッドは取り除き、別の部屋のスレッドは残す", () => {
    const client = seed();
    void forgetCaseContent(client, USER, CASE, ROOM, "room");
    expect(has(client, THREAD)).toBe(false);
    expect(client.getQueryData([...OTHER_THREAD])).toEqual(
      expect.objectContaining({
        parent: expect.objectContaining({ roomId: OTHER_ROOM }),
      }),
    );
  });

  it("#323 AC-2: スレッド以外のキーは、データの親の roomId がこの部屋でも、スレッドの絞り込みで取り除かない", () => {
    const client = seed();
    void forgetCaseContent(client, USER, CASE, ROOM, "room");
    expect(has(client, THREAD)).toBe(false);
    expect(has(client, NOT_A_THREAD)).toBe(true);
  });

  it('#323 既知の差の固定（docs/design/cases.md「資格を失った後に、参加者だけの中身が残りうる場所」(1)）: "room" では、取得の途中でデータのないスレッドと、親を持たない形のデータは残し、例外を投げない', () => {
    // いまの動きを既知の差として固定する（#323）。部屋が分からないものを取り除くと、移動先のスレッドを巻き込みうるため
    const client = seed();
    expect(() =>
      forgetCaseContent(client, USER, CASE, ROOM, "room"),
    ).not.toThrow();
    expect(has(client, THREAD)).toBe(false);
    expect(has(client, LOADING_THREAD)).toBe(true);
    expect(has(client, SHAPELESS_THREAD)).toBe(true);
  });

  it('#323 対照: "all"（表示中）では、データのないもの・別の部屋のものも含め、スレッドをすべて取り除く。スレッド以外のキーは残す', () => {
    const client = seed();
    void forgetCaseContent(client, USER, CASE, ROOM, "all");
    for (const key of [THREAD, OTHER_THREAD, LOADING_THREAD, SHAPELESS_THREAD])
      expect(has(client, key)).toBe(false);
    expect(has(client, NOT_A_THREAD)).toBe(true);
  });
});

describe("#323 forgetCaseContent のスレッドの一覧：この部屋の行だけを除き、取得の途中なら取り消す", () => {
  /** スレッドとは関係のない、取得の途中のクエリ（取り消してはいけない） */
  const UNRELATED_FETCHING = ["notifications", "count", USER] as const;

  function seed() {
    const client = newClient();
    client.setQueryData([...THREAD_LIST], threadList());
    expect(threadRoomIds(client)).toEqual([ROOM, OTHER_ROOM, ROOM]);
    return client;
  }

  it("#323 AC-1: 取得の途中でも、呼び出しの直後（待たずに、同期で）この部屋の行が消え、ほかの部屋の行は残る", () => {
    const client = seed();
    startPendingFetch(client, THREAD_LIST);
    expect(fetchStatusOf(client, THREAD_LIST)).toBe("fetching");

    void forgetCaseContent(client, USER, CASE, ROOM);

    expect(threadRoomIds(client)).toEqual([OTHER_ROOM]);
  });

  it("#323 AC-1: 取り消しで元の状態に戻った後（返す Promise の完了の後）も、この部屋の行はなく、取得は止まっている", async () => {
    const client = seed();
    startPendingFetch(client, THREAD_LIST);

    await forgetCaseContent(client, USER, CASE, ROOM);

    expect(fetchStatusOf(client, THREAD_LIST)).toBe("idle");
    expect(threadRoomIds(client)).toEqual([OTHER_ROOM]);
  });

  it("#323 AC-2: スレッドの一覧の取り消しは、スレッドと関係のない、取得の途中のクエリを取り消さない", async () => {
    const client = seed();
    startPendingFetch(client, THREAD_LIST);
    startPendingFetch(client, UNRELATED_FETCHING);
    expect(fetchStatusOf(client, UNRELATED_FETCHING)).toBe("fetching");

    await forgetCaseContent(client, USER, CASE, ROOM);

    expect(fetchStatusOf(client, THREAD_LIST)).toBe("idle");
    expect(fetchStatusOf(client, UNRELATED_FETCHING)).toBe("fetching");
  });

  it("#323 AC-1: 返す Promise は、取り消しが完了するまで解決しない", async () => {
    const client = seed();
    startPendingFetch(client, THREAD_LIST);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // 取り消しの完了を、テストが離すまで遅らせる（取り消しそのものは本来の処理で行う）
    const original = client.cancelQueries.bind(client);
    vi.spyOn(client, "cancelQueries").mockImplementation((...args) =>
      original(...args).then(() => gate),
    );
    let settled = false;
    const forgetting = forgetCaseContent(client, USER, CASE, ROOM).then(() => {
      settled = true;
    });

    // マイクロタスクを流し切る（時間で待つのではなく、ほかの処理の完了を待つため）
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    release();
    await forgetting;
    expect(settled).toBe(true);
  });

  it("#323 AC-2: roomId が null の案件では、スレッドの一覧の取得の途中の状態を取り消さず、データも変えない", async () => {
    const client = seed();
    startPendingFetch(client, THREAD_LIST);
    const before = client.getQueryData([...THREAD_LIST]);

    await forgetCaseContent(client, USER, CASE, null);

    expect(fetchStatusOf(client, THREAD_LIST)).toBe("fetching");
    expect(client.getQueryData([...THREAD_LIST])).toBe(before);
  });
});

describe("#323 forgetCaseContent の未読の件数：この部屋の分だけを除き、ないものは作らない", () => {
  it("#323 AC-2: 未読の件数のキャッシュがまだないときは、件数のキャッシュを作らない（空の件数で「未読なし」と見せない）", async () => {
    const client = newClient();
    expect(client.getQueryData([...UNREAD_COUNTS])).toBeUndefined();

    await forgetCaseContent(client, USER, CASE, ROOM);

    expect(client.getQueryData([...UNREAD_COUNTS])).toBeUndefined();
  });

  it("#323 AC-1 / AC-2: この部屋の件数は除き、ほかの部屋の件数は残す", async () => {
    const client = newClient();
    client.setQueryData(
      [...UNREAD_COUNTS],
      new Map([
        [ROOM, 3],
        [OTHER_ROOM, 5],
      ]),
    );

    await forgetCaseContent(client, USER, CASE, ROOM);

    expect([
      ...(client.getQueryData<Map<string, number>>([...UNREAD_COUNTS]) ?? []),
    ]).toEqual([[OTHER_ROOM, 5]]);
  });
});
