// DM の画面 S-06（/dms/:roomId）。
import { useParams } from "react-router";
import { DmView } from "../features/dms";
import { NotFoundPage } from "./NotFoundPage";

export function DmPage() {
  const { roomId } = useParams();
  if (roomId === undefined) return <NotFoundPage />;
  // 別の DM へ移ったとき、画面の状態（送信できなかった知らせ等）を持ち越さない
  return <DmView key={roomId} roomId={roomId} />;
}
