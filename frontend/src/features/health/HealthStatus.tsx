// 部品：サーバーの状態を表示する。サーバーの状態は TanStack Query で扱う。
import { useQuery } from "@tanstack/react-query";
import { Alert } from "../../components/Alert";
import { fetchHealth } from "./api/health";

export function HealthStatus() {
  const { data, error, isPending } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
  });

  if (isPending) return <p className="mb-3 text-text-muted">確認中です</p>;
  if (error)
    return (
      <Alert tone="error" role="alert" as="p">
        サーバーにつながりません
      </Alert>
    );
  return (
    <p className="mb-3 text-text-muted">
      サーバーの状態：{data.status}（環境：{data.appEnv}）
    </p>
  );
}
