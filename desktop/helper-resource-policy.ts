/* SPDX-License-Identifier: AGPL-3.0-only */

/** Lower-only resource ceilings and closed wire admission for helper jobs. */

import { admitLowerOnly } from '../src/common/editor/lower-only-seam.ts';
import type { HelperJobKind } from './helper-job-subcontract.ts';
import { HelperContractViolationError } from './helper-wire-admission.ts';

export const HELPER_RESOURCE_HARD_LIMITS = Object.freeze({
	maximumInputBytes: 4 * 1024 ** 3,
	maximumJobDurationMs: 10 * 60 * 1_000,
	maximumRssBytes: 1024 ** 3,
	maximumConcurrentJobs: 1,
});

export const HELPER_JOB_DURATION_HARD_LIMITS = Object.freeze({
	'probe-video-source': 10 * 60_000,
	'audio-device': 24 * 60 * 60_000,
	'plugin-scan': 60 * 60_000,
	'plugin-host': 24 * 60 * 60_000,
	'media-decode': 24 * 60 * 60_000,
	'media-encode': 24 * 60 * 60_000,
	'media-render': 24 * 60 * 60_000,
	'media-proxy': 24 * 60 * 60_000,
	'ofx-scan': 60 * 60_000,
	'ofx-host': 24 * 60 * 60_000,
	'assistance-speech': 24 * 60 * 60_000,
} as const satisfies Readonly<Record<HelperJobKind, number>>);

const MAXIMUM_NATIVE_FILE_BYTES = 16 * 1024 ** 4;
const MAXIMUM_NATIVE_OFX_BYTES = 64 * 1024 ** 3;
const NATIVE_JOB_LIMITS = Object.freeze({
	maximumInputBytes: MAXIMUM_NATIVE_FILE_BYTES,
	maximumOutputBytes: MAXIMUM_NATIVE_FILE_BYTES,
	maximumScratchBytes: MAXIMUM_NATIVE_FILE_BYTES,
	maximumDataPlaneBytes: MAXIMUM_NATIVE_FILE_BYTES,
	maximumInFlightChunks: 8,
	maximumRssBytes: HELPER_RESOURCE_HARD_LIMITS.maximumRssBytes,
});
const OFX_JOB_LIMITS = Object.freeze({
	maximumInputBytes: MAXIMUM_NATIVE_OFX_BYTES,
	maximumOutputBytes: MAXIMUM_NATIVE_OFX_BYTES,
	maximumScratchBytes: MAXIMUM_NATIVE_OFX_BYTES,
	maximumDataPlaneBytes: MAXIMUM_NATIVE_OFX_BYTES,
	maximumInFlightChunks: 8,
	maximumRssBytes: HELPER_RESOURCE_HARD_LIMITS.maximumRssBytes,
});

export const HELPER_JOB_RESOURCE_HARD_LIMITS = Object.freeze({
	'probe-video-source': legacyLimits('probe-video-source'),
	'audio-device': legacyLimits('audio-device'),
	'plugin-scan': legacyLimits('plugin-scan'),
	'plugin-host': legacyLimits('plugin-host'),
	'media-decode': nativeLimits('media-decode'),
	'media-encode': nativeLimits('media-encode'),
	'media-render': nativeLimits('media-render'),
	'media-proxy': nativeLimits('media-proxy'),
	'ofx-scan': ofxLimits('ofx-scan'),
	'ofx-host': ofxLimits('ofx-host'),
	'assistance-speech': legacyLimits('assistance-speech'),
} as const satisfies Readonly<Record<HelperJobKind, Readonly<{
	maximumInputBytes: number;
	maximumJobDurationMs: number;
	maximumRssBytes: number;
}>>>);

export interface HelperJobResourcePolicy {
	readonly maximumInputBytes: number;
	readonly maximumJobDurationMs: number;
	readonly maximumRssBytes: number;
	readonly maximumOutputBytes?: number;
	readonly maximumScratchBytes?: number;
	readonly maximumDataPlaneBytes?: number;
	readonly maximumInFlightChunks?: number;
	readonly allowNetwork: false;
	readonly allowChildProcesses: false;
	readonly allowOutputFiles: false;
}

export function normalizeHelperResourcePolicy(
	value?: Partial<HelperJobResourcePolicy>,
	kind: HelperJobKind = 'probe-video-source',
): HelperJobResourcePolicy {
	if (!Object.hasOwn(HELPER_JOB_RESOURCE_HARD_LIMITS, kind)) {
		throw new RangeError('Helper resource policy requires a known control-v1 job kind.');
	}
	const hard = HELPER_JOB_RESOURCE_HARD_LIMITS[kind];
	const base = {
		maximumInputBytes: lowerOnlyLimit(value?.maximumInputBytes, hard.maximumInputBytes, 'input bytes'),
		maximumJobDurationMs: lowerOnlyLimit(value?.maximumJobDurationMs, hard.maximumJobDurationMs, 'job duration'),
		maximumRssBytes: lowerOnlyLimit(value?.maximumRssBytes, hard.maximumRssBytes, 'peak RSS'),
		allowNetwork: denyOnly(value?.allowNetwork, 'network'),
		allowChildProcesses: denyOnly(value?.allowChildProcesses, 'child-process'),
		allowOutputFiles: denyOnly(value?.allowOutputFiles, 'output-file'),
	};
	if (!('maximumOutputBytes' in hard)) return Object.freeze(base);
	return Object.freeze({
		...base,
		maximumOutputBytes: lowerOnlyLimit(value?.maximumOutputBytes, hard.maximumOutputBytes, 'output bytes'),
		maximumScratchBytes: lowerOnlyLimit(value?.maximumScratchBytes, hard.maximumScratchBytes, 'scratch bytes'),
		maximumDataPlaneBytes: lowerOnlyLimit(
			value?.maximumDataPlaneBytes, hard.maximumDataPlaneBytes, 'data-plane bytes',
		),
		maximumInFlightChunks: lowerOnlyLimit(
			value?.maximumInFlightChunks, hard.maximumInFlightChunks, 'in-flight chunks',
		),
	});
}

export function validateHelperWireResourcePolicy(value: unknown, kind: HelperJobKind): HelperJobResourcePolicy {
	if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) {
		throw malformed('A helper resource policy must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const required = ['maximumInputBytes', 'maximumJobDurationMs', 'maximumRssBytes'];
	const optional = 'maximumOutputBytes' in HELPER_JOB_RESOURCE_HARD_LIMITS[kind]
		? [
			'allowNetwork', 'allowChildProcesses', 'allowOutputFiles',
			'maximumOutputBytes', 'maximumScratchBytes', 'maximumDataPlaneBytes', 'maximumInFlightChunks',
		]
		: ['allowNetwork', 'allowChildProcesses', 'allowOutputFiles'];
	const present = Object.keys(record);
	if (required.some((key) => !present.includes(key))
		|| present.some((key) => !required.includes(key) && !optional.includes(key))) {
		throw malformed('A helper wire resource policy carries unsupported or missing keys.');
	}
	try {
		return normalizeHelperResourcePolicy(record as Partial<HelperJobResourcePolicy>, kind);
	} catch (error) {
		throw malformed(error instanceof Error ? error.message : String(error));
	}
}

function legacyLimits(kind: HelperJobKind) {
	return Object.freeze({ ...HELPER_RESOURCE_HARD_LIMITS, maximumJobDurationMs: HELPER_JOB_DURATION_HARD_LIMITS[kind] });
}

function nativeLimits(kind: HelperJobKind) {
	return Object.freeze({ ...NATIVE_JOB_LIMITS, maximumJobDurationMs: HELPER_JOB_DURATION_HARD_LIMITS[kind] });
}

function ofxLimits(kind: HelperJobKind) {
	return Object.freeze({ ...OFX_JOB_LIMITS, maximumJobDurationMs: HELPER_JOB_DURATION_HARD_LIMITS[kind] });
}

function lowerOnlyLimit(value: unknown, hardMaximum: number, label: string): number {
	return admitLowerOnly(value, {
		ceiling: hardMaximum,
		floor: 1,
		absent: 'ceiling',
		refuse: () => new RangeError(
			`Helper ${label} must be a lower-only safe integer no greater than ${hardMaximum}.`,
		),
	});
}

function denyOnly(value: unknown, label: string): false {
	if (value !== undefined && value !== false) {
		throw new RangeError(`Helper ${label} authority is deny-only in control contract v1.`);
	}
	return false;
}

function malformed(message: string): HelperContractViolationError {
	return new HelperContractViolationError('malformed', message);
}
