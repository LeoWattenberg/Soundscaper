/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopPresetV1OrV2, type ImageDevelopPresetV2 } from '../../common/editor/imaging/image-develop-preset-v2.ts';
import type { ImageDevelopPresetV1 } from '../../common/editor/imaging/image-develop-preset-v1.ts';
import { array, compareText, field, id, integer, record, unique } from '../catalog/value-validation.ts';
import { normalizePhotoDevelopPresetRowV1, PHOTO_DEVELOP_PRESETS_LIMITS_V1 as LIMITS, type PhotoDevelopPresetRowV1 } from './photo-develop-presets-v1.ts';

/** The existing physical key is unchanged. An explicit successor row owns
 * mixed preset bodies; reads neither promote V1 nor downgrade empty V2. */
export interface PhotoDevelopPresetRowV2 extends Omit<PhotoDevelopPresetRowV1, 'schemaVersion' | 'presets'> {
	readonly schemaVersion: 2;
	readonly presets: readonly (ImageDevelopPresetV1 | ImageDevelopPresetV2)[];
}

export function normalizePhotoDevelopPresetRowV2(value: unknown, catalogId: string): PhotoDevelopPresetRowV2 {
	const catalog = id(catalogId, 'Develop preset catalog ID');
	const input = record(value, 'Develop preset row2', ['schemaVersion', 'kind', 'catalogId', 'revision', 'presets']);
	if (field(input, 'schemaVersion') !== 2 || field(input, 'kind') !== 'photo-develop-presets' || field(input, 'catalogId') !== catalog) {
		throw new RangeError('Unsupported or foreign Develop preset row2.');
	}
	let accumulated = 0;
	const presets = array(field(input, 'presets'), 'Develop presets', 0, LIMITS.maximumPresets).map(value => {
		const preset = normalizeImageDevelopPresetV1OrV2(value);
		accumulated += new TextEncoder().encode(JSON.stringify(preset)).byteLength;
		if (accumulated > LIMITS.maximumRowBytes) throw new RangeError('Develop preset row exceeds its UTF8 byte bound.');
		return preset;
	});
	unique(presets.map(preset => preset.identity.id), 'Develop presets');
	const row = Object.freeze({ schemaVersion: 2 as const, kind: 'photo-develop-presets' as const, catalogId: catalog,
		revision: integer(field(input, 'revision'), 1, Number.MAX_SAFE_INTEGER, 'Develop preset revision'),
		presets: Object.freeze(presets.sort((left, right) => compareText(left.identity.id, right.identity.id))) });
	if (new TextEncoder().encode(JSON.stringify(row)).byteLength > LIMITS.maximumRowBytes) throw new RangeError('Develop preset row exceeds its UTF8 byte bound.');
	return row;
}

export function normalizePhotoDevelopPresetRowV1OrV2(value: unknown, catalogId: string): PhotoDevelopPresetRowV1 | PhotoDevelopPresetRowV2 {
	const input = record(value, 'Develop preset row version', ['schemaVersion', 'kind', 'catalogId', 'revision', 'presets']);
	const version = field(input, 'schemaVersion');
	if (version === 1) return normalizePhotoDevelopPresetRowV1(input, catalogId);
	if (version === 2) return normalizePhotoDevelopPresetRowV2(input, catalogId);
	throw new RangeError('Unsupported Develop preset row version.');
}
