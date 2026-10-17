/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeManifest } from '../../common/editor/scape-archive-envelope.ts';
import { normalizePhotoCatalogArchiveForVersion, serializePhotoCatalogArchiveForVersion, assertPhotoCatalogPackManifestForVersion,
	type PhotoCatalogArchiveDocumentForVersion, type PhotoCatalogArchiveDevelopPresetPackForVersion,
	type PhotoCatalogArchiveMaskRasterResource, type PhotoCatalogArchiveLutResource } from './catalog-archive-contract-kernel-v1.ts';
export type PhotoCatalogArchiveDocumentV7 = PhotoCatalogArchiveDocumentForVersion<7>;
export type PhotoCatalogArchiveDevelopPresetPackV7 = PhotoCatalogArchiveDevelopPresetPackForVersion<7>;
export type PhotoCatalogArchiveMaskRasterResourceV7 = PhotoCatalogArchiveMaskRasterResource;
export type PhotoCatalogArchiveLutResourceV7 = PhotoCatalogArchiveLutResource;
/** Explicit wire7 admission; resource declarations are metadata, never body proof. */
export function normalizePhotoCatalogArchiveV7(value: unknown): PhotoCatalogArchiveDocumentV7 { return normalizePhotoCatalogArchiveForVersion(7, value); }
export function serializePhotoCatalogArchiveV7(value: unknown): string { return serializePhotoCatalogArchiveForVersion(7, value); }
export function assertPhotoCatalogPackManifestV7(document: PhotoCatalogArchiveDocumentV7, manifest: ScapeManifest): void { assertPhotoCatalogPackManifestForVersion(7, document, manifest); }
