/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	trimAudioWarpMap,
	type AudioWarpMap,
} from './audio-warp-domain.ts';
import {
	normalizeAudioWarpMapForClip,
	type AudioWarpAuthorityProject,
} from './audio-warp-clip-authority.ts';
import { normalizeAudioWarpRational } from './audio-groove-template.ts';
import {
	resolveRuntimeClipProjection,
	type RuntimeClipProjection,
	type RuntimePersistedClip,
} from './runtime-clip-projection.ts';
import { sampleFrameToBeat } from './timeline-tempo-inverse.ts';
import {
	compareRationals,
	evaluateBreakpointMap,
	subtractRationals,
	type BreakpointMap,
	type Rational,
} from './timeline-time.ts';

// A whole-source-sample boundary recurs at the period of the local map rate, so
// a candidate further out than this is never the frame the editor asked for.
const MAXIMUM_EDIT_FRAME_SEARCH = 1_024;

export interface AudioWarpClipSegment {
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly warpMap: Readonly<AudioWarpMap>;
}

interface AudioWarpEditContext {
	readonly project: AudioWarpAuthorityProject;
	readonly clip: RuntimePersistedClip;
	readonly runtime: RuntimeClipProjection;
	readonly map: Readonly<AudioWarpMap>;
}

/** Derive one exact child map and integer persisted source clamp from a timeline range. */
export function trimAudioWarpClipToTimelineRange(
	project: AudioWarpAuthorityProject,
	clip: RuntimePersistedClip,
	startFrameValue: number,
	endFrameValue: number,
): Readonly<AudioWarpClipSegment> {
	const context = audioWarpEditContext(project, clip);
	const startFrame = safeInteger(startFrameValue, 'audio warp trim timeline start');
	const endFrame = safeInteger(endFrameValue, 'audio warp trim timeline end');
	if (startFrame < context.runtime.timelineStartFrame || endFrame > context.runtime.timelineEndFrame
		|| endFrame <= startFrame) {
		throw new RangeError('Audio warp trim range must be positive and remain within the clip extent.');
	}
	const startOuter = outerAtTimelineFrame(context, startFrame);
	const endOuter = outerAtTimelineFrame(context, endFrame);
	// The whole-source-sample rule is what keeps a trimmed map's own boundary
	// anchors inside the stored rational domain, so it has to be admitted before
	// the map is built. Interpolating inside a span puts that span in the
	// denominator, and a long one overflows the domain: building the map first
	// reported a bare rational-domain error in place of the boundary the user can
	// actually cut on.
	const sourceStartFrame = wholeSourceFrame(
		context, evaluateBreakpointMap(context.map as BreakpointMap, startOuter), startFrame,
	);
	const sourceEndFrame = wholeSourceFrame(
		context, evaluateBreakpointMap(context.map as BreakpointMap, endOuter), endFrame,
	);
	if (sourceEndFrame <= sourceStartFrame) {
		throw new RangeError('Audio warp trim must retain a positive source extent.');
	}
	const trimmed = trimAudioWarpMap(context.map, { startOuter, endOuter });
	return Object.freeze({
		sourceStartFrame,
		sourceDurationFrames: sourceEndFrame - sourceStartFrame,
		warpMap: trimmed,
	});
}

/**
 * Resolve the timeline frame nearest a requested boundary that a warp edit can
 * actually cut on, so an interactive edge or playhead lands on exact material
 * instead of being refused. Clips without a map keep the requested frame; null
 * means the clip carries no reachable whole-source-sample boundary.
 */
export function resolveAudioWarpEditFrame(
	project: AudioWarpAuthorityProject,
	clip: RuntimePersistedClip,
	requestedFrameValue: number,
): number | null {
	const requestedFrame = safeInteger(requestedFrameValue, 'audio warp edit frame');
	if (clip.kind !== 'audio' || (clip as Record<string, unknown>).warpMap == null) return requestedFrame;
	return nearestWholeSourceFrame(audioWarpEditContext(project, clip), requestedFrame);
}

function audioWarpEditContext(
	project: AudioWarpAuthorityProject,
	clip: RuntimePersistedClip,
): AudioWarpEditContext {
	return Object.freeze({
		project,
		clip,
		runtime: resolveRuntimeClipProjection(project, clip),
		map: normalizeAudioWarpMapForClip(project, clip, (clip as Record<string, unknown>).warpMap),
	});
}

function nearestWholeSourceFrame(context: AudioWarpEditContext, requestedFrame: number): number | null {
	for (let offset = 0; offset <= MAXIMUM_EDIT_FRAME_SEARCH; offset += 1) {
		const candidates = offset === 0 ? [requestedFrame] : [requestedFrame - offset, requestedFrame + offset];
		for (const frame of candidates) {
			if (frame < context.runtime.timelineStartFrame || frame > context.runtime.timelineEndFrame) continue;
			const source = evaluateBreakpointMap(context.map as BreakpointMap, outerAtTimelineFrame(context, frame));
			if (source.num % source.den === 0) return frame;
		}
	}
	return null;
}

function outerAtTimelineFrame(context: AudioWarpEditContext, timelineFrame: number): Rational {
	const { clip, map, runtime } = context;
	if (timelineFrame === runtime.timelineStartFrame) return map.points[0]!.outer;
	if (timelineFrame === runtime.timelineEndFrame) return map.points.at(-1)!.outer;
	if (clip.anchor !== 'musical') {
		return normalizeAudioWarpRational(
			timelineFrame - runtime.timelineStartFrame,
			'audio warp sample outer position',
		);
	}
	if (clip.musicalExtent !== 'beat') {
		throw new RangeError('Musical audio warp maps require a beat extent.');
	}
	const outer = subtractRationals(
		sampleFrameToBeat(timelineFrame, context.project.tempoMap, context.project.sampleRate),
		normalizeAudioWarpRational(clip.musicalStartBeat, 'audio warp musical start'),
	);
	if (compareRationals(outer, 0) <= 0) {
		throw new RangeError('Audio warp musical trim must retain a positive outer position.');
	}
	return outer;
}

function wholeSourceFrame(context: AudioWarpEditContext, value: Rational, timelineFrame: number): number {
	if (value.num % value.den !== 0) {
		const nearest = nearestWholeSourceFrame(context, timelineFrame);
		throw new RangeError([
			'Audio warp trims and splits require a whole source-sample boundary:',
			` timeline frame ${String(timelineFrame)} resolves inside a source sample`,
			nearest === null ? '.' : `; the nearest editable frame is ${String(nearest)}.`,
		].join(''));
	}
	const frame = value.num / value.den;
	if (!Number.isSafeInteger(frame) || frame < 0) {
		throw new RangeError('Audio warp source boundary must be a non-negative safe integer.');
	}
	return frame;
}

function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return Number(value);
}
