// #155（155-C）4-2 AC-1〜AC-3・4-1 AC-3：案件の検索の Repository（searchCases。DB の層）。計画 7章 R-1・R-3・R-3b・R-4・R-6。
// 期待は、要件（4-2 AC-1：終了を含むすべての案件の件名。AC-2：非参加者の結果は概要の項目だけ。AC-3：案件番号の前方一致〔正規化〕・取引先の現在の名前）、
//   利用者の決定（2026-11-21）：取引先名は部分一致／案件番号はハイフンを位置に依らず無視して先頭から比べる・大文字小文字を区別しない・
//   空白は語の前後だけを除き、途中の空白は保つ（途中に空白のある語は番号に一致しない）、
//   計画 4章（4者で結果の案件の集合は同じ。isParticipant だけが主体で変わる）・5章（cases を基にした1つの SELECT。並びは cases.id の降順。
//   件名の一致は、いまの件名と写しの元の件名が同じ行だけ〔索引が遅れても古い件名で出さない〕。説明は対象にしない。matchedIn は title → caseNumber → client の順）、
//   R1-7（条件を外すと落ちる事例）から決める。実装から写さない。
// 契約（実装前の仮置き。実装の担当へ）：backend/src/db/case.repository.ts に
//   createCaseRepository(db).searchCases(input: {
//     actorId: string; term: string /* 前後の空白を除いた語（Service が検証済み） */; limit: number; cursor?: CursorPayload;
//   }): Promise<{ items: CaseSearchItem[]; nextCursor: string | null }>
//   export type CaseSearchItem = {
//     id; caseNumber; title; status: "active" | "closed"; client: { id; name; isActive }; departments: { id; name; isActive }[]（名前の順・同じなら ID の順）;
//     dueDate: string | null; progress: { done; total } | null（削除済みの TODO を除く。0件は null）; isParticipant: boolean;
//     matchedIn: ("title" | "caseNumber" | "client")[]（1つ以上。この順）
//   }  … 説明・参加者・参加者数・管理の資格・納期の変更の可否・部屋の ID・最終更新・版は持たない（項目そのものを持たない）
// 語は通し番号つきの固定の語で、対象の文字列に続いた形で含まれ、ほかの案件の件名・番号・取引先名・説明に含まれないことを、最初の試験で突き合わせる。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  CASEREQ_NOW,
  insertClient,
  setClientActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { setCaseColumns } from "../../test/case-edit-fixtures";
import { insertTodo, todoIdAt } from "../../test/case-todo-fixtures";
import {
  cleanupCaseTitleIndex,
  insertCaseTitleIndexRow,
  runCaseTitleIndexStatements,
} from "../../test/search-case-fixtures";
import { cleanupSearchIndex } from "../../test/search-fixtures";
import { decodeCursor } from "../lib/cursor";
import { withCases } from "./case.repository";

type Key =
  | "title3"
  | "eng"
  | "num"
  | "triple"
  | "client"
  | "kind"
  | "kindOk"
  | "ref"
  | "refHost"
  | "refOk"
  | "stale"
  | "staleOk"
  | "desc"
  | "descOk"
  | "vA"
  | "vB"
  | "vC"
  | "p1"
  | "p2"
  | "p3"
  | "p4"
  | "p5";

type ClientKey = "A" | "K" | "L" | "M" | "W";

type Spec = {
  n: number;
  code: string;
  client: ClientKey;
  title: string;
  description?: string;
  status?: "active" | "closed";
  /** 参加者（V＝memberS1・S2＝memberS2） */
  members?: ("V" | "S2")[];
  /** 件名の写しの作り方：組を当てる（normal）・作らない（none） */
  index?: "normal" | "none";
};

/** 取引先の名前（insertClient が先頭に [UNIT_TEST] を付ける）。L には案件を作らない */
const CLIENT_NAMES: Record<Exclude<ClientKey, "A">, string> = {
  K: "鷲尾精機155C",
  L: "楢崎物産",
  M: "QZM-2611商会",
  W: "白檀書庫商事",
};

const T = "[UNIT_TEST]";
/** 案件の定義。p1〜p5 は、ID の順（n）と登録の順（PAGE_ORDER）を違えたページの確認用 */
const SPECS: Record<Key, Spec> = {
  title3: {
    n: 1701,
    code: "QZP",
    client: "A",
    title: `${T}蒼穹灯台の改修`,
    members: ["V"],
  },
  eng: { n: 1702, code: "QZP", client: "A", title: `${T}Zephyrine港湾の調査` },
  num: { n: 1711, code: "QZN", client: "A", title: `${T}番号確認用の件名` },
  triple: { n: 1712, code: "QZM", client: "M", title: `${T}QZM-2611の再発注` },
  client: {
    n: 1721,
    code: "QZK",
    client: "K",
    title: `${T}取引先確認用の件名`,
  },
  // 計画 R1-7：kind=message の行に、ref_id＝この案件・source_body＝いまの件名（語を含む）を入れ、正しい件名の行は入れない
  kind: {
    n: 1731,
    code: "QZP",
    client: "A",
    title: `${T}翡翠回廊の点検`,
    index: "none",
  },
  kindOk: { n: 1732, code: "QZP", client: "A", title: `${T}翡翠回廊の清掃` },
  // 件名の行が無い案件。refHost の ID を ref_id にした行の source_body が、この案件の件名
  ref: {
    n: 1733,
    code: "QZP",
    client: "A",
    title: `${T}琥珀橋梁の補修`,
    index: "none",
  },
  refHost: {
    n: 1734,
    code: "QZP",
    client: "A",
    title: `${T}参照先の件名`,
    index: "none",
  },
  refOk: { n: 1735, code: "QZP", client: "A", title: `${T}琥珀橋梁の塗装` },
  // 写しを作った後に、組を当てずに DB の上で件名を書き換える（STALE_TITLE）
  stale: { n: 1736, code: "QZP", client: "A", title: `${T}瑠璃水門の更新` },
  staleOk: { n: 1737, code: "QZP", client: "A", title: `${T}瑠璃水門の点検` },
  desc: {
    n: 1738,
    code: "QZP",
    client: "A",
    title: `${T}説明確認用の件名`,
    description: `${T}紫苑倉庫の説明`,
  },
  descOk: { n: 1739, code: "QZP", client: "A", title: `${T}紫苑倉庫の棚卸` },
  // 見える範囲：vC（終了）・vA（V が参加）・vB（S2 だけが参加）。ID の順は vB > vA > vC
  vC: {
    n: 1751,
    code: "QZP",
    client: "A",
    title: `${T}鳳凰計画の完了分`,
    status: "closed",
    members: ["V"],
  },
  vA: {
    n: 1752,
    code: "QZP",
    client: "A",
    title: `${T}鳳凰計画の第一期`,
    members: ["V"],
  },
  vB: {
    n: 1753,
    code: "QZP",
    client: "A",
    title: `${T}鳳凰計画の第二期`,
    members: ["S2"],
  },
  p1: { n: 1801, code: "QZP", client: "A", title: `${T}白檀書庫の棚一` },
  p2: { n: 1802, code: "QZP", client: "A", title: `${T}白檀書庫の棚二` },
  p3: { n: 1803, code: "QZP", client: "W", title: `${T}白檀書庫の棚三` },
  p4: { n: 1804, code: "QZP", client: "A", title: `${T}白檀書庫の棚四` },
  p5: { n: 1805, code: "QZP", client: "A", title: `${T}白檀書庫の棚五` },
};
/** 登録の順（ID の順と違える） */
const PAGE_ORDER: readonly Key[] = ["p3", "p1", "p5", "p2", "p4"];
const STALE_TITLE = `${T}群青堤防の更新`;

let w: CaseWorld;
let V: string;
let ids: Record<Key, string>;
let seeded: Record<Key, SeededCase>;
let clientIds: Record<ClientKey, string>;

const DEFAULT_LIMIT = 50;

async function search(
  term: string,
  options: { actorId?: string; limit?: number; cursor?: string | null } = {},
) {
  return withCases(env, (r) =>
    r.searchCases({
      actorId: options.actorId ?? V,
      term,
      limit: options.limit ?? DEFAULT_LIMIT,
      ...(options.cursor == null
        ? {}
        : { cursor: decodeCursor(options.cursor) }),
    }),
  );
}

const idsOf = async (term: string, actorId?: string) =>
  (await search(term, actorId === undefined ? {} : { actorId })).items.map(
    (item) => item.id,
  );

const idList = (keys: readonly Key[]) => keys.map((k) => ids[k]);

beforeEach(async () => {
  w = await setupCaseWorld();
  V = w.memberS1.id;
  clientIds = {
    A: w.clientA.id,
    K: (await insertClient(CLIENT_NAMES.K, { code: "QZK" })).id,
    L: (await insertClient(CLIENT_NAMES.L, { code: "QZL" })).id,
    M: (await insertClient(CLIENT_NAMES.M, { code: "QZM" })).id,
    W: (await insertClient(CLIENT_NAMES.W, { code: "QZW" })).id,
  };
  const order: Key[] = [
    ...(Object.keys(SPECS) as Key[]).filter((k) => !PAGE_ORDER.includes(k)),
    ...PAGE_ORDER,
  ];
  const entries: [Key, SeededCase][] = [];
  for (const key of order) {
    const spec = SPECS[key];
    const memberIds = (spec.members ?? []).map((m) =>
      m === "V" ? V : w.memberS2.id,
    );
    entries.push([
      key,
      await seedCase({
        n: spec.n,
        clientId: clientIds[spec.client],
        code: spec.code,
        title: spec.title,
        ...(spec.description === undefined
          ? {}
          : { description: spec.description }),
        createdBy: V,
        departmentIds: [w.deptS.id],
        ...(spec.status === undefined ? {} : { status: spec.status }),
        members: memberIds.map((userId, i) => ({
          userId,
          joinedAt: joinedAt(i + 1),
        })),
      }),
    ]);
  }
  seeded = Object.fromEntries(entries) as Record<Key, SeededCase>;
  ids = Object.fromEntries(entries.map(([k, s]) => [k, s.id])) as Record<
    Key,
    string
  >;
  for (const key of order)
    if (SPECS[key].index !== "none")
      await runCaseTitleIndexStatements(ids[key]);
  // kind：種類だけが違う行（いまの件名との一致は成り立つ）
  await insertCaseTitleIndexRow({
    caseId: ids.kind,
    kind: "message",
    createdAt: CASEREQ_NOW,
    sourceBody: SPECS.kind.title,
  });
  // ref：別の案件（refHost）の ID を ref_id にした、ref の件名の行
  await insertCaseTitleIndexRow({
    caseId: ids.refHost,
    createdAt: CASEREQ_NOW,
    sourceBody: SPECS.ref.title,
  });
  // stale：組を当てずに件名を書き換える（写しは古い件名のまま）
  await setCaseColumns(ids.stale, { title: STALE_TITLE });
});

afterEach(async () => {
  try {
    await cleanupSearchIndex();
  } finally {
    await cleanupCaseTestData();
    await cleanupCaseTitleIndex();
  }
});

// ---- 語と文字列の突き合わせ（否定の確認が常に通る形にならないように） ----

type Label =
  `${"title" | "desc" | "number" | "bare"}:${Key}` | `client:${ClientKey}`;

/** 語が「続いた形で」含まれる文字列のラベル（英字の大小は区別しない。bare は案件番号からハイフンを除いたもの） */
function containing(term: string): Label[] {
  const lower = term.toLowerCase();
  const labels: Label[] = [];
  for (const key of Object.keys(SPECS) as Key[]) {
    const spec = SPECS[key];
    const title = key === "stale" ? STALE_TITLE : spec.title;
    const number = `${spec.code}-261117-${String(spec.n).padStart(4, "0")}`;
    if (title.toLowerCase().includes(lower)) labels.push(`title:${key}`);
    if ((spec.description ?? "").toLowerCase().includes(lower))
      labels.push(`desc:${key}`);
    if (number.toLowerCase().includes(lower)) labels.push(`number:${key}`);
    if (number.replaceAll("-", "").toLowerCase().includes(lower))
      labels.push(`bare:${key}`);
  }
  for (const [client, name] of Object.entries(CLIENT_NAMES))
    if (`${T}${name}`.toLowerCase().includes(lower))
      labels.push(`client:${client as ClientKey}`);
  return labels.sort();
}

const TERM_TABLE: { term: string; labels: Label[] }[] = [
  { term: "蒼穹灯台", labels: ["title:title3"] },
  { term: "蒼穹", labels: ["title:title3"] },
  { term: "zephyrine", labels: ["title:eng"] },
  { term: "zE", labels: ["title:eng"] },
  { term: "QZN-2611", labels: ["number:num"] },
  { term: "QZN2611", labels: ["bare:num"] },
  { term: "N-261117-1711", labels: ["number:num"] },
  { term: "qzm-2611", labels: ["client:M", "number:triple", "title:triple"] },
  { term: "QZM2611", labels: ["bare:triple"] },
  { term: "尾精機", labels: ["client:K"] },
  { term: "鷲尾", labels: ["client:K"] },
  { term: "精機155c", labels: ["client:K"] },
  { term: "楢崎物産", labels: ["client:L"] },
  { term: "翡翠回廊", labels: ["title:kind", "title:kindOk"] },
  { term: "琥珀橋梁", labels: ["title:ref", "title:refOk"] },
  { term: "瑠璃水門", labels: ["title:staleOk"] },
  { term: "群青堤防", labels: ["title:stale"] },
  { term: "紫苑倉庫", labels: ["desc:desc", "title:descOk"] },
  { term: "鳳凰計画", labels: ["title:vA", "title:vB", "title:vC"] },
  {
    term: "白檀書庫",
    labels: [
      "client:W",
      "title:p1",
      "title:p2",
      "title:p3",
      "title:p4",
      "title:p5",
    ],
  },
];

describe("#155 155-C 語と文字列の突き合わせ（前提の確認）", () => {
  it.each(TERM_TABLE)(
    "#155 前提: 語「$term」は、決めた文字列だけに続いた形で含まれる",
    ({ term, labels }) => {
      expect(containing(term)).toEqual([...labels].sort());
    },
  );

  it("#155 前提: 「-」を含む件名・取引先名・説明は triple の件名と取引先 M だけ、「--」はどこにも無い（番号は全件が「-」を含む）", () => {
    expect(containing("-").filter((l) => !l.startsWith("number:"))).toEqual([
      "client:M",
      "title:triple",
    ]);
    expect(containing("--")).toEqual([]);
  });
});

// ---- R-1 一致 ----

describe("#155 4-2 AC-1 4-1 AC-3 R-1 件名の一致", () => {
  it("#155 4-2 AC-1 R-1: 3文字以上（MATCH）の件名の一部で、その案件だけが出て、matchedIn は title だけ", async () => {
    const page = await search("蒼穹灯台");
    expect(page.items.map((i) => i.id)).toEqual([ids.title3]);
    expect(page.items[0]?.matchedIn).toEqual(["title"]);
    expect(page.nextCursor).toBeNull();
  });

  it("#155 4-1 AC-3 R-1: 1〜2文字（instr）の件名の一部でも、その案件だけが出る", async () => {
    const page = await search("蒼穹");
    expect(page.items.map((i) => i.id)).toEqual([ids.title3]);
    expect(page.items[0]?.matchedIn).toEqual(["title"]);
  });

  it("#155 4-1 AC-3 R-1: 英字の大文字・小文字の違いは区別しない（3文字以上・2文字）", async () => {
    expect(await idsOf("zephyrine")).toEqual([ids.eng]);
    expect(await idsOf("ZEPHYRINE")).toEqual([ids.eng]);
    expect(await idsOf("zE")).toEqual([ids.eng]);
  });

  it("#155 4-2 AC-1 R-1: 終了した案件も件名で出る（status は closed）", async () => {
    const page = await search("鳳凰計画の完了分");
    expect(page.items.map((i) => [i.id, i.status])).toEqual([
      [ids.vC, "closed"],
    ]);
  });
});

describe("#155 4-2 AC-3 R-1 案件番号の一致（利用者の決定：前方一致・ハイフンは位置に依らず無視・大小文字を区別しない）", () => {
  it.each([
    { name: "先頭一致（ハイフンあり）", term: "QZN-2611" },
    { name: "ハイフンなし", term: "QZN2611" },
    { name: "小文字", term: "qzn-2611" },
    { name: "ずれた位置のハイフン", term: "QZ-N26-11" },
    { name: "番号の全体", term: "QZN-261117-1711" },
  ])(
    "#155 4-2 AC-3 R-1: $name「$term」で、その案件だけが出て、matchedIn は caseNumber だけ",
    async ({ term }) => {
      const page = await search(term);
      expect(page.items.map((i) => i.id)).toEqual([ids.num]);
      expect(page.items[0]?.matchedIn).toEqual(["caseNumber"]);
    },
  );

  it("#155 4-2 AC-3 R-1: 番号の途中にだけある語（N-261117-1711）は0件（対照：先頭からの語では出る）", async () => {
    expect(await idsOf("QZN-2611")).toEqual([ids.num]);
    expect(await idsOf("N-261117-1711")).toEqual([]);
    expect(await idsOf("2611171711")).toEqual([]);
  });

  it("#155 4-2 AC-3 R-1: 途中に空白のある語（QZN 2611）は番号に一致しない（空白は前後だけを除く）", async () => {
    expect(await idsOf("QZN2611")).toEqual([ids.num]);
    expect(await idsOf("QZN 2611")).toEqual([]);
  });

  it("#155 4-2 AC-3 R-1: ハイフンだけの語（-・--）は番号の腕を使わない（空の語で全件の番号の先頭に一致させない）。「-」は件名・取引先名に - を含む案件だけ", async () => {
    const single = await search("-");
    expect(single.items.map((i) => i.id)).toEqual([ids.triple]);
    expect(single.items[0]?.matchedIn).toEqual(["title", "client"]);
    expect(await idsOf("--")).toEqual([]);
  });

  it("#155 4-2 AC-3 R-1: 件名・番号・取引先名のすべてで一致しても1件で、matchedIn は title・caseNumber・client の順", async () => {
    const page = await search("qzm-2611");
    expect(page.items.map((i) => i.id)).toEqual([ids.triple]);
    expect(page.items[0]?.matchedIn).toEqual(["title", "caseNumber", "client"]);
  });

  it("#155 4-2 AC-3 R-1: 同じ案件でも、ハイフンなしの語（QZM2611）は番号だけで一致し、matchedIn は caseNumber だけ", async () => {
    const page = await search("QZM2611");
    expect(page.items.map((i) => i.id)).toEqual([ids.triple]);
    expect(page.items[0]?.matchedIn).toEqual(["caseNumber"]);
  });
});

describe("#155 4-2 AC-3 R-1 全角で打った番号も一致する（利用者の決定 2026-11-21。以前の「全角は番号に当たらない」を置き換えた）", () => {
  it.each([
    { name: "全角の英字", term: "ＱＺＮ-2611" },
    { name: "全角の小文字の英字", term: "ｑｚｎ-2611" },
    { name: "全角の数字", term: "QZN-２６１１" },
    { name: "全角のハイフン（U+FF0D）", term: "QZN\uFF0D2611" },
    { name: "長音符（U+30FC）", term: "QZN\u30FC2611" },
    { name: "マイナス記号（U+2212）", term: "QZN\u22122611" },
    {
      name: "ハイフン・ダッシュの混在（U+2010・U+2013・U+2014）",
      term: "Q\u2010Z\u2013N\u20142611",
    },
    { name: "全角の番号の全体", term: "ＱＺＮ－２６１１１７－１７１１" },
  ])(
    "#155 4-2 AC-3: $name「$term」で、その案件だけが出て、matchedIn は caseNumber だけ",
    async ({ term }) => {
      const page = await search(term);
      expect(page.items.map((i) => i.id)).toEqual([ids.num]);
      expect(page.items[0]?.matchedIn).toEqual(["caseNumber"]);
    },
  );

  it("#155 4-2 AC-3: 全角でも、番号の途中にだけある語（Ｎ－２６１１１７）は0件（対照：全角の先頭からの語では出る）", async () => {
    expect(await idsOf("ＱＺＮ－２６１１")).toEqual([ids.num]);
    expect(await idsOf("Ｎ－２６１１１７－１７１１")).toEqual([]);
  });

  it("#155 4-2 AC-3: ハイフンにあたる文字だけの語（－・ーー）は番号の腕を使わず0件", async () => {
    expect(await idsOf("\uFF0D")).toEqual([]);
    expect(await idsOf("\u30FC\u30FC")).toEqual([]);
  });

  it("#155 4-2 AC-1 R-1: 件名・取引先名の照合は、全角と半角を同じにしない（全角の「ＱＺＭ－２６１１」は番号だけで一致し、件名・取引先名の「QZM-2611」には当たらない）", async () => {
    // 対照：半角では件名・番号・取引先名のすべてで一致する
    expect((await search("qzm-2611")).items[0]?.matchedIn).toEqual([
      "title",
      "caseNumber",
      "client",
    ]);
    const page = await search("ＱＺＭ－２６１１");
    expect(page.items.map((i) => i.id)).toEqual([ids.triple]);
    expect(page.items[0]?.matchedIn).toEqual(["caseNumber"]);
  });

  it("#155 4-2 AC-1 R-1: 全角の英字の件名の語（ＺＥＰＨＹＲＩＮＥ）は、半角の件名に一致しない（対照：半角では出る）", async () => {
    expect(await idsOf("zephyrine")).toEqual([ids.eng]);
    expect(await idsOf("ＺＥＰＨＹＲＩＮＥ")).toEqual([]);
  });
});

describe("#155 4-2 AC-3 C-202 (5) U+2015（水平線）入りの語は番号に一致しない", () => {
  it("#155 C-202 (5): 半角の「QZN-2611」では番号で出て、U+2015 入りの「QZN\u20152611」では0件", async () => {
    expect(
      (await search("QZN-2611")).items.map((i) => [i.id, i.matchedIn]),
    ).toEqual([[ids.num, ["caseNumber"]]]);
    expect(await idsOf("QZN\u20152611")).toEqual([]);
  });
});

describe("#155 4-2 AC-3 R-1 取引先名の一致（利用者の決定：いまの名前の部分一致・大小文字を区別しない）", () => {
  it.each([
    { name: "名前の途中の一部（3文字）", term: "尾精機" },
    { name: "名前の一部（2文字）", term: "鷲尾" },
    { name: "英字の大小文字の違い", term: "精機155c" },
  ])(
    "#155 4-2 AC-3 R-1: $name「$term」で、その取引先の案件だけが出て、matchedIn は client だけ",
    async ({ term }) => {
      const page = await search(term);
      expect(page.items.map((i) => i.id)).toEqual([ids.client]);
      expect(page.items[0]?.matchedIn).toEqual(["client"]);
    },
  );

  it("#155 4-2 AC-3 R-1: 取引先を改名すると、新しい名前で出て、古い名前では0件（発行時の名前で引かない）", async () => {
    expect(await idsOf("鷲尾精機")).toEqual([ids.client]);
    const renamed = `${T}隼田精工155C`;
    await env.DB.prepare(
      "UPDATE clients SET name = ?, name_normalized = ? WHERE id = ?",
    )
      .bind(renamed, renamed.toLowerCase(), clientIds.K)
      .run();
    expect(await idsOf("隼田精工")).toEqual([ids.client]);
    expect(await idsOf("鷲尾精機")).toEqual([]);
  });

  it("#155 4-2 AC-3 R-1: 案件の取引先を付け替えると、いまの取引先の名前で出て、番号の取引先（発行時）の名前では出ない", async () => {
    await setCaseColumns(ids.client, { client_id: clientIds.L });
    expect(await idsOf("楢崎物産")).toEqual([ids.client]);
    expect(await idsOf("鷲尾精機")).toEqual([]);
  });
});

// ---- R-3 条件を外すと落ちる事例（対象と、条件を満たす対照を同じ試験に置く） ----

describe("#155 R-3 条件を外すと落ちる事例", () => {
  it("#155 R-3 d.kind=case_title: 種類が message の行（ref_id＝案件・元の件名＝いまの件名）では、その案件は出ない。対照の案件は出る", async () => {
    expect(await idsOf("翡翠回廊")).toEqual([ids.kindOk]);
  });

  it("#155 R-3 d.ref_id の対応: 別の案件の ID を ref_id にした件名の行では、件名の持ち主も ref_id の案件も出ない。対照の案件は出る", async () => {
    expect(await idsOf("琥珀橋梁")).toEqual([ids.refOk]);
  });

  it("#155 R-3 d.source_body = k.title: 件名を書き換えて組を当てていない案件は、古い件名の語で出ない。対照の案件は出る", async () => {
    expect(await idsOf("瑠璃水門")).toEqual([ids.staleOk]);
  });

  it("#155 R-3 番号の先頭一致: 語が番号の途中にだけある案件は出ない。対照（先頭からの語）では出る", async () => {
    expect(await idsOf("QZN2611")).toEqual([ids.num]);
    expect(await idsOf("N2611171711")).toEqual([]);
  });

  it("#155 R-3 取引先の結合: 語が、案件のない別の取引先の名前にだけあるとき0件。対照（案件のある取引先の名前）では、その案件だけ", async () => {
    expect(await idsOf("鷲尾精機")).toEqual([ids.client]);
    expect(await idsOf("楢崎物産")).toEqual([]);
  });

  it("#155 R-3 説明は対象外: 語が説明にだけある案件は出ない。対照（件名にある案件）は出る", async () => {
    expect(await idsOf("紫苑倉庫")).toEqual([ids.descOk]);
  });
});

// ---- R-3b 見える範囲 ----

const ITEM_KEYS = [
  "caseNumber",
  "client",
  "departments",
  "dueDate",
  "id",
  "isParticipant",
  "matchedIn",
  "progress",
  "status",
  "title",
];

describe("#155 4-2 AC-1・AC-2 R-3b 見える範囲（4者で結果の案件の集合が同じ）", () => {
  const ACTORS = [
    { name: "参加者（memberS1）", actor: () => w.memberS1.id },
    {
      name: "参加していない担当部署のオーナー（ownerS）",
      actor: () => w.ownerS.id,
    },
    { name: "参加していない全体管理者（admin）", actor: () => w.admin.id },
    {
      name: "参加していない一般の社員（memberD1）",
      actor: () => w.memberD1.id,
    },
  ];

  it("#155 4-2 AC-1 R-3b: 4者の結果の案件の集合（進行中と終了を含む）は完全に一致し、並びも同じ", async () => {
    const results: string[][] = [];
    for (const { actor } of ACTORS)
      results.push(await idsOf("鳳凰計画", actor()));
    for (const result of results)
      expect(result).toEqual([ids.vB, ids.vA, ids.vC]);
  });

  it("#155 4-2 AC-2 R-3b: isParticipant は主体ごと（参加者は参加した案件だけ真、ほかの3者はすべて偽）", async () => {
    const flags = async (actorId: string) =>
      (await search("鳳凰計画", { actorId })).items.map((i) => [
        i.id,
        i.isParticipant,
      ]);
    expect(await flags(w.memberS1.id)).toEqual([
      [ids.vB, false],
      [ids.vA, true],
      [ids.vC, true],
    ]);
    for (const { actor } of ACTORS.slice(1))
      expect(await flags(actor())).toEqual([
        [ids.vB, false],
        [ids.vA, false],
        [ids.vC, false],
      ]);
    // 別の参加者（memberS2）は vB だけ真
    expect(await flags(w.memberS2.id)).toEqual([
      [ids.vB, true],
      [ids.vA, false],
      [ids.vC, false],
    ]);
  });

  it.each(ACTORS)(
    "#155 4-2 AC-2 R-3b: $name の結果の行は、検索の結果の項目だけを持つ（説明・参加者・参加者数・管理の資格・部屋の ID・最終更新・版を持たない）",
    async ({ actor }) => {
      const page = await search("鳳凰計画", { actorId: actor() });
      expect(page.items).toHaveLength(3);
      for (const item of page.items)
        expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
      expect(Object.keys(page).sort()).toEqual(["items", "nextCursor"]);
    },
  );
});

describe("#155 4-2 AC-2 R-1 行の項目の値", () => {
  it("#155 4-2 AC-2: 案件番号・件名・状態・取引先（id・name・isActive）・担当部署（名前の順）・納期・進捗（削除済みを除く）", async () => {
    await env.DB.prepare(
      "INSERT INTO case_departments (case_id, department_id) VALUES (?, ?)",
    )
      .bind(ids.vA, w.deptD.id)
      .run();
    await setCaseColumns(ids.vA, { due_date: "2026-12-24" });
    await insertTodo({
      id: todoIdAt(1551),
      caseId: ids.vA,
      title: "[UNIT_TEST]155C進捗1",
      createdBy: V,
      isDone: true,
    });
    await insertTodo({
      id: todoIdAt(1552),
      caseId: ids.vA,
      title: "[UNIT_TEST]155C進捗2",
      createdBy: V,
    });
    await insertTodo({
      id: todoIdAt(1553),
      caseId: ids.vA,
      title: "[UNIT_TEST]155C進捗3",
      createdBy: V,
      isDone: true,
      deletedBy: V,
    });
    const page = await search("鳳凰計画の第一期");
    const departments = [
      { id: w.deptS.id, name: w.deptS.name, isActive: true },
      { id: w.deptD.id, name: w.deptD.name, isActive: true },
    ].sort((x, y) =>
      x.name < y.name ? -1 : x.name > y.name ? 1 : x.id < y.id ? -1 : 1,
    );
    expect(page.items).toEqual([
      {
        id: ids.vA,
        caseNumber: seeded.vA.caseNumber,
        title: SPECS.vA.title,
        status: "active",
        client: { id: w.clientA.id, name: w.clientA.name, isActive: true },
        departments,
        dueDate: "2026-12-24",
        progress: { done: 1, total: 2 },
        isParticipant: true,
        matchedIn: ["title"],
      },
    ]);
  });

  it("#155 4-2 AC-2: TODO が無い案件の進捗は null、納期が無ければ null、無効な取引先は isActive が偽", async () => {
    await setClientActive(w.clientA.id, false);
    const [item] = (await search("鳳凰計画の第二期")).items;
    expect(item?.progress).toBeNull();
    expect(item?.dueDate).toBeNull();
    expect(item?.client).toEqual({
      id: w.clientA.id,
      name: w.clientA.name,
      isActive: false,
    });
  });
});

// ---- R-4 ページ ----

describe("#155 4-1 AC-3 R-4 ページ（cases.id の降順。登録の順と違えたデータ）", () => {
  async function allPages(term: string, limit: number) {
    const pages: { ids: string[]; next: string | null }[] = [];
    let cursor: string | null = null;
    for (let round = 0; round < 20; round += 1) {
      const page = await search(term, { limit, cursor });
      pages.push({ ids: page.items.map((i) => i.id), next: page.nextCursor });
      if (page.nextCursor === null) return pages;
      cursor = page.nextCursor;
    }
    throw new Error("ページが終わりません");
  }

  it("#155 R-4: limit 件ずつ、ID の降順に、重複・欠落なく出て、最後のページの nextCursor は null", async () => {
    const pages = await allPages("白檀書庫", 2);
    expect(pages.map((p) => p.ids)).toEqual([
      [ids.p5, ids.p4],
      [ids.p3, ids.p2],
      [ids.p1],
    ]);
    expect(pages[0]?.next).not.toBeNull();
    expect(pages[1]?.next).not.toBeNull();
    expect(pages[2]?.next).toBeNull();
  });

  it("#155 R-4: 件名と取引先名の両方で一致する案件（p3）も1件で、ページの境目（limit 1・3）で2回出ない", async () => {
    for (const limit of [1, 3]) {
      const all = (await allPages("白檀書庫", limit)).flatMap((p) => p.ids);
      expect({ limit, all }).toEqual({
        limit,
        all: idList(["p5", "p4", "p3", "p2", "p1"]),
      });
    }
    const [p3] = (await search("白檀書庫の棚三")).items;
    expect(p3?.matchedIn).toEqual(["title"]);
    const both = (await search("白檀書庫")).items.find((i) => i.id === ids.p3);
    expect(both?.matchedIn).toEqual(["title", "client"]);
  });

  it("#155 R-4: ちょうど limit 件なら nextCursor は null（次の有無は limit+1 件で判定する）", async () => {
    const page = await search("白檀書庫", { limit: 5 });
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });
});

// ---- R-6 途中で参加を外れる ----

describe("#155 4-2 AC-2 R-6 ページの途中で参加を外れたとき", () => {
  it("#155 R-6: 1ページ目の後に参加者から外すと、2ページ目・1ページ目の取り直しのどちらでも、その案件の isParticipant は偽", async () => {
    // 対照：外す前は真
    const beforeAll = (await search("鳳凰計画")).items;
    expect(beforeAll.find((i) => i.id === ids.vA)?.isParticipant).toBe(true);
    const first = await search("鳳凰計画", { limit: 1 });
    expect(first.items.map((i) => i.id)).toEqual([ids.vB]);
    await removeCaseMember(seeded.vA.roomId, V);
    const second = await search("鳳凰計画", {
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.items.map((i) => [i.id, i.isParticipant])).toEqual([
      [ids.vA, false],
    ]);
    const again = await search("鳳凰計画", { limit: 2 });
    expect(again.items.map((i) => [i.id, i.isParticipant])).toEqual([
      [ids.vB, false],
      [ids.vA, false],
    ]);
  });
});
