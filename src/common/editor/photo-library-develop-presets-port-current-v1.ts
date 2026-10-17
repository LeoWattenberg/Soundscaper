/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ImageDevelopPresetV4 } from './imaging/image-develop-preset-v4.ts';
import type { ImageDevelopPresetV3 } from './imaging/image-develop-preset-v3.ts';
import type { ImageDevelopPresetCurrentV1 } from './imaging/image-develop-preset-current-v1.ts';
import type { ImageDevelopSettingsPacketV4 } from './imaging/image-develop-settings-contract-v4.ts';
import type { ImageDevelopSettingsPacketV3 } from './imaging/image-develop-settings-contract-v3.ts';
import type { PhotoLibraryDevelopPresetListV3, PhotoLibraryDevelopPresetReadV3,
	PhotoLibraryDevelopPresetSnapshotV3, PhotoLibraryDevelopPresetAcknowledgementV3 } from './photo-library-develop-presets-port-v3.ts';

export type PhotoLibraryDevelopPresetCurrentV1 = ImageDevelopPresetCurrentV1;
export type PhotoLibraryDevelopPresetSnapshotCurrentV1 = PhotoLibraryDevelopPresetSnapshotV3;
export type PhotoLibraryDevelopPresetListCurrentV1 = PhotoLibraryDevelopPresetListV3;
export type PhotoLibraryDevelopPresetReadCurrentV1 = PhotoLibraryDevelopPresetReadV3;
export interface PhotoLibraryDevelopPresetBodyCurrentV1 {
	readonly schemaVersion: 3;
	readonly catalogId: string;
	readonly revision: number;
	readonly preset: PhotoLibraryDevelopPresetCurrentV1;
}
export type PhotoLibraryDevelopPresetCommandCurrentV1 =
	| Readonly<{ type: 'save'; expectedRevision: number; preset: PhotoLibraryDevelopPresetCurrentV1 }>
	| Readonly<{ type: 'delete'; expectedRevision: number; presetId: string }>;
export interface PhotoLibraryDevelopPresetWriteCurrentV1 extends PhotoLibraryDevelopPresetListCurrentV1 {
	readonly command: PhotoLibraryDevelopPresetCommandCurrentV1;
}
export type PhotoLibraryDevelopPresetAcknowledgementCurrentV1 = PhotoLibraryDevelopPresetAcknowledgementV3;
export interface PhotoLibraryDevelopPresetsPortCurrentV1 {
	create(request: Readonly<{ schemaVersion: 3; id: string; name: string; settings: ImageDevelopSettingsPacketV3 }>): ImageDevelopPresetV3;
	create(request: Readonly<{ schemaVersion: 3; id: string; name: string; settings: ImageDevelopSettingsPacketV4 }>): ImageDevelopPresetV4;
	create(request: Readonly<{ schemaVersion: 3; id: string; name: string; settings: ImageDevelopSettingsPacketV3 | ImageDevelopSettingsPacketV4 }>): ImageDevelopPresetV3 | ImageDevelopPresetV4;
	parse(text: string): PhotoLibraryDevelopPresetCurrentV1;
	serialize(preset: PhotoLibraryDevelopPresetCurrentV1): string;
	list(request: PhotoLibraryDevelopPresetListCurrentV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetSnapshotCurrentV1>;
	read(request: PhotoLibraryDevelopPresetReadCurrentV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetBodyCurrentV1>;
	write(request: PhotoLibraryDevelopPresetWriteCurrentV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetAcknowledgementCurrentV1>;
}
