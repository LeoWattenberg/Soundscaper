/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetCommandV2, PhotoLibraryDevelopPresetSnapshotV2, PhotoLibraryDevelopPresetBodyV2 } from '../../common/editor/photo-library-develop-presets-port-v2.ts';
import type { PhotoDevelopPresetReadPortV1, PhotoDevelopPresetSettingsPortV1 } from './photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetCommandForProfileV1, readPhotoDevelopPresetsForProfileV1, readPhotoDevelopPresetForProfileV1,
	applyPhotoDevelopPresetForProfileV1, type PhotoDevelopPresetOptionsV2 } from './internal/photo-develop-presets-kernel-v1.ts';
export type { PhotoDevelopPresetOptionsV2 } from './internal/photo-develop-presets-kernel-v1.ts';

/** Permanent strict legacy owner; Current rows and declarations remain refused. */
export function normalizePhotoDevelopPresetCommandV2(value: unknown): PhotoLibraryDevelopPresetCommandV2 {
	return normalizePhotoDevelopPresetCommandForProfileV1('legacy2', value) as PhotoLibraryDevelopPresetCommandV2;
}
export function readPhotoDevelopPresetsV2(repository: PhotoDevelopPresetReadPortV1, catalogId: string,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryDevelopPresetSnapshotV2> {
	return readPhotoDevelopPresetsForProfileV1('legacy2', repository, catalogId, options) as Promise<PhotoLibraryDevelopPresetSnapshotV2>;
}
export function readPhotoDevelopPresetV2(repository: PhotoDevelopPresetReadPortV1, catalogId: string, presetId: string,
	expectedRevision: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryDevelopPresetBodyV2> {
	return readPhotoDevelopPresetForProfileV1('legacy2', repository, catalogId, presetId, expectedRevision, options) as Promise<PhotoLibraryDevelopPresetBodyV2>;
}
export function applyPhotoDevelopPresetV2(repository: PhotoDevelopPresetSettingsPortV1, catalog: unknown, value: unknown,
	options: PhotoDevelopPresetOptionsV2 = {}): Promise<PhotoLibraryDevelopPresetSnapshotV2> {
	return applyPhotoDevelopPresetForProfileV1('legacy2', repository, catalog, value, options) as Promise<PhotoLibraryDevelopPresetSnapshotV2>;
}
