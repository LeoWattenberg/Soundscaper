/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	compareRuntimeTimelineAnnotations,
	type RuntimeTimelineAnnotationProjection,
} from './runtime-timeline-annotation-projection.ts';

export type TimelineAnnotationNavigationDirection = 'previous' | 'next';

export interface TimelineAnnotationNavigationOptions {
	readonly sequenceId: string;
	readonly direction: TimelineAnnotationNavigationDirection;
	readonly selectedAnnotationId?: string | null;
	readonly playheadFrame?: number;
}

export type TimelineAnnotationAdjacentOptions = Omit<TimelineAnnotationNavigationOptions, 'direction'>;

/** Navigate within one sequence without wrapping at either endpoint. */
export function navigateTimelineAnnotation(
	annotations: readonly RuntimeTimelineAnnotationProjection[],
	options: TimelineAnnotationNavigationOptions,
): RuntimeTimelineAnnotationProjection | null {
	if (!Array.isArray(annotations)) throw new TypeError('Projected timeline annotations must be an array.');
	if (!options || typeof options !== 'object') throw new TypeError('Timeline annotation navigation options are required.');
	const sequenceId = stableId(options.sequenceId, 'navigation sequenceId');
	if (options.direction !== 'previous' && options.direction !== 'next') {
		throw new RangeError('Timeline annotation navigation direction must be previous or next.');
	}
	const candidates = annotations
		.filter((annotation) => annotation.sequenceId === sequenceId)
		.slice()
		.sort(compareRuntimeTimelineAnnotations);
	if (options.selectedAnnotationId != null) {
		const selectedId = stableId(options.selectedAnnotationId, 'selected annotation ID');
		const selectedIndex = candidates.findIndex(({ id }) => id === selectedId);
		if (selectedIndex < 0) {
			throw new ReferenceError(`The selected annotation ${selectedId} does not belong to sequence ${sequenceId}.`);
		}
		const targetIndex = selectedIndex + (options.direction === 'previous' ? -1 : 1);
		return candidates[targetIndex] ?? null;
	}
	const playheadFrame = nonNegativeSafeInteger(options.playheadFrame, 'navigation playheadFrame');
	if (options.direction === 'next') {
		return candidates.find(({ timelineStartFrame }) => timelineStartFrame >= playheadFrame) ?? null;
	}
	for (let index = candidates.length - 1; index >= 0; index -= 1) {
		if (candidates[index].timelineStartFrame <= playheadFrame) return candidates[index];
	}
	return null;
}

export function previousTimelineAnnotation(
	annotations: readonly RuntimeTimelineAnnotationProjection[],
	options: TimelineAnnotationAdjacentOptions,
): RuntimeTimelineAnnotationProjection | null {
	return navigateTimelineAnnotation(annotations, { ...options, direction: 'previous' });
}

export function nextTimelineAnnotation(
	annotations: readonly RuntimeTimelineAnnotationProjection[],
	options: TimelineAnnotationAdjacentOptions,
): RuntimeTimelineAnnotationProjection | null {
	return navigateTimelineAnnotation(annotations, { ...options, direction: 'next' });
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}
