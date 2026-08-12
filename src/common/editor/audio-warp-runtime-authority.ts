/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAudioWarpMap,
	type AudioWarpMap,
} from './audio-warp-domain.ts';
import { sampleFrameToBeat } from './timeline-tempo-inverse.ts';
import {
	compareRationals,
	subtractRationals,
	type HoldTempoMap,
	type Rational,
	type RationalInput,
} from './timeline-time.ts';

export interface AudioWarpAuthorityRuntimeProject {
	readonly sampleRate: number;
	readonly tempoMap: HoldTempoMap;
}

export interface AudioWarpAuthorityRuntimeClip {
	readonly kind?: unknown;
	readonly anchor?: unknown;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly musicalStartBeat?: RationalInput | null;
	readonly musicalExtent?: unknown;
	readonly musicalDurationBeats?: RationalInput | null;
	readonly reversed?: boolean;
	readonly warpMap?: unknown;
}

/**
 * Normalize the exact clip/map authority shared by persistence validation and
 * the realtime/offline runtime without pulling cache-fingerprint dependencies
 * into the desktop project-library validator.
 */
export function normalizeAudioWarpRuntimeInputs(
	projectValue: AudioWarpAuthorityRuntimeProject,
	clipValue: AudioWarpAuthorityRuntimeClip,
): Readonly<{
	project: AudioWarpAuthorityRuntimeProject;
	clip: AudioWarpAuthorityRuntimeClip;
	map: Readonly<AudioWarpMap>;
}> {
	if (!projectValue || typeof projectValue !== 'object') {
		throw new TypeError('An audio warp project is required.');
	}
	const project = {
		...projectValue,
		sampleRate: positiveSafeInteger(projectValue.sampleRate, 'audio warp project sample rate'),
	};
	if (!Array.isArray(project.tempoMap?.events) || project.tempoMap.events.length === 0) {
		throw new TypeError('An audio warp project requires a hold tempo map.');
	}
	if (!clipValue || typeof clipValue !== 'object' || clipValue.kind !== 'audio') {
		throw new TypeError('An audio clip is required for warp evaluation.');
	}
	const clip = {
		...clipValue,
		timelineStartFrame: nonNegativeSafeInteger(clipValue.timelineStartFrame, 'audio warp clip start'),
		durationFrames: positiveSafeInteger(clipValue.durationFrames, 'audio warp clip duration'),
		sourceStartFrame: nonNegativeSafeInteger(clipValue.sourceStartFrame, 'audio warp source start'),
		sourceDurationFrames: positiveSafeInteger(clipValue.sourceDurationFrames, 'audio warp source duration'),
	};
	if (clip.reversed) throw new RangeError('Audio warp maps require forward clip source orientation.');
	const map = normalizeAudioWarpMap(clip.warpMap);
	assertMapEndpoints(project, clip, map);
	return Object.freeze({ project, clip, map });
}

export function audioWarpOuterAtTimelineFrame(
	project: AudioWarpAuthorityRuntimeProject,
	clip: AudioWarpAuthorityRuntimeClip,
	timelineFrame: number,
): Rational {
	if (!isMusicalAudioWarpClip(clip)) {
		return Object.freeze({ num: timelineFrame - clip.timelineStartFrame, den: 1 });
	}
	return subtractRationals(
		sampleFrameToBeat(timelineFrame, project.tempoMap, project.sampleRate),
		clip.musicalStartBeat!,
	);
}

export function isMusicalAudioWarpClip(clip: AudioWarpAuthorityRuntimeClip): boolean {
	if (clip.anchor !== 'musical') return false;
	if (clip.musicalExtent !== 'beat' || clip.musicalStartBeat == null
		|| clip.musicalDurationBeats == null) {
		throw new TypeError('A musical audio warp clip requires beat start and extent authority.');
	}
	return true;
}

function assertMapEndpoints(
	project: AudioWarpAuthorityRuntimeProject,
	clip: AudioWarpAuthorityRuntimeClip,
	map: Readonly<AudioWarpMap>,
): void {
	const first = map.points[0]!;
	const last = map.points.at(-1)!;
	const expectedOuterEnd = isMusicalAudioWarpClip(clip)
		? clip.musicalDurationBeats!
		: clip.durationFrames;
	const expectedSourceEnd = safeAdd(
		clip.sourceStartFrame,
		clip.sourceDurationFrames,
		'audio warp source extent',
	);
	if (compareRationals(first.outer, 0) !== 0
		|| compareRationals(last.outer, expectedOuterEnd) !== 0) {
		throw new RangeError('Audio warp outer endpoints must match the clip anchor extent.');
	}
	if (compareRationals(first.source, clip.sourceStartFrame) !== 0
		|| compareRationals(last.source, expectedSourceEnd) !== 0) {
		throw new RangeError('Audio warp source endpoints must match the clip source extent.');
	}
	// Exercise the inverse at both endpoints so malformed musical authority is
	// rejected at the same boundary as runtime consumption.
	audioWarpOuterAtTimelineFrame(project, clip, clip.timelineStartFrame);
	audioWarpOuterAtTimelineFrame(
		project,
		clip,
		safeAdd(clip.timelineStartFrame, clip.durationFrames, 'audio warp clip extent'),
	);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function safeAdd(left: number, right: number, name: string): number {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)
		|| right > Number.MAX_SAFE_INTEGER - left) {
		throw new RangeError(`${name} exceeds the supported safe integer range.`);
	}
	return left + right;
}
