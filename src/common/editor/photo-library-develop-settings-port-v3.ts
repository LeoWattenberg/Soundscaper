/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopSelectionV3, ImageDevelopSettingsPacketV3 } from './imaging/image-develop-settings-contract-v3.ts';
import type { ImageDevelopSettingsPacketV1 } from './imaging/image-develop-settings-contract-v1.ts';
import type { ImageDevelopSettingsPacketV2 } from './imaging/image-develop-settings-contract-v2.ts';
import type { ImageDevelopStateThroughV3 } from './imaging/image-develop-state-through-v3.ts';
import type { PhotoLibraryDevelopBatchTargetV2, PhotoLibraryDevelopBatchOutcomeV2 } from './photo-library-develop-settings-port-v2.ts';

export type PhotoLibraryDevelopSelectionV3 = ImageDevelopSelectionV3;
export type PhotoLibraryDevelopSettingsPacketV3 = ImageDevelopSettingsPacketV3;
type SettingsThroughV3 = ImageDevelopSettingsPacketV1 | ImageDevelopSettingsPacketV2 | ImageDevelopSettingsPacketV3;
export interface PhotoDevelopSettingsSourceCurrentV1 {
	readonly schemaVersion: 3;
	readonly catalogId: string;
	readonly photoId: string;
	readonly versionId: string;
	readonly revision: number;
	readonly develop: Readonly<ImageDevelopStateThroughV3>;
}
export interface PhotoLibraryDevelopCopySelectedV3 extends PhotoDevelopSettingsSourceCurrentV1 {
	readonly selection: Readonly<ImageDevelopSelectionV3>;
}
export interface PhotoLibraryDevelopCopyV3 {
	readonly schemaVersion: 3;
	readonly develop: Readonly<ImageDevelopStateThroughV3>;
	readonly selection: Readonly<ImageDevelopSelectionV3>;
}
export interface PhotoLibraryDevelopMergeV3 {
	readonly schemaVersion: 3;
	readonly target: Readonly<ImageDevelopStateThroughV3>;
	readonly settings: Readonly<SettingsThroughV3>;
}
export interface PhotoLibraryDevelopRelativeV3 {
	readonly schemaVersion: 3;
	readonly target: Readonly<ImageDevelopStateThroughV3>;
	readonly effectType: 'white-balance-v1' | 'tone-ladder-v1';
	readonly changes: Readonly<Record<string, number>>;
}
export type PhotoLibraryDevelopBatchTargetV3 = PhotoLibraryDevelopBatchTargetV2;
export type PhotoLibraryDevelopBatchOutcomeV3 = PhotoLibraryDevelopBatchOutcomeV2;
export interface PhotoLibraryDevelopBatchRequestV3 {
	readonly schemaVersion: 3;
	readonly catalogId: string;
	readonly targets: readonly PhotoLibraryDevelopBatchTargetV3[];
	readonly action:
		| Readonly<{ kind: 'paste'; settings: Readonly<SettingsThroughV3> }>
		| Readonly<{ kind: 'preset'; presetId: string; expectedPresetRevision: number }>
		| Readonly<{ kind: 'relative'; effectType: PhotoLibraryDevelopRelativeV3['effectType']; changes: Readonly<Record<string, number>> }>;
	readonly label: string;
	readonly createdAt: string;
}
export interface PhotoLibraryDevelopBatchReceiptV3 {
	readonly schemaVersion: 3;
	readonly catalogId: string;
	readonly completion: 'finished' | 'cancelled' | 'interrupted';
	readonly outcomes: readonly Readonly<PhotoLibraryDevelopBatchOutcomeV3>[];
	readonly notices: readonly 'cleanup-failed'[];
}
/** Selected copy authenticates a draft and the complete saved source. Brush
 * packets remain same-child ephemeral identities, without installation rights. */
export interface PhotoLibraryDevelopSettingsPortV3 {
	copy(request: PhotoLibraryDevelopCopyV3): PhotoLibraryDevelopSettingsPacketV3;
	copySelected(request: PhotoLibraryDevelopCopySelectedV3, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopSettingsPacketV3>;
	merge(request: PhotoLibraryDevelopMergeV3): ImageDevelopStateThroughV3;
	adjust(request: PhotoLibraryDevelopRelativeV3): ImageDevelopStateThroughV3;
	applyBatch(request: PhotoLibraryDevelopBatchRequestV3, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopBatchReceiptV3>;
}
