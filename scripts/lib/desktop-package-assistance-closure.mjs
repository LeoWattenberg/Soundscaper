/* SPDX-License-Identifier: AGPL-3.0-only */

import { ASSISTANCE_TARGET_STATUSES } from '../../desktop/assistance-native-runtime-payload.mjs';

/**
 * A built assistance row stages its whole file closure under one prefix, and a
 * row that is not built stages nothing at all.
 *
 * The manifest admits three statuses for a target, and only one of them means a
 * payload exists. Naming a smaller set here refuses a target the manifest
 * itself considers valid: Windows ARM64 is pending-external because no upstream
 * build exists for it, and packaging it failed while Windows x64 succeeded from
 * the same run. The set has one owner so the two gates cannot drift apart.
 */
export function assertAssistanceNativeRuntimeClosure({ assistance, target, requireFile }) {
	if (!plainRecord(assistance) || assistance.target !== target) {
		throw new Error('The desktop runtime manifest has no exact assistance payload authority.');
	}
	if (assistance.status !== 'built') {
		if (!ASSISTANCE_TARGET_STATUSES.includes(assistance.status) || assistance.payload !== null) {
			throw new Error('The desktop runtime manifest has invalid assistance target state.');
		}
		return;
	}
	const prefix = `runtime/${assistance.payload?.root}/`;
	if (!plainRecord(assistance.payload?.files)) {
		throw new Error('The assistance runtime manifest has no exact file closure.');
	}
	for (const [name, descriptor] of Object.entries(assistance.payload.files)) {
		requireFile(`${prefix}${name}`, descriptor, `assistance runtime file ${name}`, prefix);
	}
}

function plainRecord(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
