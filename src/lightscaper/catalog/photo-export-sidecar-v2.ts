/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateThroughV3 } from '../../common/editor/imaging/image-develop-state-through-v3.ts';
import type { PhotoExportSidecarBindingV1, PhotoExportSidecarV1 } from './photo-export-sidecar-v1.ts';
import { createPhotoExportSidecarForProfileV1, normalizePhotoExportSidecarForProfileV1,
	parsePhotoExportSidecarForProfileV1, serializePhotoExportSidecarForProfileV1 } from './internal/photo-export-sidecar-kernel-v1.ts';

/** Explicit Photo3 provenance, including selected process1/2 with repaired retained state. */
export interface PhotoExportSidecarV2 extends Omit<PhotoExportSidecarV1, 'schemaVersion' | 'photoSchemaVersion' | 'version'> {
	readonly schemaVersion: 2;
	readonly photoSchemaVersion: 3;
	readonly version: Omit<PhotoExportSidecarV1['version'], 'develop'> & { readonly develop: Readonly<ImageDevelopStateThroughV3> };
}
export function createPhotoExportSidecarV2(value: unknown, binding: PhotoExportSidecarBindingV1): PhotoExportSidecarV2 {
	return createPhotoExportSidecarForProfileV1('current2', value, binding);
}
export function normalizePhotoExportSidecarV2(value: unknown): PhotoExportSidecarV2 { return normalizePhotoExportSidecarForProfileV1('current2', value); }
export function serializePhotoExportSidecarV2(value: unknown): string { return serializePhotoExportSidecarForProfileV1('current2', value); }
export function parsePhotoExportSidecarV2(value: string): PhotoExportSidecarV2 { return parsePhotoExportSidecarForProfileV1('current2', value); }
