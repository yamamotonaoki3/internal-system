import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  compareSelectedFilesToStrykerReport,
  inspectMutationScope,
} from "./mutation-scope.mjs";

const completedStatuses = new Set([
  "Killed",
  "Survived",
  "NoCoverage",
  "Timeout",
  "RuntimeError",
  "CompileError",
  "Ignored",
]);
const scoreStatuses = new Set(["Killed", "Timeout", "Survived", "NoCoverage"]);
const detectedStatuses = new Set(["Killed", "Timeout"]);
const identityKeys = [
  "targetsHash",
  "importantFilesHash",
  "relatedSourcesHash",
  "testsHash",
  "lockfileHash",
  "strykerConfigHash",
  "vitestConfigHash",
  "tsconfigHash",
  "setupHash",
  "migrationsHash",
  "runnerHash",
  "analysisConfigHash",
  "toolVersionsHash",
  "branch",
  "worktree",
  "concurrency",
  "environmentHash",
];

function validMutant(file, mutant) {
  const { mutatorName, replacement, location, status } = mutant ?? {};
  const positions = [
    location?.start?.line,
    location?.start?.column,
    location?.end?.line,
    location?.end?.column,
  ];
  return (
    Boolean(file) &&
    typeof mutatorName === "string" &&
    typeof replacement === "string" &&
    completedStatuses.has(status) &&
    positions.every(Number.isInteger)
  );
}

function mutantKey(file, mutant) {
  const { location } = mutant;
  return JSON.stringify([
    file.replaceAll("\\", "/"),
    location.start.line,
    location.start.column,
    location.end.line,
    location.end.column,
    mutant.mutatorName,
    mutant.replacement,
  ]);
}

function listMutants(report) {
  if (
    !report ||
    typeof report !== "object" ||
    !report.files ||
    typeof report.files !== "object"
  )
    throw new Error("JSONレポートのfilesが不正");
  const mutants = new Map();
  for (const [file, description] of Object.entries(report.files)) {
    if (!description || !Array.isArray(description.mutants))
      throw new Error("変異体一覧が不正");
    for (const mutant of description.mutants) {
      if (!validMutant(file, mutant))
        throw new Error("変異体の意味キーまたは分類が不正");
      const key = mutantKey(file, mutant);
      if (mutants.has(key)) throw new Error("意味キーが重複");
      mutants.set(key, mutant.status);
    }
  }
  if (!mutants.size) throw new Error("変異体がない");
  return mutants;
}

export function compareMutationReports(clean, incremental) {
  try {
    const baseline = listMutants(clean);
    const candidate = listMutants(incremental);
    if (baseline.size !== candidate.size)
      return { equivalent: false, reason: "変異体の件数が異なる" };
    for (const [key, status] of baseline) {
      if (candidate.get(key) !== status)
        return {
          equivalent: false,
          reason: "変異体の意味キーまたは分類が異なる",
        };
    }
    return { equivalent: true, reason: "意味キーと分類が一致" };
  } catch (error) {
    return { equivalent: false, reason: error.message };
  }
}

function validIdentity(identity) {
  return (
    identity &&
    typeof identity === "object" &&
    identityKeys.every((key) =>
      key === "concurrency"
        ? Number.isInteger(identity[key]) && identity[key] > 0
        : typeof identity[key] === "string" && identity[key].trim().length > 0,
    )
  );
}

function completeCache(previous) {
  return (
    previous?.status === "passed" &&
    previous.interrupted === false &&
    previous.jsonValid === true &&
    previous.comparisonVerified === true
  );
}

function eligibleScores(previous) {
  if (
    !Number.isFinite(previous.score) ||
    !Number.isFinite(previous.threshold) ||
    previous.threshold < 80 ||
    previous.score < previous.threshold
  )
    return false;
  const values = Object.values(previous.fileScores ?? {});
  return (
    values.length > 0 &&
    values.every((score) => Number.isFinite(score) && score >= 80)
  );
}

export function canReuseCache(previous, current) {
  if (!completeCache(previous) || !eligibleScores(previous))
    return {
      reusable: false,
      reason: "前回の成功・閾値・完全比較を確認できない",
    };
  if (!validIdentity(previous.identity) || !validIdentity(current?.identity))
    return { reusable: false, reason: "識別子が不明または欠落" };
  for (const key of identityKeys) {
    if (previous.identity[key] !== current.identity[key])
      return { reusable: false, reason: `識別子 ${key} が変化` };
  }
  return { reusable: true, reason: "すべての識別子が一致" };
}

export function planMutationRun({
  scope,
  requestedMode = "clean",
  cacheMetadata,
  identity,
}) {
  const all = scope?.importantFiles;
  if (!Array.isArray(all) || !all.length)
    throw new Error("重要処理の全体集合が不明");
  const fallback = (reason) => ({
    mode: "clean",
    targets: [...all].sort(),
    reason,
    gateEligible: true,
  });
  if (scope.mode === "full") return fallback(scope.reason || "全体実行が必要");
  if (scope.mode !== "limited" || !scope.gateEligible || !scope.targets?.length)
    return fallback("対象なし、または限定選定が現行ゲートに利用できない");
  if (requestedMode === "incremental-reuse") {
    const reuse = canReuseCache(cacheMetadata, { identity });
    if (!reuse.reusable)
      return fallback(`cache不一致のため全体通常実行: ${reuse.reason}`);
  } else if (requestedMode === "incremental-first") {
    return fallback("未検証のincremental初回は本運用に利用しない");
  } else if (requestedMode !== "clean") {
    return fallback("不明な実行方式");
  }
  return {
    mode: requestedMode,
    targets: [...scope.targets].sort(),
    reason: "限定対象を選定",
    gateEligible: true,
  };
}

function mutationScores(report) {
  listMutants(report);
  const fileScores = {};
  let detected = 0;
  let total = 0;
  for (const [file, description] of Object.entries(report.files)) {
    const relevant = description.mutants.filter((mutant) =>
      scoreStatuses.has(mutant.status),
    );
    const fileDetected = relevant.filter((mutant) =>
      detectedStatuses.has(mutant.status),
    ).length;
    fileScores[file.replaceAll("\\", "/")] = relevant.length
      ? Math.round((fileDetected * 10000) / relevant.length) / 100
      : null;
    detected += fileDetected;
    total += relevant.length;
  }
  return {
    score: total ? Math.round((detected * 10000) / total) / 100 : null,
    fileScores,
  };
}

async function readReport(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function validateRun(runId, mode, targets) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(runId ?? ""))
    throw new Error("runIdが不正");
  if (!["clean", "incremental-first", "incremental-reuse"].includes(mode))
    throw new Error("実行方式が不正");
  if (
    !Array.isArray(targets) ||
    !targets.length ||
    targets.some(
      (target) =>
        typeof target !== "string" ||
        target.startsWith("/") ||
        target.includes("..") ||
        target.includes("\\"),
    )
  )
    throw new Error("対象ファイルが不正または空");
}

async function copyExperimentalCache(source, destination, gateEligible) {
  if (gateEligible) throw new Error("診断cacheを本運用ゲートに利用できない");
  const content = await readFile(source, "utf8");
  if (!content.trim()) throw new Error("診断cacheが空");
  const parsed = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("診断cacheのJSONが不正");
  await copyFile(source, destination);
}

async function prepareRun({
  projectRoot,
  reportDir,
  mode,
  targets,
  identity,
  spawnProcess,
  reuseFrom,
  gateEligible,
  experimentalReuseFrom,
}) {
  const incrementalFile = path.join(reportDir, "stryker-incremental.json");
  if (mode === "incremental-reuse") {
    if (experimentalReuseFrom) {
      await copyExperimentalCache(
        experimentalReuseFrom,
        incrementalFile,
        gateEligible,
      );
    } else {
      if (
        !canReuseCache(reuseFrom?.metadata, { identity }).reusable ||
        !reuseFrom?.file
      )
        throw new Error("再利用可能なcacheではない");
      await copyFile(reuseFrom.file, incrementalFile);
    }
  }
  const baseConfig =
    spawnProcess === spawn
      ? JSON.parse(
          await readFile(path.join(projectRoot, "stryker.config.json"), "utf8"),
        )
      : {};
  const configFile = path.join(reportDir, "stryker.config.json");
  await writeFile(
    configFile,
    JSON.stringify(
      {
        ...baseConfig,
        mutate: targets,
        reporters: ["clear-text", "html", "json"],
        incremental: mode !== "clean",
        dryRunTimeoutMinutes: 40,
        incrementalFile,
        tempDirName: path.join(reportDir, "stryker-tmp"),
        htmlReporter: { fileName: path.join(reportDir, "mutation.html") },
        jsonReporter: { fileName: path.join(reportDir, "mutation.json") },
      },
      null,
      2,
    ),
  );
  return configFile;
}

async function executeRun(projectRoot, reportDir, configFile, spawnProcess) {
  const child = spawnProcess(
    process.execPath,
    [
      path.join(
        projectRoot,
        "node_modules",
        "@stryker-mutator",
        "core",
        "bin",
        "stryker.js",
      ),
      "run",
      configFile,
    ],
    { cwd: projectRoot, shell: false, windowsHide: true },
  );
  const stdout = createWriteStream(path.join(reportDir, "stdout.log"), {
    flags: "wx",
  });
  const stderr = createWriteStream(path.join(reportDir, "stderr.log"), {
    flags: "wx",
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const close = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  await Promise.all([finished(stdout), finished(stderr)]);
  return close;
}

function assignStatus(metadata, close, targetMatch) {
  if (!targetMatch.equivalent) metadata.reason = targetMatch.reason;
  const runCompleted =
    close.code === 0 &&
    !metadata.interrupted &&
    metadata.jsonValid &&
    targetMatch.equivalent;
  if (runCompleted) {
    const filesMeetThreshold = Object.values(metadata.fileScores).every(
      (score) => score !== null && score >= 80,
    );
    metadata.status =
      filesMeetThreshold && metadata.score >= 80
        ? metadata.gateEligible
          ? "passed"
          : "diagnostic"
        : "review_required";
  } else if (metadata.interrupted) metadata.status = "interrupted";
  if (metadata.status === "review_required")
    metadata.reason = "ファイル別80%未達。等価変異体の個別確認が必要";
  if (metadata.status === "diagnostic")
    metadata.reason = "診断結果はゲートに利用しない";
  if (metadata.status === "failed" && !metadata.reason)
    metadata.reason = "終了コードまたはスコアが基準を満たさない";
}

async function evaluateRun(reportDir, targets, close, metadata) {
  metadata.exitCode = close.code;
  metadata.interrupted = close.signal !== null || close.code === null;
  const report = await readReport(path.join(reportDir, "mutation.json"));
  if (report) {
    try {
      const scores = mutationScores(report);
      metadata.score = scores.score;
      metadata.fileScores = scores.fileScores;
      metadata.jsonValid = true;
    } catch {
      metadata.jsonValid = false;
    }
  }
  const targetMatch =
    report && metadata.jsonValid
      ? compareSelectedFilesToStrykerReport(targets, report)
      : { equivalent: false, reason: "JSONレポート欠損または破損" };
  assignStatus(metadata, close, targetMatch);
}

export async function runMutation({
  projectRoot,
  reportRoot = path.join(projectRoot, "reports", "mutation"),
  runId,
  mode,
  targets,
  identity,
  spawnProcess = spawn,
  reuseFrom,
  gateEligible = true,
  base = null,
  head = null,
  selectionReason = null,
  experimentalReuseFrom,
}) {
  validateRun(runId, mode, targets);
  const reportDir = path.join(reportRoot, runId);
  await mkdir(reportRoot, { recursive: true });
  await mkdir(reportDir);
  const startedAt = new Date().toISOString();
  const metadata = {
    runId,
    mode,
    targets,
    identity,
    startedAt,
    status: "failed",
    exitCode: null,
    score: null,
    fileScores: null,
    jsonValid: false,
    comparisonVerified: false,
    interrupted: false,
    reason: null,
    cacheAdopted: false,
    experimentalReuse: Boolean(experimentalReuseFrom),
    gateEligible,
    base,
    head,
    selectionReason,
  };
  try {
    const configFile = await prepareRun({
      projectRoot,
      reportDir,
      mode,
      targets,
      identity,
      spawnProcess,
      reuseFrom,
      gateEligible,
      experimentalReuseFrom,
    });
    const close = await executeRun(
      projectRoot,
      reportDir,
      configFile,
      spawnProcess,
    );
    await evaluateRun(reportDir, targets, close, metadata);
  } catch (error) {
    metadata.error = error.name;
    throw error;
  } finally {
    metadata.finishedAt = new Date().toISOString();
    metadata.durationMs =
      Date.parse(metadata.finishedAt) - Date.parse(startedAt);
    await writeFile(
      path.join(reportDir, "metadata.json"),
      JSON.stringify(metadata, null, 2),
    );
  }
  return {
    exitCode: metadata.exitCode,
    runId,
    reportDir,
    status: metadata.status,
    score: metadata.score,
    fileScores: metadata.fileScores,
    reason: metadata.reason,
  };
}

const ownProjectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function comparisonConditions(cleanMetadata, incrementalMetadata) {
  const revisions = ["base", "head"];
  const known =
    Boolean(validIdentity(cleanMetadata?.identity)) &&
    Boolean(validIdentity(incrementalMetadata?.identity)) &&
    revisions.every(
      (key) =>
        typeof cleanMetadata?.[key] === "string" &&
        cleanMetadata[key].length > 0 &&
        typeof incrementalMetadata?.[key] === "string" &&
        incrementalMetadata[key].length > 0,
    );
  const same =
    known &&
    identityKeys.every(
      (key) =>
        cleanMetadata.identity[key] === incrementalMetadata.identity[key],
    ) &&
    revisions.every((key) => cleanMetadata[key] === incrementalMetadata[key]);
  return { known, same };
}

function usableForComparison(metadata) {
  return (
    metadata?.exitCode === 0 &&
    metadata.jsonValid === true &&
    metadata.interrupted === false &&
    ["passed", "diagnostic", "review_required"].includes(metadata.status)
  );
}

function comparisonReason(comparison, sameTargets, bothValid, conditions) {
  if (!sameTargets) return "実行対象が異なる";
  if (!bothValid) return "両方の成功を確認できない";
  if (!conditions.known) return "比較条件が不明";
  if (!conditions.same) return "比較条件が異なる";
  return comparison.reason;
}

export async function compareSavedRuns(
  cleanDir,
  incrementalDir,
  reportRoot = path.join(ownProjectRoot, "reports", "mutation"),
) {
  const [cleanMetadata, incrementalMetadata, cleanReport, incrementalReport] =
    await Promise.all([
      readReport(path.join(cleanDir, "metadata.json")),
      readReport(path.join(incrementalDir, "metadata.json")),
      readReport(path.join(cleanDir, "mutation.json")),
      readReport(path.join(incrementalDir, "mutation.json")),
    ]);
  const comparison = compareMutationReports(cleanReport, incrementalReport);
  const sameTargets =
    JSON.stringify(cleanMetadata?.targets) ===
    JSON.stringify(incrementalMetadata?.targets);
  const conditions = comparisonConditions(cleanMetadata, incrementalMetadata);
  const bothValid =
    usableForComparison(cleanMetadata) &&
    usableForComparison(incrementalMetadata);
  const result = {
    ...comparison,
    equivalent:
      comparison.equivalent && sameTargets && bothValid && conditions.same,
    reason: comparisonReason(comparison, sameTargets, bothValid, conditions),
    cleanRun: cleanMetadata?.runId ?? null,
    incrementalRun: incrementalMetadata?.runId ?? null,
    cacheAdopted: false,
  };
  const directory = path.join(reportRoot, `compare-${randomUUID()}`);
  await mkdir(directory, { recursive: false });
  await writeFile(
    path.join(directory, "comparison.json"),
    JSON.stringify(result, null, 2),
  );
  return { ...result, reportDir: directory };
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function diagnosticPlan(targets, requestedMode, experimentalReuseFrom) {
  let mode = "clean";
  if (requestedMode === "incremental-first") mode = "incremental-first";
  if (requestedMode === "incremental-reuse" && experimentalReuseFrom)
    mode = "incremental-reuse";
  return { mode, targets, reason: "限定診断。ゲートには利用しない" };
}

async function runCli(args) {
  const cleanRun = option(args, "--compare-clean");
  const incrementalRun = option(args, "--compare-incremental");
  if (cleanRun || incrementalRun) {
    if (!cleanRun || !incrementalRun) throw new Error("比較する2つのrunを指定");
    return compareSavedRuns(
      path.resolve(cleanRun),
      path.resolve(incrementalRun),
    );
  }
  const base = option(args, "--base");
  const head = option(args, "--head");
  const requestedMode = option(args, "--mode") ?? "clean";
  const experimentalReuseFrom = option(args, "--experiment-reuse-from");
  const diagnosticTargets = args.flatMap((value, index) =>
    value === "--diagnostic-target" ? [args[index + 1]] : [],
  );
  const scope = diagnosticTargets.length
    ? {
        mode: "limited",
        targets: diagnosticTargets,
        importantFiles: diagnosticTargets,
        gateEligible: false,
        reason: "手動指定の診断対象",
      }
    : await inspectMutationScope({ base, head });
  const planned = diagnosticTargets.length
    ? diagnosticPlan(diagnosticTargets, requestedMode, experimentalReuseFrom)
    : planMutationRun({
        scope,
        requestedMode,
        cacheMetadata: null,
        identity: null,
      });
  const runId = option(args, "--run-id") ?? `run-${randomUUID()}`;
  const summary = {
    ...planned,
    runId,
    base,
    head,
    gateEligible: !diagnosticTargets.length && planned.gateEligible,
    targetCount: planned.targets.length,
    experimentalReuse:
      planned.mode === "incremental-reuse" && Boolean(experimentalReuseFrom),
    execute: args.includes("--execute"),
  };
  if (!args.includes("--execute")) return summary;
  const outcome = await runMutation({
    projectRoot: ownProjectRoot,
    runId,
    mode: planned.mode,
    targets: planned.targets,
    identity: null,
    gateEligible: summary.gateEligible,
    base,
    head,
    selectionReason: planned.reason,
    experimentalReuseFrom: summary.experimentalReuse
      ? path.resolve(experimentalReuseFrom)
      : undefined,
  });
  if (outcome.status !== "passed") process.exitCode = outcome.exitCode || 1;
  return { ...summary, ...outcome };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCli(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
