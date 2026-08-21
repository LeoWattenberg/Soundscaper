/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_WEB_VCR_CAPTURE_GRANT_TTL_MS,
	validateWebVcrSessionReferenceV1,
	type WebVcrCaptureGrantV1,
} from './framescaper-web-vcr-contract.ts';

export interface FramescaperWebVcrCaptureRequestV1 {
	readonly version: 1;
	readonly sessionId: string;
	readonly generation: number;
	readonly userGesture: boolean;
	readonly videoRequested: boolean;
	readonly audioRequested: boolean;
}

export interface FramescaperWebVcrCapturedGuestFrame {
	readonly video: object;
	readonly audio: object;
	readonly enableLocalEcho: false;
}

interface CaptureGrant {
	readonly grantId: string;
	readonly sessionId: string;
	readonly generation: number;
	readonly expiresAtMs: number;
	readonly guestFrame: object;
	consumed: boolean;
}

interface OwnerState {
	generation: number;
	sessionId: string | null;
	grant: CaptureGrant | null;
}

export interface FramescaperWebVcrCaptureAuthorityOptions {
	readonly now: () => number;
	readonly createOpaqueId: () => string;
	readonly onConsumed?: (
		owner: object,
		reference: Readonly<{ readonly version: 1; readonly sessionId: string; readonly generation: number }>,
	) => void;
}

export interface FramescaperWebVcrCaptureAuthorityV1 {
	prepare(
		owner: object,
		guestFrame: object,
		request: unknown,
	): Readonly<WebVcrCaptureGrantV1>;
	consume(owner: object, request: unknown): Readonly<FramescaperWebVcrCapturedGuestFrame> | null;
	consumeCurrent(owner: object, request: unknown): Readonly<FramescaperWebVcrCapturedGuestFrame> | null | undefined;
	hasPending(owner: object): boolean;
	teardown(owner: object, generation: number): boolean;
	revokeOwner(owner: object): boolean;
	dispose(): void;
}

/** Main-only one-shot authority. Guest frame objects never enter a DTO or IPC message. */
export function createFramescaperWebVcrCaptureAuthorityV1(
	value: FramescaperWebVcrCaptureAuthorityOptions,
): Readonly<FramescaperWebVcrCaptureAuthorityV1> {
	const options = validateOptions(value);
	const owners = new Map<object, OwnerState>();
	let disposed = false;

	function prepare(
		ownerValue: object,
		guestFrameValue: object,
		requestValue: unknown,
	): Readonly<WebVcrCaptureGrantV1> {
		assertOperational();
		const owner = reference(ownerValue, 'capture owner');
		const guestFrame = reference(guestFrameValue, 'guest frame');
		const request = validateWebVcrSessionReferenceV1(requestValue);
		const state = ownerState(owner);
		currentGrant(state, options.now());
		if (request.generation < state.generation
			|| (request.generation === state.generation && state.sessionId !== request.sessionId)) {
			throw new Error('Web VCR capture preparation requires the current session or a newer generation.');
		}
		if (state.grant && request.generation === state.generation) {
			throw new Error('Web VCR capture preparation already has a live one-shot grant.');
		}
		const grant: CaptureGrant = {
			grantId: opaqueId(options.createOpaqueId()),
			sessionId: request.sessionId,
			generation: request.generation,
			expiresAtMs: expiry(options.now(), FRAMESCAPER_WEB_VCR_CAPTURE_GRANT_TTL_MS),
			guestFrame,
			consumed: false,
		};
		state.generation = request.generation;
		state.sessionId = request.sessionId;
		state.grant = grant;
		return Object.freeze({
			version: 1,
			grantId: grant.grantId,
			sessionId: grant.sessionId,
			generation: grant.generation,
			expiresAtMs: grant.expiresAtMs,
		});
	}

	function consume(
		ownerValue: object,
		requestValue: unknown,
	): Readonly<FramescaperWebVcrCapturedGuestFrame> | null {
		if (disposed) return null;
		const owner = optionalReference(ownerValue);
		const request = captureRequest(requestValue);
		if (!owner || !request) return null;
		const state = owners.get(owner);
		const grant = currentGrant(state, options.now());
		if (!grant || grant.sessionId !== request.sessionId || grant.generation !== request.generation
			|| request.userGesture !== true || request.videoRequested !== true
			|| request.audioRequested !== true) return null;
		return consumeGrant(owner, state!, grant);
	}

	function consumeCurrent(
		ownerValue: object,
		requestValue: unknown,
	): Readonly<FramescaperWebVcrCapturedGuestFrame> | null | undefined {
		if (disposed) return undefined;
		const owner = optionalReference(ownerValue);
		const request = displayRequest(requestValue);
		if (!owner || !request) return null;
		const state = owners.get(owner);
		const grant = currentGrant(state, options.now());
		if (!grant) return undefined;
		if (!request.userGesture || !request.videoRequested || !request.audioRequested) return null;
		return consumeGrant(owner, state!, grant);
	}

	function teardown(ownerValue: object, generationValue: number): boolean {
		if (disposed) return false;
		const owner = optionalReference(ownerValue);
		if (!owner || !Number.isSafeInteger(generationValue) || generationValue <= 0) return false;
		const state = owners.get(owner);
		const grant = currentGrant(state, options.now());
		if (!grant || grant.generation !== generationValue) return false;
		state!.grant = null;
		return true;
	}

	return Object.freeze({
		prepare,
		consume,
		consumeCurrent,
		hasPending(ownerValue: object): boolean {
			if (disposed) return false;
			const owner = optionalReference(ownerValue);
			return Boolean(owner && currentGrant(owners.get(owner), options.now()));
		},
		teardown,
		revokeOwner(ownerValue: object): boolean {
			if (disposed) return false;
			const owner = optionalReference(ownerValue);
			return owner ? owners.delete(owner) : false;
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			owners.clear();
		},
	});

	function assertOperational(): void {
		if (disposed) throw new Error('Web VCR capture authority is disposed.');
	}

	function ownerState(owner: object): OwnerState {
		let state = owners.get(owner);
		if (!state) {
			state = { generation: 0, sessionId: null, grant: null };
			owners.set(owner, state);
		}
		return state;
	}

	function consumeGrant(
		owner: object,
		state: OwnerState,
		grant: CaptureGrant,
	): Readonly<FramescaperWebVcrCapturedGuestFrame> {
		grant.consumed = true;
		state.grant = null;
		try {
			options.onConsumed?.(owner, Object.freeze({
				version: 1,
				sessionId: grant.sessionId,
				generation: grant.generation,
			}));
		} catch {
			// Delivery remains authoritative even if an observational lifecycle callback fails.
		}
		return Object.freeze({
			video: grant.guestFrame,
			audio: grant.guestFrame,
			enableLocalEcho: false,
		});
	}
}

function validateOptions(value: FramescaperWebVcrCaptureAuthorityOptions): FramescaperWebVcrCaptureAuthorityOptions {
	if (!value || typeof value !== 'object' || typeof value.now !== 'function'
		|| typeof value.createOpaqueId !== 'function'
		|| (value.onConsumed !== undefined && typeof value.onConsumed !== 'function')) {
		throw new TypeError('Web VCR capture authority seams are invalid.');
	}
	return value;
}

function displayRequest(value: unknown): Readonly<{
	readonly userGesture: boolean;
	readonly videoRequested: boolean;
	readonly audioRequested: boolean;
}> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const fields = ['userGesture', 'videoRequested', 'audioRequested'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) return null;
	const record = value as Readonly<Record<string, unknown>>;
	if (typeof record.userGesture !== 'boolean' || typeof record.videoRequested !== 'boolean'
		|| typeof record.audioRequested !== 'boolean') return null;
	return Object.freeze({
		userGesture: record.userGesture,
		videoRequested: record.videoRequested,
		audioRequested: record.audioRequested,
	});
}

function captureRequest(value: unknown): Readonly<FramescaperWebVcrCaptureRequestV1> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const keys = Reflect.ownKeys(value);
	const fields = [
		'version', 'sessionId', 'generation', 'userGesture', 'videoRequested', 'audioRequested',
	];
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) return null;
	const record = value as Readonly<Record<string, unknown>>;
	let referenceValue: Readonly<{ sessionId: string; generation: number }>;
	try {
		referenceValue = validateWebVcrSessionReferenceV1({
			version: record.version,
			sessionId: record.sessionId,
			generation: record.generation,
		});
	} catch {
		return null;
	}
	if (typeof record.userGesture !== 'boolean' || typeof record.videoRequested !== 'boolean'
		|| typeof record.audioRequested !== 'boolean') return null;
	return Object.freeze({
		version: 1,
		...referenceValue,
		userGesture: record.userGesture,
		videoRequested: record.videoRequested,
		audioRequested: record.audioRequested,
	});
}

function currentGrant(state: OwnerState | undefined, nowMs: number): CaptureGrant | null {
	if (!state?.grant) return null;
	if (state.grant.consumed || !Number.isSafeInteger(nowMs) || nowMs >= state.grant.expiresAtMs) {
		state.grant = null;
		return null;
	}
	return state.grant;
}

function expiry(nowMs: number, ttlMs: number): number {
	if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > Number.MAX_SAFE_INTEGER - ttlMs) {
		throw new RangeError('Web VCR capture clock is invalid.');
	}
	return nowMs + ttlMs;
}

function reference(value: unknown, label: string): object {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
		throw new TypeError(`Web VCR ${label} must be a reference.`);
	}
	return value;
}

function optionalReference(value: unknown): object | null {
	return value && (typeof value === 'object' || typeof value === 'function') ? value : null;
}

function opaqueId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) {
		throw new TypeError('Web VCR opaque identity is invalid.');
	}
	return value;
}
