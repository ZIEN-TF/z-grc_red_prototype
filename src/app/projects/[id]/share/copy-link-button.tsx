"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function CopyLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const url = `${window.location.origin}/share/${token}`;
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("링크가 클립보드에 복사되었습니다.");
  }

  return (
    <Button variant="outline" size="sm" className="text-[11px]" onClick={handleCopy}>
      {copied ? (
        <Check className="mr-1 size-3 text-emerald-600" />
      ) : (
        <Copy className="mr-1 size-3" />
      )}
      복사
    </Button>
  );
}
