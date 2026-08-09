/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	deriveSampleLockedTempoEventBeats,
	validateTempoInverseRationalClosure,
} from '../timeline-tempo-inverse.ts';
import {
	beatToSampleFrame,
	compareRationals,
	normalizeRational,
	type HoldTempoMap,
	type Rational,
} from '../timeline-time.ts';
import { defineTempoSignatureCommandHandlers } from './tempo-signature.ts';
import type {
	EditorCommandProject,
	SignatureEventCommandChanges,
	SignatureEventCommandValue,
	TempoEventCommandChanges,
	TempoEventCommandValue,
	TempoMapMode,
} from './protocol.ts';

const MAXIMUM_TEMPO_EVENTS = 4_096;
const MAXIMUM_BPM_DENOMINATOR = 1_000_000;

type DataRecord = Record<string, unknown>;

interface TempoEventRecord extends DataRecord {
	id: string;
	beat: Rational;
	bpm: Rational;
	samplePosition?: number;
}

interface SignatureEventRecord extends DataRecord {
	id: string;
	bar: number;
	numerator: number;
	denominator: number;
}

interface TempoMapRecord extends DataRecord {
	mode: TempoMapMode;
	events: TempoEventRecord[];
}

interface SignatureMapRecord extends DataRecord {
	events: SignatureEventRecord[];
}

export function createTempoSignatureRuntimeHandlers() {
	return defineTempoSignatureCommandHandlers({
		'tempo/set': (project, command) => setLegacyTempo(record(project), command),
		'tempo-map/mode-set': (project, command) => setTempoMapMode(record(project), command.mode),
		'tempo-event/add': (project, command) => addTempoEvent(record(project), command.event),
		'tempo-event/update': (project, command) => updateTempoEvent(
			record(project),
			stableId(command.eventId, 'tempo event ID'),
			command.changes,
		),
		'tempo-event/remove': (project, command) => removeTempoEvent(
			record(project),
			stableId(command.eventId, 'tempo event ID'),
		),
		'signature-event/add': (project, command) => addSignatureEvent(record(project), command.event),
		'signature-event/update': (project, command) => updateSignatureEvent(
			record(project),
			stableId(command.eventId, 'signature event ID'),
			command.changes,
		),
		'signature-event/remove': (project, command) => removeSignatureEvent(
			record(project),
			stableId(command.eventId, 'signature event ID'),
		),
	});
}

function setLegacyTempo(
	project: DataRecord,
	command: Readonly<{ bpm?: number; numerator?: number; denominator?: number }>,
): void {
	const legacy = legacyTempo(project);
	const bpm = command.bpm == null ? legacy.bpm : Number(command.bpm);
	if (!Number.isFinite(bpm) || bpm < 1 || bpm > 1_000) {
		throw new RangeError('tempo.bpm must be between 1 and 1000.');
	}
	const numerator = command.numerator == null
		? legacy.timeSignature.numerator
		: Number(command.numerator);
	const denominator = command.denominator == null
		? legacy.timeSignature.denominator
		: Number(command.denominator);
	validateLegacySignatureValues(numerator, denominator);

	if (!hasAuthoritativeMaps(project)) {
		project.tempo = { bpm, timeSignature: { numerator, denominator }, detected: false };
		return;
	}
	const tempoMap = requireTempoMap(project);
	const signatureMap = requireSignatureMap(project);
	if (command.bpm != null) {
		tempoMap.events[0] = { ...tempoMap.events[0], bpm: exactRational(
			normalizeRational(bpm),
			'tempo.bpm',
			true,
			MAXIMUM_BPM_DENOMINATOR,
		) };
		if (tempoMap.mode === 'sampleLocked') deriveSampleLockedBeats(project, tempoMap);
	}
	if (command.numerator != null || command.denominator != null) {
		signatureMap.events[0] = {
			...signatureMap.events[0],
			numerator,
			denominator,
		};
	}
	syncLegacyTempo(project, tempoMap, signatureMap);
}

function setTempoMapMode(project: DataRecord, mode: TempoMapMode): void {
	if (mode !== 'musical' && mode !== 'sampleLocked') throw new RangeError('tempoMap.mode is unsupported.');
	const tempoMap = requireTempoMap(project);
	if (tempoMap.mode === mode) return;
	if (mode === 'sampleLocked') {
		const musicalMap = tempoMap as HoldTempoMap;
		const sampleRate = projectSampleRate(project);
		const events = tempoMap.events.map((event) => ({
			...event,
			samplePosition: beatToSampleFrame(event.beat, musicalMap, sampleRate),
		}));
		assertStrictSamplePositions(events);
		tempoMap.mode = mode;
		tempoMap.events = events;
		deriveSampleLockedBeats(project, tempoMap);
	} else {
		tempoMap.mode = mode;
		tempoMap.events = tempoMap.events.map(({ samplePosition: _samplePosition, ...event }) => event as TempoEventRecord);
	}
	syncLegacyTempo(project, tempoMap, requireSignatureMap(project));
}

function addTempoEvent(project: DataRecord, value: TempoEventCommandValue): void {
	const tempoMap = requireTempoMap(project);
	if (tempoMap.events.length >= MAXIMUM_TEMPO_EVENTS) {
		throw new RangeError(`tempoMap.events cannot exceed ${String(MAXIMUM_TEMPO_EVENTS)} events.`);
	}
	const input = commandRecord(value, 'tempo event');
	assertOnlyKeys(input, ['id', 'beat', 'bpm', 'samplePosition'], 'tempo event');
	const id = stableId(input.id, 'tempo event ID');
	assertUnusedEventId(tempoMap.events, id, 'tempo');
	const bpm = tempoBpm(input.bpm, 'tempo event bpm');
	if (tempoMap.mode === 'sampleLocked') {
		if (Object.hasOwn(input, 'beat')) throw new RangeError('A sample-locked tempo event cannot set a beat coordinate.');
		const samplePosition = nonNegativeSafeInteger(input.samplePosition, 'tempo event samplePosition');
		assertUnusedSamplePosition(tempoMap.events, samplePosition);
		tempoMap.events = [...tempoMap.events, {
			id, bpm, beat: { num: 0, den: 1 }, samplePosition,
		}].sort(compareTempoSamples);
		assertRootSamplePosition(tempoMap.events);
		deriveSampleLockedBeats(project, tempoMap);
	} else {
		if (Object.hasOwn(input, 'samplePosition')) {
			throw new RangeError('A musical tempo event cannot set a samplePosition.');
		}
		const beat = tempoBeat(input.beat, 'tempo event beat');
		assertUnusedBeat(tempoMap.events, beat);
		tempoMap.events = [...tempoMap.events, { id, beat, bpm }].sort(compareTempoBeats);
		assertRootBeat(tempoMap.events);
		validateTempoInverseRationalClosure(tempoMap as HoldTempoMap, projectSampleRate(project));
	}
	syncLegacyTempo(project, tempoMap, requireSignatureMap(project));
}

function updateTempoEvent(project: DataRecord, eventId: string, value: TempoEventCommandChanges): void {
	const tempoMap = requireTempoMap(project);
	const changes = commandRecord(value, 'tempo event changes');
	assertOnlyKeys(changes, ['beat', 'bpm', 'samplePosition'], 'tempo event changes');
	assertNonEmpty(changes, 'tempo event changes');
	const index = requireEventIndex(tempoMap.events, eventId, 'tempo');
	const current = tempoMap.events[index];
	const bpm = Object.hasOwn(changes, 'bpm') ? tempoBpm(changes.bpm, 'tempo event bpm') : current.bpm;
	if (index === 0 && compareRationals(bpm, 1) < 0) {
		throw new RangeError('The root tempo event cannot be below 1 BPM.');
	}
	if (tempoMap.mode === 'sampleLocked') {
		if (Object.hasOwn(changes, 'beat')) throw new RangeError('A sample-locked tempo event cannot update its beat coordinate.');
		const samplePosition = Object.hasOwn(changes, 'samplePosition')
			? nonNegativeSafeInteger(changes.samplePosition, 'tempo event samplePosition')
			: nonNegativeSafeInteger(current.samplePosition, 'tempo event samplePosition');
		assertUnusedSamplePosition(tempoMap.events, samplePosition, eventId);
		tempoMap.events[index] = { ...current, bpm, samplePosition };
		tempoMap.events.sort(compareTempoSamples);
		assertRootSamplePosition(tempoMap.events);
		deriveSampleLockedBeats(project, tempoMap);
	} else {
		if (Object.hasOwn(changes, 'samplePosition')) {
			throw new RangeError('A musical tempo event cannot update a samplePosition.');
		}
		const beat = Object.hasOwn(changes, 'beat') ? tempoBeat(changes.beat, 'tempo event beat') : current.beat;
		assertUnusedBeat(tempoMap.events, beat, eventId);
		tempoMap.events[index] = { ...current, beat, bpm };
		tempoMap.events.sort(compareTempoBeats);
		assertRootBeat(tempoMap.events);
		validateTempoInverseRationalClosure(tempoMap as HoldTempoMap, projectSampleRate(project));
	}
	syncLegacyTempo(project, tempoMap, requireSignatureMap(project));
}

function removeTempoEvent(project: DataRecord, eventId: string): void {
	const tempoMap = requireTempoMap(project);
	const index = requireEventIndex(tempoMap.events, eventId, 'tempo');
	if (index === 0) throw new RangeError('The tempo event at beat zero cannot be removed.');
	tempoMap.events.splice(index, 1);
	if (tempoMap.mode === 'sampleLocked') deriveSampleLockedBeats(project, tempoMap);
	syncLegacyTempo(project, tempoMap, requireSignatureMap(project));
}

function addSignatureEvent(project: DataRecord, value: SignatureEventCommandValue): void {
	const signatureMap = requireSignatureMap(project);
	if (signatureMap.events.length >= MAXIMUM_TEMPO_EVENTS) {
		throw new RangeError(`signatureMap.events cannot exceed ${String(MAXIMUM_TEMPO_EVENTS)} events.`);
	}
	const input = commandRecord(value, 'signature event');
	assertOnlyKeys(input, ['id', 'bar', 'numerator', 'denominator'], 'signature event');
	const event = signatureEvent(input);
	assertUnusedEventId(signatureMap.events, event.id, 'signature');
	assertUnusedBar(signatureMap.events, event.bar);
	signatureMap.events = [...signatureMap.events, event].sort((left, right) => left.bar - right.bar);
	assertRootBar(signatureMap.events);
	syncLegacyTempo(project, requireTempoMap(project), signatureMap);
}

function updateSignatureEvent(project: DataRecord, eventId: string, value: SignatureEventCommandChanges): void {
	const signatureMap = requireSignatureMap(project);
	const changes = commandRecord(value, 'signature event changes');
	assertOnlyKeys(changes, ['bar', 'numerator', 'denominator'], 'signature event changes');
	assertNonEmpty(changes, 'signature event changes');
	const index = requireEventIndex(signatureMap.events, eventId, 'signature');
	const current = signatureMap.events[index];
	const bar = Object.hasOwn(changes, 'bar')
		? nonNegativeSafeInteger(changes.bar, 'signature event bar')
		: current.bar;
	const numerator = Object.hasOwn(changes, 'numerator') ? Number(changes.numerator) : current.numerator;
	const denominator = Object.hasOwn(changes, 'denominator') ? Number(changes.denominator) : current.denominator;
	validateSignatureValues(numerator, denominator, 'signature event');
	assertUnusedBar(signatureMap.events, bar, eventId);
	signatureMap.events[index] = { ...current, bar, numerator, denominator };
	signatureMap.events.sort((left, right) => left.bar - right.bar);
	assertRootBar(signatureMap.events);
	syncLegacyTempo(project, requireTempoMap(project), signatureMap);
}

function removeSignatureEvent(project: DataRecord, eventId: string): void {
	const signatureMap = requireSignatureMap(project);
	const index = requireEventIndex(signatureMap.events, eventId, 'signature');
	if (index === 0) throw new RangeError('The signature event at bar zero cannot be removed.');
	signatureMap.events.splice(index, 1);
	syncLegacyTempo(project, requireTempoMap(project), signatureMap);
}

function deriveSampleLockedBeats(project: DataRecord, tempoMap: TempoMapRecord): void {
	assertStrictSamplePositions(tempoMap.events);
	const sampleRate = projectSampleRate(project);
	const beats = deriveSampleLockedTempoEventBeats(tempoMap.events, sampleRate);
	tempoMap.events = tempoMap.events.map((event, index) => ({ ...event, beat: beats[index] }));
	validateTempoInverseRationalClosure(tempoMap as HoldTempoMap, sampleRate);
}

function syncLegacyTempo(
	project: DataRecord,
	tempoMap: TempoMapRecord,
	signatureMap: SignatureMapRecord,
): void {
	const tempoRoot = tempoMap.events[0];
	const signatureRoot = signatureMap.events[0];
	project.tempo = {
		bpm: tempoRoot.bpm.num / tempoRoot.bpm.den,
		timeSignature: {
			numerator: signatureRoot.numerator,
			denominator: signatureRoot.denominator,
		},
		detected: false,
	};
}

function requireTempoMap(project: DataRecord): TempoMapRecord {
	const map = commandRecord(project.tempoMap, 'project.tempoMap');
	if (map.mode !== 'musical' && map.mode !== 'sampleLocked') {
		throw new RangeError('Authoritative tempo-map commands require a hold-only tempo map.');
	}
	if (!Array.isArray(map.events) || !map.events.length) {
		throw new RangeError('Authoritative tempo-map commands require tempo events.');
	}
	return map as unknown as TempoMapRecord;
}

function requireSignatureMap(project: DataRecord): SignatureMapRecord {
	const map = commandRecord(project.signatureMap, 'project.signatureMap');
	if (!Array.isArray(map.events) || !map.events.length) {
		throw new RangeError('Authoritative signature-map commands require signature events.');
	}
	return map as unknown as SignatureMapRecord;
}

function hasAuthoritativeMaps(project: DataRecord): boolean {
	return isRecord(project.tempoMap) && Array.isArray(project.tempoMap.events)
		&& isRecord(project.signatureMap) && Array.isArray(project.signatureMap.events);
}

function legacyTempo(project: DataRecord): Readonly<{
	bpm: number;
	timeSignature: Readonly<{ numerator: number; denominator: number }>;
}> {
	const tempo = commandRecord(project.tempo, 'project.tempo');
	const timeSignature = commandRecord(tempo.timeSignature, 'project.tempo.timeSignature');
	return {
		bpm: Number(tempo.bpm),
		timeSignature: {
			numerator: Number(timeSignature.numerator),
			denominator: Number(timeSignature.denominator),
		},
	};
}

function signatureEvent(value: DataRecord): SignatureEventRecord {
	const id = stableId(value.id, 'signature event ID');
	const bar = nonNegativeSafeInteger(value.bar, 'signature event bar');
	const numerator = Number(value.numerator);
	const denominator = Number(value.denominator);
	validateSignatureValues(numerator, denominator, 'signature event');
	return { id, bar, numerator, denominator };
}

function validateSignatureValues(numerator: number, denominator: number, name: string): void {
	if (!Number.isSafeInteger(numerator) || numerator < 1 || numerator > 1_000) {
		throw new RangeError(`${name}.numerator must be between 1 and 1000.`);
	}
	if (!isPowerOfTwo(denominator)) {
		throw new RangeError(`${name}.denominator must be a positive safe power of two.`);
	}
}

function validateLegacySignatureValues(numerator: number, denominator: number): void {
	if (!Number.isSafeInteger(numerator) || numerator < 1 || numerator > 32) {
		throw new RangeError('tempo.timeSignature.numerator must be between 1 and 32.');
	}
	if (!isPowerOfTwo(denominator) || denominator > 32) {
		throw new RangeError('tempo.timeSignature.denominator must be a power of two up to 32.');
	}
}

function tempoBeat(value: unknown, name: string): Rational {
	return exactRational(value, name, false, Number.MAX_SAFE_INTEGER);
}

function tempoBpm(value: unknown, name: string): Rational {
	const bpm = exactRational(value, name, true, MAXIMUM_BPM_DENOMINATOR);
	if (bpm.num / bpm.den > 1_000) throw new RangeError(`${name} cannot exceed 1000 BPM.`);
	return bpm;
}

function exactRational(
	value: unknown,
	name: string,
	positive: boolean,
	maximumDenominator: number,
): Rational {
	if (!isRecord(value)) throw new TypeError(`${name} must be an exact rational object.`);
	assertOnlyKeys(value, ['num', 'den'], name);
	if (!Number.isSafeInteger(value.num) || Number(value.num) < (positive ? 1 : 0)) {
		throw new RangeError(`${name}.num must be a ${positive ? 'positive' : 'non-negative'} safe integer.`);
	}
	if (!Number.isSafeInteger(value.den) || Number(value.den) <= 0) {
		throw new RangeError(`${name}.den must be a positive safe integer.`);
	}
	return normalizeRational(
		{ num: Number(value.num), den: Number(value.den) },
		{ maximumDenominator },
	);
}

function assertUnusedEventId(events: readonly DataRecord[], id: string, name: string): void {
	if (events.some((event) => event.id === id)) throw new RangeError(`${name} event ID ${id} already exists.`);
}

function assertUnusedBeat(events: readonly TempoEventRecord[], beat: Rational, exceptId?: string): void {
	if (events.some((event) => event.id !== exceptId && compareRationals(event.beat, beat) === 0)) {
		throw new RangeError('The tempo event beat already exists.');
	}
}

function assertUnusedSamplePosition(
	events: readonly TempoEventRecord[],
	samplePosition: number,
	exceptId?: string,
): void {
	if (events.some((event) => event.id !== exceptId && event.samplePosition === samplePosition)) {
		throw new RangeError('The tempo event sample position already exists.');
	}
}

function assertUnusedBar(events: readonly SignatureEventRecord[], bar: number, exceptId?: string): void {
	if (events.some((event) => event.id !== exceptId && event.bar === bar)) {
		throw new RangeError('The signature event bar already exists.');
	}
}

function requireEventIndex(events: readonly DataRecord[], id: string, name: string): number {
	const index = events.findIndex((event) => event.id === id);
	if (index < 0) throw new ReferenceError(`Unknown ${name} event: ${id}.`);
	return index;
}

function assertRootBeat(events: readonly TempoEventRecord[]): void {
	if (compareRationals(events[0].beat, 0) !== 0) {
		throw new RangeError('The first tempo event must remain at beat zero.');
	}
}

function assertRootSamplePosition(events: readonly TempoEventRecord[]): void {
	if (events[0].samplePosition !== 0) {
		throw new RangeError('The first sample-locked tempo event must remain at sample zero.');
	}
}

function assertStrictSamplePositions(events: readonly TempoEventRecord[]): void {
	assertRootSamplePosition(events);
	let previous = -1;
	for (const event of events) {
		const samplePosition = nonNegativeSafeInteger(event.samplePosition, 'tempo event samplePosition');
		if (samplePosition <= previous) throw new RangeError('Sample-locked tempo positions must increase.');
		previous = samplePosition;
	}
}

function assertRootBar(events: readonly SignatureEventRecord[]): void {
	if (events[0].bar !== 0) throw new RangeError('The first signature event must remain at bar zero.');
}

function compareTempoBeats(left: TempoEventRecord, right: TempoEventRecord): number {
	return compareRationals(left.beat, right.beat);
}

function compareTempoSamples(left: TempoEventRecord, right: TempoEventRecord): number {
	return Number(left.samplePosition) - Number(right.samplePosition);
}

function projectSampleRate(project: DataRecord): number {
	if (!Number.isSafeInteger(project.sampleRate) || Number(project.sampleRate) <= 0) {
		throw new RangeError('project.sampleRate must be a positive safe integer.');
	}
	return Number(project.sampleRate);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function isPowerOfTwo(value: number): boolean {
	if (!Number.isSafeInteger(value) || value <= 0) return false;
	const integer = BigInt(value);
	return (integer & (integer - 1n)) === 0n;
}

function assertOnlyKeys(value: DataRecord, allowed: readonly string[], name: string): void {
	const allowedSet = new Set(allowed);
	const unsupported = Object.keys(value).find((key) => !allowedSet.has(key));
	if (unsupported) throw new RangeError(`${name} has unsupported field ${unsupported}.`);
}

function assertNonEmpty(value: DataRecord, name: string): void {
	if (!Object.keys(value).length) throw new TypeError(`${name} cannot be empty.`);
}

function commandRecord(value: unknown, name: string): DataRecord {
	if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
	return value;
}

function isRecord(value: unknown): value is DataRecord {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function record(project: EditorCommandProject): DataRecord {
	return project as DataRecord;
}
