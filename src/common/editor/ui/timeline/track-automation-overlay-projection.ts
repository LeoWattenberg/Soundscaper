/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	evaluateAutomationLaneAtFrameV21,
	type AutomationLaneV21,
} from '../../automation-lane-v21.ts';
import type { ParameterDescriptor } from '../../parameter-address.ts';
import type { HoldTempoMap } from '../../timeline-time.ts';
import {
	automationValueToNormalizedV21,
} from '../../track-automation-targets-v21.ts';
import { automationSampleFrames } from './automation-sample-frames.ts';
import { automationFrameIndex } from './automation-frame-index.ts';
import { CLIP_HEADER_HEIGHT } from './geometry.ts';

const CLIP_CONTENT_OFFSET = 12;
const SAMPLE_SPACING_PIXELS = 2;

export interface TrackAutomationOverlayClipV21 {
	readonly id: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}

export interface TrackAutomationOverlaySampleV21 {
	readonly frame: number;
	readonly x: number;
	readonly y: number;
	readonly value: number;
}

export interface TrackAutomationOverlayPointV21 extends TrackAutomationOverlaySampleV21 {
	readonly id: string;
}

export interface TrackAutomationOverlaySpanV21 {
	readonly clipId: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly samples: readonly TrackAutomationOverlaySampleV21[];
	readonly points: readonly TrackAutomationOverlayPointV21[];
}

export interface TrackAutomationOverlayProjectionV21 {
	readonly spans: readonly TrackAutomationOverlaySpanV21[];
	readonly bodyTop: number;
	readonly bodyHeight: number;
}

export interface ProjectTrackAutomationOverlayOptionsV21 {
	readonly descriptor: ParameterDescriptor;
	readonly lane: AutomationLaneV21 | null;
	readonly currentValue: number;
	readonly clips: readonly TrackAutomationOverlayClipV21[];
	readonly viewportStartFrame: number;
	readonly viewportEndFrame: number;
	readonly projectionStartFrame?: number;
	readonly projectionEndFrame?: number;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly width: number;
	readonly height: number;
	readonly tempoMap?: HoldTempoMap;
}

/** Project the selected parameter with the same clip-local visual footprint as clip gain. */
export function projectTrackAutomationOverlayV21(
	options: ProjectTrackAutomationOverlayOptionsV21,
): TrackAutomationOverlayProjectionV21 {
	const sampleRate = positive(options.sampleRate, 'sampleRate');
	const pixelsPerSecond = positive(options.pixelsPerSecond, 'pixelsPerSecond');
	const viewportStartFrame = frame(options.viewportStartFrame, 'viewportStartFrame');
	const viewportEndFrame = frame(options.viewportEndFrame, 'viewportEndFrame');
	if (viewportEndFrame <= viewportStartFrame) {
		throw new RangeError('The automation overlay viewport must have positive duration.');
	}
	const projectionStartFrame = frame(
		options.projectionStartFrame ?? viewportStartFrame, 'projectionStartFrame',
	);
	const projectionEndFrame = frame(
		options.projectionEndFrame ?? viewportEndFrame, 'projectionEndFrame',
	);
	if (projectionEndFrame <= projectionStartFrame) {
		throw new RangeError('The automation overlay projection must have positive duration.');
	}
	const bodyTop = Math.min(CLIP_HEADER_HEIGHT, Math.max(0, options.height));
	const bodyHeight = Math.max(1, options.height - bodyTop);
	const pointIndex = options.lane ? automationFrameIndex(options.lane, sampleRate, options.tempoMap) : null;
	const points = pointIndex?.points ?? [];
	const samplesPerPixel = sampleRate / pixelsPerSecond;
	const sampleStep = Math.max(1, Math.floor(samplesPerPixel * SAMPLE_SPACING_PIXELS));
	const spans: TrackAutomationOverlaySpanV21[] = [];
	for (const clip of options.clips) {
		const clipStart = frame(clip.timelineStartFrame, 'clip.timelineStartFrame');
		const duration = positiveInteger(clip.durationFrames, 'clip.durationFrames');
		const clipEnd = clipStart + duration;
		const startFrame = Math.max(clipStart, projectionStartFrame);
		const endFrame = Math.min(clipEnd, projectionEndFrame);
		if (endFrame <= startFrame) continue;
		const authoredPoints = pointIndex?.between(startFrame, endFrame) ?? [];
		const authoredFrames = authoredPoints.map(({ frame: pointFrame }) => pointFrame);
		const sampleFrames = automationSampleFrames({
			lane: options.lane, descriptor: options.descriptor, start: startFrame, end: endFrame, step: sampleStep,
			authoredFrames, pixelsPerFrame: pixelsPerSecond / sampleRate,
			yAtFrame: value => sample(options, value, bodyTop, bodyHeight).y,
		});
		const samples = sampleFrames.flatMap((sampleFrame) => {
			const authoredIndex = pointIndex?.indexByFrame.get(sampleFrame) ?? -1;
			const heldValue = options.lane && authoredIndex > 0
				&& options.lane.segments[authoredIndex - 1]?.kind === 'hold'
				&& sampleFrame > startFrame
				? points[authoredIndex - 1]!.value
				: null;
			return heldValue === null
				? [sample(options, sampleFrame, bodyTop, bodyHeight)]
				: [
					sample(options, sampleFrame, bodyTop, bodyHeight, heldValue),
					sample(options, sampleFrame, bodyTop, bodyHeight),
				];
		});
		const projectedPoints = authoredPoints.map((point) => Object.freeze({
				id: point.id,
				...sample(options, point.frame, bodyTop, bodyHeight),
			}));
		spans.push(Object.freeze({
			clipId: clip.id,
			startFrame,
			endFrame,
			samples: Object.freeze(samples),
			points: Object.freeze(projectedPoints),
		}));
	}
	return Object.freeze({ spans: Object.freeze(spans), bodyTop, bodyHeight });
}

function sample(
	options: ProjectTrackAutomationOverlayOptionsV21,
	frameValue: number,
	bodyTop: number,
	bodyHeight: number,
	overrideValue?: number,
): TrackAutomationOverlaySampleV21 {
	const value = overrideValue ?? (options.lane
		? evaluateAutomationLaneAtFrameV21(options.lane, frameValue, {
			sampleRate: options.sampleRate,
			tempoMap: options.tempoMap,
		})
		: options.currentValue);
	const normalized = automationValueToNormalizedV21(options.descriptor, value);
	return Object.freeze({
		frame: frameValue,
		x: canonical(CLIP_CONTENT_OFFSET
			+ (frameValue - (options.projectionStartFrame ?? options.viewportStartFrame))
				/ options.sampleRate * options.pixelsPerSecond),
		y: canonical(bodyTop + (1 - normalized) * bodyHeight),
		value,
	});
}

function canonical(value: number): number {
	return Number.parseFloat(value.toPrecision(12));
}

function frame(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positive(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new RangeError(`${name} must be positive.`);
	}
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}
