"use client";

import { createContext, useContext } from "react";

export const LOCAL_NAVIGATION_EVENT = "modelshot:creative-page";
export const LocalNavigationContext = createContext(null);
export const PageVisibilityContext = createContext(true);
export const useLocalNavigation = () => useContext(LocalNavigationContext);
export const usePageVisible = () => useContext(PageVisibilityContext);
