import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  canReuseCache,
  compareSavedRuns,
  compareMutationReports,
  planMutationRun,
  runMutation,
} from "./mutation-run.mjs";

const mutant = (id, status, options = {}) => ({
  id,
  mutatorName: options.mutatorName ?? "BooleanLiteral",
  replacement: options.replacement ?? "false",
  location: options.location ?? {
    start: { line: 7, column: 3 },
    end: { line: 7, column: 7 },
  },
  status,
});
const report = (mutants, path = "backend/src/lib/rules.ts") => ({
  files: { [path]: { language: "typescript", mutants } },
});

test("#258 AC-3: 内部IDと実行時刻の差は無視し、同じ意味の変異体と分類を一致とする", () => {
  const clean = report([mutant("1", "Killed")]);
  const incremental = report([mutant("different-id", "Killed")]);
  clean.startTime = "2026-11-01T00:00:00Z";
  incremental.startTime = "2026-11-02T00:00:00Z";
  assert.equal(compareMutationReports(clean, incremental).equivalent, true);
});

test("#258 AC-3: 同じ件数・同じ合計スコアでも変異体ごとの分類が違えば不一致", () => {
  const second = {
    location: {
      start: { line: 8, column: 3 },
      end: { line: 8, column: 7 },
    },
  };
  const clean = report([
    mutant("1", "Killed"),
    mutant("2", "Survived", second),
  ]);
  const incremental = report([
    mutant("a", "Survived"),
    mutant("b", "Killed", second),
  ]);
  const compared = compareMutationReports(clean, incremental);
  assert.equal(compared.equivalent, false);
  assert.ok(compared.reason);
});

test("#258 AC-3: 位置・演算子・置換内容・ファイルが変われば別の変異体と判定する", () => {
  const original = report([mutant("1", "Killed")]);
  for (const changed of [
    report([
      mutant("1", "Killed", {
        location: {
          start: { line: 9, column: 3 },
          end: { line: 9, column: 7 },
        },
      }),
    ]),
    report([mutant("1", "Killed", { mutatorName: "StringLiteral" })]),
    report([mutant("1", "Killed", { replacement: "true" })]),
    report([mutant("1", "Killed")], "backend/src/lib/other.ts"),
  ]) {
    assert.equal(compareMutationReports(original, changed).equivalent, false);
  }
});

test("#258 AC-3: 変異体の欠損・余分・重複を一致として扱わない", () => {
  const one = report([mutant("1", "Killed")]);
  assert.equal(compareMutationReports(one, report([])).equivalent, false);
  assert.equal(
    compareMutationReports(
      one,
      report([mutant("a", "Killed"), mutant("b", "Killed")]),
    ).equivalent,
    false,
  );
  assert.equal(
    compareMutationReports(
      report([mutant("1", "Killed"), mutant("2", "Killed")]),
      one,
    ).equivalent,
    false,
  );
});

test("#258 AC-3・AC-8: 破損JSON・未知分類・未完了分類は検証済みにしない", () => {
  const valid = report([mutant("1", "Killed")]);
  for (const invalid of [
    null,
    {},
    report([mutant("1", "NewUnknownStatus")]),
    report([mutant("1", "Pending")]),
    {
      files: {
        "backend/src/lib/rules.ts": { mutants: [{ status: "Killed" }] },
      },
    },
  ]) {
    assert.equal(compareMutationReports(valid, invalid).equivalent, false);
  }
});

const identity = () => ({
  targetsHash: "targets-001",
  importantFilesHash: "important-001",
  relatedSourcesHash: "sources-001",
  testsHash: "tests-001",
  lockfileHash: "lock-001",
  strykerConfigHash: "stryker-001",
  vitestConfigHash: "vitest-001",
  tsconfigHash: "tsconfig-001",
  setupHash: "setup-001",
  migrationsHash: "migration-001",
  runnerHash: "runner-001",
  analysisConfigHash: "analysis-001",
  toolVersionsHash: "tools-001",
  branch: "feature/258-mutation-efficiency",
  worktree: "test-worktree-001",
  concurrency: 4,
  environmentHash: "environment-001",
});
const previousCache = () => ({
  identity: identity(),
  status: "passed",
  score: 85,
  fileScores: { "backend/src/lib/rules.ts": 85 },
  threshold: 80,
  jsonValid: true,
  comparisonVerified: true,
  interrupted: false,
});

test("#258 AC-4: 全識別子が一致した成功結果だけ再利用できる", () => {
  const result = canReuseCache(previousCache(), { identity: identity() });
  assert.equal(result.reusable, true);
});

test("#258 AC-4: 対象・source・テスト・依存・設定・版・作業領域のどれかが変われば再利用しない", () => {
  for (const key of Object.keys(identity())) {
    const changed = identity();
    changed[key] = key === "concurrency" ? 2 : `${changed[key]}-changed`;
    const result = canReuseCache(previousCache(), { identity: changed });
    assert.equal(result.reusable, false, key);
    assert.ok(result.reason, key);
  }
});

test("#258 AC-4: 識別子が欠ける・不明な場合は再利用しない", () => {
  for (const key of Object.keys(identity())) {
    const missing = identity();
    delete missing[key];
    assert.equal(
      canReuseCache(previousCache(), { identity: missing }).reusable,
      false,
      key,
    );
  }
  assert.equal(
    canReuseCache(previousCache(), { identity: null }).reusable,
    false,
  );
});

test("#258 AC-4・AC-8: 失敗・中断・破損・比較未完了・80%未満のcacheを使わない", () => {
  const variants = [
    { status: "failed" },
    { status: "interrupted", interrupted: true },
    { jsonValid: false },
    { comparisonVerified: false },
    { score: 79.99 },
    { score: NaN },
  ];
  for (const variant of variants) {
    const result = canReuseCache(
      { ...previousCache(), ...variant },
      { identity: identity() },
    );
    assert.equal(result.reusable, false, JSON.stringify(variant));
    assert.ok(result.reason);
  }
});

test("#258 AC-4・AC-7: 合計80%以上でもファイル別80%未満のcacheを使わない", () => {
  const previous = {
    ...previousCache(),
    score: 90.91,
    fileScores: {
      "backend/src/lib/mostly-killed.ts": 100,
      "backend/src/lib/under-threshold.ts": 50,
    },
  };
  assert.equal(
    canReuseCache(previous, { identity: identity() }).reusable,
    false,
  );
});

const limitedScope = () => ({
  mode: "limited",
  targets: ["backend/src/lib/a.ts"],
  importantFiles: ["backend/src/lib/a.ts", "backend/src/lib/b.ts"],
  gateEligible: true,
});

test("#258 AC-4: 識別子の異なるcacheと欠損cacheでは古い結果を使わず重要処理全体を通常実行する", () => {
  const changed = identity();
  changed.lockfileHash = "lock-002";
  for (const cacheMetadata of [previousCache(), null]) {
    const plan = planMutationRun({
      scope: limitedScope(),
      requestedMode: "incremental-reuse",
      cacheMetadata,
      identity: changed,
    });
    assert.equal(plan.mode, "clean");
    assert.deepEqual([...plan.targets].sort(), [
      "backend/src/lib/a.ts",
      "backend/src/lib/b.ts",
    ]);
    assert.ok(plan.reason);
  }
});

test("#258 AC-4: 識別子と成功条件がそろうcacheのみ限定incrementalを選ぶ", () => {
  const plan = planMutationRun({
    scope: limitedScope(),
    requestedMode: "incremental-reuse",
    cacheMetadata: previousCache(),
    identity: identity(),
  });
  assert.equal(plan.mode, "incremental-reuse");
  assert.deepEqual(plan.targets, ["backend/src/lib/a.ts"]);
});

test("#258 AC-1・AC-4: 対象なしと参考選定は限定合格へ流用せず全体通常実行する", () => {
  for (const scope of [
    { ...limitedScope(), mode: "none", targets: [], gateEligible: false },
    { ...limitedScope(), gateEligible: false },
  ]) {
    const plan = planMutationRun({
      scope,
      requestedMode: "incremental-reuse",
      cacheMetadata: previousCache(),
      identity: identity(),
    });
    assert.equal(plan.mode, "clean");
    assert.deepEqual([...plan.targets].sort(), [
      "backend/src/lib/a.ts",
      "backend/src/lib/b.ts",
    ]);
    assert.equal(plan.gateEligible, true);
  }
});

test("#258 AC-4: 全体通常実行への切替はゲート対象、明示診断は対象外", () => {
  const fallback = planMutationRun({
    scope: { ...limitedScope(), gateEligible: false },
    requestedMode: "clean",
    cacheMetadata: null,
    identity: null,
  });
  assert.equal(fallback.mode, "clean");
  assert.deepEqual(fallback.targets, limitedScope().importantFiles);
  assert.equal(fallback.gateEligible, true);

  const limited = planMutationRun({
    scope: limitedScope(),
    requestedMode: "clean",
  });
  assert.equal(limited.gateEligible, true);
});

test("#258 AC-7: 手動診断の計画は品質ゲートに使わない", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/mutation-run.mjs", "--diagnostic-target", "backend/src/lib/a.ts"],
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  const plan = JSON.parse(output);
  assert.equal(plan.mode, "clean");
  assert.equal(plan.gateEligible, false);
  assert.equal(plan.execute, false);
});

const fakeProcess = (
  exitCode,
  output = "test output",
  error = "test error",
) => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  queueMicrotask(() => {
    child.stdout.end(output);
    child.stderr.end(error);
    child.emit("close", exitCode, null);
  });
  return child;
};

test("#258 AC-5・AC-8: Stryker失敗の終了コードと標準出力・標準エラーを専用runへ保存する", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mutation-258-unit-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  let spawned = false;
  const result = await runMutation({
    projectRoot: directory,
    reportRoot: path.join(directory, "reports"),
    runId: "unit-test-failed",
    mode: "clean",
    targets: ["backend/src/lib/rules.ts"],
    identity: identity(),
    spawnProcess(_command, _args, options) {
      spawned = true;
      assert.equal(options.windowsHide, true);
      assert.notEqual(options.shell, true);
      return fakeProcess(3);
    },
  });
  assert.equal(spawned, true);
  assert.equal(result.exitCode, 3);
  assert.equal(result.status, "failed");
  assert.equal(
    await readFile(path.join(result.reportDir, "stdout.log"), "utf8"),
    "test output",
  );
  assert.equal(
    await readFile(path.join(result.reportDir, "stderr.log"), "utf8"),
    "test error",
  );
  const metadata = JSON.parse(
    await readFile(path.join(result.reportDir, "metadata.json"), "utf8"),
  );
  assert.equal(metadata.exitCode, 3);
  assert.notEqual(metadata.status, "passed");
});

test("#258 AC-5: 既存runIdの成果物は上書きせず、プロセスを起動しない", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mutation-258-unit-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reportRoot = path.join(directory, "reports");
  const runDirectory = path.join(reportRoot, "unit-test-existing");
  await mkdir(runDirectory, { recursive: true });
  await writeFile(path.join(runDirectory, "sentinel.txt"), "keep");
  let spawned = false;
  await assert.rejects(() =>
    runMutation({
      projectRoot: directory,
      reportRoot,
      runId: "unit-test-existing",
      mode: "clean",
      targets: ["backend/src/lib/rules.ts"],
      identity: identity(),
      spawnProcess() {
        spawned = true;
        return fakeProcess(0);
      },
    }),
  );
  assert.equal(spawned, false);
  assert.equal(
    await readFile(path.join(runDirectory, "sentinel.txt"), "utf8"),
    "keep",
  );
});

test("#258 AC-4・AC-8: 成功終了でもJSONレポートが欠損した結果を成功cacheへ昇格しない", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mutation-258-unit-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await runMutation({
    projectRoot: directory,
    reportRoot: path.join(directory, "reports"),
    runId: "unit-test-missing-json",
    mode: "clean",
    targets: ["backend/src/lib/rules.ts"],
    identity: identity(),
    spawnProcess: () => fakeProcess(0, "", ""),
  });
  assert.notEqual(result.status, "passed");
  assert.equal(result.score, null);
});

test("#258 AC-7: 全体90%以上でも1ファイルが80%未満なら合格にしない", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mutation-258-unit-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fileA = "backend/src/lib/mostly-killed.ts";
  const fileB = "backend/src/lib/under-threshold.ts";
  const report = {
    files: {
      [fileA]: {
        mutants: Array.from({ length: 9 }, (_, index) =>
          mutant(`a-${index}`, "Killed", {
            location: {
              start: { line: index + 1, column: 0 },
              end: { line: index + 1, column: 1 },
            },
          }),
        ),
      },
      [fileB]: {
        mutants: [
          mutant("b-1", "Killed"),
          mutant("b-2", "Survived", {
            location: {
              start: { line: 8, column: 3 },
              end: { line: 8, column: 7 },
            },
          }),
        ],
      },
    },
  };
  const result = await runMutation({
    projectRoot: directory,
    reportRoot: path.join(directory, "reports"),
    runId: "unit-test-file-score",
    mode: "clean",
    targets: [fileA, fileB],
    identity: identity(),
    spawnProcess(_command, args) {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(async () => {
        try {
          const config = JSON.parse(await readFile(args.at(-1), "utf8"));
          await writeFile(config.jsonReporter.fileName, JSON.stringify(report));
          child.stdout.end("");
          child.stderr.end("");
          child.emit("close", 0, null);
        } catch (error) {
          child.emit("error", error);
        }
      });
      return child;
    },
  });
  assert.ok(result.score >= 80);
  assert.equal(result.status, "review_required");
  assert.equal(result.fileScores[fileA], 100);
  assert.equal(result.fileScores[fileB], 50);
});

test("#258 AC-1・AC-8: Strykerの実JSON対象が指定対象と違えば合格しない", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mutation-258-unit-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const selected = "backend/src/lib/selected.ts";
  const extra = "backend/src/lib/unselected.ts";
  const report = {
    files: { [extra]: { mutants: [mutant("1", "Killed")] } },
  };
  const result = await runMutation({
    projectRoot: directory,
    reportRoot: path.join(directory, "reports"),
    runId: "unit-test-target-mismatch",
    mode: "clean",
    targets: [selected],
    identity: identity(),
    spawnProcess(_command, args) {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(async () => {
        try {
          const config = JSON.parse(await readFile(args.at(-1), "utf8"));
          await writeFile(config.jsonReporter.fileName, JSON.stringify(report));
          child.stdout.end("");
          child.stderr.end("");
          child.emit("close", 0, null);
        } catch (error) {
          child.emit("error", error);
        }
      });
      return child;
    },
  });
  assert.notEqual(result.status, "passed");
  const metadata = JSON.parse(
    await readFile(path.join(result.reportDir, "metadata.json"), "utf8"),
  );
  assert.match(metadata.reason, /対象|不一致/);
});

test("#258 AC-3・AC-5: 診断限定のincrementalは元cacheを保持して別runへ複製し、合格cacheへ昇格しない", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mutation-258-unit-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourceCache = path.join(directory, "source-cache.json");
  const sourceContent = '{"test":"fake-incremental-cache"}';
  await writeFile(sourceCache, sourceContent);
  const target = "backend/src/lib/rules.ts";
  let copiedContent = null;
  let result;
  await assert.doesNotReject(async () => {
    result = await runMutation({
      projectRoot: directory,
      reportRoot: path.join(directory, "reports"),
      runId: "unit-test-experimental-reuse",
      mode: "incremental-reuse",
      targets: [target],
      identity: identity(),
      gateEligible: false,
      experimentalReuseFrom: sourceCache,
      spawnProcess(_command, args, options) {
        assert.equal(options.windowsHide, true);
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        queueMicrotask(async () => {
          try {
            const config = JSON.parse(await readFile(args.at(-1), "utf8"));
            assert.equal(config.incremental, true);
            copiedContent = await readFile(config.incrementalFile, "utf8");
            await writeFile(
              config.jsonReporter.fileName,
              JSON.stringify(report([mutant("1", "Killed")], target)),
            );
            child.stdout.end("diagnostic output");
            child.stderr.end("");
            child.emit("close", 0, null);
          } catch (error) {
            child.emit("error", error);
          }
        });
        return child;
      },
    });
  });
  assert.equal(copiedContent, sourceContent);
  assert.equal(await readFile(sourceCache, "utf8"), sourceContent);
  assert.equal(
    await readFile(
      path.join(result.reportDir, "stryker-incremental.json"),
      "utf8",
    ),
    sourceContent,
  );
  assert.notEqual(result.status, "passed");
  const metadata = JSON.parse(
    await readFile(path.join(result.reportDir, "metadata.json"), "utf8"),
  );
  assert.equal(metadata.experimentalReuse, true);
  assert.equal(metadata.gateEligible, false);
  assert.equal(metadata.comparisonVerified, false);
  assert.equal(metadata.cacheAdopted, false);
});

test("#258 AC-4・AC-8: 診断cacheの欠損・空・JSON破損はspawn前に拒否する", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mutation-258-unit-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const empty = path.join(directory, "empty-cache.json");
  const broken = path.join(directory, "broken-cache.json");
  await writeFile(empty, "");
  await writeFile(broken, "{broken");
  for (const [index, sourceCache] of [
    path.join(directory, "missing-cache.json"),
    empty,
    broken,
  ].entries()) {
    let spawned = false;
    await assert.rejects(() =>
      runMutation({
        projectRoot: directory,
        reportRoot: path.join(directory, "reports"),
        runId: `unit-test-invalid-cache-${index}`,
        mode: "incremental-reuse",
        targets: ["backend/src/lib/rules.ts"],
        identity: identity(),
        gateEligible: false,
        experimentalReuseFrom: sourceCache,
        spawnProcess() {
          spawned = true;
          return fakeProcess(0);
        },
      }),
    );
    assert.equal(spawned, false);
  }
});

test("#258 AC-4: 診断cacheを本運用ゲートに流用する指定はspawn前に拒否する", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mutation-258-unit-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourceCache = path.join(directory, "source-cache.json");
  const sourceContent = '{"test":"fake-incremental-cache"}';
  await writeFile(sourceCache, sourceContent);
  let spawned = false;
  await assert.rejects(() =>
    runMutation({
      projectRoot: directory,
      reportRoot: path.join(directory, "reports"),
      runId: "unit-test-gate-reuse-rejected",
      mode: "incremental-reuse",
      targets: ["backend/src/lib/rules.ts"],
      identity: identity(),
      gateEligible: true,
      experimentalReuseFrom: sourceCache,
      spawnProcess() {
        spawned = true;
        return fakeProcess(0);
      },
    }),
  );
  assert.equal(spawned, false);
  assert.equal(await readFile(sourceCache, "utf8"), sourceContent);
});

test("#258 AC-8: 診断実行が中断されたら合格・cache採用に昇格しない", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mutation-258-unit-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourceCache = path.join(directory, "source-cache.json");
  const sourceContent = '{"test":"fake-incremental-cache"}';
  await writeFile(sourceCache, sourceContent);
  let result;
  await assert.doesNotReject(async () => {
    result = await runMutation({
      projectRoot: directory,
      reportRoot: path.join(directory, "reports"),
      runId: "unit-test-interrupted-diagnostic",
      mode: "incremental-reuse",
      targets: ["backend/src/lib/rules.ts"],
      identity: identity(),
      gateEligible: false,
      experimentalReuseFrom: sourceCache,
      spawnProcess() {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        queueMicrotask(() => {
          child.stdout.end("");
          child.stderr.end("interrupted");
          child.emit("close", null, "SIGINT");
        });
        return child;
      },
    });
  });
  assert.equal(result.status, "interrupted");
  assert.equal(await readFile(sourceCache, "utf8"), sourceContent);
  const metadata = JSON.parse(
    await readFile(path.join(result.reportDir, "metadata.json"), "utf8"),
  );
  assert.equal(metadata.gateEligible, false);
  assert.equal(metadata.comparisonVerified, false);
  assert.equal(metadata.cacheAdopted, false);
});

test("#258 AC-5: run専用Stryker設定には承認済みのdryRunTimeoutMinutes 40を含める", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mutation-258-unit-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  let configPath = null;
  await runMutation({
    projectRoot: directory,
    reportRoot: path.join(directory, "reports"),
    runId: "unit-test-dry-run-timeout",
    mode: "clean",
    targets: ["backend/src/lib/rules.ts"],
    identity: identity(),
    spawnProcess(_command, args) {
      configPath = args.at(-1);
      return fakeProcess(1, "", "");
    },
  });
  assert.ok(configPath);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.dryRunTimeoutMinutes, 40);
});

test("#258 AC-7: RuntimeErrorとCompileErrorを変異スコアに算入せずファイル別80%未満を見逃さない", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mutation-258-unit-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = "backend/src/lib/invalid-mutants.ts";
  const statuses = [
    "Killed",
    "Survived",
    "RuntimeError",
    "RuntimeError",
    "RuntimeError",
    "CompileError",
  ];
  const mutants = statuses.map((status, index) =>
    mutant(`invalid-${index}`, status, {
      location: {
        start: { line: index + 1, column: 0 },
        end: { line: index + 1, column: 1 },
      },
    }),
  );
  const result = await runMutation({
    projectRoot: directory,
    reportRoot: path.join(directory, "reports"),
    runId: "unit-test-invalid-mutant-score",
    mode: "clean",
    targets: [target],
    identity: identity(),
    spawnProcess(_command, args) {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(async () => {
        try {
          const config = JSON.parse(await readFile(args.at(-1), "utf8"));
          await writeFile(
            config.jsonReporter.fileName,
            JSON.stringify(report(mutants, target)),
          );
          child.stdout.end("");
          child.stderr.end("");
          child.emit("close", 0, null);
        } catch (error) {
          child.emit("error", error);
        }
      });
      return child;
    },
  });
  assert.equal(result.score, 50);
  assert.equal(result.fileScores[target], 50);
  assert.equal(result.status, "review_required");
});

test("#258 AC-4: 新規incrementalはゲート対象の限定実行に採用しない", () => {
  const plan = planMutationRun({
    scope: limitedScope(),
    requestedMode: "incremental-first",
    cacheMetadata: null,
    identity: identity(),
  });
  assert.equal(plan.mode, "clean");
  assert.deepEqual([...plan.targets].sort(), [
    "backend/src/lib/a.ts",
    "backend/src/lib/b.ts",
  ]);
  assert.ok(plan.reason);
});

test("#258 AC-3・AC-8: 一致する実行だけ同等判定し、識別子や比較revisionの差を拒否する", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mutation-258-compare-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const comparisonRoot = path.join(directory, "comparisons");
  await mkdir(comparisonRoot);
  const target = "backend/src/lib/rules.ts";
  const baseMetadata = {
    targets: [target],
    identity: identity(),
    base: "revision-a",
    head: "revision-b",
    exitCode: 0,
    jsonValid: true,
    interrupted: false,
    status: "diagnostic",
  };
  for (const [label, changed, expected] of [
    ["一致", {}, true],
    ["識別子欠損", { identity: null }, false],
    [
      "識別子不一致",
      { identity: { ...identity(), testsHash: "other-tests" } },
      false,
    ],
    ["比較revision不一致", { base: "other-revision" }, false],
  ]) {
    const cleanDir = path.join(directory, `clean-${label}`);
    const incrementalDir = path.join(directory, `incremental-${label}`);
    await mkdir(cleanDir);
    await mkdir(incrementalDir);
    await writeFile(
      path.join(cleanDir, "metadata.json"),
      JSON.stringify(baseMetadata),
    );
    await writeFile(
      path.join(incrementalDir, "metadata.json"),
      JSON.stringify({ ...baseMetadata, ...changed }),
    );
    const mutation = JSON.stringify(report([mutant("1", "Killed")]));
    await writeFile(path.join(cleanDir, "mutation.json"), mutation);
    await writeFile(path.join(incrementalDir, "mutation.json"), mutation);
    const result = await compareSavedRuns(
      cleanDir,
      incrementalDir,
      comparisonRoot,
    );
    assert.equal(result.equivalent, expected, label);
  }
});
