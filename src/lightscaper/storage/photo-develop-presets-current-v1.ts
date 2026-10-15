/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetCommandCurrentV1, PhotoLibraryDevelopPresetSnapshotCurrentV1,
	PhotoLibraryDevelopPresetBodyCurrentV1 } from '../../common/editor/photo-library-develop-presets-port-current-v1.ts';
import type { PhotoDevelopPresetReadPortV1, PhotoDevelopPresetSettingsPortV1 } from './photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetCommandForProfileV1, readPhotoDevelopPresetsForProfileV1, readPhotoDevelopPresetForProfileV1,
	applyPhotoDevelopPresetForProfileV1, preparePhotoDevelopPresetBatchCurrentKernelV1, type PhotoDevelopPresetOptionsCurrentV1 } from './internal/photo-develop-presets-kernel-v1.ts';
export type { PhotoDevelopPresetOptionsCurrentV1 } from './internal/photo-develop-presets-kernel-v1.ts';

export function normalizePhotoDevelopPresetCommandCurrentV1(value: unknown): PhotoLibraryDevelopPresetCommandCurrentV1 {
	return normalizePhotoDevelopPresetCommandForProfileV1('current4', value) as PhotoLibraryDevelopPresetCommandCurrentV1;
}
export function readPhotoDevelopPresetsCurrentV1(repository: PhotoDevelopPresetReadPortV1, catalogId: string,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryDevelopPresetSnapshotCurrentV1> {
	return readPhotoDevelopPresetsForProfileV1('current4', repository, catalogId, options) as Promise<PhotoLibraryDevelopPresetSnapshotCurrentV1>;
}
export function readPhotoDevelopPresetCurrentV1(repository: PhotoDevelopPresetReadPortV1, catalogId: string, presetId: string,
	expectedRevision: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryDevelopPresetBodyCurrentV1> {
	return readPhotoDevelopPresetForProfileV1('current4', repository, catalogId, presetId, expectedRevision, options) as Promise<PhotoLibraryDevelopPresetBodyCurrentV1>;
}
export function applyPhotoDevelopPresetCurrentV1(repository: PhotoDevelopPresetSettingsPortV1, catalog: unknown, value: unknown,
	options: PhotoDevelopPresetOptionsCurrentV1 = {}): Promise<PhotoLibraryDevelopPresetSnapshotCurrentV1> {
	return applyPhotoDevelopPresetForProfileV1('current4', repository, catalog, value, options) as Promise<PhotoLibraryDevelopPresetSnapshotCurrentV1>;
}
/** Native row proof for one selected batch; no clipboard enrollment or installation. */
export function preparePhotoDevelopPresetBatchCurrentV1(repository: PhotoDevelopPresetReadPortV1, catalogId: string, presetId: string,
	expectedRevision: number, options: PhotoDevelopPresetOptionsCurrentV1 = {}) {
	return preparePhotoDevelopPresetBatchCurrentKernelV1(repository, catalogId, presetId, expectedRevision, options);
}
