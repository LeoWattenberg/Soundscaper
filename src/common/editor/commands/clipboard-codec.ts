/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS,
	createTimelineAnnotationV11,
} from '../timeline-annotation.ts';
import { AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR } from '../timeline-coordinate-limits.ts';
import { normalizeRational } from '../timeline-time.ts';
import {
	admitAudioEditorProjectV9ValidationStructure,
	AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS,
} from '../project-v9-validation-budget.ts';
import {
	assertTakeCompClipboardTrackOwnership,
	collectTakeCompClipboardSourceIds,
	normalizeTakeCompClipboardGroups,
} from './take-comp-clipboard.ts';
import { cloneVideoClipComposition } from '../video-clip-composition.ts';
import { normalizeVideoKeyframeCurves } from '../video-keyframe-curves.ts';
import type {
	AudioEditorClipboard,
	AudioEditorClipboardAnnotation,
} from './protocol.ts';

export const AUDIO_EDITOR_COMMAND_CLIPBOARD_SCHEMA_VERSION = 6;

type DataRecord = Record<string, unknown>;

const ANNOTATION_CONTEXT = Object.freeze({
	sampleRate: 48_000,
	tempoMap: Object.freeze({
		mode: 'musical' as const,
		events: Object.freeze([{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }]),
	}),
});
const TOP_LEVEL_V3_KEYS = new Set(['schemaVersion', 'sampleRate', 'durationFrames', 'tracks', 'annotations']);
const TOP_LEVEL_V4_KEYS = new Set([...TOP_LEVEL_V3_KEYS, 'takeGroups']);
const TRACK_V3_KEYS = new Set([
	'sourceTrackId', 'sourceTrackName', 'sourceTrackType', 'sourceLaneGroupId', 'sourceSequenceId', 'clips',
]);
const ANNOTATION_COMMON_KEYS = [
	'key', 'sourceSequenceId', 'name', 'color', 'batchId', 'opaqueExtensions', 'kind', 'anchor',
] as const;

/** Collect media roots without traversing annotation extension payloads. */
export function collectAudioEditorClipboardSourceIds(
	descriptor: AudioEditorClipboard | null | undefined,
): readonly string[] {
	const ids = new Set<string>();
	for (const track of descriptor?.tracks || []) {
		for (const clip of track?.clips || []) {
			if (typeof clip?.sourceId === 'string' && clip.sourceId) ids.add(clip.sourceId);
		}
	}
	if (descriptor?.schemaVersion === 4 || descriptor?.schemaVersion === 5
		|| descriptor?.schemaVersion === AUDIO_EDITOR_COMMAND_CLIPBOARD_SCHEMA_VERSION) {
		for (const sourceId of collectTakeCompClipboardSourceIds(
			normalizeTakeCompClipboardGroups(descriptor.takeGroups),
		)) ids.add(sourceId);
	}
	return [...ids].sort();
}

/** Fail closed when a V3..V6 paste contains, or disguises, annotation content. */
export function clipboardRequiresTimelineAnnotationCapability(value: unknown): boolean {
	if (!isRecord(value)) return false;
	const schema = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	if (!schema?.enumerable || !Object.hasOwn(schema, 'value')) return Object.hasOwn(value, 'annotations');
	if (schema.value !== 3 && schema.value !== 4 && schema.value !== 5
		&& schema.value !== AUDIO_EDITOR_COMMAND_CLIPBOARD_SCHEMA_VERSION) return false;
	const annotations = Object.getOwnPropertyDescriptor(value, 'annotations');
	if (!annotations?.enumerable || !Object.hasOwn(annotations, 'value')) return true;
	return !Array.isArray(annotations.value) || annotations.value.length > 0;
}

/** Validate and detach one legacy V1..V5 or current V6 command descriptor. */
export function normalizeAudioEditorClipboardDescriptor(descriptor: unknown): AudioEditorClipboard {
	if (!isRecord(descriptor)) throw new TypeError('An audio editor clipboard descriptor is required.');
	let candidate = descriptor;
	const schemaValue = ownDataValue(candidate, 'schemaVersion', 'clipboard');
	if (schemaValue !== 1 && schemaValue !== 2 && schemaValue !== 3 && schemaValue !== 4 && schemaValue !== 5
		&& schemaValue !== AUDIO_EDITOR_COMMAND_CLIPBOARD_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported clipboard schema version: ${String(schemaValue)}.`);
	}
	const schemaVersion = schemaValue as 1 | 2 | 3 | 4 | 5 | 6;
	if (schemaVersion >= 3) {
		assertClosedRecord(
			candidate,
			schemaVersion >= 4 ? TOP_LEVEL_V4_KEYS : TOP_LEVEL_V3_KEYS,
			'clipboard',
		);
		admitAudioEditorProjectV9ValidationStructure(
			candidate,
			AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS,
		);
		candidate = clone(candidate);
	}
	positiveInteger(candidate.sampleRate, 'clipboard.sampleRate');
	positiveInteger(candidate.durationFrames, 'clipboard.durationFrames');
	if (!Array.isArray(candidate.tracks)) throw new TypeError('clipboard.tracks must be an array.');
	if (schemaVersion >= 3) {
		denseArray(candidate.tracks, 'clipboard.tracks', 100_000);
		if (!Array.isArray(candidate.annotations)) throw new TypeError('clipboard.annotations must be an array.');
		denseArray(
			candidate.annotations,
			'clipboard.annotations',
			AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS.maximumAnnotations,
		);
	}
	validateTracks(candidate.tracks, schemaVersion);
	const normalized = (schemaVersion >= 3
		? candidate
		: clone(candidate)) as DataRecord;
	if (schemaVersion >= 3) {
		normalized.annotations = normalizeAnnotations(candidate.annotations as unknown[]);
	}
	if (schemaVersion >= 4) {
		const takeGroups = normalizeTakeCompClipboardGroups(candidate.takeGroups);
		assertTakeCompClipboardTrackOwnership(takeGroups, candidate.tracks);
		normalized.takeGroups = takeGroups as unknown as AudioEditorClipboard['takeGroups'];
	}
	return normalized as unknown as AudioEditorClipboard;
}

function validateTracks(tracks: unknown[], schemaVersion: 1 | 2 | 3 | 4 | 5 | 6): void {
	const laneGroups = new Map<string, Array<{ index: number; type: 'audio' | 'video'; sequenceId: string | null }>>();
	const avLinks = new Map<string, Array<{
		kind: 'audio' | 'video';
		offsetFrame: unknown;
		durationFrames: unknown;
		laneGroupId: unknown;
		sequenceId: string | null;
	}>>();
	const trackIds = new Set<string>();
	for (const [trackIndex, trackValue] of tracks.entries()) {
		const track = record(trackValue, `clipboard.tracks[${String(trackIndex)}]`);
		const trackName = `clipboard.tracks[${String(trackIndex)}]`;
		if (schemaVersion >= 3) {
			assertClosedRecord(track, TRACK_V3_KEYS, trackName);
		}
		const sourceTrackId = nonEmptyString(track.sourceTrackId, `${trackName}.sourceTrackId`);
		if (schemaVersion >= 3) {
			if (trackIds.has(sourceTrackId)) throw new RangeError(`Duplicate clipboard source track ID: ${sourceTrackId}.`);
			trackIds.add(sourceTrackId);
			if (typeof track.sourceTrackName !== 'string') throw new TypeError(`${trackName}.sourceTrackName must be a string.`);
		}
		if (!Array.isArray(track.clips)) throw new TypeError(`${trackName}.clips must be an array.`);
		if (schemaVersion >= 3) denseArray(track.clips, `${trackName}.clips`, 100_000);
		const sourceTrackType = schemaVersion >= 2 ? track.sourceTrackType : 'audio';
		if (sourceTrackType !== 'audio' && sourceTrackType !== 'video') {
			throw new RangeError(`${trackName}.sourceTrackType must be audio or video.`);
		}
		const sourceSequenceId = schemaVersion >= 3
			? canonicalId(track.sourceSequenceId, `${trackName}.sourceSequenceId`)
			: null;
		if (schemaVersion >= 2 && track.sourceLaneGroupId != null) {
			const laneGroupId = nonEmptyString(track.sourceLaneGroupId, `${trackName}.sourceLaneGroupId`);
			const entries = laneGroups.get(laneGroupId) || [];
			entries.push({ index: trackIndex, type: sourceTrackType, sequenceId: sourceSequenceId });
			laneGroups.set(laneGroupId, entries);
		}
		for (const [clipIndex, clipValue] of track.clips.entries()) {
			const clip = record(clipValue, `${trackName}.clips[${String(clipIndex)}]`);
			const clipName = `${trackName}.clips[${String(clipIndex)}]`;
			if (schemaVersion >= 3) assertEnumerableDataProperties(clip, clipName);
			if (schemaVersion < 5 && Object.hasOwn(clip, 'videoComposition')) {
				throw new RangeError(`${clipName}.videoComposition requires clipboard V5 recopy.`);
			}
			if (schemaVersion < 6 && Object.hasOwn(clip, 'videoKeyframes')) {
				throw new RangeError(`${clipName}.videoKeyframes requires clipboard V6 recopy.`);
			}
			nonEmptyString(clip.key, `${clipName}.key`);
			nonEmptyString(clip.sourceId, `${clipName}.sourceId`);
			nonNegativeInteger(clip.offsetFrame, `${clipName}.offsetFrame`);
			nonNegativeInteger(clip.sourceStartFrame, `${clipName}.sourceStartFrame`);
			positiveInteger(clip.durationFrames, `${clipName}.durationFrames`);
			if (schemaVersion < 2) continue;
			if (clip.kind !== 'audio' && clip.kind !== 'video') throw new RangeError(`${clipName}.kind must be audio or video.`);
			if (clip.kind !== sourceTrackType) throw new RangeError(`${trackName} cannot contain a ${String(clip.kind)} clip.`);
			if (schemaVersion >= 5) normalizeClipVideoComposition(clip, clipName);
			if (schemaVersion === 6) normalizeClipVideoKeyframes(clip, clipName);
			if (schemaVersion >= 3 && clip.kind === 'video' && clip.sequenceId !== sourceSequenceId) {
				throw new RangeError(`${clipName}.sequenceId must match its source sequence context.`);
			}
			if (clip.groupId != null) nonEmptyString(clip.groupId, `${clipName}.groupId`);
			if (clip.avLinkId == null) continue;
			const avLinkId = nonEmptyString(clip.avLinkId, `${clipName}.avLinkId`);
			const linked = avLinks.get(avLinkId) || [];
			linked.push({
				kind: clip.kind,
				offsetFrame: clip.offsetFrame,
				durationFrames: clip.durationFrames,
				laneGroupId: track.sourceLaneGroupId || null,
				sequenceId: sourceSequenceId,
			});
			avLinks.set(avLinkId, linked);
		}
	}
	for (const [laneGroupId, grouped] of laneGroups) {
		if (grouped.length !== 2 || grouped[0]?.type !== 'video' || grouped[1]?.type !== 'audio'
			|| grouped[1].index !== grouped[0].index + 1
			|| (schemaVersion >= 3 && grouped[0].sequenceId !== grouped[1].sequenceId)) {
			throw new RangeError(`Clipboard media lane group ${laneGroupId} must contain one adjacent video/audio track pair.`);
		}
	}
	for (const [avLinkId, linked] of avLinks) {
		if (linked.length !== 2 || linked[0]?.kind !== 'video' || linked[1]?.kind !== 'audio'
			|| linked[0].offsetFrame !== linked[1].offsetFrame
			|| linked[0].durationFrames !== linked[1].durationFrames
			|| !linked[0].laneGroupId || linked[0].laneGroupId !== linked[1].laneGroupId
			|| (schemaVersion >= 3 && linked[0].sequenceId !== linked[1].sequenceId)) {
			throw new RangeError(`Clipboard A/V link ${avLinkId} must contain one aligned video/audio pair.`);
		}
	}
}

function normalizeClipVideoKeyframes(clip: DataRecord, name: string): void {
	const descriptor = Object.getOwnPropertyDescriptor(clip, 'videoKeyframes');
	if (clip.kind === 'audio') {
		if (descriptor) throw new TypeError(`${name} is audio and must not carry videoKeyframes.`);
		return;
	}
	if (!descriptor) return;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.videoKeyframes must be an own enumerable data property.`);
	}
	clip.videoKeyframes = normalizeVideoKeyframeCurves(descriptor.value, {
		duration: { num: positiveInteger(clip.sequenceFrameCount, `${name}.sequenceFrameCount`), den: 1 },
		composition: clip.videoComposition,
		videoEffects: clip.videoEffects,
	}, `${name}.videoKeyframes`);
}

function normalizeClipVideoComposition(clip: DataRecord, name: string): void {
	const descriptor = Object.getOwnPropertyDescriptor(clip, 'videoComposition');
	if (clip.kind === 'audio') {
		if (descriptor) throw new TypeError(`${name} is audio and must not carry videoComposition.`);
		return;
	}
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.videoComposition is required as an own enumerable data property.`);
	}
	clip.videoComposition = cloneVideoClipComposition(descriptor.value, `${name}.videoComposition`);
}

function normalizeAnnotations(values: unknown[]): readonly AudioEditorClipboardAnnotation[] {
	const keys = new Set<string>();
	const batchSequences = new Map<string, string>();
	return Object.freeze(values.map((value, index) => {
		const name = `clipboard.annotations[${String(index)}]`;
		const candidate = record(value, name);
		const kind = ownDataValue(candidate, 'kind', name);
		const anchor = ownDataValue(candidate, 'anchor', name);
		const timingKeys = kind === 'marker'
			? anchor === 'sample' ? ['positionOffsetFrame'] : ['positionOffsetBeat']
			: anchor === 'sample' ? ['startOffsetFrame', 'endOffsetFrame'] : ['startOffsetBeat', 'endOffsetBeat'];
		if ((kind !== 'marker' && kind !== 'region') || (anchor !== 'sample' && anchor !== 'musical')) {
			throw new RangeError(`${name} must have a supported kind and anchor.`);
		}
		assertClosedRecord(candidate, new Set([...ANNOTATION_COMMON_KEYS, ...timingKeys]), name);
		const key = canonicalId(candidate.key, `${name}.key`);
		if (keys.has(key)) throw new RangeError(`Duplicate clipboard annotation key: ${key}.`);
		keys.add(key);
		const sourceSequenceId = canonicalId(candidate.sourceSequenceId, `${name}.sourceSequenceId`);
		const common = createTimelineAnnotationV11({
			id: key,
			sequenceId: sourceSequenceId,
			name: candidate.name,
			color: candidate.color,
			batchId: candidate.batchId,
			opaqueExtensions: candidate.opaqueExtensions,
			kind: 'marker',
			anchor: 'sample',
			positionFrame: 0,
		}, ANNOTATION_CONTEXT);
		if (common.batchId !== null) {
			const existing = batchSequences.get(common.batchId);
			if (existing !== undefined && existing !== sourceSequenceId) {
				throw new RangeError(`Clipboard annotation batch ${common.batchId} must belong to one source sequence.`);
			}
			batchSequences.set(common.batchId, sourceSequenceId);
		}
		const base = {
			key,
			sourceSequenceId,
			name: common.name,
			color: common.color,
			batchId: common.batchId,
			opaqueExtensions: common.opaqueExtensions,
			kind,
			anchor,
		};
		if (kind === 'marker' && anchor === 'sample') {
			return Object.freeze({ ...base, kind, anchor, positionOffsetFrame: safeInteger(candidate.positionOffsetFrame, `${name}.positionOffsetFrame`) });
		}
		if (kind === 'marker') {
			return Object.freeze({ ...base, kind, anchor: 'musical' as const, positionOffsetBeat: signedRational(candidate.positionOffsetBeat, `${name}.positionOffsetBeat`) });
		}
		if (anchor === 'sample') {
			const startOffsetFrame = safeInteger(candidate.startOffsetFrame, `${name}.startOffsetFrame`);
			const endOffsetFrame = safeInteger(candidate.endOffsetFrame, `${name}.endOffsetFrame`);
			if (endOffsetFrame <= startOffsetFrame) throw new RangeError(`${name} must have a positive sample span.`);
			return Object.freeze({ ...base, kind, anchor, startOffsetFrame, endOffsetFrame });
		}
		const startOffsetBeat = signedRational(candidate.startOffsetBeat, `${name}.startOffsetBeat`);
		const endOffsetBeat = signedRational(candidate.endOffsetBeat, `${name}.endOffsetBeat`);
		if (compareRational(startOffsetBeat, endOffsetBeat) >= 0) throw new RangeError(`${name} must have a positive musical span.`);
		return Object.freeze({ ...base, kind, anchor: 'musical' as const, startOffsetBeat, endOffsetBeat });
	}));
}

function signedRational(value: unknown, name: string): Readonly<{ num: number; den: number }> {
	const candidate = record(value, name);
	assertClosedRecord(candidate, new Set(['num', 'den']), name);
	const num = safeInteger(candidate.num, `${name}.num`);
	const den = positiveInteger(candidate.den, `${name}.den`);
	if (den > AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR) throw new RangeError(`${name}.den exceeds its denominator bound.`);
	const result = normalizeRational({ num, den }, { maximumDenominator: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR });
	if (result.num !== num || result.den !== den) throw new RangeError(`${name} must be canonically reduced.`);
	return result;
}

function compareRational(left: Readonly<{ num: number; den: number }>, right: Readonly<{ num: number; den: number }>): number {
	const difference = BigInt(left.num) * BigInt(right.den) - BigInt(right.num) * BigInt(left.den);
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function denseArray(value: unknown[], name: string, maximumLength: number): void {
	if (value.length > maximumLength) throw new RangeError(`${name} exceeds its maximum length.`);
	for (const key of Reflect.ownKeys(value)) {
		if (key === 'length') continue;
		if (typeof key !== 'string' || !arrayIndex(key, value.length)) {
			throw new TypeError(`${name} contains an unsupported field: ${String(key)}.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
	}
	for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) throw new TypeError(`${name} must be dense.`);
	}
}

function arrayIndex(value: string, length: number): boolean {
	if (!/^(?:0|[1-9]\d*)$/u.test(value)) return false;
	const index = Number(value);
	return Number.isSafeInteger(index) && index < length && String(index) === value;
}

function assertClosedRecord(value: DataRecord, allowed: ReadonlySet<string>, name: string): void {
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !allowed.has(key)) throw new TypeError(`${name} contains an unsupported field: ${String(key)}.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
}

function assertEnumerableDataProperties(value: DataRecord, name: string): void {
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an own enumerable data property.`);
		}
	}
}

function ownDataValue(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function record(value: unknown, name: string): DataRecord {
	if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
	return value;
}

function isRecord(value: unknown): value is DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function canonicalId(value: unknown, name: string): string {
	const result = nonEmptyString(value, name);
	if (result !== result.trim()) throw new TypeError(`${name} must be a canonical string.`);
	return result;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new RangeError(`${name} must be a safe integer.`);
	return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return result;
}

function nonNegativeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return result;
}

function clone<Value>(value: Value): Value {
	try {
		return structuredClone(value) as Value;
	} catch {
		throw new TypeError('The clipboard descriptor must be cloneable.');
	}
}
