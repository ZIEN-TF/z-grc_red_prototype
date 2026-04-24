import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getSession();
  if (session) {
    redirect("/");
  }
  const { next } = await searchParams;
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          로그인
          <span className="ml-2 text-sm font-medium text-muted-foreground">
            / Sign In
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Z-GRC RED에 로그인하세요.
        </p>
      </div>
      <LoginForm next={next} />
      <div className="space-y-1.5 text-center text-sm text-muted-foreground">
        <p>
          계정이 없으신가요?{" "}
          <Link
            href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="text-primary hover:underline"
          >
            회원가입
          </Link>
        </p>
        <p>
          <Link
            href="/forgot-password"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            비밀번호를 잊으셨나요?
          </Link>
        </p>
      </div>
    </div>
  );
}
