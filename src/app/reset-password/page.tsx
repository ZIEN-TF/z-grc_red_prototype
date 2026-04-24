import Link from "next/link";
import { ResetForm } from "./reset-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          비밀번호 재설정
          <span className="ml-2 text-sm font-medium text-muted-foreground">
            / New Password
          </span>
        </h1>
      </div>
      {!token ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          재설정 토큰이 없습니다. 비밀번호 찾기에서 다시 시작해 주세요.
        </p>
      ) : (
        <ResetForm token={token} />
      )}
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary hover:underline">
          로그인으로 돌아가기
        </Link>
      </p>
    </div>
  );
}
