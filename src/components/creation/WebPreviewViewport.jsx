"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Resize the viewport, never the generated document. The iframe keeps the
// selected CSS viewport width; fitting it does not rebuild srcDoc or assets.
export default function WebPreviewViewport({ width, children, hostRef, mode }) {
  const host = useRef(null), [size, setSize] = useState(null);
  useLayoutEffect(() => {
    const element = host.current;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize(previous => previous?.width === next.width && previous?.height === next.height ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  const scale = size?.width > 0 ? Math.min(1, size.width / width) : 1;
  return <div className="cw-web-preview" data-mode={mode} ref={node => { host.current = node; if (hostRef) hostRef.current = node; }}>
    <div className="cw-web-viewport" style={{ width: width * scale, "--web-frame-width": `${width}px`, "--web-frame-height": size?.height > 0 ? `${size.height / scale}px` : "100%", "--web-frame-scale": scale }}>
      {children}
    </div>
  </div>;
}
