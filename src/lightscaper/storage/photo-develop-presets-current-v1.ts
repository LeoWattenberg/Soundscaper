/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetCommandV3, PhotoLibraryDevelopPresetSnapshotV3, PhotoLibraryDevelopPresetBodyV3 } from '../../common/editor/photo-library-develop-presets-port-v3.ts';
import type { PhotoDevelopPresetReadPortV1, PhotoDevelopPresetSettingsPortV1 } from './photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetCommandForProfileV1, readPhotoDevelopPresetsForProfileV1, readPhotoDevelopPresetForProfileV1,
	applyPhotoDevelopPresetForProfileV1, preparePhotoDevelopPresetBatchCurrentKernelV1, type PhotoDevelopPresetOptionsCurrentV1 } from './internal/photo-develop-presets-kernel-v1.ts';
export type { PhotoDevelopPresetOptionsCurrentV1 } from './internal/photo-develop-presets-kernel-v1.ts';

export function normalizePhotoDevelopPresetCommandCurrentV1(value: unknown): PhotoLibraryDevelopPresetCommandV3 {
	return normalizePhotoDevelopPresetCommandForProfileV1('current3', value) as PhotoLibraryDevelopPresetCommandV3;
}
export function readPhotoDevelopPresetsCurrentV1(repository: PhotoDevelopPresetReadPortV1, catalogId: string,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryDevelopPresetSnapshotV3> {
	return readPhotoDevelopPresetsForProfileV1('current3', repository, catalogId, options) as Promise<PhotoLibraryDevelopPresetSnapshotV3>;
}
export function readPhotoDevelopPresetCurrentV1(repository: PhotoDevelopPresetReadPortV1, catalogId: string, presetId: string,
	expectedRevision: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryDevelopPresetBodyV3> {
	return readPhotoDevelopPresetForProfileV1('current3', repository, catalogId, presetId, expectedRevision, options) as Promise<PhotoLibraryDevelopPresetBodyV3>;
}
export function applyPhotoDevelopPresetCurrentV1(repository: PhotoDevelopPresetSettingsPortV1, catalog: unknown, value: unknown,
	options: PhotoDevelopPresetOptionsCurrentV1 = {}): Promise<PhotoLibraryDevelopPresetSnapshotV3> {
	return applyPhotoDevelopPresetForProfileV1('current3', repository, catalog, value, options) as Promise<PhotoLibraryDevelopPresetSnapshotV3>;
}
/** Native row proof for one selected batch; no clipboard enrollment or installation. */
export function preparePhotoDevelopPresetBatchCurrentV1(repository: PhotoDevelopPresetReadPortV1, catalogId: string, presetId: string,
	expectedRevision: number, options: PhotoDevelopPresetOptionsCurrentV1 = {}) {
	return preparePhotoDevelopPresetBatchCurrentKernelV1(repository, catalogId, presetId, expectedRevision, options);
}
