/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderTimingSidecars } from '../common/editor/unified-exact-render-timing-authority.ts';
import {
	bindVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../common/editor/video-source-timing-view.ts';

/** Rebind raw project timing views as process-local sidecars for V13 consumer admission. */
export function bindFramescaperUnifiedRenderTimingSidecarsV27(
	projectValue: unknown,
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
): UnifiedExactRenderTimingSidecars {
	if (!(timingViews instanceof Map)) {
		throw new TypeError('Selected V27 exact timing views must be an authenticated Map.');
	}
	if (!projectValue || typeof projectValue !== 'object' || Array.isArray(projectValue)) {
		throw new TypeError('Selected V27 exact timing requires a project.');
	}
	const sources = (projectValue as Readonly<Record<string, unknown>>).sources;
	if (!Array.isArray(sources)) throw new TypeError('Selected V27 exact timing requires project sources.');
	const videos = sources.filter((source): source is Readonly<Record<string, unknown>> => (
		!!source && typeof source === 'object' && !Array.isArray(source)
			&& (source as Readonly<Record<string, unknown>>).kind === 'video'
	));
	if (timingViews.size !== videos.length) {
		throw new RangeError('Selected V27 exact timing must contain exactly every video source.');
	}
	return new Map(videos.map((source) => {
		const sourceId = source.id;
		if (typeof sourceId !== 'string' || !sourceId) {
			throw new TypeError('Selected V27 video source identities must be text.');
		}
		return [sourceId, bindVideoSourceTimingView(timingViews, source)] as const;
	}));
}
