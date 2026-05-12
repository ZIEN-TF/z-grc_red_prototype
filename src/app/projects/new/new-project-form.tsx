"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Paperclip, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createProject } from "@/app/actions";

const PRODUCT_TYPE_SUGGESTIONS = [
  "EV Charger / 전기차 충전기",
  "Medical Device / 의료기기",
  "Smart Home / 스마트홈",
  "Wearable / 웨어러블",
  "Router / 라우터",
  "IP Camera / IP 카메라",
  "Industrial IoT / 산업용 IoT",
  "Other / 기타",
];

const ATTACHMENT_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.svg,.docx,.xlsx,.doc,.xls,application/pdf,image/png,image/jpeg,image/svg+xml,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,application/vnd.ms-excel";

const REQUIRED_ATTACHMENTS = [
  {
    label: "사용자 매뉴얼 / User Manual",
    description: "사용자 매뉴얼",
    errorMsg: "사용자 매뉴얼 파일을 첨부해주세요. / User Manual is required.",
  },
  {
    label: "아키텍처 다이어그램 / Architecture & Network Diagram",
    description: "아키텍처 다이어그램/네트워크 흐름도",
    errorMsg:
      "아키텍처 다이어그램 파일을 첨부해주세요. / Architecture Diagram is required.",
  },
  {
    label: "Use Case",
    description: "Use Case",
    errorMsg: "Use Case 파일을 첨부해주세요. / Use Case document is required.",
  },
] as const;

export function NewProjectForm() {
  const [pending, startTransition] = useTransition();
  const [extraSlotIds, setExtraSlotIds] = useState<number[]>([]);
  const nextIdRef = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const reqFileRefs = useRef<(HTMLInputElement | null)[]>([null, null, null]);

  function addSlot() {
    setExtraSlotIds((prev) => [...prev, nextIdRef.current++]);
  }

  function removeSlot(id: number) {
    setExtraSlotIds((prev) => prev.filter((i) => i !== id));
  }

  async function onSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const manufacturer = String(formData.get("manufacturer") ?? "").trim();

    if (!name) {
      toast.error("제품명을 입력하세요. / Product name is required.");
      return;
    }
    if (!manufacturer) {
      toast.error("제조사를 입력하세요. / Manufacturer is required.");
      return;
    }

    for (let i = 0; i < REQUIRED_ATTACHMENTS.length; i++) {
      const file = reqFileRefs.current[i]?.files?.[0];
      if (!file || file.size === 0) {
        toast.error(REQUIRED_ATTACHMENTS[i].errorMsg);
        return;
      }
    }

    startTransition(async () => {
      try {
        await createProject(formData);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "저장 실패";
        if (msg.includes("NEXT_REDIRECT")) return;
        toast.error(msg);
        console.error(err);
      }
    });
  }

  return (
    <form ref={formRef} action={onSubmit}>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            기본 정보 / Basic Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field id="name" label="제품명 / Product Name" required>
            <Input
              id="name"
              name="name"
              placeholder="예: ChargePoint CP-100 / e.g. ChargePoint CP-100"
              disabled={pending}
              required
            />
          </Field>

          <Field id="manufacturer" label="제조사 / Manufacturer" required>
            <Input
              id="manufacturer"
              name="manufacturer"
              placeholder="예: Z-EN Systems Inc."
              disabled={pending}
              required
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="contactName" label="담당자 이름 / Contact Name">
              <Input
                id="contactName"
                name="contactName"
                disabled={pending}
                placeholder="홍길동 / Hong Gildong"
              />
            </Field>
            <Field id="contactEmail" label="담당자 이메일 / Contact Email">
              <Input
                id="contactEmail"
                name="contactEmail"
                type="email"
                disabled={pending}
                placeholder="name@example.com"
              />
            </Field>
          </div>

          <Field id="productType" label="제품 유형 / Product Type">
            <Input
              id="productType"
              name="productType"
              list="product-type-suggestions"
              disabled={pending}
              placeholder="예: EV Charger / 전기차 충전기"
            />
            <datalist id="product-type-suggestions">
              {PRODUCT_TYPE_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>

          <Field
            id="productDescription"
            label="제품 설명 / Product Description"
          >
            <Textarea
              id="productDescription"
              name="productDescription"
              rows={4}
              disabled={pending}
              placeholder="제품의 기능·통신 방식·사용 환경 등 간단한 설명 / Short description of the product's functions, communication, and operating environment."
            />
          </Field>

          {/* Required attachments */}
          <div className="space-y-3 border-t pt-5">
            <div>
              <Label className="text-sm font-medium">
                필수 첨부 파일 / Required Documents
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                아래 3가지 문서는 반드시 첨부해야 합니다. (PDF, DOCX, 이미지 · 최대 50MB)
              </p>
            </div>

            {REQUIRED_ATTACHMENTS.map((req, i) => (
              <div key={req.label} className="rounded-md border bg-muted/20 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Paperclip className="size-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-medium">
                    {req.label}
                    <span className="ml-1 text-destructive">*</span>
                  </span>
                </div>
                <input
                  type="hidden"
                  name="descriptions"
                  value={req.description}
                />
                <Input
                  ref={(el) => { reqFileRefs.current[i] = el; }}
                  type="file"
                  name="attachments"
                  accept={ATTACHMENT_ACCEPT}
                  disabled={pending}
                  className="cursor-pointer text-xs file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-[11px]"
                />
              </div>
            ))}
          </div>

          {/* Optional extra attachments */}
          <div className="space-y-3 border-t pt-5">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">
                  추가 첨부 파일 / Additional Attachments
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    (선택 사항)
                  </span>
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  사양서·인증서 등 추가 문서 (PDF, 이미지, DOCX, XLSX · 최대 50MB)
                </p>
              </div>
            </div>

            {extraSlotIds.map((id, idx) => (
              <AttachmentSlot
                key={id}
                index={idx + 1}
                disabled={pending}
                onRemove={() => removeSlot(id)}
              />
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addSlot}
              disabled={pending}
              className="w-full border-dashed"
            >
              <Plus className="mr-1 size-3.5" />
              파일 추가
            </Button>
          </div>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="submit" disabled={pending}>
            {pending
              ? "저장 중… / Saving…"
              : "저장 후 스크리닝 / Save & Start Screening"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function AttachmentSlot({
  index,
  disabled,
  onRemove,
}: {
  index: number;
  disabled?: boolean;
  onRemove?: () => void;
}) {
  return (
    <div className="relative rounded-md border bg-muted/20 p-3 pr-9">
      <div className="mb-2 flex items-center gap-2">
        <Paperclip className="size-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium text-muted-foreground">
          파일 #{index}
        </span>
      </div>
      <div className="space-y-2">
        <Input
          type="file"
          name="attachments"
          accept={ATTACHMENT_ACCEPT}
          disabled={disabled}
          className="cursor-pointer text-xs file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-[11px]"
        />
        <Input
          name="descriptions"
          disabled={disabled}
          placeholder="설명 (예: v1.2 사양서, 인증서 등)"
          className="text-xs"
        />
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive"
          aria-label="파일 슬롯 제거"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}
