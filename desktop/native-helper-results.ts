/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Result admission for the native helper's job kinds.
 *
 * A helper result is untrusted input in exactly the way a renderer message is:
 * the helper hosts native code, so main re-validates every field before it
 * reaches anything else. These validators live apart from the contract module
 * so each new job kind adds its admission next to its own surface rather than
 * growing the one wire schema every helper shares.
 */

import { HelperContractViolationError } from './helper-wire-admission.ts';

/** Describes the addon a helper actually loaded, as reported by the addon. */
export interface HelperNativeAddonReport {
	readonly addonVersion: string;
	readonly buildId: string;
	readonly napiVersion: number;
	readonly maximumChannelCount: number;
	readonly maximumFrameCount: number;
}

export interface HelperAudioDeviceOpenResult {
	readonly addon: HelperNativeAddonReport;
	readonly backend: string;
	readonly deviceHandle: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly blockFrames: number;
	readonly blocksRendered: number;
	readonly framesRendered: number;
	/** SHA-256 over the little-endian planar float bytes the engine produced. */
	readonly renderedSha256: string;
}

const ADDON_KEYS = Object.freeze([
	'addonVersion', 'buildId', 'napiVersion', 'maximumChannelCount', 'maximumFrameCount',
]);
const OPEN_RESULT_KEYS = Object.freeze([
	'addon', 'backend', 'deviceHandle', 'sampleRate', 'channelCount',
	'blockFrames', 'blocksRendered', 'framesRendered', 'renderedSha256',
]);
const SHA256 = /^[a-f\d]{64}$/u;
const MAXIMUM_TEXT_BYTES = 256;

export function validateHelperNativeAddonReport(value: unknown): HelperNativeAddonReport {
	const record = plainRecord(value, 'A native addon report');
	exactKeys(record, ADDON_KEYS, 'A native addon report');
	return Object.freeze({
		addonVersion: boundedText(record.addonVersion, MAXIMUM_TEXT_BYTES, 'addon version'),
		buildId: boundedText(record.buildId, MAXIMUM_TEXT_BYTES, 'addon build id'),
		napiVersion: boundedInteger(record.napiVersion, 8, 1_024, 'addon Node-API version'),
		maximumChannelCount: boundedInteger(record.maximumChannelCount, 1, 4_096, 'addon channel ceiling'),
		maximumFrameCount: boundedInteger(record.maximumFrameCount, 1, 1_048_576, 'addon frame ceiling'),
	});
}

export function validateHelperAudioDeviceOpenResult(value: unknown): HelperAudioDeviceOpenResult {
	const record = plainRecord(value, 'A native audio device result');
	exactKeys(record, OPEN_RESULT_KEYS, 'A native audio device result');
	const channelCount = boundedInteger(record.channelCount, 1, 4_096, 'device channel count');
	const blockFrames = boundedInteger(record.blockFrames, 1, 1_048_576, 'device block frames');
	const blocksRendered = boundedInteger(record.blocksRendered, 0, 1_000_000_000, 'rendered block count');
	const framesRendered = boundedInteger(record.framesRendered, 0, Number.MAX_SAFE_INTEGER, 'rendered frame count');
	if (framesRendered !== blocksRendered * blockFrames) {
		throw new HelperContractViolationError('malformed',
			'A native audio device result must render exactly whole blocks.');
	}
	if (typeof record.renderedSha256 !== 'string' || !SHA256.test(record.renderedSha256)) {
		throw new HelperContractViolationError('malformed',
			'A native audio device result must carry a lowercase SHA-256 of the rendered bytes.');
	}
	return Object.freeze({
		addon: validateHelperNativeAddonReport(record.addon),
		backend: boundedText(record.backend, MAXIMUM_TEXT_BYTES, 'device backend'),
		deviceHandle: boundedText(record.deviceHandle, MAXIMUM_TEXT_BYTES, 'device handle'),
		sampleRate: boundedInteger(record.sampleRate, 8_000, 768_000, 'device sample rate'),
		channelCount,
		blockFrames,
		blocksRendered,
		framesRendered,
		renderedSha256: record.renderedSha256,
	});
}

/**
 * Backend availability is an explicit status, never an omission: a backend the
 * platform cannot provide is reported with the exact reason so the surface can
 * tell a user why a device they expect is missing.
 */
export const NATIVE_AUDIO_BACKEND_STATUSES = Object.freeze([
	'available', 'library-absent', 'symbols-absent', 'unsupported-platform', 'server-absent',
] as const);

export type NativeAudioBackendStatus = (typeof NATIVE_AUDIO_BACKEND_STATUSES)[number];
export type NativeAudioDeviceDirection = 'input' | 'output' | 'duplex';

export interface HelperNativeAudioDevice {
	readonly handle: string;
	readonly label: string;
	readonly direction: NativeAudioDeviceDirection;
	/**
	 * How many channels the backend says this device carries. Absent when the
	 * backend reports no topology at all: routing that would pair channels needs
	 * a count it can trust, and a count we invented is worse than none.
	 */
	readonly channelCount?: number;
}

export interface HelperAudioDeviceInventoryResult {
	readonly backend: string;
	readonly status: NativeAudioBackendStatus;
	readonly detail: string;
	readonly devices: readonly HelperNativeAudioDevice[];
}

/** A helper may not answer with an unbounded inventory; main clones the result. */
export const MAXIMUM_NATIVE_AUDIO_DEVICES = 128;

/**
 * Inventory text is bounded in wire bytes — escaping and UTF-8 included —
 * rather than in characters, and the maxima are chosen so a full inventory of
 * maximal rows still fits `MAXIMUM_HELPER_WIRE_MESSAGE_BYTES`. A schema that
 * admits more than the wire carries does not widen the answer: it kills the
 * helper mid-job, and the surface sees a channel fault where it should have
 * seen the devices a machine with many PCM hints actually has.
 */
export const MAXIMUM_NATIVE_AUDIO_DEVICE_TEXT_BYTES = 192;
export const MAXIMUM_NATIVE_AUDIO_INVENTORY_DETAIL_BYTES = 1_024;
export const MAXIMUM_NATIVE_AUDIO_DEVICE_CHANNELS = 4_096;

const INVENTORY_KEYS = Object.freeze(['backend', 'status', 'detail', 'devices']);
const DEVICE_KEYS = Object.freeze(['handle', 'label', 'direction']);
const DEVICE_OPTIONAL_KEYS = Object.freeze(['channelCount']);
const DIRECTIONS = Object.freeze(['input', 'output', 'duplex'] as const);

export function validateHelperAudioDeviceInventoryResult(value: unknown): HelperAudioDeviceInventoryResult {
	const record = plainRecord(value, 'A native audio inventory result');
	exactKeys(record, INVENTORY_KEYS, 'A native audio inventory result');
	const status = record.status;
	if (typeof status !== 'string' || !(NATIVE_AUDIO_BACKEND_STATUSES as readonly string[]).includes(status)) {
		throw new HelperContractViolationError('malformed',
			'A native audio inventory result must carry a known backend status.');
	}
	const devices = record.devices;
	if (!Array.isArray(devices)) {
		throw new HelperContractViolationError('malformed', 'A native audio inventory result must carry its device list.');
	}
	if (devices.length > MAXIMUM_NATIVE_AUDIO_DEVICES) {
		throw new HelperContractViolationError('oversized',
			`A native audio inventory result may name at most ${MAXIMUM_NATIVE_AUDIO_DEVICES} devices.`);
	}
	if (status !== 'available' && devices.length > 0) {
		throw new HelperContractViolationError('malformed',
			'A native audio backend that is not available must publish no devices.');
	}
	const handles = new Set<string>();
	const admitted = devices.map((device) => {
		const entry = plainRecord(device, 'A native audio device');
		exactKeys(entry, DEVICE_KEYS, 'A native audio device', DEVICE_OPTIONAL_KEYS);
		const direction = entry.direction;
		if (typeof direction !== 'string' || !(DIRECTIONS as readonly string[]).includes(direction)) {
			throw new HelperContractViolationError('malformed', 'A native audio device must name a known direction.');
		}
		const handle = boundedText(entry.handle, MAXIMUM_NATIVE_AUDIO_DEVICE_TEXT_BYTES, 'audio device handle');
		if (handles.has(handle)) {
			throw new HelperContractViolationError('malformed',
				'A native audio backend must not report the same device handle twice.');
		}
		handles.add(handle);
		const described = {
			handle,
			label: boundedText(entry.label, MAXIMUM_NATIVE_AUDIO_DEVICE_TEXT_BYTES, 'audio device label'),
			direction: direction as NativeAudioDeviceDirection,
		};
		return Object.freeze(entry.channelCount === undefined ? described : {
			...described,
			channelCount: boundedInteger(entry.channelCount, 1, MAXIMUM_NATIVE_AUDIO_DEVICE_CHANNELS,
				'audio device channel count'),
		});
	});
	const detail = record.detail;
	if (typeof detail !== 'string' || wireTextBytes(detail) > MAXIMUM_NATIVE_AUDIO_INVENTORY_DETAIL_BYTES) {
		throw new HelperContractViolationError('malformed', 'A native audio inventory detail must be bounded text.');
	}
	return Object.freeze({
		backend: boundedText(record.backend, MAXIMUM_TEXT_BYTES, 'audio backend name'),
		status: status as NativeAudioBackendStatus,
		detail,
		devices: Object.freeze(admitted),
	});
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new HelperContractViolationError('malformed', `${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(
	record: Record<string, unknown>,
	keys: readonly string[],
	label: string,
	optional: readonly string[] = [],
): void {
	const present = Object.keys(record);
	if (keys.some((key) => !present.includes(key))
		|| present.some((key) => !keys.includes(key) && !optional.includes(key))) {
		throw new HelperContractViolationError('malformed', `${label} must carry exactly its schema keys.`);
	}
}

function boundedText(value: unknown, maximumBytes: number, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || wireTextBytes(value) > maximumBytes) {
		throw new HelperContractViolationError('malformed', `A helper ${label} must be bounded non-empty text.`);
	}
	return value;
}

/** What one string costs on the wire, JSON escaping and UTF-8 included. */
function wireTextBytes(value: string): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new HelperContractViolationError('malformed', `A helper ${label} is outside its admitted bounds.`);
	}
	return value as number;
}
