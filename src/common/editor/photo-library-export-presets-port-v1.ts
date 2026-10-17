/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ImageExportSizingV1 } from './imaging/image-export-size-v1.ts';
import type { ImageExportTextV1 } from './image-export-text-v1.ts';

/** Reusable scalar output only. Photo identities, resource bodies and native
 * capabilities belong to a later explicitly initiated export, never a preset. */
export interface PhotoRasterExportPresetV1 {
	readonly schemaVersion: 1; readonly id: string; readonly name: string;
	readonly format: 'png' | 'jpeg'; readonly filenameTemplate: string; readonly sidecarEnabled: boolean;
	readonly output: Readonly<{ sizing: ImageExportSizingV1; quality: 'nearest' | 'bilinear';
		metadataScope?: 'strip' | 'capture'; sharpen?: Readonly<{ amount: number; threshold: number }>; textWatermark?: Readonly<ImageExportTextV1> }>;
}
export interface PhotoExportPresetSnapshotV1 {
	readonly schemaVersion: 1; readonly catalogId: string; readonly revision: number;
	readonly presets: readonly Readonly<{ id: string; name: string }>[];
}
export type PhotoExportPresetCommandV1 = Readonly<{ type: 'save'; expectedRevision: number; preset: PhotoRasterExportPresetV1 }>
	| Readonly<{ type: 'delete'; expectedRevision: number; presetId: string }>;
export interface PhotoExportPresetAcknowledgmentV1 {
	readonly schemaVersion: 1; readonly snapshot: PhotoExportPresetSnapshotV1; readonly notices: readonly 'cleanup-failed'[];
}
export interface PhotoLibraryExportPresetsAccessV1 {
	readonly catalogId: string;
	list(request: Readonly<{ schemaVersion: 1 }>, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoExportPresetSnapshotV1>;
	read(request: Readonly<{ schemaVersion: 1; presetId: string; expectedRevision: number }>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<{ preset: PhotoRasterExportPresetV1 }>>;
	write(request: Readonly<{ schemaVersion: 1; command: PhotoExportPresetCommandV1 }>, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoExportPresetAcknowledgmentV1>;
}
/** Opening lends methods, not an exclusive lease. Each later call is joined
 * independently by its original selected Session generation. */
export interface PhotoLibraryExportPresetsPortV1 {
	open(options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<PhotoLibraryExportPresetsAccessV1>>;
}
