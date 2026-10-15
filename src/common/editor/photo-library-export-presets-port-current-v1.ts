/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoRasterExportPresetV1, PhotoLibraryExportPresetsAccessV1, PhotoExportPresetAcknowledgmentV1 } from './photo-library-export-presets-port-v1.ts';
import type { PhotoRasterExportOutputCurrentV1 } from '../../lightscaper/controller/photo-raster-export-output-current-v1.ts';

export interface PhotoRasterExportPresetCurrentV1 extends Omit<PhotoRasterExportPresetV1, 'output'> {
	readonly output: Readonly<PhotoRasterExportOutputCurrentV1>;
}
export type PhotoExportPresetCommandCurrentV1 = Readonly<{ type: 'save'; expectedRevision: number; preset: PhotoRasterExportPresetCurrentV1 }>
	| Readonly<{ type: 'delete'; expectedRevision: number; presetId: string }>;
export interface PhotoLibraryExportPresetsAccessCurrentV1 extends Omit<PhotoLibraryExportPresetsAccessV1, 'read' | 'write'> {
	read(request: Readonly<{ schemaVersion: 1; presetId: string; expectedRevision: number }>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<{ preset: PhotoRasterExportPresetCurrentV1 }>>;
	write(request: Readonly<{ schemaVersion: 1; command: PhotoExportPresetCommandCurrentV1 }>, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoExportPresetAcknowledgmentV1>;
}
/** Named Current child; inherited preset ports remain strict byte-only. */
export interface PhotoLibraryExportPresetsPortCurrentV1 {
	open(options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<PhotoLibraryExportPresetsAccessCurrentV1>>;
}
