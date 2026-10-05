/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductVideoTimelineFilmstripFrameRequest } from '../workspace/product-video-visual-preview-runtime.ts';

/** A source-frame grid can map between samples; exact rendering owns integer timeline samples. */
export function createVideoFilmstripFrameRequests(
	clip: Readonly<{ id: string; sourceId: string; timelineStartFrame: number; durationFrames: number }>,
	models: readonly Readonly<{
		key: string;
		sourceUrl: string | null;
		point: Readonly<{ timelineFrame: number }>;
	}>[],
): readonly ProductVideoTimelineFilmstripFrameRequest[] {
	const first = clip.timelineStartFrame;
	const last = first + clip.durationFrames - 1;
	if (!Number.isSafeInteger(first) || first < 0 || !Number.isSafeInteger(clip.durationFrames)
		|| clip.durationFrames < 1 || !Number.isSafeInteger(last)) {
		throw new RangeError('Filmstrip clip samples must form a bounded non-empty interval.');
	}
	return models.flatMap((model) => {
		if (!model.sourceUrl) return [];
		if (!Number.isFinite(model.point.timelineFrame)) {
			throw new RangeError('Filmstrip timeline coordinates must be finite.');
		}
		return [{
			key: model.key,
			clipId: clip.id,
			sourceId: clip.sourceId,
			sourceUrl: model.sourceUrl,
			timelineSample: Math.max(first, Math.min(last, Math.round(model.point.timelineFrame))),
		}];
	});
}
