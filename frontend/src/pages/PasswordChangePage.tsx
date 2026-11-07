import { useLocation, useNavigate } from "react-router";
import { PasswordChangeForm } from "../features/auth/components/PasswordChangeForm";

function safeReturnPath(state: unknown): string {
  if (typeof state !== "object" || state === null || !("from" in state))
    return "/";
  const from = state.from;
  if (
    typeof from !== "string" ||
    !from.startsWith("/") ||
    from.startsWith("//")
  )
    return "/";
  if (from.split(/[?#]/, 1)[0] === "/password") return "/";
  return from;
}

export function PasswordChangePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnPath = safeReturnPath(location.state);
  const back = () => void navigate(returnPath, { replace: true });
  return (
    <section className="max-w-3xl">
      <h1 className="mb-4 text-2xl font-bold">パスワードを変更</h1>
      <PasswordChangeForm onSuccess={back} onCancel={back} />
    </section>
  );
}
