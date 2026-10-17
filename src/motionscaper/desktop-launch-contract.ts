/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionOpenFileCapability } from './desktop-file-contract.ts';

/** OS-selected files only. This bridge never accepts a renderer-supplied path. */
export interface MotionDesktopLaunch {
	take(): Promise<MotionOpenFileCapability | null>;
	acknowledge(request: { readonly token: string }): Promise<void>;
	onPending(listener: () => void): () => void;
}
