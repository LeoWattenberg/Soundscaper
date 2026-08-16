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
const MAXIMUM_TEXT_LENGTH = 256;

export function validateHelperNativeAddonReport(value: unknown): HelperNativeAddonReport {
	const record = plainRecord(value, 'A native addon report');
	exactKeys(record, ADDON_KEYS, 'A native addon report');
	return Object.freeze({
		addonVersion: boundedText(record.addonVersion, 'addon version'),
		buildId: boundedText(record.buildId, 'addon build id'),
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
		backend: boundedText(record.backend, 'device backend'),
		deviceHandle: boundedText(record.deviceHandle, 'device handle'),
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
}

export interface HelperAudioDeviceInventoryResult {
	readonly backend: string;
	readonly status: NativeAudioBackendStatus;
	readonly detail: string;
	readonly devices: readonly HelperNativeAudioDevice[];
}

/** A helper may not answer with an unbounded inventory; main clones the result. */
export const MAXIMUM_NATIVE_AUDIO_DEVICES = 128;

const INVENTORY_KEYS = Object.freeze(['backend', 'status', 'detail', 'devices']);
const DEVICE_KEYS = Object.freeze(['handle', 'label', 'direction']);
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
		exactKeys(entry, DEVICE_KEYS, 'A native audio device');
		const direction = entry.direction;
		if (typeof direction !== 'string' || !(DIRECTIONS as readonly string[]).includes(direction)) {
			throw new HelperContractViolationError('malformed', 'A native audio device must name a known direction.');
		}
		const handle = boundedText(entry.handle, 'audio device handle');
		if (handles.has(handle)) {
			throw new HelperContractViolationError('malformed',
				'A native audio backend must not report the same device handle twice.');
		}
		handles.add(handle);
		return Object.freeze({
			handle,
			label: boundedText(entry.label, 'audio device label'),
			direction: direction as NativeAudioDeviceDirection,
		});
	});
	return Object.freeze({
		backend: boundedText(record.backend, 'audio backend name'),
		status: status as NativeAudioBackendStatus,
		detail: typeof record.detail === 'string' && record.detail.length <= 1_024
			? record.detail
			: (() => {
				throw new HelperContractViolationError('malformed',
					'A native audio inventory detail must be bounded text.');
			})(),
		devices: Object.freeze(admitted),
	});
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new HelperContractViolationError('malformed', `${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw new HelperContractViolationError('malformed', `${label} must carry exactly its schema keys.`);
	}
}

function boundedText(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > MAXIMUM_TEXT_LENGTH) {
		throw new HelperContractViolationError('malformed', `A helper ${label} must be bounded non-empty text.`);
	}
	return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new HelperContractViolationError('malformed', `A helper ${label} is outside its admitted bounds.`);
	}
	return value as number;
}
