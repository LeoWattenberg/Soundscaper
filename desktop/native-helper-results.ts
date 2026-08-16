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
