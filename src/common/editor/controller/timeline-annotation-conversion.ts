/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimelineAnnotationConversionCoordinates } from '../commands/protocol.ts';
import type {
	RuntimeTimelineAnnotationProject,
	RuntimeTimelineAnnotationProjection,
} from '../runtime-timeline-annotation-projection.ts';
import type { TimelineAnnotationV11 } from '../timeline-annotation.ts';
import { sampleFrameToBeat } from '../timeline-tempo-inverse.ts';

export interface TimelineAnnotationConversionRequest {
	readonly kind: TimelineAnnotationV11['kind'];
	readonly anchor: TimelineAnnotationV11['anchor'];
	/** Required when a zero-duration marker becomes a positive-duration region. */
	readonly regionEndFrame?: number;
}

/** Convert authoritative coordinates while retaining the existing resolved geometry. */
export function resolveTimelineAnnotationConversionCoordinates(
	project: RuntimeTimelineAnnotationProject,
	annotation: TimelineAnnotationV11,
	projected: RuntimeTimelineAnnotationProjection,
	request: TimelineAnnotationConversionRequest,
): TimelineAnnotationConversionCoordinates {
	if (request.kind !== 'marker' && request.kind !== 'region') {
		throw new RangeError('Annotation conversion kind must be marker or region.');
	}
	if (request.anchor !== 'sample' && request.anchor !== 'musical') {
		throw new RangeError('Annotation conversion anchor must be sample or musical.');
	}
	if (annotation.kind === 'region' && request.regionEndFrame !== undefined) {
		throw new TypeError('regionEndFrame applies only when converting a marker to a region.');
	}
	if (request.kind === 'marker') {
		if (request.regionEndFrame !== undefined) {
			throw new TypeError('regionEndFrame applies only when converting a marker to a region.');
		}
		if (request.anchor === 'sample') {
			return { kind: 'marker', anchor: 'sample', positionFrame: projected.timelineStartFrame };
		}
		return {
			kind: 'marker',
			anchor: 'musical',
			positionBeat: authoritativeStartBeat(annotation)
				?? sampleFrameToBeat(projected.timelineStartFrame, project.tempoMap, project.sampleRate),
		};
	}
	const endFrame = annotation.kind === 'region'
		? projected.timelineEndFrame
		: request.regionEndFrame === undefined
			? missingRegionEndFrame()
			: timelineFrame(request.regionEndFrame, 'Annotation conversion regionEndFrame');
	if (endFrame <= projected.timelineStartFrame) {
		throw new RangeError('Annotation conversion regionEndFrame must follow the marker position.');
	}
	if (request.anchor === 'sample') {
		return {
			kind: 'region',
			anchor: 'sample',
			startFrame: projected.timelineStartFrame,
			endFrame,
		};
	}
	return {
		kind: 'region',
		anchor: 'musical',
		startBeat: authoritativeStartBeat(annotation)
			?? sampleFrameToBeat(projected.timelineStartFrame, project.tempoMap, project.sampleRate),
		endBeat: annotation.kind === 'region' && annotation.anchor === 'musical'
			? annotation.endBeat
			: sampleFrameToBeat(endFrame, project.tempoMap, project.sampleRate),
	};
}

function authoritativeStartBeat(annotation: TimelineAnnotationV11) {
	if (annotation.anchor !== 'musical') return null;
	return annotation.kind === 'marker' ? annotation.positionBeat : annotation.startBeat;
}

function missingRegionEndFrame(): never {
	throw new TypeError('regionEndFrame is required when converting a marker to a region.');
}

function timelineFrame(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}
