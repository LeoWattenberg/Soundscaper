/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopPresetV1OrV2 } from '../../../common/editor/imaging/image-develop-preset-v2.ts';
import type { ImageDevelopPresetV1 } from '../../../common/editor/imaging/image-develop-preset-v1.ts';
import type { ImageDevelopPresetV2 } from '../../../common/editor/imaging/image-develop-preset-v2.ts';
import type { ImageDevelopPresetCurrentV1, ImageDevelopPresetThroughV3 } from '../../../common/editor/imaging/image-develop-preset-current-v1.ts';
import { normalizeImageDevelopPresetCurrentForProfileV1 } from '../../../common/editor/imaging/internal/image-develop-preset-kernel-v1.ts';
import { array, compareText, field, id, integer, record, unique } from '../../catalog/value-validation.ts';
import { normalizePhotoDevelopPresetRowV1, PHOTO_DEVELOP_PRESETS_LIMITS_V1 as LIMITS, type PhotoDevelopPresetRowV1 } from '../photo-develop-presets-v1.ts';
import type { PhotoDevelopPresetRowV2 } from '../photo-develop-preset-row-v2.ts';
import type { PhotoDevelopPresetRowV3 } from '../photo-develop-preset-row-v3.ts';
import type { PhotoDevelopPresetRowV4 } from '../photo-develop-preset-row-v4.ts';

type Profile = 'legacy2' | 'current3' | 'current4';
type RowThroughV3 = PhotoDevelopPresetRowV1 | PhotoDevelopPresetRowV2 | PhotoDevelopPresetRowV3;
type Row = RowThroughV3 | PhotoDevelopPresetRowV4;

export function normalizePhotoDevelopPresetRowForProfileV1(profile: 'legacy2', value: unknown, catalogId: string): PhotoDevelopPresetRowV2;
export function normalizePhotoDevelopPresetRowForProfileV1(profile: 'current3', value: unknown, catalogId: string): PhotoDevelopPresetRowV3;
export function normalizePhotoDevelopPresetRowForProfileV1(profile: 'current4', value: unknown, catalogId: string): PhotoDevelopPresetRowV4;
export function normalizePhotoDevelopPresetRowForProfileV1(profile: Profile, value: unknown, catalogId: string): PhotoDevelopPresetRowV2 | PhotoDevelopPresetRowV3 | PhotoDevelopPresetRowV4 {
	assertProfile(profile);
	const catalog = id(catalogId, 'Develop preset catalog ID'), version = profile === 'legacy2' ? 2 : profile === 'current3' ? 3 : 4;
	const input = record(value, `Develop preset row${String(version)}`, ['schemaVersion', 'kind', 'catalogId', 'revision', 'presets']);
	if (field(input, 'schemaVersion') !== version || field(input, 'kind') !== 'photo-develop-presets' || field(input, 'catalogId') !== catalog) {
		throw new RangeError(`Unsupported or foreign Develop preset row${String(version)}.`);
	}
	const presets = field(input, 'presets');
	if (profile === 'legacy2') {
		const entries = normalizeEntries('legacy2', presets);
		return buildRow(2, catalog, integer(field(input, 'revision'), 1, Number.MAX_SAFE_INTEGER, 'Develop preset revision'), entries);
	}
	if (profile === 'current4') return buildRow(4, catalog, integer(field(input, 'revision'), 1, Number.MAX_SAFE_INTEGER, 'Develop preset revision'), normalizeEntries('current4', presets));
	const entries = normalizeEntries('current3', presets);
	return buildRow(3, catalog, integer(field(input, 'revision'), 1, Number.MAX_SAFE_INTEGER, 'Develop preset revision'), entries);
}

export function normalizePhotoDevelopPresetRowCurrentForProfileV1(profile: 'legacy2', value: unknown, catalogId: string): PhotoDevelopPresetRowV1 | PhotoDevelopPresetRowV2;
export function normalizePhotoDevelopPresetRowCurrentForProfileV1(profile: 'current3', value: unknown, catalogId: string): RowThroughV3;
export function normalizePhotoDevelopPresetRowCurrentForProfileV1(profile: 'current4', value: unknown, catalogId: string): Row;
export function normalizePhotoDevelopPresetRowCurrentForProfileV1(profile: Profile, value: unknown, catalogId: string): Row {
	assertProfile(profile);
	const input = record(value, 'Develop preset row version', ['schemaVersion', 'kind', 'catalogId', 'revision', 'presets']);
	const version = field(input, 'schemaVersion');
	if (version === 1) return normalizePhotoDevelopPresetRowV1(input, catalogId);
	if (version === 2) return normalizePhotoDevelopPresetRowForProfileV1('legacy2', input, catalogId);
	if (profile !== 'legacy2' && version === 3) return normalizePhotoDevelopPresetRowForProfileV1('current3', input, catalogId);
	if (profile === 'current4' && version === 4) return normalizePhotoDevelopPresetRowForProfileV1('current4', input, catalogId);
	throw new RangeError('Unsupported Develop preset row version.');
}

function normalizeEntries(profile: 'legacy2', value: unknown): readonly (ImageDevelopPresetV1 | ImageDevelopPresetV2)[];
function normalizeEntries(profile: 'current3', value: unknown): readonly ImageDevelopPresetThroughV3[];
function normalizeEntries(profile: 'current4', value: unknown): readonly ImageDevelopPresetCurrentV1[];
function normalizeEntries(profile: Profile, value: unknown): readonly ImageDevelopPresetCurrentV1[] {
	let accumulated = 0;
	const presets = array(value, 'Develop presets', 0, LIMITS.maximumPresets).map(value => {
		const preset = profile === 'legacy2' ? normalizeImageDevelopPresetV1OrV2(value)
			: profile === 'current3' ? normalizeImageDevelopPresetCurrentForProfileV1('current3', value, 'selected') : normalizeImageDevelopPresetCurrentForProfileV1('current4', value, 'selected');
		accumulated += new TextEncoder().encode(JSON.stringify(preset)).byteLength;
		if (accumulated > LIMITS.maximumRowBytes) throw new RangeError('Develop preset row exceeds its UTF8 byte bound.');
		return preset;
	});
	unique(presets.map(preset => preset.identity.id), 'Develop presets');
	return Object.freeze(presets.sort((left, right) => compareText(left.identity.id, right.identity.id)));
}
function buildRow<Version extends 2 | 3 | 4, Preset extends ImageDevelopPresetCurrentV1>(schemaVersion: Version, catalogId: string, revision: number, presets: readonly Preset[]) {
	const row = Object.freeze({ schemaVersion, kind: 'photo-develop-presets' as const, catalogId, revision, presets });
	if (new TextEncoder().encode(JSON.stringify(row)).byteLength > LIMITS.maximumRowBytes) throw new RangeError('Develop preset row exceeds its UTF8 byte bound.');
	return row;
}
function assertProfile(value: unknown): void {
	if (value !== 'legacy2' && value !== 'current3' && value !== 'current4') throw new RangeError('Unsupported fixed preset row profile.');
}
