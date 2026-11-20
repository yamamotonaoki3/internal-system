// db:generate に渡す引数の検査。scripts/db-local.ts は読み込むと実行されるため、検査だけを切り出してテストできるようにする
import { LocalEnvironmentError } from "./local-env.ts";

const MIGRATION_NAME = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * 引数なし・`--name <名前>`・`--custom --name <名前>` だけを通す。
 * `--custom` は Drizzle の生成に乗らない DDL（FTS5 の仮想の表）を手で書くための空の migration を作る（ADR の例外の手順）
 */
export function generateArgs(options: string[]): string[] {
  if (options.length === 0) return ["generate"];
  const custom = options[0] === "--custom";
  const rest = custom ? options.slice(1) : options;
  const name = rest[1];
  if (
    rest.length !== 2 ||
    rest[0] !== "--name" ||
    name === undefined ||
    !MIGRATION_NAME.test(name)
  ) {
    throw new LocalEnvironmentError(
      "db:generate は --name と英数字の名前（手で書く migration は前に --custom）だけを指定できます。",
    );
  }
  return custom
    ? ["generate", "--custom", "--name", name]
    : ["generate", "--name", name];
}
