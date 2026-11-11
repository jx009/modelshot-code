"use client";

import { createContext } from "react";

// Only unauthenticated plain text crosses the first login boundary. Assets,
// projects and signed-in drafts stay under the account-keyed page tree.
export const HomeGuestPromptContext = createContext(null);
