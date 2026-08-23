/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoCompositionApplicationMenuItems } from './video-composition-application-menu.ts';
import { createVideoKeyframeApplicationMenuItems } from './video-keyframe-application-menu.ts';
import { createVideoRetimeApplicationMenuItems } from './video-retime-application-menu.ts';
import { createFramescaperVideoProxyApplicationMenuItems } from './framescaper-video-proxy-application-menu.ts';

export interface FramescaperVideoFinishingMenuInput {
	readonly productId: string;
	readonly capabilities: Readonly<{
		readonly videoGeometry?: unknown;
		readonly videoKeyframes?: unknown;
		readonly videoRetime?: unknown;
	}>;
	readonly project: unknown;
	readonly selectedClipId: string | null;
	readonly editingBlocked: boolean;
	readonly copy: Readonly<Record<string, string>>;
	readonly actions: Readonly<{
		readonly openVideoComposition: () => unknown;
		readonly openVideoKeyframes: () => unknown;
		readonly openVideoRetime: () => unknown;
		readonly openVideoProxy: () => unknown;
	}>;
}

/** Compose the two menu-reached finishing inspectors without growing the menu owner. */
export function createFramescaperVideoFinishingMenuItems(input: FramescaperVideoFinishingMenuInput) {
	const shared = {
		productId: input.productId,
		project: input.project,
		selectedClipId: input.selectedClipId,
		editingBlocked: input.editingBlocked,
		copy: input.copy,
	};
	return Object.freeze([
		...createVideoCompositionApplicationMenuItems({
			...shared,
			capability: Boolean(input.capabilities.videoGeometry),
			open: input.actions.openVideoComposition,
		}),
		...createVideoKeyframeApplicationMenuItems({
			...shared,
			capability: Boolean(input.capabilities.videoKeyframes),
			open: input.actions.openVideoKeyframes,
		}),
		...createVideoRetimeApplicationMenuItems({
			...shared,
			capability: Boolean(input.capabilities.videoRetime),
			open: input.actions.openVideoRetime,
		}),
		...createFramescaperVideoProxyApplicationMenuItems({
			productId: input.productId,
			project: input.project,
			copy: input.copy,
			open: input.actions.openVideoProxy,
		}),
	]);
}
