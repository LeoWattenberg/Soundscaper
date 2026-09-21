/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed option admission for the runtime-family router composition boundary. */

import {
	ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS,
	type AssistanceRuntimeFamilyId,
} from './assistance-runtime-family-manifest.ts';
import type { AssistanceRuntimeFamilyRouterOptions } from './assistance-runtime-family-host.ts';

export function assertOptions(
	options: AssistanceRuntimeFamilyRouterOptions,
): void {
	if (!options || typeof options.availability !== 'function'
		|| typeof options.totalMemoryBytes !== 'function' || typeof options.availableMemoryBytes !== 'function') {
		throw new TypeError('The runtime-family router options are incomplete.');
	}
	const port = options.powerEtiquette;
	if (port !== undefined
		&& (!port || typeof port.observe !== 'function' || typeof port.subscribe !== 'function')) {
		throw new TypeError('The runtime-family router power etiquette port is invalid.');
	}
	for (const familyId of Object.keys(ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS) as AssistanceRuntimeFamilyId[]) {
		if (typeof options.spawns?.[familyId] !== 'function') {
			throw new TypeError(`The runtime-family router has no isolated ${familyId} spawn.`);
		}
	}
}

export function boundedOption(
	value: number | undefined,
	fallback: number,
	maximum: number,
	label: string,
): number {
	const admitted = value ?? fallback;
	if (!Number.isSafeInteger(admitted) || admitted < 1 || admitted > maximum) {
		throw new RangeError(`The runtime-family ${label} is invalid.`);
	}
	return admitted;
}
