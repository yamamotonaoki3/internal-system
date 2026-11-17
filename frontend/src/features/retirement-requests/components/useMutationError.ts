// 書き込みの失敗を、ダイアログの中に出す文にする。想定外のエラーは受け止めずに投げ直す（握りつぶさない）。
// field を渡すと、サーバーの 422 で fields にその欄が含まれる失敗は、欄のエラー（fieldError）にする。それ以外は欄の外のエラー（error）にする。
import { useState } from "react";
import { describeError, isApiError } from "../describe-error";

export function useMutationError() {
  const [error, setError] = useState<string>();
  const [fieldError, setFieldError] = useState<string>();
  async function run(
    operation: () => Promise<unknown>,
    field?: string,
  ): Promise<boolean> {
    setError(undefined);
    setFieldError(undefined);
    try {
      await operation();
    } catch (caught) {
      const message = describeError(caught);
      if (message === null) throw caught;
      if (
        field !== undefined &&
        isApiError(caught) &&
        caught.status === 422 &&
        (caught.fields ?? []).includes(field)
      ) {
        setFieldError(message);
      } else {
        setError(message);
      }
      return false;
    }
    return true;
  }
  return { error, setError, fieldError, setFieldError, run };
}
