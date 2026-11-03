// 初代管理者が未設定のときだけ、初回セットアップへのリンクを出す。
// 取得中・取得失敗のときは出さない（未設定とみなさない）。
import { Link } from "react-router";
import { useSetupStatus } from "../hooks/useSetupStatus";

export function SetupEntryLink() {
  const { data } = useSetupStatus();
  if (data?.setupRequired !== true) return null;
  return <Link to="/setup">初回セットアップへ</Link>;
}
