/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	createLabelTrackV9,
	createVideoClipV9,
	createVideoSourceV9,
	createVideoTrackV9,
	type AudioEditorProjectV9Options,
} from './project-v9.ts';
import { createLabelV2 } from './project-v2.js';
import {
	AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR,
	AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE,
	AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE,
} from './project-v10-foundation-validation.ts';
import {
	AUDIO_EDITOR_PROJECT_V10_SCHEMA_VERSION,
	validateAudioEditorProjectV10,
	type AudioEditorProjectV10,
} from './project-v10-validation.ts';
import {
	PROJECT_FEATURE_REQUIREMENTS_SCHEMA_VERSION,
	normalizeProjectFeatureRequirements,
} from './project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import { createStableId } from './stable-id.js';
import {
	beatToSampleFrame,
	addRationals,
	compareRationals,
	normalizeRational,
	sampleFrameToVideoFrame,
	type BreakpointMap,
	type HoldTempoMap,
	type Rational,
	type RationalInput,
	type RationalRate,
	validateBreakpointMap,
	videoFrameRangeToSampleRange,
} from './timeline-time.ts';
import {
	validateSampleLockedTempoBeatAuthority,
	validateTempoInverseRationalClosure,
} from './timeline-tempo-inverse.ts';
import { assertHoldTempoMapWireKeys } from './musical-map-contract.ts';
import {
	normalizeVideoTimingAssetReference,
} from './video-timing-asset-reference.ts';

export {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
} from './project-schema-version.ts';
export { AUDIO_EDITOR_MEDIA_KINDS, AUDIO_EDITOR_TRACK_TYPES } from './project-v9.ts';
export {
	AUDIO_EDITOR_PROJECT_V10_SCHEMA_VERSION,
	validateAudioEditorProjectV10,
	type AudioEditorProjectV10,
} from './project-v10-validation.ts';

export interface AudioEditorProjectV10Options extends AudioEditorProjectV9Options {
	readonly sequences?: readonly Readonly<Record<string, unknown>>[];
	readonly primarySequenceId?: string;
	readonly tempoMap?: unknown;
	readonly signatureMap?: unknown;
}

export interface VideoClipV10Context {
	readonly projectSampleRate: number;
	readonly sequence: Readonly<Record<string, unknown>>;
	readonly source: Readonly<Record<string, unknown>>;
}

const DEFAULT_SEQUENCE_ID = 'main-sequence';
const DEFAULT_RATE = Object.freeze({ num: 30, den: 1 });
const DEFAULT_TIMECODE = Object.freeze({ negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 });

export function createAudioSourceV10(options: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		...clone(options),
		...createAudioSourceV9(options),
		kind: 'audio',
	};
}

export function createVideoSourceV10(
	options: Record<string, unknown> = {},
	projectSampleRate = 48_000,
): Record<string, unknown> {
	const sampleRate = boundedSampleRate(options.sampleRate ?? projectSampleRate);
	const sampleFrameCount = positiveSafeInteger(options.sampleFrameCount ?? options.frameCount, 'source.sampleFrameCount');
	const frameRate = rationalRate(options.frameRate ?? options.sourceFrameRate ?? DEFAULT_RATE, 'source.frameRate');
	const sourceFrameCount = positiveSafeInteger(
		options.sourceFrameCount ?? Math.max(1, sampleFrameToVideoFrame(
			sampleFrameCount,
			frameRate,
			sampleRate,
			'enclosingEnd',
		)),
		'source.sourceFrameCount',
	);
	const legacy = createVideoSourceV9({
		...options,
		frameCount: sampleFrameCount,
		frameRate: frameRate.num / frameRate.den,
	}, sampleRate);
	const timingAsset = options.timingAsset == null
		? null
		: normalizeVideoTimingAssetReference(options.timingAsset);
	const timingDecision = normalizeTimingDecision(options.timingDecision, frameRate);
	if (timingDecision.mode === 'exact' && timingAsset === null) {
		throw new RangeError('An exact video timing decision requires a timing asset.');
	}
	const result: Record<string, unknown> = {
		...clone(options),
		...legacy,
		kind: 'video',
		sampleFrameCount,
		frameRate,
		sourceFrameCount,
		timingAsset,
		timingDecision,
	};
	delete result.frameCount;
	return result;
}

export function createMediaSourceV10(
	options: Record<string, unknown> = {},
	projectSampleRate = 48_000,
): Record<string, unknown> {
	return options.kind === 'video'
		? createVideoSourceV10(options, projectSampleRate)
		: createAudioSourceV10(options);
}

export function createAudioClipV10(
	options: Record<string, unknown> = {},
	context?: Readonly<{ projectSampleRate: number; tempoMap: HoldTempoMap }>,
): Record<string, unknown> {
	const anchor = options.anchor === 'musical' ? 'musical' : 'sample';
	const musicalExtent = options.musicalExtent === 'beat' ? 'beat' : 'fixedSamples';
	const musicalStartBeat = anchor === 'musical'
		? coordinateRational(options.musicalStartBeat ?? 0, 'clip.musicalStartBeat')
		: null;
	const musicalDurationBeats = anchor === 'musical' && musicalExtent === 'beat'
		? positiveCoordinateRational(options.musicalDurationBeats, 'clip.musicalDurationBeats')
		: null;
	const derivedDuration = context && musicalStartBeat && musicalDurationBeats
		? beatToSampleFrame(addRational(musicalStartBeat, musicalDurationBeats), context.tempoMap, context.projectSampleRate)
			- beatToSampleFrame(musicalStartBeat, context.tempoMap, context.projectSampleRate)
		: 1;
	const legacy = createAudioClipV9({
		...options,
		timelineStartFrame: options.timelineStartFrame ?? 0,
		durationFrames: options.durationFrames ?? derivedDuration,
		sourceDurationFrames: options.sourceDurationFrames ?? options.durationFrames ?? derivedDuration,
	});
	const result: Record<string, unknown> = {
		...clone(options),
		...legacy,
		kind: 'audio',
		anchor,
		musicalStartBeat,
		musicalExtent,
		musicalDurationBeats,
		warpMap: normalizeBreakpoint(options.warpMap, 'audio-warp', 'clip.warpMap'),
	};
	if (anchor === 'musical') delete result.timelineStartFrame;
	if (anchor === 'musical' && musicalExtent === 'beat') delete result.durationFrames;
	return result;
}

export function createVideoClipV10(
	options: Record<string, unknown> = {},
	context: VideoClipV10Context,
): Record<string, unknown> {
	if (!context) throw new TypeError('Video clip normalization requires project, sequence, and source context.');
	const sampleRate = boundedSampleRate(context.projectSampleRate);
	const sequenceRate = rationalRate(context.sequence.rate, 'sequence.rate');
	const sourceRate = rationalRate(context.source.frameRate, 'source.frameRate');
	const legacyStart = nonNegativeSafeInteger(options.timelineStartFrame ?? 0, 'clip.timelineStartFrame');
	const legacyDuration = positiveSafeInteger(options.durationFrames ?? 1, 'clip.durationFrames');
	const sequenceStartFrame = nonNegativeSafeInteger(
		options.sequenceStartFrame ?? sampleFrameToVideoFrame(legacyStart, sequenceRate, sampleRate, 'point'),
		'clip.sequenceStartFrame',
	);
	const legacyEnd = safeAdd(legacyStart, legacyDuration, 'clip timeline range');
	const sequenceFrameCount = positiveSafeInteger(options.sequenceFrameCount ?? Math.max(1,
		sampleFrameToVideoFrame(legacyEnd, sequenceRate, sampleRate, 'point') - sequenceStartFrame,
	), 'clip.sequenceFrameCount');
	const legacySourceStart = nonNegativeSafeInteger(options.sourceStartFrame ?? 0, 'clip.sourceStartFrame');
	const legacySourceDuration = positiveSafeInteger(options.sourceDurationFrames ?? legacyDuration, 'clip.sourceDurationFrames');
	const sourceInFrame = nonNegativeSafeInteger(
		options.sourceInFrame ?? sampleFrameToVideoFrame(legacySourceStart, sourceRate, sampleRate, 'point'),
		'clip.sourceInFrame',
	);
	const sourceFrameCount = positiveSafeInteger(options.sourceFrameCount ?? Math.max(1,
		sampleFrameToVideoFrame(safeAdd(legacySourceStart, legacySourceDuration, 'clip source range'), sourceRate, sampleRate, 'point')
			- sourceInFrame,
	), 'clip.sourceFrameCount');
	const resolved = videoFrameRangeToSampleRange(sequenceStartFrame, sequenceFrameCount, sequenceRate, sampleRate);
	const sourceResolved = videoFrameRangeToSampleRange(sourceInFrame, sourceFrameCount, sourceRate, sampleRate);
	const legacy = createVideoClipV9({
		...options,
		timelineStartFrame: resolved.startFrame,
		durationFrames: resolved.durationFrames,
		sourceStartFrame: sourceResolved.startFrame,
		sourceDurationFrames: sourceResolved.durationFrames,
	});
	const result: Record<string, unknown> = {
		...clone(options),
		...legacy,
		kind: 'video',
		sequenceId: nonEmptyString(options.sequenceId ?? context.sequence.id, 'clip.sequenceId'),
		sequenceStartFrame,
		sequenceFrameCount,
		sourceInFrame,
		sourceFrameCount,
		retimeMap: normalizeBreakpoint(options.retimeMap, 'video-retime', 'clip.retimeMap'),
	};
	for (const name of ['timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames']) delete result[name];
	return result;
}

export function createMediaClipV10(
	options: Record<string, unknown>,
	context: VideoClipV10Context & { readonly tempoMap: HoldTempoMap },
): Record<string, unknown> {
	return options.kind === 'video'
		? createVideoClipV10(options, context)
		: createAudioClipV10(options, context);
}

export function createAudioTrackV10(options: Record<string, unknown> = {}, projectSampleRate = 48_000): Record<string, unknown> {
	return { ...clone(options), ...createAudioTrackV9(options, projectSampleRate), type: 'audio' };
}

export function createVideoTrackV10(options: Record<string, unknown> = {}): Record<string, unknown> {
	return { ...clone(options), ...createVideoTrackV9(options), type: 'video' };
}

export function createLabelTrackV10(options: Record<string, unknown> = {}): Record<string, unknown> {
	const legacy = createLabelTrackV9(options);
	const labels = (Array.isArray(options.labels) ? options.labels : []).map((value) => normalizeLabel(object(value, 'label')));
	return { ...clone(options), ...legacy, type: 'label', labels };
}

export function createLabelV10(options: Record<string, unknown> = {}): Record<string, unknown> {
	return normalizeLabel(options.anchor === 'musical'
		? options
		: createLabelV2(options) as Record<string, unknown>);
}

export function createMediaTrackV10(options: Record<string, unknown> = {}, projectSampleRate = 48_000): Record<string, unknown> {
	if (options.type === 'video') return createVideoTrackV10(options);
	if (options.type === 'label') return createLabelTrackV10(options);
	return createAudioTrackV10(options, projectSampleRate);
}

export function createAudioEditorProjectV10(options: AudioEditorProjectV10Options = {}): AudioEditorProjectV10 {
	const input = options as Record<string, unknown>;
	const sampleRate = boundedSampleRate(input.sampleRate ?? 48_000);
	const base = createAudioEditorProjectV9({
		...options,
		sampleRate,
		sources: [],
		clips: [],
		tracks: [],
		projectBin: { ...(objectOrEmpty(input.projectBin)), clips: [] },
		featureRequirements: { schemaVersion: PROJECT_FEATURE_REQUIREMENTS_SCHEMA_VERSION, requirements: [] },
	});
	const sources = arrayOr(input.sources, base.sources).map((value) => createMediaSourceV10(object(value, 'source'), sampleRate));
	const tracks = arrayOr(input.tracks, base.tracks).map((value) => createMediaTrackV10(object(value, 'track'), sampleRate));
	const primarySequenceId = nonEmptyString(input.primarySequenceId ?? DEFAULT_SEQUENCE_ID, 'project.primarySequenceId');
	const sequences = normalizeSequences(input.sequences, primarySequenceId, tracks.map(({ id }) => String(id)));
	const tempoMap = normalizeTempoMap(input.tempoMap, base, sampleRate);
	const signatureMap = normalizeSignatureMap(input.signatureMap, base);
	const firstTempo = tempoMap.events[0];
	const firstSignature = (signatureMap.events as readonly Record<string, unknown>[])[0];
	const tempo = {
		...object(base.tempo, 'project.tempo'),
		bpm: firstTempo.bpm.num / firstTempo.bpm.den,
		timeSignature: { numerator: firstSignature.numerator, denominator: firstSignature.denominator },
	};
	const sourceById = new Map(sources.map((source) => [String(source.id), source]));
	const sequenceById = new Map(sequences.map((sequence) => [String(sequence.id), sequence]));
	const contextFor = (clip: Record<string, unknown>) => clipContext(
		clip,
		sampleRate,
		tempoMap,
		sourceById,
		sequenceById,
		primarySequenceId,
	);
	const clips = arrayOr(input.clips, base.clips).map((value) => {
		const clip = object(value, 'clip');
		return createMediaClipV10(clip, contextFor(clip));
	});
	const projectBinInput = objectOrEmpty(input.projectBin);
	const binClips = arrayOr(projectBinInput.clips, []).map((value) => {
		const clip = object(value, 'projectBin clip');
		return { ...createMediaClipV10(clip, contextFor(clip)), binItemId: clip.binItemId || clip.id };
	});
	const graph = { sources, clips, tracks };
	const featureRequirements = normalizeProjectFeatureRequirements(
		input.featureRequirements ?? base.featureRequirements,
		{ ...graph, schemaVersion: AUDIO_EDITOR_PROJECT_V10_SCHEMA_VERSION, sampleRate, sequences, primarySequenceId },
	);
	const project = {
		...base,
		schemaVersion: AUDIO_EDITOR_PROJECT_V10_SCHEMA_VERSION,
		sampleRate,
		sources,
		clips,
		tracks,
		projectBin: { ...clone(projectBinInput), clips: binClips },
		sequences,
		primarySequenceId,
		tempo,
		tempoMap,
		signatureMap,
		featureRequirements,
	} as unknown as AudioEditorProjectV10;
	const reconciled = {
		...project,
		featureRequirements: reconcileProjectOwnedFeatureRequirements(project, featureRequirements),
	} as AudioEditorProjectV10;
	return reconciled;
}

export function cloneAudioEditorProjectV10(project: AudioEditorProjectV10): AudioEditorProjectV10 {
	return clone(project);
}

export function loadAudioEditorProjectV10(value: unknown): {
	project: AudioEditorProjectV10 | Record<string, unknown>;
	readOnly: boolean;
	reason: 'newer-schema' | null;
} {
	const candidate = object(value, 'saved project');
	const schemaVersion = Number(candidate.schemaVersion);
	if (schemaVersion > AUDIO_EDITOR_PROJECT_V10_SCHEMA_VERSION) {
		return { project: clone(candidate), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV10(candidate);
	return { project: clone(candidate) as AudioEditorProjectV10, readOnly: false, reason: null };
}

function normalizeSequences(
	value: unknown,
	primarySequenceId: string,
	trackIds: readonly string[],
): readonly Record<string, unknown>[] {
	const values = Array.isArray(value) && value.length ? value : [{ id: primarySequenceId }];
	return values.map((item, index) => {
		const sequence = object(item, `sequence[${String(index)}]`);
		const id = nonEmptyString(sequence.id ?? (index ? createStableId('sequence') : primarySequenceId), 'sequence.id');
		const assignedTrackIds = Array.isArray(sequence.trackIds)
			? uniqueStrings(sequence.trackIds, 'sequence.trackIds')
			: id === primarySequenceId ? [...trackIds] : [];
		return {
			...clone(sequence),
			id,
			name: nonEmptyString(sequence.name ?? (id === primarySequenceId ? 'Main sequence' : 'Sequence'), 'sequence.name'),
			rate: rationalRate(sequence.rate ?? DEFAULT_RATE, 'sequence.rate'),
			dropFrame: Boolean(sequence.dropFrame),
			startTimecode: normalizeTimecode(sequence.startTimecode),
			trackIds: assignedTrackIds,
		};
	});
}

function normalizeTempoMap(
	value: unknown,
	base: Record<string, unknown>,
	sampleRate: number,
): HoldTempoMap & Record<string, unknown> {
	const legacyTempo = object(base.tempo, 'project.tempo');
	const map = value == null ? {} : object(value, 'project.tempoMap');
	assertHoldTempoMapWireKeys(map);
	const mode = map.mode === 'sampleLocked' ? 'sampleLocked' : 'musical';
	const rawEvents = Array.isArray(map.events) && map.events.length
		? map.events
		: [{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: legacyTempo.bpm }];
	const events = rawEvents.map((item, index) => {
		const event = object(item, `tempoMap.events[${String(index)}]`);
		const bpm = positiveRational(event.bpm ?? legacyTempo.bpm, 'tempo event bpm');
		if (index === 0 && compareRationals(bpm, 1) < 0) {
			throw new RangeError('The root tempo event cannot be below 1 BPM.');
		}
		const normalized: Record<string, unknown> = {
			...clone(event),
			id: nonEmptyString(event.id ?? `tempo-${String(index + 1)}`, 'tempo event ID'),
			beat: coordinateRational(event.beat ?? 0, 'tempo event beat'),
			bpm,
		};
		if (mode === 'sampleLocked') normalized.samplePosition = nonNegativeSafeInteger(event.samplePosition ?? 0, 'tempo event samplePosition');
		else delete normalized.samplePosition;
		return normalized;
	});
	const result = { ...clone(map), mode, events } as unknown as HoldTempoMap & Record<string, unknown>;
	if (mode === 'sampleLocked') validateSampleLockedTempoBeatAuthority(result, sampleRate);
	validateTempoInverseRationalClosure(result, sampleRate);
	return result;
}

function normalizeSignatureMap(value: unknown, base: Record<string, unknown>): Record<string, unknown> {
	const legacyTempo = object(base.tempo, 'project.tempo');
	const legacySignature = object(legacyTempo.timeSignature, 'project.tempo.timeSignature');
	const map = value == null ? {} : object(value, 'project.signatureMap');
	const rawEvents = Array.isArray(map.events) && map.events.length ? map.events : [{
		id: 'signature-1', bar: 0,
		numerator: legacySignature.numerator,
		denominator: legacySignature.denominator,
	}];
	return {
		...clone(map),
		events: rawEvents.map((item, index) => {
			const event = object(item, `signatureMap.events[${String(index)}]`);
			return {
				...clone(event),
				id: nonEmptyString(event.id ?? `signature-${String(index + 1)}`, 'signature event ID'),
				bar: nonNegativeSafeInteger(event.bar ?? 0, 'signature event bar'),
				numerator: positiveSafeInteger(event.numerator, 'signature event numerator'),
				denominator: positiveSafeInteger(event.denominator, 'signature event denominator'),
			};
		}),
	};
}

function clipContext(
	clip: Record<string, unknown>,
	projectSampleRate: number,
	tempoMap: HoldTempoMap,
	sourceById: ReadonlyMap<string, Record<string, unknown>>,
	sequenceById: ReadonlyMap<string, Record<string, unknown>>,
	primarySequenceId: string,
): VideoClipV10Context & { tempoMap: HoldTempoMap } {
	const source = sourceById.get(String(clip.sourceId));
	if (!source) throw new ReferenceError(`Clip ${String(clip.id)} references a missing source.`);
	const sequenceId = String(clip.sequenceId ?? primarySequenceId);
	const sequence = sequenceById.get(sequenceId);
	if (!sequence) throw new ReferenceError(`Clip ${String(clip.id)} references a missing sequence.`);
	return { projectSampleRate, tempoMap, source, sequence };
}

function normalizeLabel(value: Record<string, unknown>): Record<string, unknown> {
	const anchor = value.anchor === 'musical' ? 'musical' : 'sample';
	const result: Record<string, unknown> = {
		...clone(value),
		id: nonEmptyString(value.id ?? createStableId('label'), 'label.id'),
		anchor,
		startBeat: anchor === 'musical' ? coordinateRational(value.startBeat ?? 0, 'label.startBeat') : null,
		endBeat: anchor === 'musical' ? coordinateRational(value.endBeat ?? value.startBeat ?? 0, 'label.endBeat') : null,
	};
	if (anchor === 'musical') {
		delete result.startFrame;
		delete result.endFrame;
	}
	return result;
}

function normalizeTimingDecision(value: unknown, fallbackRate: RationalRate): Record<string, unknown> {
	const decision = value == null ? {} : object(value, 'source.timingDecision');
	const mode = decision.mode === 'exact' ? 'exact' : 'conform-cfr-at-ingest';
	return {
		...clone(decision),
		mode,
		rate: rationalRate(decision.rate ?? fallbackRate, 'source.timingDecision.rate'),
	};
}

function normalizeBreakpoint(value: unknown, feature: BreakpointMap['feature'], name: string): BreakpointMap | null {
	if (value == null) return null;
	const map = clone(object(value, name)) as unknown as BreakpointMap;
	if (map.feature !== feature) throw new RangeError(`${name} has the wrong feature.`);
	validateBreakpointMap(map);
	return map;
}

function normalizeTimecode(value: unknown): Record<string, unknown> {
	const input = value == null ? DEFAULT_TIMECODE : object(value, 'sequence.startTimecode');
	return {
		negative: Boolean(input.negative),
		hours: nonNegativeSafeInteger(input.hours ?? 0, 'timecode.hours'),
		minutes: nonNegativeSafeInteger(input.minutes ?? 0, 'timecode.minutes'),
		seconds: nonNegativeSafeInteger(input.seconds ?? 0, 'timecode.seconds'),
		frames: nonNegativeSafeInteger(input.frames ?? 0, 'timecode.frames'),
	};
}

function rational(value: RationalInput | unknown, name: string): Rational {
	if (typeof value !== 'number' && (!value || typeof value !== 'object' || Array.isArray(value))) {
		throw new TypeError(`${name} must be rational.`);
	}
	return normalizeRational(value as RationalInput);
}

function positiveRational(value: RationalInput | unknown, name: string): Rational {
	const result = rational(value, name);
	if (result.num <= 0 || result.den <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function coordinateRational(value: RationalInput | unknown, name: string): Rational {
	if (typeof value !== 'number' && (!value || typeof value !== 'object' || Array.isArray(value))) {
		throw new TypeError(`${name} must be rational.`);
	}
	return normalizeRational(value as RationalInput, {
		maximumDenominator: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR,
	});
}

function positiveCoordinateRational(value: RationalInput | unknown, name: string): Rational {
	const result = coordinateRational(value, name);
	if (result.num <= 0 || result.den <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function rationalRate(value: unknown, name: string): RationalRate {
	const result = positiveRational(value, name);
	return { num: result.num, den: result.den };
}

function addRational(left: Rational, right: Rational): Rational {
	return addRationals(left, right);
}

function boundedSampleRate(value: unknown): number {
	const result = positiveSafeInteger(value, 'project.sampleRate');
	if (result < AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE || result > AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE) {
		throw new RangeError(`project.sampleRate must be between ${String(AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE)} and ${String(AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE)}.`);
	}
	return result;
}

function object(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
	return value == null ? {} : object(value, 'project.projectBin');
}

function arrayOr(value: unknown, fallback: readonly unknown[]): readonly unknown[] {
	if (value == null) return fallback;
	if (!Array.isArray(value)) throw new TypeError('A project collection must be an array.');
	return value;
}

function uniqueStrings(value: readonly unknown[], name: string): string[] {
	const result = value.map((item) => nonEmptyString(item, name));
	if (new Set(result).size !== result.length) throw new RangeError(`${name} cannot contain duplicates.`);
	return result;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
