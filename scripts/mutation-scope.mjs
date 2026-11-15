import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const requireStrykerDependency = createRequire(
  new URL(
    "../node_modules/@stryker-mutator/core/package.json",
    import.meta.url,
  ),
);
const { minimatch } = requireStrykerDependency("minimatch");
const normalizePath = (value) =>
  value.replaceAll("\\", "/").replace(/^\.\//, "");

export function expandImportantFiles({
  files,
  mutatePatterns,
  cwd = process.cwd(),
}) {
  if (!Array.isArray(files) || !Array.isArray(mutatePatterns))
    throw new Error("mutate一覧の入力が不正");
  const selected = new Set();
  const candidates = files.map(normalizePath);
  for (const expression of mutatePatterns) {
    if (typeof expression !== "string" || !expression)
      throw new Error("mutateパターンが不正");
    const excluded = expression.startsWith("!");
    const pattern = normalizePath(excluded ? expression.slice(1) : expression);
    const absolutePattern = normalizePath(path.resolve(cwd, pattern));
    for (const candidate of candidates) {
      if (
        minimatch(
          normalizePath(path.resolve(cwd, candidate)),
          absolutePattern,
          { dot: false },
        )
      ) {
        if (excluded) selected.delete(candidate);
        else selected.add(candidate);
      }
    }
  }
  return [...selected].sort();
}

export function compareSelectedFilesToStrykerReport(selected, report) {
  if (
    !Array.isArray(selected) ||
    !report ||
    !report.files ||
    typeof report.files !== "object"
  )
    return { equivalent: false, reason: "選定またはStryker JSONが不正" };
  const expected = new Set(selected.map(normalizePath));
  const actual = new Set(Object.keys(report.files).map(normalizePath));
  if (
    expected.size === 0 ||
    expected.size !== selected.length ||
    actual.size !== Object.keys(report.files).length
  )
    return { equivalent: false, reason: "対象なし、または重複した対象" };
  if (
    expected.size !== actual.size ||
    [...expected].some((file) => !actual.has(file))
  )
    return { equivalent: false, reason: "Stryker実対象と選定対象が異なる" };
  return { equivalent: true, reason: "Stryker実対象と一致" };
}
const sourcePath = (value) =>
  /^(backend\/src|frontend\/src|shared)\//.test(value);
const testPath = (value) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(value);
const fullChange = (value) =>
  /^(scripts|e2e|backend\/db|\.github)\//.test(value) ||
  /(^|\/)(setup|fixture|middleware|App|navigation)[^/]*\.[cm]?[jt]sx?$/.test(
    value,
  ) ||
  /(^|\/)(auth|session|csp)[^/]*\.[cm]?[jt]sx?$/.test(value);

const result = (mode, targets, reason, gateEligible = mode !== "none") => ({
  mode,
  targets: [...targets].sort(),
  reason,
  gateEligible,
});

function graphFromEntries(dependencyGraph) {
  const graph = new Map();
  for (const [file, dependencies] of Object.entries(dependencyGraph)) {
    if (!Array.isArray(dependencies))
      return { reason: "依存解析の結果が不完全" };
    graph.set(normalizePath(file), dependencies.map(normalizePath));
  }
  for (const dependencies of graph.values()) {
    for (const dependency of dependencies) {
      if (sourcePath(dependency) && !graph.has(dependency))
        return { reason: "未解決の依存" };
    }
  }
  return { graph };
}

function changeFailure(change, file, options, graph) {
  if (
    !change ||
    typeof change.path !== "string" ||
    change.previousPath ||
    change.status === "deleted" ||
    change.status === "renamed"
  )
    return "削除・改名または不明な差分";
  if (!["added", "modified"].includes(change.status)) return "不明な差分の種類";
  if (file === "stryker.config.json") {
    return options.mutateOnlyChanged && options.addedImportantFiles.length
      ? null
      : "Stryker設定の変更";
  }
  if (file.startsWith("docs/") || file === "README.md") return null;
  if (!sourcePath(file) || fullChange(file)) return "共通基盤または設定の変更";
  if (!graph.has(file)) return "変更ファイルが依存グラフにない";
  return null;
}

function seedsFromChanges(changes, options, graph) {
  const seeds = new Set(options.addedImportantFiles.map(normalizePath));
  let shared = false;
  for (const change of changes) {
    const file =
      typeof change?.path === "string" ? normalizePath(change.path) : "";
    const reason = changeFailure(change, file, options, graph);
    if (reason) return { reason };
    if (
      file.startsWith("docs/") ||
      file === "README.md" ||
      file === "stryker.config.json"
    )
      continue;
    if (file.startsWith("shared/")) shared = true;
    if (testPath(file)) {
      const dependencies = graph.get(file).filter(sourcePath);
      if (!dependencies.length) return { reason: "テストと実装の対応が不明" };
      dependencies.forEach((dependency) => seeds.add(dependency));
    } else seeds.add(file);
  }
  for (const file of seeds)
    if (!graph.has(file)) return { reason: "追加対象が依存グラフにない" };
  return { seeds, shared };
}

function reachableDependents(graph, seeds) {
  const reverse = new Map();
  for (const [source, dependencies] of graph) {
    for (const dependency of dependencies) {
      if (!reverse.has(dependency)) reverse.set(dependency, new Set());
      reverse.get(dependency).add(source);
    }
  }
  const seen = new Set(seeds);
  const queue = [...seeds];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (testPath(current)) {
      const dependencies = graph.get(current)?.filter(sourcePath);
      if (!dependencies?.length) return { reason: "テストと実装の対応が不明" };
      for (const dependency of dependencies) {
        if (!seen.has(dependency)) {
          seen.add(dependency);
          queue.push(dependency);
        }
      }
    }
    for (const dependent of reverse.get(current) ?? []) {
      if (!seen.has(dependent)) {
        seen.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return { seen };
}

function knownScopeInputs(changedFiles, dependencyGraph, importantFiles) {
  return (
    Array.isArray(changedFiles) &&
    Boolean(dependencyGraph) &&
    Array.isArray(importantFiles)
  );
}

export function selectMutationScope({
  changedFiles,
  dependencyGraph,
  importantFiles,
  forceFullReason,
  mutateOnlyChanged = false,
  addedImportantFiles = [],
  removedImportantFiles = [],
}) {
  const important = new Set((importantFiles ?? []).map(normalizePath));
  const full = (reason) => result("full", important, reason);
  if (forceFullReason) return full(forceFullReason);
  if (!knownScopeInputs(changedFiles, dependencyGraph, importantFiles))
    return full("差分または依存解析の入力が不明");
  if (removedImportantFiles.length) return full("重要処理の対象削除");
  const parsed = graphFromEntries(dependencyGraph);
  if (parsed.reason) return full(parsed.reason);
  const { graph } = parsed;
  const selected = seedsFromChanges(
    changedFiles,
    { mutateOnlyChanged, addedImportantFiles },
    graph,
  );
  if (selected.reason) return full(selected.reason);
  const { seeds, shared } = selected;
  if (!seeds.size) return result("none", [], "変更対象なし", false);
  const reach = reachableDependents(graph, seeds);
  if (reach.reason) return full(reach.reason);
  const targets = [...reach.seen].filter((file) => important.has(file));
  if (!targets.length)
    return result("none", [], "影響を受ける重要処理なし", false);
  return result(
    "limited",
    targets,
    shared ? "共有定義の参考選定" : "変更と逆依存から選定",
    !shared,
  );
}

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sha = (value) => createHash("sha256").update(value).digest("hex");

function command(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${executable}の調査に失敗`);
  return result.stdout;
}

async function sourceFiles() {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(path.join(projectRoot, directory), {
      withFileTypes: true,
    })) {
      const next = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(next);
      else if (entry.isFile()) files.push(next);
    }
  }
  for (const directory of ["backend/src", "frontend/src", "shared"])
    await visit(directory);
  return files;
}

function gitChanges(base, head) {
  const revision = head === "WORKTREE" ? [base] : [base, head];
  const tokens = command("git", [
    "diff",
    "--name-status",
    "-z",
    ...revision,
    "--",
  ]).split("\0");
  const changes = [];
  for (let index = 0; index < tokens.length && tokens[index];) {
    const type = tokens[index++];
    if (type.startsWith("R") || type.startsWith("C")) {
      const previousPath = tokens[index++];
      const file = tokens[index++];
      changes.push({ path: file, previousPath, status: "renamed" });
    } else {
      const file = tokens[index++];
      const status = { A: "added", M: "modified", D: "deleted" }[type];
      changes.push({ path: file, status: status ?? "unknown" });
    }
  }
  if (head === "WORKTREE") {
    const untracked = command("git", [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ]);
    for (const file of untracked.split("\0").filter(Boolean)) {
      changes.push({ path: file, status: "added" });
    }
  }
  return changes;
}

function localDependencyTarget(dependency, source, knownExternal) {
  const target = normalizePath(dependency.resolved ?? dependency.to ?? "");
  if (dependency.couldNotResolve && !knownExternal(target))
    throw new Error(`未解決のローカル依存: ${source}`);
  if (
    sourcePath(target) &&
    (dependency.couldNotResolve ||
      dependency.dependencyTypes?.includes("unknown") ||
      dependency.dependencyTypes?.includes("undetermined"))
  )
    throw new Error(`不確かなローカル依存: ${source}`);
  return sourcePath(target) ? target : null;
}

function dependencyGraph() {
  const output = command(process.execPath, [
    "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
    "backend/src",
    "frontend/src",
    "shared",
    "--config",
    ".dependency-cruiser.cjs",
    "--output-type",
    "json",
  ]);
  const modules = JSON.parse(output).modules;
  if (!Array.isArray(modules)) throw new Error("依存解析の出力が不正");
  const packageJson = JSON.parse(command("git", ["show", "HEAD:package.json"]));
  const packageNames = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  });
  const knownExternal = (specifier) =>
    specifier.startsWith("node:") ||
    specifier.startsWith("cloudflare:") ||
    packageNames.some(
      (name) => specifier === name || specifier.startsWith(`${name}/`),
    );
  const graph = {};
  for (const module of modules) {
    const source = normalizePath(module.source);
    if (!sourcePath(source)) continue;
    if (!Array.isArray(module.dependencies))
      throw new Error("依存解析の出力が不正");
    graph[source] = [];
    for (const dependency of module.dependencies) {
      const target = localDependencyTarget(dependency, source, knownExternal);
      if (target) graph[source].push(target);
    }
  }
  return graph;
}

export async function inspectMutationScope({ base, head }) {
  const files = await sourceFiles();
  const config = JSON.parse(
    await readFile(path.join(projectRoot, "stryker.config.json"), "utf8"),
  );
  const importantFiles = expandImportantFiles({
    files,
    mutatePatterns: config.mutate,
    cwd: projectRoot,
  });
  const configHash = sha(JSON.stringify(config));
  let changes = [];
  let forceFullReason;
  let graph = {};
  let mutateOnlyChanged = false;
  let addedImportantFiles = [];
  let removedImportantFiles = [];
  try {
    if (!base || !head) throw new Error("比較元または比較先が不明");
    const actualHead = command("git", ["rev-parse", "HEAD"]).trim();
    if (head !== "WORKTREE") {
      const selectedHead = command("git", [
        "rev-parse",
        "--verify",
        head,
      ]).trim();
      if (selectedHead !== actualHead)
        throw new Error("比較先が現作業treeのHEADでない");
      if (
        command("git", [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        ])
      )
        throw new Error("revision比較中に未コミットまたは未追跡の変更がある");
    }
    command("git", ["rev-parse", "--verify", base]);
    changes = gitChanges(base, head);
    if (changes.some((change) => change.path === "stryker.config.json")) {
      const previous = JSON.parse(
        command("git", ["show", `${base}:stryker.config.json`]),
      );
      const oldOther = { ...previous, mutate: undefined };
      const newOther = { ...config, mutate: undefined };
      mutateOnlyChanged = JSON.stringify(oldOther) === JSON.stringify(newOther);
      const oldImportant = new Set(
        expandImportantFiles({
          files,
          mutatePatterns: previous.mutate,
          cwd: projectRoot,
        }),
      );
      addedImportantFiles = importantFiles.filter(
        (file) => !oldImportant.has(file),
      );
      removedImportantFiles = [...oldImportant].filter(
        (file) => !importantFiles.includes(file),
      );
    }
    graph = dependencyGraph();
  } catch (error) {
    forceFullReason = error.message;
  }
  const selected = selectMutationScope({
    changedFiles: changes,
    dependencyGraph: graph,
    importantFiles,
    forceFullReason,
    mutateOnlyChanged,
    addedImportantFiles,
    removedImportantFiles,
  });
  return {
    ...selected,
    base: base ?? null,
    head: head ?? null,
    configHash,
    importantFiles,
    unverified: selected.mode !== "full" && !selected.gateEligible,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf("--base");
  const headIndex = args.indexOf("--head");
  const outputIndex = args.indexOf("--output");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : undefined;
  const head = headIndex >= 0 ? args[headIndex + 1] : undefined;
  const output = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
  inspectMutationScope({ base, head })
    .then(async (scope) => {
      const serialized = `${JSON.stringify(scope, null, 2)}\n`;
      if (output) {
        const destination = path.resolve(projectRoot, output);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, serialized, { flag: "wx" });
        console.log(destination);
      } else console.log(serialized);
      if (scope.mode === "none" || !scope.gateEligible) process.exitCode = 2;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
