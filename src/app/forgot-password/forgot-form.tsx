"use client";

import { useState, useTransition } from "react";
import { Copy, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/app/actions-auth";

export function ForgotForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [emailSubmitted, setEmailSubmitted] = useState(false);

  async function onSubmit(fd: FormData) {
    setError(null);
    setResetUrl(null);
    const email = String(fd.get("email") ?? "");
    startTransition(async () => {
      const res = await requestPasswordReset({ email });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEmailSubmitted(true);
      setResetUrl(res.resetUrl);
    });
  }

  function copyLink() {
    if (!resetUrl) return;
    const fullUrl = `${window.location.origin}${resetUrl}`;
    navigator.clipboard.writeText(fullUrl);
    toast.success("링크가 복사되었습니다.");
  }

  if (emailSubmitted) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-50/60 p-3 text-xs dark:bg-amber-950/20">
            <Mail className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">
                프로토타입 모드
              </p>
              <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                실제 배포 환경에서는 입력한 이메일 주소로 재설정 링크가
                전송됩니다. 현재는 아래에 링크를 직접 표시합니다.
              </p>
            </div>
          </div>

          {resetUrl ? (
            <div className="space-y-2">
              <Label>재설정 링크</Label>
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs">
                <code className="flex-1 overflow-x-auto whitespace-nowrap">
                  {resetUrl}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={copyLink}
                  className="shrink-0 gap-1"
                >
                  <Copy className="size-3" />
                  복사
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                링크는 1시간 동안 유효합니다.
              </p>
              <a
                href={resetUrl}
                className="flex w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                링크로 이동 → 비밀번호 재설정
              </a>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              해당 이메일로 가입된 계정이 있다면 재설정 링크가 전송되었습니다.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <form action={onSubmit}>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="email">이메일 / Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={pending}
              placeholder="name@example.com"
            />
          </div>
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending} className="w-full">
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            재설정 링크 생성
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
