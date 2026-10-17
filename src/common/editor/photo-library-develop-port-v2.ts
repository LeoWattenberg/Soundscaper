/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateV1 } from './imaging/image-develop-contract-v1.ts';
import type { ImageDevelopStateV2 } from './imaging/image-develop-state-v2.ts';
import type { PhotoLibraryDevelopSettingsPortV2 } from './photo-library-develop-settings-port-v2.ts';
import type { PhotoLibraryDevelopPresetsPortV2 } from './photo-library-develop-presets-port-v2.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from './photo-library-develop-original-port-v1.ts';
import type { PhotoLibraryDevelopMaskRasterPortV1 } from './photo-library-develop-mask-raster-port-v1.ts';

/** Authored shared-effect settings only; no photo document, original locator or media body. */
export type PhotoLibraryDevelopSettingsV2 = ImageDevelopStateV1 | ImageDevelopStateV2;

export interface PhotoLibraryDevelopSnapshotV2 {
	readonly schemaVersion: 2;
	/** Production snapshots bind settings/preset commands to the canonical catalog. */
	readonly catalogId: string;
	readonly photoId: string;
	readonly revision: number;
	readonly activeVersionId: string;
	readonly versionId: string;
	readonly versions: readonly Readonly<{ id: string; name: string; kind: 'master' | 'virtual-copy' }>[];
	readonly develop: Readonly<PhotoLibraryDevelopSettingsV2>;
	readonly history: Readonly<{ cursor: number;
		entries: readonly Readonly<{ index: number; label: string; createdAt: string | null }>[] }>;
	readonly snapshots: readonly Readonly<{ id: string; name: string; createdAt: string }>[];
}

/** Every workspace action names its version; delayed presentation never borrows the active version. */
export type PhotoLibraryDevelopCommandV2 =
	| Readonly<{ type: 'record-develop'; versionId: string; develop: PhotoLibraryDevelopSettingsV2; label: string; createdAt: string }>
	| Readonly<{ type: 'select-develop-history'; versionId: string; cursor: number }>
	| Readonly<{ type: 'save-develop-snapshot'; versionId: string; id: string; name: string; createdAt: string }>
	| Readonly<{ type: 'delete-develop-snapshot'; versionId: string; snapshotId: string }>
	| Readonly<{ type: 'restore-develop-snapshot'; versionId: string; snapshotId: string; label: string; createdAt: string }>
	| Readonly<{ type: 'create-virtual-copy'; id: string; name: string; createdAt: string; sourceVersionId: string }>
	| Readonly<{ type: 'activate-version' | 'delete-virtual-copy'; versionId: string }>
	| Readonly<{ type: 'rename-virtual-copy'; versionId: string; name: string }>;

export interface PhotoLibraryDevelopReadV2 {
	readonly schemaVersion: 2;
	readonly photoId: string;
	readonly versionId?: string;
}
export interface PhotoLibraryDevelopApplyV2 {
	readonly schemaVersion: 2;
	readonly photoId: string;
	readonly expectedRevision: number;
	readonly command: PhotoLibraryDevelopCommandV2;
}
export interface PhotoLibraryDevelopAcknowledgementV2 {
	readonly schemaVersion: 2;
	readonly snapshot: Readonly<PhotoLibraryDevelopSnapshotV2>;
	readonly notices: readonly 'cleanup-failed'[];
}
export interface PhotoLibraryDevelopPortV2 {
	readonly schemaVersion: 2;
	readonly original?: Readonly<PhotoLibraryDevelopOriginalPortV1>;
	readonly settings?: Readonly<PhotoLibraryDevelopSettingsPortV2>;
	readonly presets?: Readonly<PhotoLibraryDevelopPresetsPortV2>;
	readonly maskRasters?: Readonly<PhotoLibraryDevelopMaskRasterPortV1>;
	read(request: PhotoLibraryDevelopReadV2, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopSnapshotV2>;
	apply(request: PhotoLibraryDevelopApplyV2, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopAcknowledgementV2>;
}
