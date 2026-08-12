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
	type RuntimePersistedClip,
} from './runtime-clip-projection.ts';
import { sampleFrameToBeat } from './timeline-tempo-inverse.ts';
import {
	compareRationals,
	subtractRationals,
	type Rational,
} from './timeline-time.ts';

export interface AudioWarpClipSegment {
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly warpMap: Readonly<AudioWarpMap>;
}

export interface AudioWarpClipSplit {
	readonly left: Readonly<AudioWarpClipSegment>;
	readonly right: Readonly<AudioWarpClipSegment>;
}

/** Derive one exact child map and integer persisted source clamp from a timeline range. */
export function trimAudioWarpClipToTimelineRange(
	project: AudioWarpAuthorityProject,
	clip: RuntimePersistedClip,
	startFrameValue: number,
	endFrameValue: number,
): Readonly<AudioWarpClipSegment> {
	const runtime = resolveRuntimeClipProjection(project, clip);
	const startFrame = safeInteger(startFrameValue, 'audio warp trim timeline start');
	const endFrame = safeInteger(endFrameValue, 'audio warp trim timeline end');
	if (startFrame < runtime.timelineStartFrame || endFrame > runtime.timelineEndFrame
		|| endFrame <= startFrame) {
		throw new RangeError('Audio warp trim range must be positive and remain within the clip extent.');
	}
	const map = normalizeAudioWarpMapForClip(project, clip, (clip as Record<string, unknown>).warpMap);
	const startOuter = outerAtTimelineFrame(project, clip, runtime, map, startFrame);
	const endOuter = outerAtTimelineFrame(project, clip, runtime, map, endFrame);
	const trimmed = trimAudioWarpMap(map, { startOuter, endOuter });
	const sourceStartFrame = wholeSourceFrame(trimmed.points[0]!.source);
	const sourceEndFrame = wholeSourceFrame(trimmed.points.at(-1)!.source);
	if (sourceEndFrame <= sourceStartFrame) {
		throw new RangeError('Audio warp trim must retain a positive source extent.');
	}
	return Object.freeze({
		sourceStartFrame,
		sourceDurationFrames: sourceEndFrame - sourceStartFrame,
		warpMap: trimmed,
	});
}

export function splitAudioWarpClipAtTimelineFrame(
	project: AudioWarpAuthorityProject,
	clip: RuntimePersistedClip,
	atFrameValue: number,
): Readonly<AudioWarpClipSplit> {
	const runtime = resolveRuntimeClipProjection(project, clip);
	const atFrame = safeInteger(atFrameValue, 'audio warp split timeline frame');
	if (atFrame <= runtime.timelineStartFrame || atFrame >= runtime.timelineEndFrame) {
		throw new RangeError('An audio warp split must be inside the clip.');
	}
	return Object.freeze({
		left: trimAudioWarpClipToTimelineRange(
			project, clip, runtime.timelineStartFrame, atFrame,
		),
		right: trimAudioWarpClipToTimelineRange(
			project, clip, atFrame, runtime.timelineEndFrame,
		),
	});
}

function outerAtTimelineFrame(
	project: AudioWarpAuthorityProject,
	clip: RuntimePersistedClip,
	runtime: ReturnType<typeof resolveRuntimeClipProjection>,
	map: Readonly<AudioWarpMap>,
	timelineFrame: number,
): Rational {
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
		sampleFrameToBeat(timelineFrame, project.tempoMap, project.sampleRate),
		normalizeAudioWarpRational(clip.musicalStartBeat, 'audio warp musical start'),
	);
	if (compareRationals(outer, 0) <= 0) {
		throw new RangeError('Audio warp musical trim must retain a positive outer position.');
	}
	return outer;
}

function wholeSourceFrame(value: Rational): number {
	if (value.num % value.den !== 0) {
		throw new RangeError('Audio warp trims and splits require a whole source-sample boundary.');
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
