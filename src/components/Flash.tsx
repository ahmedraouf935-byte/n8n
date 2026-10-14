"use client";
import { useEffect, useState } from "react";

export interface FlashMsg { type: "ok" | "error"; text: string; id: string }

/** Shows the one-shot message a server action left in the `safqa_flash` cookie (read server-side), then clears it. */
export function Flash({ initial }: { initial: FlashMsg | null }) {
  const [msg, setMsg] = useState(initial);
  useEffect(() => {
    if (!initial) return;
    document.cookie = "safqa_flash=; Max-Age=0; path=/";
    const t = setTimeout(() => setMsg(null), 9000);
    return () => clearTimeout(t);
  }, [initial]);
  if (!msg) return null;
  return (
    <div role="status" className={`fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-xl rounded-lg border px-4 py-3 text-sm shadow-lg sm:right-auto ${msg.type === "ok" ? "border-transparent bg-good-soft text-good" : "border-transparent bg-bad-soft text-bad"}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="whitespace-pre-line">{msg.text}</span>
        <button onClick={() => setMsg(null)} aria-label="إغلاق" className="opacity-70 hover:opacity-100">✕</button>
      </div>
    </div>
  );
}
