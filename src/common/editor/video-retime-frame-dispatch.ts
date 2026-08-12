/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoRetimeFrameBinding,
	type VideoRetimeFrameDescriptor,
	type VideoRetimeTerminalBoundary,
} from './video-retime-frame-binding.ts';
import type { BoundVideoSourceTimingView } from './video-source-timing-view.ts';

export type {
	VideoRetimeFrameDescriptor,
	VideoRetimeTerminalBoundary,
} from './video-retime-frame-binding.ts';

export interface VideoRetimeFrameDispatcher {
	readonly outerFrameCount: number;
	readonly terminal: VideoRetimeTerminalBoundary;
	readonly dispatchOuterCell: (outerCell: number) => VideoRetimeFrameDescriptor;
}

/** Bind one persisted retimed clip to one authenticated source timing snapshot. */
export function createVideoRetimeFrameDispatcher(
	clipValue: unknown,
	timing: BoundVideoSourceTimingView,
): VideoRetimeFrameDispatcher {
	const binding = createVideoRetimeFrameBinding(clipValue, timing);
	return Object.freeze({
		outerFrameCount: binding.clip.outerFrameCount,
		terminal: binding.terminal,
		dispatchOuterCell: binding.ownedFrameAt,
	});
}
