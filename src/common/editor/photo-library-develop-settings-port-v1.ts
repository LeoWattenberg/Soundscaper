/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopSelectionV1, ImageDevelopSettingsPacketV1 } from './imaging/image-develop-settings-contract-v1.ts';
import type { PhotoLibraryDevelopSettingsV1 } from './photo-library-develop-port-v1.ts';

export type PhotoLibraryDevelopSelectionV1 = ImageDevelopSelectionV1;
export type PhotoLibraryDevelopSettingsPacketV1 = ImageDevelopSettingsPacketV1;
export interface PhotoLibraryDevelopCopyV1 {
	readonly schemaVersion: 1;
	readonly develop: PhotoLibraryDevelopSettingsV1;
	readonly selection: PhotoLibraryDevelopSelectionV1;
}
export interface PhotoLibraryDevelopMergeV1 {
	readonly schemaVersion: 1;
	readonly target: PhotoLibraryDevelopSettingsV1;
	readonly settings: PhotoLibraryDevelopSettingsPacketV1;
}
export interface PhotoLibraryDevelopRelativeV1 {
	readonly schemaVersion: 1;
	readonly target: PhotoLibraryDevelopSettingsV1;
	readonly effectType: 'white-balance-v1' | 'tone-ladder-v1';
	readonly changes: Readonly<Record<string, number>>;
}
export interface PhotoLibraryDevelopBatchTargetV1 {
	readonly photoId: string;
	readonly versionId: string;
	readonly expectedRevision: number;
}
export interface PhotoLibraryDevelopBatchRequestV1 {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly targets: readonly PhotoLibraryDevelopBatchTargetV1[];
	readonly action:
		| Readonly<{ kind: 'paste'; settings: PhotoLibraryDevelopSettingsPacketV1 }>
		| Readonly<{ kind: 'relative'; effectType: PhotoLibraryDevelopRelativeV1['effectType']; changes: Readonly<Record<string, number>> }>;
	readonly label: string;
	readonly createdAt: string;
}
export interface PhotoLibraryDevelopBatchOutcomeV1 {
	readonly index: number;
	readonly photoId: string;
	readonly versionId: string;
	readonly status: 'applied' | 'unchanged' | 'conflict' | 'failed' | 'not-attempted';
	readonly revision: number | null;
	readonly historyCursor: number | null;
	readonly code: 'revision-conflict' | 'version-missing' | 'operation-failed' | null;
}
export interface PhotoLibraryDevelopBatchReceiptV1 {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly completion: 'finished' | 'cancelled' | 'interrupted';
	readonly outcomes: readonly PhotoLibraryDevelopBatchOutcomeV1[];
	readonly notices: readonly 'cleanup-failed'[];
}
/** Copy/paste/Sync/Auto-sync share one admission and the existing Session writer. */
export interface PhotoLibraryDevelopSettingsPortV1 {
	copy(request: PhotoLibraryDevelopCopyV1): PhotoLibraryDevelopSettingsPacketV1;
	merge(request: PhotoLibraryDevelopMergeV1): PhotoLibraryDevelopSettingsV1;
	adjust(request: PhotoLibraryDevelopRelativeV1): PhotoLibraryDevelopSettingsV1;
	applyBatch(request: PhotoLibraryDevelopBatchRequestV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopBatchReceiptV1>;
}
