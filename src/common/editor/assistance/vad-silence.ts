/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reviewable silence proposals measured from authenticated VAD segments. */

import type { DisfluencyProposal } from './disfluency.ts';

const MAXIMUM_SEGMENTS = 100_000;

export interface VoiceActivityFrameSegment {
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface VoiceActivityFrameTimeline {
	readonly sampleRate: number;
	readonly selectionStartFrame: number;
	readonly selectionEndFrame: number;
	readonly segments: readonly VoiceActivityFrameSegment[];
}

export interface VoiceActivitySilenceOptions {
	/** Minimum silence after speech-side padding; defaults to one frame. */
	readonly minimumFrames?: number;
	/** Frames retained next to each detected speech boundary. */
	readonly paddingFrames?: number;
}

export function voiceActivitySilenceProposals(
	timeline: VoiceActivityFrameTimeline,
	options: VoiceActivitySilenceOptions = {},
): readonly DisfluencyProposal[] {
	const { start, end, segments } = normalizeTimeline(timeline);
	const minimum = nonNegativeInteger(options.minimumFrames ?? 1, 'minimum silence');
	const padding = nonNegativeInteger(options.paddingFrames ?? 0, 'silence padding');
	if (minimum < 1) throw new RangeError('The minimum silence must cover at least one frame.');
	const gaps: Array<Readonly<{ startFrame: number; endFrame: number }>> = [];
	if (segments.length === 0) {
		gaps.push(Object.freeze({ startFrame: start, endFrame: end }));
	} else {
		const first = segments[0]!;
		gaps.push(Object.freeze({ startFrame: start, endFrame: paddedBefore(first.startFrame, padding, start) }));
		for (let index = 1; index < segments.length; index += 1) {
			const prior = segments[index - 1]!;
			const next = segments[index]!;
			gaps.push(Object.freeze({
				startFrame: paddedAfter(prior.endFrame, padding, end),
				endFrame: paddedBefore(next.startFrame, padding, start),
			}));
		}
		const last = segments.at(-1)!;
		gaps.push(Object.freeze({ startFrame: paddedAfter(last.endFrame, padding, end), endFrame: end }));
	}
	return Object.freeze(gaps.filter(({ startFrame, endFrame }) => endFrame - startFrame >= minimum)
		.map(({ startFrame, endFrame }) => Object.freeze({
			id: `vad-silence-${String(startFrame)}-${String(endFrame)}`,
			kind: 'silence' as const,
			startFrame,
			endFrame,
			text: '',
		})));
}

function paddedAfter(frame: number, padding: number, bound: number): number {
	return padding >= bound - frame ? bound : frame + padding;
}

function paddedBefore(frame: number, padding: number, bound: number): number {
	return padding >= frame - bound ? bound : frame - padding;
}

function normalizeTimeline(timeline: VoiceActivityFrameTimeline): Readonly<{
	start: number;
	end: number;
	segments: readonly VoiceActivityFrameSegment[];
}> {
	if (!timeline || !Number.isSafeInteger(timeline.sampleRate) || timeline.sampleRate < 1) {
		throw new RangeError('A VAD timeline needs a positive integer sample rate.');
	}
	const start = nonNegativeInteger(timeline.selectionStartFrame, 'selection start');
	const end = nonNegativeInteger(timeline.selectionEndFrame, 'selection end');
	if (end <= start) throw new RangeError('A VAD selection must have a positive duration.');
	if (!Array.isArray(timeline.segments) || timeline.segments.length > MAXIMUM_SEGMENTS) {
		throw new RangeError('A VAD timeline exceeds its segment bound.');
	}
	let priorEnd = start;
	const segments = timeline.segments.map((segment, index) => {
		const segmentStart = nonNegativeInteger(segment?.startFrame, `VAD segment ${index} start`);
		const segmentEnd = nonNegativeInteger(segment?.endFrame, `VAD segment ${index} end`);
		if (segmentEnd <= segmentStart) {
			throw new RangeError(`VAD segment ${index} must have a positive duration.`);
		}
		if (segmentStart < start || segmentEnd > end) {
			throw new RangeError(`VAD segment ${index} exceeds its exact selection.`);
		}
		if (segmentStart < priorEnd) {
			throw new RangeError('VAD segments must be ordered and disjoint.');
		}
		priorEnd = segmentEnd;
		return Object.freeze({ startFrame: segmentStart, endFrame: segmentEnd });
	});
	return Object.freeze({ start, end, segments: Object.freeze(segments) });
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The ${label} must be a non-negative safe integer.`);
	}
	return Number(value);
}
