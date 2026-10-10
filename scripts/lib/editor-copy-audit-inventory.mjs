/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { FREESOUND_ATTRIBUTION_ENGLISH_COPY } from '../../src/common/i18n/freesound-attribution-copy.js';
import { photoJpegExportCopy } from '../../src/common/i18n/lightscaper-photo-jpeg-export-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { imageExportGraphicCopy } from '../../src/common/i18n/image-export-graphic-copy.ts';

const freesoundAttribution = Object.fromEntries(Object.entries(FREESOUND_ATTRIBUTION_ENGLISH_COPY)
	.map(([key, value]) => [`ui.freesoundAttribution.${key}`, value]));
const photoJpegExport = Object.fromEntries(Object.entries(photoJpegExportCopy('en'))
	.map(([key, value]) => [`ui.photoJpegExport.${key}`, value]));
const photoPngExport = Object.fromEntries(Object.entries(photoPngExportCopy('en'))
	.map(([key, value]) => [`ui.photoPngExport.${key}`, value]));
const imageExportGraphic = Object.fromEntries(Object.entries(imageExportGraphicCopy('en'))
	.map(([key, value]) => [`ui.imageExportGraphic.${key}`, value]));

/** Build-time inventory includes copy owned by lazy surfaces without bundling it eagerly. */
export const EDITOR_COPY_AUDIT_INVENTORY = Object.freeze({
	...EDITOR_ENGLISH_COPY,
	...freesoundAttribution,
	...photoPngExport,
	...photoJpegExport,
	...imageExportGraphic,
});
