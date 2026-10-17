/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopPresetV1 } from './imaging/image-develop-preset-v1.ts';
import type { ImageDevelopSettingsPacketV1 } from './imaging/image-develop-settings-contract-v1.ts';

export interface PhotoLibraryDevelopPresetInfoV1 {
	readonly id: string;
	readonly name: string;
	readonly authoredStateSha256: string;
	readonly scope: 'full' | 'partial';
}
/** Menus receive scalar identities, never sixteen complete recipe bodies. */
export interface PhotoLibraryDevelopPresetSnapshotV1 {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly revision: number;
	readonly presets: readonly PhotoLibraryDevelopPresetInfoV1[];
}
export interface PhotoLibraryDevelopPresetListV1 { readonly schemaVersion: 1; readonly catalogId: string; }
export interface PhotoLibraryDevelopPresetReadV1 extends PhotoLibraryDevelopPresetListV1 {
	readonly presetId: string;
	readonly expectedRevision: number;
}
export interface PhotoLibraryDevelopPresetBodyV1 {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly revision: number;
	readonly preset: ImageDevelopPresetV1;
}
export type PhotoLibraryDevelopPresetCommandV1 =
	| Readonly<{ type: 'save'; expectedRevision: number; preset: ImageDevelopPresetV1 }>
	| Readonly<{ type: 'delete'; expectedRevision: number; presetId: string }>;
export interface PhotoLibraryDevelopPresetWriteV1 extends PhotoLibraryDevelopPresetListV1 { readonly command: PhotoLibraryDevelopPresetCommandV1; }
export interface PhotoLibraryDevelopPresetAcknowledgementV1 {
	readonly snapshot: PhotoLibraryDevelopPresetSnapshotV1;
	readonly notices: readonly 'cleanup-failed'[];
}
export interface PhotoLibraryDevelopPresetsPortV1 {
	create(request: Readonly<{ schemaVersion: 1; id: string; name: string; settings: ImageDevelopSettingsPacketV1 }>): ImageDevelopPresetV1;
	parse(text: string): ImageDevelopPresetV1;
	serialize(preset: ImageDevelopPresetV1): string;
	list(request: PhotoLibraryDevelopPresetListV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetSnapshotV1>;
	read(request: PhotoLibraryDevelopPresetReadV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetBodyV1>;
	write(request: PhotoLibraryDevelopPresetWriteV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetAcknowledgementV1>;
}
