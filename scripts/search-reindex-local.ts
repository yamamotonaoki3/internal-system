// 既存のメッセージの検索の索引を、手元の D1 だけに作る（#155・D-9。node scripts/db-local.ts <環境> search-reindex から呼ぶ）。
// wrangler の getPlatformProxy（Miniflare）で、db-local.ts の他の操作と同じ保存先（.wrangler/state/<環境>/v3）の D1 を開き、
// 本番と同じ部品（backend/src/db/search-reindex.ts の reindexMessages・reindexCases）を呼ぶ。remote の結び付けは使わない（remoteBindings: false）。
// 本文の値は画面に出さない（件数だけを出す）。
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localStatePath, type LocalEnvironment } from "./local-env.ts";

// backend のコードは拡張子を省いて相対 import する（バンドラ前提）。Node で直接読むため、省いた相対の指定だけ .ts を補う
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      /^\.\.?\//.test(specifier) &&
      !/\.[cm]?[jt]sx?$/.test(specifier) &&
      context.parentURL !== undefined
    ) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate)))
        return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});

export async function reindexLocalSearch(
  environment: LocalEnvironment,
): Promise<void> {
  const { getPlatformProxy } = await import("wrangler");
  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await import("../backend/db/schema.ts");
  const { reindexCases, reindexMessages } =
    await import("../backend/src/db/search-reindex.ts");
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    persist: { path: `${localStatePath(environment)}/v3` },
    // 値は db-local.ts が読み込み済み。ここでは .env 系を読まない
    envFiles: [],
    remoteBindings: false,
  });
  try {
    const db = drizzle(proxy.env.DB, { schema });
    let after: string | null = null;
    let rounds = 0;
    for (;;) {
      const last: string | null = await reindexMessages(db, {
        afterId: after,
      });
      if (last === null) break;
      after = last;
      rounds += 1;
    }
    // 案件の件名（#155・155-C）。メッセージを最後まで登録した後に、同じ形で最後まで繰り返す
    let afterCase: string | null = null;
    let caseRounds = 0;
    for (;;) {
      const last: string | null = await reindexCases(db, {
        afterId: afterCase,
      });
      if (last === null) break;
      afterCase = last;
      caseRounds += 1;
    }
    const counts = await proxy.env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM search_documents) AS documents, (SELECT COUNT(*) FROM search_fts) AS fts",
    ).first<{ documents: number; fts: number }>();
    console.log(
      `検索の索引を作りました：メッセージ ${String(rounds)}回・案件 ${String(caseRounds)}回に分けて登録。対応の表 ${String(counts?.documents)}件・検索用の表 ${String(counts?.fts)}件`,
    );
  } finally {
    await proxy.dispose();
  }
}
