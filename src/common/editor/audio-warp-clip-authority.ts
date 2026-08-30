/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAudioWarpMap,
	type AudioWarpMap,
} from './audio-warp-domain.ts';
import { normalizeAudioWarpRuntimeInputs } from './audio-warp-runtime-authority.ts';
import {
	readClosedDomainField,
	readClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	resolveRuntimeClipProjection,
	type RuntimeClipProject,
	type RuntimePersistedClip,
} from './runtime-clip-projection.ts';
import {
	normalizeAudioWarpCoordinate,
} from './audio-groove-template.ts';
import type { HoldTempoMap, Rational } from './timeline-time.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export interface AudioWarpAuthorityProject extends RuntimeClipProject {
	readonly sampleRate: number;
	readonly tempoMap: HoldTempoMap;
	readonly clips: readonly RuntimePersistedClip[];
	readonly tracks: readonly DataRecord[];
}

export interface AudioWarpClipAuthority {
	readonly clipId: string;
	readonly trackId: string;
	readonly sourceId: string;
	readonly anchor: 'sample' | 'musical';
	readonly outerStart: Rational;
	readonly outerExtent: Rational;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly reversed: false;
	readonly renderCacheRevision: number;
	readonly warpMap: Readonly<AudioWarpMap> | null;
}

export interface AudioWarpClipAuthorityContext {
	readonly clip: RuntimePersistedClip;
	readonly track: DataRecord;
	readonly authority: Readonly<AudioWarpClipAuthority>;
}

/** Capture only the clip and ownership fields that can change warp meaning. */
export function createAudioWarpClipAuthority(
	project: AudioWarpAuthorityProject,
	clipIdValue: string,
): Readonly<AudioWarpClipAuthority> {
	return audioWarpClipAuthorityContext(project, clipIdValue).authority;
}

/** Reject an edit prepared against a different map, extent, source, or owner. */
export function assertAudioWarpClipAuthority(
	project: AudioWarpAuthorityProject,
	clipIdValue: string,
	expectedValue: unknown,
): Readonly<AudioWarpClipAuthorityContext> {
	const context = audioWarpClipAuthorityContext(project, clipIdValue);
	const expected = normalizeAudioWarpClipAuthority(expectedValue);
	if (!sameData(expected, context.authority)) {
		throw new RangeError('Clip authority changed after the warp edit was prepared.');
	}
	return context;
}

/** Validate map endpoints against the resolved clip anchor and source extent. */
export function normalizeAudioWarpMapForClip(
	project: AudioWarpAuthorityProject,
	clip: RuntimePersistedClip,
	value: unknown,
): Readonly<AudioWarpMap> {
	const map = normalizeAudioWarpMap(value);
	const runtime = resolveRuntimeClipProjection(project, clip);
	return normalizeAudioWarpRuntimeInputs(project, {
		...runtime,
		warpMap: map,
	} as unknown as Parameters<typeof normalizeAudioWarpRuntimeInputs>[1]).map;
}

export function normalizeAudioWarpClipAuthority(value: unknown): Readonly<AudioWarpClipAuthority> {
	const name = 'audio warp clip authority';
	const record = readClosedDomainRecord(value, name, [
		'clipId', 'trackId', 'sourceId', 'anchor', 'outerStart', 'outerExtent',
		'sourceStartFrame', 'sourceDurationFrames', 'reversed', 'renderCacheRevision', 'warpMap',
	]);
	const anchor = readClosedDomainField(record, 'anchor', name);
	if (anchor !== 'sample' && anchor !== 'musical') {
		throw new RangeError('Audio warp clip authority has an unsupported anchor.');
	}
	if (readClosedDomainField(record, 'reversed', name) !== false) {
		throw new RangeError('Audio warp clip authority requires forward source orientation.');
	}
	const warpMap = readClosedDomainField(record, 'warpMap', name);
	return Object.freeze({
		clipId: stableId(readClosedDomainField(record, 'clipId', name), 'audio warp clip ID'),
		trackId: stableId(readClosedDomainField(record, 'trackId', name), 'audio warp track ID'),
		sourceId: stableId(readClosedDomainField(record, 'sourceId', name), 'audio warp source ID'),
		anchor,
		outerStart: normalizeAudioWarpCoordinate(
			readClosedDomainField(record, 'outerStart', name),
			'audio warp clip authority outer start',
		),
		outerExtent: positiveRational(
			readClosedDomainField(record, 'outerExtent', name),
			'audio warp clip authority outer extent',
		),
		sourceStartFrame: nonNegativeSafeInteger(
			readClosedDomainField(record, 'sourceStartFrame', name),
			'audio warp clip authority source start',
		),
		sourceDurationFrames: positiveSafeInteger(
			readClosedDomainField(record, 'sourceDurationFrames', name),
			'audio warp clip authority source duration',
		),
		reversed: false,
		renderCacheRevision: nonNegativeSafeInteger(
			readClosedDomainField(record, 'renderCacheRevision', name),
			'audio warp clip authority render cache revision',
		),
		warpMap: warpMap === null ? null : normalizeAudioWarpMap(warpMap),
	});
}

function audioWarpClipAuthorityContext(
	project: AudioWarpAuthorityProject,
	clipIdValue: string,
): Readonly<AudioWarpClipAuthorityContext> {
	if (!project || typeof project !== 'object' || !Array.isArray(project.clips)
		|| !Array.isArray(project.tracks)) {
		throw new TypeError('An audio warp project is required.');
	}
	const clipId = stableId(clipIdValue, 'audio warp clip ID');
	const clip = project.clips.find((candidate) => candidate.id === clipId);
	if (!clip) throw new ReferenceError(`Unknown audio warp clip: ${clipId}.`);
	if (clip.kind !== 'audio') throw new RangeError(`Clip ${clipId} is not audio.`);
	if (clip.anchor !== 'sample' && clip.anchor !== 'musical') {
		throw new RangeError(`Audio clip ${clipId} has an unsupported warp anchor.`);
	}
	if (clip.anchor === 'musical' && clip.musicalExtent !== 'beat') {
		throw new RangeError('Musical audio warp maps require a beat extent.');
	}
	if (clip.reversed === true) throw new RangeError('Audio warp maps require forward source orientation.');
	const owners = project.tracks.filter((track) => (
		Array.isArray(track.clipIds) && track.clipIds.includes(clipId)
	));
	if (owners.length !== 1) throw new RangeError(`Audio warp clip ${clipId} requires one owning track.`);
	const track = owners[0]!;
	const runtime = resolveRuntimeClipProjection(project, clip);
	const mapValue = (clip as DataRecord).warpMap;
	const authority = Object.freeze({
		clipId,
		trackId: stableId(track.id, 'audio warp track ID'),
		sourceId: stableId((clip as DataRecord).sourceId, 'audio warp source ID'),
		anchor: clip.anchor,
		outerStart: clip.anchor === 'musical'
			? normalizeAudioWarpCoordinate(clip.musicalStartBeat, 'audio warp musical start')
			: normalizeAudioWarpCoordinate(runtime.timelineStartFrame, 'audio warp sample start'),
		outerExtent: clip.anchor === 'musical'
			? positiveRational(clip.musicalDurationBeats, 'audio warp musical duration')
			: positiveRational(runtime.durationFrames, 'audio warp sample duration'),
		sourceStartFrame: nonNegativeSafeInteger(runtime.sourceStartFrame, 'audio warp source start'),
		sourceDurationFrames: positiveSafeInteger(runtime.sourceDurationFrames, 'audio warp source duration'),
		reversed: false as const,
		renderCacheRevision: nonNegativeSafeInteger(
			(clip as DataRecord).renderCacheRevision,
			'audio warp render cache revision',
		),
		warpMap: mapValue == null ? null : normalizeAudioWarpMapForClip(project, clip, mapValue),
	});
	return Object.freeze({ clip, track, authority });
}

function positiveRational(value: unknown, name: string): Rational {
	const result = normalizeAudioWarpCoordinate(value, name);
	if (result.num <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function sameData(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left) && Array.isArray(right) && left.length === right.length
			&& left.every((candidate, index) => sameData(candidate, right[index]));
	}
	const leftRecord = left as DataRecord;
	const rightRecord = right as DataRecord;
	const leftKeys = Object.keys(leftRecord);
	const rightKeys = Object.keys(rightRecord);
	return leftKeys.length === rightKeys.length && leftKeys.every((key) => (
		Object.hasOwn(rightRecord, key) && sameData(leftRecord[key], rightRecord[key])
	));
}
