/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Structural admission shared by both directions of the helper control wire.
 * It measures the exact JSON representation of the closed control domain
 * without invoking untrusted accessors. Uint8Array contents are bulk data:
 * their descriptor contributes to the control-envelope measurement and their
 * bytes are bounded separately by the timing-asset ceiling.
 */

import { VIDEO_TIMING_ASSET_MAXIMUM_BYTES } from '../src/common/editor/video-timing-asset-reference.ts';

export const MAXIMUM_HELPER_WIRE_MESSAGE_BYTES = 64 * 1024;
const MAXIMUM_HELPER_WIRE_DEPTH = 64;

export type HelperContractViolationCode =
	| 'malformed'
	| 'oversized'
	| 'unsupported-version'
	| 'unknown-kind'
	| 'unsafe-grant'
	| 'wrong-direction';

export class HelperContractViolationError extends Error {
	readonly code: HelperContractViolationCode;

	constructor(code: HelperContractViolationCode, message: string) {
		super(message);
		this.name = 'HelperContractViolationError';
		this.code = code;
	}
}

interface AdmissionState {
	controlBytes: number;
	binaryBytes: number;
	readonly ancestors: Set<object>;
}

/** Admit and globally bound one complete host or process control message. */
export function assertHelperWireEnvelope(value: unknown): void {
	measure(value, { controlBytes: 0, binaryBytes: 0, ancestors: new Set<object>() }, 0);
}

function measure(value: unknown, state: AdmissionState, depth: number): void {
	if (depth > MAXIMUM_HELPER_WIRE_DEPTH) {
		malformed('A helper wire message exceeds the control nesting limit.');
	}
	if (value === null) {
		addControlBytes(state, 4);
		return;
	}
	if (typeof value === 'string') {
		addControlBytes(state, utf8ByteLength(JSON.stringify(value)));
		return;
	}
	if (typeof value === 'boolean') {
		addControlBytes(state, value ? 4 : 5);
		return;
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) malformed('Helper wire numbers must be finite.');
		addControlBytes(state, String(JSON.stringify(value)).length);
		return;
	}
	if (typeof value !== 'object') {
		malformed('A helper wire message contains a value outside the structured control domain.');
	}
	if (value instanceof Uint8Array) {
		measureBinary(value, state);
		return;
	}
	if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
		malformed('Only Uint8Array bulk values are admitted on the helper wire.');
	}
	const object = value as object;
	if (state.ancestors.has(object)) malformed('A helper wire message must not contain cycles.');
	state.ancestors.add(object);
	try {
		if (Array.isArray(value)) measureArray(value, state, depth);
		else measureRecord(object, state, depth);
	} finally {
		state.ancestors.delete(object);
	}
}

function measureBinary(value: Uint8Array, state: AdmissionState): void {
	if (Object.getPrototypeOf(value) !== Uint8Array.prototype) {
		malformed('A helper bulk value must be an ordinary Uint8Array.');
	}
	if (typeof SharedArrayBuffer === 'function' && value.buffer instanceof SharedArrayBuffer) {
		malformed('Shared memory is not admitted on the helper control wire.');
	}
	if (!(value.buffer instanceof ArrayBuffer)) {
		malformed('A helper bulk value must not use shared backing memory.');
	}
	if (value.buffer.byteLength > VIDEO_TIMING_ASSET_MAXIMUM_BYTES) {
		throw new HelperContractViolationError('oversized', 'Helper binary backing storage exceeds its separate byte bound.');
	}
	if (value.byteOffset !== 0 || value.buffer.byteLength !== value.byteLength) {
		malformed('A helper bulk value must tightly cover its backing storage.');
	}
	if (value.byteLength > VIDEO_TIMING_ASSET_MAXIMUM_BYTES
		|| state.binaryBytes + value.byteLength > VIDEO_TIMING_ASSET_MAXIMUM_BYTES) {
		throw new HelperContractViolationError('oversized', 'Helper binary content exceeds its separate byte bound.');
	}
	state.binaryBytes += value.byteLength;
	addControlBytes(state, utf8ByteLength(
		`{"$binary":"Uint8Array","byteLength":${String(value.byteLength)}}`,
	));
}

function measureArray(value: unknown[], state: AdmissionState, depth: number): void {
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		malformed('A helper wire array must use the ordinary array prototype.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) {
		malformed('A helper wire array must be dense and carry no symbols or extra fields.');
	}
	addControlBytes(state, 1);
	for (let index = 0; index < value.length; index += 1) {
		if (index > 0) addControlBytes(state, 1);
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
			malformed('A helper wire array must contain only enumerable data entries.');
		}
		measure(descriptor.value, state, depth + 1);
	}
	addControlBytes(state, 1);
}

function measureRecord(value: object, state: AdmissionState, depth: number): void {
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		malformed('A helper wire record must use a plain or null prototype.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key === 'symbol')) {
		malformed('A helper wire record must not carry symbol keys.');
	}
	if (keys.length * 3 > MAXIMUM_HELPER_WIRE_MESSAGE_BYTES) {
		throw new HelperContractViolationError('oversized', 'A helper wire message exceeds the control-envelope byte bound.');
	}
	addControlBytes(state, 1);
	for (const [index, key] of (keys as string[]).entries()) {
		if (index > 0) addControlBytes(state, 1);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
			malformed('A helper wire record must contain only enumerable data properties.');
		}
		addControlBytes(state, utf8ByteLength(JSON.stringify(key)) + 1);
		measure(descriptor.value, state, depth + 1);
	}
	addControlBytes(state, 1);
}

function addControlBytes(state: AdmissionState, bytes: number): void {
	state.controlBytes += bytes;
	if (state.controlBytes > MAXIMUM_HELPER_WIRE_MESSAGE_BYTES) {
		throw new HelperContractViolationError('oversized', 'A helper wire message exceeds the control-envelope byte bound.');
	}
}

function malformed(message: string): never {
	throw new HelperContractViolationError('malformed', message);
}

function utf8ByteLength(value: string): number {
	let bytes = 0;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.codePointAt(index) as number;
		if (code > 0xffff) index += 1;
		bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
	}
	return bytes;
}
