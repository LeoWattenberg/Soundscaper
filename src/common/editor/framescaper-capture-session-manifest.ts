/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	CaptureDestination,
	CaptureSourceRole,
} from './framescaper-capture-domain.ts';

const MAXIMUM_CAPTURE_STREAMS = 4;
const MAXIMUM_PAUSE_SPANS = 4_096;
const MAXIMUM_CAPTURE_PACKETS = 1_000_000;
const MAXIMUM_CAPTURE_CHUNKS = 16_000_000;

export type FramescaperCaptureSourceRole = CaptureSourceRole;
export type FramescaperCaptureDestination = CaptureDestination;
export type FramescaperCaptureManifestState =
	'capturing' | 'sealed' | 'finalizing' | 'published' | 'committed' | 'discarded';
export type FramescaperCaptureRecoveryDecision = 'recover' | 'import-as-is' | 'delete';
export type FramescaperCapturePlayability = 'unknown' | 'playable' | 'invalid';

export interface FramescaperCaptureProjectFenceV1 {
	readonly projectId: string;
	readonly baseRevision: number;
	readonly baseSha256: string;
}

export interface FramescaperCaptureOriginV1 {
	readonly sequenceId: string;
	readonly playheadMicroseconds: number;
	readonly destination: FramescaperCaptureDestination;
}

export interface FramescaperCapturePauseSpanV1 {
	readonly startMicroseconds: number;
	readonly endMicroseconds: number;
}

export interface FramescaperCaptureClockV1 {
	readonly monotonicOriginMicroseconds: number;
	readonly pauseSpans: readonly FramescaperCapturePauseSpanV1[];
}

export interface FramescaperCaptureStreamTimingV1 {
	readonly firstPresentationMicroseconds: number | null;
	readonly lastPresentationEndMicroseconds: number | null;
}

interface FramescaperCaptureStorageBaseV1 {
	readonly spoolId: string;
	readonly spoolToken: string;
	readonly sourceId: string;
	readonly chunkCount: number;
}

export interface FramescaperEncodedCaptureStorageV1 extends FramescaperCaptureStorageBaseV1 {
	readonly kind: 'encoded-media';
	readonly mimeType: string;
	readonly packetCount: number;
	readonly byteLength: number;
}

export interface FramescaperRawPcmCaptureStorageV1 extends FramescaperCaptureStorageBaseV1 {
	readonly kind: 'raw-pcm';
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

export type FramescaperCaptureStorageV1 =
	FramescaperEncodedCaptureStorageV1 | FramescaperRawPcmCaptureStorageV1;

export interface FramescaperCaptureStreamManifestV1 {
	readonly streamId: string;
	readonly role: FramescaperCaptureSourceRole;
	readonly required: boolean;
	readonly playability: FramescaperCapturePlayability;
	readonly timing: FramescaperCaptureStreamTimingV1;
	readonly storage: FramescaperCaptureStorageV1;
}

/** Durable recovery truth created before a capture source can emit bytes. */
export interface FramescaperCaptureSessionManifestV1 {
	readonly version: 1;
	readonly sessionId: string;
	readonly generation: number;
	readonly state: FramescaperCaptureManifestState;
	readonly recoveryDecision: FramescaperCaptureRecoveryDecision | null;
	readonly projectFence: FramescaperCaptureProjectFenceV1;
	readonly origin: FramescaperCaptureOriginV1;
	readonly clock: FramescaperCaptureClockV1;
	readonly streams: readonly FramescaperCaptureStreamManifestV1[];
	readonly createdAt: number;
	readonly updatedAt: number;
}

export function normalizeFramescaperCaptureSessionManifest(
	value: unknown,
): FramescaperCaptureSessionManifestV1 {
	const record = dataRecord(value, 'Framescaper capture session manifest', [
		'version', 'sessionId', 'generation', 'state', 'recoveryDecision',
		'projectFence', 'origin', 'clock', 'streams', 'createdAt', 'updatedAt',
	]);
	if (record.version !== 1) throw new Error('Framescaper capture session manifest version is invalid.');
	const state = manifestState(record.state);
	const recoveryDecision = recoveryDecisionValue(record.recoveryDecision);
	const projectFence = normalizeProjectFence(record.projectFence);
	const origin = normalizeOrigin(record.origin);
	const clock = normalizeClock(record.clock);
	const streams = denseArray(
		record.streams,
		MAXIMUM_CAPTURE_STREAMS,
		'Framescaper capture streams',
	).map(normalizeStream);
	if (!streams.length) throw new Error('A Framescaper capture session requires at least one stream.');
	assertUniqueStreams(streams);
	assertStateDecision(state, recoveryDecision, streams);
	const createdAt = nonNegativeInteger(record.createdAt, 'Framescaper capture creation time');
	const updatedAt = nonNegativeInteger(record.updatedAt, 'Framescaper capture update time');
	if (updatedAt < createdAt) throw new Error('Framescaper capture timestamps cannot move backward.');
	return Object.freeze({
		version: 1,
		sessionId: stableId(record.sessionId, 'Framescaper capture sessionId'),
		generation: positiveInteger(record.generation, 'Framescaper capture generation'),
		state,
		recoveryDecision,
		projectFence,
		origin,
		clock,
		streams: Object.freeze(streams),
		createdAt,
		updatedAt,
	});
}

export function decideFramescaperCaptureRecovery(
	manifestValue: unknown,
	decisionValue: FramescaperCaptureRecoveryDecision,
	updatedAtValue = Date.now(),
): FramescaperCaptureSessionManifestV1 {
	const manifest = normalizeFramescaperCaptureSessionManifest(manifestValue);
	const decision = recoveryDecisionValue(decisionValue);
	if (decision === null) throw new TypeError('A Framescaper capture recovery decision is required.');
	if (manifest.state !== 'sealed' || manifest.recoveryDecision !== null) {
		throw new Error('A recovery decision requires an undecided sealed session.');
	}
	if (decision === 'import-as-is'
		&& manifest.streams.some(({ playability }) => playability !== 'playable')) {
		throw new Error('Import-as-is requires a playable acknowledged prefix for every captured stream.');
	}
	const updatedAt = nonNegativeInteger(updatedAtValue, 'Framescaper recovery decision time');
	if (updatedAt < manifest.updatedAt) throw new Error('Framescaper recovery decision time cannot move backward.');
	return normalizeFramescaperCaptureSessionManifest({
		...manifest,
		state: decision === 'delete' ? 'discarded' : 'finalizing',
		recoveryDecision: decision,
		updatedAt,
	});
}

function normalizeProjectFence(value: unknown): FramescaperCaptureProjectFenceV1 {
	const record = dataRecord(value, 'Framescaper capture project fence', [
		'projectId', 'baseRevision', 'baseSha256',
	]);
	return Object.freeze({
		projectId: stableId(record.projectId, 'Framescaper capture projectId'),
		baseRevision: nonNegativeInteger(record.baseRevision, 'Framescaper capture base revision'),
		baseSha256: sha256(record.baseSha256, 'Framescaper capture base SHA-256'),
	});
}

function normalizeOrigin(value: unknown): FramescaperCaptureOriginV1 {
	const record = dataRecord(value, 'Framescaper capture origin', [
		'sequenceId', 'playheadMicroseconds', 'destination',
	]);
	return Object.freeze({
		sequenceId: stableId(record.sequenceId, 'Framescaper capture sequenceId'),
		playheadMicroseconds: nonNegativeInteger(record.playheadMicroseconds, 'Framescaper capture playhead'),
		destination: destination(record.destination),
	});
}

function normalizeClock(value: unknown): FramescaperCaptureClockV1 {
	const record = dataRecord(value, 'Framescaper capture clock', [
		'monotonicOriginMicroseconds', 'pauseSpans',
	]);
	const pauseValues = denseArray(
		record.pauseSpans,
		MAXIMUM_PAUSE_SPANS,
		'Framescaper capture pause spans',
	);
	let previousEnd = -1;
	const pauseSpans = pauseValues.map((value) => {
		const span = dataRecord(value, 'Framescaper capture pause span', [
			'startMicroseconds', 'endMicroseconds',
		]);
		const startMicroseconds = nonNegativeInteger(span.startMicroseconds, 'Framescaper pause start');
		const endMicroseconds = positiveInteger(span.endMicroseconds, 'Framescaper pause end');
		if (endMicroseconds <= startMicroseconds) throw new Error('Framescaper pause spans require positive duration.');
		if (startMicroseconds < previousEnd) {
			throw new Error('Framescaper pause spans must be ordered and non-overlapping.');
		}
		previousEnd = endMicroseconds;
		return Object.freeze({ startMicroseconds, endMicroseconds });
	});
	return Object.freeze({
		monotonicOriginMicroseconds: nonNegativeInteger(
			record.monotonicOriginMicroseconds,
			'Framescaper monotonic clock origin',
		),
		pauseSpans: Object.freeze(pauseSpans),
	});
}

function normalizeStream(value: unknown): FramescaperCaptureStreamManifestV1 {
	const record = dataRecord(value, 'Framescaper capture stream', [
		'streamId', 'role', 'required', 'playability', 'timing', 'storage',
	]);
	const role = sourceRole(record.role);
	const storage = normalizeStorage(record.storage);
	const timing = normalizeStreamTiming(record.timing, storageHasData(storage));
	if ((role === 'camera' || role === 'display') !== (storage.kind === 'encoded-media')) {
		throw new Error('Framescaper video roles require encoded media and audio roles require raw PCM.');
	}
	if (typeof record.required !== 'boolean') throw new TypeError('Framescaper stream required must be boolean.');
	return Object.freeze({
		streamId: stableId(record.streamId, 'Framescaper capture streamId'),
		role,
		required: record.required,
		playability: playability(record.playability),
		timing,
		storage,
	});
}

function normalizeStreamTiming(value: unknown, hasData: boolean): FramescaperCaptureStreamTimingV1 {
	const record = dataRecord(value, 'Framescaper capture stream presentation timing', [
		'firstPresentationMicroseconds', 'lastPresentationEndMicroseconds',
	]);
	const first = nullableNonNegativeInteger(
		record.firstPresentationMicroseconds,
		'Framescaper first presentation time',
	);
	const end = nullableNonNegativeInteger(
		record.lastPresentationEndMicroseconds,
		'Framescaper last presentation end time',
	);
	if ((first === null) !== (end === null) || hasData !== (first !== null)
		|| first !== null && end! <= first) {
		throw new Error('Framescaper stream presentation timing does not match its acknowledged prefix.');
	}
	return Object.freeze({
		firstPresentationMicroseconds: first,
		lastPresentationEndMicroseconds: end,
	});
}

function normalizeStorage(value: unknown): FramescaperCaptureStorageV1 {
	const base = dataRecord(value, 'Framescaper capture storage');
	const record = dataRecord(value, 'Framescaper capture storage', base.kind === 'encoded-media'
		? [
			'kind', 'spoolId', 'spoolToken', 'sourceId', 'chunkCount',
			'mimeType', 'packetCount', 'byteLength',
		]
		: [
			'kind', 'spoolId', 'spoolToken', 'sourceId', 'chunkCount',
			'sampleRate', 'channelCount', 'frameCount',
		]);
	const common = {
		spoolId: stableId(record.spoolId, 'Framescaper capture spoolId'),
		spoolToken: stableText(record.spoolToken, 'Framescaper capture spool token', 512),
		sourceId: stableId(record.sourceId, 'Framescaper capture sourceId'),
		chunkCount: boundedNonNegativeInteger(
			record.chunkCount,
			MAXIMUM_CAPTURE_CHUNKS,
			'Framescaper capture chunkCount',
		),
	};
	if (record.kind === 'encoded-media') {
		const packetCount = boundedNonNegativeInteger(
			record.packetCount,
			MAXIMUM_CAPTURE_PACKETS,
			'Framescaper capture packetCount',
		);
		const byteLength = nonNegativeInteger(record.byteLength, 'Framescaper capture byteLength');
		if ((packetCount === 0) !== (common.chunkCount === 0)
			|| (packetCount === 0) !== (byteLength === 0)) {
			throw new Error('Framescaper encoded acknowledged-prefix geometry is invalid.');
		}
		return Object.freeze({
			kind: 'encoded-media',
			...common,
			mimeType: stableText(record.mimeType, 'Framescaper capture MIME type', 255),
			packetCount,
			byteLength,
		});
	}
	if (record.kind === 'raw-pcm') {
		const frameCount = nonNegativeInteger(record.frameCount, 'Framescaper capture frameCount');
		if ((frameCount === 0) !== (common.chunkCount === 0)) {
			throw new Error('Framescaper PCM acknowledged-prefix geometry is invalid.');
		}
		return Object.freeze({
			kind: 'raw-pcm',
			...common,
			sampleRate: boundedPositiveInteger(record.sampleRate, 768_000, 'Framescaper capture sampleRate'),
			channelCount: boundedPositiveInteger(record.channelCount, 64, 'Framescaper capture channelCount'),
			frameCount,
		});
	}
	throw new TypeError('Framescaper capture storage kind is invalid.');
}

function storageHasData(storage: FramescaperCaptureStorageV1): boolean {
	return storage.kind === 'encoded-media' ? storage.packetCount > 0 : storage.frameCount > 0;
}

function assertUniqueStreams(streams: readonly FramescaperCaptureStreamManifestV1[]): void {
	if (new Set(streams.map(({ role }) => role)).size !== streams.length) {
		throw new Error('Framescaper capture source roles must be unique.');
	}
	if (streams.some(({ role }) => role === 'system-audio')
		&& !streams.some(({ role }) => role === 'display')) {
		throw new Error('Framescaper system audio requires a display stream.');
	}
	for (const [name, values] of [
		['stream IDs', streams.map(({ streamId }) => streamId)],
		['spool IDs', streams.map(({ storage }) => storage.spoolId)],
		['spool tokens', streams.map(({ storage }) => storage.spoolToken)],
		['source IDs', streams.map(({ storage }) => storage.sourceId)],
	] as const) {
		if (new Set(values).size !== values.length) {
			throw new Error(`Framescaper capture ${name} must be unique.`);
		}
	}
}

function assertStateDecision(
	state: FramescaperCaptureManifestState,
	decision: FramescaperCaptureRecoveryDecision | null,
	streams: readonly FramescaperCaptureStreamManifestV1[],
): void {
	if (state === 'capturing' && decision !== null) {
		throw new Error('An active Framescaper capture cannot have a recovery decision.');
	}
	if ((state === 'discarded') !== (decision === 'delete')) {
		throw new Error('Only a delete recovery decision can produce a discarded capture session.');
	}
	if (decision === 'import-as-is' && streams.some(({ playability: value }) => value !== 'playable')) {
		throw new Error('Import-as-is requires a playable acknowledged prefix for every captured stream.');
	}
	if (state === 'sealed' && decision !== null) {
		throw new Error('A sealed Framescaper capture must await its recovery decision.');
	}
}

function dataRecord(
	value: unknown,
	name: string,
	allowedKeys?: readonly string[],
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed data record.`);
	}
	const source = value as Record<PropertyKey, unknown>;
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (typeof key !== 'string' || !descriptor?.enumerable
			|| !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an enumerable data property.`);
		}
		result[key] = descriptor.value;
	}
	if (allowedKeys) {
		const allowed = new Set(allowedKeys);
		if (Object.keys(result).length !== allowedKeys.length
			|| Object.keys(result).some((key) => !allowed.has(key))
			|| allowedKeys.some((key) => !Object.hasOwn(result, key))) {
			throw new TypeError(`${name} has an invalid closed shape.`);
		}
	}
	return Object.freeze(result);
}

function denseArray(value: unknown, maximum: number, name: string): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`${name} must be bounded, standard, and dense.`);
	}
	return value;
}

function manifestState(value: unknown): FramescaperCaptureManifestState {
	if (value !== 'capturing' && value !== 'sealed' && value !== 'finalizing'
		&& value !== 'published' && value !== 'committed' && value !== 'discarded') {
		throw new TypeError('Framescaper capture manifest state is invalid.');
	}
	return value;
}

function recoveryDecisionValue(value: unknown): FramescaperCaptureRecoveryDecision | null {
	if (value !== null && value !== 'recover' && value !== 'import-as-is' && value !== 'delete') {
		throw new TypeError('Framescaper capture recovery decision is invalid.');
	}
	return value;
}

function sourceRole(value: unknown): FramescaperCaptureSourceRole {
	if (value !== 'camera' && value !== 'microphone' && value !== 'display' && value !== 'system-audio') {
		throw new TypeError('Framescaper capture source role is invalid.');
	}
	return value;
}

function destination(value: unknown): FramescaperCaptureDestination {
	if (value !== 'project-bin' && value !== 'timeline' && value !== 'both') {
		throw new TypeError('Framescaper capture destination is invalid.');
	}
	return value;
}

function playability(value: unknown): FramescaperCapturePlayability {
	if (value !== 'unknown' && value !== 'playable' && value !== 'invalid') {
		throw new TypeError('Framescaper capture playability is invalid.');
	}
	return value;
}

function stableId(value: unknown, name: string): string {
	return stableText(value, name, 256);
}

function stableText(value: unknown, name: string, maximumLength: number): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > maximumLength
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function sha256(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function nullableNonNegativeInteger(value: unknown, name: string): number | null {
	return value === null ? null : nonNegativeInteger(value, name);
}

function boundedPositiveInteger(value: unknown, maximum: number, name: string): number {
	const result = positiveInteger(value, name);
	if (result > maximum) throw new RangeError(`${name} exceeds its strict bound.`);
	return result;
}

function boundedNonNegativeInteger(value: unknown, maximum: number, name: string): number {
	const result = nonNegativeInteger(value, name);
	if (result > maximum) throw new RangeError(`${name} exceeds its strict bound.`);
	return result;
}
