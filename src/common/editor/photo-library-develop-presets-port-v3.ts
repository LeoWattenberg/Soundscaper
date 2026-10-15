/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopPresetV3 } from './imaging/image-develop-preset-v3.ts';
import type { ImageDevelopPresetThroughV3 } from './imaging/image-develop-preset-current-v1.ts';
import type { ImageDevelopSettingsPacketV3 } from './imaging/image-develop-settings-contract-v3.ts';
import type { PhotoLibraryDevelopPresetInfoV2 } from './photo-library-develop-presets-port-v2.ts';

export type PhotoLibraryDevelopPresetV3 = ImageDevelopPresetThroughV3;
export type PhotoLibraryDevelopPresetInfoV3 = PhotoLibraryDevelopPresetInfoV2;
export interface PhotoLibraryDevelopPresetSnapshotV3 {
	readonly schemaVersion: 3;
	readonly catalogId: string;
	readonly revision: number;
	readonly presets: readonly PhotoLibraryDevelopPresetInfoV3[];
}
export interface PhotoLibraryDevelopPresetListV3 { readonly schemaVersion: 3; readonly catalogId: string; }
export interface PhotoLibraryDevelopPresetReadV3 extends PhotoLibraryDevelopPresetListV3 {
	readonly presetId: string;
	readonly expectedRevision: number;
}
export interface PhotoLibraryDevelopPresetBodyV3 {
	readonly schemaVersion: 3;
	readonly catalogId: string;
	readonly revision: number;
	readonly preset: PhotoLibraryDevelopPresetV3;
}
export type PhotoLibraryDevelopPresetCommandV3 =
	| Readonly<{ type: 'save'; expectedRevision: number; preset: PhotoLibraryDevelopPresetV3 }>
	| Readonly<{ type: 'delete'; expectedRevision: number; presetId: string }>;
export interface PhotoLibraryDevelopPresetWriteV3 extends PhotoLibraryDevelopPresetListV3 { readonly command: PhotoLibraryDevelopPresetCommandV3; }
export interface PhotoLibraryDevelopPresetAcknowledgementV3 {
	readonly schemaVersion: 3;
	readonly snapshot: PhotoLibraryDevelopPresetSnapshotV3;
	readonly notices: readonly 'cleanup-failed'[];
}
/** Creation carries inert selected metadata. Only the native Current write
 * authenticates every retained row resource; JSON grants no body authority. */
export interface PhotoLibraryDevelopPresetsPortV3 {
	create(request: Readonly<{ schemaVersion: 3; id: string; name: string; settings: ImageDevelopSettingsPacketV3 }>): ImageDevelopPresetV3;
	parse(text: string): PhotoLibraryDevelopPresetV3;
	serialize(preset: PhotoLibraryDevelopPresetV3): string;
	list(request: PhotoLibraryDevelopPresetListV3, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetSnapshotV3>;
	read(request: PhotoLibraryDevelopPresetReadV3, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetBodyV3>;
	write(request: PhotoLibraryDevelopPresetWriteV3, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetAcknowledgementV3>;
}
