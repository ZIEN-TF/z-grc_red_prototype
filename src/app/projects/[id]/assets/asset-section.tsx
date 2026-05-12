"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type AssetKindConfig, optionLabel } from "@/lib/asset-kinds";
import { createAsset, deleteAsset, updateAsset } from "@/app/actions";
import { cn } from "@/lib/utils";

export type AssetRow = {
  id: string;
  name: string;
  description: string | null;
  metadata: Record<string, string>;
  createdAt: string;
};

export function AssetSection({
  projectId,
  kindConfig,
  assets,
  aiGeneratedIds,
}: {
  projectId: string;
  kindConfig: AssetKindConfig;
  assets: AssetRow[];
  aiGeneratedIds?: string[];
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">
              {kindConfig.title_ko}
              <span className="ml-2 text-sm font-medium text-muted-foreground">
                / {kindConfig.title_en}
              </span>
            </CardTitle>
            <CardDescription className="mt-1">
              {kindConfig.description_ko}
              <br />
              <span className="text-xs italic">{kindConfig.description_en}</span>
            </CardDescription>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger
              render={
                <Button size="sm">
                  <Plus className="mr-1 size-4" />
                  추가 / Add
                </Button>
              }
            />
            <AssetFormDialog
              mode="add"
              projectId={projectId}
              kindConfig={kindConfig}
              onClose={() => setAddOpen(false)}
            />
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {assets.length === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            등록된 항목이 없습니다. 상단 "추가" 버튼으로 등록하세요.
            <br />
            <span className="text-xs italic">
              No entries yet. Click "Add" above to register one.
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름 / Name</TableHead>
                  {kindConfig.listColumns.map((col) => {
                    const f = kindConfig.metadataFields.find(
                      (f) => f.name === col,
                    );
                    return (
                      <TableHead key={col}>
                        {f?.label_ko ?? col}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          / {f?.label_en ?? col}
                        </span>
                      </TableHead>
                    );
                  })}
                  <TableHead>설명 / Description</TableHead>
                  <TableHead className="w-24 text-right">작업 / Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((a) => (
                  <AssetRowView
                    key={a.id}
                    asset={a}
                    kindConfig={kindConfig}
                    projectId={projectId}
                    isAiGenerated={aiGeneratedIds?.includes(a.id) ?? false}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AssetRowView({
  asset,
  kindConfig,
  projectId,
  isAiGenerated,
}: {
  asset: AssetRow;
  kindConfig: AssetKindConfig;
  projectId: string;
  isAiGenerated?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  function onDelete() {
    if (!confirm(`"${asset.name}" 항목을 삭제할까요? / Delete this item?`)) return;
    startTransition(async () => {
      await deleteAsset(asset.id, projectId);
    });
  }

  return (
    <TableRow className={cn(isAiGenerated && "border-primary/40 bg-primary/5")}>
      <TableCell className="font-medium">
        <span className="flex items-center gap-1.5">
          {asset.name}
          {isAiGenerated && (
            <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-normal text-primary">
              <Sparkles className="size-2.5" /> AI
            </span>
          )}
        </span>
      </TableCell>
      {kindConfig.listColumns.map((col) => {
        const raw = asset.metadata[col] ?? "";
        if (!raw) {
          return (
            <TableCell key={col} className="text-muted-foreground/60">
              —
            </TableCell>
          );
        }
        const f = kindConfig.metadataFields.find((f) => f.name === col);
        if (f?.type === "select") {
          const label = optionLabel(kindConfig, col, raw);
          return (
            <TableCell key={col}>
              <span>{label.ko}</span>
              {label.ko !== label.en && (
                <span className="ml-1 text-xs text-muted-foreground">
                  / {label.en}
                </span>
              )}
            </TableCell>
          );
        }
        return <TableCell key={col}>{raw}</TableCell>;
      })}
      <TableCell className="text-sm text-muted-foreground">
        {asset.description || "—"}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Edit"
                  disabled={pending}
                >
                  <Pencil className="size-4" />
                </Button>
              }
            />
            <AssetFormDialog
              mode="edit"
              projectId={projectId}
              kindConfig={kindConfig}
              existing={asset}
              onClose={() => setEditOpen(false)}
            />
          </Dialog>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={pending}
            aria-label="Delete"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function AssetFormDialog({
  mode,
  projectId,
  kindConfig,
  existing,
  onClose,
}: {
  mode: "add" | "edit";
  projectId: string;
  kindConfig: AssetKindConfig;
  existing?: AssetRow;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [metadata, setMetadata] = useState<Record<string, string>>(
    existing?.metadata ?? {},
  );

  function setField(key: string, value: string) {
    setMetadata((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("이름을 입력하세요. / Name is required.");
      return;
    }
    const missing = kindConfig.metadataFields
      .filter((f) => f.required && !metadata[f.name]?.trim())
      .map((f) => `${f.label_ko} / ${f.label_en}`);
    if (missing.length > 0) {
      toast.error(`필수 항목이 누락되었습니다: ${missing.join(", ")}`);
      return;
    }

    startTransition(async () => {
      try {
        if (mode === "edit" && existing) {
          await updateAsset({
            id: existing.id,
            projectId,
            name,
            description,
            metadata,
          });
          toast.success("수정되었습니다. / Updated.");
        } else {
          await createAsset({
            projectId,
            kind: kindConfig.kind,
            name,
            description,
            metadata,
          });
          toast.success("추가되었습니다. / Added.");
          setName("");
          setDescription("");
          setMetadata({});
        }
        onClose();
      } catch (err) {
        toast.error("저장 실패 / Failed to save.");
        console.error(err);
      }
    });
  }

  const titleKo =
    mode === "edit" ? `${kindConfig.title_ko} 수정` : `${kindConfig.title_ko} 추가`;
  const titleEn =
    mode === "edit"
      ? `Edit ${kindConfig.title_en.replace(/s$/, "")}`
      : `Add ${kindConfig.title_en.replace(/s$/, "")}`;

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>
          {titleKo}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            / {titleEn}
          </span>
        </DialogTitle>
        <DialogDescription>{kindConfig.description_ko}</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="asset-name">
            이름 / Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="asset-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kindConfig.namePlaceholder}
            disabled={pending}
            required
          />
        </div>

        {kindConfig.metadataFields.map((f) => (
          <div key={f.name} className="space-y-2">
            <Label htmlFor={`asset-${f.name}`}>
              {f.label_ko}
              <span className="ml-1 text-xs text-muted-foreground">
                / {f.label_en}
              </span>
              {f.required && <span className="ml-1 text-destructive">*</span>}
            </Label>
            {f.type === "select" && f.options ? (
              <Select
                value={metadata[f.name] ?? ""}
                onValueChange={(v) => setField(f.name, v ?? "")}
                disabled={pending}
              >
                <SelectTrigger id={`asset-${f.name}`}>
                  <SelectValue placeholder="선택 / Select" />
                </SelectTrigger>
                <SelectContent>
                  {f.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span>{opt.label_ko}</span>
                      {opt.label_ko !== opt.label_en && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          / {opt.label_en}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : f.type === "textarea" ? (
              <Textarea
                id={`asset-${f.name}`}
                value={metadata[f.name] ?? ""}
                onChange={(e) => setField(f.name, e.target.value)}
                placeholder={f.placeholder}
                disabled={pending}
                rows={3}
              />
            ) : (
              <Input
                id={`asset-${f.name}`}
                value={metadata[f.name] ?? ""}
                onChange={(e) => setField(f.name, e.target.value)}
                placeholder={f.placeholder}
                disabled={pending}
              />
            )}
          </div>
        ))}

        <div className="space-y-2">
          <Label htmlFor="asset-description">설명 / Description</Label>
          <Textarea
            id="asset-description"
            value={description ?? ""}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            disabled={pending}
            placeholder="자유롭게 기술 / Free-form notes"
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
          >
            취소 / Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending
              ? "저장 중… / Saving…"
              : mode === "edit"
                ? "저장 / Save"
                : "추가 / Add"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
