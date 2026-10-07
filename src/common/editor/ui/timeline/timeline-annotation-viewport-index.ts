/* SPDX-License-Identifier: AGPL-3.0-only */

import { createTimelineViewportClipIndex } from '../../design-system-adapters/timeline-viewport-index.ts';
import type { RuntimeTimelineAnnotationProjection } from '../../runtime-timeline-annotation-projection.ts';
import { timelineAnnotationIsVisible } from './timeline-annotation-ui-model.ts';

/** The exact UI predicate follows a conservative interval query, including tiny regions and marker flags. */
export function createTimelineAnnotationViewportIndex(annotations: readonly RuntimeTimelineAnnotationProjection[]) {
	const wrappers = annotations.map((annotation, ordinal) => {
		// A point at MAX_SAFE_INTEGER needs a positive index carrier ending at
		// that frame; exact visibility still reads the original marker coordinate.
		const start = Math.min(Number.MAX_SAFE_INTEGER - 1, annotation.timelineStartFrame);
		return { id: annotation.id, sourceId: '', sourceStartFrame: 0,
			timelineStartFrame: start, durationFrames: Math.max(1, annotation.timelineEndFrame - start), annotation, ordinal };
	});
	const index = createTimelineViewportClipIndex(wrappers);
	const byId = new Map(wrappers.map(wrapper => [wrapper.id, wrapper]));
	return {
		query(pixelsPerSecond: number, sampleRate: number, scrollX: number, viewportWidth: number, retainedIds: readonly (string | null)[]) {
			const from = Math.max(0, Math.floor((scrollX - 16) / pixelsPerSecond * sampleRate));
			const to = Math.min(Number.MAX_SAFE_INTEGER, Math.max(from + 1, Math.ceil((scrollX + viewportWidth + 6) / pixelsPerSecond * sampleRate)));
			const found = new Map(index.query(from, to).filter(({ annotation }) => timelineAnnotationIsVisible(
				annotation, pixelsPerSecond, sampleRate, scrollX, viewportWidth,
			)).map(wrapper => [wrapper.id, wrapper]));
			for (const id of retainedIds) {
				const wrapper = id === null ? undefined : byId.get(id);
				if (wrapper) found.set(wrapper.id, wrapper);
			}
			return [...found.values()].sort((left, right) => left.ordinal - right.ordinal).map(({ annotation }) => annotation);
		},
	};
}
