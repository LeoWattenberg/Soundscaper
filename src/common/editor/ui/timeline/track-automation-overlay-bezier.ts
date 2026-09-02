/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveAutomationLanePointFramesV21,
	type AutomationLaneV21,
} from '../../automation-lane-v21.ts';
import { createIndexedBeatFrameProjector } from '../../indexed-tempo-projector.ts';
import type { InterpolationShape } from '../../interpolation-curve.ts';
import type { ParameterDescriptor } from '../../parameter-address.ts';
import type { HoldTempoMap } from '../../timeline-time.ts';
import { automationValueToNormalizedV21 } from '../../track-automation-targets-v21.ts';

export type TrackAutomationSegmentKind = InterpolationShape['kind'];

export interface ProjectedTrackAutomationBezierHandle {
	readonly key: string;
	readonly segmentIndex: number;
	readonly control: 'control1' | 'control2';
	readonly frame: number;
	readonly value: number;
	readonly x: number;
	readonly y: number;
	readonly anchorX: number;
	readonly anchorY: number;
	readonly segmentStartFrame: number;
	readonly segmentEndFrame: number;
}

export function trackAutomationPathData(
	samples: readonly Readonly<{ x: number; y: number }>[],
): string {
	return samples.map(({ x, y }, index) => (
		`${index ? 'L' : 'M'} ${String(x)} ${String(y)}`
	)).join(' ');
}

export function trackAutomationSegmentKindKey(key: string): TrackAutomationSegmentKind | null {
	if (key.toLowerCase() === 'h') return 'hold';
	if (key.toLowerCase() === 'l') return 'linear';
	if (key.toLowerCase() === 'e') return 'eased';
	if (key.toLowerCase() === 'b') return 'bezier';
	return null;
}

export function trackAutomationSegmentKinds(
	descriptor: ParameterDescriptor,
): readonly TrackAutomationSegmentKind[] {
	return descriptor.taper === 'discrete'
		? ['hold']
		: ['linear', 'eased', 'bezier', 'hold'];
}

export function trackAutomationSegmentKindLabel(
	kind: TrackAutomationSegmentKind,
	copy?: Readonly<Record<string, string | undefined>>,
): string {
	const key = `automationSegment${kind[0]!.toUpperCase()}${kind.slice(1)}`;
	if (copy?.[key]) return copy[key];
	if (kind === 'bezier') return 'Bézier';
	return `${kind[0]!.toUpperCase()}${kind.slice(1)}`;
}

export function selectedTrackAutomationSegmentKind(
	lane: AutomationLaneV21 | null,
	segmentIndex: number | null,
): TrackAutomationSegmentKind | null {
	return segmentIndex === null ? null : lane?.segments[segmentIndex]?.kind ?? null;
}

export function projectTrackAutomationBezierHandlesV21(options: Readonly<{
	lane: AutomationLaneV21 | null;
	descriptor: ParameterDescriptor;
	spans: readonly Readonly<{ startFrame: number; endFrame: number }>[];
	coordinateStartFrame: number;
	pixelsPerSecond: number;
	sampleRate: number;
	bodyTop: number;
	bodyHeight: number;
	tempoMap?: HoldTempoMap;
}>): readonly ProjectedTrackAutomationBezierHandle[] {
	if (!options.lane) return [];
	const points = resolveAutomationLanePointFramesV21(options.lane, {
		sampleRate: options.sampleRate,
		tempoMap: options.tempoMap,
	});
	const projectBeat = options.lane.timebase === 'musical-beats'
		? createIndexedBeatFrameProjector(requiredTempoMap(options.tempoMap), options.sampleRate)
		: null;
	const result: ProjectedTrackAutomationBezierHandle[] = [];
	for (const [segmentIndex, segment] of options.lane.segments.entries()) {
		if (segment.kind !== 'bezier') continue;
		const segmentStartFrame = points[segmentIndex]!.frame;
		const segmentEndFrame = points[segmentIndex + 1]!.frame;
		for (const control of ['control1', 'control2'] as const) {
			const authored = segment[control];
			const frame = projectBeat
				? Number(projectBeat(authored.position))
				: Math.round(authored.position.num / authored.position.den);
			if (!options.spans.some((span) => frame >= span.startFrame && frame <= span.endFrame)) continue;
			const anchor = control === 'control1' ? points[segmentIndex]! : points[segmentIndex + 1]!;
			result.push(Object.freeze({
				key: `${String(segmentIndex)}:${control}`,
				segmentIndex,
				control,
				frame,
				value: authored.value,
				x: overlayX(frame, options),
				y: overlayY(authored.value, options),
				anchorX: overlayX(anchor.frame, options),
				anchorY: overlayY(anchor.value, options),
				segmentStartFrame,
				segmentEndFrame,
			}));
		}
	}
	return Object.freeze(result);
}

function overlayX(
	frame: number,
	options: Readonly<{ coordinateStartFrame: number; pixelsPerSecond: number; sampleRate: number }>,
): number {
	return Number.parseFloat((12 + (frame - options.coordinateStartFrame)
		/ options.sampleRate * options.pixelsPerSecond).toPrecision(12));
}

function overlayY(
	value: number,
	options: Readonly<{ descriptor: ParameterDescriptor; bodyTop: number; bodyHeight: number }>,
): number {
	return Number.parseFloat((options.bodyTop + (1 - automationValueToNormalizedV21(
		options.descriptor, value,
	)) * options.bodyHeight).toPrecision(12));
}

function requiredTempoMap(value: HoldTempoMap | undefined): HoldTempoMap {
	if (!value) throw new TypeError('A musical automation edit requires the tempo map.');
	return value;
}
