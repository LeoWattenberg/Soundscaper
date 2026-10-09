/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopPresetV1 } from './imaging/image-develop-preset-v1.ts';
import type { ImageDevelopPresetV2 } from './imaging/image-develop-preset-v2.ts';
export type PhotoLibraryDevelopPresetV2 = ImageDevelopPresetV1 | ImageDevelopPresetV2;
import type { ImageDevelopSettingsPacketV2 } from './imaging/image-develop-settings-contract-v2.ts';

export interface PhotoLibraryDevelopPresetInfoV2 {
	readonly id: string;
	readonly name: string;
	readonly authoredStateSha256: string;
	readonly scope: 'full' | 'partial';
}
/** Menus receive scalar identities, never sixteen complete recipe bodies. */
export interface PhotoLibraryDevelopPresetSnapshotV2 {
	readonly schemaVersion: 2;
	readonly catalogId: string;
	readonly revision: number;
	readonly presets: readonly PhotoLibraryDevelopPresetInfoV2[];
}
export interface PhotoLibraryDevelopPresetListV2 { readonly schemaVersion: 2; readonly catalogId: string; }
export interface PhotoLibraryDevelopPresetReadV2 extends PhotoLibraryDevelopPresetListV2 {
	readonly presetId: string;
	readonly expectedRevision: number;
}
export interface PhotoLibraryDevelopPresetBodyV2 {
	readonly schemaVersion: 2;
	readonly catalogId: string;
	readonly revision: number;
	readonly preset: PhotoLibraryDevelopPresetV2;
}
export type PhotoLibraryDevelopPresetCommandV2 =
	| Readonly<{ type: 'save'; expectedRevision: number; preset: PhotoLibraryDevelopPresetV2 }>
	| Readonly<{ type: 'delete'; expectedRevision: number; presetId: string }>;
export interface PhotoLibraryDevelopPresetWriteV2 extends PhotoLibraryDevelopPresetListV2 { readonly command: PhotoLibraryDevelopPresetCommandV2; }
export interface PhotoLibraryDevelopPresetAcknowledgementV2 {
	readonly schemaVersion: 2;
	readonly snapshot: PhotoLibraryDevelopPresetSnapshotV2;
	readonly notices: readonly 'cleanup-failed'[];
}
export interface PhotoLibraryDevelopPresetsPortV2 {
	create(request: Readonly<{ schemaVersion: 2; id: string; name: string; settings: ImageDevelopSettingsPacketV2 }>): ImageDevelopPresetV2;
	parse(text: string): PhotoLibraryDevelopPresetV2;
	serialize(preset: PhotoLibraryDevelopPresetV2): string;
	list(request: PhotoLibraryDevelopPresetListV2, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetSnapshotV2>;
	read(request: PhotoLibraryDevelopPresetReadV2, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetBodyV2>;
	write(request: PhotoLibraryDevelopPresetWriteV2, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetAcknowledgementV2>;
}
