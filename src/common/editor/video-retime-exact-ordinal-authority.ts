/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoRetimeExactOrdinalOracle,
	type VideoRetimeExactOrdinalOracle,
	type VideoRetimeExactOutputOrdinal,
	type VideoRetimeExactPictureOrdinal,
} from './video-retime-exact-ordinal-oracle.ts';
import type { BoundVideoSourceTimingView } from './video-source-timing-view.ts';

/** Opaque capability shared by every candidate preview, export, and Retimer consumer. */
export interface VideoRetimeExactOrdinalAuthority {
	readonly outputFrameCount: number;
}

export interface VideoRetimeExactPictureRequest {
	readonly outputOrdinal: number;
	readonly clipId: string;
	readonly sourceId: string;
}

interface AuthorityState {
	readonly oracle: VideoRetimeExactOrdinalOracle;
}

const AUTHORITY_STATES = new WeakMap<object, AuthorityState>();
const REQUEST_KEYS = Object.freeze(['outputOrdinal', 'clipId', 'sourceId']);

/**
 * Admit and capture the V16 intent once. The returned object intentionally has
 * no public `frameAt` seam: consumers must authenticate it here before the
 * private oracle can be queried.
 */
export function createVideoRetimeExactOrdinalAuthority(
	intent: unknown,
	timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>,
): VideoRetimeExactOrdinalAuthority {
	const oracle = createVideoRetimeExactOrdinalOracle(intent, timingBySourceId);
	const authority = Object.freeze({ outputFrameCount: oracle.outputFrameCount });
	AUTHORITY_STATES.set(authority, Object.freeze({ oracle }));
	return authority;
}

export function assertVideoRetimeExactOrdinalAuthority(
	value: unknown,
): asserts value is VideoRetimeExactOrdinalAuthority {
	if (!value || typeof value !== 'object' || !AUTHORITY_STATES.has(value)) {
		throw new TypeError('An authenticated exact ordinal authority is required.');
	}
}

/** Resolve one output ordinal without exposing or copying an output-sized schedule. */
export function resolveVideoRetimeExactOutputOrdinal(
	authority: VideoRetimeExactOrdinalAuthority,
	outputOrdinal: number,
): VideoRetimeExactOutputOrdinal {
	return authorityState(authority).oracle.frameAt(outputOrdinal);
}

/** Select one exact picture by all three identities; ambiguity fails closed. */
export function resolveVideoRetimeExactPictureOrdinal(
	authority: VideoRetimeExactOrdinalAuthority,
	requestValue: VideoRetimeExactPictureRequest,
): VideoRetimeExactPictureOrdinal {
	const request = pictureRequest(requestValue);
	const frame = authorityState(authority).oracle.frameAt(request.outputOrdinal);
	const matching = frame.pictures.filter((picture) => (
		picture.clipId === request.clipId && picture.sourceId === request.sourceId
	));
	if (matching.length !== 1) {
		throw new ReferenceError('An exact picture request requires one authority-owned binding.');
	}
	return matching[0]!;
}

function authorityState(value: unknown): AuthorityState {
	assertVideoRetimeExactOrdinalAuthority(value);
	return AUTHORITY_STATES.get(value)!;
}

function pictureRequest(value: unknown): VideoRetimeExactPictureRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('An exact picture request must be a closed plain-data record.');
	}
	const record = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== REQUEST_KEYS.length
		|| keys.some((key) => typeof key !== 'string' || !REQUEST_KEYS.includes(key))) {
		throw new TypeError('An exact picture request has an invalid closed shape.');
	}
	const read = (key: string): unknown => {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`An exact picture request.${key} must be an enumerable data field.`);
		}
		return descriptor.value;
	};
	const outputOrdinal = read('outputOrdinal');
	const clipId = read('clipId');
	const sourceId = read('sourceId');
	if (!Number.isSafeInteger(outputOrdinal) || Number(outputOrdinal) < 0) {
		throw new RangeError('An exact picture outputOrdinal must be a non-negative safe integer.');
	}
	if (typeof clipId !== 'string' || clipId.length < 1 || clipId.length > 4_096
		|| typeof sourceId !== 'string' || sourceId.length < 1 || sourceId.length > 4_096) {
		throw new TypeError('An exact picture request requires bounded clip and source identities.');
	}
	return Object.freeze({ outputOrdinal: Number(outputOrdinal), clipId, sourceId });
}
