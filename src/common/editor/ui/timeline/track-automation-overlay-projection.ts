/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	evaluateAutomationLaneAtFrameV21,
	resolveAutomationLanePointFramesV21,
	type AutomationLaneV21,
} from '../../automation-lane-v21.ts';
import type { ParameterDescriptor } from '../../parameter-address.ts';
import type { HoldTempoMap } from '../../timeline-time.ts';
import {
	automationValueToNormalizedV21,
} from '../../track-automation-targets-v21.ts';

const CLIP_CONTENT_OFFSET = 12;
const CLIP_HEADER_HEIGHT = 20;
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
	const points = options.lane ? resolveAutomationLanePointFramesV21(options.lane, {
		sampleRate,
		tempoMap: options.tempoMap,
	}) : [];
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
		const authoredFrames = points
			.filter((point) => point.frame >= startFrame && point.frame <= endFrame)
			.map(({ frame: pointFrame }) => pointFrame);
		const sampleFrames = uniqueSorted([
			startFrame,
			...rangeFrames(startFrame, endFrame, sampleStep),
			...authoredFrames,
			endFrame,
		]);
		const samples = sampleFrames.flatMap((sampleFrame) => {
			const pointIndex = points.findIndex(({ frame: pointFrame }) => pointFrame === sampleFrame);
			const heldValue = options.lane && pointIndex > 0
				&& options.lane.segments[pointIndex - 1]?.kind === 'hold'
				&& sampleFrame > startFrame
				? points[pointIndex - 1]!.value
				: null;
			return heldValue === null
				? [sample(options, sampleFrame, bodyTop, bodyHeight)]
				: [
					sample(options, sampleFrame, bodyTop, bodyHeight, heldValue),
					sample(options, sampleFrame, bodyTop, bodyHeight),
				];
		});
		const projectedPoints = points
			.filter((point) => point.frame >= startFrame && point.frame <= endFrame)
			.map((point) => Object.freeze({
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

function rangeFrames(start: number, end: number, step: number): number[] {
	const values: number[] = [];
	for (let value = start + step; value < end; value += step) values.push(value);
	return values;
}

function uniqueSorted(values: readonly number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
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
