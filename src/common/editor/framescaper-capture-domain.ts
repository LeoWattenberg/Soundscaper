/* SPDX-License-Identifier: AGPL-3.0-only */

export const CAPTURE_SOURCE_ROLES = Object.freeze([
	'camera',
	'microphone',
	'display',
	'system-audio',
] as const);

export const CAPTURE_DESTINATIONS = Object.freeze([
	'project-bin',
	'timeline',
	'both',
] as const);

export const CAPTURE_PHASES = Object.freeze([
	'inactive',
	'permission-pending',
	'previewing',
	'armed',
	'countdown',
	'recording',
	'paused',
	'finalizing',
	'recovery',
	'failed',
] as const);

export const CAPTURE_RUNTIME_UNAVAILABLE_REASONS = Object.freeze([
	'embedded-route',
	'permission-policy',
	'media-devices-unavailable',
	'display-capture-unavailable',
	'video-encoder-unavailable',
	'audio-packet-source-unavailable',
	'durable-storage-unavailable',
	'media-probe-unavailable',
	'unsupported-platform',
	'runtime-error',
] as const);

export const CAPTURE_FAILURE_CODES = Object.freeze([
	'permission-denied',
	'permission-dismissed',
	'permission-revoked',
	'device-lost',
	'source-ended',
	'encoder-failed',
	'storage-failed',
	'runtime-lost',
	'finalization-failed',
	'unknown',
] as const);

export type CaptureSourceRole = typeof CAPTURE_SOURCE_ROLES[number];
export type CaptureDestination = typeof CAPTURE_DESTINATIONS[number];
export type CapturePhase = typeof CAPTURE_PHASES[number];
export type CaptureRuntimeUnavailableReason =
	typeof CAPTURE_RUNTIME_UNAVAILABLE_REASONS[number];
export type CaptureFailureCode = typeof CAPTURE_FAILURE_CODES[number];
export type CaptureMetricConfidence = 'exact' | 'estimated' | 'unavailable';

export type CaptureRuntimeAvailability =
	| Readonly<{ readonly status: 'checking' }>
	| Readonly<{
		readonly status: 'available';
		readonly sourceRoles: readonly CaptureSourceRole[];
	}>
	| Readonly<{
		readonly status: 'unavailable';
		readonly reason: CaptureRuntimeUnavailableReason;
		readonly detail: string | null;
	}>;

/** A controller-issued one-shot authority for a direct user action. */
export interface CaptureDirectUserAction {
	readonly kind: 'framescaper-capture-direct-user-action';
	readonly generation: number;
}

/** Stable identity only; live tracks and device labels remain platform-owned. */
export interface CaptureSelectedSource {
	readonly sourceId: string;
	readonly role: CaptureSourceRole;
}

export interface CaptureFailure {
	readonly code: CaptureFailureCode;
	readonly message: string;
}

export type CaptureMetricObservation =
	| Readonly<{ readonly value: number; readonly confidence: 'exact' | 'estimated' }>
	| Readonly<{ readonly value: null; readonly confidence: 'unavailable' }>;

interface CapturePacketBase {
	readonly sessionId: string;
	readonly streamId: string;
	readonly sequence: number;
	readonly presentationTimeUs: number;
	readonly durationUs: number;
	readonly receiptTimeMs: number;
	readonly droppedBefore: CaptureMetricObservation;
}

export interface CaptureEncodedVideoPacket extends CapturePacketBase {
	readonly kind: 'encoded-video';
	readonly role: 'camera' | 'display';
	readonly byteLength: number;
	readonly bytes: Uint8Array;
	readonly mimeType: string;
	readonly keyFrame: boolean | null;
}

export interface CapturePcmAudioPacket extends CapturePacketBase {
	readonly kind: 'pcm-audio';
	readonly role: 'microphone' | 'system-audio';
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly samples: Float32Array;
}

export type CapturePacket = CaptureEncodedVideoPacket | CapturePcmAudioPacket;

export interface CaptureStreamMetrics {
	readonly streamId: string;
	readonly role: CaptureSourceRole;
	readonly packetCount: number;
	readonly capturedDurationUs: number;
	readonly droppedUnits: CaptureMetricObservation;
	readonly droppedRatio: CaptureMetricObservation;
	readonly currentDriftUs: CaptureMetricObservation;
	readonly maximumAbsoluteDriftUs: CaptureMetricObservation;
}

type DataRecord = Readonly<Record<string, unknown>>;

export function createCaptureRuntimeAvailability(
	value: unknown = { status: 'checking' },
): CaptureRuntimeAvailability {
	const candidate = dataRecord(value, 'Capture runtime availability');
	switch (candidate.status) {
		case 'checking':
			closedKeys(candidate, 'Capture runtime availability', ['status']);
			return Object.freeze({ status: 'checking' });
		case 'available': {
			closedKeys(candidate, 'Capture runtime availability', ['status', 'sourceRoles']);
			const sourceRoles = normalizeCaptureSourceRoles(candidate.sourceRoles);
			return Object.freeze({ status: 'available', sourceRoles });
		}
		case 'unavailable': {
			closedKeys(candidate, 'Capture runtime availability', ['status', 'reason', 'detail']);
			const reason = enumValue(
				candidate.reason,
				CAPTURE_RUNTIME_UNAVAILABLE_REASONS,
				'Capture runtime unavailable reason',
			);
			const detail = candidate.detail === null
				? null
				: canonicalString(candidate.detail, 'Capture runtime unavailable detail', 1_024);
			return Object.freeze({ status: 'unavailable', reason, detail });
		}
		default:
			throw new TypeError('Capture runtime availability status is invalid.');
	}
}

export function normalizeCaptureSourceRoles(value: unknown): readonly CaptureSourceRole[] {
	const values = denseArray(value, 'Capture source roles', CAPTURE_SOURCE_ROLES.length);
	if (values.length === 0) throw new RangeError('Capture source roles must not be empty.');
	const seen = new Set<CaptureSourceRole>();
	const roles = values.map((roleValue): CaptureSourceRole => {
		const role = enumValue(roleValue, CAPTURE_SOURCE_ROLES, 'Capture source role');
		if (seen.has(role)) throw new RangeError(`Duplicate capture source role ${role}.`);
		seen.add(role);
		return role;
	});
	if (seen.has('system-audio') && !seen.has('display')) {
		throw new RangeError('System audio requires a selected display source.');
	}
	return Object.freeze(roles);
}

export function normalizeCaptureSelectedSources(
	value: unknown,
): readonly Readonly<CaptureSelectedSource>[] {
	const values = denseArray(value, 'Capture selected sources', CAPTURE_SOURCE_ROLES.length);
	if (values.length === 0) throw new RangeError('Capture selected sources must not be empty.');
	const sourceIds = new Set<string>();
	const roles = new Set<CaptureSourceRole>();
	const sources = values.map((sourceValue, index): Readonly<CaptureSelectedSource> => {
		const source = dataRecord(sourceValue, `Capture selected sources[${String(index)}]`);
		closedKeys(source, `Capture selected sources[${String(index)}]`, ['sourceId', 'role']);
		const sourceId = canonicalString(source.sourceId, 'Capture source ID', 256);
		const role = enumValue(source.role, CAPTURE_SOURCE_ROLES, 'Capture source role');
		if (sourceIds.has(sourceId)) throw new RangeError(`Duplicate capture source ID ${sourceId}.`);
		if (roles.has(role)) throw new RangeError(`Duplicate capture source role ${role}.`);
		sourceIds.add(sourceId);
		roles.add(role);
		return Object.freeze({ sourceId, role });
	});
	if (roles.has('system-audio') && !roles.has('display')) {
		throw new RangeError('System audio requires a selected display source.');
	}
	return Object.freeze(sources);
}

export function normalizeCaptureDestination(value: unknown): CaptureDestination {
	return enumValue(value, CAPTURE_DESTINATIONS, 'Capture destination');
}

export function normalizeCaptureFailure(value: unknown): Readonly<CaptureFailure> {
	const failure = dataRecord(value, 'Capture failure');
	closedKeys(failure, 'Capture failure', ['code', 'message']);
	return Object.freeze({
		code: enumValue(failure.code, CAPTURE_FAILURE_CODES, 'Capture failure code'),
		message: canonicalString(failure.message, 'Capture failure message', 1_024),
	});
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed data record.`);
	}
	const record = value as Record<PropertyKey, unknown>;
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(record)) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (typeof key !== 'string' || !descriptor?.enumerable
			|| !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an enumerable data property.`);
		}
		result[key] = descriptor.value;
	}
	return Object.freeze(result);
}

function closedKeys(value: DataRecord, name: string, keys: readonly string[]): void {
	const actualKeys = Object.keys(value);
	const allowed = new Set(keys);
	if (actualKeys.length !== keys.length
		|| actualKeys.some((key) => !allowed.has(key))
		|| keys.some((key) => !Object.hasOwn(value, key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
}

function denseArray(value: unknown, name: string, maximumLength: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a standard dense array.`);
	}
	if (value.length > maximumLength) {
		throw new RangeError(`${name} exceeds the ${String(maximumLength)} item limit.`);
	}
	for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) throw new TypeError(`${name} must be dense.`);
	}
	return value;
}

function enumValue<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	name: string,
): Values[number] {
	if (typeof value !== 'string' || !values.includes(value)) {
		throw new TypeError(`${name} is invalid.`);
	}
	return value;
}

function canonicalString(value: unknown, name: string, maximumLength: number): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength
		|| value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	return value;
}
