/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopSelectionV1, ImageDevelopSettingsPacketV1 } from './imaging/image-develop-settings-contract-v1.ts';
import type { ImageDevelopSettingsPacketV2 } from './imaging/image-develop-settings-contract-v2.ts';
import type { PhotoLibraryDevelopSettingsV2 } from './photo-library-develop-port-v2.ts';

export type PhotoLibraryDevelopSelectionV2 = ImageDevelopSelectionV1;
export type PhotoLibraryDevelopSettingsPacketV2 = ImageDevelopSettingsPacketV2;
export type PhotoLibraryDevelopSettingsPacketV1OrV2 = ImageDevelopSettingsPacketV1 | ImageDevelopSettingsPacketV2;
export interface PhotoLibraryDevelopCopyV2 {
	readonly schemaVersion: 2;
	readonly develop: PhotoLibraryDevelopSettingsV2;
	readonly selection: PhotoLibraryDevelopSelectionV2;
}
export interface PhotoLibraryDevelopMergeV2 {
	readonly schemaVersion: 2;
	readonly target: PhotoLibraryDevelopSettingsV2;
	readonly settings: PhotoLibraryDevelopSettingsPacketV1OrV2;
}
export interface PhotoLibraryDevelopRelativeV2 {
	readonly schemaVersion: 2;
	readonly target: PhotoLibraryDevelopSettingsV2;
	readonly effectType: 'white-balance-v1' | 'tone-ladder-v1';
	readonly changes: Readonly<Record<string, number>>;
}
export interface PhotoLibraryDevelopBatchTargetV2 {
	readonly photoId: string;
	readonly versionId: string;
	readonly expectedRevision: number;
}
export interface PhotoLibraryDevelopBatchRequestV2 {
	readonly schemaVersion: 2;
	readonly catalogId: string;
	readonly targets: readonly PhotoLibraryDevelopBatchTargetV2[];
	readonly action:
		| Readonly<{ kind: 'paste'; settings: PhotoLibraryDevelopSettingsPacketV1OrV2 }>
		| Readonly<{ kind: 'relative'; effectType: PhotoLibraryDevelopRelativeV2['effectType']; changes: Readonly<Record<string, number>> }>;
	readonly label: string;
	readonly createdAt: string;
}
export interface PhotoLibraryDevelopBatchOutcomeV2 {
	readonly index: number;
	readonly photoId: string;
	readonly versionId: string;
	readonly status: 'applied' | 'unchanged' | 'conflict' | 'failed' | 'not-attempted';
	readonly revision: number | null;
	readonly historyCursor: number | null;
	readonly code: 'revision-conflict' | 'version-missing' | 'operation-failed' | null;
}
export interface PhotoLibraryDevelopBatchReceiptV2 {
	readonly schemaVersion: 2;
	readonly catalogId: string;
	readonly completion: 'finished' | 'cancelled' | 'interrupted';
	readonly outcomes: readonly PhotoLibraryDevelopBatchOutcomeV2[];
	readonly notices: readonly 'cleanup-failed'[];
}
/** Copy/paste/Sync/Auto-sync share one admission and the existing Session writer. */
export interface PhotoLibraryDevelopSettingsPortV2 {
	copy(request: PhotoLibraryDevelopCopyV2): PhotoLibraryDevelopSettingsPacketV2;
	merge(request: PhotoLibraryDevelopMergeV2): PhotoLibraryDevelopSettingsV2;
	adjust(request: PhotoLibraryDevelopRelativeV2): PhotoLibraryDevelopSettingsV2;
	applyBatch(request: PhotoLibraryDevelopBatchRequestV2, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopBatchReceiptV2>;
}
