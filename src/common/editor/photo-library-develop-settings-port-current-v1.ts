/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ImageDevelopSelectionV4, ImageDevelopSettingsPacketV4 } from './imaging/image-develop-settings-contract-v4.ts';
import type { ImageDevelopSettingsPacketCurrentV1 } from './imaging/image-develop-settings-current-v1.ts';
import type { ImageDevelopStateThroughV4 } from './imaging/image-develop-state-v4.ts';
import type { PhotoLibraryDevelopBatchTargetV3, PhotoLibraryDevelopBatchReceiptV3 } from './photo-library-develop-settings-port-v3.ts';

export type PhotoLibraryDevelopSelectionCurrentV1 = ImageDevelopSelectionV4;
export type PhotoLibraryDevelopSettingsPacketCurrentV1 = ImageDevelopSettingsPacketV4;
export interface PhotoDevelopSettingsSourceCurrentV1 {
	readonly schemaVersion: 3;
	readonly catalogId: string;
	readonly photoId: string;
	readonly versionId: string;
	readonly revision: number;
	readonly develop: Readonly<ImageDevelopStateThroughV4>;
}
export interface PhotoLibraryDevelopCopySelectedCurrentV1 extends PhotoDevelopSettingsSourceCurrentV1 {
	readonly selection: Readonly<ImageDevelopSelectionV4>;
}
export interface PhotoLibraryDevelopCopyCurrentV1 {
	readonly schemaVersion: 3;
	readonly develop: Readonly<ImageDevelopStateThroughV4>;
	readonly selection: Readonly<ImageDevelopSelectionV4>;
}
export interface PhotoLibraryDevelopMergeCurrentV1 {
	readonly schemaVersion: 3;
	readonly target: Readonly<ImageDevelopStateThroughV4>;
	readonly settings: Readonly<ImageDevelopSettingsPacketCurrentV1>;
}
export interface PhotoLibraryDevelopRelativeCurrentV1 {
	readonly schemaVersion: 3;
	readonly target: Readonly<ImageDevelopStateThroughV4>;
	readonly effectType: 'white-balance-v1' | 'tone-ladder-v1';
	readonly changes: Readonly<Record<string, number>>;
}
export interface PhotoLibraryDevelopBatchRequestCurrentV1 {
	readonly schemaVersion: 3;
	readonly catalogId: string;
	readonly targets: readonly PhotoLibraryDevelopBatchTargetV3[];
	readonly action:
		| Readonly<{ kind: 'paste'; settings: Readonly<ImageDevelopSettingsPacketCurrentV1> }>
		| Readonly<{ kind: 'preset'; presetId: string; expectedPresetRevision: number }>
		| Readonly<{ kind: 'relative'; effectType: PhotoLibraryDevelopRelativeCurrentV1['effectType']; changes: Readonly<Record<string, number>> }>;
	readonly label: string;
	readonly createdAt: string;
}
export type PhotoLibraryDevelopBatchReceiptCurrentV1 = PhotoLibraryDevelopBatchReceiptV3;
/** Named Current capability; selected packets still carry no resource authority. */
export interface PhotoLibraryDevelopSettingsPortCurrentV1 {
	copy(request: PhotoLibraryDevelopCopyCurrentV1): ImageDevelopSettingsPacketV4;
	copySelected(request: PhotoLibraryDevelopCopySelectedCurrentV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<ImageDevelopSettingsPacketV4>;
	merge(request: PhotoLibraryDevelopMergeCurrentV1): ImageDevelopStateThroughV4;
	adjust(request: PhotoLibraryDevelopRelativeCurrentV1): ImageDevelopStateThroughV4;
	applyBatch(request: PhotoLibraryDevelopBatchRequestCurrentV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopBatchReceiptCurrentV1>;
}
