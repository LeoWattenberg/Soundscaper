/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImportItemV1, PhotoLibraryMetadataV1 } from './photo-library-session-port-v1.ts';

/** Authored choices only; source facts and immutable original bindings stay in the product. */
export interface PhotoLibraryImportSettingsV1 {
	readonly rename: Readonly<{ template: string; sequenceStart: number; sequencePadding: number }> | null;
	readonly metadata: Readonly<Partial<Pick<PhotoLibraryMetadataV1, 'title' | 'caption' | 'creator' | 'copyright' | 'location'>>>;
	readonly keywordIds: readonly string[];
}

export interface PhotoLibraryImportPresetV1 {
	readonly id: string;
	readonly name: string;
	readonly settings: PhotoLibraryImportSettingsV1;
}

export interface PhotoLibraryImportPresetSnapshotV1 {
	readonly revision: number;
	readonly presets: readonly PhotoLibraryImportPresetV1[];
}

export type PhotoLibraryImportPresetCommandV1 =
	| Readonly<{ type: 'save'; expectedRevision: number; id: string; name: string; settings: PhotoLibraryImportSettingsV1 }>
	| Readonly<{ type: 'delete'; expectedRevision: number; id: string }>;

export interface PhotoLibraryImportRequestOptionsV1 {
	readonly signal?: AbortSignal;
	readonly settings?: PhotoLibraryImportSettingsV1;
	/** One scalar imported item per acknowledged publication; observers cannot veto that publication. */
	readonly onAcknowledged?: (item: PhotoLibraryImportItemV1) => void;
}

/** A completed per-file result and known publications remain truthful after later cancellation or refresh failure. */
export type PhotoLibraryImportGestureReceiptV1 =
	| Readonly<{ outcome: 'acknowledged'; items: readonly PhotoLibraryImportItemV1[];
		completion: 'finished' | 'cancelled' | 'failed'; notice: 'refresh-failed' | null }>
	| Readonly<{ outcome: 'failed' | 'cancelled' | 'busy' }>;

export interface PhotoLibraryImportSettingsPortV1 {
	importFiles(files: readonly File[], options?: PhotoLibraryImportRequestOptionsV1): Promise<readonly PhotoLibraryImportItemV1[]>;
	readImportPresets(options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryImportPresetSnapshotV1>;
	applyImportPreset(command: PhotoLibraryImportPresetCommandV1,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryImportPresetSnapshotV1>;
}
