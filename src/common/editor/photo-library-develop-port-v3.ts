/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateCurrentV1 } from './imaging/image-develop-state-current-v1.ts';
import type { PhotoLibraryDevelopCommandV2, PhotoLibraryDevelopSnapshotV2 } from './photo-library-develop-port-v2.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from './photo-library-develop-original-port-v1.ts';
import type { PhotoLibraryDevelopMaskRasterPortV1 } from './photo-library-develop-mask-raster-port-v1.ts';
import type { PhotoLibraryDevelopSettingsPortV3 } from './photo-library-develop-settings-port-v3.ts';

/** Complete current settings; original locators and resource bodies remain private. */
export type PhotoLibraryDevelopSettingsV3 = ImageDevelopStateCurrentV1;
export interface PhotoLibraryDevelopSnapshotV3 extends Omit<PhotoLibraryDevelopSnapshotV2, 'schemaVersion' | 'develop'> {
	readonly schemaVersion: 3;
	readonly develop: Readonly<PhotoLibraryDevelopSettingsV3>;
}
export type PhotoLibraryDevelopCommandV3 = Exclude<PhotoLibraryDevelopCommandV2, { type: 'record-develop' }>
	| Readonly<{ type: 'record-develop'; versionId: string; develop: PhotoLibraryDevelopSettingsV3; label: string; createdAt: string }>;
export interface PhotoLibraryDevelopReadV3 {
	readonly schemaVersion: 3;
	readonly photoId: string;
	readonly versionId?: string;
}
export interface PhotoLibraryDevelopApplyV3 {
	readonly schemaVersion: 3;
	readonly photoId: string;
	readonly expectedRevision: number;
	readonly command: PhotoLibraryDevelopCommandV3;
}
export interface PhotoLibraryDevelopAcknowledgementV3 {
	readonly schemaVersion: 3;
	readonly snapshot: Readonly<PhotoLibraryDevelopSnapshotV3>;
	readonly notices: readonly 'cleanup-failed'[];
}
/** Current settings use selected resource admission; legacy preset authority stays separate. */
export interface PhotoLibraryDevelopPortV3 {
	readonly schemaVersion: 3;
	readonly original?: Readonly<PhotoLibraryDevelopOriginalPortV1>;
	readonly maskRasters?: Readonly<PhotoLibraryDevelopMaskRasterPortV1>;
	readonly settingsCurrent?: Readonly<PhotoLibraryDevelopSettingsPortV3>;
	read(request: PhotoLibraryDevelopReadV3, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopSnapshotV3>;
	apply(request: PhotoLibraryDevelopApplyV3, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopAcknowledgementV3>;
}
