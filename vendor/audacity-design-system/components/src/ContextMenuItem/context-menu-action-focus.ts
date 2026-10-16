/* SPDX-License-Identifier: AGPL-3.0-only */

import { createContext } from 'react';

/** Restore the surviving menu trigger before a keyboard action claims focus. */
export const ContextMenuActionFocus = /* @__PURE__ */ createContext<(() => void) | null>(null);
