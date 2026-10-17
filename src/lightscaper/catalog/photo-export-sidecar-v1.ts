/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateV1 } from '../../common/editor/imaging/image-develop-contract-v1.ts';
import type { ImageDevelopStateV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import type { ImageMetadataV1 } from '../../common/editor/imaging/image-metadata-model-v1.ts';
import type { PhotoMetadataV1 } from './types.ts';
import { createPhotoExportSidecarForProfileV1, normalizePhotoExportSidecarForProfileV1,
	parsePhotoExportSidecarForProfileV1, serializePhotoExportSidecarForProfileV1 } from './internal/photo-export-sidecar-kernel-v1.ts';

export interface PhotoExportSidecarBindingV1 {
	readonly catalogId: string;
	readonly photoId: string;
	readonly versionId: string;
	readonly expectedRevision: number;
}
export interface PhotoExportSidecarV1 {
	readonly schemaFamily: 'lightscaper';
	readonly schemaVersion: 1;
	readonly kind: 'photo-export-sidecar';
	readonly photoSchemaVersion: 1 | 2;
	readonly binding: Readonly<{ catalogId: string; photoId: string; revision: number; activeVersionId: string }>;
	readonly original: Readonly<{ fileName: string; contentSha256: string; byteLength: number }>;
	readonly version: Readonly<{ id: string; kind: 'master' | 'virtual-copy'; name: string; createdAt: string;
		develop: Readonly<ImageDevelopStateV1 | ImageDevelopStateV2> }>;
	readonly metadata: Readonly<PhotoMetadataV1>;
	readonly extractedMetadata: Readonly<ImageMetadataV1> | null;
}

export const PHOTO_EXPORT_SIDECAR_SUFFIX_V1 = '.lightscaper.json';
export const PHOTO_EXPORT_SIDECAR_MIME_TYPE_V1 = 'application/json';
/** Permanently strict Photo1/2 wire. The shared kernel never silently upgrades it. */
export function createPhotoExportSidecarV1(value: unknown, binding: PhotoExportSidecarBindingV1): PhotoExportSidecarV1 {
	return createPhotoExportSidecarForProfileV1('legacy1', value, binding);
}
export function normalizePhotoExportSidecarV1(value: unknown): PhotoExportSidecarV1 { return normalizePhotoExportSidecarForProfileV1('legacy1', value); }
export function serializePhotoExportSidecarV1(value: unknown): string { return serializePhotoExportSidecarForProfileV1('legacy1', value); }
export function parsePhotoExportSidecarV1(value: string): PhotoExportSidecarV1 { return parsePhotoExportSidecarForProfileV1('legacy1', value); }
