"use client";

import { Toaster } from "react-hot-toast";

export default function ThemedToaster() {
  return <Toaster position="top-right" toastOptions={{
    style: {
      background: "var(--bg-elevated)",
      color: "var(--primary-text)",
      border: "1px solid var(--divider-strong)",
      boxShadow: "0 8px 28px var(--shadow-soft)",
    },
    success: { iconTheme: { primary: "var(--success)", secondary: "var(--bg-elevated)" } },
    error: { iconTheme: { primary: "var(--danger)", secondary: "var(--bg-elevated)" } },
  }} />;
}
