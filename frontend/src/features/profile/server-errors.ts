// サーバーのエラーを、フォームの欄のエラーにする。422 の fields は該当する欄へ、それ以外は欄の外のエラーにする。
// ApiError でないもの（想定外の失敗）は握りつぶさず、そのまま投げ直す。
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { describeError, isApiError } from "./describe-error";

export function applyServerError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fieldNames: readonly Path<T>[],
): void {
  if (!isApiError(error)) throw error;
  const fields =
    error.status === 422
      ? (error.fields ?? []).filter((field): field is Path<T> =>
          (fieldNames as readonly string[]).includes(field),
        )
      : [];
  if (fields.length === 0) {
    setError("root.server", { message: describeError(error) });
    return;
  }
  for (const field of fields) setError(field, { message: error.message });
}
