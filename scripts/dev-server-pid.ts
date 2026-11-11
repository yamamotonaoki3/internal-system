// 開発サーバー（run-local の vite）の PID の記録を扱う。run-local.ts と dev-stop.ts が共有する。
// import しても何も実行しない（副作用を置かない）。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const PID_FILE = path.resolve(".dev-server.pid");

// PID ファイルの中身を PID にする。数字以外・0 以下は null
export function parsePidFile(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const pid = Number(trimmed);
  return pid > 0 ? pid : null;
}

// PID の再利用に備え、run-local で起動した vite（開発サーバー）のコマンドラインかを確かめる
export function isRunLocalVite(command: string): boolean {
  return (
    /run-local/.test(command) && /(^|[\s\/"'])vite([\s"']|$)/.test(command)
  );
}

// PID ファイルがなければ null
export function readPidFile(): string | null {
  try {
    return readFileSync(PID_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// プロセスのコマンドライン。存在しなければ undefined
export function commandLineOf(pid: number): string | undefined {
  const result =
    process.platform === "win32"
      ? spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`,
          ],
          { encoding: "utf8", windowsHide: true },
        )
      : spawnSync("ps", ["-p", String(pid), "-o", "args="], {
          encoding: "utf8",
        });
  if (result.error) throw result.error;
  const stderr = result.stderr.trim();
  // ps -p は、プロセスがないとき「終了コード 1 で標準エラーが空」になる。それ以外の失敗は、プロセスなしと誤認しない
  const noProcess =
    process.platform !== "win32" && result.status === 1 && stderr === "";
  if (result.status !== 0 && !noProcess)
    throw new Error(
      `プロセスのコマンドラインを取得できませんでした（終了コード ${result.status}）。${stderr}`,
    );
  const text = result.stdout.trim();
  return text === "" ? undefined : text;
}

// 記録された PID が、生きている run-local の vite なら、その PID を返す
export function findRunningDevServer(): number | null {
  const text = readPidFile();
  if (text === null) return null;
  const pid = parsePidFile(text);
  if (pid === null) return null;
  const command = commandLineOf(pid);
  return command !== undefined && isRunLocalVite(command) ? pid : null;
}
