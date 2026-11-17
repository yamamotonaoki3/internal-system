// 書き込みの失敗を、ダイアログの中に出す文にする。想定外のエラーは受け止めずに投げ直す（握りつぶさない）。
import { useState } from "react";
import { describeError } from "../describe-error";

export function useMutationError() {
  const [error, setError] = useState<string>();
  async function run(operation: () => Promise<unknown>): Promise<boolean> {
    setError(undefined);
    try {
      await operation();
    } catch (caught) {
      const message = describeError(caught);
      if (message === null) throw caught;
      setError(message);
      return false;
    }
    return true;
  }
  return { error, setError, run };
}
