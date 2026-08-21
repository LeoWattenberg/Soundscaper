/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeWebVcrCapability,
	normalizeWebVcrCommandV1 as normalizeCanonicalWebVcrCommandV1,
	normalizeWebVcrNormalizedCrop,
	normalizeWebVcrResolution,
	normalizeWebVcrSnapshot,
	type WebVcrCapability,
	type WebVcrCommandV1,
	type WebVcrLifecyclePhase,
	type WebVcrNormalizedCrop,
	type WebVcrResolution,
	type WebVcrSnapshot,
} from '../src/common/editor/web-vcr-domain.ts';

export type {
	WebVcrAspect,
	WebVcrCapability,
	WebVcrCapabilityReason,
	WebVcrCommandV1,
	WebVcrDimensions,
	WebVcrInputModifier,
	WebVcrLifecyclePhase,
	WebVcrMediaState,
	WebVcrNavigationState,
	WebVcrNormalizedCrop,
	WebVcrRecordingMetrics,
	WebVcrResolution,
	WebVcrSnapshot,
	WebVcrTargetSummary,
} from '../src/common/editor/web-vcr-domain.ts';

export const FRAMESCAPER_WEB_VCR_CAPTURE_GRANT_TTL_MS = 10_000;
export const FRAMESCAPER_WEB_VCR_DATA_CLEAR_NONCE_TTL_MS = 30_000;

const OPAQUE_ID = /^[a-f0-9]{32}$/u;

export interface WebVcrHandshakeV1 {
	readonly version: 1;
	readonly capability: Readonly<WebVcrCapability>;
	readonly captureGrantTtlMs: 10_000;
}

export interface WebVcrSessionReferenceV1 {
	readonly version: 1;
	readonly sessionId: string;
	readonly generation: number;
}

export interface WebVcrCaptureGrantV1 extends WebVcrSessionReferenceV1 {
	readonly grantId: string;
	readonly expiresAtMs: number;
}

export type WebVcrHostCaptureState = 'ready' | 'preparing' | 'recording' | 'finalizing' | 'recovery';

export type WebVcrCaptureStateRequestV1 =
	| Readonly<WebVcrSessionReferenceV1 & {
		readonly state: 'preparing';
		readonly recordingToken: string;
	}>
	| Readonly<WebVcrSessionReferenceV1 & {
		readonly state: Exclude<WebVcrHostCaptureState, 'preparing'>;
	}>;

export type WebVcrDispatchResultV1 =
	| Readonly<{ readonly version: 1; readonly kind: 'snapshot'; readonly snapshot: Readonly<WebVcrSnapshot> }>
	| Readonly<{
		readonly version: 1;
		readonly kind: 'data-clear-confirmation';
		readonly sessionId: string;
		readonly generation: number;
		readonly nonce: string;
		readonly expiresAtMs: number;
	}>;

export function validateWebVcrHandshakeV1(value: unknown): Readonly<WebVcrHandshakeV1> {
	const record = closedRecord(
		value,
		['version', 'capability', 'captureGrantTtlMs'],
		'Web VCR handshake',
	);
	if (record.version !== 1 || record.captureGrantTtlMs !== FRAMESCAPER_WEB_VCR_CAPTURE_GRANT_TTL_MS) {
		throw new TypeError('Malformed Web VCR handshake.');
	}
	const capability = normalizeWebVcrCapability(record.capability);
	if (capability.status === 'available'
		&& (!capability.resolutions.includes('720p') || !capability.resolutions.includes('1080p'))) {
		throw new TypeError('Available Web VCR capability requires the qualified baseline resolutions.');
	}
	return Object.freeze({
		version: 1,
		capability,
		captureGrantTtlMs: FRAMESCAPER_WEB_VCR_CAPTURE_GRANT_TTL_MS,
	});
}

/** Adds desktop-only opaque identity and surface invariants to the shared DTO normalizer. */
export function validateWebVcrSnapshotV1(value: unknown): Readonly<WebVcrSnapshot> {
	const snapshot = normalizeWebVcrSnapshot(value);
	if (snapshot.sessionId === null) {
		if ((snapshot.phase !== 'closed' && snapshot.phase !== 'opening')
			|| (snapshot.phase === 'opening' && snapshot.generation !== 0)) {
			throw new TypeError('Sessionless Web VCR snapshots must be closed or generation-zero opening.');
		}
	} else {
		opaqueId(snapshot.sessionId, 'session identity');
		positiveGeneration(snapshot.generation);
	}
	if (snapshot.target) opaqueId(snapshot.target.targetId, 'target identity');
	validateSurface(snapshot.captureSurface, snapshot.resolution);
	if ((snapshot.phase === 'failed' && snapshot.failure === null)
		|| (snapshot.failure !== null && snapshot.phase !== 'failed' && snapshot.phase !== 'recovery')) {
		throw new TypeError('Web VCR failure state is contradictory.');
	}
	return snapshot;
}

export function validateWebVcrCommandV1(value: unknown): Readonly<WebVcrCommandV1> {
	const command = normalizeCanonicalWebVcrCommandV1(value);
	opaqueId(command.sessionId, 'command session identity');
	positiveGeneration(command.generation);
	if (command.kind === 'clear-browser-data') {
		opaqueId(command.confirmationNonce, 'data clear confirmation nonce');
	}
	return command;
}

export function validateWebVcrOpenRequestV1(
	value: unknown,
): Readonly<{ readonly resolution: WebVcrResolution }> {
	const record = closedRecord(value, ['resolution'], 'Web VCR open request');
	return Object.freeze({ resolution: normalizeWebVcrResolution(record.resolution) });
}

export function validateWebVcrSessionReferenceV1(value: unknown): Readonly<WebVcrSessionReferenceV1> {
	const record = closedRecord(value, ['version', 'sessionId', 'generation'], 'Web VCR session reference');
	if (record.version !== 1) throw new TypeError('Web VCR session reference version is invalid.');
	return Object.freeze({
		version: 1,
		sessionId: opaqueId(record.sessionId, 'session identity'),
		generation: positiveGeneration(record.generation),
	});
}

export function validateWebVcrCaptureGrantV1(
	value: unknown,
	expected?: Readonly<WebVcrSessionReferenceV1>,
): Readonly<WebVcrCaptureGrantV1> {
	const record = closedRecord(
		value,
		['version', 'grantId', 'sessionId', 'generation', 'expiresAtMs'],
		'Web VCR capture grant',
	);
	const reference = validateWebVcrSessionReferenceV1({
		version: record.version,
		sessionId: record.sessionId,
		generation: record.generation,
	});
	if (expected && (reference.sessionId !== expected.sessionId
		|| reference.generation !== expected.generation)) {
		throw new TypeError('Web VCR capture grant does not match its request.');
	}
	return Object.freeze({
		...reference,
		grantId: opaqueId(record.grantId, 'capture grant identity'),
		expiresAtMs: nonnegativeInteger(record.expiresAtMs, 'capture grant expiry'),
	});
}

export function validateWebVcrCaptureStateRequestV1(
	value: unknown,
): Readonly<WebVcrCaptureStateRequestV1> {
	const candidateState = value && typeof value === 'object'
		? (value as Readonly<{ state?: unknown }>).state : undefined;
	const record = closedRecord(
		value,
		candidateState === 'preparing'
			? ['version', 'sessionId', 'generation', 'state', 'recordingToken']
			: ['version', 'sessionId', 'generation', 'state'],
		'Web VCR capture-state request',
	);
	const reference = validateWebVcrSessionReferenceV1({
		version: record.version,
		sessionId: record.sessionId,
		generation: record.generation,
	});
	if (!['ready', 'preparing', 'recording', 'finalizing', 'recovery'].includes(String(record.state))) {
		throw new TypeError('Web VCR host capture state is invalid.');
	}
	return record.state === 'preparing'
		? Object.freeze({
			...reference,
			state: 'preparing' as const,
			recordingToken: opaqueId(record.recordingToken, 'recording token'),
		})
		: Object.freeze({
			...reference,
			state: record.state as Exclude<WebVcrHostCaptureState, 'preparing'>,
		});
}

export function validateWebVcrDispatchResultV1(value: unknown): Readonly<WebVcrDispatchResultV1> {
	const kind = value && typeof value === 'object' && !Array.isArray(value)
		? (value as Readonly<{ kind?: unknown }>).kind
		: undefined;
	if (kind === 'snapshot') {
		const record = closedRecord(value, ['version', 'kind', 'snapshot'], 'Web VCR dispatch result');
		if (record.version !== 1) throw new TypeError('Web VCR dispatch result version is invalid.');
		return Object.freeze({ version: 1, kind, snapshot: validateWebVcrSnapshotV1(record.snapshot) });
	}
	if (kind === 'data-clear-confirmation') {
		const record = closedRecord(value, [
			'version', 'kind', 'sessionId', 'generation', 'nonce', 'expiresAtMs',
		], 'Web VCR data clear confirmation');
		const reference = validateWebVcrSessionReferenceV1({
			version: record.version,
			sessionId: record.sessionId,
			generation: record.generation,
		});
		return Object.freeze({
			...reference,
			kind,
			nonce: opaqueId(record.nonce, 'data clear confirmation nonce'),
			expiresAtMs: nonnegativeInteger(record.expiresAtMs, 'data clear confirmation expiry'),
		});
	}
	throw new TypeError('Web VCR dispatch result kind is invalid.');
}

export function validateWebVcrNormalizedCropV1(value: unknown): Readonly<WebVcrNormalizedCrop> {
	return normalizeWebVcrNormalizedCrop(value);
}

function validateSurface(
	value: Readonly<{ readonly width: number; readonly height: number }>,
	resolution: WebVcrResolution,
): void {
	const expected = resolution === '720p'
		? { width: 1280, height: 720 }
		: resolution === '1080p'
			? { width: 1920, height: 1080 }
			: { width: 3840, height: 2160 };
	if (value.width !== expected.width || value.height !== expected.height) {
		throw new TypeError('Web VCR capture surface does not match its resolution.');
	}
}

function positiveGeneration(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError('Web VCR generation must be a positive safe integer.');
	}
	return Number(value);
}

function nonnegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`Web VCR ${label} must be a nonnegative safe integer.`);
	}
	return Number(value);
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
		throw new TypeError(`Web VCR ${label} is invalid.`);
	}
	return value;
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a closed data record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

export type WebVcrPhase = WebVcrLifecyclePhase;
