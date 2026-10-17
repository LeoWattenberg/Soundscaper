/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeManifest } from '../../common/editor/scape-archive-envelope.ts';
import { normalizePhotoCatalogArchiveForVersion, serializePhotoCatalogArchiveForVersion, assertPhotoCatalogPackManifestForVersion,
	type PhotoCatalogArchiveDocumentForVersion, type PhotoCatalogArchiveDevelopPresetPackForVersion,
	type PhotoCatalogArchiveMaskRasterResource, type PhotoCatalogArchiveLutResource } from './catalog-archive-contract-kernel-v1.ts';
export type PhotoCatalogArchiveDocumentV6 = PhotoCatalogArchiveDocumentForVersion<6>;
export type PhotoCatalogArchiveDevelopPresetPackV6 = PhotoCatalogArchiveDevelopPresetPackForVersion<6>;
export type PhotoCatalogArchiveMaskRasterResourceV6 = PhotoCatalogArchiveMaskRasterResource;
export type PhotoCatalogArchiveLutResourceV6 = PhotoCatalogArchiveLutResource;
/** Explicit wire6 admission; resource declarations are metadata, never body proof. */
export function normalizePhotoCatalogArchiveV6(value: unknown): PhotoCatalogArchiveDocumentV6 { return normalizePhotoCatalogArchiveForVersion(6, value); }
export function serializePhotoCatalogArchiveV6(value: unknown): string { return serializePhotoCatalogArchiveForVersion(6, value); }
export function assertPhotoCatalogPackManifestV6(document: PhotoCatalogArchiveDocumentV6, manifest: ScapeManifest): void { assertPhotoCatalogPackManifestForVersion(6, document, manifest); }
