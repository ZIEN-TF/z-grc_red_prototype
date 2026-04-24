import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ForgotForm } from "./forgot-form";

export default async function ForgotPasswordPage() {
  const session = await getSession();
  if (session) {
    redirect("/");
  }
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          비밀번호 찾기
          <span className="ml-2 text-sm font-medium text-muted-foreground">
            / Reset Password
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          가입한 이메일을 입력하면 비밀번호 재설정 링크를 생성합니다.
        </p>
      </div>
      <ForgotForm />
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary hover:underline">
          로그인으로 돌아가기
        </Link>
      </p>
    </div>
  );
}
