/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

const MAXIMUM_BUNDLE_DESCRIPTORS = 256;
const MAXIMUM_STABLE_ID_LENGTH = 256;

/** Normalize the complete format-native descriptor set reported for one body. */
export function admitPluginBundleStableIds(value: unknown, member: string): readonly string[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAXIMUM_BUNDLE_DESCRIPTORS
		|| value.some((entry) => typeof entry !== 'string' || entry.length < 1
			|| entry.length > MAXIMUM_STABLE_ID_LENGTH || entry.includes('\0'))) {
		throw new TypeError('A plug-in bundle must carry its bounded format-native descriptor IDs.');
	}
	const stableIds = [...value] as string[];
	stableIds.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
	if (new Set(stableIds).size !== stableIds.length || !stableIds.includes(member)) {
		throw new TypeError('A plug-in bundle descriptor set must be unique and contain this descriptor.');
	}
	return Object.freeze(stableIds);
}

/** Exact binary claim: the same bytes may expose this whole set, never a later subset or superset. */
export function pluginBundleIdentityClaim(format: string, stableIds: readonly string[]): string {
	return `${format}\0${stableIds.join('\0')}`;
}

/** Descriptor-specific even when two effects share one authenticated binary body. */
export function installationIdFor(binarySha256: string, stableId: string): string {
	return `i${createHash('sha256').update(`${binarySha256}\0${stableId}`).digest('hex').slice(0, 15)}`;
}
