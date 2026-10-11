/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoExportSidecarBindingV1, PhotoExportSidecarV1 } from './photo-export-sidecar-v1.ts';
import type { PhotoExportSidecarV2 } from './photo-export-sidecar-v2.ts';
import { createPhotoExportSidecarForProfileV1, normalizePhotoExportSidecarForProfileV1,
	parsePhotoExportSidecarForProfileV1, serializePhotoExportSidecarForProfileV1 } from './internal/photo-export-sidecar-kernel-v1.ts';

export type PhotoExportSidecarCurrentV1 = PhotoExportSidecarV1 | PhotoExportSidecarV2;
/** Whole Current admission decides the wire; loading genuine legacy facts never upgrades it. */
export function createPhotoExportSidecarCurrentV1(value: unknown, binding: PhotoExportSidecarBindingV1): PhotoExportSidecarCurrentV1 {
	return createPhotoExportSidecarForProfileV1('current', value, binding);
}
export function normalizePhotoExportSidecarCurrentV1(value: unknown): PhotoExportSidecarCurrentV1 { return normalizePhotoExportSidecarForProfileV1('current', value); }
export function serializePhotoExportSidecarCurrentV1(value: unknown): string { return serializePhotoExportSidecarForProfileV1('current', value); }
export function parsePhotoExportSidecarCurrentV1(value: string): PhotoExportSidecarCurrentV1 { return parsePhotoExportSidecarForProfileV1('current', value); }
