"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ForgetButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const res = await fetch(`/api/sdk/memory/${encodeURIComponent(id)}`, {
              method: "DELETE",
            });
            if (!res.ok) {
              setError("delete failed");
              return;
            }
            router.refresh();
          });
        }}
        className="rounded border border-zinc-700 px-2 py-1 text-xs uppercase tracking-wide text-muted hover:text-fg disabled:opacity-50"
      >
        forget
      </button>
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
