"use client";

import { useEffect } from "react";

// Saves the last-clicked requirement id to sessionStorage on click and, on
// mount, scrolls back to that requirement if one was recorded. Cleared after
// a single successful restore so a fresh visit always starts at the top.
export function DTScrollRestorer({ projectId }: { projectId: string }) {
  useEffect(() => {
    const key = `zgrc:dt:lastReq:${projectId}`;

    const saved = sessionStorage.getItem(key);
    if (saved) {
      sessionStorage.removeItem(key);
      requestAnimationFrame(() => {
        const el = document.getElementById(`req-${saved}`);
        if (!el) return;
        el.scrollIntoView({ block: "center" });
        el.classList.add("ring-2", "ring-primary/40", "ring-offset-2");
        setTimeout(() => {
          el.classList.remove("ring-2", "ring-primary/40", "ring-offset-2");
        }, 1600);
      });
    }

    function onClick(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target) return;
      const link = target.closest<HTMLElement>("[data-dt-req]");
      if (!link) return;
      const reqId = link.getAttribute("data-dt-req");
      if (reqId) sessionStorage.setItem(key, reqId);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [projectId]);

  return null;
}
