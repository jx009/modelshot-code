# Creation workspace: whole-page layout and progress

## Reference and scope

The supplied Cheos screenshot is a reference for the complete workspace: compact title/account bar, conversation with readable text and file cards, resizable conversation column, file tree, bottom composer, and continuous slide browsing with explicit edit/presentation modes. This work does not claim knowledge of Cheos private implementation or verified pixel-for-pixel parity.

## Changes

- Conversation messages render safe text with headings, emphasis and lists. Actual artifact references become named file cards. Slide publication messages identify the saved page; final completion describes the real deck and approved visual direction.
- A persistent status strip above the composer distinguishes queueing, running, partial failure, stopped, paused and completed. Task details expose failed steps, the error code, completed steps and manual retry. Retry does not automatically issue additional paid generation requests.
- The left column starts at a responsive 29% width, supports resizing and keeps an explicit user preference. The title uses the project name. All chrome uses existing theme colors.
- The file tree stays open on desktop and uses an overlay on mobile. It lists actual project artifacts and the selected HTML artifact's real image references and persisted DESIGN.md. Resources can be previewed/downloaded. No fictitious assets or unsupported sharing controls are introduced.
- The rounded composer has direct image attachment access, a document control, a compact settings control and the existing credit estimate/send action. Selected images remain visible and removable.
- HTML PPT opens in a continuous slide viewer. Editing tools load when entering edit mode; presentation remains the existing actual presentation implementation. The visible page is preserved between modes.
- Continuous viewer and page navigators support native drag/drop, pointer handles and Alt+Up/Down. Reordering uses existing journal operations and respects read-only state. Editing and live updates retain the conflict/recovery guards.

## Loading and live updates

- Cloud reads overlap local draft reads. A remembered draft branch skips discovery of unrelated branches but still loads its own operation/text journals.
- Only nearby slide frames mount. Images share a per-viewer, bounded cache and a two-request queue, with independent subscription cancellation. Automatic page heights retain their measured geometry when offscreen.
- Unchanged page/theme identities survive cloud refresh, avoiding repeated projection and image reloads for unaffected pages.
- SSE notifications update published revisions in place. A 20-second active-task reconciliation handles silent proxy connections; a notification received during an in-flight status request triggers an immediate follow-up. Terminal/hidden states stop regular polling.
- File metadata refresh preserves pagination/search state. Reopening the current deck does not remount its editor.

## Verification limits

Targeted ESLint passed for the changed workspace components, supporting helpers and related regression files. Both new CSS files parsed successfully, and the scoped Git whitespace check passed.

Regression cases were added for reordering, progressive mounting, preview resource caching/cancellation, draft branch fast path, file-list refresh, live task polling, blank slide projection and truthful status/messages. They have not been executed in this turn. Per repository AGENTS.md, only targeted static checks are permitted without explicit permission: no build, test suite, dependency install or development server was run. Browser visual verification, deployed behavior and measured latency remain unverified. No commit or push was performed.
