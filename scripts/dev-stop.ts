// この作業ツリーで scripts/run-local.ts が起動した開発サーバー（vite・wrangler）のプロセスツリーを止め、
// 5173・8787 の待ち受けが残っていないことを確かめる。対象は .dev-server.pid に記録された PID だけで、
// コマンドラインを検索して止めることはしない（他の作業ツリー・プロジェクトのプロセスを巻き込まないため）。
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import net from "node:net";
import {
  commandLineOf,
  isRunLocalVite,
  parsePidFile,
  PID_FILE,
  readPidFile,
} from "./dev-server-pid.ts";

const PORTS = [5173, 8787];
const isWindows = process.platform === "win32";

type ProcessInfo = { pid: number; ppid: number; command: string };
type Listener = { port: number; pid: number };

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function powershell(script: string): string {
  const result = run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
  if (result.status !== 0)
    throw new Error("PowerShell の実行に失敗しました。" + result.stderr);
  return result.stdout.trim();
}

function parseJsonArray(text: string): Record<string, unknown>[] {
  if (text === "") return [];
  const parsed: unknown = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed : [parsed]) as Record<
    string,
    unknown
  >[];
}

function listProcesses(): ProcessInfo[] {
  if (isWindows) {
    const text = powershell(
      "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine)",
    );
    return parseJsonArray(text).map((row) => ({
      pid: Number(row.ProcessId),
      ppid: Number(row.ParentProcessId),
      command: String(row.CommandLine ?? ""),
    }));
  }
  const result = run("ps", ["-eo", "pid=,ppid=,args="]);
  if (result.status !== 0) throw new Error("ps の実行に失敗しました。");
  return result.stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match
      ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }]
      : [];
  });
}

function listListeners(): Listener[] {
  if (isWindows) {
    const text = powershell(
      `ConvertTo-Json -Compress -InputObject @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { @(${PORTS.join(",")}) -contains $_.LocalPort } | Select-Object LocalPort, OwningProcess)`,
    );
    return parseJsonArray(text).map((row) => ({
      port: Number(row.LocalPort),
      pid: Number(row.OwningProcess),
    }));
  }
  const result = run("lsof", [
    "-nP",
    "-sTCP:LISTEN",
    ...PORTS.map((port) => `-iTCP:${port}`),
    "-Fpn",
  ]);
  // lsof は該当なしのとき終了コード 1 を返すので、標準エラーがあるときだけ失敗とみなす
  if (result.status !== 0 && result.stderr.trim() !== "")
    throw new Error("lsof の実行に失敗しました。");
  const listeners: Listener[] = [];
  let pid = 0;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n")) {
      const port = Number(line.slice(line.lastIndexOf(":") + 1));
      if (PORTS.includes(port)) listeners.push({ port, pid });
    }
  }
  return listeners;
}

function descendantsOf(rootPid: number, all: ProcessInfo[]): number[] {
  const result: number[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const info of all)
      if (info.ppid === current && !result.includes(info.pid)) {
        result.push(info.pid);
        queue.push(info.pid);
      }
  }
  return result;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function signalAll(pids: number[], signal: NodeJS.Signals) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}

// 止められなかったときは、内容を表示して false を返す
async function stopTree(rootPid: number): Promise<boolean> {
  if (isWindows) {
    const result = run("taskkill", ["/PID", String(rootPid), "/T", "/F"]);
    if (result.status === 0) return true;
    console.error(
      `taskkill が失敗しました（終了コード ${result.status}）。${result.stderr.trim()}`,
    );
    return false;
  }
  // 子孫は止める直前に取り直す（子が入れ替わっていることがあるため）
  const pids = [...descendantsOf(rootPid, listProcesses()).reverse(), rootPid];
  signalAll(pids, "SIGTERM");
  for (let i = 0; i < 10 && pids.some(isAlive); i++) await sleep(500);
  const survivors = pids.filter(isAlive);
  if (survivors.length > 0) signalAll(survivors, "SIGKILL");
  await sleep(200);
  const remaining = pids.filter(isAlive);
  if (remaining.length > 0) {
    console.error(
      `止められなかったプロセスがあります（PID ${remaining.join("・")}）。`,
    );
    return false;
  }
  return true;
}

// 接続できれば待ち受けがある。この端末では一覧（Get-NetTCPConnection・netstat）に
// 待ち受けが出ないことがあるため、接続の試行を主の確認にする
function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1000);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    // 応答がないのは、待ち受けが残っている可能性があるため「解放済み」とはしない
    socket.on("timeout", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve(false);
      else if (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT")
        resolve(false);
      else reject(error);
    });
  });
}

async function findOpenPorts(): Promise<number[]> {
  const open: number[] = [];
  for (const port of PORTS) {
    const results = await Promise.all(
      ["127.0.0.1", "::1"].map((host) => canConnect(host, port)),
    );
    if (results.some(Boolean)) open.push(port);
  }
  return open;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// PID の補足表示だけに使う。一覧が取れなくても、確認の結果は変えない
function describeOwners(port: number): string {
  try {
    const pids = listListeners()
      .filter((listener) => listener.port === port)
      .map((listener) => listener.pid);
    return pids.length > 0 ? `（PID ${pids.join("・")}）` : "（PID は不明）";
  } catch {
    return "（PID は不明）";
  }
}

async function stopRecorded(): Promise<boolean> {
  const text = readPidFile();
  if (text === null) {
    console.log("開発サーバーは動いていません（PID ファイルなし）。");
    return true;
  }
  const pid = parsePidFile(text);
  const command = pid === null ? undefined : commandLineOf(pid);
  if (pid === null || command === undefined || !isRunLocalVite(command)) {
    console.log("古い PID ファイルです。消します（プロセスは止めません）。");
    rmSync(PID_FILE, { force: true });
    return true;
  }
  console.log(`開発サーバーを止めます（PID ${pid}）。`);
  const stopped = await stopTree(pid);
  if (stopped) rmSync(PID_FILE, { force: true });
  return stopped;
}

async function main(): Promise<number> {
  const stopped = await stopRecorded();

  let remaining = await findOpenPorts();
  for (let i = 0; i < 10 && remaining.length > 0; i++) {
    await sleep(500);
    remaining = await findOpenPorts();
  }
  if (remaining.length > 0) {
    for (const port of remaining)
      console.error(
        `ポート ${port} に待ち受けが残っています${describeOwners(port)}。`,
      );
    console.error(
      "run-local 以外のプロセスの可能性があるため、自動では止めません。",
    );
    return 1;
  }
  if (!stopped) return 1;
  console.log(`${PORTS.join("・")} に待ち受けはありません。`);
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
