/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitPhotoMediaRestorePresetHeaderForProfileV1, admitPhotoMediaRestorePresetsForProfileV1, bindPhotoMediaRestorePresetsForProfileV1,
	readPhotoMediaRestorePresetsForProfileV1, assertPhotoMediaRestorePresetsForProfileV1,
	type PhotoMediaRestorePresetHeaderForProfileV1, type PhotoMediaRestorePresetBindingForProfileV1 } from './photo-media-restore-presets-v2.ts';
import type { PhotoDevelopPresetRowCurrentV1 } from './photo-develop-preset-row-current-v1.ts';
export type PhotoMediaRestorePresetHeaderCurrentV1 = PhotoMediaRestorePresetHeaderForProfileV1<'current4'>;
export type PhotoMediaRestorePresetBindingCurrentV1 = PhotoMediaRestorePresetBindingForProfileV1<'current4'>;
export function admitPhotoMediaRestorePresetHeaderCurrentV1(value: unknown) { return admitPhotoMediaRestorePresetHeaderForProfileV1('current4', value); }
export function admitPhotoMediaRestorePresetsCurrentV1(value: unknown, catalogId: string, expected: PhotoMediaRestorePresetHeaderCurrentV1 | null) {
	return admitPhotoMediaRestorePresetsForProfileV1('current4', value, catalogId, expected);
}
export function bindPhotoMediaRestorePresetsCurrentV1(row: PhotoDevelopPresetRowCurrentV1) { return bindPhotoMediaRestorePresetsForProfileV1('current4', row); }
export function readPhotoMediaRestorePresetsCurrentV1(settings: IDBObjectStore, catalogId: string, expected: PhotoMediaRestorePresetBindingCurrentV1 | null) {
	return readPhotoMediaRestorePresetsForProfileV1('current4', settings, catalogId, expected);
}
export function assertPhotoMediaRestorePresetsCurrentV1(settings: IDBObjectStore, catalogId: string, expected: PhotoMediaRestorePresetBindingCurrentV1 | null) {
	return assertPhotoMediaRestorePresetsForProfileV1('current4', settings, catalogId, expected);
}
