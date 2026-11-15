import assert from "node:assert/strict";
import test from "node:test";
import {
  compareSelectedFilesToStrykerReport,
  expandImportantFiles,
  selectMutationScope,
} from "./mutation-scope.mjs";

const modified = (path) => ({ path, status: "modified" });
const select = (changes, graph, important, extra = {}) =>
  selectMutationScope({
    changedFiles: changes,
    dependencyGraph: graph,
    importantFiles: important,
    ...extra,
  });

test("#258 AC-1: 変更した重要処理と、非重要ファイル・再exportを挟んだ推移的な参照元を選ぶ", () => {
  const graph = {
    "backend/src/lib/core.ts": [],
    "backend/src/lib/reexport.ts": ["backend/src/lib/core.ts"],
    "backend/src/services/consumer.ts": ["backend/src/lib/reexport.ts"],
    "backend/src/routes/consumer.ts": ["backend/src/services/consumer.ts"],
    "backend/src/services/unrelated.ts": [],
  };
  const result = select([modified("backend/src/lib/core.ts")], graph, [
    "backend/src/lib/core.ts",
    "backend/src/services/consumer.ts",
    "backend/src/services/unrelated.ts",
  ]);
  assert.equal(result.mode, "limited");
  assert.deepEqual([...result.targets].sort(), [
    "backend/src/lib/core.ts",
    "backend/src/services/consumer.ts",
  ]);
  assert.ok(result.reason);
});

test("#258 AC-1: 非重要source変更でも参照元の重要処理を選ぶ", () => {
  const result = select(
    [modified("backend/src/lib/helper.ts")],
    {
      "backend/src/lib/helper.ts": [],
      "backend/src/services/consumer.ts": ["backend/src/lib/helper.ts"],
    },
    ["backend/src/services/consumer.ts"],
  );
  assert.equal(result.mode, "limited");
  assert.deepEqual([...result.targets].sort(), [
    "backend/src/services/consumer.ts",
  ]);
});

test("#258 AC-1: 変更テストが参照するsourceと影響先の重要処理を選ぶ", () => {
  const result = select(
    [modified("backend/src/lib/core.test.ts")],
    {
      "backend/src/lib/core.test.ts": ["backend/src/lib/core.ts"],
      "backend/src/lib/core.ts": [],
      "backend/src/services/consumer.ts": ["backend/src/lib/core.ts"],
    },
    ["backend/src/lib/core.ts", "backend/src/services/consumer.ts"],
  );
  assert.equal(result.mode, "limited");
  assert.deepEqual([...result.targets].sort(), [
    "backend/src/lib/core.ts",
    "backend/src/services/consumer.ts",
  ]);
});

test("#258 AC-1: shared変更の逆依存は参考選定に留め、現行の全体合格へ流用しない", () => {
  const result = select(
    [modified("shared/client-rules.ts")],
    {
      "shared/client-rules.ts": [],
      "backend/src/services/client.service.ts": ["shared/client-rules.ts"],
    },
    ["shared/client-rules.ts", "backend/src/services/client.service.ts"],
  );
  assert.equal(result.mode, "limited");
  assert.deepEqual([...result.targets].sort(), [
    "backend/src/services/client.service.ts",
    "shared/client-rules.ts",
  ]);
  assert.equal(result.gateEligible, false);
});

test("#258 AC-1: 削除と改名は旧グラフが不確かなら全体を返す", () => {
  for (const change of [
    { path: "backend/src/lib/core.ts", status: "deleted" },
    {
      path: "backend/src/lib/new.ts",
      previousPath: "backend/src/lib/old.ts",
      status: "renamed",
    },
  ]) {
    const result = select([change], {}, ["backend/src/lib/core.ts"]);
    assert.equal(result.mode, "full");
    assert.ok(result.reason);
  }
});

test("#258 AC-1: 未知の変更ファイル・未解決依存・解析失敗を限定成功にしない", () => {
  const important = ["backend/src/services/consumer.ts"];
  assert.equal(
    select([modified("backend/src/lib/unknown.ts")], {}, important).mode,
    "full",
  );
  assert.equal(
    select(
      [modified("backend/src/lib/helper.ts")],
      {
        "backend/src/lib/helper.ts": [],
        "backend/src/services/consumer.ts": ["backend/src/lib/missing.ts"],
      },
      important,
    ).mode,
    "full",
  );
  assert.equal(
    select(
      [modified("backend/src/lib/helper.ts")],
      { "backend/src/lib/helper.ts": [] },
      important,
      { forceFullReason: "依存解析失敗" },
    ).mode,
    "full",
  );
});

test("#258 AC-1: 影響を受ける重要処理がなければ対象なしとし、合格を装わない", () => {
  const result = select(
    [modified("backend/src/lib/isolated.ts")],
    { "backend/src/lib/isolated.ts": [] },
    ["backend/src/services/consumer.ts"],
  );
  assert.equal(result.mode, "none");
  assert.deepEqual([...result.targets].sort(), []);
  assert.equal(result.gateEligible, false);
  assert.ok(result.reason);
});

test("#258 AC-1: Windows区切りを同一ファイルとして扱い、結果は相対パスで返す", () => {
  const result = select(
    [modified("backend\\src\\lib\\core.ts")],
    {
      "backend/src/lib/core.ts": [],
      "backend/src/services/consumer.ts": ["backend/src/lib/core.ts"],
    },
    ["backend/src/lib/core.ts", "backend/src/services/consumer.ts"],
  );
  assert.equal(result.mode, "limited");
  assert.deepEqual([...result.targets].sort(), [
    "backend/src/lib/core.ts",
    "backend/src/services/consumer.ts",
  ]);
});

test("#258 AC-2: mutateへの対象追加だけなら追加対象と参照元を限定する", () => {
  const result = select(
    [modified("stryker.config.json")],
    {
      "backend/src/lib/new.ts": [],
      "backend/src/services/consumer.ts": ["backend/src/lib/new.ts"],
      "backend/src/services/unrelated.ts": [],
    },
    [
      "backend/src/lib/new.ts",
      "backend/src/services/consumer.ts",
      "backend/src/services/unrelated.ts",
    ],
    {
      mutateOnlyChanged: true,
      addedImportantFiles: ["backend/src/lib/new.ts"],
    },
  );
  assert.equal(result.mode, "limited");
  assert.deepEqual([...result.targets].sort(), [
    "backend/src/lib/new.ts",
    "backend/src/services/consumer.ts",
  ]);
});

test("#258 AC-2: mutate対象の削除と他の設定変更は全体に戻す", () => {
  const important = ["backend/src/lib/core.ts"];
  const graph = { "backend/src/lib/core.ts": [] };
  assert.equal(
    select([modified("stryker.config.json")], graph, important, {
      mutateOnlyChanged: true,
      addedImportantFiles: [],
      removedImportantFiles: ["backend/src/lib/old.ts"],
    }).mode,
    "full",
  );
  assert.equal(
    select(
      [modified("stryker.config.json"), modified("tsconfig.json")],
      graph,
      important,
      {
        mutateOnlyChanged: true,
        addedImportantFiles: ["backend/src/lib/core.ts"],
      },
    ).mode,
    "full",
  );
});

test("#258 AC-2: 同時変更した重要処理も追加対象とともに選ぶ", () => {
  const result = select(
    [modified("stryker.config.json"), modified("backend/src/lib/existing.ts")],
    {
      "backend/src/lib/new.ts": [],
      "backend/src/lib/existing.ts": [],
      "backend/src/services/new-consumer.ts": ["backend/src/lib/new.ts"],
      "backend/src/services/existing-consumer.ts": [
        "backend/src/lib/existing.ts",
      ],
    },
    [
      "backend/src/lib/new.ts",
      "backend/src/lib/existing.ts",
      "backend/src/services/new-consumer.ts",
      "backend/src/services/existing-consumer.ts",
    ],
    {
      mutateOnlyChanged: true,
      addedImportantFiles: ["backend/src/lib/new.ts"],
    },
  );
  assert.equal(result.mode, "limited");
  assert.deepEqual([...result.targets].sort(), [
    "backend/src/lib/existing.ts",
    "backend/src/lib/new.ts",
    "backend/src/services/existing-consumer.ts",
    "backend/src/services/new-consumer.ts",
  ]);
});

test("#258 AC-1: Strykerのglobと否定パターンから重要処理を展開する", () => {
  const expanded = expandImportantFiles({
    files: [
      "backend/src/services/core.ts",
      "backend/src/services/nested/consumer.ts",
      "backend/src/services/core.test.ts",
      "backend/src/lib/other.ts",
    ],
    mutatePatterns: ["backend/src/services/**/*.ts", "!**/*.test.ts"],
  });
  assert.deepEqual(expanded, [
    "backend/src/services/core.ts",
    "backend/src/services/nested/consumer.ts",
  ]);
});

test("#258 AC-1: mutateパターンは順番どおり適用し、Windows区切りを正規化する", () => {
  const expanded = expandImportantFiles({
    files: [
      "backend\\src\\lib\\core.ts",
      "backend/src/lib/legacy.ts",
      "backend/src/lib/core.test.ts",
    ],
    mutatePatterns: [
      "backend/src/lib/*.ts",
      "!backend/src/lib/legacy.ts",
      "backend/src/lib/legacy.ts",
      "!**/*.test.ts",
    ],
  });
  assert.deepEqual(expanded, [
    "backend/src/lib/core.ts",
    "backend/src/lib/legacy.ts",
  ]);
});

test("#258 AC-1: 展開した対象とStrykerの実JSON対象を照合する", () => {
  const selected = ["backend/src/lib/core.ts", "backend/src/lib/other.ts"];
  const matching = {
    files: {
      "backend/src/lib/other.ts": { mutants: [] },
      "backend/src/lib/core.ts": { mutants: [] },
    },
  };
  assert.equal(
    compareSelectedFilesToStrykerReport(selected, matching).equivalent,
    true,
  );
  for (const report of [
    { files: { "backend/src/lib/core.ts": { mutants: [] } } },
    {
      files: {
        ...matching.files,
        "backend/src/lib/extra.ts": { mutants: [] },
      },
    },
    { files: null },
  ]) {
    const compared = compareSelectedFilesToStrykerReport(selected, report);
    assert.equal(compared.equivalent, false);
    assert.ok(compared.reason);
  }
});

test("#258 AC-1: テスト専用補助の変更で検査先の重要処理を合格対象から落とさない", () => {
  const helper = "backend/src/services/test-helper.ts";
  const service = "backend/src/services/target.ts";
  const result = select(
    [modified(helper)],
    {
      [helper]: [],
      [service]: [],
      "backend/src/services/target.test.ts": [helper, service],
    },
    [helper, service],
  );
  assert.equal(
    result.mode === "full" ||
      !result.gateEligible ||
      result.targets.includes(service),
    true,
  );
});

test("#258 AC-1: 重要処理Yのテストだけが参照するZの変更でYを合格対象から落とさない", () => {
  const service = "backend/src/services/y.ts";
  const dependency = "backend/src/services/z.ts";
  const result = select(
    [modified(dependency)],
    {
      [service]: [],
      [dependency]: [],
      "backend/src/services/y.test.ts": [service, dependency],
    },
    [service, dependency],
  );
  assert.equal(
    result.mode === "full" ||
      !result.gateEligible ||
      result.targets.includes(service),
    true,
  );
});
