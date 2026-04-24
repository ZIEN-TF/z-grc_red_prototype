"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmPasswordReset } from "@/app/actions-auth";

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(fd: FormData) {
    setError(null);
    const newPassword = String(fd.get("newPassword") ?? "");
    const confirm = String(fd.get("confirm") ?? "");
    if (newPassword !== confirm) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }
    startTransition(async () => {
      const res = await confirmPasswordReset({ token, newPassword });
      if (res.ok) {
        setDone(true);
        toast.success("비밀번호가 변경되었습니다.");
        setTimeout(() => router.replace("/login"), 1200);
      } else {
        setError(res.error);
      }
    });
  }

  if (done) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 className="size-10 text-emerald-600" />
          <p className="text-sm font-medium">비밀번호가 변경되었습니다.</p>
          <p className="text-xs text-muted-foreground">
            잠시 후 로그인 페이지로 이동합니다…
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <form action={onSubmit}>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="newPassword">새 비밀번호 / New Password</Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">비밀번호 확인 / Confirm</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
              disabled={pending}
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
            비밀번호 변경
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
