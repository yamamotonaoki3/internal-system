// #155（155-A）U-3：db:generate のラッパーの引数の検査（計画 5章、利用者の決定 D-1：検索用の表の migration を手で書く例外。生成の手順は --custom --name）。
// scripts/db-local.ts は読み込むと main を実行するため、引数の検査を純粋な関数として別のファイルに出す（契約）。
// 期待：引数なし → ["generate"]／--name <名前> → ["generate","--name",名前]（既存どおり）／--custom --name <名前> → ["generate","--custom","--name",名前]。
//   名前の検査（英字で始まり、英数字・_・- だけ）は --name と同じ。ほかの引数・順の違い・重複・余分な引数は LocalEnvironmentError で拒否する。
// 契約（実装前の仮置き。実装の担当へ）：
//   scripts/db-generate-args.ts が generateArgs(options: string[]): string[] を公開し、scripts/db-local.ts はそれを使う。拒否は LocalEnvironmentError（scripts/local-env.ts）。
//   このファイルを package.json の "test"（node --test の一覧）に足すのは、実装の担当（設定の変更のため、テストの担当は変えない）。
// 実行：node --test scripts/db-generate-args.test.mjs
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateArgs } from "./db-generate-args.ts";
import { LocalEnvironmentError } from "./local-env.ts";

describe("#155 D-1 U-3 db:generate の引数の検査", () => {
  it("#155 D-1 U-3: 引数なしは generate だけ（既存どおり）", () => {
    assert.deepEqual(generateArgs([]), ["generate"]);
  });

  it("#155 D-1 U-3: --name <名前> を通す（既存どおり）", () => {
    assert.deepEqual(generateArgs(["--name", "add_search_documents"]), [
      "generate",
      "--name",
      "add_search_documents",
    ]);
  });

  it("#155 D-1 U-3: --custom --name <名前> を通す（手で書く migration の生成）", () => {
    assert.deepEqual(generateArgs(["--custom", "--name", "add_search_fts"]), [
      "generate",
      "--custom",
      "--name",
      "add_search_fts",
    ]);
  });

  it("#155 D-1 U-3: --custom でも、不正な名前は拒否する（--name と同じ検査）", () => {
    for (const name of ["1abc", "add search", "add;rm", "", "../x", "名前"])
      assert.throws(
        () => generateArgs(["--custom", "--name", name]),
        LocalEnvironmentError,
        `名前 ${JSON.stringify(name)} を拒否する`,
      );
  });

  it("#155 D-1 U-3: --name でも、不正な名前は拒否する（既存どおり）", () => {
    assert.throws(
      () => generateArgs(["--name", "1abc"]),
      LocalEnvironmentError,
    );
  });

  it("#155 D-1 U-3: ほかの引数・順の違い・重複・余分・欠けは拒否する", () => {
    const rejected = [
      ["--custom"],
      ["--custom", "add_search_fts"],
      ["--name", "add_search_fts", "--custom"],
      ["--custom", "--custom", "--name", "add_search_fts"],
      ["--custom", "--name", "add_search_fts", "--extra"],
      ["--custom", "--name"],
      ["--sql", "--name", "add_search_fts"],
      ["--config", "x", "--name", "add_search_fts"],
      ["--name"],
    ];
    for (const options of rejected)
      assert.throws(
        () => generateArgs(options),
        LocalEnvironmentError,
        `引数 ${JSON.stringify(options)} を拒否する`,
      );
  });
});
