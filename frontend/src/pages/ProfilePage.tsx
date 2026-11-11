// S-19 プロフィール設定（表示名・ステータス・戻り予定・一言メッセージ）。
import { ProfileForm } from "../features/profile";

export function ProfilePage() {
  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">プロフィール設定</h1>
      <ProfileForm />
    </section>
  );
}
