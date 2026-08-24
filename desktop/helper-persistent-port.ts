/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed descriptor for long-lived audio and plug-in RPC MessagePorts. */

import { HelperContractViolationError, assertHelperWireEnvelope } from './helper-wire-admission.ts';

export const HELPER_PERSISTENT_PORT_CONTRACT_VERSION = 1;
export const HELPER_PERSISTENT_PORT_PURPOSES = Object.freeze(['audio-realtime', 'plugin-rpc'] as const);
export const HELPER_PERSISTENT_PORT_MAXIMUM_MESSAGE_BYTES = 16 * 1024 * 1024;
export const HELPER_PERSISTENT_PORT_MAXIMUM_IN_FLIGHT_MESSAGES = 8;

export type HelperPersistentPortPurpose = (typeof HELPER_PERSISTENT_PORT_PURPOSES)[number];

export interface HelperPersistentPortBinding {
	readonly portContractVersion: typeof HELPER_PERSISTENT_PORT_CONTRACT_VERSION;
	readonly transport: 'message-port';
	readonly purpose: HelperPersistentPortPurpose;
	readonly streamId: string;
	readonly generation: number;
	readonly maximumMessageBytes: number;
	readonly maximumInFlightMessages: number;
}

const KEYS = Object.freeze([
	'portContractVersion', 'transport', 'purpose', 'streamId', 'generation',
	'maximumMessageBytes', 'maximumInFlightMessages',
]);
const STREAM_ID = /^[a-f0-9]{40}$/u;

export function validateHelperPersistentPortBinding(
	value: unknown,
	purpose: HelperPersistentPortPurpose,
): HelperPersistentPortBinding {
	assertHelperWireEnvelope(value);
	if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) {
		return unsafe('A helper persistent-port binding must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const present = Object.keys(record);
	if (present.length !== KEYS.length || present.some((key) => !KEYS.includes(key))) {
		return unsafe('A helper persistent-port binding must carry exactly its schema keys.');
	}
	if (record.portContractVersion !== HELPER_PERSISTENT_PORT_CONTRACT_VERSION
		|| record.transport !== 'message-port' || record.purpose !== purpose) {
		return unsafe(`A helper persistent port must name the ${purpose} contract-v1 MessagePort transport.`);
	}
	if (typeof record.streamId !== 'string' || !STREAM_ID.test(record.streamId)) {
		return unsafe('A helper persistent port needs a fixed lowercase-hex stream id.');
	}
	if (!Number.isSafeInteger(record.generation) || (record.generation as number) < 1) {
		return unsafe('A helper persistent port needs a positive generation.');
	}
	if (!Number.isSafeInteger(record.maximumMessageBytes) || (record.maximumMessageBytes as number) < 1
		|| (record.maximumMessageBytes as number) > HELPER_PERSISTENT_PORT_MAXIMUM_MESSAGE_BYTES) {
		return unsafe('A helper persistent-port message bound exceeds its hard maximum.');
	}
	if (!Number.isSafeInteger(record.maximumInFlightMessages)
		|| (record.maximumInFlightMessages as number) < 1
		|| (record.maximumInFlightMessages as number) > HELPER_PERSISTENT_PORT_MAXIMUM_IN_FLIGHT_MESSAGES) {
		return unsafe('A helper persistent-port backpressure window exceeds its hard maximum.');
	}
	return Object.freeze({
		portContractVersion: HELPER_PERSISTENT_PORT_CONTRACT_VERSION,
		transport: 'message-port',
		purpose,
		streamId: record.streamId,
		generation: record.generation as number,
		maximumMessageBytes: record.maximumMessageBytes as number,
		maximumInFlightMessages: record.maximumInFlightMessages as number,
	});
}

function unsafe(message: string): never {
	throw new HelperContractViolationError('unsafe-grant', message);
}
