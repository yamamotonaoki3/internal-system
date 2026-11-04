// 要求の追跡ID（監査ログの trace_id）。X-Request-Id を使うが、利用者が送れる値のため、形と長さを限る。
import type { Context } from "hono";
import { newUlid } from "./ulid";

const TRACE_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function traceIdOf(c: Context): string {
  const header = c.req.header("X-Request-Id");
  return header !== undefined && TRACE_ID_PATTERN.test(header)
    ? header
    : newUlid();
}
