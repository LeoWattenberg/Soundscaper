/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoPreviewResolution, type VideoPreviewResolution } from '../video-preview-preferences.ts';

interface VideoPreviewResolutionCopy {
	readonly videoPreviewResolution: string;
	readonly videoPreviewResolutionFull: string;
	readonly videoPreviewResolutionHalf: string;
	readonly videoPreviewResolutionQuarter: string;
}

/** Preview quality is an explicit View-menu choice; exported pixels stay exact. */
export function createVideoPreviewResolutionMenu(
	copy: VideoPreviewResolutionCopy,
	value: unknown,
	select: (resolution: VideoPreviewResolution) => unknown,
) {
	const selected = normalizeVideoPreviewResolution(value);
	const choices = [
		['full', copy.videoPreviewResolutionFull],
		['half', copy.videoPreviewResolutionHalf],
		['quarter', copy.videoPreviewResolutionQuarter],
	] as const;
	return {
		id: 'video-preview-resolution',
		label: copy.videoPreviewResolution,
		items: choices.map(([resolution, label]) => ({
			id: `video-preview-resolution-${resolution}`,
			label,
			checked: selected === resolution,
			onClick: () => select(resolution),
		})),
	};
}
