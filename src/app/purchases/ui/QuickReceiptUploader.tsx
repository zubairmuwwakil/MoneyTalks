"use client";

import { Dialog } from "@base-ui/react/dialog";
import {
  Loader2,
  Plus,
  Receipt,
  UploadCloud,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

export function QuickReceiptUploader({
  purchaseId,
  merchant,
  variant = "button",
}: {
  purchaseId?: string;
  merchant?: string;
  variant?: "button" | "icon" | "dropzone";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file) return;
    setIsUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    if (purchaseId) formData.append("purchaseId", purchaseId);

    try {
      const res = await fetch("/api/receipts/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to upload receipt");
      }

      toast.success("Receipt uploaded & scanned successfully", {
        description: merchant ? `Attached to ${merchant}` : undefined,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error uploading receipt");
    } finally {
      setIsUploading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }

  return (
    <>
      {variant === "button" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-border/80 px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:border-primary hover:text-primary"
          title={`Upload receipt for ${merchant ?? "this purchase"}`}
        >
          <Plus className="size-3" />
          <span>Add Receipt</span>
        </button>
      ) : variant === "icon" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border border-border/80 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          title="Upload receipt"
        >
          <UploadCloud className="size-3.5" />
        </button>
      ) : null}

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs animate-in fade-in-0 duration-150" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
            <Dialog.Popup
              initialFocus
              className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border/80 bg-popover shadow-2xl outline-none animate-in slide-in-from-bottom-2 duration-200 sm:rounded-2xl sm:zoom-in-95"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Receipt className="size-4" />
                    </div>
                    <Dialog.Title className="text-base font-semibold text-foreground">
                      Upload Receipt
                    </Dialog.Title>
                  </div>
                  <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                    {merchant ? (
                      <>Attach PDF or photo receipt to <span className="font-medium text-foreground">{merchant}</span>.</>
                    ) : (
                      <>Drop your receipt or invoice to automatically parse items and taxes.</>
                    )}
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  disabled={isUploading}
                  aria-label="Close uploader"
                  className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <X className="size-4" />
                </Dialog.Close>
              </div>

              {/* Body / Dropzone */}
              <div className="p-5">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                  onClick={() => !isUploading && fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all cursor-pointer ${
                    isDragging
                      ? "border-primary bg-primary/10 scale-[1.02]"
                      : "border-border/80 bg-muted/20 hover:border-primary/50 hover:bg-muted/40"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        handleFile(e.target.files[0]);
                      }
                    }}
                  />

                  {isUploading ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="size-8 animate-spin text-primary" />
                      <p className="text-sm font-semibold text-foreground">Processing receipt…</p>
                      <p className="text-xs text-muted-foreground">Extracting amounts, dates & lines</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs">
                        <UploadCloud className="size-6" />
                      </div>
                      <p className="text-sm font-bold text-foreground">
                        Click or drag receipt here
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Supports PDF, PNG, JPG, HEIC up to 10MB
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
