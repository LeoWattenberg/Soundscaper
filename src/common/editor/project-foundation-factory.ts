/* SPDX-License-Identifier: AGPL-3.0-only */

import { createProjectDocumentBase } from './project-document-base-factory.ts';
import {
	AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR,
	AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE,
	AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE,
} from './project-foundation-validation.ts';
import {
	createMediaClip,
	createMediaSource,
	createMediaTrack,
} from './project-media-factory.ts';
import {
	PROJECT_FEATURE_REQUIREMENTS_SCHEMA_VERSION,
	normalizeProjectFeatureRequirements,
} from './project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
import { createStableId } from './stable-id.js';
import {
	compareRationals,
	normalizeRational,
	type HoldTempoMap,
	type Rational,
	type RationalInput,
	type RationalRate,
} from './timeline-time.ts';
import {
	validateSampleLockedTempoBeatAuthority,
	validateTempoInverseRationalClosure,
} from './timeline-tempo-inverse.ts';
import { assertHoldTempoMapWireKeys } from './musical-map-contract.ts';

type DataRecord = Record<string, unknown>;

export interface ProjectFoundationOptions extends Readonly<Record<string, unknown>> {
	readonly sources?: readonly Readonly<Record<string, unknown>>[];
	readonly clips?: readonly Readonly<Record<string, unknown>>[];
	readonly tracks?: readonly Readonly<Record<string, unknown>>[];
	readonly projectBin?: Readonly<Record<string, unknown>>;
	readonly sequences?: readonly Readonly<Record<string, unknown>>[];
	readonly primarySequenceId?: string;
	readonly tempoMap?: unknown;
	readonly signatureMap?: unknown;
	readonly featureRequirements?: unknown;
}

const DEFAULT_SEQUENCE_ID = 'main-sequence';
const DEFAULT_RATE = Object.freeze({ num: 30, den: 1 });
const DEFAULT_TIMECODE = Object.freeze({ negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 });

/**
 * Assemble the active media/timing foundation directly, without manufacturing
 * any retired pre-release project generation along the way.
 */
export function createProjectFoundation(
	options: ProjectFoundationOptions = {},
): DataRecord {
	const input = options as Readonly<DataRecord>;
	const base = createProjectDocumentBase(options);
	const sampleRate = boundedSampleRate(base.sampleRate);
	const sources = arrayOr(input.sources, []).map((value) => (
		createMediaSource(dataRecord(value, 'source'), sampleRate)
	));
	const tracks = arrayOr(input.tracks, []).map((value) => (
		createMediaTrack(dataRecord(value, 'track'), sampleRate)
	));
	const primarySequenceId = nonEmptyString(
		input.primarySequenceId ?? DEFAULT_SEQUENCE_ID,
		'project.primarySequenceId',
	);
	const sequences = normalizeSequences(input.sequences, primarySequenceId, tracks.map(({ id }) => String(id)));
	const tempoMap = normalizeTempoMap(input.tempoMap, base, sampleRate);
	const signatureMap = normalizeSignatureMap(input.signatureMap, base);
	const firstTempo = tempoMap.events[0];
	const signatureEvents = signatureMap.events as readonly DataRecord[];
	const rootSignature = signatureEvents[0];
	if (!firstTempo || !rootSignature) throw new RangeError('Project timing maps require root events.');
	const tempo = {
		...dataRecord(base.tempo, 'project.tempo'),
		bpm: firstTempo.bpm.num / firstTempo.bpm.den,
		timeSignature: {
			numerator: rootSignature.numerator,
			denominator: rootSignature.denominator,
		},
	};
	const sourceById = new Map(sources.map((source) => [String(source.id), source]));
	const sequenceById = new Map(sequences.map((sequence) => [String(sequence.id), sequence]));
	const contextFor = (clip: DataRecord) => clipContext(
		clip,
		sampleRate,
		tempoMap,
		sourceById,
		sequenceById,
		primarySequenceId,
	);
	const clips = arrayOr(input.clips, []).map((value) => {
		const clip = dataRecord(value, 'clip');
		return createMediaClip(clip, contextFor(clip));
	});
	const projectBinInput = input.projectBin == null
		? {}
		: dataRecord(input.projectBin, 'project.projectBin');
	const binClips = arrayOr(projectBinInput.clips, []).map((value) => {
		const clip = dataRecord(value, 'projectBin clip');
		return { ...createMediaClip(clip, contextFor(clip)), binItemId: clip.binItemId || clip.id };
	});
	const graph = { sources, clips, tracks };
	const featureRequirements = normalizeProjectFeatureRequirements(
		input.featureRequirements ?? {
			schemaVersion: PROJECT_FEATURE_REQUIREMENTS_SCHEMA_VERSION,
			requirements: [],
		},
		{
			...graph,
			schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
			sampleRate,
			sequences,
			primarySequenceId,
		},
	);
	const project: DataRecord = {
		...base,
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		sampleRate,
		sources,
		clips,
		tracks,
		projectBin: { ...clone(projectBinInput), clips: binClips },
		featureRequirements,
		sequences,
		primarySequenceId,
		tempo,
		tempoMap,
		signatureMap,
	};
	project.featureRequirements = reconcileProjectOwnedFeatureRequirements(project, featureRequirements);
	return project;
}

function normalizeSequences(
	value: unknown,
	primarySequenceId: string,
	trackIds: readonly string[],
): readonly DataRecord[] {
	const values = Array.isArray(value) && value.length ? value : [{ id: primarySequenceId }];
	return values.map((item, index) => {
		const sequence = dataRecord(item, `sequence[${String(index)}]`);
		const id = nonEmptyString(
			sequence.id ?? (index ? createStableId('sequence') : primarySequenceId),
			'sequence.id',
		);
		const assignedTrackIds = Array.isArray(sequence.trackIds)
			? uniqueStrings(sequence.trackIds, 'sequence.trackIds')
			: id === primarySequenceId ? [...trackIds] : [];
		return {
			...clone(sequence),
			id,
			name: nonEmptyString(
				sequence.name ?? (id === primarySequenceId ? 'Main sequence' : 'Sequence'),
				'sequence.name',
			),
			rate: rationalRate(sequence.rate ?? DEFAULT_RATE, 'sequence.rate'),
			dropFrame: Boolean(sequence.dropFrame),
			startTimecode: normalizeTimecode(sequence.startTimecode),
			trackIds: assignedTrackIds,
		};
	});
}

function normalizeTempoMap(
	value: unknown,
	base: DataRecord,
	sampleRate: number,
): HoldTempoMap & DataRecord {
	const legacyTempo = dataRecord(base.tempo, 'project.tempo');
	const map = value == null ? {} : dataRecord(value, 'project.tempoMap');
	assertHoldTempoMapWireKeys(map);
	const mode = map.mode === 'sampleLocked' ? 'sampleLocked' : 'musical';
	const rawEvents = Array.isArray(map.events) && map.events.length
		? map.events
		: [{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: legacyTempo.bpm }];
	const events = rawEvents.map((item, index) => {
		const event = dataRecord(item, `tempoMap.events[${String(index)}]`);
		const bpm = positiveRational(event.bpm ?? legacyTempo.bpm, 'tempo event bpm');
		if (index === 0 && compareRationals(bpm, 1) < 0) {
			throw new RangeError('The root tempo event cannot be below 1 BPM.');
		}
		const normalized: DataRecord = {
			...clone(event),
			id: nonEmptyString(event.id ?? `tempo-${String(index + 1)}`, 'tempo event ID'),
			beat: coordinateRational(event.beat ?? 0, 'tempo event beat'),
			bpm,
		};
		if (mode === 'sampleLocked') {
			normalized.samplePosition = nonNegativeSafeInteger(
				event.samplePosition ?? 0,
				'tempo event samplePosition',
			);
		} else delete normalized.samplePosition;
		return normalized;
	});
	const result = { ...clone(map), mode, events } as unknown as HoldTempoMap & DataRecord;
	if (mode === 'sampleLocked') validateSampleLockedTempoBeatAuthority(result, sampleRate);
	validateTempoInverseRationalClosure(result, sampleRate);
	return result;
}

function normalizeSignatureMap(value: unknown, base: DataRecord): DataRecord {
	const legacyTempo = dataRecord(base.tempo, 'project.tempo');
	const legacySignature = dataRecord(legacyTempo.timeSignature, 'project.tempo.timeSignature');
	const map = value == null ? {} : dataRecord(value, 'project.signatureMap');
	const rawEvents = Array.isArray(map.events) && map.events.length ? map.events : [{
		id: 'signature-1',
		bar: 0,
		numerator: legacySignature.numerator,
		denominator: legacySignature.denominator,
	}];
	return {
		...clone(map),
		events: rawEvents.map((item, index) => {
			const event = dataRecord(item, `signatureMap.events[${String(index)}]`);
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
	clip: DataRecord,
	projectSampleRate: number,
	tempoMap: HoldTempoMap,
	sourceById: ReadonlyMap<string, DataRecord>,
	sequenceById: ReadonlyMap<string, DataRecord>,
	primarySequenceId: string,
): Readonly<{
	projectSampleRate: number;
	tempoMap: HoldTempoMap;
	source: DataRecord;
	sequence: DataRecord;
}> {
	const source = sourceById.get(String(clip.sourceId));
	if (!source) throw new ReferenceError(`Clip ${String(clip.id)} references a missing source.`);
	const sequenceId = String(clip.sequenceId ?? primarySequenceId);
	const sequence = sequenceById.get(sequenceId);
	if (!sequence) throw new ReferenceError(`Clip ${String(clip.id)} references a missing sequence.`);
	return { projectSampleRate, tempoMap, source, sequence };
}

function normalizeTimecode(value: unknown): DataRecord {
	const input = value == null ? DEFAULT_TIMECODE : dataRecord(value, 'sequence.startTimecode');
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

function rationalRate(value: unknown, name: string): RationalRate {
	const result = positiveRational(value, name);
	return { num: result.num, den: result.den };
}

function boundedSampleRate(value: unknown): number {
	const result = positiveSafeInteger(value, 'project.sampleRate');
	if (result < AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE
		|| result > AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE) {
		throw new RangeError(
			`project.sampleRate must be between ${String(AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE)} and ${String(AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE)}.`,
		);
	}
	return result;
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

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
