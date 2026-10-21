"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { contentTransition, destinationPath } from "@/lib/navigation-destination";

const NavigationContext = createContext(null);
const NavigationStateContext = createContext(null);

export function useNavigationFeedback() { return useContext(NavigationContext); }
export function useNavigationState() { return useContext(NavigationStateContext); }
export function useNavigationPath(section, pathname) {
  const navigation = useNavigationState();
  return contentTransition(navigation, section) ? destinationPath(navigation.href) : pathname;
}

export default function NavigationFeedback({ children }) {
  const [navigation, setNavigation] = useState(null);
  const [slow, setSlow] = useState(false);
  const sequence = useRef(0);
  const active = useRef(null);
  const begin = useCallback(href => {
    const id = ++sequence.current;
    setSlow(false);
    active.current = href === window.location.href ? null : { id, href, from: window.location.href };
    setNavigation(active.current);
    return id;
  }, []);
  const finish = useCallback(id => {
    if (active.current?.id !== id) return;
    active.current = null;
    setNavigation(current => current?.id === id ? null : current);
  }, []);
  const isNavigating = useCallback(() => active.current !== null, []);
  const value = useMemo(() => ({ begin, finish, isNavigating }), [begin, finish, isNavigating]);
  const state = useMemo(() => navigation ? { ...navigation, slow } : null, [navigation, slow]);
  useEffect(() => {
    if (!navigation) return;
    const check = () => { if (window.location.href !== navigation.from) finish(navigation.id); };
    const timer = setInterval(check, 150);
    const warning = setTimeout(() => setSlow(true), 8000);
    window.addEventListener("popstate", check);
    return () => { clearInterval(timer); clearTimeout(warning); window.removeEventListener("popstate", check); };
  }, [navigation, finish]);
  return <NavigationContext.Provider value={value}><NavigationStateContext.Provider value={state}>
    {children}
  </NavigationStateContext.Provider></NavigationContext.Provider>;
}
