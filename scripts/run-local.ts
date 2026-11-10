// 子プロセスへ渡す前に設定を検証する。Windows でも外部ウィンドウを作らない。
import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  findRunningDevServer,
  parsePidFile,
  PID_FILE,
  readPidFile,
} from "./dev-server-pid.ts";
import {
  applyLocalEnvironment,
  assertNoDevVars,
  clearInheritedEnvironment,
  loadLocalEnvironment,
  LocalEnvironmentError,
  readWorkerConfig,
  type LocalEnvironment,
} from "./local-env.ts";

const [environment, tool, ...args] = process.argv.slice(2);
try {
  if (environment === "build") {
    assertNoDevVars();
    readWorkerConfig();
    clearInheritedEnvironment();
  } else {
    const values = loadLocalEnvironment(environment as LocalEnvironment);
    applyLocalEnvironment(values);
    console.log(`環境：${values.APP_ENV}`);
  }
  if (
    args.some(
      (arg) => arg === "--" + "remote" || arg.startsWith("--" + "remote="),
    )
  )
    throw new Error("手元の実行で remote は使えません。");
  // 道具の名前 → パッケージ名（名前が違うものだけ。playwright の実体は @playwright/test）
  const packages: Record<string, string> = {
    vite: "vite",
    vitest: "vitest",
    wrangler: "wrangler",
    "drizzle-kit": "drizzle-kit",
    playwright: "@playwright/test",
  };
  if (!Object.hasOwn(packages, tool))
    throw new Error("起動する道具が不正です。");
  const packageDir = path.resolve("node_modules", ...packages[tool].split("/"));
  const pkg = JSON.parse(
    readFileSync(path.join(packageDir, "package.json"), "utf8"),
  );
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin[tool];
  // 開発サーバーだけ、npm run dev:stop が止める対象を知るために PID を記録する
  const isDevServer =
    tool === "vite" && !args.includes("build") && !args.includes("preview");
  let ownsPidFile = false;
  if (isDevServer) {
    // すでに動いている開発サーバーの記録は上書きしない（このあとの vite は、ポート使用中なら従来どおり失敗する）
    let running: number | null;
    try {
      running = findRunningDevServer();
    } catch (error) {
      throw new LocalEnvironmentError(
        `.dev-server.pid の確認に失敗しました：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (running !== null)
      console.log(`開発サーバーがすでに動いています（PID ${running}）。`);
    else {
      try {
        writeFileSync(PID_FILE, String(process.pid));
      } catch (error) {
        throw new LocalEnvironmentError(
          `.dev-server.pid を書けません：${(error as NodeJS.ErrnoException).code ?? "原因不明"}`,
        );
      }
      ownsPidFile = true;
    }
  }
  const child = spawn(process.execPath, [path.join(packageDir, bin), ...args], {
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
  });
  child.on("error", () => {
    console.error("起動に失敗しました（値は表示しません）。");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
    if (ownsPidFile) {
      try {
        // 中身が自分の PID のときだけ消す
        const text = readPidFile();
        if (text !== null && parsePidFile(text) === process.pid)
          rmSync(PID_FILE, { force: true });
      } catch (error) {
        console.error(
          `.dev-server.pid を消せません：${(error as NodeJS.ErrnoException).code ?? "原因不明"}`,
        );
        process.exitCode = 1;
      }
    }
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => child.kill(signal));
} catch (error) {
  console.error(
    error instanceof LocalEnvironmentError
      ? error.message
      : "設定または起動の確認に失敗しました（値は表示しません）。",
  );
  process.exitCode = 1;
}
