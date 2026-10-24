"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { registerNavigationGuard } from "@/lib/navigation-guard";

export function useCreationNavigationGuard({ root, gate, prepare, onError }) {
  const latest = useRef(null);
  const [leaving, setLeaving] = useState(false);
  useLayoutEffect(() => { latest.current = { prepare, onError }; });
  useEffect(() => {
    const element = root.current;
    let alive = true, ownsGate = false, previousFocus = null;
    const unregister = registerNavigationGuard({
      async prepare() {
        if (gate.current) throw new Error("CREATION_ACTION_PENDING");
        gate.current = true; ownsGate = true;
        const focused = element?.ownerDocument.activeElement;
        previousFocus = element?.contains(focused) ? focused : null;
        if (element) element.inert = true;
        setLeaving(true);
        await latest.current.prepare();
      },
      onError(error) { if (alive) latest.current.onError?.(error); },
      finish() {
        if (!ownsGate) return;
        ownsGate = false; gate.current = false;
        if (alive) {
          if (element) element.inert = false;
          // Making the editor inert blurs its hidden input. On a refused
          // departure restore that input so Enter/Escape can finish the cell.
          // Do not steal focus if the user moved to another part of the shell.
          if (previousFocus?.isConnected && element?.ownerDocument.activeElement === element.ownerDocument.body) previousFocus.focus({ preventScroll: true });
          setLeaving(false);
        }
        previousFocus = null;
      },
    });
    return () => {
      alive = false; unregister();
      if (ownsGate) { ownsGate = false; gate.current = false; if (element) element.inert = false; }
    };
  }, [root, gate]);
  return leaving;
}
