/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeManifest } from '../../common/editor/scape-archive-envelope.ts';
import { normalizePhotoCatalogArchiveForVersion, serializePhotoCatalogArchiveForVersion, assertPhotoCatalogPackManifestForVersion,
	type PhotoCatalogArchiveDocumentForVersion, type PhotoCatalogArchiveDevelopPresetPackForVersion } from './catalog-archive-contract-kernel-v1.ts';

export type PhotoCatalogArchiveDocumentV8 = PhotoCatalogArchiveDocumentForVersion<8>;
export type PhotoCatalogArchiveDevelopPresetPackV8 = PhotoCatalogArchiveDevelopPresetPackForVersion<8>;
export function normalizePhotoCatalogArchiveV8(value: unknown): PhotoCatalogArchiveDocumentV8 { return normalizePhotoCatalogArchiveForVersion(8, value); }
export function serializePhotoCatalogArchiveV8(value: unknown): string { return serializePhotoCatalogArchiveForVersion(8, value); }
export function assertPhotoCatalogPackManifestV8(document: PhotoCatalogArchiveDocumentV8, manifest: ScapeManifest): void { assertPhotoCatalogPackManifestForVersion(8, document, manifest); }
