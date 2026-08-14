/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import { normalizeAutomationLaneV21, type AutomationLaneV21 } from './automation-lane-v21.ts';

export const AUDIO_TRACK_FREEZE_SCHEMA_VERSION_V1 = 1 as const;
export const AUDIO_TRACK_FREEZE_CAPTURE_POSITION_V1 = 'post-insert-pre-strip' as const;

export interface AudioTrackFreezeV1 {
	readonly schemaVersion: 1;
	readonly derivedSourceId: string;
	readonly inputDigestSha256: string;
	readonly rackDigestSha256: string;
	readonly automationDigestSha256: string;
	readonly freshnessDigestSha256: string;
	readonly renderStartFrame: number;
	readonly renderFrameCount: number;
	readonly capturePosition: 'post-insert-pre-strip';
}

export interface AudioTrackFreezeDigestsV1 {
	readonly inputDigestSha256: string;
	readonly rackDigestSha256: string;
	readonly automationDigestSha256: string;
	readonly freshnessDigestSha256: string;
}

export interface AudioTrackFreezeDigestInputV1 {
	readonly sampleRate: number;
	readonly renderStartFrame: number;
	readonly renderFrameCount: number;
	readonly track: unknown;
	readonly clips: readonly unknown[];
	readonly sourceContentIdentities: readonly unknown[];
	readonly automationLanes: readonly unknown[];
}

export type AudioTrackFreezeFreshnessComponentV1 = 'input' | 'rack' | 'automation' | 'freshness';

export interface AudioTrackFreezeFreshnessV1 {
	readonly status: 'unfrozen' | 'fresh' | 'stale';
	readonly changedComponents: readonly AudioTrackFreezeFreshnessComponentV1[];
}

const FREEZE_FIELDS = Object.freeze([
	'schemaVersion', 'derivedSourceId', 'inputDigestSha256', 'rackDigestSha256',
	'automationDigestSha256', 'freshnessDigestSha256', 'renderStartFrame',
	'renderFrameCount', 'capturePosition',
]);
const DIGEST_FIELDS = Object.freeze([
	'inputDigestSha256', 'rackDigestSha256', 'automationDigestSha256', 'freshnessDigestSha256',
]);
const DIGEST_INPUT_FIELDS = Object.freeze([
	'sampleRate', 'renderStartFrame', 'renderFrameCount', 'track', 'clips',
	'sourceContentIdentities', 'automationLanes',
]);
const SOURCE_IDENTITY_FIELDS = Object.freeze(['sourceId', 'contentSha256']);
const SHA256 = /^[a-f0-9]{64}$/u;
const TEXT_ENCODER = new TextEncoder();
const MAXIMUM_COLLECTION_ENTRIES = 100_000;
const MAXIMUM_SNAPSHOT_NODES = 250_000;
const NORMALIZED_FREEZES = new WeakSet<object>();
const NORMALIZED_DIGESTS = new WeakSet<object>();

/** Normalize the exact optional V21 audio-track relationship without invoking accessors. */
export function normalizeAudioTrackFreezeV1(value: unknown): AudioTrackFreezeV1 {
	if (value && typeof value === 'object' && NORMALIZED_FREEZES.has(value)) return value as AudioTrackFreezeV1;
	const record = readClosedDomainRecord(value, 'audio track freeze', FREEZE_FIELDS);
	if (field(record, 'schemaVersion', 'audio track freeze') !== AUDIO_TRACK_FREEZE_SCHEMA_VERSION_V1) {
		throw new RangeError('audio track freeze.schemaVersion must be 1.');
	}
	const renderStartFrame = nonNegativeSafeInteger(
		field(record, 'renderStartFrame', 'audio track freeze'), 'audio track freeze.renderStartFrame',
	);
	const renderFrameCount = positiveSafeInteger(
		field(record, 'renderFrameCount', 'audio track freeze'), 'audio track freeze.renderFrameCount',
	);
	if (!Number.isSafeInteger(renderStartFrame + renderFrameCount)) {
		throw new RangeError('The audio track freeze render range must end at a safe integer.');
	}
	const capturePosition = field(record, 'capturePosition', 'audio track freeze');
	if (capturePosition !== AUDIO_TRACK_FREEZE_CAPTURE_POSITION_V1) {
		throw new RangeError('audio track freeze.capturePosition is unsupported.');
	}
	const normalized = Object.freeze({
		schemaVersion: AUDIO_TRACK_FREEZE_SCHEMA_VERSION_V1,
		derivedSourceId: stableId(field(record, 'derivedSourceId', 'audio track freeze'), 'derived source'),
		inputDigestSha256: digest(field(record, 'inputDigestSha256', 'audio track freeze'), 'input'),
		rackDigestSha256: digest(field(record, 'rackDigestSha256', 'audio track freeze'), 'rack'),
		automationDigestSha256: digest(field(record, 'automationDigestSha256', 'audio track freeze'), 'automation'),
		freshnessDigestSha256: digest(field(record, 'freshnessDigestSha256', 'audio track freeze'), 'freshness'),
		renderStartFrame,
		renderFrameCount,
		capturePosition,
	});
	NORMALIZED_FREEZES.add(normalized);
	return normalized;
}

export function normalizeOptionalAudioTrackFreezeV1(value: unknown): AudioTrackFreezeV1 | undefined {
	return value === undefined ? undefined : normalizeAudioTrackFreezeV1(value);
}

export function normalizeAudioTrackFreezeDigestsV1(value: unknown): AudioTrackFreezeDigestsV1 {
	if (value && typeof value === 'object' && NORMALIZED_DIGESTS.has(value)) {
		return value as AudioTrackFreezeDigestsV1;
	}
	const record = readClosedDomainRecord(value, 'audio track freeze digests', DIGEST_FIELDS);
	const normalized = Object.freeze({
		inputDigestSha256: digest(field(record, 'inputDigestSha256', 'audio track freeze digests'), 'input'),
		rackDigestSha256: digest(field(record, 'rackDigestSha256', 'audio track freeze digests'), 'rack'),
		automationDigestSha256: digest(field(record, 'automationDigestSha256', 'audio track freeze digests'), 'automation'),
		freshnessDigestSha256: digest(field(record, 'freshnessDigestSha256', 'audio track freeze digests'), 'freshness'),
	});
	NORMALIZED_DIGESTS.add(normalized);
	return normalized;
}

export function sameAudioTrackFreezeV1(left: unknown, right: unknown): boolean {
	const first = normalizeAudioTrackFreezeV1(left);
	const second = normalizeAudioTrackFreezeV1(right);
	return FREEZE_FIELDS.every((name) => first[name as keyof AudioTrackFreezeV1]
		=== second[name as keyof AudioTrackFreezeV1]);
}

/** Compute the exact post-insert/pre-strip component identities for one audio track. */
export function computeAudioTrackFreezeDigestsV1(value: AudioTrackFreezeDigestInputV1): AudioTrackFreezeDigestsV1 {
	const input = readClosedDomainRecord(value, 'audio track freeze digest input', DIGEST_INPUT_FIELDS);
	const sampleRate = positiveSafeInteger(field(input, 'sampleRate', 'audio track freeze digest input'), 'sampleRate');
	const renderStartFrame = nonNegativeSafeInteger(
		field(input, 'renderStartFrame', 'audio track freeze digest input'), 'renderStartFrame',
	);
	const renderFrameCount = positiveSafeInteger(
		field(input, 'renderFrameCount', 'audio track freeze digest input'), 'renderFrameCount',
	);
	if (!Number.isSafeInteger(renderStartFrame + renderFrameCount)) {
		throw new RangeError('The audio track freeze digest range must end at a safe integer.');
	}
	const track = inspectDataRecord(field(input, 'track', 'audio track freeze digest input'), 'audio track freeze track');
	if (track.type !== 'audio') throw new RangeError('The freeze digest target must be an audio track.');
	const trackId = stableId(track.id, 'audio track');
	const clipIds = uniqueIds(track.clipIds, 'audio track.clipIds', 1, MAXIMUM_COLLECTION_ENTRIES);
	const effectValues = readClosedDomainArray(track.effects, 'audio track.effects', 0, 4_096);
	if (typeof track.effectsActive !== 'boolean') throw new TypeError('audio track.effectsActive must be boolean.');
	const snapshotNodeBudget = snapshotBudget();
	const effectSnapshots = effectValues.map((effect, index) => snapshotJson(
		effect, `audio track.effects[${String(index)}]`, snapshotNodeBudget, new Set<object>(),
	));
	const effectIds = new Set<string>();
	for (const [index, valueAtIndex] of effectSnapshots.entries()) {
		const effect = inspectDataRecord(valueAtIndex, `audio track.effects[${String(index)}]`);
		const effectId = stableId(effect.id, `audio track effect ${String(index)}`);
		if (effectIds.has(effectId)) throw new RangeError(`The audio track rack contains duplicate effect ID ${effectId}.`);
		effectIds.add(effectId);
	}

	const clipValues = readClosedDomainArray(
		field(input, 'clips', 'audio track freeze digest input'), 'audio track freeze clips', 1,
		MAXIMUM_COLLECTION_ENTRIES,
	);
	const clipsById = new Map<string, unknown>();
	for (const [index, candidate] of clipValues.entries()) {
		const clip = inspectDataRecord(candidate, `audio track freeze clips[${String(index)}]`);
		const id = stableId(clip.id, `clip ${String(index)}`);
		if (clipsById.has(id)) throw new RangeError(`The freeze digest clips contain duplicate ID ${id}.`);
		clipsById.set(id, candidate);
	}
	const identities = sourceIdentities(field(input, 'sourceContentIdentities', 'audio track freeze digest input'));
	const usedSourceIds = new Set<string>();
	const orderedInputs = clipIds.map((clipId, index) => {
		const candidate = clipsById.get(clipId);
		if (!candidate) throw new ReferenceError(`The audio track freeze clip ${clipId} does not exist.`);
		const clip = inspectDataRecord(candidate, `owned audio clip ${clipId}`);
		if (clip.kind !== 'audio') throw new RangeError(`The owned freeze clip ${clipId} must be audio.`);
		const sourceId = stableId(clip.sourceId, `owned clip ${clipId} source`);
		const contentSha256 = identities.get(sourceId);
		if (!contentSha256) throw new ReferenceError(`Source content identity ${sourceId} is required.`);
		usedSourceIds.add(sourceId);
		return Object.freeze([
			index,
			snapshotJson(candidate, `owned audio clip ${clipId}`, snapshotNodeBudget, new Set<object>()),
			Object.freeze([sourceId, contentSha256]),
		]);
	});
	for (const sourceId of identities.keys()) {
		if (!usedSourceIds.has(sourceId)) {
			throw new RangeError(`Source content identity ${sourceId} is outside the exact owned clip set.`);
		}
	}

	const lanes = readClosedDomainArray(
		field(input, 'automationLanes', 'audio track freeze digest input'),
		'audio track freeze automation lanes', 0, 4_096,
	).map((lane) => normalizeAutomationLaneV21(lane));
	const effectAutomation = lanes.filter((lane) => laneTargetsRackEffect(lane, trackId, effectIds));
	const inputDigestSha256 = hashCanonical(Object.freeze([
		'soundscaper.audio-freeze.input/v1', sampleRate,
		Object.freeze([renderStartFrame, renderFrameCount]), trackId, Object.freeze(orderedInputs),
	]));
	const rackDigestSha256 = hashCanonical(Object.freeze([
		'soundscaper.audio-freeze.rack/v1', trackId, track.effectsActive, Object.freeze(effectSnapshots),
	]));
	const automationDigestSha256 = hashCanonical(Object.freeze([
		'soundscaper.audio-freeze.automation/v1', trackId, Object.freeze(effectAutomation),
	]));
	const freshnessDigestSha256 = hashCanonical(Object.freeze([
		'soundscaper.audio-freeze.freshness/v1', inputDigestSha256, rackDigestSha256,
		automationDigestSha256, renderStartFrame, renderFrameCount, sampleRate,
		AUDIO_TRACK_FREEZE_CAPTURE_POSITION_V1,
	]));
	return normalizeAudioTrackFreezeDigestsV1({
		inputDigestSha256, rackDigestSha256, automationDigestSha256, freshnessDigestSha256,
	});
}

export function classifyAudioTrackFreezeFreshnessV1(
	freezeValue: unknown,
	currentValue: unknown,
): AudioTrackFreezeFreshnessV1 {
	const current = normalizeAudioTrackFreezeDigestsV1(currentValue);
	if (freezeValue === undefined) return Object.freeze({ status: 'unfrozen', changedComponents: Object.freeze([]) });
	const freeze = normalizeAudioTrackFreezeV1(freezeValue);
	const changed: AudioTrackFreezeFreshnessComponentV1[] = [];
	if (freeze.inputDigestSha256 !== current.inputDigestSha256) changed.push('input');
	if (freeze.rackDigestSha256 !== current.rackDigestSha256) changed.push('rack');
	if (freeze.automationDigestSha256 !== current.automationDigestSha256) changed.push('automation');
	if (freeze.freshnessDigestSha256 !== current.freshnessDigestSha256) changed.push('freshness');
	return Object.freeze({
		status: changed.length === 0 ? 'fresh' : 'stale',
		changedComponents: Object.freeze(changed),
	});
}

function sourceIdentities(value: unknown): ReadonlyMap<string, string> {
	const entries = readClosedDomainArray(value, 'source content identities', 1, MAXIMUM_COLLECTION_ENTRIES);
	const result = new Map<string, string>();
	for (const [index, candidate] of entries.entries()) {
		const name = `source content identities[${String(index)}]`;
		const record = readClosedDomainRecord(candidate, name, SOURCE_IDENTITY_FIELDS);
		const sourceId = stableId(field(record, 'sourceId', name), 'source content');
		if (result.has(sourceId)) throw new RangeError(`Source content identities contain duplicate ID ${sourceId}.`);
		result.set(sourceId, digest(field(record, 'contentSha256', name), `source ${sourceId} content`));
	}
	return result;
}

function laneTargetsRackEffect(lane: AutomationLaneV21, trackId: string, effectIds: ReadonlySet<string>): boolean {
	const { address } = lane;
	return address.kind === 'effect' && address.strip.kind === 'track'
		&& address.strip.id === trackId && effectIds.has(address.effectId);
}

function snapshotJson(value: unknown, name: string, budget: { remaining: number }, seen: Set<object>): unknown {
	budget.remaining -= 1;
	if (budget.remaining < 0) throw new RangeError(`${name} exceeds the freeze snapshot budget.`);
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`${name} must contain canonical finite numbers.`);
		return value;
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) throw new TypeError(`${name} must not be cyclic.`);
		seen.add(value);
		const values = readClosedDomainArray(value, name, 0, MAXIMUM_COLLECTION_ENTRIES);
		const output = values.map((entry, index) => snapshotJson(entry, `${name}[${String(index)}]`, budget, seen));
		seen.delete(value);
		return Object.freeze(output);
	}
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must contain only inert JSON data.`);
	if (seen.has(value)) throw new TypeError(`${name} must not be cyclic.`);
	seen.add(value);
	const input = inspectDataRecord(value, name);
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Object.keys(input).sort()) {
		output[key] = snapshotJson(input[key], `${name}.${key}`, budget, seen);
	}
	seen.delete(value);
	return Object.freeze(output);
}

function inspectDataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError(`${name} must contain only named own data properties.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
			throw new TypeError(`${name}.${key} must be an enumerable own data property.`);
		}
		output[key] = descriptor.value;
	}
	return Object.freeze(output);
}

function uniqueIds(value: unknown, name: string, minimum: number, maximum: number): readonly string[] {
	const input = readClosedDomainArray(value, name, minimum, maximum);
	const result: string[] = [];
	const seen = new Set<string>();
	for (const [index, candidate] of input.entries()) {
		const id = stableId(candidate, `${name}[${String(index)}]`);
		if (seen.has(id)) throw new RangeError(`${name} contains duplicate ID ${id}.`);
		seen.add(id);
		result.push(id);
	}
	return Object.freeze(result);
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const record = value as Readonly<Record<string, unknown>>;
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function hashCanonical(value: unknown): string {
	return bytesToHex(sha256(TEXT_ENCODER.encode(canonicalJson(value))));
}

function field(record: ClosedDomainRecord, name: string, label: string): unknown {
	return readClosedDomainField(record, name, label);
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be a lowercase SHA-256 digest.`);
	return value;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} ID must be nonempty.`);
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a nonnegative safe integer.`);
	}
	return Number(value);
}

function snapshotBudget(): { remaining: number } {
	return { remaining: MAXIMUM_SNAPSHOT_NODES };
}
