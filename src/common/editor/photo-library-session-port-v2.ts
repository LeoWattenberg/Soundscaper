/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySessionPortV1 } from './photo-library-session-port-v1.ts';
import type { PhotoLibraryDevelopPortV2 } from './photo-library-develop-port-v2.ts';
import type { PhotoLibraryDevelopImportPortV2 } from './photo-library-develop-import-port-v2.ts';
import type { PhotoLibraryCubeLutPortV1 } from './photo-library-cube-lut-port-v1.ts';
import type { MaskRasterSourcePortV1 } from './imaging/mask-raster-source-port-v1.ts';
import type { PhotoLibraryExportPresetsPortV1 } from './photo-library-export-presets-port-v1.ts';
import type { PhotoLibraryImageReceivePortV1 } from './photo-library-image-receive-port-v1.ts';
import type { PhotoLibraryImageHandoffPortV1 } from './photo-library-image-handoff-port-v1.ts';
import type { PhotoLibraryCollectionHandoffPortV1 } from './photo-library-collection-handoff-port-v1.ts';
import type { PhotoLibraryCullingNavigationPortV1 } from './photo-library-culling-navigation-port-v1.ts';

/** A body-free, complete selected-version export projection; product schemas remain private. */
export interface PhotoLibraryExportSidecarRequest {
	readonly catalogId: string; readonly photoId: string; readonly versionId: string; readonly expectedRevision: number;
}
export type ReadPhotoExportSidecar = (request: Readonly<PhotoLibraryExportSidecarRequest>, options: Readonly<{ signal: AbortSignal }>) => Promise<string>;

/** Body-free CAS transport, limited by the selected Session to its scalar export journal. */
export interface PhotoLibraryExportJournalSettings {
	get(key: string): Promise<unknown>;
	putIfAbsent(key: string, value: unknown): Promise<boolean>;
	replaceIfCurrent(key: string, expected: unknown, value: unknown): Promise<boolean>;
	deleteIfCurrent?(key: string, expected: unknown): Promise<boolean>;
}
export interface PhotoLibraryExportJournalAccess {
	readonly catalogId: string;
	readonly settings: Readonly<PhotoLibraryExportJournalSettings>;
	readonly verifyResources: (request: Readonly<PhotoLibraryExportSidecarRequest>, options?: Readonly<{ signal?: AbortSignal }>) => Promise<void>;
}
export interface PhotoLibraryExportJournalPort {
	open(options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<PhotoLibraryExportJournalAccess>>;
}

/** Fixed current Develop envelopes; scalar library and organization ports stay unchanged. */
export interface PhotoLibrarySessionPortV2 extends Omit<PhotoLibrarySessionPortV1, 'develop' | 'developImport'> {
	readonly develop: Readonly<PhotoLibraryDevelopPortV2>;
	readonly developImport: Readonly<PhotoLibraryDevelopImportPortV2>;
	readonly cubeLuts: Readonly<PhotoLibraryCubeLutPortV1>;
	/** Selected immutable brush bytes, borrowed inside the Session operation. */
	readonly maskRasterSource?: Readonly<MaskRasterSourcePortV1>;
	readonly imageReceive?: Readonly<PhotoLibraryImageReceivePortV1>;
	readonly imageHandoff?: Readonly<PhotoLibraryImageHandoffPortV1>;
	readonly collectionHandoff?: Readonly<PhotoLibraryCollectionHandoffPortV1>;
	readonly cullingNavigation?: Readonly<PhotoLibraryCullingNavigationPortV1>;
	readonly readExportSidecar?: ReadPhotoExportSidecar;
	readonly exportJournal?: Readonly<PhotoLibraryExportJournalPort>;
	readonly exportPresets?: Readonly<PhotoLibraryExportPresetsPortV1>;
}
export type CreatePhotoLibrarySessionV3 = () => Promise<PhotoLibrarySessionPortV2>;
