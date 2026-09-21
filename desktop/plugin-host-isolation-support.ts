/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pure admission and projection helpers for the plug-in host isolation registry. */

import {
	HELPER_EFFECT_PLUGIN_FORMATS,
	type HelperEffectPluginFormat,
} from './helper-job-grant.ts';
import { HelperContractViolationError } from './helper-wire-admission.ts';
import type { PluginHostStopReason } from './plugin-instance-state.ts';
import type {
	PluginHostRefusal,
	PluginHostRefusalCode,
	PluginHostStopOutcome,
} from './plugin-host-isolation.ts';

const SHA256 = /^[a-f0-9]{64}$/u;

export function stopOutcome(
	hostId: string, reason: PluginHostStopReason, qualifyingFault: boolean,
	quarantined: boolean, instanceIds: readonly string[],
): PluginHostStopOutcome {
	return Object.freeze({
		hostId, reason, qualifyingFault, quarantined, instanceIds: Object.freeze([...instanceIds]),
	});
}

export function refused(code: PluginHostRefusalCode, message: string): PluginHostRefusal {
	return Object.freeze({ status: 'refused' as const, code, message });
}

export function assertBinaryDigest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new HelperContractViolationError('unsafe-grant',
			'A plug-in host request must name its binary by lowercase SHA-256 digest.');
	}
	return value;
}

export function assertPluginFormat(value: unknown): HelperEffectPluginFormat {
	if (typeof value !== 'string' || !(HELPER_EFFECT_PLUGIN_FORMATS as readonly string[]).includes(value)) {
		throw new HelperContractViolationError('unsafe-grant', 'A plug-in host request must name a supported format.');
	}
	return value as HelperEffectPluginFormat;
}

export function safely(operation: () => void): void {
	// A host that is already gone cannot fail harder for being told again: the
	// teardown was the point, and there is no reply left to act on.
	try {
		operation();
	} catch (_error) { /* deliberately not surfaced */ }
}

export function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
