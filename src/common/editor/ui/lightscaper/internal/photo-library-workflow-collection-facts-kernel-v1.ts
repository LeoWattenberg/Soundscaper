/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord as record, readClosedDomainField as field, readClosedDomainArray as array } from '../../../closed-domain-value.ts';
import type { PhotoLibraryCollectionHandoffViewV1 } from '../../../photo-library-collection-handoff-port-v1.ts';
import type { PhotoLibraryCollectionHandoffViewV2 } from '../../../photo-library-collection-handoff-port-v2.ts';

/** Retain only bounded detached scalars, never a borrowed view/body capability. */
export function capturedCollectionFactsForProfileV1(profile: 'legacy2' | 'current3', view: Readonly<PhotoLibraryCollectionHandoffViewV1 | PhotoLibraryCollectionHandoffViewV2>): string {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported collection facts profile.');
	const label = 'Collection captured facts', input = record(view, label, ['schemaVersion', 'signal', 'collection', 'photos', 'lutReferences', 'withOriginal', 'withLutBytes', ...(profile === 'current3' ? ['maskRasterReferences', 'withMaskRasterBytes'] : [])]);
	if (field(input, 'schemaVersion', label) !== (profile === 'current3' ? 2 : 1)) throw new TypeError('Collection capture returned an unsupported view.');
	let remaining = 2 * 1024 * 1024;
	const scalar = (value: unknown, depth: number): unknown => {
		if (depth > 8) throw new RangeError('Collection scalar facts are too deeply nested.');
		if (value === null || typeof value === 'boolean') return value;
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value === 'string') {
			if (value.length > remaining) throw new RangeError('Collection scalar facts exceed their fixed capacity.');
			remaining -= new TextEncoder().encode(value).byteLength; if (remaining < 0) throw new RangeError('Collection scalar facts exceed their fixed capacity.'); return value;
		}
		if (Array.isArray(value)) return array(value, label, 0, 4_094).map(entry => scalar(entry, depth + 1));
		if (!value || typeof value !== 'object') throw new TypeError('Collection facts require inert JSON scalars.');
		const keys = Object.keys(value); if (keys.length > 64) throw new RangeError('Collection scalar record is too large.');
		const source = record(value, label, keys), output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		for (const key of keys) output[key] = scalar(field(source, key, label), depth + 1);
		return output;
	};
	const result = JSON.stringify({ collection: scalar(field(input, 'collection', label), 0), photos: scalar(field(input, 'photos', label), 0),
		lutReferences: scalar(field(input, 'lutReferences', label), 0),
		...(profile === 'current3' ? { maskRasterReferences: scalar(field(input, 'maskRasterReferences', label), 0) } : {}) });
	if (new TextEncoder().encode(result).byteLength > 2 * 1024 * 1024) throw new RangeError('Collection scalar facts exceed their fixed capacity.');
	return result;
}
