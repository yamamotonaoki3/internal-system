import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <section>
      <h1 className="mb-4 text-2xl font-bold">ページが見つかりません</h1>
      <Link to="/">ホームへ戻る</Link>
    </section>
  );
}
