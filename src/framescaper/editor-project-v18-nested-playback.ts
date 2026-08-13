/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { validateAudioEditorProjectV17 } from '../common/editor/project-v17-validation.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { resolveRuntimeClipProjection } from '../common/editor/runtime-clip-projection.ts';
import {
	framescaperProjectFeatureRequirementsForV17Foundation,
} from './editor-project-feature-requirements-v18.ts';
import {
	flattenFramescaperSequenceV18,
	type FramescaperExactSequenceFrameV18,
	type FramescaperFlattenedSequenceClipV18,
} from './editor-project-v18-nested-sequence.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18-validation.ts';

const TEXT_ENCODER = new TextEncoder();
const ID_PREFIX = 'framescaper-v18-flat';

export interface FramescaperNestedPlaybackFoundationV17 extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly schemaVersion: 17;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly sequences: readonly (Readonly<Record<string, unknown>> & {
		readonly id: string;
		readonly trackIds: readonly string[];
		readonly trackNodes: readonly Readonly<Record<string, unknown>>[];
	})[];
}

interface MaterializedClipOccurrence {
	readonly occurrence: Readonly<FramescaperFlattenedSequenceClipV18>;
	readonly clip: Readonly<Record<string, unknown>>;
	readonly sourceTrackId: string;
	readonly transientTrackId: string;
}

interface MaterializedTrackOccurrence {
	readonly track: Readonly<Record<string, unknown>>;
	readonly sourceTrackId: string;
}

/**
 * Materialize the exact primary nested graph as an immutable V17 playback view.
 * Persisted V18 identity and aliases remain untouched; each reachable occurrence
 * receives deterministic transient clip and track IDs on the primary frame grid.
 */
export function materializeFramescaperNestedPlaybackFoundationV18(
	profile: EditorProjectRuntimeProfile | unknown,
	projectValue: FramescaperProjectV18 | unknown,
): FramescaperNestedPlaybackFoundationV17 {
	assertFramescaperProjectV18Profile(profile);
	validateFramescaperProjectV18(profile, projectValue);
	const project = projectValue as FramescaperProjectV18;
	assertEmptyCollection(project.trackFolders, 'Nested playback track folders');
	assertEmptyCollection(project.takeGroups, 'Nested playback take groups');
	const sources = freezeRecords(project.sources.map((source) => {
		const result: Record<string, unknown> = { ...source };
		delete result.proxyAttachment;
		return result;
	}));
	const byClipId = uniqueRecordsById(project.clips, 'timeline clip');
	const byTrackId = uniqueRecordsById(project.tracks, 'track');
	const bySequenceId = uniqueRecordsById(project.sequences, 'sequence');
	const primary = sequenceById(project, project.primarySequenceId);
	const flattened = flattenFramescaperSequenceV18(profile, project, project.primarySequenceId);
	const materialized = flattened.map((occurrence) => materializeClipOccurrence(
		project,
		primary,
		occurrence,
		byClipId,
		byTrackId,
		bySequenceId,
	));
	const materializedTracks = materializeTracks(materialized, byTrackId);
	const clipIds = new Set(materialized.map(({ clip }) => String(clip.id)));
	const trackIds = new Set(materializedTracks.map(({ track }) => String(track.id)));
	if (clipIds.size !== materialized.length || trackIds.size !== materializedTracks.length) {
		throw new RangeError('Nested playback materialization produced a transient identity collision.');
	}
	const clips = freezeRecords(materialized.map(({ clip }) => clip));
	const tracks = freezeRecords(materializedTracks.map(({ track }) => track));
	const sequences = freezeRecords(project.sequences.map((sequence) => {
		const root = String(sequence.id) === project.primarySequenceId;
		return {
			...sequence,
			trackIds: Object.freeze(root ? tracks.map(({ id }) => String(id)) : []),
			trackNodes: Object.freeze(root ? tracks.map(({ id }) => Object.freeze({
				kind: 'track', id: String(id), parentFolderId: null,
			})) : []),
		};
	}));
	const foundation: Record<string, unknown> = {
		...project,
		schemaVersion: 17,
		sources,
		clips,
		tracks,
		sequences,
		selection: clearTransientSelection(project.selection),
		view: clearTransientView(project.view),
		mixer: materializeMixer(project.mixer, materializedTracks),
		trackFolders: Object.freeze([]),
		takeGroups: Object.freeze([]),
		featureRequirements: framescaperProjectFeatureRequirementsForV17Foundation(profile, project),
	};
	delete foundation.subsequences;
	delete foundation.multicameraGroups;
	const result = Object.freeze(foundation) as FramescaperNestedPlaybackFoundationV17;
	validateAudioEditorProjectV17(result);
	return result;
}

function materializeClipOccurrence(
	project: FramescaperProjectV18,
	primary: Readonly<Record<string, unknown>>,
	occurrence: Readonly<FramescaperFlattenedSequenceClipV18>,
	byClipId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
	byTrackId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
	bySequenceId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): MaterializedClipOccurrence {
	const sourceClip = byClipId.get(occurrence.clipId);
	const sourceTrack = byTrackId.get(occurrence.trackId);
	if (!sourceClip || !sourceTrack) throw new ReferenceError('A flattened nested occurrence lost its source clip or track.');
	const sequenceStartFrame = exactSafeInteger(occurrence.startFrame, 'primary-sequence start');
	const sequenceEndFrame = exactSafeInteger(occurrence.endFrame, 'primary-sequence end');
	if (sequenceEndFrame <= sequenceStartFrame) throw new RangeError('A nested playback occurrence must have positive duration.');
	const identity = occurrenceIdentity(occurrence);
	const clipId = `${ID_PREFIX}-clip-${identity}`;
	const transientTrackId = `${ID_PREFIX}-track-${trackOccurrenceIdentity(occurrence)}`;
	const clip = occurrence.kind === 'video'
		? materializeVideoClip(sourceClip, occurrence, project.primarySequenceId, clipId, sequenceStartFrame, sequenceEndFrame)
		: materializeAudioClip(
			project,
			sourceClip,
			occurrence,
			primary,
			bySequenceId,
			clipId,
			sequenceStartFrame,
			sequenceEndFrame,
		);
	return Object.freeze({
		occurrence,
		clip,
		sourceTrackId: String(sourceTrack.id),
		transientTrackId,
	});
}

function materializeTracks(
	occurrences: readonly MaterializedClipOccurrence[],
	byTrackId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): readonly MaterializedTrackOccurrence[] {
	const groups = new Map<string, {
		readonly sourceTrackId: string;
		readonly clipIds: string[];
	}>();
	for (const occurrence of occurrences) {
		const prior = groups.get(occurrence.transientTrackId);
		if (prior) {
			if (prior.sourceTrackId !== occurrence.sourceTrackId) {
				throw new RangeError('Nested playback materialization produced a transient track collision.');
			}
			prior.clipIds.push(String(occurrence.clip.id));
			continue;
		}
		groups.set(occurrence.transientTrackId, {
			sourceTrackId: occurrence.sourceTrackId,
			clipIds: [String(occurrence.clip.id)],
		});
	}
	return Object.freeze([...groups].map(([id, group]) => {
		const sourceTrack = byTrackId.get(group.sourceTrackId);
		if (!sourceTrack) throw new ReferenceError('A materialized nested track lost its source track.');
		return Object.freeze({
			track: Object.freeze({
				...sourceTrack,
				id,
				clipIds: Object.freeze([...group.clipIds]),
				laneGroupId: null,
			}),
			sourceTrackId: group.sourceTrackId,
		});
	}));
}

function materializeVideoClip(
	source: Readonly<Record<string, unknown>>,
	occurrence: Readonly<FramescaperFlattenedSequenceClipV18>,
	primarySequenceId: string,
	clipId: string,
	sequenceStartFrame: number,
	sequenceEndFrame: number,
): Readonly<Record<string, unknown>> {
	if (source.retimeMap !== null) {
		throw new RangeError('Nested playback cannot materialize a retimed video occurrence exactly.');
	}
	const leafStart = exactSafeInteger(occurrence.leafStartFrame, 'leaf-sequence start');
	const leafEnd = exactSafeInteger(occurrence.leafEndFrame, 'leaf-sequence end');
	const sourceStart = safeInteger(source.sourceInFrame, 'source clip in frame');
	const sourceCount = positiveSafeInteger(source.sourceFrameCount, 'source clip frame count');
	const clipStart = safeInteger(source.sequenceStartFrame, 'source clip sequence start');
	const clipCount = positiveSafeInteger(source.sequenceFrameCount, 'source clip sequence frame count');
	const clipEnd = safeAdd(clipStart, clipCount, 'source clip sequence range');
	if (leafStart < clipStart || leafEnd > clipEnd) {
		throw new RangeError('A flattened video occurrence lies outside its canonical leaf clip.');
	}
	const mappedStart = exactAffineInteger(sourceStart, leafStart - clipStart, sourceCount, clipCount);
	const mappedEnd = exactAffineInteger(sourceStart, leafEnd - clipStart, sourceCount, clipCount);
	if (mappedEnd <= mappedStart) throw new RangeError('Nested video source material must retain a positive frame range.');
	return Object.freeze({
		...source,
		id: clipId,
		sequenceId: primarySequenceId,
		sequenceStartFrame,
		sequenceFrameCount: sequenceEndFrame - sequenceStartFrame,
		sourceInFrame: mappedStart,
		sourceFrameCount: mappedEnd - mappedStart,
		avLinkId: null,
	});
}

function materializeAudioClip(
	project: FramescaperProjectV18,
	source: Readonly<Record<string, unknown>>,
	occurrence: Readonly<FramescaperFlattenedSequenceClipV18>,
	primary: Readonly<Record<string, unknown>>,
	bySequenceId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
	clipId: string,
	sequenceStartFrame: number,
	sequenceEndFrame: number,
): Readonly<Record<string, unknown>> {
	if (source.warpMap !== null) {
		throw new RangeError('Nested playback cannot materialize a warped audio occurrence exactly.');
	}
	const leafSequence = bySequenceId.get(occurrence.leafSequenceId);
	if (!leafSequence) throw new ReferenceError('A flattened audio occurrence lost its leaf sequence.');
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project sample rate');
	const timelineStartFrame = sequenceFrameToSample(
		{ numerator: BigInt(sequenceStartFrame), denominator: 1n },
		primary,
		sampleRate,
		'primary audio start',
	);
	const timelineEndFrame = sequenceFrameToSample(
		{ numerator: BigInt(sequenceEndFrame), denominator: 1n },
		primary,
		sampleRate,
		'primary audio end',
	);
	const leafStartSample = sequenceFrameToSample(
		occurrence.leafStartFrame,
		leafSequence,
		sampleRate,
		'leaf audio start',
	);
	const leafEndSample = sequenceFrameToSample(
		occurrence.leafEndFrame,
		leafSequence,
		sampleRate,
		'leaf audio end',
	);
	const runtime = resolveRuntimeClipProjection(project, source);
	if (leafStartSample < runtime.timelineStartFrame || leafEndSample > runtime.timelineEndFrame) {
		throw new RangeError('A flattened audio occurrence lies outside its canonical leaf clip.');
	}
	const sourceOffsetStart = exactRatioInteger(
		leafStartSample - runtime.timelineStartFrame,
		runtime.sourceDurationFrames,
		runtime.durationFrames,
		'audio source start',
	);
	const sourceOffsetEnd = exactRatioInteger(
		leafEndSample - runtime.timelineStartFrame,
		runtime.sourceDurationFrames,
		runtime.durationFrames,
		'audio source end',
	);
	const sourceStartFrame = source.reversed === true
		? safeAdd(
			runtime.sourceStartFrame,
			runtime.sourceDurationFrames - sourceOffsetEnd,
			'audio reversed source start',
		)
		: safeAdd(runtime.sourceStartFrame, sourceOffsetStart, 'audio nested source start');
	assertAudioTrimStateIsRepresentable(
		source,
		leafStartSample === runtime.timelineStartFrame && leafEndSample === runtime.timelineEndFrame,
	);
	return Object.freeze({
		...source,
		id: clipId,
		anchor: 'sample',
		timelineStartFrame,
		durationFrames: timelineEndFrame - timelineStartFrame,
		sourceStartFrame,
		sourceDurationFrames: sourceOffsetEnd - sourceOffsetStart,
		musicalStartBeat: null,
		musicalExtent: 'fixedSamples',
		musicalDurationBeats: null,
		avLinkId: null,
	});
}

function assertAudioTrimStateIsRepresentable(
	source: Readonly<Record<string, unknown>>,
	wholeClip: boolean,
): void {
	if (wholeClip) return;
	const envelope = source.envelope;
	if (source.fadeInFrames !== 0 || source.fadeOutFrames !== 0
		|| !Array.isArray(envelope) || envelope.length > 0) {
		throw new RangeError('Nested playback cannot exactly trim audio fade or envelope state.');
	}
}

function exactAffineInteger(
	base: number,
	left: number,
	right: number,
	denominator: number,
): number {
	const numerator = BigInt(base) * BigInt(denominator) + BigInt(left) * BigInt(right);
	const divisor = BigInt(denominator);
	if (numerator % divisor !== 0n) {
		throw new RangeError('Nested material does not align exactly to its source frame grid.');
	}
	const result = numerator / divisor;
	if (result < 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('Nested materialized source coordinates exceed the safe-integer range.');
	}
	return Number(result);
}

function exactRatioInteger(
	left: number,
	right: number,
	denominator: number,
	name: string,
): number {
	const numerator = BigInt(left) * BigInt(right);
	const divisor = BigInt(denominator);
	if (numerator % divisor !== 0n) {
		throw new RangeError(`Nested ${name} does not align exactly to the integer source grid.`);
	}
	const result = numerator / divisor;
	if (result < 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError(`Nested ${name} exceeds the safe-integer range.`);
	}
	return Number(result);
}

function sequenceFrameToSample(
	frame: Readonly<FramescaperExactSequenceFrameV18>,
	sequence: Readonly<Record<string, unknown>>,
	sampleRate: number,
	name: string,
): number {
	const rate = dataRecord(sequence.rate, `${name} sequence rate`);
	const rateNum = positiveSafeInteger(rate.num, `${name} sequence rate numerator`);
	const rateDen = positiveSafeInteger(rate.den, `${name} sequence rate denominator`);
	const numerator = frame.numerator * BigInt(sampleRate) * BigInt(rateDen);
	const denominator = frame.denominator * BigInt(rateNum);
	if (numerator % denominator !== 0n) {
		throw new RangeError(`Nested ${name} does not align exactly to the project sample grid.`);
	}
	const result = numerator / denominator;
	if (result < 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError(`Nested ${name} exceeds the safe-integer range.`);
	}
	return Number(result);
}

function exactSafeInteger(value: FramescaperExactSequenceFrameV18, name: string): number {
	if (value.denominator !== 1n) {
		throw new RangeError(`Nested ${name} does not align exactly to the primary frame grid.`);
	}
	if (value.numerator < 0n || value.numerator > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError(`Nested ${name} exceeds the safe-integer range.`);
	}
	return Number(value.numerator);
}

function occurrenceIdentity(occurrence: Readonly<FramescaperFlattenedSequenceClipV18>): string {
	const key = JSON.stringify([
		occurrence.clipId,
		occurrence.trackId,
		occurrence.sequencePath,
		occurrence.subsequencePath,
		occurrence.startFrame.numerator.toString(),
		occurrence.startFrame.denominator.toString(),
		occurrence.endFrame.numerator.toString(),
		occurrence.endFrame.denominator.toString(),
	]);
	return bytesToHex(sha256(TEXT_ENCODER.encode(key))).slice(0, 32);
}

function trackOccurrenceIdentity(occurrence: Readonly<FramescaperFlattenedSequenceClipV18>): string {
	const key = JSON.stringify([
		occurrence.trackId,
		occurrence.sequencePath,
		occurrence.subsequencePath,
	]);
	return bytesToHex(sha256(TEXT_ENCODER.encode(key))).slice(0, 32);
}

function uniqueRecordsById(
	values: readonly Readonly<Record<string, unknown>>[],
	name: string,
): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
	const result = new Map<string, Readonly<Record<string, unknown>>>();
	for (const value of values) {
		const id = String(value.id);
		if (result.has(id)) throw new RangeError(`A nested ${name} ID is duplicated.`);
		result.set(id, value);
	}
	return result;
}

function sequenceById(project: FramescaperProjectV18, id: string): Readonly<Record<string, unknown>> {
	const value = project.sequences.find((sequence) => String(sequence.id) === id);
	if (!value) throw new ReferenceError('The nested playback primary sequence is missing.');
	return value;
}

function clearTransientSelection(value: unknown): Readonly<Record<string, unknown>> {
	const selection = dataRecord(value, 'project selection');
	return Object.freeze({
		...selection,
		trackIds: Object.freeze([]),
		clipIds: Object.freeze([]),
	});
}

function clearTransientView(value: unknown): Readonly<Record<string, unknown>> {
	const view = dataRecord(value, 'project view');
	return Object.freeze({ ...view, selectedTrackIds: Object.freeze([]) });
}

function materializeMixer(
	value: unknown,
	tracks: readonly MaterializedTrackOccurrence[],
): Readonly<Record<string, unknown>> {
	const mixer = dataRecord(value, 'project mixer');
	const sourceRoutes = dataRecord(mixer.routes, 'project mixer routes');
	const routes: Record<string, unknown> = {};
	for (const { track, sourceTrackId } of tracks) {
		if (track.type !== 'audio') continue;
		const descriptor = Object.getOwnPropertyDescriptor(sourceRoutes, sourceTrackId);
		if (!descriptor) continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`project mixer route ${sourceTrackId} must be an own enumerable data property.`);
		}
		routes[String(track.id)] = Object.freeze({
			...dataRecord(descriptor.value, `project mixer route ${sourceTrackId}`),
		});
	}
	return Object.freeze({
		...mixer,
		groups: freezeRecords(recordArray(mixer.groups, 'project mixer groups')),
		sends: freezeRecords(recordArray(mixer.sends, 'project mixer sends')),
		routes: Object.freeze(routes),
	});
}

function freezeRecords<Value extends Readonly<Record<string, unknown>>>(values: readonly Value[]): readonly Value[] {
	return Object.freeze(values.map((value) => Object.freeze(value)));
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Readonly<Record<string, unknown>>;
}

function recordArray(value: unknown, name: string): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((entry, index) => dataRecord(entry, `${name}[${String(index)}]`));
}

function assertEmptyCollection(value: unknown, name: string): void {
	if (!Array.isArray(value) || value.length !== 0) {
		throw new RangeError(`${name} must be empty for exact nested playback materialization.`);
	}
}

function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`${name} exceeds the safe-integer range.`);
	return result;
}
