/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoEffectLeaf } from './project-media-types.ts';
import type { VideoMaskMatteGraphV1 } from './video-mask-matte-v24.ts';
import type { PhotoLibraryDevelopSettingsPortV1 } from './photo-library-develop-settings-port-v1.ts';

/** Authored shared-effect settings only; no photo document, original locator or media body. */
export interface PhotoLibraryDevelopSettingsV1 {
	readonly processVersion: 1;
	readonly effects: readonly VideoEffectLeaf[];
	readonly geometry: Readonly<{ crop: Readonly<{ x: number; y: number; width: number; height: number }> | null;
		rotationDegrees: number; flipHorizontal: boolean; flipVertical: boolean }>;
	readonly masks: readonly VideoMaskMatteGraphV1[];
	readonly maskBindings: readonly Readonly<{ effectId: string; maskId: string }>[];
}

export interface PhotoLibraryDevelopSnapshotV1 {
	readonly schemaVersion: 1;
	readonly photoId: string;
	readonly revision: number;
	readonly activeVersionId: string;
	readonly versionId: string;
	readonly versions: readonly Readonly<{ id: string; name: string; kind: 'master' | 'virtual-copy' }>[];
	readonly develop: Readonly<PhotoLibraryDevelopSettingsV1>;
	readonly history: Readonly<{ cursor: number;
		entries: readonly Readonly<{ index: number; label: string; createdAt: string | null }>[] }>;
	readonly snapshots: readonly Readonly<{ id: string; name: string; createdAt: string }>[];
}

/** Every workspace action names its version; delayed presentation never borrows the active version. */
export type PhotoLibraryDevelopCommandV1 =
	| Readonly<{ type: 'record-develop'; versionId: string; develop: PhotoLibraryDevelopSettingsV1; label: string; createdAt: string }>
	| Readonly<{ type: 'select-develop-history'; versionId: string; cursor: number }>
	| Readonly<{ type: 'save-develop-snapshot'; versionId: string; id: string; name: string; createdAt: string }>
	| Readonly<{ type: 'delete-develop-snapshot'; versionId: string; snapshotId: string }>
	| Readonly<{ type: 'restore-develop-snapshot'; versionId: string; snapshotId: string; label: string; createdAt: string }>
	| Readonly<{ type: 'create-virtual-copy'; id: string; name: string; createdAt: string; sourceVersionId: string }>
	| Readonly<{ type: 'activate-version' | 'delete-virtual-copy'; versionId: string }>
	| Readonly<{ type: 'rename-virtual-copy'; versionId: string; name: string }>;

export interface PhotoLibraryDevelopReadV1 {
	readonly schemaVersion: 1;
	readonly photoId: string;
	readonly versionId?: string;
}
export interface PhotoLibraryDevelopApplyV1 {
	readonly schemaVersion: 1;
	readonly photoId: string;
	readonly expectedRevision: number;
	readonly command: PhotoLibraryDevelopCommandV1;
}
export interface PhotoLibraryDevelopAcknowledgementV1 {
	readonly snapshot: Readonly<PhotoLibraryDevelopSnapshotV1>;
	readonly notices: readonly 'cleanup-failed'[];
}
export interface PhotoLibraryDevelopPortV1 {
	readonly settings?: Readonly<PhotoLibraryDevelopSettingsPortV1>;
	read(request: PhotoLibraryDevelopReadV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopSnapshotV1>;
	apply(request: PhotoLibraryDevelopApplyV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopAcknowledgementV1>;
}
