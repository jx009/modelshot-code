"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const HeaderContext = createContext(null);

export function WorkspaceHeaderProvider({ children }) {
  const [title, setTitle] = useState(null), [actions, setActions] = useState(null);
  const value = useMemo(() => ({ title, actions, setTitle, setActions }), [title, actions]);
  return <HeaderContext.Provider value={value}>{children}</HeaderContext.Provider>;
}

export function WorkspaceHeaderSlot({ name }) {
  const header = useContext(HeaderContext);
  return <div className={`cr-workspace-header-${name}`} ref={name === "title" ? header.setTitle : header.setActions} />;
}

export default function WorkspaceHeader({ title, actions }) {
  const header = useContext(HeaderContext);
  return <>{header?.title && createPortal(title, header.title)}{header?.actions && createPortal(actions, header.actions)}</>;
}
