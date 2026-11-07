import { useNavigate } from "react-router";
import { PasswordChangeForm } from "./PasswordChangeForm";
import { LogoutButton } from "./LogoutButton";

export function PasswordChangePending() {
  const navigate = useNavigate();
  return (
    <section>
      <PasswordChangeForm
        onSuccess={() => void navigate("/", { replace: true })}
      />
      <LogoutButton />
    </section>
  );
}
